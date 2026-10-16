import { config } from '../config';
import type { RackEntry } from './configTypes';
import { isAmbient, prepareAmbient, startAmbient, stopAmbient } from './ambient';
import { refreshArt } from './art';
import { data, onDataChange, refreshAll, refreshConnection, refreshStale } from './data';
import { byId, toast, watchImages } from './dom';
import { initApps, onInputRequested, onShortcutRequested } from './launcher';
import { autoDetectLocation, currentLocation } from './location';
import { actionFor, exitApp, hideHdmi, isTizen, registerRemoteKeys, showHdmi, type Action } from './platform';
import { settings } from './store';
import { clockParts, dateLabel, relativeAge, timeLabel, zoned } from './time';
import { condition } from './weather';
import { createHome } from './views/home';
import { createGalleryView } from './views/galleryView';
import { createWhatsOnView } from './views/whatsOnView';
import { createNewsView } from './views/newsView';
import { createSettingsView } from './views/settingsView';
import type { View } from './views/view';

const stage = byId('stage');

function fitStage(): void {
  const scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
  const x = (window.innerWidth - 1920 * scale) / 2;
  const y = (window.innerHeight - 1080 * scale) / 2;
  stage.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
}

function applyAccent(): void {
  document.documentElement.style.setProperty('--marker', settings.accent);
}

let current: 'home' | 'news' | 'gallery' | 'whatson' = 'home';
let settingsOpen = false;

const home = createHome(target => openNews(target), target => openWhatsOn(target));
const news = createNewsView(() => showView('home'));
const gallery = createGalleryView(() => showView('home'));
const whatsOn = createWhatsOnView(() => showView('home'));
const settingsView = createSettingsView(() => toggleSettings(false), () => {
  applyAccent();
  renderClock();
  resetIdle();
  home.render();
});

const viewFor = (name: typeof current): View => name === 'home' ? home : name === 'news' ? news : name === 'gallery' ? gallery : whatsOn;
const activeView = (): View => settingsOpen ? settingsView : viewFor(current);

function showView(name: typeof current): void {
  current = name;
  document.body.dataset.view = name;
  viewFor(name).enter();
}

function openWhatsOn(target: { tab: 'football' | 'paris'; id?: string } = { tab: 'football' }): void {
  whatsOn.focusOn(target);
  showView('whatson');
}

function openNews(target?: { briefIndex?: number; storyId?: string }): void {
  news.focusTarget(target);
  showView('news');
}

function toggleSettings(open: boolean): void {
  settingsOpen = open;
  document.body.classList.toggle('settings-open', open);
  if (open) settingsView.enter();
}

function renderClock(): void {
  const now = Date.now();
  const parts = clockParts(now, settings.clock24);
  const html = `${parts.hours}<span class="colon" aria-hidden="true"></span>${parts.minutes}${parts.suffix ? `<small>${parts.suffix}</small>` : ''}`;
  for (const id of ['clock', 'aclock', 'news-clock', 'gallery-clock', 'whatson-clock']) {
    const node = byId(id);
    if (node.innerHTML !== html) node.innerHTML = html;
  }
  byId('date').textContent = dateLabel(now);
  const hour = zoned(now).hour;
  document.body.dataset.daypart = hour >= 5 && hour < 11 ? 'morning' : hour >= 11 && hour < 17 ? 'day' : hour >= 17 && hour < 23 ? 'evening' : 'night';
  byId('adate').textContent = dateLabel(now);
  home.refreshClock?.();
}

function scheduleClock(): void {
  renderClock();
  setTimeout(scheduleClock, 60000 - (Date.now() % 60000) + 50);
}

function renderDateline(): void {
  const weather = data.weather;
  const sky = weather ? `${weather.current.temp}° · ${condition(weather.current.code, weather.current.isDay).label.toLowerCase()}` : '';
  byId('placeline').textContent = [currentLocation().name, sky].filter(Boolean).join(' · ');
  const failures = [...data.status.values()].filter(status => status.ok === false);
  const freshness = byId('freshness');
  const lastUpdate = Math.max(data.weatherAt ?? 0, data.newsAt ?? 0);
  if (!navigator.onLine) {
    freshness.textContent = lastUpdate ? `Offline · showing ${timeLabel(lastUpdate)}` : 'Offline';
    freshness.className = 'freshness bad';
  } else if (failures.length) {
    freshness.textContent = `${failures.length} source${failures.length === 1 ? '' : 's'} unreachable · Blue for details`;
    freshness.className = 'freshness bad';
  } else {
    freshness.textContent = lastUpdate ? `Updated ${relativeAge(lastUpdate)}` : 'Fetching…';
    freshness.className = 'freshness';
  }
}

let hdmiActive = false;

async function enterHdmi(entry: RackEntry): Promise<void> {
  try {
    document.body.classList.add('hdmi');
    hdmiActive = true;
    clearTimeout(idleTimer);
    await showHdmi(settings.ps5Port);
    if (!isTizen) toast(`${entry.name} would show here (HDMI ${settings.ps5Port}). Back returns.`);
  } catch (error) {
    await leaveHdmi();
    toast(`Couldn't switch to the ${entry.name}: ${error instanceof Error ? error.message : String(error)}`, 'error');
  }
}

async function leaveHdmi(): Promise<void> {
  hdmiActive = false;
  document.body.classList.remove('hdmi');
  await hideHdmi();
  resetIdle();
}

let idleTimer: ReturnType<typeof setTimeout> | undefined;

function resetIdle(): void {
  clearTimeout(idleTimer);
  if (settings.idleMinutes > 0 && !hdmiActive) idleTimer = setTimeout(startAmbient, settings.idleMinutes * 60000);
}

let exitArmedUntil = 0;

function handleGlobal(action: Action): boolean {
  if (settingsOpen) return false;
  if (action === 'blue') { toggleSettings(true); return true; }
  if (action === 'green') { startAmbient(); return true; }
  if (action === 'yellow') { if (current === 'news') showView('home'); else openNews(); return true; }
  if (action === 'red') { refreshAll(); toast('Refreshing weather and news…'); return true; }
  return false;
}

const inputActions: Action[] = ['up', 'down', 'ok', 'back'];

/** In a text box, letters type and Backspace deletes; only navigation keys act on the app. */
function actionInTextBox(event: KeyboardEvent): Action | null {
  if (event.keyCode === 65376) return 'ok';
  if (event.keyCode === 65385) return 'back';
  if (event.keyCode === 8 || event.keyCode === 37 || event.keyCode === 39) return null;
  const action = actionFor(event);
  return action && inputActions.includes(action) ? action : null;
}

document.addEventListener('keydown', event => {
  const action = event.target instanceof HTMLInputElement ? actionInTextBox(event) : actionFor(event);
  if (action) event.preventDefault();
  resetIdle();
  if (hdmiActive) {
    if (action === 'back') void leaveHdmi();
    return;
  }
  if (isAmbient()) {
    stopAmbient();
    return;
  }
  if (!action || event.repeat && action === 'ok') return;
  if (handleGlobal(action)) return;
  const handled = activeView().handle(action);
  if (!handled && action === 'back' && current === 'home' && !settingsOpen) {
    if (Date.now() < exitArmedUntil) exitApp();
    else {
      exitArmedUntil = Date.now() + 2500;
      toast(isTizen ? 'Press Back again to leave' : 'Back again would close the app on the TV');
    }
  }
});

function focusableFrom(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>('[data-focus]') : null;
}

let lastPointerTarget: HTMLElement | null = null;

document.addEventListener('mousemove', event => {
  resetIdle();
  if (isAmbient()) { stopAmbient(); return; }
  const target = focusableFrom(event.target);
  if (!target || target === lastPointerTarget) return;
  lastPointerTarget = target;
  activeView().pointer(target);
});

document.addEventListener('click', event => {
  if (hdmiActive || isAmbient()) return;
  const target = focusableFrom(event.target);
  if (!target) return;
  activeView().pointer(target);
  activeView().handle('ok');
});

document.addEventListener('wheel', event => {
  if (current !== 'news' || settingsOpen) return;
  activeView().handle(event.deltaY > 0 ? 'down' : 'up');
}, { passive: true });

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  renderClock();
  refreshStale();
  resetIdle();
});

window.addEventListener('resize', fitStage);
window.addEventListener('online', () => { renderDateline(); refreshStale(); });
window.addEventListener('offline', renderDateline);

onDataChange(() => {
  home.render();
  if (current === 'news') news.render();
  if (current === 'whatson') whatsOn.render();
  if (settingsOpen) settingsView.render();
  renderDateline();
});

onInputRequested(entry => void enterHdmi(entry));
onShortcutRequested(target => {
  if (target === 'news') openNews();
  else if (target === 'gallery') showView('gallery');
  else if (target === 'whatson') openWhatsOn();
  else toggleSettings(true);
});

watchImages();
fitStage();
applyAccent();
registerRemoteKeys();
scheduleClock();
renderDateline();
home.render();
showView('home');
void initApps().then(() => home.render());
void autoDetectLocation().then(() => refreshConnection()).then(refreshStale);
void refreshArt().then(prepareAmbient);
setInterval(refreshStale, 60000);
setInterval(renderDateline, 60000);
resetIdle();
