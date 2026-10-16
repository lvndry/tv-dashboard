// Renders README screenshots at 1920×1080 with fictional data, using headless Chrome.
// The app runs unmodified: the clock is shifted to the evening, and the local server
// answers the weather, feed, art and ChatGPT requests with fixtures. The one artwork's
// image is a public-domain painting fetched from Wikimedia Commons. That also exercises
// the real pairing and brief code paths end to end.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { buildOptions, stageStatic } from './build.js';
import * as fixtures from './screenshots/fixtures.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'docs', 'screenshots');
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const eveningUtc = Date.UTC(2026, 9, 16, 19, 42, 0);
const clockOffset = eveningUtc - Date.now();
const fakeNow = () => Date.now() + clockOffset;

const site = mkdtempSync(join(tmpdir(), 'tv-dashboard-shots-'));
stageStatic(site);
await build({
  ...buildOptions(site),
  logLevel: 'warning',
  plugins: [{
    name: 'demo-config',
    setup(builder) {
      builder.onResolve({ filter: /^\.\.\/(\.\.\/)?config$/ }, () => ({ path: join(root, 'tools', 'screenshots', 'config.ts') }));
    },
  }],
});

const seen = { briefRequest: null };
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2' };

function respond(response, status, body, type = 'application/json') {
  response.writeHead(status, { 'content-type': type });
  response.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  if (url.pathname !== '/proxy') {
    const path = normalize(join(site, url.pathname === '/' ? 'index.html' : url.pathname));
    try { respond(response, 200, readFileSync(path), types[extname(path)] ?? 'application/octet-stream'); }
    catch { respond(response, 404, 'not found', 'text/plain'); }
    return;
  }
  const target = new URL(url.searchParams.get('url') ?? '');
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString();
  if (target.hostname === 'api.open-meteo.com') return respond(response, 200, fixtures.weather(fakeNow()));
  if (target.hostname === 'query.wikidata.org') return respond(response, 200, fixtures.artQueryResult());
  if (target.hostname === 'feeds.example.com') return respond(response, 200, fixtures.rss(target.pathname.slice(1), fakeNow()), 'application/rss+xml');
  if (target.pathname === '/api/accounts/deviceauth/usercode') {
    return respond(response, 200, { device_auth_id: 'demo', user_code: 'TVDB-4271', interval: '3', expires_at: new Date(fakeNow() + 15 * 60000).toISOString() });
  }
  if (target.pathname === '/api/accounts/deviceauth/token') return respond(response, 200, { authorization_code: 'demo-code', code_verifier: 'demo-verifier' });
  if (target.pathname === '/oauth/token') return respond(response, 200, fixtures.tokens());
  if (target.pathname === '/backend-api/codex/responses') {
    seen.briefRequest = { headers: request.headers, body: JSON.parse(body) };
    return respond(response, 200, fixtures.responseStream(JSON.stringify(fixtures.brief())), 'text/event-stream');
  }
  respond(response, 404, `no fixture for ${target}`, 'text/plain');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const appUrl = `http://127.0.0.1:${server.address().port}/`;

const profile = mkdtempSync(join(tmpdir(), 'tv-dashboard-chrome-'));
const browser = spawn(chrome, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1920,1080', '--hide-scrollbars', '--force-device-scale-factor=1', '--no-first-run', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
const browserSocket = await new Promise((resolve, reject) => {
  let log = '';
  browser.stderr.on('data', chunk => {
    log += chunk;
    const match = log.match(/DevTools listening on (ws:\/\/\S+)/);
    if (match) resolve(match[1]);
  });
  browser.on('exit', code => reject(new Error(`Chrome exited (${code})`)));
});
const port = new URL(browserSocket).port;
const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));

let nextId = 0;
const pending = new Map();
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message)); else resolve(message.result);
  }
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

const keys = { left: [37, 'ArrowLeft'], up: [38, 'ArrowUp'], right: [39, 'ArrowRight'], down: [40, 'ArrowDown'], ok: [13, 'Enter'], back: [27, 'Escape'], news: [78, 'n'], ambient: [65, 'a'] };
async function press(name, times = 1) {
  const [keyCode, key] = keys[name];
  for (let count = 0; count < times; count++) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: keyCode, key, code: key.length === 1 ? `Key${key.toUpperCase()}` : key });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: keyCode, key, code: key.length === 1 ? `Key${key.toUpperCase()}` : key });
    await pause(180);
  }
}
async function evaluate(expression) {
  return (await send('Runtime.evaluate', { expression, returnByValue: true })).result.value;
}
async function shot(name, settle = 1200) {
  await pause(settle);
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(output, `${name}.png`), Buffer.from(data, 'base64'));
  console.log(`✓ docs/screenshots/${name}.png`);
}

const clockShim = `(() => {
  const offset = ${eveningUtc} - Date.now();
  const RealDate = Date;
  class ShiftedDate extends RealDate {
    constructor(...args) { if (args.length) super(...args); else super(RealDate.now() + offset); }
    static now() { return RealDate.now() + offset; }
  }
  window.Date = ShiftedDate;
})();`;

try {
  mkdirSync(output, { recursive: true });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: clockShim });
  await send('Page.navigate', { url: appUrl });
  await pause(2500);

  await press('down', 3);
  await press('right', 8);
  await press('ok');
  await pause(600);
  await press('ok');
  await shot('pairing', 1500);

  await pause(6000);
  const connected = await evaluate(`document.querySelector('#settings-rows .srow .svalue')?.textContent ?? ''`);
  if (!/Connected/.test(connected)) throw new Error(`pairing did not complete (settings shows "${connected.trim()}")`);

  await send('Page.reload');
  await pause(3000);
  const letter = await evaluate(`document.getElementById('letter').innerText`);
  if (!letter.includes('Today:')) throw new Error('the brief did not reach the letter');
  await shot('home', 600);

  await press('down');
  await shot('home-story', 900);

  await press('news');
  await shot('news', 1400);

  await press('back');
  await press('ambient');
  await shot('ambient', 5000);

  const request = seen.briefRequest;
  console.log(`brief request: model=${request?.body.model} store=${request?.body.store} stream=${request?.body.stream} format=${request?.body.text?.format?.type} account-header=${request?.headers['chatgpt-account-id'] ? 'yes' : 'no'}`);
} finally {
  socket.close();
  browser.kill();
  server.close();
  rmSync(site, { recursive: true, force: true });
  setTimeout(() => rmSync(profile, { recursive: true, force: true }), 500);
}
