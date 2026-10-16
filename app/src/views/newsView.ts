import { config } from '../../config';
import type { NewsSection } from '../configTypes';
import type { BriefStory } from '../brief';
import { briefState, data, storyById } from '../data';
import { byId, escapeHtml, imageHtml, shorten, toast } from '../dom';
import type { Story } from '../news';
import { openUrl, type Action } from '../platform';
import { settings } from '../store';
import { relativeAge, timeLabel } from '../time';
import type { View } from './view';

type Tab = { id: 'brief'; label: string } | { id: 'latest'; label: string } | { id: 'section'; label: string; section: NewsSection };

type Item = { kind: 'brief'; story: BriefStory; index: number } | { kind: 'story'; story: Story };

const sectionOrder: NewsSection[] = ['France', 'World', 'Tech', 'Culture', 'Sport'];

const hostOf = (url: string): string => {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
};

export function createNewsView(close: () => void): View & { focusTarget(target?: { briefIndex?: number; storyId?: string }): void } {
  const element = byId('news');
  const tabsNode = byId('news-tabs');
  const listNode = byId('news-list');
  const listTrack = byId('news-track');
  const detailNode = byId('news-detail');
  const subtitle = byId('news-subtitle');

  let tabs: Tab[] = [];
  let tabIndex = 0;
  let listIndex = 0;
  let sourceIndex = 0;
  let zone: 'tabs' | 'list' | 'sources' = 'list';
  let detailKey = '';

  function computeTabs(): Tab[] {
    const result: Tab[] = [];
    if (settings.briefEnabled && (data.brief || briefState() === 'loading')) result.push({ id: 'brief', label: 'Brief' });
    result.push({ id: 'latest', label: 'Latest' });
    for (const section of sectionOrder) {
      if (data.stories.some(story => story.section === section)) result.push({ id: 'section', label: section, section });
    }
    return result;
  }

  function items(): Item[] {
    const tab = tabs[tabIndex];
    if (!tab) return [];
    if (tab.id === 'brief') return (data.brief?.stories ?? []).map((story, index) => ({ kind: 'brief', story, index }));
    const stories = tab.id === 'latest' ? data.stories : data.stories.filter(story => story.section === tab.section);
    return stories.slice(0, 40).map(story => ({ kind: 'story', story }));
  }

  function sourcesOf(story: BriefStory): Story[] {
    return story.storyIds.map(storyById).filter((item): item is Story => !!item);
  }

  function renderSubtitle(): void {
    const sources = new Set(config.news.map(feed => feed.name)).size;
    const tab = tabs[tabIndex];
    if (tab?.id === 'brief') {
      subtitle.textContent = data.briefLoading && !data.brief
        ? `Claude is reading ${Math.min(40, data.stories.length)} headlines…`
        : `Written ${data.briefAt ? `at ${timeLabel(data.briefAt)}` : ''} by Claude from ${sources} sources${data.briefLoading ? ' · updating…' : ''}`;
    } else {
      subtitle.textContent = data.newsAt ? `Newest first · ${sources} sources · updated ${relativeAge(data.newsAt)}` : 'Fetching the feeds…';
    }
  }

  function renderTabs(): void {
    tabsNode.innerHTML = `<span class="tab-marker" id="tab-marker"></span>` + tabs.map((tab, index) =>
      `<span class="tab" data-focus="tab" data-index="${index}">${escapeHtml(tab.label)}</span>`).join('');
  }

  function renderList(): void {
    const list = items();
    if (!list.length) {
      const loading = tabs[tabIndex]?.id === 'brief' && data.briefLoading;
      listTrack.innerHTML = loading
        ? Array.from({ length: 5 }, () => `<div class="row skeleton"><div class="rthumb"></div><div class="rtext"><i></i><i></i></div></div>`).join('')
        : `<div class="empty">Nothing here yet.</div>`;
      return;
    }
    listTrack.innerHTML = list.map((item, index) => {
      if (item.kind === 'brief') {
        const sources = sourcesOf(item.story);
        return `<div class="row" data-focus="row" data-index="${index}">
          ${imageHtml(sources.find(source => source.image)?.image, 'rthumb')}
          <div class="rtext"><div class="rtitle">${escapeHtml(item.story.headline)}</div>
          <div class="rmeta">${escapeHtml(item.story.section)} · ${sources.length} source${sources.length === 1 ? '' : 's'}</div></div></div>`;
      }
      return `<div class="row" data-focus="row" data-index="${index}">
        ${imageHtml(item.story.image, 'rthumb')}
        <div class="rtext"><div class="rtitle">${escapeHtml(item.story.title)}</div>
        <div class="rmeta">${escapeHtml(item.story.source)} · ${relativeAge(item.story.published)}</div></div></div>`;
    }).join('');
  }

  function detailHtml(item: Item): string {
    if (item.kind === 'brief') {
      const sources = sourcesOf(item.story);
      return `
        ${imageHtml(sources.find(source => source.image)?.image, 'hero')}
        <div class="kicker">${escapeHtml(item.story.section)} · summarised from ${sources.length} article${sources.length === 1 ? '' : 's'}</div>
        <h2>${escapeHtml(item.story.headline)}</h2>
        <p class="summary">${escapeHtml(item.story.summary)}</p>
        <div class="sources">${sources.map((source, index) => `
          <div class="source" data-focus="source" data-index="${index}">
            <b>${escapeHtml(source.source)}</b><span>${escapeHtml(shorten(source.title, 80))}</span><em>${relativeAge(source.published)}</em>
          </div>`).join('')}</div>
        <div class="ok"><kbd>OK</kbd>${zone === 'sources' ? 'Open this article' : 'Choose a source to read'}</div>`;
    }
    const story = item.story;
    return `
      ${imageHtml(story.image, 'hero')}
      <div class="kicker">${escapeHtml(story.source)} · ${escapeHtml(story.section)} · ${relativeAge(story.published)}</div>
      <h2>${escapeHtml(story.title)}</h2>
      ${story.summary ? `<p class="summary">${escapeHtml(shorten(story.summary, 420))}</p>` : ''}
      <div class="ok"><kbd>OK</kbd>Read on ${escapeHtml(hostOf(story.link))}</div>`;
  }

  function renderDetail(force = false): void {
    const item = items()[listIndex];
    const key = item ? `${item.kind}:${item.kind === 'brief' ? item.story.headline : item.story.id}:${zone === 'sources'}` : 'none';
    if (!force && key === detailKey) return;
    const sameStory = detailKey.split(':').slice(0, 2).join(':') === key.split(':').slice(0, 2).join(':');
    detailKey = key;
    if (sameStory) {
      if (item) detailNode.innerHTML = detailHtml(item);
      return;
    }
    detailNode.classList.remove('in');
    void detailNode.offsetWidth;
    detailNode.innerHTML = item ? detailHtml(item) : '';
    detailNode.classList.add('in');
  }

  function applyFocus(): void {
    const tabNodes = Array.from(tabsNode.querySelectorAll<HTMLElement>('.tab'));
    const marker = document.getElementById('tab-marker');
    tabNodes.forEach((node, index) => node.classList.toggle('active', index === tabIndex));
    tabNodes.forEach(node => node.classList.remove('on'));
    const activeTab = tabNodes[tabIndex];
    if (marker && activeTab) {
      marker.style.transform = `translateX(${activeTab.offsetLeft}px)`;
      marker.style.width = `${activeTab.offsetWidth}px`;
      marker.classList.toggle('focused', zone === 'tabs');
      activeTab.classList.toggle('on', zone === 'tabs');
    }
    const rows = Array.from(listTrack.querySelectorAll<HTMLElement>('.row[data-index]'));
    rows.forEach((row, index) => {
      row.classList.toggle('on', index === listIndex && zone === 'list');
      row.classList.toggle('selected', index === listIndex);
    });
    const row = rows[listIndex];
    if (row) {
      const viewport = listNode.clientHeight;
      const offset = Math.max(0, Math.min(row.offsetTop - viewport * 0.3, listTrack.scrollHeight - viewport));
      listTrack.style.transform = `translateY(${-offset}px)`;
    } else {
      listTrack.style.transform = 'none';
    }
    renderDetail();
    const sourceNodes = Array.from(detailNode.querySelectorAll<HTMLElement>('.source'));
    sourceNodes.forEach((node, index) => node.classList.toggle('on', zone === 'sources' && index === sourceIndex));
    element.dataset.zone = zone;
  }

  function render(): void {
    const previousTab = tabs[tabIndex];
    tabs = computeTabs();
    const restored = previousTab ? tabs.findIndex(tab => tab.label === previousTab.label) : -1;
    tabIndex = restored >= 0 ? restored : 0;
    listIndex = Math.min(listIndex, Math.max(0, items().length - 1));
    renderTabs();
    renderSubtitle();
    renderList();
    renderDetail(true);
    applyFocus();
  }

  function selectTab(index: number): void {
    if (index < 0 || index >= tabs.length || index === tabIndex) return;
    tabIndex = index;
    listIndex = 0;
    renderSubtitle();
    renderList();
    applyFocus();
  }

  async function openStory(story: Story): Promise<void> {
    toast(`Opening ${hostOf(story.link)}…`);
    try {
      await openUrl(story.link);
    } catch (error) {
      toast(`Couldn't open the browser: ${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  }

  function activate(): void {
    const item = items()[listIndex];
    if (!item) return;
    if (zone === 'sources' && item.kind === 'brief') {
      const source = sourcesOf(item.story)[sourceIndex];
      if (source) void openStory(source);
      return;
    }
    if (item.kind === 'brief') {
      if (!sourcesOf(item.story).length) return;
      zone = 'sources';
      sourceIndex = 0;
      applyFocus();
      return;
    }
    void openStory(item.story);
  }

  function handle(action: Action): boolean {
    const count = items().length;
    if (zone === 'tabs') {
      if (action === 'left') selectTab(tabIndex - 1);
      else if (action === 'right') selectTab(tabIndex + 1);
      else if (action === 'down' && count) { zone = 'list'; applyFocus(); }
      else if (action === 'back' || action === 'up') close();
      else if (action === 'ok' && count) { zone = 'list'; applyFocus(); }
      return true;
    }
    if (zone === 'sources') {
      const item = items()[listIndex];
      const sourceCount = item?.kind === 'brief' ? sourcesOf(item.story).length : 0;
      if (action === 'up' && sourceIndex > 0) { sourceIndex--; applyFocus(); }
      else if (action === 'down' && sourceIndex < sourceCount - 1) { sourceIndex++; applyFocus(); }
      else if (action === 'back' || action === 'right') { zone = 'list'; applyFocus(); }
      else if (action === 'ok') activate();
      return true;
    }
    if (action === 'up') { if (listIndex > 0) { listIndex--; applyFocus(); } else { zone = 'tabs'; applyFocus(); } }
    else if (action === 'down' && listIndex < count - 1) { listIndex++; applyFocus(); }
    else if (action === 'pageDown') { listIndex = Math.min(count - 1, listIndex + 5); applyFocus(); }
    else if (action === 'pageUp') { listIndex = Math.max(0, listIndex - 5); applyFocus(); }
    else if (action === 'left') selectTab(tabIndex - 1);
    else if (action === 'right') selectTab(tabIndex + 1);
    else if (action === 'ok') activate();
    else if (action === 'back') close();
    return true;
  }

  function pointer(target: HTMLElement): void {
    const index = Number(target.dataset.index);
    if (target.dataset.focus === 'tab') { selectTab(index); zone = 'tabs'; applyFocus(); }
    else if (target.dataset.focus === 'row') { listIndex = index; zone = 'list'; applyFocus(); }
    else if (target.dataset.focus === 'source') { zone = 'sources'; sourceIndex = index; applyFocus(); }
  }

  function focusTarget(target?: { briefIndex?: number; storyId?: string }): void {
    tabs = computeTabs();
    zone = 'list';
    if (target?.briefIndex !== undefined && tabs[0]?.id === 'brief') {
      tabIndex = 0;
      listIndex = target.briefIndex;
    } else if (target?.storyId) {
      tabIndex = tabs.findIndex(tab => tab.id === 'latest');
      listIndex = Math.max(0, data.stories.findIndex(story => story.id === target.storyId));
    } else {
      tabIndex = 0;
      listIndex = 0;
    }
    detailKey = '';
    render();
  }

  return { element, render, handle, pointer, enter: () => applyFocus(), focusTarget };
}
