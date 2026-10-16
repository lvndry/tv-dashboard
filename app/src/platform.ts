import type { AppEntry } from './configTypes';

declare const tizen: any;
declare const webapis: any;

export const isTizen = typeof tizen !== 'undefined' && !!tizen.application;

export type Action =
  | 'left' | 'right' | 'up' | 'down' | 'ok' | 'back'
  | 'red' | 'green' | 'yellow' | 'blue' | 'info' | 'pageUp' | 'pageDown';

const keyCodeActions: Record<number, Action> = {
  37: 'left', 38: 'up', 39: 'right', 40: 'down', 13: 'ok',
  10009: 'back', 27: 'back', 8: 'back',
  403: 'red', 404: 'green', 405: 'yellow', 406: 'blue', 457: 'info',
  427: 'pageUp', 428: 'pageDown', 33: 'pageUp', 34: 'pageDown',
};

const desktopKeyActions: Record<string, Action> = {
  r: 'red', a: 'green', n: 'yellow', s: 'blue', i: 'info',
};

export function actionFor(event: KeyboardEvent): Action | null {
  return keyCodeActions[event.keyCode] ?? desktopKeyActions[event.key.toLowerCase()] ?? null;
}

export function registerRemoteKeys(): void {
  if (!isTizen || !tizen.tvinputdevice) return;
  const wanted = ['ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue', 'Info', 'ChannelUp', 'ChannelDown'];
  try {
    tizen.tvinputdevice.registerKeyBatch(wanted);
  } catch {
    for (const key of wanted) {
      try { tizen.tvinputdevice.registerKey(key); } catch { /* key not on this remote */ }
    }
  }
}

interface InstalledApp { id: string; name: string }

function installedApps(): Promise<InstalledApp[]> {
  return new Promise((resolve, reject) => {
    tizen.application.getAppsInfo(
      (list: { id: string; name: string }[]) => resolve(list.map(info => ({ id: info.id, name: info.name ?? '' }))),
      (error: Error) => reject(error),
    );
  });
}

export type AppResolution = Map<string, string | null>;

export async function resolveApps(entries: AppEntry[]): Promise<AppResolution> {
  const resolution: AppResolution = new Map();
  if (!isTizen) {
    for (const entry of entries) resolution.set(entry.id, entry.appId ?? `dev.${entry.id}`);
    return resolution;
  }
  const apps = await installedApps();
  for (const entry of entries) {
    const byId = entry.appId ? apps.find(app => app.id === entry.appId) : undefined;
    const byName = apps.find(app => entry.match.some(term => app.name.toLowerCase().includes(term)));
    resolution.set(entry.id, byId?.id ?? byName?.id ?? null);
  }
  return resolution;
}

export function launchApp(appId: string): Promise<void> {
  if (!isTizen) return Promise.resolve();
  return new Promise((resolve, reject) => {
    tizen.application.launch(appId, () => resolve(), (error: Error) => reject(error));
  });
}

export function openUrl(url: string): Promise<void> {
  if (!isTizen) {
    window.open(url, '_blank', 'noopener');
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const control = new tizen.ApplicationControl('http://tizen.org/appcontrol/operation/view', url);
    tizen.application.launchAppControl(control, null, () => resolve(), (error: Error) => reject(error));
  });
}

const youtubeAppId = '111299001912';

/**
 * Plays a video in the TV's YouTube app. Embedded players refuse to run inside a TV app
 * (it has no web origin), so playback is handed to the app with a deep link.
 */
export function playOnYouTube(videoId: string): Promise<void> {
  if (!isTizen) {
    window.open(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`, '_blank', 'noopener');
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const payload = new tizen.ApplicationControlData('PAYLOAD', [JSON.stringify({ values: `v=${videoId}` })]);
    const control = new tizen.ApplicationControl('http://tizen.org/appcontrol/operation/view', null, null, null, [payload]);
    tizen.application.launchAppControl(control, youtubeAppId, () => resolve(), (error: Error) => reject(error));
  });
}

export function exitApp(): void {
  if (isTizen) tizen.application.getCurrentApplication().exit();
}

/** Shows an HDMI input full-screen behind the (transparent) web layer. */
export function showHdmi(port: number): Promise<void> {
  if (!isTizen) return Promise.resolve();
  if (!tizen.tvwindow) return Promise.reject(new Error('TV window API unavailable'));
  return hdmiSource(port).then(source => new Promise((resolve, reject) => {
    tizen.tvwindow.setSource(source, () => {
      tizen.tvwindow.show(() => resolve(), (error: Error) => reject(error), ['0px', '0px', '1920px', '1080px'], 'MAIN');
    }, (error: Error) => reject(error), 'MAIN');
  }));
}

type VideoSource = { type: string; number: number };

/** The TV lists its inputs through systeminfo's VIDEOSOURCE property, not through tvwindow. */
function hdmiSource(port: number): Promise<VideoSource> {
  const fallback = { type: 'HDMI', number: port };
  if (!tizen.systeminfo?.getPropertyValue) return Promise.resolve(fallback);
  return new Promise(resolve => {
    try {
      tizen.systeminfo.getPropertyValue('VIDEOSOURCE', (info: { connected?: VideoSource[]; disconnected?: VideoSource[] }) => {
        const all = [...(info.connected ?? []), ...(info.disconnected ?? [])];
        resolve(all.find(candidate => candidate.type === 'HDMI' && candidate.number === port) ?? fallback);
      }, () => resolve(fallback));
    } catch {
      resolve(fallback);
    }
  });
}

export function hideHdmi(): Promise<void> {
  if (!isTizen || !tizen.tvwindow) return Promise.resolve();
  return new Promise(resolve => {
    tizen.tvwindow.hide(() => resolve(), () => resolve(), 'MAIN');
  });
}

/** Keeps the TV's own screensaver from covering the app; the app's ambient mode takes its place. */
export function holdSystemScreenSaver(): void {
  try {
    const common = typeof webapis === 'undefined' ? null : webapis.appcommon;
    common?.setScreenSaver(common.AppCommonScreenSaverState.SCREEN_SAVER_OFF, () => undefined, () => undefined);
  } catch {
    // Older firmware without appcommon keeps the system screensaver.
  }
}
