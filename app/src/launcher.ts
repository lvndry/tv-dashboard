import { config } from '../config';
import type { AppEntry, RackEntry } from './configTypes';
import { toast } from './dom';
import { isTizen, launchApp, resolveApps, type AppResolution } from './platform';
import { recordLaunch } from './store';

let resolution: AppResolution | null = null;
let resolutionError: string | null = null;
let pending: Promise<void> | null = null;

const appEntries = (): AppEntry[] => config.rack.filter((entry): entry is AppEntry => entry.kind === 'app');

export function initApps(): Promise<void> {
  pending ??= resolveApps(appEntries())
    .then(result => { resolution = result; resolutionError = null; })
    .catch(error => { resolutionError = error instanceof Error ? error.message : String(error); })
    .finally(() => { pending = null; });
  return pending;
}

export type AppAvailability = 'checking' | 'ready' | 'missing' | 'unknown';

export function availability(entry: RackEntry): AppAvailability {
  if (entry.kind !== 'app') return 'ready';
  if (resolutionError) return 'unknown';
  if (!resolution) return 'checking';
  return resolution.get(entry.id) ? 'ready' : 'missing';
}

let hdmiHandler: ((entry: RackEntry) => void) | null = null;
let shortcutHandler: ((target: 'news' | 'whatson' | 'gallery' | 'settings') => void) | null = null;

export function onInputRequested(handler: (entry: RackEntry) => void): void {
  hdmiHandler = handler;
}

export function onShortcutRequested(handler: (target: 'news' | 'whatson' | 'gallery' | 'settings') => void): void {
  shortcutHandler = handler;
}

export async function openRackEntry(entry: RackEntry): Promise<void> {
  if (entry.kind === 'shortcut') {
    shortcutHandler?.(entry.target);
    return;
  }
  if (entry.kind === 'input') {
    recordLaunch(entry.id);
    hdmiHandler?.(entry);
    return;
  }
  if (!resolution) await initApps();
  const appId = resolution?.get(entry.id) ?? entry.appId ?? null;
  if (!appId) {
    toast(resolutionError ? `Couldn't list installed apps: ${resolutionError}` : `${entry.name} isn't installed on this TV`, 'error');
    return;
  }
  toast(isTizen ? `Opening ${entry.name}…` : `${entry.name} would open here (${appId})`);
  try {
    await launchApp(appId);
    recordLaunch(entry.id);
  } catch (error) {
    toast(`${entry.name} didn't open: ${error instanceof Error ? error.message : String(error)}`, 'error');
  }
}
