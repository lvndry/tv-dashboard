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
  /** Tizen app id. When it's installed it wins over name matching. */
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

/** A museum whose collection is catalogued on Wikidata. */
export interface ArtMuseum {
  name: string;
  city: string;
  /** Wikidata id of the museum, for example Q19675 for the Louvre. */
  wikidata: string;
  /** Minimum number of Wikipedia articles about a work, to keep only notable pieces from huge collections. */
  minSitelinks: number;
}

export interface ArtConfig {
  /** Latest year shown; 1850 stops at Romanticism. */
  until: number;
  museums: ArtMuseum[];
  /** Famous Egyptian tombs and pyramids, photographed inside and out. */
  egyptianTombs: boolean;
  /** The Met's curated highlights from these department ids, or null to skip the Met. */
  metDepartments: number[] | null;
  /** Highlights from the Cleveland Museum of Art's open-access collection. */
  cleveland: boolean;
}

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
  /** Ambient mode shows public-domain art from these collections. */
  art: ArtConfig;
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
