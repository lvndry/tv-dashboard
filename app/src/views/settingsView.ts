import { config } from '../../config';
import { deviceVerificationUrl, disconnect, pairDevice, type DeviceCode } from '../chatgpt';
import { refreshArt } from '../art';
import { briefState, data, refreshAll, refreshBrief, refreshConnection } from '../data';
import { perplexityAvailable } from '../perplexity';
import { byId, escapeHtml, toast } from '../dom';
import type { Action } from '../platform';
import { accents, artIntervals, idleChoices, settings, updateSettings } from '../store';
import { currentLocation, saveLocation, searchPlaces, type PlaceResult } from '../location';
import { refreshWeather } from '../data';
import { relativeAge } from '../time';
import type { View } from './view';

declare const __BUILD_TIME__: string;

interface Row {
  label: string;
  value: () => string;
  change?: (step: number) => void;
  activate?: () => void;
  note?: () => string;
}

const cycle = <T>(list: T[], current: T, step: number): T => {
  const index = list.indexOf(current);
  return list[(Math.max(0, index) + step + list.length) % list.length]!;
};

const message = (error: unknown): string => error instanceof Error ? error.message : String(error);

export function createSettingsView(close: () => void, onChange: () => void): View {
  const element = byId('settings');
  const rowsNode = byId('settings-rows');
  const statusNode = byId('settings-status');
  const pairingNode = byId('pairing');
  let index = 0;
  let disconnectArmedUntil = 0;
  let pairing: { controller: AbortController; code: DeviceCode | null; timer: ReturnType<typeof setInterval> } | null = null;
  const locationInput = byId<HTMLInputElement>('location-input');
  const locationResults = byId('location-results');
  let locationOpen = false;
  let places: (PlaceResult | null)[] = [];
  let placeIndex = -1;
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let searchRequest = 0;

  function renderPlaces(): void {
    locationResults.innerHTML = places.map((place, position) => `
      <div class="location-result${position === placeIndex ? ' on' : ''}" data-focus="place" data-index="${position}">
        <b>${escapeHtml(place ? place.name : `Back to the default: ${config.place}`)}</b>
        <span>${escapeHtml(place ? place.detail : 'From app/config.ts')}</span>
      </div>`).join('');
  }

  async function search(query: string): Promise<void> {
    const request = ++searchRequest;
    if (query.trim().length < 2) {
      places = settings.location ? [null] : [];
      placeIndex = -1;
      renderPlaces();
      return;
    }
    try {
      const found = await searchPlaces(query);
      if (request !== searchRequest) return;
      places = found.length ? found : [];
      if (!found.length) locationResults.innerHTML = '<div class="nmeta">No match. Try a town, an arrondissement such as "Paris 15", or a postcode.</div>';
      else renderPlaces();
    } catch (error) {
      if (request === searchRequest) locationResults.innerHTML = `<div class="nmeta">Search failed: ${escapeHtml(message(error))}</div>`;
    }
  }

  function openLocation(): void {
    locationOpen = true;
    element.classList.add('location-open');
    locationInput.value = '';
    places = settings.location ? [null] : [];
    placeIndex = -1;
    renderPlaces();
    locationInput.focus();
  }

  function closeLocation(): void {
    locationOpen = false;
    clearTimeout(searchTimer);
    locationInput.blur();
    element.classList.remove('location-open');
    render();
  }

  function choosePlace(place: PlaceResult | null): void {
    saveLocation(place);
    toast(`Weather now for ${currentLocation().name}`);
    closeLocation();
    void refreshWeather();
  }

  locationInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => void search(locationInput.value), 350);
  });

  function renderPairing(): void {
    element.classList.toggle('pairing-open', !!pairing);
    if (!pairing) { pairingNode.innerHTML = ''; return; }
    const code = pairing.code;
    const remaining = code ? Math.max(0, code.expiresAt - Date.now()) : 0;
    const minutes = Math.floor(remaining / 60000);
    const seconds = String(Math.floor(remaining / 1000) % 60).padStart(2, '0');
    pairingNode.innerHTML = code ? `
      <div class="kicker">Connect ChatGPT</div>
      <p class="pair-step">On your phone, open</p>
      <div class="pair-url">${escapeHtml(code.url.replace('https://', ''))}</div>
      <p class="pair-step">and enter this code</p>
      <div class="pair-code">${escapeHtml(code.userCode)}</div>
      <p class="pair-wait"><span class="dot"></span>Waiting for approval · expires in ${minutes}:${seconds}</p>
      <p class="pair-note">The sign-in goes from OpenAI straight to this TV and is stored encrypted here. Back cancels.</p>`
      : `<div class="kicker">Connect ChatGPT</div><p class="pair-wait"><span class="dot"></span>Asking OpenAI for a code…</p>`;
  }

  function stopPairing(): void {
    if (!pairing) return;
    pairing.controller.abort();
    clearInterval(pairing.timer);
    pairing = null;
    renderPairing();
  }

  async function startPairing(): Promise<void> {
    const controller = new AbortController();
    pairing = { controller, code: null, timer: setInterval(renderPairing, 1000) };
    renderPairing();
    try {
      const result = await pairDevice(code => { if (pairing) { pairing.code = code; renderPairing(); } }, controller.signal);
      stopPairing();
      await refreshConnection();
      toast(`ChatGPT connected${result.plan ? ` · ${result.plan} plan` : ''}`);
      void refreshBrief(true);
    } catch (error) {
      const cancelled = controller.signal.aborted;
      stopPairing();
      if (!cancelled) toast(`Couldn't connect ChatGPT: ${message(error)}`, 'error');
    }
    render();
  }

  const rows: Row[] = [
    {
      label: 'ChatGPT',
      value: () => data.chatgpt.connected
        ? (Date.now() < disconnectArmedUntil ? 'Press OK again to disconnect' : `Connected${data.chatgpt.plan ? ` · ${escapeHtml(data.chatgpt.plan)}` : ''}`)
        : 'Not connected',
      activate: () => {
        if (!data.chatgpt.connected) { void startPairing(); return; }
        if (Date.now() < disconnectArmedUntil) {
          disconnectArmedUntil = 0;
          void disconnect().then(refreshConnection).then(() => { toast('ChatGPT disconnected and wiped from this TV'); render(); });
          return;
        }
        disconnectArmedUntil = Date.now() + 4000;
        setTimeout(renderRows, 4100);
      },
      note: () => data.chatgpt.connected ? 'Writes the gallery artwork stories on your plan.' : `Pair with a code at ${deviceVerificationUrl.replace('https://', '')}. Art stories only.`,
    },
    {
      label: 'AI news brief',
      value: () => !perplexityAvailable() ? 'No Perplexity key' : settings.briefEnabled ? 'On' : 'Off',
      change: () => {
        if (!perplexityAvailable()) return;
        updateSettings({ briefEnabled: !settings.briefEnabled });
        if (settings.briefEnabled) void refreshBrief();
      },
      note: () => perplexityAvailable()
        ? `Perplexity ${config.brief.perplexityModel}, at most every ${config.brief.refreshMinutes} min.`
        : 'Add a pplx-… key in app/config.ts → brief.perplexityKey.',

    },
    {
      label: 'Ambient mode after',
      value: () => settings.idleMinutes === 0 ? 'Never' : `${settings.idleMinutes} min`,
      change: step => updateSettings({ idleMinutes: cycle(idleChoices, settings.idleMinutes, step) }),
    },
    {
      label: 'Weather location',
      value: () => escapeHtml(currentLocation().name),
      activate: () => openLocation(),
      note: () => settings.location ? 'Set on this TV.' : 'From app/config.ts. OK to search for yours.',
    },
    {
      label: 'Ambient style',
      value: () => settings.ambientStyle === 'art' ? 'Art' : 'Clock',
      change: () => updateSettings({ ambientStyle: settings.ambientStyle === 'art' ? 'clock' : 'art' }),
      note: () => settings.ambientStyle === 'art' ? 'Public-domain art, from ancient Egypt to Romanticism.' : 'A large clock and a line about your day.',
    },
    {
      label: 'New artwork every',
      value: () => settings.artSeconds < 60 ? `${settings.artSeconds} s` : `${settings.artSeconds / 60} min`,
      change: step => updateSettings({ artSeconds: cycle(artIntervals, settings.artSeconds, step) }),
      note: () => 'In ambient mode and the gallery slideshow.',
    },
    {
      label: 'Gallery slideshow',
      value: () => settings.slideshow ? 'On' : 'Off',
      change: () => updateSettings({ slideshow: !settings.slideshow }),
      note: () => 'Advance by itself in the gallery viewer. ▼ in the viewer toggles it too.',
    },
    {
      label: 'Highlighter',
      value: () => `<span class="swatch" style="background:${settings.accent}"></span>${accents.find(accent => accent.value === settings.accent)?.name ?? 'Custom'}`,
      change: step => updateSettings({ accent: cycle(accents.map(accent => accent.value), settings.accent, step) }),
    },
    {
      label: 'Clock',
      value: () => settings.clock24 ? '24-hour' : '12-hour',
      change: () => updateSettings({ clock24: !settings.clock24 }),
    },
    {
      label: 'PS5 input',
      value: () => `HDMI ${settings.ps5Port}`,
      change: step => updateSettings({ ps5Port: cycle([1, 2, 3, 4], settings.ps5Port, step) }),
    },
    {
      label: 'Refresh everything now',
      value: () => '',
      activate: () => {
        refreshAll();
        void refreshArt(true);
        if (briefState() === 'ready' || briefState() === 'error') void refreshBrief(true);
        toast('Refreshing weather and news…');
      },
    },
  ];

  const panel = rowsNode.parentElement!;

  /** Keeps the focused row in view; ▼ on the last row reveals the source status below. */
  function followFocus(showStatus = false): void {
    if (showStatus) { panel.scrollTo({ top: panel.scrollHeight, behavior: 'smooth' }); return; }
    rowsNode.children[index]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    if (index === 0) panel.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function renderRows(): void {
    rowsNode.innerHTML = rows.map((row, rowIndex) => `
      <div class="srow${rowIndex === index ? ' on' : ''}" data-focus="setting" data-index="${rowIndex}">
        <div class="slabel">${escapeHtml(row.label)}${row.note ? `<small>${escapeHtml(row.note())}</small>` : ''}</div>
        <div class="svalue">${row.change ? '<i class="arrow">‹</i>' : ''}<span>${row.value()}</span>${row.change ? '<i class="arrow">›</i>' : row.activate ? '<kbd>OK</kbd>' : ''}</div>
      </div>`).join('');
  }

  function renderStatus(): void {
    const statuses = Array.from(data.status.values());
    statusNode.innerHTML = `
      <div class="kicker">Sources</div>
      ${statuses.length ? statuses.map(status => `
        <div class="status ${status.ok === false ? 'bad' : status.ok ? 'good' : 'idle'}">
          <i></i><b>${escapeHtml(status.name)}</b>
          <span>${escapeHtml(status.detail)}${status.updatedAt ? ` · ${relativeAge(status.updatedAt)}` : ''}</span>
        </div>`).join('') : '<div class="nmeta">Nothing fetched yet.</div>'}
      <div class="build">TV Dashboard · built ${escapeHtml(__BUILD_TIME__)}</div>`;
  }

  function render(): void {
    renderRows();
    renderStatus();
    renderPairing();
  }

  function handle(action: Action): boolean {
    if (locationOpen) {
      if (action === 'back') closeLocation();
      else if (action === 'down' && placeIndex < places.length - 1) { placeIndex++; locationInput.blur(); renderPlaces(); }
      else if (action === 'up') {
        if (placeIndex > 0) { placeIndex--; renderPlaces(); }
        else { placeIndex = -1; renderPlaces(); locationInput.focus(); }
      } else if (action === 'ok') {
        if (placeIndex >= 0) choosePlace(places[placeIndex] ?? null);
        else { clearTimeout(searchTimer); void search(locationInput.value).then(() => { if (places.length) { placeIndex = 0; locationInput.blur(); renderPlaces(); } }); }
      }
      return true;
    }
    if (pairing) {
      if (action === 'back' || action === 'blue') stopPairing();
      return true;
    }
    const row = rows[index];
    if (action === 'up' && index > 0) index--;
    else if (action === 'down' && index < rows.length - 1) index++;
    else if (action === 'down') { followFocus(true); return true; }
    else if ((action === 'left' || action === 'right') && row?.change) { row.change(action === 'left' ? -1 : 1); onChange(); }
    else if (action === 'ok' && row) {
      if (row.activate) row.activate();
      else if (row.change) { row.change(1); onChange(); }
    } else if (action === 'back' || action === 'blue') { close(); return true; }
    renderRows();
    followFocus();
    return true;
  }

  function pointer(target: HTMLElement): void {
    if (locationOpen && target.dataset.focus === 'place') { placeIndex = Number(target.dataset.index); renderPlaces(); return; }
    if (pairing || locationOpen || target.dataset.focus !== 'setting') return;
    index = Number(target.dataset.index);
    renderRows();
  }

  return { element, render, handle, pointer, enter: () => { index = 0; disconnectArmedUntil = 0; render(); panel.scrollTop = 0; } };
}
