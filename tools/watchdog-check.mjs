// Standalone check of the watchdog's core logic: 3 bad starts in the window
// trip the fallback; a clean draw clears it; old strikes expire.
import { build } from 'esbuild';
import { writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execSync } from 'child_process';

const out = join(tmpdir(), 'watchdog-test.mjs');
await build({
  entryPoints: ['app/src/watchdog.ts'],
  bundle: true, format: 'esm', outfile: out,
  loader: { '.ts': 'ts' },
});
const src = readFileSync(out, 'utf8');

function run(body) {
  const script = `
    let store = {};
    const localStorage = {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
    };
    const terminated = { v: false };
    const tizen = { application: { getCurrentApplication: () => ({ terminate: () => { terminated.v = true; } }) } };
    const listeners = {};
    const window = { addEventListener: (t, f) => { (listeners[t] ??= []).push(f); } };
    const document = {
      getElementById: () => ({ replaceChildren: () => {}, appendChild: () => {}, querySelector: () => ({}) }),
      createElement: () => ({ className: '', innerHTML: '', querySelector: () => null }),
    };
    globalThis.tizen = tizen; globalThis.localStorage = localStorage; globalThis.window = window; globalThis.document = document;
    ${src}
    ${body}
  `;
  const file = join(tmpdir(), `wd-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`);
  writeFileSync(file, script);
  return execSync(`node ${file}`, { encoding: 'utf8' }).trim();
}

console.log('1) two strikes then a clean draw clears them:',
  run(`
    const a = arm();
    recordFailure('boom'); recordFailure('boom'); markDrew();
    console.log('strikes=' + strikes() + ' armReturned=' + a);
  `));

console.log('2) three strikes trips the fallback + terminates the app:',
  run(`
    arm();
    recordFailure('boom'); recordFailure('boom');
    const trip = recordFailure('boom');
    if (trip) showFallback('three bad starts');
    console.log('strikes=' + strikes() + ' trip=' + trip);
  `));

console.log('3) three strikes already on disk -> arm() falls back before draw:',
  run(`
    const now = Date.now();
    localStorage.setItem('bonsoir.watchdog', JSON.stringify({ at: [now-1000, now-500, now-100] }));
    const a = arm();
    console.log('armReturned=' + a);
  `));

console.log('4) strikes older than the 10-min window are ignored:',
  run(`
    const old = Date.now() - 20 * 60 * 1000;
    localStorage.setItem('bonsoir.watchdog', JSON.stringify({ at: [old, old+1, old+2] }));
    const a = arm();
    console.log('armReturned=' + a + ' strikes=' + strikes());
  `));
