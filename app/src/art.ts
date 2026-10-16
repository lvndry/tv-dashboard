// Public-domain art for ambient mode and the gallery, from ancient Egypt to Romanticism, balanced
// across the world's regions rather than by how many museums each region has.
//
// Sources: Wikidata for museums without open APIs and for African works held anywhere, Egyptian
// tombs, the Met's open-access collection by department, and Cleveland's by department. Each
// source is cached in IndexedDB and refreshed on its own, one at a time, so the TV never does one
// large burst. The Met keeps only object ids until a work is about to be shown.

import { config } from '../config';
import type { ArtMuseum, Region } from './configTypes';
import { readBig, writeBig } from './bigCache';
import { reportStatus } from './data';
import { fetchJson } from './net';
import { readCache, writeCache } from './store';

export type { Region };

export const regions: Region[] = ['Africa', 'Asia', 'Middle East', 'Egypt', 'Greece & Rome', 'Europe', 'Americas & Oceania'];

const defaultWeights: Record<Region, number> = {
  Africa: 1, Asia: 1, Europe: 1, Egypt: 0.8, 'Greece & Rome': 0.7, 'Middle East': 0.7, 'Americas & Oceania': 0.4,
};

export interface Artwork {
  id: string;
  title: string;
  maker: string;
  date: string;
  year: number | null;
  place: string;
  image: string;
  thumb: string;
  group: string;
  region: Region;
}

interface SourceState {
  savedAt: number;
  works: Artwork[];
  /** Met object ids, resolved only when one is about to be shown. */
  metIds?: number[];
  region?: Region;
  group?: string;
}

interface Source {
  key: string;
  label: string;
  load: () => Promise<SourceState>;
}

const sourceMaxAgeMs = 7 * 86400000;

const defaultRegionUntil: Partial<Record<Region, number>> = { Africa: 1920, 'Americas & Oceania': 1920 };

/** Latest year shown for a region: later for traditions whose museum pieces are mostly recent. */
function untilFor(region: Region | undefined): number {
  const override = region ? ({ ...defaultRegionUntil, ...config.art.regionUntil })[region] : undefined;
  return override ?? config.art.until;
}
const recentLimit = 300;
const message = (error: unknown): string => error instanceof Error ? error.message : String(error);

const states = new Map<string, SourceState>();
let metWorks: Artwork[] = [];
const recent: string[] = readCache<string[]>('art-recent')?.value ?? [];

function yearLabel(year: number): string {
  return year < 0 ? `${-year} BCE` : String(year);
}

/** Wikidata labels from museum imports often end in an inventory number ("Ife head-73.1996.1.4"). */
function cleanTitle(label: string): string {
  const trimmed = label
    .replace(/\s*\([A-Z]{1,4}\.?\s*[\d.,\s/]+\)$/, '')
    .replace(/\s*[-–]\s*[A-Z]{0,4}\s*\d[\d.\s]*$/, '')
    .replace(/\s+\d{2,}(\.\d+){2,}$/, '')
    .trim();
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function readableLabel(value: string | undefined): string {
  if (!value || /^(https?:|_:|t\d+$)/.test(value) || /^Q\d+$/.test(value)) return '';
  const withoutPrefix = value.replace(/^culture of (the )?/i, '');
  return withoutPrefix.charAt(0).toUpperCase() + withoutPrefix.slice(1);
}

interface SparqlRow { [name: string]: { value: string } | undefined }

async function sparql(query: string): Promise<SparqlRow[]> {
  const url = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`;
  const result = await fetchJson<{ results: { bindings: SparqlRow[] } }>(url, 60000);
  return result.results.bindings;
}

/** Wikidata images are sometimes plans or maps rather than photographs of the work. */
const notArtwork = /(\.svg$|plan|map|diagram|layout|schema|drawing of)/i;

function commonsImage(filePath: string, width = 1920): string | null {
  if (notArtwork.test(decodeURIComponent(filePath.split('/').pop() ?? ''))) return null;
  return `${filePath.replace(/^http:/, 'https:')}?width=${width}`;
}

/** First year mentioned in a free-text date such as "c. 500 BCE" or "1715–16". */
function yearFrom(text: string): number | null {
  const match = text.match(/(\d{1,4})(?:\s*[-–]\s*\d{1,4})?\s*(BCE|BC|B\.C\.)?/i);
  if (!match) return null;
  const year = Number(match[1]);
  return match[2] ? -year : year;
}

const qid = (uri: string | undefined): string => (uri ?? '').split('/').pop() ?? '';

const egypt = new Set(['Q79', 'Q11768', 'Q2429253']);
const classicalWorld = new Set(['Q11772', 'Q41', 'Q1747689', 'Q2277', 'Q17167', 'Q12544', 'Q38']);
const middleEast = new Set(['Q796', 'Q794', 'Q858', 'Q43', 'Q801', 'Q810', 'Q822', 'Q851', 'Q805', 'Q11767', 'Q5684', 'Q41137', 'Q842', 'Q12560']);
const continents: Record<string, Region> = {
  Q15: 'Africa', Q48: 'Asia', Q46: 'Europe', Q49: 'Americas & Oceania', Q18: 'Americas & Oceania', Q828: 'Americas & Oceania', Q538: 'Americas & Oceania', Q55643: 'Americas & Oceania',
};

/** Department and culture names that give a region away ("Department of Egyptian Antiquities"). */
const labelRegions: [RegExp, Region][] = [
  [/egypt|sudan|nubia|coptic/i, 'Egypt'],
  [/greek|greece|\broman\b|\brome\b|etruscan|hellenistic|classical antiquit/i, 'Greece & Rome'],
  [/near east|middle east|islamic|mesopotam|persia|iran|assyria|babylon|sumer|levant|anatolia|oriental antiquit/i, 'Middle East'],
  [/asia|china|chinese|japan|korea|india|tibet|nepal|khmer|vietnam|thai|indonesia|buddhis/i, 'Asia'],
  [/africa|\bbenin\b|yoruba|\bife\b|kongo|congo|ashanti|\bakan\b|dogon|bamana|baule|\bedo\b|\bnok\b/i, 'Africa'],
  [/oceania|pacific|polynesia|melanesia|maori|americas|maya|aztec|inca|andean|mesoamerica|native american/i, 'Americas & Oceania'],
];

/** A work's region from its country of origin, its department or culture, the date for classical antiquity, or else the museum's own region. */
function regionOf(origins: string[], continentIds: string[], year: number | null, fallback: Region, labels: string[] = []): Region {
  if (origins.some(origin => egypt.has(origin))) return 'Egypt';
  if (origins.some(origin => classicalWorld.has(origin)) && (year === null || year < 600)) return 'Greece & Rome';
  if (origins.some(origin => middleEast.has(origin))) return 'Middle East';
  const text = labels.join(' · ');
  const byLabel = labelRegions.find(([pattern]) => pattern.test(text))?.[1];
  if (byLabel) return byLabel;
  const continent = continentIds.map(id => continents[id]).find(Boolean);
  if (continent === 'Europe' && year !== null && year < 500) return 'Greece & Rome';
  return continent ?? fallback;
}

/** Wikidata returns one row per value combination; this folds them back into one work each. */
interface Folded { row: SparqlRow; origins: string[]; continents: string[]; labels: string[] }

function foldRows(rows: SparqlRow[]): Folded[] {
  const byItem = new Map<string, { row: SparqlRow; origins: Set<string>; continents: Set<string>; labels: Set<string> }>();
  for (const row of rows) {
    const id = row.item?.value ?? '';
    if (!id) continue;
    const entry = byItem.get(id) ?? { row, origins: new Set<string>(), continents: new Set<string>(), labels: new Set<string>() };
    if (row.origin) entry.origins.add(qid(row.origin.value));
    if (row.continent) entry.continents.add(qid(row.continent.value));
    for (const field of ['departmentLabel', 'cultureLabel', 'originLabel']) {
      const label = row[field]?.value;
      if (label && !/^Q\d+$/.test(label)) entry.labels.add(label);
    }
    byItem.set(id, entry);
  }
  return [...byItem.values()].map(entry => ({ row: entry.row, origins: [...entry.origins], continents: [...entry.continents], labels: [...entry.labels] }));
}

function workFromRow(folded: Folded, place: string, group: string, fallback: Region): Artwork | null {
  const { row } = folded;
  const title = cleanTitle(readableLabel(row.itemLabel?.value));
  const image = row.image ? commonsImage(row.image.value) : null;
  if (!title || !image) return null;
  const inception = row.inception?.value ?? '';
  const year = inception ? Number(inception.slice(0, inception.startsWith('-') ? 5 : 4)) : NaN;
  const knownYear = Number.isFinite(year) ? year : null;
  return {
    id: `wd:${qid(row.item!.value)}`,
    title,
    maker: readableLabel(row.creatorLabel?.value) || readableLabel(row.cultureLabel?.value),
    date: knownYear === null ? '' : yearLabel(knownYear),
    year: knownYear,
    place,
    image,
    thumb: commonsImage(row.image!.value, 480) ?? image,
    group,
    region: regionOf(folded.origins, folded.continents, knownYear, fallback, folded.labels),
  };
}

const periodFilter = (until: number = config.art.until): string =>
  `OPTIONAL { ?item wdt:P571 ?inception } FILTER(!BOUND(?inception) || (YEAR(?inception) >= ${config.art.from} && YEAR(?inception) <= ${until}))`;

const originFields = 'OPTIONAL { ?item wdt:P495 ?origin . OPTIONAL { ?origin wdt:P30 ?continent } }';

async function museumWorks(museum: ArtMuseum): Promise<Artwork[]> {
  const rows = await sparql(`SELECT ?item ?itemLabel ?creatorLabel ?cultureLabel ?departmentLabel ?originLabel ?image ?inception ?origin ?continent WHERE {
    { ?item wdt:P195 wd:${museum.wikidata} } UNION { ?collection wdt:P361 wd:${museum.wikidata} . ?item wdt:P195 ?collection }
    ?item wikibase:sitelinks ?links . FILTER(?links >= ${museum.minSitelinks})
    ?item wdt:P18 ?image .
    ${periodFilter(untilFor(museum.region))}
    ${originFields}
    OPTIONAL { ?item wdt:P195 ?department }
    OPTIONAL { ?item wdt:P170 ?creator }
    OPTIONAL { ?item wdt:P2596 ?culture }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en,fr". }
  } ORDER BY DESC(?links) LIMIT ${(museum.limit ?? 400) * 3}`);
  return foldRows(rows).slice(0, museum.limit ?? 400).flatMap(folded => workFromRow(folded, `${museum.name}, ${museum.city}`, museum.name, museum.region ?? 'Europe') ?? []);
}

/** Sculpture, masks and other works from African cultures, held in any museum. */
async function africanWorks(): Promise<Artwork[]> {
  const rows = await sparql(`SELECT ?item ?itemLabel ?creatorLabel ?cultureLabel ?originLabel ?image ?inception ?collectionLabel ?origin WHERE {
    VALUES ?type { wd:Q860861 wd:Q161524 wd:Q3305213 wd:Q1066288 wd:Q15711026 wd:Q11060274 }
    ?item wdt:P31 ?type; wdt:P18 ?image .
    { ?item wdt:P495 ?origin } UNION { ?item wdt:P2596 ?culture . ?culture wdt:P17 ?origin }
    ?origin wdt:P30 wd:Q15 . FILTER(?origin NOT IN (wd:Q79, wd:Q11768, wd:Q2429253))
    FILTER NOT EXISTS { ?origin wdt:P30 wd:Q46 }
    ${periodFilter(untilFor('Africa'))}
    OPTIONAL { ?item wdt:P195 ?collection }
    OPTIONAL { ?item wdt:P170 ?creator }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en,fr". }
  } LIMIT 1200`);
  // Ancient Egyptian works are covered by the Egyptian collections; anything that reads as Egyptian is left to them.
  return foldRows(rows).flatMap(folded => {
    const collection = readableLabel(folded.row.collectionLabel?.value);
    const work = workFromRow({ ...folded, continents: ['Q15'] }, collection || 'African collections', collection || 'African collections', 'Africa');
    return work && work.region === 'Africa' ? [work] : [];
  });
}

async function egyptianTombs(): Promise<Artwork[]> {
  const rows = await sparql(`SELECT ?item ?itemLabel ?image ?placeLabel WHERE {
    ?item wdt:P31/wdt:P279* wd:Q381885; wdt:P17 wd:Q79; wdt:P18 ?image; wikibase:sitelinks ?links . FILTER(?links >= 10)
    OPTIONAL { ?item wdt:P131 ?place }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en,fr". }
  } ORDER BY DESC(?links) LIMIT 120`);
  return foldRows(rows).flatMap(({ row }) => {
    const title = cleanTitle(readableLabel(row.itemLabel?.value));
    const image = row.image ? commonsImage(row.image.value) : null;
    if (!title || !image) return [];
    const place = readableLabel(row.placeLabel?.value);
    return [{
      id: `wd:${qid(row.item!.value)}`, title, maker: 'Ancient Egypt', date: '', year: null,
      place: place ? `${place}, Egypt` : 'Egypt', image, thumb: commonsImage(row.image!.value, 480) ?? image,
      group: 'Egyptian tombs', region: 'Egypt' as Region,
    }];
  });
}

const metBase = 'https://collectionapi.metmuseum.org/public/collection/v1';
const metSearchBase = 'https://collectionapi.metmuseum.org/public/collection/v1.1';

/** Met departments and the region each stands for; the Africa/Oceania/Americas wing is split by place. */
const metDepartments: { id: number; region: Region; geo?: string }[] = [
  { id: 5, region: 'Africa', geo: 'Africa' }, { id: 5, region: 'Americas & Oceania', geo: 'Oceania' },
  { id: 6, region: 'Asia' }, { id: 14, region: 'Middle East' }, { id: 3, region: 'Middle East' },
  { id: 10, region: 'Egypt' }, { id: 13, region: 'Greece & Rome' },
  { id: 11, region: 'Europe' }, { id: 12, region: 'Europe' }, { id: 17, region: 'Europe' },
];

async function metSearch(params: string, limit: number, offset = 0, until: number = config.art.until): Promise<{ total: number; ids: number[] }> {
  const result = await fetchJson<{ total: number; objectIDs: number[] | null }>(
    `${metSearchBase}/search?${params}&hasImages=true&dateBegin=${config.art.from}&dateEnd=${until}&q=*&limit=${limit}&offset=${offset}`);
  return { total: result.total, ids: result.objectIDs ?? [] };
}

/** The department's curated highlights plus a random slice of everything else. */
async function metDepartmentIds(department: { id: number; geo?: string; region: Region }): Promise<number[]> {
  const params = `departmentId=${department.id}${department.geo ? `&geoLocation=${department.geo}` : ''}`;
  const until = untilFor(department.region);
  const highlights = await metSearch(`${params}&isHighlight=true`, 200, 0, until).catch(() => ({ total: 0, ids: [] as number[] }));
  const first = await metSearch(params, 1, 0, until);
  const sample = first.total > 600 ? Math.floor(Math.random() * (first.total - 600)) : 0;
  const slice = await metSearch(params, 600, sample, until);
  return Array.from(new Set([...highlights.ids, ...slice.ids]));
}

interface MetObject { title: string; artistDisplayName: string; culture: string; objectDate: string; objectBeginDate: number; objectEndDate: number; isPublicDomain: boolean; primaryImage: string; primaryImageSmall: string }

async function metWork(id: number, region: Region): Promise<Artwork | null> {
  const object = await fetchJson<MetObject>(`${metBase}/objects/${id}`);
  if (!object.isPublicDomain || !object.primaryImage || object.objectEndDate > untilFor(region) || object.objectBeginDate < config.art.from) return null;
  const work: Artwork = {
    id: `met:${id}`, title: object.title, maker: object.artistDisplayName || object.culture, date: object.objectDate,
    year: object.objectBeginDate, place: 'The Met, New York', image: object.primaryImage,
    thumb: object.primaryImageSmall || object.primaryImage, group: 'The Met', region,
  };
  if (!metWorks.some(known => known.id === work.id)) {
    metWorks.push(work);
    void writeBig('art-met-works', metWorks);
  }
  return work;
}

/** Cleveland departments and their regions. */
const clevelandDepartments: { name: string; region: Region }[] = [
  { name: 'African Art', region: 'Africa' },
  { name: 'Chinese Art', region: 'Asia' }, { name: 'Japanese Art', region: 'Asia' },
  { name: 'Indian and Southeast Asian Art', region: 'Asia' }, { name: 'Korean Art', region: 'Asia' },
  { name: 'Islamic Art', region: 'Middle East' }, { name: 'Egyptian and Ancient Near Eastern Art', region: 'Egypt' },
  { name: 'Greek and Roman Art', region: 'Greece & Rome' },
  { name: 'European Painting and Sculpture', region: 'Europe' }, { name: 'Medieval Art', region: 'Europe' },
];

interface ClevelandArtwork { id: number; title: string; creators: { description: string }[]; culture: string[]; creation_date: string; images: { web?: { url: string } } }

async function clevelandDepartment(department: { name: string; region: Region }): Promise<Artwork[]> {
  const base = `https://openaccess-api.clevelandart.org/api/artworks/?cc0=1&has_image=1&department=${encodeURIComponent(department.name)}&created_after=${config.art.from}&created_before=${untilFor(department.region)}`;
  const first = await fetchJson<{ info: { total: number } }>(`${base}&limit=1`);
  // Small departments are taken whole; large ones contribute a random slice that changes each refresh.
  const size = Math.min(first.info.total, 400);
  const skip = first.info.total > size ? Math.floor(Math.random() * (first.info.total - size)) : 0;
  const result = await fetchJson<{ data: ClevelandArtwork[] }>(`${base}&limit=${size}&skip=${skip}`, 30000);
  return result.data.flatMap(work => {
    const image = work.images.web?.url;
    if (!image) return [];
    return [{
      id: `cma:${work.id}`, title: work.title,
      maker: work.creators[0]?.description.split(' (')[0] ?? work.culture[0] ?? '',
      date: work.creation_date, year: yearFrom(work.creation_date), place: 'Cleveland Museum of Art',
      image, thumb: image, group: 'Cleveland', region: department.region,
    }];
  });
}

function sources(): Source[] {
  const art = config.art;
  const list: Source[] = art.museums.map(museum => ({
    key: `wd:${museum.wikidata}`,
    label: museum.name,
    load: async () => ({ savedAt: Date.now(), works: await museumWorks(museum) }),
  }));
  if (art.egyptianTombs) list.push({ key: 'wd:tombs', label: 'Egyptian tombs', load: async () => ({ savedAt: Date.now(), works: await egyptianTombs() }) });
  if (art.africanCultures !== false) list.push({ key: 'wd:african-cultures', label: 'African cultures', load: async () => ({ savedAt: Date.now(), works: await africanWorks() }) });
  if (art.metDepartments) {
    for (const department of metDepartments.filter(item => art.metDepartments!.includes(item.id))) {
      list.push({
        key: `met:${department.id}:${department.region}`,
        label: `The Met · ${department.region}`,
        load: async () => ({ savedAt: Date.now(), works: [], metIds: await metDepartmentIds(department), region: department.region, group: 'The Met' }),
      });
    }
  }
  if (art.cleveland) {
    for (const department of clevelandDepartments) {
      list.push({ key: `cma:${department.name}`, label: `Cleveland · ${department.name}`, load: async () => ({ savedAt: Date.now(), works: await clevelandDepartment(department) }) });
    }
  }
  return list;
}

let loaded: Promise<void> | null = null;

/** Reads every cached source from IndexedDB once. */
function loadCached(): Promise<void> {
  loaded ??= (async () => {
    // The collection used to live in localStorage; it moved to IndexedDB, so the old copies only take space.
    for (const name of ['art', 'art.v2', 'art.v3']) {
      try { localStorage.removeItem(`bonsoir.cache.${name}`); } catch { /* storage unavailable */ }
    }
    await Promise.all(sources().map(async source => {
      const state = await readBig<SourceState>(`art-source:${source.key}`).catch(() => null);
      if (state) states.set(source.key, state);
    }));
    metWorks = (await readBig<Artwork[]>('art-met-works').catch(() => null)) ?? [];
  })();
  return loaded;
}

function reportCollection(failures: string[]): void {
  const works = galleryWorks();
  const metIds = [...states.values()].reduce((total, state) => total + (state.metIds?.length ?? 0), 0);
  const counts = regions.map(region => `${region} ${works.filter(work => work.region === region).length}`).join(', ');
  reportStatus('art', {
    name: 'Art collection',
    ok: failures.length < sources().length,
    updatedAt: Date.now(),
    detail: `${works.length} works and ${metIds} Met objects (${counts})${failures.length ? `; ${failures.length} sources failed: ${failures.slice(0, 3).join(', ')}` : ''}`,
  });
}

let refreshing: Promise<void> | null = null;

/** Refreshes stale sources one at a time, pausing between them, so the TV stays responsive. */
export function refreshArt(force = false): Promise<void> {
  refreshing ??= (async () => {
    await loadCached();
    const failures: string[] = [];
    for (const source of sources()) {
      const state = states.get(source.key);
      if (!force && state && Date.now() - state.savedAt < sourceMaxAgeMs) continue;
      try {
        const fresh = await source.load();
        states.set(source.key, fresh);
        await writeBig(`art-source:${source.key}`, fresh);
      } catch (error) {
        failures.push(`${source.label} (${message(error)})`);
      }
      reportCollection(failures);
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    reportCollection(failures);
  })().finally(() => { refreshing = null; });
  return refreshing;
}

function remember(work: Artwork): void {
  recent.push(work.id);
  while (recent.length > recentLimit) recent.shift();
  writeCache('art-recent', recent);
}

const pickRandom = <T>(list: T[]): T | undefined => list[Math.floor(Math.random() * list.length)];

const favouritesCacheName = 'art-favourites';
let favourites: Artwork[] = readCache<Artwork[]>(favouritesCacheName)?.value ?? [];

export function favouriteWorks(): Artwork[] {
  return favourites;
}

export function isFavourite(work: Artwork): boolean {
  return favourites.some(favourite => favourite.id === work.id);
}

export function toggleFavourite(work: Artwork): boolean {
  favourites = isFavourite(work) ? favourites.filter(favourite => favourite.id !== work.id) : [work, ...favourites];
  writeCache(favouritesCacheName, favourites);
  return isFavourite(work);
}

/** Every resolved work once; when two sources share a work, the museum's own source (listed first) wins. */
export function galleryWorks(): Artwork[] {
  const byId = new Map<string, Artwork>();
  for (const source of sources()) {
    for (const work of states.get(source.key)?.works ?? []) if (!byId.has(work.id)) byId.set(work.id, work);
  }
  for (const work of metWorks) if (!byId.has(work.id)) byId.set(work.id, work);
  return [...byId.values()];
}

/** Ready-to-show works and unresolved Met ids, grouped by region and then by collection. */
function candidatesByRegion(): Map<Region, Map<string, (Artwork | { metId: number; region: Region })[]>> {
  const byRegion = new Map<Region, Map<string, (Artwork | { metId: number; region: Region })[]>>();
  const add = (region: Region, group: string, entry: Artwork | { metId: number; region: Region }): void => {
    const groups = byRegion.get(region) ?? new Map();
    const list = groups.get(group) ?? [];
    list.push(entry);
    groups.set(group, list);
    byRegion.set(region, groups);
  };
  for (const work of galleryWorks()) if (!recent.includes(work.id)) add(work.region, work.group, work);
  for (const state of states.values()) {
    if (!state.metIds || !state.region) continue;
    for (const metId of state.metIds) if (!recent.includes(`met:${metId}`)) add(state.region, 'The Met', { metId, region: state.region });
  }
  return byRegion;
}

/** Region first (by weight), then a collection, then a work; favourites come up about one time in four. */
async function candidate(): Promise<Artwork | null> {
  const freshFavourites = favourites.filter(work => !recent.includes(work.id));
  if (freshFavourites.length && Math.random() < 0.25) return pickRandom(freshFavourites) ?? null;
  const byRegion = candidatesByRegion();
  if (!byRegion.size) {
    recent.length = 0;
    return pickRandom(galleryWorks()) ?? null;
  }
  const weights = { ...defaultWeights, ...config.art.regionWeights };
  const available = [...byRegion.keys()];
  const total = available.reduce((sum, region) => sum + (weights[region] ?? 0), 0);
  let roll = Math.random() * total;
  const region = available.find(item => (roll -= weights[item] ?? 0) <= 0) ?? available[0]!;
  const groups = byRegion.get(region)!;
  const entry = pickRandom(groups.get(pickRandom([...groups.keys()])!) ?? []);
  if (!entry) return null;
  if ('metId' in entry) {
    recent.push(`met:${entry.metId}`);
    return metWork(entry.metId, entry.region).catch(() => null);
  }
  return entry;
}

function loadImage(url: string, timeoutMs = 30000): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timer = setTimeout(() => { image.src = ''; reject(new Error('image timed out')); }, timeoutMs);
    image.onload = () => { clearTimeout(timer); resolve({ width: image.naturalWidth, height: image.naturalHeight }); };
    image.onerror = () => { clearTimeout(timer); reject(new Error('image failed')); };
    image.referrerPolicy = 'no-referrer';
    image.src = url;
  });
}

export interface LoadedArtwork extends Artwork { width: number; height: number }

export async function loadArtwork(work: Artwork): Promise<LoadedArtwork> {
  return { ...work, ...(await loadImage(work.image)) };
}

/** Resolves once the cache is read, starting a refresh in the background if anything is stale. */
export async function artReady(): Promise<void> {
  await loadCached();
  void refreshArt();
}

/** An artwork whose image is already downloaded, or null when nothing loads. */
export async function nextArtwork(attempts = 6): Promise<LoadedArtwork | null> {
  await artReady();
  if (!galleryWorks().length && ![...states.values()].some(state => state.metIds?.length)) await refreshing;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const work = await candidate();
    if (!work) return null;
    try {
      const size = await loadImage(work.image);
      remember(work);
      return { ...work, ...size };
    } catch {
      recent.push(work.id);
    }
  }
  return null;
}
