// Install the wgt onto the TV via the homebrew service.
// Values come from the environment, then .env / .env.local (env vars win).
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
for (const name of ['.env', '.env.local']) {
  const file = join(root, name);
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const host = process.env.TV_HOST ?? '192.168.1.119';
const port = process.env.TV_PORT ?? '8091';
const pin = process.env.TV_PIN ?? '000000';

const wgtPath = join(root, 'app', 'dist', 'bonsoir.wgt');
if (!existsSync(wgtPath)) { console.error(`no package at ${wgtPath} — run "bun run pkg" first`); process.exit(1); }
const wgt = readFileSync(wgtPath);
console.log(`→ ${host}:${port}`);
const res = await fetch(`http://${host}:${port}/install`, {
  method: 'POST',
  headers: { 'x-homebrew-pin': pin, 'x-homebrew-name': 'bonsoir.wgt', 'Content-Type': 'application/octet-stream' },
  body: wgt,
});
console.log('HTTP', res.status);
console.log(await res.text());
