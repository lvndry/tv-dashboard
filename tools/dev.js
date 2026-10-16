// Local preview: rebuilds on change, serves app/dist, and proxies feed requests that lack CORS headers.
import { watch as watchFiles } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { dist, stageStatic, watch } from './build.js';

const port = Number(process.env.PORT ?? 5173);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.xml': 'application/xml' };

await watch();
watchFiles(new URL('../app', import.meta.url), { recursive: false }, (_event, file) => {
  if (file && /\.(html|css|xml)$/.test(file)) stageStatic();
});

createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://localhost:${port}`);
  if (url.pathname === '/proxy') {
    const target = url.searchParams.get('url') ?? '';
    if (!/^https:\/\//.test(target)) { response.writeHead(400).end('bad url'); return; }
    const forwarded = ['authorization', 'chatgpt-account-id', 'originator', 'openai-beta', 'accept', 'content-type'];
    const headers = { 'user-agent': 'Mozilla/5.0 (SMART-TV; Tizen 9.0) TV Dashboard' };
    for (const name of forwarded) if (request.headers[name]) headers[name] = request.headers[name];
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    try {
      const upstream = await fetch(target, { method: request.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined });
      response.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'text/plain' });
      response.end(Buffer.from(await upstream.arrayBuffer()));
    } catch (error) {
      response.writeHead(502).end(String(error));
    }
    return;
  }
  const path = normalize(join(dist, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!path.startsWith(dist)) { response.writeHead(403).end(); return; }
  try {
    const body = await readFile(path);
    response.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    response.end(body);
  } catch {
    response.writeHead(404).end('not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`TV Dashboard preview → http://localhost:${port}`));
