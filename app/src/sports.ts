// Football fixtures and live scores from ESPN's public scoreboard feed (no key).
// ESPN answers one day per request, so the week is fetched as seven daily calls per league.

import { config } from '../config';
import { fetchJson } from './net';
import { isSameDay, zoned } from './time';

export interface Team {
  name: string;
  short: string;
  logo: string;
  score: string;
}

export interface Match {
  id: string;
  league: string;
  leagueId: string;
  kickoff: number;
  state: 'pre' | 'in' | 'post';
  status: string;
  home: Team;
  away: Team;
  venue: string;
  favourite: boolean;
}

interface EspnCompetitor { homeAway: 'home' | 'away'; score?: string; team: { displayName: string; shortDisplayName: string; logo?: string } }
interface EspnEvent {
  id: string;
  date: string;
  status: { type: { state: 'pre' | 'in' | 'post'; shortDetail: string } };
  competitions: { competitors: EspnCompetitor[]; venue?: { fullName?: string } }[];
}

const marqueeClubs = ['Paris Saint-Germain', 'Marseille', 'Real Madrid', 'Barcelona', 'Atlético', 'Manchester City', 'Liverpool', 'Arsenal', 'Chelsea', 'Manchester United', 'Tottenham', 'Bayern', 'Dortmund', 'Inter', 'AC Milan', 'Juventus', 'Napoli', 'Lyon', 'Monaco'];

const leaguePriority = (leagueId: string): number => ({ 'uefa.champions': 40, 'fra.1': 30, 'eng.1': 25, 'esp.1': 20 } as Record<string, number>)[leagueId] ?? 10;

const isFavourite = (team: string): boolean => config.sports.teams.some(name => team.toLowerCase().includes(name.toLowerCase()));

function dayStamp(epochMs: number): string {
  const time = zoned(epochMs);
  const month = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].indexOf(time.month) + 1;
  return `${time.year}${String(month).padStart(2, '0')}${String(time.day).padStart(2, '0')}`;
}

function toMatch(event: EspnEvent, leagueId: string, league: string): Match | null {
  const competition = event.competitions[0];
  const home = competition?.competitors.find(side => side.homeAway === 'home');
  const away = competition?.competitors.find(side => side.homeAway === 'away');
  if (!home || !away) return null;
  const team = (side: EspnCompetitor): Team => ({
    name: side.team.displayName,
    short: side.team.shortDisplayName,
    logo: side.team.logo ?? '',
    score: side.score ?? '',
  });
  return {
    id: `${leagueId}:${event.id}`,
    league,
    leagueId,
    kickoff: Date.parse(event.date),
    state: event.status.type.state,
    status: event.status.type.shortDetail,
    home: team(home),
    away: team(away),
    venue: competition?.venue?.fullName ?? '',
    favourite: isFavourite(home.team.displayName) || isFavourite(away.team.displayName),
  };
}

async function leagueDay(leagueId: string, league: string, epochMs: number): Promise<Match[]> {
  const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${leagueId}/scoreboard?dates=${dayStamp(epochMs)}`;
  const result = await fetchJson<{ events?: EspnEvent[] }>(url);
  return (result.events ?? []).flatMap(event => toMatch(event, leagueId, league) ?? []);
}

/** The coming week for every configured league. Failed calls are reported, not hidden. */
export async function fetchWeek(now: number = Date.now()): Promise<{ matches: Match[]; failures: string[] }> {
  const jobs = config.sports.leagues.flatMap(league =>
    Array.from({ length: 7 }, (_, offset) => ({ league, day: now + offset * 86400000 })));
  const results = await Promise.allSettled(jobs.map(job => leagueDay(job.league.id, job.league.name, job.day)));
  const matches: Match[] = [];
  const failures = new Set<string>();
  results.forEach((result, position) => {
    if (result.status === 'fulfilled') matches.push(...result.value);
    else failures.add(jobs[position]!.league.name);
  });
  return { matches: dedupe(matches), failures: [...failures] };
}

/** Today's scoreboard for the leagues with a match in play or about to start. */
export async function fetchToday(leagueIds: string[], now: number = Date.now()): Promise<Match[]> {
  const leagues = config.sports.leagues.filter(league => leagueIds.includes(league.id));
  const results = await Promise.all(leagues.map(league => leagueDay(league.id, league.name, now)));
  return results.flat();
}

function dedupe(matches: Match[]): Match[] {
  const byId = new Map<string, Match>();
  for (const match of matches) byId.set(match.id, match);
  return [...byId.values()].sort((first, second) => first.kickoff - second.kickoff);
}

export function mergeLive(week: Match[], today: Match[]): Match[] {
  return dedupe([...week, ...today]);
}

export function interest(match: Match): number {
  const clubs = [match.home.name, match.away.name].filter(name => marqueeClubs.some(club => name.includes(club))).length;
  return (match.favourite ? 100 : 0) + leaguePriority(match.leagueId) + clubs * 15;
}

export function isToday(match: Match, now: number = Date.now()): boolean {
  return isSameDay(match.kickoff, now);
}

/** Matches being played now or kicking off within the next few hours, which need live refreshes. */
export function needsLiveUpdates(matches: Match[], now: number = Date.now()): string[] {
  const active = matches.filter(match => match.state === 'in' || (match.state === 'pre' && match.kickoff - now < 15 * 60000 && match.kickoff - now > -3 * 3600000));
  return Array.from(new Set(active.map(match => match.leagueId)));
}
