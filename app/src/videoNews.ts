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
  thumbnail: { thumbnailUrl: { url: string } };
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
// sort by upload date; the empty params fallback keeps the call shape stable.
const SORT_RECENT = 'CAISAhAB';

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
      thumb: v.thumbnail?.thumbnailUrl?.url ?? '',
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
    params: SORT_RECENT,
  };
  const data = await fetchJsonPost<YtSearchResponse>(I1, body, 15000);
  const sections = data.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents ?? [];
  const out: NewsVideo[] = [];
  const seen = new Set<string>();
  outer: for (const sec of sections) {
    for (const item of sec.itemSectionRenderer?.contents ?? []) {
      const video = normalize(item);
      if (!video || !video.id || seen.has(video.id)) continue;
      // keep it "short-ish": under 10 minutes
      if (video.duration && !video.duration.includes(':00') && video.duration.length > 0) {
        const m = video.duration.match(/^(\d+):(\d{2})$/);
        if (m && parseInt(m[1], 10) >= 10) continue;
      }
      seen.add(video.id);
      out.push(video);
      if (out.length >= max) break outer;
    }
  }
  return out;
}

export function embedUrl(id: string): string {
  return `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&mute=0&rel=0&modestbranding=1`;
}
