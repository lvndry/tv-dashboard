import { config } from '../config';
import { briefSignature, createBrief, type Brief } from './brief';
import { connection } from './chatgpt';
import { fetchDiscover, type DiscoverStory } from './discover';
import { fetchParisEvents, type CityEvent } from './events';
import { perplexityAvailable } from './perplexity';
import { fetchFeed, mergeStories, type Story } from './news';
import { fetchToday, fetchWeek, mergeLive, needsLiveUpdates, type Match } from './sports';
import { readCache, settings, writeCache } from './store';
import { fetchWeather, type Weather } from './weather';

export interface SourceStatus {
  name: string;
  ok: boolean | null;
  updatedAt: number | null;
  detail: string;
}

const weatherCache = readCache<Weather>('weather');
const newsCache = readCache<Story[]>('news');
const briefCache = readCache<Brief>('brief');
const sportsCache = readCache<Match[]>('sports');
const discoverCache = readCache<DiscoverStory[]>('discover');
const eventsCache = readCache<CityEvent[]>('paris-events');

export const data = {
  weather: weatherCache?.value ?? null,
  weatherAt: weatherCache?.savedAt ?? null as number | null,
  stories: newsCache?.value ?? [] as Story[],
  newsAt: newsCache?.savedAt ?? null as number | null,
  brief: briefCache?.value ?? null as Brief | null,
  briefAt: briefCache?.savedAt ?? null as number | null,
  briefLoading: false,
  chatgpt: { connected: false, plan: null as string | null },
  discover: (discoverCache?.value ?? [] as DiscoverStory[]).filter(story => Date.now() - story.published < 48 * 3600000),
  discoverAt: discoverCache?.savedAt ?? null as number | null,
  matches: sportsCache?.value ?? [] as Match[],
  matchesAt: sportsCache?.savedAt ?? null as number | null,
  events: eventsCache?.value ?? [] as CityEvent[],
  eventsAt: eventsCache?.savedAt ?? null as number | null,
  status: new Map<string, SourceStatus>(),
};

if (weatherCache) {
  data.status.set('weather', { name: 'Weather · Open-Meteo', ok: null, updatedAt: weatherCache.savedAt, detail: 'cached' });
}
for (const feed of config.news) {
  data.status.set(`feed:${feed.id}`, { name: `${feed.name} · ${feed.section}`, ok: null, updatedAt: newsCache?.savedAt ?? null, detail: newsCache ? 'cached' : 'waiting' });
}
if (briefCache) {
    data.status.set('brief', { name: `Brief · Perplexity ${config.brief.perplexityModel}`, ok: null, updatedAt: briefCache.savedAt, detail: 'cached' });
}

const listeners = new Set<() => void>();

export function onDataChange(listener: () => void): void {
  listeners.add(listener);
}

function notify(): void {
  for (const listener of listeners) listener();
}

function setStatus(key: string, status: SourceStatus): void {
  data.status.set(key, status);
}

export function reportStatus(key: string, status: SourceStatus): void {
  setStatus(key, status);
  notify();
}

const message = (error: unknown): string => error instanceof Error ? error.message : String(error);

let weatherInFlight = false;

export async function refreshWeather(): Promise<void> {
  if (weatherInFlight) return;
  weatherInFlight = true;
  try {
    data.weather = await fetchWeather();
    data.weatherAt = Date.now();
    writeCache('weather', data.weather, data.weatherAt);
    setStatus('weather', { name: 'Weather · Open-Meteo', ok: true, updatedAt: data.weatherAt, detail: 'up to date' });
  } catch (error) {
    setStatus('weather', { name: 'Weather · Open-Meteo', ok: false, updatedAt: data.weatherAt, detail: message(error) });
  } finally {
    weatherInFlight = false;
    notify();
  }
}

let newsInFlight = false;

export async function refreshNews(): Promise<void> {
  if (newsInFlight) return;
  newsInFlight = true;
  try {
    const results = await Promise.allSettled(config.news.map(feed => fetchFeed(feed)));
    const lists: Story[][] = [];
    results.forEach((result, index) => {
      const feed = config.news[index]!;
      const label = `${feed.name} · ${feed.section}`;
      if (result.status === 'fulfilled') {
        lists.push(result.value);
        setStatus(`feed:${feed.id}`, { name: label, ok: true, updatedAt: Date.now(), detail: `${result.value.length} stories` });
      } else {
        setStatus(`feed:${feed.id}`, { name: label, ok: false, updatedAt: data.status.get(`feed:${feed.id}`)?.updatedAt ?? null, detail: message(result.reason) });
      }
    });
    if (lists.length) {
      data.stories = mergeStories(lists);
      data.newsAt = Date.now();
      writeCache('news', data.stories, data.newsAt);
    }
  } finally {
    newsInFlight = false;
    notify();
  }
  void refreshBrief();
}

const briefMaxAgeMs = config.brief.refreshMinutes * 60000;

export function briefState(): 'unavailable' | 'off' | 'loading' | 'ready' | 'error' | 'waiting' {
    if (!perplexityAvailable()) return 'unavailable';
  if (!settings.briefEnabled) return 'off';
  if (data.briefLoading) return 'loading';
  if (data.status.get('brief')?.ok === false) return 'error';
  return data.brief ? 'ready' : 'waiting';
}

export async function refreshBrief(force = false): Promise<void> {
    // While Discover's top stories are coming in, the paid brief would duplicate them.
    if (!perplexityAvailable() || !settings.briefEnabled || data.briefLoading || !data.stories.length || data.discover.length) return;
  const fresh = data.briefAt !== null && Date.now() - data.briefAt < briefMaxAgeMs;
  const sameHeadlines = data.brief?.signature === briefSignature(data.stories);
  if (!force && (fresh || sameHeadlines)) return;
  data.briefLoading = true;
  notify();
  try {
    data.brief = await createBrief(data.stories);
    data.briefAt = Date.now();
    writeCache('brief', data.brief, data.briefAt);
    setStatus('brief', { name: `Brief · Perplexity ${config.brief.perplexityModel}`, ok: true, updatedAt: data.briefAt, detail: `${data.brief.stories.length} stories` });
  } catch (error) {
    setStatus('brief', { name: `Brief · Perplexity ${config.brief.perplexityModel}`, ok: false, updatedAt: data.briefAt, detail: message(error) });
  } finally {
    data.briefLoading = false;
    notify();
  }
}

export async function refreshConnection(): Promise<void> {
  try {
    data.chatgpt = await connection();
  } catch (error) {
    data.chatgpt = { connected: false, plan: null };
  }
  // The brief no longer depends on ChatGPT (it runs on Perplexity); the
  // connection state now only gates the gallery art stories.
  notify();
}

export function storyById(id: string): Story | undefined {
  return data.stories.find(story => story.id === id);
}

let discoverInFlight = false;

export async function refreshDiscover(): Promise<void> {
  if (discoverInFlight) return;
  discoverInFlight = true;
  try {
    data.discover = await fetchDiscover();
    data.discoverAt = Date.now();
    writeCache('discover', data.discover, data.discoverAt);
    setStatus('discover', { name: 'Top stories · Perplexity Discover', ok: true, updatedAt: data.discoverAt, detail: `${data.discover.length} stories from the last 48 hours` });
  } catch (error) {
    setStatus('discover', { name: 'Top stories · Perplexity Discover', ok: false, updatedAt: data.discoverAt, detail: message(error) });
  } finally {
    discoverInFlight = false;
    notify();
  }
}

let sportsInFlight = false;

export async function refreshSports(): Promise<void> {
  if (sportsInFlight || !config.sports.leagues.length) return;
  sportsInFlight = true;
  try {
    const { matches, failures } = await fetchWeek();
    if (matches.length || !failures.length) {
      data.matches = matches;
      data.matchesAt = Date.now();
      writeCache('sports', data.matches, data.matchesAt);
    }
    setStatus('sports', {
      name: 'Football · ESPN',
      ok: failures.length < config.sports.leagues.length,
      updatedAt: data.matchesAt,
      detail: failures.length ? `${matches.length} matches; ${failures.join(', ')} unreachable` : `${matches.length} matches this week`,
    });
  } finally {
    sportsInFlight = false;
    notify();
  }
}

let liveInFlight = false;

/** While a match is on, today's scores are refreshed every minute. */
async function refreshLiveScores(): Promise<void> {
  const leagues = needsLiveUpdates(data.matches);
  if (liveInFlight || !leagues.length) return;
  liveInFlight = true;
  try {
    data.matches = mergeLive(data.matches, await fetchToday(leagues));
    writeCache('sports', data.matches, data.matchesAt ?? Date.now());
  } catch (error) {
    setStatus('sports', { name: 'Football · ESPN', ok: false, updatedAt: data.matchesAt, detail: `live scores: ${message(error)}` });
  } finally {
    liveInFlight = false;
    notify();
  }
}

let eventsInFlight = false;

export async function refreshEvents(): Promise<void> {
  if (eventsInFlight || !config.parisEvents) return;
  eventsInFlight = true;
  try {
    data.events = await fetchParisEvents();
    data.eventsAt = Date.now();
    writeCache('paris-events', data.events, data.eventsAt);
    setStatus('events', { name: 'Paris · Que faire à Paris', ok: true, updatedAt: data.eventsAt, detail: `${data.events.length} picks this week` });
  } catch (error) {
    setStatus('events', { name: 'Paris · Que faire à Paris', ok: false, updatedAt: data.eventsAt, detail: message(error) });
  } finally {
    eventsInFlight = false;
    notify();
  }
}

const weatherMaxAgeMs = 10 * 60000;
const sportsMaxAgeMs = 60 * 60000;
const discoverMaxAgeMs = 30 * 60000;
const eventsMaxAgeMs = 3 * 3600000;
const newsMaxAgeMs = 15 * 60000;

export function refreshStale(): void {
  const now = Date.now();
  if (data.weatherAt === null || now - data.weatherAt > weatherMaxAgeMs) void refreshWeather();
  if (data.newsAt === null || now - data.newsAt > newsMaxAgeMs) void refreshNews();
  else void refreshBrief();
  if (data.discoverAt === null || now - data.discoverAt > discoverMaxAgeMs) void refreshDiscover();
  if (data.matchesAt === null || now - data.matchesAt > sportsMaxAgeMs) void refreshSports();
  else void refreshLiveScores();
  if (data.eventsAt === null || now - data.eventsAt > eventsMaxAgeMs) void refreshEvents();
}

export function refreshAll(): void {
  void refreshWeather();
  void refreshNews();
  void refreshDiscover();
  void refreshSports();
  void refreshEvents();
}
