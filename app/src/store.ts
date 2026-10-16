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

export interface SavedLocation {
  name: string;
  latitude: number;
  longitude: number;
  timeZone: string;
}

export interface Settings {
  idleMinutes: number;
  ambientStyle: 'art' | 'clock';
  artSeconds: number;
  accent: string;
  clock24: boolean;
  briefEnabled: boolean;
  ps5Port: number;
  /** Whether the gallery viewer advances by itself. */
  slideshow: boolean;
  /** Chosen on the TV; null means the location in config.ts. */
  location: SavedLocation | null;
}

const defaults: Settings = {
  idleMinutes: 3,
  ambientStyle: 'art',
  artSeconds: 60,
  accent: '#F2DE6B',
  clock24: true,
  briefEnabled: true,
  ps5Port: 1,
  slideshow: false,
  location: null,
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

const stored = readJson<Partial<Settings> & { revision?: number }>(settingsKey) ?? {};
// Revision 2 moved the default artwork interval from 30 s to 60 s; carry saved defaults along once.
if ((stored.revision ?? 1) < 2 && stored.artSeconds === 30) stored.artSeconds = 60;

export const settings: Settings & { revision: number } = { ...defaults, ...stored, revision: 2 };

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
