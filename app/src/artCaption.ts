import type { Artwork } from './art';
import { isFavourite } from './art';
import type { ArtDetails } from './artDetails';
import { escapeHtml } from './dom';

/** Only works close to the screen's shape fill it; the rest are framed whole so nothing is cropped away. */
export function fillsScreen(width: number, height: number): boolean {
  const ratio = width / Math.max(1, height);
  return ratio > 1.5 && ratio < 2.0;
}

const sourceLine: Record<ArtDetails['storySource'], string> = {
  chatgpt: 'Told by ChatGPT from Wikipedia and the museum’s records',
  wikipedia: 'From Wikipedia',
  museum: 'From the museum’s description',
  record: 'From the museum’s records',
  '': '',
};

export function captionHtml(work: Artwork, details: ArtDetails | null, mode: 'ambient' | 'viewer'): string {
  const heart = mode === 'viewer' && isFavourite(work) ? ' <span class="heart">♥</span>' : '';
  const facts = mode === 'viewer' && details?.facts.length
    ? `<dl class="afacts">${details.facts.map(fact => `<dt>${escapeHtml(fact.label)}</dt><dd>${escapeHtml(fact.value)}</dd>`).join('')}</dl>`
    : '';
  const source = mode === 'viewer' && details?.storySource ? `<div class="asource">${escapeHtml(sourceLine[details.storySource])}</div>` : '';
  return `
    <div class="atitle">${escapeHtml(work.title)}${heart}</div>
    <div class="ameta">${escapeHtml([work.maker, work.date].filter(Boolean).join(' · '))}</div>
    <div class="aplace">${escapeHtml(work.place)}</div>
    <div class="astory">${escapeHtml(details?.story ?? '')}</div>
    ${facts}${source}`;
}
