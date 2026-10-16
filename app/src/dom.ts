export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} is missing from index.html`);
  return node as T;
}

const escapes: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, character => escapes[character] ?? character);
}

export function afterPaint(callback: () => void): void {
  requestAnimationFrame(() => requestAnimationFrame(callback));
}

/** Cuts at a word boundary so phrases stay one breath long. */
export function shorten(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength + 1);
  const lastSpace = cut.lastIndexOf(' ');
  const base = (lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut.slice(0, maxLength)).replace(/[\s,;:.–—-]+$/, '');
  return base + '…';
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export function toast(message: string, tone: 'info' | 'error' = 'info'): void {
  const element = byId('toast');
  element.textContent = message;
  element.classList.toggle('error', tone === 'error');
  element.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('show'), tone === 'error' ? 3600 : 2000);
}

/** Image that fades in once decoded instead of popping. */
export function imageHtml(url: string | undefined, className: string): string {
  if (!url) return `<div class="${className} img-empty"></div>`;
  return `<div class="${className}"><img src="${escapeHtml(url)}" alt=""></div>`;
}

/** Image load/error don't bubble, so one capturing listener covers every image the views render. */
export function watchImages(): void {
  document.addEventListener('load', event => {
    if (event.target instanceof HTMLImageElement) event.target.classList.add('loaded');
  }, true);
  document.addEventListener('error', event => {
    if (event.target instanceof HTMLImageElement) event.target.parentElement?.classList.add('img-empty');
  }, true);
}
