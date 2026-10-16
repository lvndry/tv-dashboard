// Fresh short videos on current news topics, from YouTube (InnerTube search,
// sorted by upload date, vertical-only). No API key: the public i1 endpoint
// with a WEB client context works over plain HTTPS.

import { fetchJsonPost } from './net';

export interface NewsVideo {
  id: string;
  title: string;
  channel: string;
  duration: string;
  published: string;
  thumb: string;
}

interface Runs { readonly runs?: { readonly text?: string }[] }
interface VideoRenderer {
  videoId: string;
  title: Runs;
  lengthText: { simpleText?: string };
  publishedTimeText: { simpleText?: string };
  ownerText: Runs;
  thumbnail: { thumbnails?: { url: string }[] };
}
interface ShortsLockup {
  onTap: { innertubeCommand: { reelWatchEndpoint: { videoId: string } } };
  overlayMetadata: { primaryText: { content: string } };
  thumbnail: { image: { thumbnailUrl: { url: string } } };
}
interface SearchItem { videoRenderer?: VideoRenderer; shortsLockupViewModel?: ShortsLockup }
interface YtSearchResponse {
  contents: {
    twoColumnSearchResultsRenderer?: {
      primaryContents?: { sectionListRenderer?: { contents: { itemSectionRenderer?: { contents: SearchItem[] } }[] } };
    };
  };
}

const I1 = 'https://www.youtube.com/youtubei/v1/search?prettyPrint=false';
// Search filters, protobuf-encoded: sort by upload date, uploaded this week, videos only.
// YouTube has no 48-hour filter, so results are narrowed further from their upload time.
const RECENT_THIS_WEEK = 'CAISBAgDEAE=';
const MAX_AGE_HOURS = 48;

const unitHours: [RegExp, number][] = [
  [/(seconde|second|minute)/i, 0],
  [/(heure|hour)/i, 1],
  [/(jour|day)/i, 24],
  [/(semaine|week)/i, 24 * 7],
  [/(mois|month)/i, 24 * 30],
  [/(an|year)/i, 24 * 365],
];

/** "il y a 5 heures", "Diffusé il y a 2 jours", "3 hours ago" → hours; null when there's no time. */
export function ageInHours(published: string): number | null {
  const match = published.match(/(\d+)\s*([a-zéû]+)/i);
  if (!match) return null;
  const unit = unitHours.find(([pattern]) => pattern.test(match[2]!));
  return unit ? Number(match[1]) * unit[1] : null;
}

function text(runs: Runs): string {
  return (runs.runs ?? []).map((r) => r.text ?? '').join('');
}

function normalize(item: SearchItem): NewsVideo | null {
  const v = item.videoRenderer;
  if (v) {
    return {
      id: v.videoId,
      title: text(v.title),
      channel: text(v.ownerText),
      duration: v.lengthText?.simpleText ?? '',
      published: v.publishedTimeText?.simpleText ?? '',
      thumb: v.thumbnail?.thumbnails?.[v.thumbnail.thumbnails.length - 1]?.url ?? `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
    };
  }
  const s = item.shortsLockupViewModel;
  if (s) {
    return {
      id: s.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId ?? '',
      title: s.overlayMetadata?.primaryText?.content ?? '',
      channel: 'Short',
      duration: 'short',
      published: '',
      thumb: s.thumbnail?.image?.thumbnailUrl?.url ?? '',
    };
  }
  return null;
}

export async function freshNewsVideos(query: string, max = 4): Promise<NewsVideo[]> {
  const body = {
    context: { client: { clientName: 'WEB', clientVersion: '2.20240101.00.00', hl: 'fr', gl: 'FR' } },
    query,
    params: RECENT_THIS_WEEK,
  };
  const data = await fetchJsonPost<YtSearchResponse>(I1, body, 15000);
  const sections = data.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents ?? [];
  const out: NewsVideo[] = [];
  const seen = new Set<string>();
  outer: for (const sec of sections) {
    for (const item of sec.itemSectionRenderer?.contents ?? []) {
      const video = normalize(item);
      if (!video || !video.id || seen.has(video.id)) continue;
      // Only the last 48 hours; anything without an upload time (Shorts, live) can't be checked, so it's left out.
      const age = ageInHours(video.published);
      if (age === null || age > MAX_AGE_HOURS) continue;
      // keep it "short-ish": under 10 minutes
      const parts = video.duration.split(':').map(Number);
      const minutes = parts.length === 3 ? parts[0]! * 60 + parts[1]! : parts.length === 2 ? parts[0]! : 0;
      if (minutes >= 10) continue;
      seen.add(video.id);
      out.push(video);
      if (out.length >= max) break outer;
    }
  }
  return out;
}

/** Several news searches merged, newest first, so the 48-hour window still fills the tab. */
export async function latestNewsVideos(queries: string[], max = 8): Promise<NewsVideo[]> {
  const results = await Promise.allSettled(queries.map(query => freshNewsVideos(query, max)));
  const byId = new Map<string, NewsVideo>();
  for (const result of results) if (result.status === 'fulfilled') for (const video of result.value) byId.set(video.id, video);
  if (!byId.size && results.every(result => result.status === 'rejected')) throw new Error('YouTube unreachable');
  return [...byId.values()].sort((first, second) => (ageInHours(first.published) ?? 99) - (ageInHours(second.published) ?? 99)).slice(0, max);
}

export function embedUrl(id: string): string {
  return `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&mute=0&rel=0&modestbranding=1`;
}
