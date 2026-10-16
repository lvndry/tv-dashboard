// Uses a ChatGPT plan through the same OAuth client and backend as the Codex CLI.
// The TV pairs itself with a device code, so tokens go from OpenAI straight to the TV.
// Only the refresh token is persisted, sealed in the vault; the access token stays in memory.

import { request } from './net';
import { openSecret, sealSecret, vaultSupported, wipeVault } from './vault';

const clientId = 'app_EMoamEEZ73f0CkXaXp7hrann';
const authBase = 'https://auth.openai.com';
const backendBase = 'https://chatgpt.com/backend-api/codex';
const deviceRedirect = `${authBase}/deviceauth/callback`;
export const deviceVerificationUrl = `${authBase}/codex/device`;
const originator = 'tv-dashboard';
const refreshMarginMs = 5 * 60000;
const secretName = 'chatgpt';

interface StoredCredential { refresh: string; accountId: string; plan: string | null }
interface Session extends StoredCredential { access: string; expires: number }

let session: Session | null = null;
let loaded = false;
let refreshing: Promise<Session> | null = null;

export class SignInRequiredError extends Error {}

function claimsOf(accessToken: string): { accountId: string | null; plan: string | null } {
  try {
    const payload = accessToken.split('.')[1] ?? '';
    const padded = payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '=');
    const auth = JSON.parse(atob(padded))['https://api.openai.com/auth'] ?? {};
    return { accountId: auth.chatgpt_account_id ?? null, plan: auth.chatgpt_plan_type ?? null };
  } catch {
    return { accountId: null, plan: null };
  }
}

/** Error text for the UI: status plus a short reason code, never response bodies or tokens. */
async function failure(response: Response, what: string): Promise<Error> {
  let reason = '';
  try {
    const body = await response.json() as { error?: { code?: string } | string };
    reason = typeof body.error === 'string' ? body.error : body.error?.code ?? '';
  } catch { /* body was not JSON */ }
  const safeReason = reason.replace(/[^a-z0-9_.-]/gi, '').slice(0, 60);
  return new Error(`${what} failed (HTTP ${response.status}${safeReason ? `, ${safeReason}` : ''})`);
}

async function adoptTokens(tokens: { access_token: string; refresh_token: string; expires_in: number }): Promise<Session> {
  const claims = claimsOf(tokens.access_token);
  if (!claims.accountId) throw new Error('This account has no ChatGPT workspace');
  const next: Session = {
    access: tokens.access_token,
    refresh: tokens.refresh_token,
    expires: Date.now() + tokens.expires_in * 1000,
    accountId: claims.accountId,
    plan: claims.plan,
  };
  // Refresh tokens rotate: the new one is sealed before the old one is dropped.
  await sealSecret(secretName, JSON.stringify({ refresh: next.refresh, accountId: next.accountId, plan: next.plan } satisfies StoredCredential));
  session = next;
  return next;
}

async function loadSession(): Promise<void> {
  if (loaded) return;
  loaded = true;
  const raw = await openSecret(secretName).catch(() => null);
  if (raw) session = { ...(JSON.parse(raw) as StoredCredential), access: '', expires: 0 };
}

export async function connection(): Promise<{ connected: boolean; plan: string | null }> {
  await loadSession();
  return { connected: !!session, plan: session?.plan ?? null };
}

async function refresh(): Promise<Session> {
  const current = session;
  if (!current) throw new SignInRequiredError('Not connected to ChatGPT');
  const response = await request(`${authBase}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: current.refresh, client_id: clientId }).toString(),
  }, 15000);
  if (!response.ok && response.status < 500) {
    await disconnect();
    throw new SignInRequiredError('ChatGPT sign-in expired. Connect again in Settings.');
  }
  if (!response.ok) throw await failure(response, 'Token refresh');
  return adoptTokens(await response.json());
}

async function activeSession(forceRefresh = false): Promise<Session> {
  await loadSession();
  if (!session) throw new SignInRequiredError('Not connected to ChatGPT');
  if (!forceRefresh && session.access && session.expires - refreshMarginMs > Date.now()) return session;
  refreshing ??= refresh().finally(() => { refreshing = null; });
  return refreshing;
}

export async function disconnect(): Promise<void> {
  session = null;
  await wipeVault();
}

export interface DeviceCode { userCode: string; url: string; expiresAt: number }

function wait(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error('cancelled')); return; }
    const timer = setTimeout(resolve, delayMs);
    signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('cancelled')); }, { once: true });
  });
}

/** Pairs this TV. Resolves once the code is approved on another device; rejects on expiry or cancel. */
export async function pairDevice(onCode: (code: DeviceCode) => void, signal: AbortSignal): Promise<{ plan: string | null }> {
  if (!vaultSupported()) throw new Error('This TV cannot store secrets securely (no WebCrypto)');
  const start = await request(`${authBase}/api/accounts/deviceauth/usercode`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: clientId }),
  });
  if (!start.ok) throw await failure(start, 'Starting sign-in');
  const started = await start.json() as { device_auth_id: string; user_code: string; interval: number | string; expires_at?: string };
  const announcedExpiry = started.expires_at ? Date.parse(started.expires_at) : NaN;
  const expiresAt = Number.isFinite(announcedExpiry) ? announcedExpiry : Date.now() + 15 * 60000;
  onCode({ userCode: started.user_code, url: deviceVerificationUrl, expiresAt });
  let delayMs = Math.max(3, Number(started.interval) || 5) * 1000;

  while (Date.now() < expiresAt) {
    await wait(delayMs, signal);
    const poll = await request(`${authBase}/api/accounts/deviceauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ device_auth_id: started.device_auth_id, user_code: started.user_code }),
    });
    if (poll.status === 403 || poll.status === 404) continue;
    const body = await poll.json().catch(() => ({})) as { authorization_code?: string; code_verifier?: string; error?: string | { code?: string } };
    const code = typeof body.error === 'string' ? body.error : body.error?.code;
    if (code === 'deviceauth_authorization_pending' || code === 'authorization_pending') continue;
    if (code === 'slow_down') { delayMs += 5000; continue; }
    if (!poll.ok || !body.authorization_code || !body.code_verifier) throw new Error(`Sign-in was not approved${code ? ` (${code})` : ''}`);

    const exchange = await request(`${authBase}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        code: body.authorization_code,
        code_verifier: body.code_verifier,
        redirect_uri: deviceRedirect,
      }).toString(),
    });
    if (!exchange.ok) throw await failure(exchange, 'Finishing sign-in');
    return { plan: (await adoptTokens(await exchange.json())).plan };
  }
  throw new Error('The sign-in code expired');
}

interface StreamEvent {
  type?: string;
  delta?: string;
  response?: { output?: { type?: string; content?: { type?: string; text?: string }[] }[]; error?: { code?: string } };
  error?: { code?: string };
}

function textFromEventStream(stream: string): string {
  let deltas = '';
  for (const line of stream.split('\n')) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    let event: StreamEvent;
    try { event = JSON.parse(payload); } catch { continue; }
    if (event.type === 'response.output_text.delta' && event.delta) deltas += event.delta;
    if (event.type === 'response.failed' || event.type === 'error') {
      const code = event.response?.error?.code ?? event.error?.code ?? 'unknown';
      throw new Error(code === 'usage_limit_reached' ? 'ChatGPT usage limit reached' : `ChatGPT error (${code})`);
    }
    if (event.type === 'response.completed' || event.type === 'response.done') {
      const text = (event.response?.output ?? [])
        .filter(item => item.type === 'message')
        .flatMap(item => item.content ?? [])
        .filter(part => part.type === 'output_text')
        .map(part => part.text ?? '')
        .join('');
      if (text) return text;
    }
  }
  if (deltas) return deltas;
  throw new Error('ChatGPT returned no text');
}

export interface JsonJob {
  model: string;
  instructions: string;
  input: string;
  schema: Record<string, unknown>;
}

export async function completeJson(job: JsonJob): Promise<string> {
  const send = (active: Session): Promise<Response> => request(`${backendBase}/responses`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${active.access}`,
      'chatgpt-account-id': active.accountId,
      originator,
      'openai-beta': 'responses=experimental',
      accept: 'text/event-stream',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: job.model,
      instructions: job.instructions,
      input: [{ role: 'user', content: [{ type: 'input_text', text: job.input }] }],
      store: false,
      stream: true,
      reasoning: { effort: 'low' },
      text: { format: { type: 'json_schema', name: 'result', schema: job.schema, strict: true } },
    }),
  }, 180000);

  let response = await send(await activeSession());
  if (response.status === 401) response = await send(await activeSession(true));
  if (!response.ok) throw await failure(response, 'ChatGPT request');
  return textFromEventStream(await response.text());
}
