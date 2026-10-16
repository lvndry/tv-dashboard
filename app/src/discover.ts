// Perplexity Discover's public top-stories feed: the same stories, summaries, bullet points
// and images as perplexity.ai/discover. It's an internal endpoint with no key or login,
// so it can change without notice; the RSS feeds remain the fallback.

import { fetchJson } from './net';

export interface DiscoverStory {
  id: string;
  title: string;
  short: string;
  summary: string;
  description: string;
  bullets: string[];
  image: string;
  thumb: string;
  sourceCount: number;
  sourceHosts: string[];
  published: number;
  url: string;
}

interface DiscoverItem {
  uuid: string;
  slug?: string;
  title?: string;
  short_title?: string;
  summary?: string;
  description?: string;
  bullet_summary_preload?: string;
  featured_images?: { image?: string; thumbnail?: string }[];
  web_results_preview?: { total_count?: number; first_urls?: string[] };
  published_timestamp?: string;
  updated_datetime?: string;
}

const maxAgeMs = 48 * 3600000;

const hostOf = (url: string): string => {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
};

/** Markdown bullets with citation markers ("…, CBS News reported[4].") become plain lines. */
function bulletsFrom(markdown: string): string[] {
  return markdown
    .split('\n')
    .map(line => line.replace(/^\s*[-*]\s+/, '').replace(/\[\d+\]/g, '').trim())
    .filter(line => line.length > 20)
    .slice(0, 6);
}

/** Timestamps come without a zone and are UTC. */
const utc = (stamp: string | undefined): number => stamp ? Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(stamp) ? stamp : `${stamp}Z`) : NaN;

export async function fetchDiscover(now: number = Date.now()): Promise<DiscoverStory[]> {
  const result = await fetchJson<{ items?: DiscoverItem[] }>('https://www.perplexity.ai/rest/discover/feed?limit=40', 20000);
  return (result.items ?? []).flatMap(item => {
    const published = utc(item.published_timestamp ?? item.updated_datetime);
    if (!item.title || !Number.isFinite(published) || now - published > maxAgeMs) return [];
    const image = item.featured_images?.find(candidate => candidate.image);
    return [{
      id: item.uuid,
      title: item.title,
      short: item.short_title || item.title,
      summary: item.summary ?? '',
      description: item.description ?? '',
      bullets: bulletsFrom(item.bullet_summary_preload ?? ''),
      image: image?.image ?? '',
      thumb: image?.thumbnail ?? image?.image ?? '',
      sourceCount: item.web_results_preview?.total_count ?? 0,
      sourceHosts: Array.from(new Set((item.web_results_preview?.first_urls ?? []).map(hostOf).filter(Boolean))),
      published,
      url: item.slug ? `https://www.perplexity.ai/page/${item.slug}` : '',
    }];
  });
}
