import { config } from '../config';
import { briefSignature, createBrief, type Brief } from './brief';
import { connection } from './chatgpt';
import { fetchFeed, mergeStories, type Story } from './news';
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

export const data = {
  weather: weatherCache?.value ?? null,
  weatherAt: weatherCache?.savedAt ?? null as number | null,
  stories: newsCache?.value ?? [] as Story[],
  newsAt: newsCache?.savedAt ?? null as number | null,
  brief: briefCache?.value ?? null as Brief | null,
  briefAt: briefCache?.savedAt ?? null as number | null,
  briefLoading: false,
  chatgpt: { connected: false, plan: null as string | null },
  status: new Map<string, SourceStatus>(),
};

if (weatherCache) {
  data.status.set('weather', { name: 'Weather · Open-Meteo', ok: null, updatedAt: weatherCache.savedAt, detail: 'cached' });
}
for (const feed of config.news) {
  data.status.set(`feed:${feed.id}`, { name: `${feed.name} · ${feed.section}`, ok: null, updatedAt: newsCache?.savedAt ?? null, detail: newsCache ? 'cached' : 'waiting' });
}
if (briefCache) {
  data.status.set('brief', { name: `Brief · ChatGPT ${config.brief.model}`, ok: null, updatedAt: briefCache.savedAt, detail: 'cached' });
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
  if (!data.chatgpt.connected) return 'unavailable';
  if (!settings.briefEnabled) return 'off';
  if (data.briefLoading) return 'loading';
  if (data.status.get('brief')?.ok === false) return 'error';
  return data.brief ? 'ready' : 'waiting';
}

export async function refreshBrief(force = false): Promise<void> {
  if (!data.chatgpt.connected || !settings.briefEnabled || data.briefLoading || !data.stories.length) return;
  const fresh = data.briefAt !== null && Date.now() - data.briefAt < briefMaxAgeMs;
  const sameHeadlines = data.brief?.signature === briefSignature(data.stories);
  if (!force && (fresh || sameHeadlines)) return;
  data.briefLoading = true;
  notify();
  try {
    data.brief = await createBrief(data.stories);
    data.briefAt = Date.now();
    writeCache('brief', data.brief, data.briefAt);
    setStatus('brief', { name: `Brief · ChatGPT ${config.brief.model}`, ok: true, updatedAt: data.briefAt, detail: `${data.brief.stories.length} stories` });
  } catch (error) {
    setStatus('brief', { name: `Brief · ChatGPT ${config.brief.model}`, ok: false, updatedAt: data.briefAt, detail: message(error) });
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
    setStatus('brief', { name: `Brief · ChatGPT ${config.brief.model}`, ok: false, updatedAt: data.briefAt, detail: message(error) });
  }
  if (!data.chatgpt.connected) {
    data.brief = null;
    data.briefAt = null;
    writeCache('brief', null);
  }
  notify();
}

export function storyById(id: string): Story | undefined {
  return data.stories.find(story => story.id === id);
}

const weatherMaxAgeMs = 10 * 60000;
const newsMaxAgeMs = 15 * 60000;

export function refreshStale(): void {
  const now = Date.now();
  if (data.weatherAt === null || now - data.weatherAt > weatherMaxAgeMs) void refreshWeather();
  if (data.newsAt === null || now - data.newsAt > newsMaxAgeMs) void refreshNews();
  else void refreshBrief();
}

export function refreshAll(): void {
  void refreshWeather();
  void refreshNews();
}
