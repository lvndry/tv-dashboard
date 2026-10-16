import type { NewsFeed, NewsSection } from './configTypes';
import { fetchText } from './net';

export interface Story {
  id: string;
  title: string;
  link: string;
  source: string;
  section: NewsSection;
  published: number;
  summary: string;
  image?: string;
}

function hash(text: string): string {
  let value = 5381;
  for (let index = 0; index < text.length; index++) value = (value * 33) ^ text.charCodeAt(index);
  return (value >>> 0).toString(36);
}

const htmlParser = new DOMParser();

/** Feeds double-escape entities and embed markup in descriptions; this flattens both. */
function plainText(raw: string): string {
  const withBreaks = raw.replace(/<br\s*\/?>/gi, ' ').replace(/<\/p>/gi, ' ');
  const text = htmlParser.parseFromString(withBreaks, 'text/html').body.textContent ?? '';
  const decoded = /&[#a-z0-9]+;/i.test(text) ? htmlParser.parseFromString(text, 'text/html').body.textContent ?? text : text;
  return decoded.replace(/\s+/g, ' ').trim();
}

function childrenNamed(parent: Element, localName: string): Element[] {
  return Array.from(parent.children).filter(child => child.localName === localName);
}

function childText(parent: Element, ...localNames: string[]): string {
  for (const name of localNames) {
    const match = childrenNamed(parent, name)[0];
    if (match?.textContent) return match.textContent.trim();
  }
  return '';
}

function imageFor(item: Element): string | undefined {
  const candidates: { url: string; width: number }[] = [];
  for (const node of [...childrenNamed(item, 'content'), ...childrenNamed(item, 'thumbnail')]) {
    const url = node.getAttribute('url');
    const medium = node.getAttribute('medium') ?? '';
    const type = node.getAttribute('type') ?? '';
    if (url && (medium === 'image' || type.startsWith('image') || (!medium && !type))) {
      candidates.push({ url, width: Number(node.getAttribute('width') ?? 0) });
    }
  }
  for (const group of childrenNamed(item, 'group')) {
    const thumbnail = childrenNamed(group, 'thumbnail')[0]?.getAttribute('url');
    if (thumbnail) candidates.push({ url: thumbnail, width: 0 });
  }
  for (const enclosure of childrenNamed(item, 'enclosure')) {
    const url = enclosure.getAttribute('url');
    if (url && (enclosure.getAttribute('type') ?? '').startsWith('image')) candidates.push({ url, width: 0 });
  }
  if (candidates.length) return candidates.sort((first, second) => second.width - first.width)[0]!.url;
  const encoded = childText(item, 'encoded') || childText(item, 'description');
  return encoded.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1];
}

function linkFor(item: Element): string {
  const atomLink = childrenNamed(item, 'link').find(link => link.getAttribute('href') && (link.getAttribute('rel') ?? 'alternate') === 'alternate');
  return atomLink?.getAttribute('href') ?? childText(item, 'link');
}

export async function fetchFeed(feed: NewsFeed): Promise<Story[]> {
  const xml = await fetchText(feed.url);
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('not a valid feed');
  const items = Array.from(doc.querySelectorAll('item, entry'));
  const stories: Story[] = [];
  for (const item of items.slice(0, 25)) {
    const title = plainText(childText(item, 'title'));
    const link = linkFor(item);
    if (!title || !link) continue;
    const published = Date.parse(childText(item, 'pubDate', 'published', 'updated', 'date'));
    stories.push({
      id: hash(link),
      title,
      link,
      source: feed.name,
      section: feed.section,
      published: Number.isFinite(published) ? published : Date.now(),
      summary: plainText(childText(item, 'description', 'summary')).slice(0, 600),
      image: imageFor(item),
    });
  }
  return stories;
}

function titleKey(title: string): string {
  return title.toLowerCase().normalize('NFD').replace(/[^a-z0-9 ]/g, '').split(' ').slice(0, 8).join(' ');
}

/** One list, newest first, with the same article from overlapping feeds kept once. */
export function mergeStories(lists: Story[][], maxAgeMs = 3 * 86400000, now: number = Date.now()): Story[] {
  const seenLinks = new Set<string>();
  const seenTitles = new Set<string>();
  const merged: Story[] = [];
  for (const story of lists.flat().sort((first, second) => second.published - first.published)) {
    const key = titleKey(story.title);
    if (seenLinks.has(story.id) || seenTitles.has(key) || now - story.published > maxAgeMs) continue;
    seenLinks.add(story.id);
    seenTitles.add(key);
    merged.push(story);
  }
  return merged;
}
