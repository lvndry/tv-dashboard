// A watchdog that keeps a broken build from trapping the user on a blank TV.
//
// The dashboard is the first thing that opens on the set, so a build that
// crashes on boot, or hangs before it draws anything, would otherwise leave
// the user staring at a black screen with no way to tell what happened. This
// counts "bad starts" and, past a threshold, shows a one-line explanation and
// hands control back to the stock launcher. A clean start clears the count,
// so it recovers by itself the next time a good build ships.
//
// The count lives in localStorage, which is per-app on Tizen and survives a
// cold boot — the same storage the rest of the dashboard already uses.

const KEY = 'bonsoir.watchdog';

interface Strikes {
  /** Timestamps (ms) of recent bad starts. */
  at: number[];
}

/** How many bad starts within the window before we hand back to the launcher. */
const THRESHOLD = 3;
/** A window longer than this is treated as "old" and no longer counts. */
const WINDOW_MS = 10 * 60 * 1000;
/** If the home view has not drawn within this long, the start counts as a hang. */
const DRAW_TIMEOUT_MS = 20 * 1000;
/** How long the fallback message stays up before the app exits. */
const EXIT_DELAY_MS = 8 * 1000;

function read(): Strikes {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Strikes;
      if (Array.isArray(parsed.at)) return parsed;
    }
  } catch {
    /* storage unavailable — fall through to a clean state */
  }
  return { at: [] };
}

function write(value: Strikes): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    /* full or unavailable — the watchdog is best-effort, never the blocker */
  }
}

/** Drop strikes older than the window so the count only reflects recent starts. */
function recent(state: Strikes): Strikes {
  const now = Date.now();
  return { at: state.at.filter((t) => now - t <= WINDOW_MS) };
}

let armed = false;
let drew = false;
let failTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Record that the home view rendered. Call once when the dashboard first
 * draws. Clears the strike count, so a good boot washes out old bad ones.
 */
export function markDrew(): void {
  if (drew) return;
  drew = true;
  if (failTimer) clearTimeout(failTimer);
  write({ at: [] });
}

/**
 * Record a bad start. Call from the global error handlers and from the
 * hang timer. Returns true when the threshold is hit and the app should fall
 * back; call `showFallback()` in that case.
 */
export function recordFailure(reason: string): boolean {
  if (drew) return false;
  const state = recent(read());
  state.at.push(Date.now());
  write(state);
  console.warn(`[watchdog] ${reason} (strike ${state.at.length}/${THRESHOLD})`);
  return state.at.length >= THRESHOLD;
}

/**
 * Replace the UI with a short explanation and, on the TV, close the app so
 * the stock launcher shows again. Kept deliberately minimal: the point is
 * "it noticed, and it got out of your way," not a status dashboard.
 */
export function showFallback(reason: string): void {
  const root = document.getElementById('stage');
  if (root) {
    root.replaceChildren();
    const box = document.createElement('div');
    box.className = 'watchdog-fallback';
    box.innerHTML =
      '<div class="watchdog-card">' +
      '<h1>Bonsoir stepped back</h1>' +
      '<p>It has been unable to start a few times in a row, so it is handing the screen back to the TV.</p>' +
      '<p class="watchdog-reason"></p>' +
      '<p class="watchdog-hint">It closes in a few seconds. A fresh build will bring Bonsoir right back.</p>' +
      '</div>';
    const reasonEl = box.querySelector('.watchdog-reason');
    if (reasonEl) reasonEl.textContent = reason;
    root.appendChild(box);
  }

  if (armed) {
    setTimeout(() => {
      try {
        (globalThis as any).tizen?.application?.getCurrentApplication?.()?.exit?.();
      } catch {
        /* not on Tizen, or already gone: the message still shows */
      }
    }, EXIT_DELAY_MS);
  }
}

/**
 * Arm the watchdog: install global error handlers, start the hang timer, and
 * decide — based on strikes recorded by earlier starts — whether to fall back
 * immediately before drawing anything. Returns true when it fell back.
 */
export function arm(): boolean {
  armed = true;

  const state = recent(read());
  if (state.at.length >= THRESHOLD) {
    showFallback(`${state.at.length} bad starts in a row`);
    return true;
  }

  // A crash usually also misses the draw deadline; one bad start is one strike.
  let struck = false;
  const hang = (reason: string) => {
    if (struck || drew) return;
    struck = true;
    if (recordFailure(reason)) showFallback(reason);
  };

  window.addEventListener('error', () => hang('the app crashed before it could draw'));
  window.addEventListener('unhandledrejection', () => hang('a startup error went unhandled'));

  failTimer = setTimeout(() => hang('the app did not finish starting'), DRAW_TIMEOUT_MS);
  return false;
}

/** Recent bad-start count. */
export function strikes(): number {
  return recent(read()).at.length;
}
