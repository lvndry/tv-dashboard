import { config } from '../../config';
import type { RackEntry } from '../configTypes';
import type { BriefStory } from '../brief';
import { data, storyById } from '../data';
import { afterPaint, byId, escapeHtml, imageHtml, shorten } from '../dom';
import { availability, openRackEntry } from '../launcher';
import { currentLocation } from '../location';
import type { DiscoverStory } from '../discover';
import type { CityEvent } from '../events';
import type { Story } from '../news';
import { interest, isToday, type Match } from '../sports';
import type { Action } from '../platform';
import { lastLaunch, settings } from '../store';
import { relativeAge, timeLabel, weekdayShort, zoned } from '../time';
import { aheadPhrase, condition, rainOutlook, rainPhrase, upcomingHours, windFrom, type Weather } from '../weather';
import type { View } from './view';

interface Phrase {
  id: string;
  text: string;
  note: () => string;
  activate?: () => void;
}

interface Pending { loading: string }

type Part = string | Phrase | Pending;

const isPhrase = (part: Part): part is Phrase => typeof part === 'object' && 'id' in part;

function joinList(parts: Phrase[]): Part[] {
  const joined: Part[] = [];
  parts.forEach((part, index) => {
    if (index > 0) joined.push(index === parts.length - 1 ? ' and ' : ', ');
    joined.push(part);
  });
  return joined;
}

function closing(parts: Part[]): Part[] {
  const last = parts[parts.length - 1];
  const text = typeof last === 'string' ? last : last && isPhrase(last) ? last.text : '';
  return /[….?!]$/.test(text) ? parts : [...parts, '.'];
}

function greeting(): string {
  const hour = zoned().hour;
  const name = config.name.trim();
  if (hour < 5) return name ? `Still up, ${name}?` : 'Still up?';
  const word = hour < 12 ? 'Bonjour' : hour < 18 ? 'Bon après-midi' : 'Bonsoir';
  return name ? `${word}, ${name}.` : `${word}.`;
}

const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

const okLine = (label: string): string => `<div class="ok"><kbd>OK</kbd>${escapeHtml(label)}</div>`;

function hourStrip(weather: Weather): string {
  const hours = upcomingHours(weather, 8);
  return `<div class="hours">${hours.map(hour => `
    <div class="col">
      <b>${hour.temp}°</b>
      <div class="bar"><i style="height:${Math.max(4, Math.round(hour.precipProbability * 0.7))}px" class="${hour.precipProbability >= 40 ? 'wet' : ''}"></i></div>
      <span>${hour.time === hours[0]?.time ? 'Now' : timeLabel(hour.time).slice(0, 2) + 'h'}</span>
    </div>`).join('')}</div>`;
}

function weatherNowNote(weather: Weather): string {
  const now = weather.current;
  const sky = condition(now.code, now.isDay);
  return `
    <div class="kicker">Now · ${escapeHtml(currentLocation().name)}</div>
    <div class="big">${now.temp}°</div>
    <div class="nmeta">${sky.label} · feels like ${now.feels}°<br>Wind ${now.windSpeed} km/h from the ${windFrom(now.windDirection)}</div>
    ${hourStrip(weather)}`;
}

function rainNote(weather: Weather): string {
  const hours = upcomingHours(weather, 12);
  const peak = Math.max(1, ...hours.map(hour => hour.precip));
  return `
    <div class="kicker">Rain · next 12 hours</div>
    <div class="ntitle">${escapeHtml(capitalize(rainPhrase(rainOutlook(weather))))}.</div>
    <div class="rain">${hours.map((hour, index) => `
      <div class="rcol">
        <div class="rbar"><i class="prob" style="height:${hour.precipProbability}%"></i><i class="mm" style="height:${Math.round(hour.precip / peak * 100)}%"></i></div>
        <span>${index % 3 === 0 ? timeLabel(hour.time).slice(0, 2) + 'h' : ''}</span>
      </div>`).join('')}</div>
    <div class="legend"><span><i class="prob"></i>chance</span><span><i class="mm"></i>amount</span></div>`;
}

function daysNote(weather: Weather): string {
  const days = weather.days.slice(0, 6);
  const low = Math.min(...days.map(day => day.min));
  const high = Math.max(...days.map(day => day.max));
  const span = Math.max(1, high - low);
  const today = days[0];
  return `
    <div class="kicker">The week ahead</div>
    <div class="days">${days.map((day, index) => `
      <div class="day">
        <b>${index === 0 ? 'Today' : weekdayShort(day.time)}</b>
        <span class="what">${condition(day.code).label}${day.precipProbability >= 50 ? ` · ${day.precipProbability}%` : ''}</span>
        <span class="lo">${day.min}°</span>
        <span class="range"><i style="left:${(day.min - low) / span * 100}%;right:${(high - day.max) / span * 100}%"></i></span>
        <span>${day.max}°</span>
      </div>`).join('')}</div>
    ${today ? `<div class="nmeta sun">Sunrise ${timeLabel(today.sunrise)} · sunset ${timeLabel(today.sunset)}</div>` : ''}`;
}

function briefStoryNote(story: BriefStory): string {
  const sources = story.storyIds.map(storyById).filter((item): item is Story => !!item);
  const image = sources.find(source => source.image)?.image;
  const names = Array.from(new Set(sources.map(source => source.source)));
  return `
    ${imageHtml(image, 'thumb')}
    <div class="kicker">${escapeHtml(story.section)} · ${escapeHtml(names.join(', '))}</div>
    <div class="ntitle">${escapeHtml(story.headline)}</div>
    <div class="nmeta">${escapeHtml(story.summary)}</div>
    ${okLine('Read in the brief')}`;
}

function storyNote(story: Story): string {
  return `
    ${imageHtml(story.image, 'thumb')}
    <div class="kicker">${escapeHtml(story.source)} · ${relativeAge(story.published)}</div>
    <div class="ntitle">${escapeHtml(story.title)}</div>
    ${story.summary ? `<div class="nmeta">${escapeHtml(shorten(story.summary, 200))}</div>` : ''}
    ${okLine('Open in the news')}`;
}

function allNewsNote(): string {
  const sources = new Set(data.stories.map(story => story.source)).size;
  const brief = data.brief;
  return `
    <div class="kicker">The news</div>
    <div class="ntitle">${brief ? `${brief.stories.length} stories, summarised` : `${data.stories.length} headlines`} from ${sources} sources.</div>
    <div class="nmeta">${data.briefAt && brief ? `Brief written at ${timeLabel(data.briefAt)}.` : 'Newest first, grouped by section.'}</div>
    ${okLine('Open the news')}`;
}

const shortcutDetail = {
  whatson: 'Football fixtures and live scores, and the week’s major events in Paris.',
  news: 'Every headline, by section, with the ChatGPT brief when it’s connected.',
  gallery: 'About 2,800 public-domain works, from ancient Egypt to Romanticism. Favourites come up more often in ambient mode.',
  settings: 'ChatGPT, ambient mode, highlighter colour, clock and console input.',
};

function rackNote(entry: RackEntry): string {
  if (entry.kind === 'shortcut') {
    return `
      <div class="kicker">Dashboard</div>
      <div class="wordmark">${escapeHtml(entry.name)}<i style="background:${entry.dot}"></i></div>
      <div class="nmeta">${escapeHtml(shortcutDetail[entry.target])}</div>
      ${okLine(`Open ${entry.name.toLowerCase()}`)}`;
  }
  const last = lastLaunch(entry.id);
  const state = availability(entry);
  const lastLine = last ? `Last opened ${relativeAge(last)}` : 'Not opened from here yet';
  const detail = entry.kind === 'input'
    ? `HDMI ${settings.ps5Port} · Back on the remote returns here`
    : state === 'missing' ? 'Not found on this TV. Check its name in app/config.ts.'
    : state === 'checking' ? 'Looking for it on the TV…'
    : lastLine;
  const action = entry.kind === 'input' ? `Switch to the ${entry.name}` : `Open ${entry.name}`;
  return `
    <div class="kicker">${entry.kind === 'input' ? 'Console' : 'App'}</div>
    <div class="wordmark">${escapeHtml(entry.name)}<i style="background:${entry.dot}"></i></div>
    <div class="nmeta">${escapeHtml(detail)}</div>
    ${state === 'missing' ? '' : okLine(action)}`;
}

/**
 * A headline that reads whole inside a sentence. Long titles keep their most informative
 * clause ("Ukraine : Zelensky à Bruxelles…" → "Zelensky à Bruxelles…"); titles with no
 * clause short enough are skipped rather than cut mid-sentence.
 */
function letterHeadline(title: string, maxLength = 58): string | null {
  const cleaned = title.replace(/^(en direct|direct|vidéo|video|live|exclusif)\s*[,:.–-]\s*/i, '').replace(/[«»"“”]/g, '').replace(/\s+/g, ' ').trim();
  if (cleaned.length <= maxLength) return cleaned;
  // "Topic : what happened" keeps what happened; "Someone, role : quote" has nothing worth keeping on its own.
  const colon = cleaned.search(/\s[:–—]\s/);
  if (colon < 0) return null;
  const quotedRemark = /\s:\s*[«"“]/.test(title) || cleaned.slice(0, colon).includes(',');
  if (quotedRemark) return null;
  const rest = cleaned.slice(colon + 3).trim();
  return rest.length <= maxLength && rest.split(' ').length >= 4 ? rest.charAt(0).toUpperCase() + rest.slice(1) : null;
}

const gearIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3.3h-4l-.4 2.6a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.4 7.4 0 0 0 1.7 1l.4 2.6h4l.4-2.6a7.4 7.4 0 0 0 1.7-1l2.5 1 2-3.5zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z" transform="translate(-1 0)"/></svg>';

const crestImage = (url: string): string => url ? `<img class="crest" src="${escapeHtml(url)}" alt="" referrerpolicy="no-referrer">` : '';

function matchNote(match: Match): string {
  const status = match.state === 'in' ? `<span class="live-dot"></span>Live · ${escapeHtml(match.status)}`
    : match.state === 'post' ? 'Full time'
    : `${isToday(match) ? 'Today' : zoned(match.kickoff).weekday} at ${timeLabel(match.kickoff)}`;
  const middle = match.state === 'pre' ? '<span class="vs">v</span>' : `<b>${escapeHtml(match.home.score)}–${escapeHtml(match.away.score)}</b>`;
  return `
    <div class="kicker">${escapeHtml(match.league)}${match.favourite ? ' · your team' : ''}</div>
    <div class="note-match">
      <div>${crestImage(match.home.logo)}<span>${escapeHtml(match.home.short)}</span></div>
      <div class="note-score">${middle}</div>
      <div>${crestImage(match.away.logo)}<span>${escapeHtml(match.away.short)}</span></div>
    </div>
    <div class="nmeta">${status}${match.venue ? `<br>${escapeHtml(match.venue)}` : ''}</div>
    ${okLine('See all the football')}`;
}

function discoverNote(story: DiscoverStory): string {
  return `
    ${imageHtml(story.thumb || story.image, 'thumb')}
    <div class="kicker">Perplexity Discover · ${relativeAge(story.published)}</div>
    <div class="ntitle">${escapeHtml(story.title)}</div>
    ${story.summary ? `<div class="nmeta">${escapeHtml(story.summary)}</div>` : ''}
    ${okLine('Read the story')}`;
}

function eventNote(event: CityEvent): string {
  return `
    ${imageHtml(event.image, 'thumb')}
    <div class="kicker">${escapeHtml([event.tags[0], event.free ? 'Free' : ''].filter(Boolean).join(' · '))}</div>
    <div class="ntitle">${escapeHtml(event.title)}</div>
    <div class="nmeta">${escapeHtml([event.venue, event.dates].filter(Boolean).join(' · '))}</div>
    ${okLine('See what’s on in Paris')}`;
}

const matchPhrase = (match: Match): string => match.state === 'pre'
  ? `${match.home.short}–${match.away.short} at ${timeLabel(match.kickoff)}`
  : `${match.home.short} ${match.home.score}–${match.away.score} ${match.away.short}${match.state === 'in' ? `, ${match.status}` : ''}`;

function newsSpread(stories: Story[], count: number): Story[] {
  const bySection = new Map<string, Story[]>();
  for (const story of stories) {
    const list = bySection.get(story.section) ?? [];
    list.push(story);
    bySection.set(story.section, list);
  }
  const picked: Story[] = [];
  for (let round = 0; picked.length < count && round < 10; round++) {
    for (const list of bySection.values()) {
      const story = list[round];
      if (story && picked.length < count) picked.push(story);
    }
  }
  return picked;
}

export function createHome(
  openNews: (target?: { briefIndex?: number; storyId?: string; discoverId?: string }) => void,
  openWhatsOn: (target: { tab: 'football' | 'paris'; id?: string }) => void,
): View {
  const element = byId('home');
  const letter = byId('letter');
  const margin = byId('margin');
  const shelf = byId('shelf');
  const hint = byId('hint');

  let paragraphs: Part[][] = [];
  let phrases: Phrase[] = [];
  let focusedId: string | null = null;
  let zone: 'letter' | 'rack' = 'letter';
  let rackIndex = 0;
  let currentNote = '';
  let rackByDefault = false;
  let userMoved = false;

  shelf.innerHTML = `<span class="racklabel">Open</span><span class="rack-marker" id="rack-marker"></span>` +
    config.rack.map((entry, index) => {
      const firstShortcut = entry.kind === 'shortcut' && config.rack[index - 1]?.kind !== 'shortcut' && index > 0;
      const divider = firstShortcut ? '<span class="rack-divider"></span>' : '';
      if (entry.kind === 'shortcut' && entry.target === 'settings') {
        return `${divider}<span class="chip quiet icon-only" data-focus="rack" data-index="${index}" title="${escapeHtml(entry.name)}">${gearIcon}</span>`;
      }
      return `${divider}<span class="chip${entry.kind === 'shortcut' ? ' quiet' : ''}" data-focus="rack" data-index="${index}"><i style="background:${entry.dot}"></i>${escapeHtml(entry.name)}</span>`;
    }).join('');
  const chips = Array.from(shelf.querySelectorAll<HTMLElement>('.chip'));
  const rackMarker = byId('rack-marker');

  function compose(): Part[][] {
    const result: Part[][] = [];
    const weather = data.weather;
    const opening: Part[] = [`${greeting()} `];
    if (weather) {
      const now = weather.current;
      const ahead = aheadPhrase(weather);
      opening.push('It’s ', { id: 'wx-now', text: `${now.temp}° and ${condition(now.code, now.isDay).state}`, note: () => weatherNowNote(weather) });
      opening.push(', ', { id: 'wx-rain', text: rainPhrase(rainOutlook(weather)), note: () => rainNote(weather) });
      if (ahead) opening.push(', and ', { id: 'wx-ahead', text: ahead, note: () => daysNote(weather) });
      opening.push('.');
    } else if (data.status.get('weather')?.ok === false) {
      opening.push('The weather is out of reach right now.');
    } else {
      opening.push('It’s ', { loading: 'checking the sky' }, '.');
    }
    result.push(opening);

    const football = footballLine();
    if (football) result.push(football);

    const discover = data.discover.slice(0, 3);
    const brief = discover.length ? null : settings.briefEnabled ? data.brief : null;
    const allNews: Phrase = { id: 'news-all', text: brief ? 'read the whole brief' : 'see all the news', note: allNewsNote, activate: () => openNews() };
    if (discover.length) {
      const items = discover.map((story): Phrase => ({
        id: `discover-${story.id}`, text: story.short, note: () => discoverNote(story), activate: () => openNews({ discoverId: story.id }),
      }));
      result.push(['Top stories: ', ...joinList(items), ', or ', { ...allNews, text: 'see all the news' }, '.']);
    } else if (brief && brief.stories.length) {
      const items = brief.stories.slice(0, 5).map((story, index): Phrase => ({
        id: `brief-${index}`, text: story.short, note: () => briefStoryNote(story), activate: () => openNews({ briefIndex: index }),
      }));
      result.push(['Today: ', ...joinList(items.slice(0, 3)), ', or ', allNews, '.']);
    } else if (data.stories.length) {
      const readable = data.stories.flatMap(story => {
        const headline = letterHeadline(story.title);
        return headline ? [{ story, headline }] : [];
      });
      const picked = newsSpread(readable.map(item => item.story), 3);
      const items = picked.map((story, index): Phrase => ({
        id: `story-${index}`, text: readable.find(item => item.story === story)!.headline, note: () => storyNote(story), activate: () => openNews({ storyId: story.id }),
      }));
      result.push(items.length ? ['In the papers: ', ...joinList(items), ', or ', allNews, '.'] : ['The papers are in: ', allNews, '.']);
    } else if ([...data.status.entries()].filter(([key]) => key.startsWith('feed:')).every(([, status]) => status.ok === false)) {
      result.push(['The news feeds are unreachable right now.']);
    } else {
      result.push(['In the papers: ', { loading: 'fetching the headlines' }, '.']);
    }

    const paris = data.events.flatMap(event => event.title.length <= 48 ? [event] : []).slice(0, 3);
    if (paris.length) {
      const items = paris.map((event): Phrase => ({ id: `paris-${event.id}`, text: event.title, note: () => eventNote(event), activate: () => openWhatsOn({ tab: 'paris', id: event.id }) }));
      result.push(['In Paris this week: ', ...joinList(items), '.']);
    }
    return result;
  }

  /** Live matches first, then today's best fixtures, otherwise the next one worth knowing about. */
  function footballLine(): Part[] | null {
    const now = Date.now();
    const phrase = (match: Match): Phrase => ({
      id: `match-${match.id}`, text: matchPhrase(match), note: () => matchNote(match), activate: () => openWhatsOn({ tab: 'football', id: match.id }),
    });
    const byInterest = (list: Match[]): Match[] => list.slice().sort((first, second) => interest(second) - interest(first));
    const live = byInterest(data.matches.filter(match => match.state === 'in')).slice(0, 3);
    if (live.length) return ['Live now: ', ...joinList(live.map(phrase)), '.'];
    const today = byInterest(data.matches.filter(match => match.state === 'pre' && isToday(match, now))).slice(0, 3)
      .sort((first, second) => first.kickoff - second.kickoff);
    if (today.length) {
      const evening = today.every(match => zoned(match.kickoff).hour >= 17);
      return [evening ? 'Tonight: ' : 'Today: ', ...joinList(today.map(phrase)), '.'];
    }
    const upcoming = byInterest(data.matches.filter(match => match.state === 'pre' && match.kickoff - now < 4 * 86400000)).slice(0, 2)
      .sort((first, second) => first.kickoff - second.kickoff);
    if (!upcoming.length) return null;
    const dated = upcoming.map(match => ({ ...phrase(match), text: `${zoned(match.kickoff).weekday}, ${match.home.short}–${match.away.short}` }));
    return ['Coming up: ', ...joinList(dated), '.'];
  }

  function renderPart(part: Part): string {
    if (typeof part === 'string') return escapeHtml(part);
    if ('loading' in part) return `<span class="ph-loading">${escapeHtml(part.loading)}</span>`;
    return `<span class="ph" data-focus="phrase" data-id="${part.id}">${escapeHtml(part.text)}</span>`;
  }

  function fitLetter(): void {
    const available = (shelf.parentElement?.offsetTop ?? 968) - letter.offsetTop - 40;
    let size = 42;
    letter.style.setProperty('--letter-size', `${size}px`);
    while (letter.scrollHeight > available && size > 32) {
      size -= 2;
      letter.style.setProperty('--letter-size', `${size}px`);
    }
  }

  function phraseElement(id: string): HTMLElement | null {
    return letter.querySelector<HTMLElement>(`.ph[data-id="${id}"]`);
  }

  function paragraphOf(id: string): number {
    return paragraphs.findIndex(parts => parts.some(part => isPhrase(part) && part.id === id));
  }

  function showNote(html: string): void {
    if (html === currentNote) return;
    currentNote = html;
    for (const old of Array.from(margin.children)) {
      old.classList.remove('in');
      old.classList.add('out');
      setTimeout(() => old.remove(), 260);
    }
    const note = document.createElement('div');
    note.className = 'note';
    note.innerHTML = html;
    margin.appendChild(note);
    afterPaint(() => note.classList.add('in'));
  }

  function updateHint(): void {
    const phrase = phrases.find(item => item.id === focusedId);
    const parts = zone === 'rack'
      ? ['OK open', '▲ back']
      : [phrase?.activate ? 'OK open' : '◀ ▶ read', '▼ apps'];
    hint.innerHTML = parts.map(part => `<span>${escapeHtml(part)}</span>`).join('');
  }

  function applyFocus(): void {
    letter.querySelectorAll('.ph.focus').forEach(node => node.classList.remove('focus'));
    chips.forEach(chip => chip.classList.remove('on'));
    const paragraphNodes = Array.from(letter.children);
    if (zone === 'rack') {
      paragraphNodes.forEach(node => node.classList.remove('current'));
      const chip = chips[rackIndex];
      if (chip) {
        chip.classList.add('on');
        rackMarker.style.transform = `translateX(${chip.offsetLeft}px)`;
        rackMarker.style.width = `${chip.offsetWidth}px`;
        rackMarker.classList.add('visible');
      }
      const entry = config.rack[rackIndex];
      if (entry) showNote(rackNote(entry));
    } else {
      rackMarker.classList.remove('visible');
      const phrase = phrases.find(item => item.id === focusedId);
      const node = focusedId ? phraseElement(focusedId) : null;
      const paragraphIndex = focusedId ? paragraphOf(focusedId) : -1;
      paragraphNodes.forEach((paragraph, index) => paragraph.classList.toggle('current', index === paragraphIndex));
      node?.classList.add('focus');
      if (phrase) showNote(phrase.note());
    }
    updateHint();
  }

  function render(): void {
    const previousParagraph = focusedId ? paragraphOf(focusedId) : 0;
    paragraphs = compose();
    phrases = paragraphs.flat().filter(isPhrase);
    letter.innerHTML = paragraphs.map(parts => `<p>${parts.map(renderPart).join('')}</p>`).join('');
    fitLetter();
    if (!userMoved && zone === 'letter') focusedId = phrases[0]?.id ?? null;
    if (!focusedId || !phrases.some(phrase => phrase.id === focusedId)) {
      const sameParagraph = paragraphs[Math.max(0, previousParagraph)]?.find(isPhrase);
      focusedId = sameParagraph?.id ?? phrases[0]?.id ?? null;
    }
    if (!focusedId) { zone = 'rack'; rackByDefault = true; }
    else if (rackByDefault) { zone = 'letter'; rackByDefault = false; }
    applyFocus();
  }

  function centerX(node: Element): number {
    const rect = node.getClientRects()[0] ?? node.getBoundingClientRect();
    return rect.left + rect.width / 2;
  }

  function nearestPhraseIn(paragraphIndex: number, originX: number): Phrase | undefined {
    const candidates = (paragraphs[paragraphIndex] ?? []).filter(isPhrase);
    let best: Phrase | undefined;
    let bestDistance = Infinity;
    for (const candidate of candidates) {
      const node = phraseElement(candidate.id);
      if (!node) continue;
      const distance = Math.abs(centerX(node) - originX);
      if (distance < bestDistance) { bestDistance = distance; best = candidate; }
    }
    return best;
  }

  function lastParagraphWithPhrase(): number {
    for (let index = paragraphs.length - 1; index >= 0; index--) {
      if (paragraphs[index]!.some(isPhrase)) return index;
    }
    return -1;
  }

  function moveVertical(step: number): void {
    if (!focusedId) return;
    const node = phraseElement(focusedId);
    const originX = node ? centerX(node) : 0;
    let target = paragraphOf(focusedId) + step;
    while (target >= 0 && target < paragraphs.length && !paragraphs[target]!.some(isPhrase)) target += step;
    if (target >= paragraphs.length) { enterRack(originX); return; }
    const next = nearestPhraseIn(target, originX);
    if (next) { focusedId = next.id; applyFocus(); }
  }

  function enterRack(originX: number): void {
    zone = 'rack';
    rackByDefault = false;
    let best = 0;
    let bestDistance = Infinity;
    chips.forEach((chip, index) => {
      const distance = Math.abs(centerX(chip) - originX);
      if (distance < bestDistance) { bestDistance = distance; best = index; }
    });
    rackIndex = best;
    applyFocus();
  }

  function leaveRack(): void {
    const target = lastParagraphWithPhrase();
    if (target < 0) return;
    const chip = chips[rackIndex];
    const next = nearestPhraseIn(target, chip ? centerX(chip) : 0);
    if (!next) return;
    zone = 'letter';
    focusedId = next.id;
    applyFocus();
  }

  function press(node: HTMLElement | undefined | null): void {
    if (!node) return;
    node.classList.remove('press');
    void node.offsetWidth;
    node.classList.add('press');
  }

  function handle(action: Action): boolean {
    userMoved = true;
    if (zone === 'rack') {
      if (action === 'left' && rackIndex > 0) { rackIndex--; applyFocus(); }
      else if (action === 'right' && rackIndex < chips.length - 1) { rackIndex++; applyFocus(); }
      else if (action === 'up') leaveRack();
      else if (action === 'ok') {
        press(chips[rackIndex]);
        const entry = config.rack[rackIndex];
        if (entry) void openRackEntry(entry);
      } else if (action === 'back') { leaveRack(); }
      else return action === 'down' || action === 'left' || action === 'right';
      return true;
    }
    const index = phrases.findIndex(phrase => phrase.id === focusedId);
    if (action === 'left' && index > 0) { focusedId = phrases[index - 1]!.id; applyFocus(); return true; }
    if (action === 'right' && index < phrases.length - 1) { focusedId = phrases[index + 1]!.id; applyFocus(); return true; }
    if (action === 'right' && index === phrases.length - 1) { const node = focusedId ? phraseElement(focusedId) : null; enterRack(node ? centerX(node) : 0); return true; }
    if (action === 'up') { moveVertical(-1); return true; }
    if (action === 'down') { moveVertical(1); return true; }
    if (action === 'ok') {
      const phrase = phrases[index];
      if (phrase?.activate) { press(focusedId ? phraseElement(focusedId) : null); phrase.activate(); }
      return true;
    }
    return action === 'left' || action === 'right';
  }

  function pointer(target: HTMLElement): void {
    userMoved = true;
    if (target.dataset.focus === 'rack') {
      zone = 'rack';
      rackByDefault = false;
      rackIndex = Number(target.dataset.index);
      applyFocus();
    } else if (target.dataset.focus === 'phrase' && target.dataset.id) {
      zone = 'letter';
      focusedId = target.dataset.id;
      applyFocus();
    }
  }

  return {
    element,
    render,
    handle,
    pointer,
    enter: () => { currentNote = ''; applyFocus(); },
    refreshClock: () => {
      const hour = zoned().hour;
      if (letter.dataset.hour !== String(hour)) { letter.dataset.hour = String(hour); render(); }
    },
  };
}
