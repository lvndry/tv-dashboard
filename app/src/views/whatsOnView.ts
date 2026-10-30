import { config } from '../../config';
import { data } from '../data';
import { byId, escapeHtml, imageHtml, toast } from '../dom';
import type { CityEvent } from '../events';
import { openUrl, type Action } from '../platform';
import type { Match } from '../sports';
import { isSameDay, relativeAge, timeLabel, weekdayShort } from '../time';
import type { View } from './view';

type Tab = 'football' | 'paris';

function dayLabel(epochMs: number, now: number = Date.now()): string {
  if (isSameDay(epochMs, now)) return 'Today';
  if (isSameDay(epochMs, now + 86400000)) return 'Tomorrow';
  return weekdayShort(epochMs);
}

function matchStatus(match: Match): string {
  if (match.state === 'in') return `Live · ${match.status}`;
  if (match.state === 'post') return match.status === 'FT' ? 'Full time' : match.status;
  return `${dayLabel(match.kickoff)} ${timeLabel(match.kickoff)}`;
}

const crest = (url: string, className: string): string =>
  url ? `<img class="${className}" src="${escapeHtml(url)}" alt="" referrerpolicy="no-referrer">` : `<span class="${className} crest-empty"></span>`;

/** Upcoming and live first, then the week's results most recent first. */
function orderedMatches(matches: Match[], now: number = Date.now()): Match[] {
  const ahead = matches.filter(match => match.state !== 'post' || now - match.kickoff < 3 * 3600000).sort((first, second) => first.kickoff - second.kickoff);
  const done = matches.filter(match => !ahead.includes(match)).sort((first, second) => second.kickoff - first.kickoff);
  return [...ahead, ...done];
}

export function createWhatsOnView(close: () => void): View & { focusOn(target: { tab: Tab; id?: string }): void } {
  const element = byId('whatson');
  const tabsNode = byId('whatson-tabs');
  const listNode = byId('whatson-list');
  const track = byId('whatson-track');
  const detail = byId('whatson-detail');
  const subtitle = byId('whatson-subtitle');

  let tab: Tab = 'football';
  let index = 0;
  let zone: 'tabs' | 'list' = 'list';
  let detailKey = '';

  const tabs = (): { id: Tab; label: string }[] => [
    { id: 'football', label: 'Football' },
    ...(config.parisEvents ? [{ id: 'paris' as const, label: 'Paris this week' }] : []),
  ];

  const items = (): (Match | CityEvent)[] => tab === 'football' ? orderedMatches(data.matches) : data.events;

  function rowHtml(item: Match | CityEvent, position: number): string {
    if (tab === 'football') {
      const match = item as Match;
      const live = match.state === 'in';
      return `<div class="row match-row${match.favourite ? ' fav' : ''}${live ? ' live' : ''}" data-focus="whatson-row" data-index="${position}">
        <div class="crests">${crest(match.home.logo, 'crest')}${crest(match.away.logo, 'crest')}</div>
        <div class="rtext"><div class="rtitle">${escapeHtml(match.home.short)} ${match.state === 'pre' ? '–' : `<b>${escapeHtml(match.home.score)}–${escapeHtml(match.away.score)}</b>`} ${escapeHtml(match.away.short)}</div>
        <div class="rmeta">${live ? '<i class="live-dot"></i>' : ''}${escapeHtml(matchStatus(match))} · ${escapeHtml(match.league)}</div></div></div>`;
    }
    const event = item as CityEvent;
    return `<div class="row" data-focus="whatson-row" data-index="${position}">
      ${imageHtml(event.image, 'rthumb')}
      <div class="rtext"><div class="rtitle">${escapeHtml(event.title)}</div>
      <div class="rmeta">${escapeHtml([event.venue, event.free ? 'Free' : ''].filter(Boolean).join(' · '))}</div></div></div>`;
  }

  function detailHtml(item: Match | CityEvent): string {
    if (tab === 'football') {
      const match = item as Match;
      const score = match.state === 'pre'
        ? `<div class="vs-time">${escapeHtml(timeLabel(match.kickoff))}</div><div class="vs-day">${escapeHtml(dayLabel(match.kickoff))}</div>`
        : `<div class="vs-score">${escapeHtml(match.home.score)}<span>–</span>${escapeHtml(match.away.score)}</div><div class="vs-day${match.state === 'in' ? ' live' : ''}">${escapeHtml(matchStatus(match))}</div>`;
      return `
        <div class="kicker">${escapeHtml(match.league)}${match.favourite ? ' · Your team' : ''}</div>
        <div class="versus">
          <div class="side">${crest(match.home.logo, 'crest-big')}<b>${escapeHtml(match.home.name)}</b></div>
          <div class="middle">${score}</div>
          <div class="side">${crest(match.away.logo, 'crest-big')}<b>${escapeHtml(match.away.name)}</b></div>
        </div>
        ${match.venue ? `<p class="summary">${escapeHtml(match.venue)}</p>` : ''}`;
    }
    const event = item as CityEvent;
    return `
      ${imageHtml(event.image, 'hero')}
      <div class="kicker">${escapeHtml([event.tags.slice(0, 2).join(' · '), event.free ? 'Free' : ''].filter(Boolean).join(' · '))}</div>
      <h2>${escapeHtml(event.title)}</h2>
      <div class="nmeta">${escapeHtml([event.venue, event.dates].filter(Boolean).join(' · '))}</div>
      ${event.lead ? `<p class="summary">${escapeHtml(event.lead)}</p>` : ''}
      ${event.url ? '<div class="ok"><kbd>OK</kbd>Open on paris.fr</div>' : ''}`;
  }

  function emptyText(): string {
    const football = tab === 'football';
    const status = data.status.get(football ? 'sports' : 'events');
    const loaded = football ? data.matchesAt : data.eventsAt;
    if (status?.ok === false) return football ? 'The football scores can’t be reached right now. Settings → Refresh everything now tries again.' : 'Paris’s picks can’t be reached right now. Settings → Refresh everything now tries again.';
    if (loaded === null) return football ? 'Loading this week’s matches…' : 'Loading this week’s picks…';
    return football ? 'No matches in your leagues this week.' : 'No picks this week.';
  }

  function renderTabs(): void {
    tabsNode.innerHTML = `<span class="tab-marker" id="whatson-tab-marker"></span>` + tabs().map(item =>
      `<span class="tab" data-focus="whatson-tab" data-tab="${item.id}">${escapeHtml(item.label)}</span>`).join('');
  }

  function render(): void {
    renderTabs();
    const list = items();
    index = Math.min(index, Math.max(0, list.length - 1));
    const updated = tab === 'football' ? data.matchesAt : data.eventsAt;
    subtitle.textContent = tab === 'football'
      ? `${config.sports.leagues.map(league => league.name).join(', ')}${updated ? ` · updated ${relativeAge(updated)}` : ''}`
      : `The City of Paris’s picks${updated ? ` · updated ${relativeAge(updated)}` : ''}`;
    track.innerHTML = list.length ? list.map(rowHtml).join('') : `<div class="empty">${escapeHtml(emptyText())}</div>`;
    applyFocus();
  }

  function applyFocus(): void {
    element.dataset.zone = zone;
    const tabNodes = Array.from(tabsNode.querySelectorAll<HTMLElement>('.tab'));
    tabNodes.forEach(node => {
      node.classList.toggle('active', node.dataset.tab === tab);
      node.classList.toggle('on', node.dataset.tab === tab && zone === 'tabs');
    });
    const marker = document.getElementById('whatson-tab-marker');
    const active = tabNodes.find(node => node.dataset.tab === tab);
    if (marker && active) {
      marker.style.transform = `translateX(${active.offsetLeft}px)`;
      marker.style.width = `${active.offsetWidth}px`;
      marker.classList.toggle('focused', zone === 'tabs');
    }
    const rows = Array.from(track.querySelectorAll<HTMLElement>('.row'));
    rows.forEach((row, position) => {
      row.classList.toggle('selected', position === index);
      row.classList.toggle('on', position === index && zone === 'list');
    });
    const row = rows[index];
    const offset = row ? Math.max(0, Math.min(row.offsetTop - listNode.clientHeight * 0.3, track.scrollHeight - listNode.clientHeight)) : 0;
    track.style.transform = `translateY(${-offset}px)`;
    const item = items()[index];
    const key = item ? `${tab}:${item.id}:${tab === 'football' ? (item as Match).status + (item as Match).home.score + (item as Match).away.score : ''}` : 'none';
    if (key !== detailKey) {
      const sameItem = detailKey.split(':').slice(0, 2).join(':') === key.split(':').slice(0, 2).join(':');
      detailKey = key;
      if (!sameItem) { detail.classList.remove('in'); void detail.offsetWidth; detail.classList.add('in'); }
      detail.innerHTML = item ? detailHtml(item) : '';
    }
  }

  function selectTab(next: Tab): void {
    if (next === tab) return;
    tab = next;
    index = 0;
    render();
  }

  function handle(action: Action): boolean {
    const list = items();
    const tabIds = tabs().map(item => item.id);
    const tabPosition = tabIds.indexOf(tab);
    if (action === 'left' && tabPosition > 0) { selectTab(tabIds[tabPosition - 1]!); return true; }
    if (action === 'right' && tabPosition < tabIds.length - 1) { selectTab(tabIds[tabPosition + 1]!); return true; }
    if (zone === 'tabs') {
      if ((action === 'down' || action === 'ok') && list.length) { zone = 'list'; applyFocus(); }
      else if (action === 'back' || action === 'up') close();
      return true;
    }
    if (action === 'up') { if (index > 0) index--; else zone = 'tabs'; applyFocus(); }
    else if (action === 'down' && index < list.length - 1) { index++; applyFocus(); }
    else if (action === 'pageDown') { index = Math.min(list.length - 1, index + 5); applyFocus(); }
    else if (action === 'pageUp') { index = Math.max(0, index - 5); applyFocus(); }
    else if (action === 'ok' && tab === 'paris') {
      const event = list[index] as CityEvent | undefined;
      if (event?.url) {
        toast('Opening paris.fr…');
        openUrl(event.url).catch(error => toast(`Couldn't open the browser: ${error instanceof Error ? error.message : String(error)}`, 'error'));
      }
    } else if (action === 'back') close();
    return true;
  }

  function pointer(target: HTMLElement): void {
    if (target.dataset.focus === 'whatson-tab' && target.dataset.tab) { zone = 'tabs'; selectTab(target.dataset.tab as Tab); applyFocus(); }
    else if (target.dataset.focus === 'whatson-row') { zone = 'list'; index = Number(target.dataset.index); applyFocus(); }
  }

  function focusOn(target: { tab: Tab; id?: string }): void {
    tab = target.tab === 'paris' && !config.parisEvents ? 'football' : target.tab;
    zone = 'list';
    const position = target.id ? items().findIndex(item => item.id === target.id) : -1;
    index = Math.max(0, position);
    render();
  }

  return { element, render, handle, pointer, enter: () => applyFocus(), focusOn };
}
