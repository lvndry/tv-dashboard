// Public-domain art for ambient mode, from ancient Egypt to Romanticism.
// Wikidata covers the museums without open APIs (Louvre, British Museum, quai Branly, Cairo…)
// and Egyptian tombs; the Met and Cleveland add their curated open-access highlights.

import { config } from '../config';
import type { ArtMuseum } from './configTypes';
import { reportStatus } from './data';
import { fetchJson } from './net';
import { readCache, writeCache } from './store';

export interface Artwork {
  id: string;
  title: string;
  maker: string;
  date: string;
  place: string;
  image: string;
  group: string;
}

interface Pool {
  works: Artwork[];
  metIds: number[];
}

const poolMaxAgeMs = 7 * 86400000;
const recentLimit = 150;

let pool: Pool = readCache<Pool>('art')?.value ?? { works: [], metIds: [] };
let poolAt = readCache<Pool>('art')?.savedAt ?? 0;
let loading: Promise<void> | null = null;
const recent: string[] = readCache<string[]>('art-recent')?.value ?? [];

const message = (error: unknown): string => error instanceof Error ? error.message : String(error);

function yearLabel(year: number): string {
  return year < 0 ? `${-year} BCE` : String(year);
}

/** Wikidata labels from museum imports often end in an inventory number ("Ife head-73.1996.1.4"). */
function cleanTitle(label: string): string {
  const trimmed = label.replace(/\s*[-–]\s*[A-Z]{0,4}\s*\d[\d.\s]*$/, '').replace(/\s+\d{2,}(\.\d+){2,}$/, '').trim();
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function readableLabel(value: string | undefined): string {
  return value && !/^(https?:|_:|t\d+$)/.test(value) && !/^Q\d+$/.test(value) ? value : '';
}

interface SparqlRow { [name: string]: { value: string } | undefined }

async function sparql(query: string): Promise<SparqlRow[]> {
  const url = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`;
  const result = await fetchJson<{ results: { bindings: SparqlRow[] } }>(url, 60000);
  return result.results.bindings;
}

/** Wikidata images are sometimes plans or maps rather than photographs of the work. */
const notArtwork = /(\.svg$|plan|map|diagram|layout|schema|drawing of)/i;

function commonsImage(filePath: string): string | null {
  if (notArtwork.test(decodeURIComponent(filePath.split('/').pop() ?? ''))) return null;
  return `${filePath.replace(/^http:/, 'https:')}?width=1920`;
}

/** Wikidata returns one row per value combination; keep the first row per work. */
function uniqueRows(rows: SparqlRow[]): SparqlRow[] {
  const seen = new Set<string>();
  return rows.filter(row => {
    const id = row.item?.value ?? '';
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

async function museumWorks(museum: ArtMuseum): Promise<Artwork[]> {
  const rows = await sparql(`SELECT ?item ?itemLabel ?creatorLabel ?cultureLabel ?image ?inception WHERE {
    { ?item wdt:P195 wd:${museum.wikidata} } UNION { ?collection wdt:P361 wd:${museum.wikidata} . ?item wdt:P195 ?collection }
    ?item wikibase:sitelinks ?links . FILTER(?links >= ${museum.minSitelinks})
    ?item wdt:P18 ?image; wdt:P571 ?inception . FILTER(YEAR(?inception) <= ${config.art.until})
    OPTIONAL { ?item wdt:P170 ?creator }
    OPTIONAL { ?item wdt:P2596 ?culture }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en,fr". }
  } ORDER BY DESC(?links) LIMIT 150`);
  return uniqueRows(rows).flatMap(row => {
    const title = cleanTitle(readableLabel(row.itemLabel?.value));
    const image = row.image ? commonsImage(row.image.value) : null;
    if (!title || !image) return [];
    const year = Number((row.inception?.value ?? '').slice(0, row.inception?.value.startsWith('-') ? 5 : 4));
    return [{
      id: `wd:${row.item!.value.split('/').pop()}`,
      title,
      maker: readableLabel(row.creatorLabel?.value) || readableLabel(row.cultureLabel?.value),
      date: Number.isFinite(year) ? yearLabel(year) : '',
      place: `${museum.name}, ${museum.city}`,
      image,
      group: museum.name,
    }];
  });
}

async function egyptianTombs(): Promise<Artwork[]> {
  const rows = await sparql(`SELECT ?item ?itemLabel ?image ?placeLabel WHERE {
    ?item wdt:P31/wdt:P279* wd:Q381885; wdt:P17 wd:Q79; wdt:P18 ?image; wikibase:sitelinks ?links . FILTER(?links >= 10)
    OPTIONAL { ?item wdt:P131 ?place }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en,fr". }
  } ORDER BY DESC(?links) LIMIT 120`);
  return uniqueRows(rows).flatMap(row => {
    const title = cleanTitle(readableLabel(row.itemLabel?.value));
    const image = row.image ? commonsImage(row.image.value) : null;
    if (!title || !image) return [];
    const place = readableLabel(row.placeLabel?.value);
    return [{
      id: `wd:${row.item!.value.split('/').pop()}`,
      title,
      maker: 'Ancient Egypt',
      date: '',
      place: place ? `${place}, Egypt` : 'Egypt',
      image,
      group: 'Egyptian tombs',
    }];
  });
}

const metBase = 'https://collectionapi.metmuseum.org/public/collection/v1';
const metSearchBase = 'https://collectionapi.metmuseum.org/public/collection/v1.1';

async function metIds(departments: number[]): Promise<number[]> {
  const lists = await Promise.all(departments.map(department =>
    fetchJson<{ objectIDs: number[] | null }>(`${metSearchBase}/search?departmentId=${department}&hasImages=true&isHighlight=true&dateBegin=-4000&dateEnd=${config.art.until}&q=*&limit=200`)
      .then(result => result.objectIDs ?? [])));
  return Array.from(new Set(lists.flat()));
}

interface MetObject { objectID: number; title: string; artistDisplayName: string; culture: string; objectDate: string; objectEndDate: number; isPublicDomain: boolean; primaryImage: string }

async function metWork(id: number): Promise<Artwork | null> {
  const object = await fetchJson<MetObject>(`${metBase}/objects/${id}`);
  if (!object.isPublicDomain || !object.primaryImage || object.objectEndDate > config.art.until) return null;
  return {
    id: `met:${id}`,
    title: object.title,
    maker: object.artistDisplayName || object.culture,
    date: object.objectDate,
    place: 'The Met, New York',
    image: object.primaryImage,
    group: 'The Met',
  };
}

interface ClevelandArtwork { id: number; title: string; creators: { description: string }[]; culture: string[]; creation_date: string; images: { web?: { url: string } } }

async function clevelandWorks(): Promise<Artwork[]> {
  const result = await fetchJson<{ data: ClevelandArtwork[] }>(`https://openaccess-api.clevelandart.org/api/artworks/?cc0=1&has_image=1&highlight=1&created_before=${config.art.until}&limit=300`);
  return result.data.flatMap(work => {
    const image = work.images.web?.url;
    if (!image) return [];
    return [{
      id: `cma:${work.id}`,
      title: work.title,
      maker: work.creators[0]?.description.split(' (')[0] ?? work.culture[0] ?? '',
      date: work.creation_date,
      place: 'Cleveland Museum of Art',
      image,
      group: 'Cleveland',
    }];
  });
}

/** Wikidata asks clients to keep only a few queries in flight at once. */
async function settleInBatches<T>(jobs: (() => Promise<T>)[], concurrency: number): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(jobs.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < jobs.length) {
      const index = next++;
      try { results[index] = { status: 'fulfilled', value: await jobs[index]!() }; }
      catch (reason) { results[index] = { status: 'rejected', reason }; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
  return results;
}

async function buildPool(): Promise<void> {
  const art = config.art;
  const wikidataJobs: (() => Promise<Artwork[]>)[] = [
    ...art.museums.map(museum => () => museumWorks(museum)),
    ...(art.egyptianTombs ? [() => egyptianTombs()] : []),
  ];
  const [wikidata, met, cleveland] = await Promise.all([
    settleInBatches(wikidataJobs, 3),
    art.metDepartments ? metIds(art.metDepartments).then(ids => ({ ok: true as const, ids }), error => ({ ok: false as const, error })) : null,
    art.cleveland ? clevelandWorks().then(works => ({ ok: true as const, works }), error => ({ ok: false as const, error })) : null,
  ]);

  const works: Artwork[] = [];
  const failures = wikidata.filter(result => result.status === 'rejected');
  wikidata.forEach(result => { if (result.status === 'fulfilled') works.push(...result.value); });
  reportStatus('art:wikidata', {
    name: `Art · Wikidata (${art.museums.length} museums)`,
    ok: failures.length < wikidata.length,
    updatedAt: Date.now(),
    detail: failures.length ? `${works.length} works, ${failures.length} queries failed` : `${works.length} works`,
  });
  if (met) reportStatus('art:met', { name: 'Art · The Met', ok: met.ok, updatedAt: Date.now(), detail: met.ok ? `${met.ids.length} highlights` : message(met.error) });
  if (cleveland) {
    if (cleveland.ok) works.push(...cleveland.works);
    reportStatus('art:cleveland', { name: 'Art · Cleveland', ok: cleveland.ok, updatedAt: Date.now(), detail: cleveland.ok ? `${cleveland.works.length} works` : message(cleveland.error) });
  }

  const metIdsFound = met?.ok ? met.ids : [];
  if (works.length || metIdsFound.length) {
    pool = { works, metIds: metIdsFound };
    poolAt = Date.now();
    writeCache('art', pool, poolAt);
  }
}

export function refreshArt(force = false): Promise<void> {
  if (!force && poolAt && Date.now() - poolAt < poolMaxAgeMs) return Promise.resolve();
  loading ??= buildPool().finally(() => { loading = null; });
  return loading;
}

function remember(work: Artwork): void {
  recent.push(work.id);
  while (recent.length > recentLimit) recent.shift();
  writeCache('art-recent', recent);
}

const pickRandom = <T>(list: T[]): T | undefined => list[Math.floor(Math.random() * list.length)];

/** Picks a collection first, then a work, so a big collection doesn't crowd out the others. */
async function candidate(): Promise<Artwork | null> {
  const groups = new Map<string, Artwork[]>();
  for (const work of pool.works) {
    if (recent.includes(work.id)) continue;
    const list = groups.get(work.group) ?? [];
    list.push(work);
    groups.set(work.group, list);
  }
  const freshMet = pool.metIds.filter(id => !recent.includes(`met:${id}`));
  const choices = [...groups.keys(), ...(freshMet.length ? ['The Met'] : [])];
  const group = pickRandom(choices);
  if (!group) {
    recent.length = 0;
    return pool.works.length ? pickRandom(pool.works) ?? null : null;
  }
  if (group === 'The Met') {
    const id = pickRandom(freshMet)!;
    recent.push(`met:${id}`);
    return metWork(id).catch(() => null);
  }
  return pickRandom(groups.get(group) ?? []) ?? null;
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

/** Resolves to an artwork whose image is already downloaded, or null when nothing loads. */
export async function nextArtwork(attempts = 6): Promise<LoadedArtwork | null> {
  await refreshArt();
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
