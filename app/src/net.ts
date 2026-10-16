import { isTizen } from './platform';

// On the TV the widget's <access> policy allows cross-origin requests. In a desktop
// browser, the dev server proxies them so endpoints without CORS headers still work.
const useDevProxy = !isTizen && location.protocol.startsWith('http');

export async function request(url: string, init: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const target = useDevProxy ? `/proxy?url=${encodeURIComponent(url)}` : url;
  try {
    return await fetch(target, { ...init, signal: controller.signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
  } catch (error) {
    if (controller.signal.aborted) throw new Error('timed out');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchText(url: string, timeoutMs = 15000): Promise<string> {
  const response = await request(url, {}, timeoutMs);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

export async function fetchJson<T>(url: string, timeoutMs = 15000): Promise<T> {
  return JSON.parse(await fetchText(url, timeoutMs)) as T;
}
