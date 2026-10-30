// Install app/dist/tv-dashboard.wgt on the TV through the Tizen Tap service.
// Values come from the environment, then .env.local and .env (the environment wins).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnv, root } from './env.js';

loadEnv();

const host = process.env.TV_HOST;
const port = process.env.TV_PORT || '8091';
const pin = process.env.TV_PIN || '000000';

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

if (!host) fail('TV_HOST is not set. Copy .env.example to .env and put the TV\'s IP address in it.');

const wgtPath = join(root, 'app', 'dist', 'tv-dashboard.wgt');
if (!existsSync(wgtPath)) fail(`no package at ${wgtPath}. Run "bun run pkg" first.`);

const pinHelp = 'Read the 6-digit PIN off the Tizen Tap screen on the TV and set TV_PIN in .env (developer builds of Tizen Tap use 000000).';

console.log(`→ installing on ${host}:${port}`);
let response;
try {
  response = await fetch(`http://${host}:${port}/install`, {
    method: 'POST',
    headers: { 'x-homebrew-pin': pin, 'x-homebrew-name': 'tv-dashboard.wgt', 'Content-Type': 'application/octet-stream' },
    body: readFileSync(wgtPath),
    signal: AbortSignal.timeout(180000),
  });
} catch (error) {
  const cause = error?.cause?.code ?? error?.name ?? String(error);
  fail(`could not reach Tizen Tap at ${host}:${port} (${cause}). Check that the TV is on and Tizen Tap is running, and that TV_HOST is its current IP.`);
}

const text = await response.text();
let body = null;
try { body = JSON.parse(text); } catch { /* not JSON: shown raw below */ }
const detail = body?.message ?? text.trim();

if (response.ok && body?.ok !== false) {
  console.log(`✓ installed${body?.packageId ? ` ${body.packageId}` : ''}`);
  for (const phase of body?.phases ?? []) console.log(`  · ${phase}`);
  process.exit(0);
}

const seconds = detail.match(/(\d+)\s*s\b/)?.[1];
if (response.status === 403) fail(`Tizen Tap refused the PIN in TV_PIN. ${pinHelp} Five wrong tries lock installs for five minutes.`);
if (response.status === 429) fail(`too many wrong PINs: Tizen Tap refuses installs${seconds ? ` for another ${seconds} seconds` : ' for a few minutes'}. Wait that long before trying again. ${pinHelp}`);
if (response.status === 409 || /already running/i.test(detail)) fail('another install is running on the TV. Wait for it to finish, then run "bun run deploy" again.');
fail(`HTTP ${response.status}: ${detail}${body?.remedy ? `\n  ${body.remedy}` : ''}`);
