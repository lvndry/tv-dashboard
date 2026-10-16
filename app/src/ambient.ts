import { config } from '../config';
import { nextArtwork, type LoadedArtwork } from './art';
import { data } from './data';
import { byId, escapeHtml, shorten } from './dom';
import { settings } from './store';
import { timeLabel, zoned } from './time';
import { aheadPhrase, condition, nextSunset, rainOutlook, rainPhrase } from './weather';

const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

function ambientLines(): string[] {
  const lines: string[] = [];
  const weather = data.weather;
  if (weather) {
    const now = weather.current;
    lines.push(`${now.temp}° and ${condition(now.code, now.isDay).state} in ${config.place.split(' ')[0]}.`);
    lines.push(`${capitalize(rainPhrase(rainOutlook(weather)))}.`);
    const sunset = nextSunset(weather);
    if (sunset && sunset - Date.now() < 6 * 3600000) lines.push(`The sun sets at ${timeLabel(sunset)}.`);
    const ahead = aheadPhrase(weather);
    if (ahead) lines.push(`${capitalize(ahead)}.`);
  }
  const headlines = (settings.briefEnabled ? data.brief : null)?.stories.slice(0, 4).map(story => story.headline)
    ?? data.stories.slice(0, 4).map(story => shorten(story.title, 70));
  lines.push(...headlines);
  if (!lines.length) lines.push(zoned().hour >= 18 ? 'Bonsoir.' : 'Bonjour.');
  return lines;
}

let lineIndex = 0;
let lineTimer: ReturnType<typeof setInterval> | undefined;
let driftTimer: ReturnType<typeof setInterval> | undefined;
let artTimer: ReturnType<typeof setTimeout> | undefined;
let artSession = 0;
let frontFrame = 0;
let prepared: Promise<LoadedArtwork | null> | null = null;

/** Paintings close to the screen's shape fill it; everything else is framed whole over a blurred copy. */
function fillsScreen(work: LoadedArtwork): boolean {
  const ratio = work.width / Math.max(1, work.height);
  return ratio > 1.3 && ratio < 2.2;
}

function showArtwork(work: LoadedArtwork): void {
  const frames = [byId('art-a'), byId('art-b')];
  const incoming = frames[1 - frontFrame]!;
  const outgoing = frames[frontFrame]!;
  const url = escapeHtml(work.image);
  const panX = Math.round(Math.random() * 6 - 3);
  const panY = Math.round(Math.random() * 4 - 2);
  incoming.className = `art-frame ${fillsScreen(work) ? 'fill' : 'framed'}`;
  incoming.style.setProperty('--pan-x', `${panX}%`);
  incoming.style.setProperty('--pan-y', `${panY}%`);
  incoming.style.setProperty('--art-duration', `${settings.artMinutes * 60 + 10}s`);
  incoming.innerHTML = `<img class="art-backdrop" src="${url}" alt=""><img class="art-image" src="${url}" alt="">`;
  void incoming.offsetWidth;
  incoming.classList.add('visible');
  outgoing.classList.remove('visible');
  frontFrame = 1 - frontFrame;

  const caption = byId('acaption');
  caption.classList.add('out');
  setTimeout(() => {
    caption.innerHTML = `
      <div class="atitle">${escapeHtml(work.title)}</div>
      <div class="ameta">${escapeHtml([work.maker, work.date].filter(Boolean).join(' · '))}</div>
      <div class="aplace">${escapeHtml(work.place)}</div>`;
    caption.classList.remove('out');
  }, 900);
}

function scheduleArt(session: number): void {
  clearTimeout(artTimer);
  prepared = nextArtwork();
  artTimer = setTimeout(async () => {
    const work = await prepared;
    if (session !== artSession) return;
    if (work) showArtwork(work);
    scheduleArt(session);
  }, settings.artMinutes * 60000);
}

async function startArt(session: number): Promise<void> {
  const work = await (prepared ?? nextArtwork());
  if (session !== artSession) return;
  if (!work) {
    document.body.classList.remove('ambient-art');
    return;
  }
  showArtwork(work);
  scheduleArt(session);
}

/** Starts downloading the first artwork early, so ambient mode opens on a picture instead of a blank screen. */
export function prepareAmbient(): void {
  if (settings.ambientStyle === 'art' && !prepared) prepared = nextArtwork();
}

export function startAmbient(): void {
  const line = byId('aline');
  const drift = byId('drift');
  const lines = ambientLines();
  lineIndex = lineIndex % lines.length;
  line.textContent = lines[lineIndex] ?? '';
  line.classList.remove('out');
  document.body.classList.add('ambient');
  document.body.classList.toggle('ambient-art', settings.ambientStyle === 'art');
  clearInterval(lineTimer);
  clearInterval(driftTimer);
  lineTimer = setInterval(() => {
    line.classList.add('out');
    setTimeout(() => {
      const fresh = ambientLines();
      lineIndex = (lineIndex + 1) % fresh.length;
      line.textContent = fresh[lineIndex] ?? '';
      line.classList.remove('out');
    }, 1200);
  }, 14000);
  driftTimer = setInterval(() => {
    const x = Math.round(Math.random() * 160 - 80);
    const y = Math.round(Math.random() * 120 - 60);
    drift.style.transform = `translate(${x}px, ${y}px)`;
  }, 45000);
  artSession++;
  if (settings.ambientStyle === 'art') void startArt(artSession);
}

export function stopAmbient(): void {
  clearInterval(lineTimer);
  clearInterval(driftTimer);
  clearTimeout(artTimer);
  artSession++;
  prepared = null;
  document.body.classList.remove('ambient');
  prepareAmbient();
}

export const isAmbient = (): boolean => document.body.classList.contains('ambient');
