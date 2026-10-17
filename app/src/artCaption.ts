import qr from 'qrcode-generator';
import type { Artwork } from './art';
import { isFavourite } from './art';
import type { ArtDetails } from './artDetails';
import { escapeHtml } from './dom';

/** Wide works fill the whole screen edge to edge; only portrait and near-square pieces stay framed whole. */
export function fillsScreen(width: number, height: number): boolean {
  const ratio = width / Math.max(1, height);
  return ratio > 1.3;
}

const sourceLine: Record<ArtDetails['storySource'], string> = {
  chatgpt: 'Told by ChatGPT from Wikipedia and the museum’s records',
  wikipedia: 'From Wikipedia',
  museum: 'From the museum’s description',
  record: 'From the museum’s records',
  '': '',
};

/** A small square QR code, drawn as an SVG so it scales crisply at TV distance. */
function qrSvg(url: string): string {
  const code = qr(0, 'M');
  code.addData(url);
  code.make();
  const n = code.getModuleCount();
  let cells = '';
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      if (code.isDark(row, col)) cells += `<rect x="${col}" y="${row}" width="1" height="1"/>`;
    }
  }
  return `<svg class="qrcode" viewBox="-2 -2 ${n + 4} ${n + 4}" shape-rendering="crispEdges"><rect x="-2" y="-2" width="${n + 4}" height="${n + 4}" fill="#f4f2ea"/>${cells}</svg>`;
}

export function captionHtml(work: Artwork, details: ArtDetails | null, mode: 'ambient' | 'viewer'): string {
  const heart = mode === 'viewer' && isFavourite(work) ? ' <span class="heart">♥</span>' : '';
  const facts = mode === 'viewer' && details?.facts.length
    ? `<dl class="afacts">${details.facts.map(fact => `<dt>${escapeHtml(fact.label)}</dt><dd>${escapeHtml(fact.value)}</dd>`).join('')}</dl>`
    : '';
  const source = mode === 'viewer' && details?.storySource ? `<div class="asource">${escapeHtml(sourceLine[details.storySource])}</div>` : '';
  const qrCard = mode === 'viewer' && details?.url
    ? `<div class="aqrcode">${qrSvg(details.url)}<div class="aqrcode-label">Scan for the full story</div></div>`
    : '';
  return `
    <div class="atitle">${escapeHtml(work.title)}${heart}</div>
    <div class="ameta">${escapeHtml([work.maker, work.date].filter(Boolean).join(' · '))}</div>
    <div class="aplace">${escapeHtml(work.place)}</div>
    <div class="astory">${escapeHtml(details?.story ?? '')}</div>
    ${qrCard}${facts}${source}`;
}
