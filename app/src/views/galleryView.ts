import { artReady, regions, favouriteWorks, galleryWorks, isFavourite, loadArtwork, toggleFavourite, type Artwork, type Region } from '../art';
import { captionHtml, fillsScreen } from '../artCaption';
import { artDetails, cachedDetails } from '../artDetails';
import { byId, escapeHtml, toast } from '../dom';
import type { Action } from '../platform';
import { settings, updateSettings } from '../store';
import type { View } from './view';

type Tab = { id: 'all' | 'favourites' | Region; label: string; works: Artwork[] };

const columns = 5;
const tileWidth = 304;
const tileHeight = 200;
const gap = 20;
const rowHeight = tileHeight + gap;
const renderedRowsAround = 4;

const chronological = (first: Artwork, second: Artwork): number =>
  (first.year ?? Number.MAX_SAFE_INTEGER) - (second.year ?? Number.MAX_SAFE_INTEGER);

export function createGalleryView(close: () => void): View {
  const element = byId('gallery');
  const tabsNode = byId('gallery-tabs');
  const track = byId('gallery-track');
  const focusNode = byId('gallery-focus');
  const subtitle = byId('gallery-subtitle');
  const viewer = byId('viewer');
  const viewerCaption = byId('viewer-caption');

  let tabs: Tab[] = [];
  let tabIndex = 0;
  let index = 0;
  let zone: 'tabs' | 'grid' | 'viewer' = 'grid';
  let viewerFront = 0;
  let viewerRequest = 0;
  let slideshowTimer: ReturnType<typeof setTimeout> | undefined;

  /** The viewer is a slideshow: each work stays up for the ambient interval, then the next one comes in. */
  function scheduleNext(): void {
    clearTimeout(slideshowTimer);
    if (!settings.slideshow) return;
    slideshowTimer = setTimeout(() => {
      if (zone !== 'viewer') return;
      const works = currentWorks();
      index = works.length ? (index + 1) % works.length : 0;
      void showInViewer();
    }, settings.artSeconds * 1000);
  }
  let loading = false;

  function computeTabs(): Tab[] {
    const all = galleryWorks().slice().sort(chronological);
    const result: Tab[] = [{ id: 'all', label: 'All', works: all }];
    const favourites = favouriteWorks();
    if (favourites.length) result.push({ id: 'favourites', label: 'Favourites', works: favourites });
    for (const region of regions) {
      const works = all.filter(work => work.region === region);
      if (works.length) result.push({ id: region, label: region, works });
    }
    return result;
  }

  const currentWorks = (): Artwork[] => tabs[tabIndex]?.works ?? [];

  function renderTabs(): void {
    tabsNode.innerHTML = `<span class="tab-marker" id="gallery-tab-marker"></span>` + tabs.map((tab, tabPosition) =>
      `<span class="tab" data-focus="gallery-tab" data-index="${tabPosition}">${escapeHtml(tab.label)}<small>${tab.works.length}</small></span>`).join('');
  }

  function renderSubtitle(): void {
    const total = galleryWorks().length;
    subtitle.textContent = total
      ? `${total.toLocaleString('en-GB')} public-domain works, from ancient Egypt to Romanticism`
      : loading ? 'Gathering the collection from museums around the world…' : 'The collection could not be loaded. Check Settings → Sources.';
  }

  function renderGrid(): void {
    const works = currentWorks();
    const rows = Math.ceil(works.length / columns);
    track.style.height = `${rows * rowHeight}px`;
    const focusRow = Math.floor(index / columns);
    const firstRow = Math.max(0, focusRow - renderedRowsAround);
    const lastRow = Math.min(rows - 1, focusRow + renderedRowsAround + 1);
    const tiles: string[] = [];
    for (let row = firstRow; row <= lastRow; row++) {
      for (let column = 0; column < columns; column++) {
        const position = row * columns + column;
        const work = works[position];
        if (!work) break;
        tiles.push(`<div class="tile${position === index ? ' on' : ''}${isFavourite(work) ? ' favourite' : ''}" data-focus="tile" data-index="${position}" style="transform:translate(${column * (tileWidth + gap)}px,${row * rowHeight}px)">
          <img src="${escapeHtml(work.thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer">
        </div>`);
      }
    }
    track.innerHTML = tiles.join('') || `<div class="empty">${loading ? 'Gathering the collection…' : 'Nothing here yet.'}</div>`;
    track.style.transform = `translateY(${-Math.max(0, (focusRow - 1) * rowHeight)}px)`;
    const work = works[index];
    focusNode.innerHTML = work ? `
      <div class="gtitle">${escapeHtml(work.title)}${isFavourite(work) ? ' <span class="heart">♥</span>' : ''}</div>
      <div class="gmeta">${escapeHtml([work.maker, work.date, work.place].filter(Boolean).join(' · '))}</div>` : '';
  }

  function applyFocus(): void {
    element.dataset.zone = zone;
    const tabNodes = Array.from(tabsNode.querySelectorAll<HTMLElement>('.tab'));
    tabNodes.forEach((node, tabPosition) => {
      node.classList.toggle('active', tabPosition === tabIndex);
      node.classList.toggle('on', tabPosition === tabIndex && zone === 'tabs');
    });
    const marker = document.getElementById('gallery-tab-marker');
    const active = tabNodes[tabIndex];
    if (marker && active) {
      marker.style.transform = `translateX(${active.offsetLeft}px)`;
      marker.style.width = `${active.offsetWidth}px`;
      marker.classList.toggle('focused', zone === 'tabs');
    }
    renderGrid();
  }

  function render(): void {
    const previousLabel = tabs[tabIndex]?.label;
    tabs = computeTabs();
    const restored = tabs.findIndex(tab => tab.label === previousLabel);
    tabIndex = restored >= 0 ? restored : 0;
    index = Math.min(index, Math.max(0, currentWorks().length - 1));
    renderTabs();
    renderSubtitle();
    applyFocus();
  }

  function selectTab(position: number): void {
    if (position < 0 || position >= tabs.length || position === tabIndex) return;
    tabIndex = position;
    index = 0;
    applyFocus();
  }

  async function showInViewer(): Promise<void> {
    const work = currentWorks()[index];
    if (!work) return;
    const request = ++viewerRequest;
    viewerCaption.classList.add('out');
    let loaded;
    try {
      loaded = await loadArtwork(work);
    } catch {
      if (request === viewerRequest) toast('That image could not be loaded', 'error');
      return;
    }
    if (request !== viewerRequest || zone !== 'viewer') return;
    const frames = [byId('viewer-a'), byId('viewer-b')];
    const incoming = frames[1 - viewerFront]!;
    const outgoing = frames[viewerFront]!;
    const url = escapeHtml(loaded.image);
    incoming.className = `art-frame ${fillsScreen(loaded.width, loaded.height) ? 'fill' : 'framed'}`;
    incoming.style.setProperty('--art-duration', `${settings.artSeconds + 10}s`);
    incoming.style.setProperty('--pan-x', '0%');
    incoming.style.setProperty('--pan-y', '0%');
    incoming.innerHTML = `<img class="art-backdrop" src="${escapeHtml(loaded.thumb || loaded.image)}" alt=""><img class="art-image" src="${url}" alt="">`;
    void incoming.offsetWidth;
    incoming.classList.add('visible');
    outgoing.classList.remove('visible');
    viewerFront = 1 - viewerFront;
    renderViewerCaption();
    viewerCaption.classList.remove('out');
    scheduleNext();
    const works = currentWorks();
    for (const neighbour of [works[index + 1], works[index - 1]]) {
      if (neighbour) new Image().src = neighbour.image;
    }
  }

  function renderViewerCaption(): void {
    const work = currentWorks()[index];
    if (!work) return;
    viewerCaption.dataset.work = work.id;
    viewerCaption.innerHTML = captionHtml(work, cachedDetails(work), 'viewer');
    void artDetails(work, details => {
      if (viewerCaption.dataset.work === work.id && zone === 'viewer') viewerCaption.innerHTML = captionHtml(work, details, 'viewer');
    });
  }

  function openViewer(): void {
    if (!currentWorks()[index]) return;
    zone = 'viewer';
    viewer.classList.add('open');
    element.dataset.zone = zone;
    void showInViewer();
  }

  function closeViewer(): void {
    zone = 'grid';
    viewerRequest++;
    clearTimeout(slideshowTimer);
    viewer.classList.remove('open');
    byId('viewer-a').classList.remove('visible');
    byId('viewer-b').classList.remove('visible');
    render();
  }

  function handle(action: Action): boolean {
    const works = currentWorks();
    if (zone === 'viewer') {
      if (action === 'right' && index < works.length - 1) { index++; void showInViewer(); }
      else if (action === 'left' && index > 0) { index--; void showInViewer(); }
      else if (action === 'ok') {
        const work = works[index];
        if (work) {
          const added = toggleFavourite(work);
          toast(added ? 'Added to favourites. It will come up more often in ambient mode.' : 'Removed from favourites');
          renderViewerCaption();
        }
      } else if (action === 'down') {
        updateSettings({ slideshow: !settings.slideshow });
        const interval = settings.artSeconds < 60 ? `${settings.artSeconds} s` : settings.artSeconds < 3600 ? `${settings.artSeconds / 60} min` : settings.artSeconds < 86400 ? `${settings.artSeconds / 3600} h` : '24 h';
        toast(settings.slideshow ? `Slideshow on: a new work every ${interval}` : 'Slideshow off');
        scheduleNext();
      } else if (action === 'back' || action === 'up') closeViewer();
      return true;
    }
    if (zone === 'tabs') {
      if (action === 'left') selectTab(tabIndex - 1);
      else if (action === 'right') selectTab(tabIndex + 1);
      else if ((action === 'down' || action === 'ok') && works.length) { zone = 'grid'; applyFocus(); }
      else if (action === 'back' || action === 'up') close();
      return true;
    }
    const column = index % columns;
    if (action === 'left' && column > 0) { index--; applyFocus(); }
    else if (action === 'right' && column < columns - 1 && index < works.length - 1) { index++; applyFocus(); }
    else if (action === 'down' && index + columns < works.length) { index += columns; applyFocus(); }
    else if (action === 'down' && Math.floor(index / columns) < Math.floor((works.length - 1) / columns)) { index = works.length - 1; applyFocus(); }
    else if (action === 'up') { if (index >= columns) { index -= columns; applyFocus(); } else { zone = 'tabs'; applyFocus(); } }
    else if (action === 'pageDown') { index = Math.min(works.length - 1, index + columns * 3); applyFocus(); }
    else if (action === 'pageUp') { index = Math.max(0, index - columns * 3); applyFocus(); }
    else if (action === 'ok') openViewer();
    else if (action === 'back') close();
    return true;
  }

  function pointer(target: HTMLElement): void {
    const position = Number(target.dataset.index);
    if (zone === 'viewer') return;
    if (target.dataset.focus === 'gallery-tab') { zone = 'tabs'; selectTab(position); applyFocus(); }
    else if (target.dataset.focus === 'tile' && position !== index) { zone = 'grid'; index = position; applyFocus(); }
  }

  function enter(): void {
    if (zone === 'viewer') closeViewer();
    zone = 'grid';
    loading = true;
    render();
    void artReady().then(() => {
      loading = !galleryWorks().length;
      render();
    });
  }

  return { element, render, handle, pointer, enter };
}
