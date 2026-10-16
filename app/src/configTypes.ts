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
  target: 'news' | 'whatson' | 'gallery' | 'settings';
}

export type RackEntry = AppEntry | InputEntry | ShortcutEntry;

export type Region = 'Africa' | 'Asia' | 'Middle East' | 'Europe' | 'Americas & Oceania' | 'Egypt' | 'Greece & Rome';

/** A museum whose collection is catalogued on Wikidata. */
export interface ArtMuseum {
  name: string;
  city: string;
  /** Wikidata id of the museum, for example Q19675 for the Louvre. */
  wikidata: string;
  /** Minimum number of Wikipedia articles about a work, to keep only notable pieces from huge collections. */
  minSitelinks: number;
  /** Region for works whose culture or country isn't recorded. Defaults to Europe. */
  region?: Region;
  /** Most works to take from this museum. Defaults to 400. */
  limit?: number;
}

export interface ArtConfig {
  /** Earliest year shown; negative years are BCE. -3500 starts at early Egypt and Mesopotamia. */
  from: number;
  /** Latest year shown; 1850 stops at Romanticism. */
  until: number;
  museums: ArtMuseum[];
  /** Famous Egyptian tombs and pyramids, photographed inside and out. */
  egyptianTombs: boolean;
  /** Works from African cultures held in any museum, found through Wikidata. Defaults to true. */
  africanCultures?: boolean;
  /**
   * Later end years for some regions. Traditional African and Oceanic works in museums are
   * mostly 19th and early 20th century, so a European cut-off would leave them out. Defaults to 1920 for both.
   */
  regionUntil?: Partial<Record<Region, number>>;
  /** How often each region comes up in ambient mode, relative to the others. */
  regionWeights?: Partial<Record<Region, number>>;
  /** The Met's curated highlights from these department ids, or null to skip the Met. */
  metDepartments: number[] | null;
  /** Highlights from the Cleveland Museum of Art's open-access collection. */
  cleveland: boolean;
  /** ChatGPT model that tells each work's story in the gallery; a small, cheap one is plenty. Defaults to gpt-6-luna. */
  storyModel?: string;
}

export interface SportsConfig {
  /** ESPN league ids, for example fra.1 (Ligue 1), eng.1 (Premier League), esp.1 (La Liga), uefa.champions. */
  leagues: { id: string; name: string }[];
  /** Your teams: their matches come first. Matched against team names, e.g. "Paris Saint-Germain". */
  teams: string[];
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
  /** Football fixtures and live scores. */
  sports: SportsConfig;
  /** The City of Paris's picks of the week's major events (Paris only). */
  parisEvents: boolean;
  /** Ambient mode shows public-domain art from these collections. */
  art: ArtConfig;
  brief: {
    /** Perplexity API key (pplx-…) that writes the daily letter. Never committed. */
    perplexityKey: string;
    /** Perplexity Agent-API model, e.g. perplexity/sonar. */
    perplexityModel: string;
    /** Language of the letter. */
    language: string;
    refreshMinutes: number;
  };
}

export function defineConfig(config: Config): Config {
  return config;
}
