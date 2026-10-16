// Perplexity Agent API (api.perplexity.ai/v1/responses). Writes the news brief.
// ChatGPT (device-code OAuth) remains the model behind the gallery art stories.

import { config } from '../config';
import { fetchJsonPost } from './net';

interface PplxContent { readonly text?: string }
interface PplxMessage { readonly type?: string; readonly content?: PplxContent[] }
interface PplxResponse {
  readonly status?: string;
  readonly error?: { readonly message?: string };
  readonly output?: PplxMessage[];
}

const ENDPOINT = 'https://api.perplexity.ai/v1/responses';
const MODEL = config.brief.perplexityModel;

/** True when a usable API key is configured. */
export function perplexityAvailable(): boolean {
  return /^\s*pplx-[A-Za-z0-9_-]{8,}/.test(config.brief.perplexityKey);
}

/** Ask the model and return the raw answer text (JSON when the prompt demands it). */
export async function completeJson(system: string, user: string): Promise<string> {
  const body = {
    model: MODEL,
    input: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.3,
    max_output_tokens: 2048,
  };
  const data = await fetchJsonPost<PplxResponse>(ENDPOINT, body, 90000);
  if (data.error) throw new Error(data.error.message ?? 'Perplexity error');
  if (data.status && data.status !== 'completed') throw new Error(`Perplexity ${data.status}`);
  for (const message of data.output ?? []) {
    if (message.type !== 'message') continue;
    const text = (message.content ?? []).map(part => part.text ?? '').join('').trim();
    if (text) return text;
  }
  throw new Error('empty Perplexity answer');
}
