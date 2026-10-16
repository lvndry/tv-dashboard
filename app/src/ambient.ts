import { config } from '../config';
import { data } from './data';
import { byId, shorten } from './dom';
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

export function startAmbient(): void {
  const line = byId('aline');
  const drift = byId('drift');
  const lines = ambientLines();
  lineIndex = lineIndex % lines.length;
  line.textContent = lines[lineIndex] ?? '';
  line.classList.remove('out');
  document.body.classList.add('ambient');
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
}

export function stopAmbient(): void {
  clearInterval(lineTimer);
  clearInterval(driftTimer);
  document.body.classList.remove('ambient');
}

export const isAmbient = (): boolean => document.body.classList.contains('ambient');
