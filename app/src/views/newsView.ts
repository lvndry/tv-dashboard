import { config } from '../../config';
import type { NewsSection } from '../configTypes';
import type { BriefStory } from '../brief';
import { briefState, data, storyById } from '../data';
import { byId, escapeHtml, imageHtml, shorten, toast } from '../dom';
import { readArticle } from '../articleReader';
import type { DiscoverStory } from '../discover';
import type { Story } from '../news';
import { embedUrl, latestNewsVideos, type NewsVideo } from '../videoNews';
import { isTizen, openUrl, playOnYouTube, type Action } from '../platform';
import { settings } from '../store';
import { relativeAge, timeLabel } from '../time';
import type { View } from './view';

type Tab = { id: 'top'; label: string } | { id: 'brief'; label: string } | { id: 'latest'; label: string } | { id: 'videos'; label: string } | { id: 'section'; label: string; section: NewsSection };

type Item = { kind: 'discover'; story: DiscoverStory } | { kind: 'brief'; story: BriefStory; index: number } | { kind: 'story'; story: Story } | { kind: 'video'; video: NewsVideo; index: number };

const sectionOrder: NewsSection[] = ['France', 'World', 'Tech', 'Culture', 'Sport'];

const hostOf = (url: string): string => {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
};

const readerCache = new Map<string, { at: number; html: string }>();
const READER_TTL = 6 * 3600 * 1000;

function readerHtml(story: Story, body: string): string {
  return `<article class="reader">
    <div class="kicker">${escapeHtml(story.source)} · ${escapeHtml(story.section)} · ${relativeAge(story.published)}</div>
    <h2>${escapeHtml(story.title)}</h2>
    ${body}
    <div class="ok"><kbd>OK</kbd>Open on ${escapeHtml(hostOf(story.link))} · <kbd>Back</kbd>Close</div>
  </article>`;
}

/** Bullets keep their **bold** phrases: the text is escaped first, then only those markers become <b>. */
const boldMarkdown = (text: string): string => escapeHtml(text).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');

export function createNewsView(close: () => void): View & { focusTarget(target?: { briefIndex?: number; storyId?: string; discoverId?: string }): void } {
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
  let zone: 'tabs' | 'list' | 'sources' | 'detail' = 'list';
  let detailKey = '';
  let readerFor: Story | null = null;
  let readerLoading = false;

  let videos: NewsVideo[] = [];
  let videosAt = 0;

  async function loadVideos(force = false): Promise<void> {
    if (Date.now() - videosAt < 30 * 60 * 1000 && videos.length && !force) return;
    try {
      videos = await latestNewsVideos(['actualités France', 'info France', 'actualité internationale', 'journal télévisé'], 8);
      videosAt = Date.now();
    } catch {
      // YouTube unreachable: the tab shows its empty state, the feeds are unaffected.
    }
  }

  function computeTabs(): Tab[] {
    const result: Tab[] = [];
    if (data.discover.length) result.push({ id: 'top', label: 'Top stories' });
    if (!data.discover.length && settings.briefEnabled && (data.brief || briefState() === 'loading')) result.push({ id: 'brief', label: 'Brief' });
    result.push({ id: 'latest', label: 'Latest' });
    result.push({ id: 'videos', label: "À l'instant" });
    for (const section of sectionOrder) {
      if (data.stories.some(story => story.section === section)) result.push({ id: 'section', label: section, section });
    }
    return result;
  }

  function items(): Item[] {
    const tab = tabs[tabIndex];
    if (!tab) return [];
    if (tab.id === 'top') return data.discover.map(story => ({ kind: 'discover', story }));
    if (tab.id === 'brief') return (data.brief?.stories ?? []).map((story, index) => ({ kind: 'brief', story, index }));
    if (tab.id === 'videos') return videos.map((video, index) => ({ kind: 'video', video, index }));
    const stories = tab.id === 'latest' ? data.stories : data.stories.filter(story => story.section === tab.section);
    return stories.slice(0, 60).map(story => ({ kind: 'story', story }));
  }

  function sourcesOf(story: BriefStory): Story[] {
    return story.storyIds.map(storyById).filter((item): item is Story => !!item);
  }

  function renderSubtitle(): void {
    const sources = new Set(config.news.map(feed => feed.name)).size;
    const tab = tabs[tabIndex];
    if (tab?.id === 'top') {
      subtitle.textContent = `Perplexity Discover · the last 48 hours${data.discoverAt ? ` · updated ${relativeAge(data.discoverAt)}` : ''}`;
    } else if (tab?.id === 'brief') {
      subtitle.textContent = data.briefLoading && !data.brief
        ? `Perplexity is reading ${Math.min(40, data.stories.length)} headlines…`
        : `Written ${data.briefAt ? `at ${timeLabel(data.briefAt)}` : ''} by Perplexity from ${sources} sources${data.briefLoading ? ' · updating…' : ''}`;
    } else if (tab?.id === 'videos') {
      subtitle.textContent = videos.length ? `Fresh news clips, newest first · updated ${relativeAge(videosAt)}` : 'Contacting YouTube…';
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
        : `<div class="empty">${tabs[tabIndex]?.id === 'videos' ? 'No videos right now — YouTube may be slow.' : 'Nothing here yet.'}</div>`;
      return;
    }
    listTrack.innerHTML = list.map((item, index) => {
      if (item.kind === 'discover') {
        return `<div class="row" data-focus="row" data-index="${index}">
          ${imageHtml(item.story.thumb, 'rthumb')}
          <div class="rtext"><div class="rtitle">${escapeHtml(item.story.title)}</div>
          <div class="rmeta">${relativeAge(item.story.published)}${item.story.sourceCount ? ` · ${item.story.sourceCount} sources` : ''}</div></div></div>`;
      }
      if (item.kind === 'brief') {
        const sources = sourcesOf(item.story);
        return `<div class="row" data-focus="row" data-index="${index}">
          ${imageHtml(sources.find(source => source.image)?.image, 'rthumb')}
          <div class="rtext"><div class="rtitle">${escapeHtml(item.story.headline)}</div>
          <div class="rmeta">${escapeHtml(item.story.section)} · ${sources.length} source${sources.length === 1 ? '' : 's'}</div></div></div>`;
      }
      if (item.kind === 'video') {
        const dur = item.video.duration === 'short' ? 'Short' : item.video.duration;
        return `<div class="row vrow" data-focus="row" data-index="${index}">
          <div class="rthumb vthumb"><img src="${escapeHtml(item.video.thumb)}" alt="" loading="lazy"/><span class="vplay">▶</span></div>
          <div class="rtext"><div class="rtitle">${escapeHtml(item.video.title)}</div>
          <div class="rmeta">${escapeHtml(item.video.channel)} · ${escapeHtml(dur)}${item.video.published ? ` · ${escapeHtml(item.video.published)}` : ''}</div></div></div>`;
      }
      return `<div class="row" data-focus="row" data-index="${index}">
        ${imageHtml(item.story.image, 'rthumb')}
        <div class="rtext"><div class="rtitle">${escapeHtml(item.story.title)}</div>
        <div class="rmeta">${escapeHtml(item.story.source)} · ${relativeAge(item.story.published)}</div></div></div>`;
    }).join('');
  }

  function detailHtml(item: Item): string {
    if (item.kind === 'discover') {
      const story = item.story;
      return `
        ${imageHtml(story.image, 'hero')}
        <div class="kicker">Perplexity Discover · ${relativeAge(story.published)}${story.sourceCount ? ` · ${story.sourceCount} sources` : ''}</div>
        <h2>${escapeHtml(story.title)}</h2>
        ${story.summary ? `<p class="summary">${escapeHtml(story.summary)}</p>` : ''}
        ${story.bullets.length ? `<ul class="bullets">${story.bullets.map(bullet => `<li>${boldMarkdown(bullet)}</li>`).join('')}</ul>` : ''}
        ${story.description ? `<p class="summary">${escapeHtml(story.description)}</p>` : ''}
        ${story.sourceHosts.length ? `<div class="nmeta">Sources include ${escapeHtml(story.sourceHosts.join(', '))}</div>` : ''}
        <div class="ok"><kbd>◀</kbd>Focus to scroll${story.url ? ' · <kbd>OK</kbd>Open on Perplexity' : ''}</div>`;
    }
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
        <div class="ok"><kbd>OK</kbd>${zone === 'sources' ? 'Read this article' : 'Choose a source to read'}</div>`;
    }
    if (item.kind === 'video') {
      const v = item.video;
      const dur = v.duration === 'short' ? 'Short' : v.duration;
      return `
        ${isTizen ? `<div class="vplayer vposter">${imageHtml(v.thumb, 'hero')}<span class="vplay big">▶</span></div>` : `<div class="vplayer"><iframe class="vframe" src="${embedUrl(v.id)}" title="${escapeHtml(v.title)}" referrerpolicy="strict-origin-when-cross-origin"
          allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>`}
        <div class="kicker">${escapeHtml(v.channel)} · ${escapeHtml(dur)}${v.published ? ` · ${escapeHtml(v.published)}` : ''} · YouTube</div>
        <h2>${escapeHtml(v.title)}</h2>
        <div class="ok"><kbd>OK</kbd>${isTizen ? 'Play on YouTube' : 'Play'} · <kbd>▶</kbd>Next clip · <kbd>◀</kbd>Previous</div>`;
    }
    const story = item.story;
    return `
      ${imageHtml(story.image, 'hero')}
      <div class="kicker">${escapeHtml(story.source)} · ${escapeHtml(story.section)} · ${relativeAge(story.published)}</div>
      <h2>${escapeHtml(story.title)}</h2>
      ${story.summary ? `<p class="summary">${escapeHtml(shorten(story.summary, 420))}</p>` : ''}
      <div class="ok"><kbd>OK</kbd>Read the full article here</div>`;
  }

  /** The open article owns the pane; openReader and its Back key draw it, so refreshes leave it alone. */
  function renderDetail(force = false): void {
    if (readerFor) return;
    const item = items()[listIndex];
    const key = item
      ? `${item.kind}:${item.kind === 'brief' ? item.story.headline : item.kind === 'video' ? item.video.id : item.story.id}:${zone === 'sources'}`
      : 'none';
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
    detailNode.classList.toggle('focused', zone === 'detail');
    detailNode.classList.toggle('reading', !!readerFor);
  }

  /** The article pane scrolls when it has focus; the remote's ▲ ▼ move it a screenful at a time. */
  function scrollDetail(direction: 1 | -1): void {
    detailNode.scrollBy({ top: direction * Math.round(detailNode.clientHeight * 0.7), behavior: 'smooth' });
  }

  function focusDetail(): void {
    zone = 'detail';
    applyFocus();
  }

  function leaveDetail(): void {
    zone = 'list';
    detailNode.scrollTop = 0;
    applyFocus();
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
    if (tabs[tabIndex]?.id === 'videos') void loadVideos().then(() => { renderSubtitle(); renderList(); applyFocus(); });
  }

  function selectTab(index: number): void {
    if (index < 0 || index >= tabs.length || index === tabIndex) return;
    tabIndex = index;
    listIndex = 0;
    readerFor = null;
    renderSubtitle();
    renderList();
    applyFocus();
    if (tabs[tabIndex]?.id === 'videos') void loadVideos().then(() => { renderSubtitle(); renderList(); applyFocus(); });
  }

  async function openReader(story: Story): Promise<void> {
    readerFor = story;
    zone = 'detail';
    detailNode.scrollTop = 0;
    const cached = readerCache.get(story.id);
    if (cached && Date.now() - cached.at < READER_TTL) {
      readerLoading = false;
      detailNode.innerHTML = cached.html;
      applyFocus();
      return;
    }
    readerLoading = true;
    toast(`Reading ${hostOf(story.link)}…`);
    detailNode.classList.remove('in');
    void detailNode.offsetWidth;
    detailNode.innerHTML = readerHtml(story, '<div class="empty">Fetching the article…</div>');
    detailNode.classList.add('in');
    applyFocus();
    try {
      const html = readerHtml(story, await readArticle(story.link));
      readerCache.set(story.id, { at: Date.now(), html });
      if (readerFor?.id !== story.id) return;
      detailNode.innerHTML = html;
    } catch (error) {
      if (readerFor?.id !== story.id) return;
      const message = error instanceof Error ? error.message : String(error);
      toast(`Couldn't read the article (${message}). Opening on ${hostOf(story.link)} instead…`, 'error');
      readerFor = null;
      detailKey = '';
      zone = 'list';
      applyFocus();
      try { await openUrl(story.link); } catch { /* no browser handler on the TV */ }
    } finally {
      readerLoading = false;
    }
  }

  function activate(): void {
    const item = items()[listIndex];
    if (!item) return;
    if (item.kind === 'video') {
      if (!isTizen) return; // the inline player is already playing
      toast('Opening YouTube…');
      playOnYouTube(item.video.id).catch(error => toast(`YouTube didn't open: ${error instanceof Error ? error.message : String(error)}`, 'error'));
      return;
    }
    if (item.kind === 'discover') {
      if (item.story.url) openUrl(item.story.url).catch(error => toast(`Couldn't open the browser: ${error instanceof Error ? error.message : String(error)}`, 'error'));
      return;
    }
    if (zone === 'sources' && item.kind === 'brief') {
      const source = sourcesOf(item.story)[sourceIndex];
      if (source) void openReader(source);
      return;
    }
    if (item.kind === 'brief') {
      if (!sourcesOf(item.story).length) return;
      zone = 'sources';
      sourceIndex = 0;
      applyFocus();
      return;
    }
    void openReader(item.story);
  }

  function handle(action: Action): boolean {
    const count = items().length;
    const onVideos = tabs[tabIndex]?.id === 'videos';
    if (readerFor) {
      if (action === 'up') scrollDetail(-1);
      else if (action === 'down') scrollDetail(1);
      else if (action === 'pageUp') scrollDetail(-1);
      else if (action === 'pageDown') scrollDetail(1);
      else if (action === 'back' || action === 'right') {
        readerFor = null;
        detailKey = '';
        zone = 'list';
        detailNode.scrollTop = 0;
        renderDetail(true);
        applyFocus();
      } else if (action === 'ok' && !readerLoading) {
        void openUrl(readerFor.link);
      }
      return true;
    }
    if (zone === 'detail') {
      if (action === 'up' || action === 'pageUp') scrollDetail(-1);
      else if (action === 'down' || action === 'pageDown') scrollDetail(1);
      else if (action === 'right' || action === 'back') leaveDetail();
      else if (action === 'ok') activate();
      return true;
    }
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
    else if (action === 'left') {
      if (onVideos) { if (listIndex > 0) { listIndex--; applyFocus(); } }
      else if (count) focusDetail();
    }
    else if (action === 'right') {
      if (onVideos && listIndex < count - 1) { listIndex++; applyFocus(); }
    }
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

  function focusTarget(target?: { briefIndex?: number; storyId?: string; discoverId?: string }): void {
    tabs = computeTabs();
    zone = 'list';
    readerFor = null;
    if (target?.discoverId && tabs[0]?.id === 'top') {
      tabIndex = 0;
      listIndex = Math.max(0, data.discover.findIndex(story => story.id === target.discoverId));
    } else if (target?.briefIndex !== undefined && tabs.some(tab => tab.id === 'brief')) {
      tabIndex = tabs.findIndex(tab => tab.id === 'brief');
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
