import { config } from '../../config';
import { deviceVerificationUrl, disconnect, pairDevice, type DeviceCode } from '../chatgpt';
import { briefState, data, refreshAll, refreshBrief, refreshConnection } from '../data';
import { byId, escapeHtml, toast } from '../dom';
import type { Action } from '../platform';
import { accents, idleChoices, settings, updateSettings } from '../store';
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
      note: () => data.chatgpt.connected ? 'Writes the news brief on your plan.' : `Pair with a code at ${deviceVerificationUrl.replace('https://', '')}.`,
    },
    {
      label: 'AI news brief',
      value: () => !data.chatgpt.connected ? 'Needs ChatGPT' : settings.briefEnabled ? 'On' : 'Off',
      change: () => {
        if (!data.chatgpt.connected) return;
        updateSettings({ briefEnabled: !settings.briefEnabled });
        if (settings.briefEnabled) void refreshBrief();
      },
      note: () => `${config.brief.model}, at most every ${config.brief.refreshMinutes} min.`,
    },
    {
      label: 'Ambient mode after',
      value: () => settings.idleMinutes === 0 ? 'Never' : `${settings.idleMinutes} min`,
      change: step => updateSettings({ idleMinutes: cycle(idleChoices, settings.idleMinutes, step) }),
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
        if (briefState() === 'ready' || briefState() === 'error') void refreshBrief(true);
        toast('Refreshing weather and news…');
      },
    },
  ];

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
      <div class="keys"><span><i style="background:#E5484D"></i>Refresh</span><span><i style="background:#30A46C"></i>Ambient</span><span><i style="background:#F5D90A"></i>News</span><span><i style="background:#3E63DD"></i>Settings</span></div>
      <div class="build">TV Dashboard · built ${escapeHtml(__BUILD_TIME__)}</div>`;
  }

  function render(): void {
    renderRows();
    renderStatus();
    renderPairing();
  }

  function handle(action: Action): boolean {
    if (pairing) {
      if (action === 'back' || action === 'blue') stopPairing();
      return true;
    }
    const row = rows[index];
    if (action === 'up' && index > 0) index--;
    else if (action === 'down' && index < rows.length - 1) index++;
    else if ((action === 'left' || action === 'right') && row?.change) { row.change(action === 'left' ? -1 : 1); onChange(); }
    else if (action === 'ok' && row) {
      if (row.activate) row.activate();
      else if (row.change) { row.change(1); onChange(); }
    } else if (action === 'back' || action === 'blue') { close(); return true; }
    renderRows();
    return true;
  }

  function pointer(target: HTMLElement): void {
    if (pairing || target.dataset.focus !== 'setting') return;
    index = Number(target.dataset.index);
    renderRows();
  }

  return { element, render, handle, pointer, enter: () => { index = 0; disconnectArmedUntil = 0; render(); } };
}
