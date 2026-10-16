export const accents = [
  { name: 'Highlighter', value: '#F2DE6B' },
  { name: 'Coral', value: '#FF9A7A' },
  { name: 'Mint', value: '#86E3BC' },
  { name: 'Lilac', value: '#C3B4FF' },
  { name: 'Sky', value: '#96CCFF' },
];

export const idleChoices = [0, 1, 2, 3, 5, 10, 15, 30];

/** Seconds each artwork stays on screen, in ambient mode and the gallery slideshow. */
export const artIntervals = [30, 60, 120, 300, 600];

export interface Settings {
  idleMinutes: number;
  ambientStyle: 'art' | 'clock';
  artSeconds: number;
  accent: string;
  clock24: boolean;
  briefEnabled: boolean;
  ps5Port: number;
}

const defaults: Settings = {
  idleMinutes: 3,
  ambientStyle: 'art',
  artSeconds: 30,
  accent: '#F2DE6B',
  clock24: true,
  briefEnabled: true,
  ps5Port: 1,
};

const settingsKey = 'bonsoir.settings.v1';

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or unavailable: the app still works, it just forgets on restart.
  }
}

export const settings: Settings = { ...defaults, ...readJson<Partial<Settings>>(settingsKey) };

export function updateSettings(patch: Partial<Settings>): void {
  Object.assign(settings, patch);
  writeJson(settingsKey, settings);
}

export interface Cached<T> { savedAt: number; value: T }

export function readCache<T>(name: string): Cached<T> | null {
  return readJson<Cached<T>>(`bonsoir.cache.${name}`);
}

export function writeCache<T>(name: string, value: T, savedAt: number = Date.now()): void {
  writeJson(`bonsoir.cache.${name}`, { savedAt, value });
}

const launchesKey = 'bonsoir.launches.v1';

export function lastLaunch(entryId: string): number | null {
  return readJson<Record<string, number>>(launchesKey)?.[entryId] ?? null;
}

export function recordLaunch(entryId: string): void {
  const launches = readJson<Record<string, number>>(launchesKey) ?? {};
  launches[entryId] = Date.now();
  writeJson(launchesKey, launches);
}
