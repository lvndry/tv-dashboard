export type NewsSection = 'France' | 'World' | 'Tech' | 'Culture' | 'Sport';

export interface NewsFeed {
  id: string;
  name: string;
  url: string;
  section: NewsSection;
}

/** An installed TV app, found by name at runtime so package ids aren't needed. */
export interface AppEntry {
  kind: 'app';
  id: string;
  name: string;
  dot: string;
  /** Matched case-insensitively against installed app names on the TV. */
  match: string[];
  /** Known Tizen app id, used when name matching finds nothing. */
  appId?: string;
}

/** An HDMI device such as a console. The port is chosen in the on-TV settings. */
export interface InputEntry {
  kind: 'input';
  id: string;
  name: string;
  dot: string;
}

/** A screen inside the dashboard itself. */
export interface ShortcutEntry {
  kind: 'shortcut';
  id: string;
  name: string;
  dot: string;
  target: 'news' | 'settings';
}

export type RackEntry = AppEntry | InputEntry | ShortcutEntry;

export interface Config {
  /** Used in the greeting ("Bonsoir, Sam."). Leave empty for a plain "Bonsoir." */
  name: string;
  /** Shown next to the weather. */
  place: string;
  latitude: number;
  longitude: number;
  /** IANA zone for the clock, whatever the TV's own setting. */
  timeZone: string;
  /** Left to right along the bottom of the home screen. */
  rack: RackEntry[];
  news: NewsFeed[];
  brief: {
    /** ChatGPT model used once the TV is connected in Settings. */
    model: string;
    language: string;
    refreshMinutes: number;
  };
}

export function defineConfig(config: Config): Config {
  return config;
}
