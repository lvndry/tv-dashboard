// Reads a news article in the app. The page is fetched directly and its body rebuilt from
// paragraphs, subheadings, quotes and a few images, with all text inserted as text, so no
// markup from the site reaches the screen. r.jina.ai is only a fallback for pages that
// can't be read directly.

import { escapeHtml } from './dom';
import { fetchText } from './net';

type Block = { kind: 'p' | 'h' | 'quote'; text: string } | { kind: 'img'; src: string };

const junk = 'script, style, noscript, nav, header, footer, aside, form, button, iframe, svg, [aria-hidden="true"], [role="navigation"], [class*="share"], [class*="related"], [class*="newsletter"], [class*="advert"], [class*="cookie"], [class*="paywall"]';

const clean = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** The element holding the article: <article>, or the block with the most paragraph text. */
function articleRoot(doc: Document): Element {
  const marked = doc.querySelector('article [itemprop="articleBody"], [itemprop="articleBody"], article');
  if (marked && marked.querySelectorAll('p').length >= 3) return marked;
  let best: Element = doc.body;
  let bestScore = 0;
  for (const candidate of Array.from(doc.querySelectorAll('main, section, div'))) {
    const score = Array.from(candidate.children)
      .filter(child => child.tagName === 'P')
      .reduce((total, paragraph) => total + clean(paragraph.textContent ?? '').length, 0);
    if (score > bestScore) { bestScore = score; best = candidate; }
  }
  return best;
}

function imageSource(image: HTMLImageElement, base: string): string | null {
  const raw = image.getAttribute('data-src') ?? image.getAttribute('src') ?? image.getAttribute('srcset')?.split(/\s+/)[0] ?? '';
  if (!raw || raw.startsWith('data:')) return null;
  const width = Number(image.getAttribute('width') ?? 0);
  if (width && width < 300) return null;
  try { return new URL(raw, base).href; } catch { return null; }
}

export function extractArticle(html: string, url: string): Block[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll(junk).forEach(node => node.remove());
  const root = articleRoot(doc);
  const blocks: Block[] = [];
  let images = 0;
  for (const node of Array.from(root.querySelectorAll('p, h2, h3, blockquote, img'))) {
    if (node.closest('blockquote') && node.tagName !== 'BLOCKQUOTE') continue;
    if (node.tagName === 'IMG') {
      const src = imageSource(node as HTMLImageElement, url);
      if (src && images < 4) { blocks.push({ kind: 'img', src }); images++; }
      continue;
    }
    const text = clean(node.textContent ?? '');
    if (node.tagName === 'P' && text.length >= 40) blocks.push({ kind: 'p', text });
    else if ((node.tagName === 'H2' || node.tagName === 'H3') && text.length >= 4 && text.length < 160) blocks.push({ kind: 'h', text });
    else if (node.tagName === 'BLOCKQUOTE' && text.length >= 20) blocks.push({ kind: 'quote', text });
  }
  return blocks.slice(0, 60);
}

/** Fallback: markdown from r.jina.ai, split into blocks and stripped of links and markup. */
function blocksFromMarkdown(markdown: string): Block[] {
  const body = markdown.replace(/^(Title|URL Source|Published Time|Markdown Content):.*$/gm, '');
  const blocks: Block[] = [];
  for (const raw of body.split(/\n{2,}/)) {
    const image = raw.match(/^!\[[^\]]*\]\(([^)\s]+)\)/);
    if (image) { if (blocks.filter(block => block.kind === 'img').length < 4) blocks.push({ kind: 'img', src: image[1]! }); continue; }
    const text = clean(raw.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`>#]+/g, ''));
    if (raw.trim().startsWith('#') && text.length < 160) blocks.push({ kind: 'h', text });
    else if (text.length >= 60 && !/^https?:\/\//.test(text)) blocks.push({ kind: 'p', text });
  }
  return blocks.slice(0, 60);
}

export function blocksToHtml(blocks: Block[]): string {
  return blocks.map(block => {
    if (block.kind === 'img') return `<div class="rimgwrap"><img class="rimg" src="${escapeHtml(block.src)}" alt="" loading="lazy" referrerpolicy="no-referrer"></div>`;
    if (block.kind === 'h') return `<h3>${escapeHtml(block.text)}</h3>`;
    if (block.kind === 'quote') return `<blockquote>${escapeHtml(block.text)}</blockquote>`;
    return `<p>${escapeHtml(block.text)}</p>`;
  }).join('');
}

export async function readArticle(url: string): Promise<string> {
  try {
    const blocks = extractArticle(await fetchText(url, 20000), url);
    if (blocks.filter(block => block.kind === 'p').length >= 3) return blocksToHtml(blocks);
  } catch {
    // Fall through to the reader service below.
  }
  const blocks = blocksFromMarkdown(await fetchText(`https://r.jina.ai/${encodeURIComponent(url)}`, 20000));
  if (!blocks.some(block => block.kind === 'p')) throw new Error('nothing readable on the page');
  return blocksToHtml(blocks);
}
