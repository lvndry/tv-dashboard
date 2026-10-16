import { config } from '../../config';
import type { NewsSection } from '../configTypes';
import type { BriefStory } from '../brief';
import { briefState, data, storyById } from '../data';
import { byId, escapeHtml, imageHtml, shorten, toast } from '../dom';
import { fetchText } from '../net';
import type { Story } from '../news';
import { embedUrl, freshNewsVideos, type NewsVideo } from '../videoNews';
import { openUrl, type Action } from '../platform';
import { settings } from '../store';
import { relativeAge, timeLabel } from '../time';
import type { View } from './view';

type Tab = { id: 'brief'; label: string } | { id: 'latest'; label: string } | { id: 'videos'; label: string } | { id: 'section'; label: string; section: NewsSection };

type Item = { kind: 'brief'; story: BriefStory; index: number } | { kind: 'story'; story: Story } | { kind: 'video'; video: NewsVideo; index: number };

const sectionOrder: NewsSection[] = ['France', 'World', 'Tech', 'Culture', 'Sport'];

const hostOf = (url: string): string => {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
};

const readerCache = new Map<string, { at: number; html: string }>();
const READER_TTL = 6 * 3600 * 1000;

/** r.jina.ai returns front-matter (Title/URL Source/Markdown Content:) then markdown. */
function readerToHtml(markdown: string, story: Story): string {
  const body = markdown
    .split('\n')
    .filter(line => !/^(Title:|URL Source:|Markdown Content:|Published:|Author:)\s*/.test(line))
    .join('\n')
    .trim();
  // Paragraphs: split on blank lines. Keep <img> lines as images, drop pure URLs & nav junk.
  const blocks = body.split(/\n{2,}/);
  const rendered = blocks
    .map(block => {
      const text = block.replace(/!\[[^\]]*\]\(([^)\s]+)\)/g, '<img class="rimg" src="$1" alt="" loading="lazy"/>')
        .replace(/\[([^\]]+)\]\([^)\s]+\)/g, '$1') // keep link text, drop URLs
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
        .replace(/\*([^*]+)\*/g, '<i>$1</i>')
        .trim();
      if (!text) return '';
      if (text.startsWith('<img')) return `<div class="rimgwrap">${text}</div>`;
      if (/^https?:\/\//.test(text) && text.length < 200) return '';
      // drop site chrome: very short all-caps lines that look like nav
      if (text.length < 12 && /[A-ZÀ-Ý]{4,}/.test(text) && !/\d/.test(text)) return '';
      return `<p>${escapeHtml(text).replace(/<\s*img[^>]*>/g, m => m)}</p>`;
    })
    .filter(Boolean)
    .slice(0, 40)
    .join('');
  return `<article class="reader">
    <div class="kicker">${escapeHtml(story.source)} · ${escapeHtml(story.section)} · ${relativeAge(story.published)}</div>
    <h2>${escapeHtml(story.title)}</h2>
    ${rendered || '<p class="summary">Nothing readable came back from the article.</p>'}
    <div class="ok"><kbd>OK</kbd>Open on ${escapeHtml(hostOf(story.link))} · <kbd>Back</kbd>Close</div>
  </article>`;
}

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
  let readerFor: Story | null = null;
  let readerLoading = false;

  let videos: NewsVideo[] = [];
  let videosAt = 0;

  async function loadVideos(force = false): Promise<void> {
    if (Date.now() - videosAt < 30 * 60 * 1000 && videos.length && !force) return;
    try {
      videos = await freshNewsVideos('actualités France', 6);
      videosAt = Date.now();
    } catch {
      // YouTube unreachable: the tab shows its empty state, the feeds are unaffected.
    }
  }

  function computeTabs(): Tab[] {
    const result: Tab[] = [];
    if (settings.briefEnabled && (data.brief || briefState() === 'loading')) result.push({ id: 'brief', label: 'Brief' });
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
    if (tab.id === 'brief') return (data.brief?.stories ?? []).map((story, index) => ({ kind: 'brief', story, index }));
    if (tab.id === 'videos') return videos.map((video, index) => ({ kind: 'video', video, index }));
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
        <div class="vplayer"><iframe class="vframe" src="${embedUrl(v.id)}" title="${escapeHtml(v.title)}"
          allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
        <div class="kicker">${escapeHtml(v.channel)} · ${escapeHtml(dur)}${v.published ? ` · ${escapeHtml(v.published)}` : ''} · YouTube</div>
        <h2>${escapeHtml(v.title)}</h2>
        <div class="ok"><kbd>OK</kbd>Play · <kbd>Right</kbd>Next clip · <kbd>Left</kbd>Previous</div>`;
    }
    const story = item.story;
    return `
      ${imageHtml(story.image, 'hero')}
      <div class="kicker">${escapeHtml(story.source)} · ${escapeHtml(story.section)} · ${relativeAge(story.published)}</div>
      <h2>${escapeHtml(story.title)}</h2>
      ${story.summary ? `<p class="summary">${escapeHtml(shorten(story.summary, 420))}</p>` : ''}
      <div class="ok"><kbd>OK</kbd>Read the full article here</div>`;
  }

  function renderDetail(force = false): void {
    const item = items()[listIndex];
    const key = item
      ? `${item.kind}:${item.kind === 'brief' ? item.story.headline : item.kind === 'video' ? item.video.id : item.story.id}:${zone === 'sources'}:${readerFor?.id ?? ''}`
      : 'none';
    if (!force && key === detailKey) return;
    const sameStory = detailKey.split(':').slice(0, 2).join(':') === key.split(':').slice(0, 2).join(':') && detailKey.endsWith(`:${readerFor?.id ?? ''}`);
    detailKey = key;
    if (sameStory && !readerFor) {
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
    const cached = readerCache.get(story.id);
    if (cached && Date.now() - cached.at < READER_TTL) {
      readerFor = story;
      readerLoading = false;
      detailNode.classList.remove('in');
      void detailNode.offsetWidth;
      detailNode.innerHTML = cached.html;
      detailNode.classList.add('in');
      return;
    }
    readerFor = story;
    readerLoading = true;
    toast(`Reading ${hostOf(story.link)}…`);
    detailNode.classList.remove('in');
    void detailNode.offsetWidth;
    detailNode.innerHTML = `<article class="reader"><div class="kicker">${escapeHtml(story.source)} · ${escapeHtml(story.section)}</div><h2>${escapeHtml(story.title)}</h2><div class="empty">Fetching the article…</div></article>`;
    detailNode.classList.add('in');
    try {
      const markdown = await fetchText(`https://r.jina.ai/${encodeURIComponent(story.link)}`, 20000);
      const html = readerToHtml(markdown, story);
      readerCache.set(story.id, { at: Date.now(), html });
      if (readerFor?.id !== story.id) return; // moved on while loading
      detailNode.innerHTML = html;
    } catch (error) {
      if (readerFor?.id !== story.id) return;
      const message = error instanceof Error ? error.message : String(error);
      toast(`Couldn't read the article (${message}). Opening on ${hostOf(story.link)} instead…`, 'error');
      readerFor = null;
      try { await openUrl(story.link); } catch { /* no browser handler on the TV */ }
    } finally {
      readerLoading = false;
    }
  }

  function activate(): void {
    const item = items()[listIndex];
    if (!item) return;
    if (item.kind === 'video') return; // OK on a video = play it (iframe already autoplaying)
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
      if (action === 'back') {
        readerFor = null;
        detailKey = '';
        renderDetail(true);
      } else if (action === 'ok' && !readerLoading) {
        void openUrl(readerFor.link);
      }
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
      if (onVideos && listIndex > 0) { listIndex--; applyFocus(); }
      else selectTab(tabIndex - 1);
    }
    else if (action === 'right') {
      if (onVideos && listIndex < count - 1) { listIndex++; applyFocus(); }
      else selectTab(tabIndex + 1);
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

  function focusTarget(target?: { briefIndex?: number; storyId?: string }): void {
    tabs = computeTabs();
    zone = 'list';
    readerFor = null;
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
