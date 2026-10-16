// Bundle app/src/main.ts and stage every file the widget needs into app/dist.
import { build, context } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureConfig } from './ensure-config.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = join(root, 'app');
export const dist = join(app, 'dist');

const fixedOrigins = [
  'https://api.open-meteo.com', 'https://geocoding-api.open-meteo.com', 'https://auth.openai.com', 'https://chatgpt.com',
  'https://site.api.espn.com', 'https://opendata.paris.fr', 'https://api.si.edu', 'https://collections.louvre.fr', 'https://api.europeana.eu',
  'https://query.wikidata.org', 'https://collectionapi.metmuseum.org', 'https://openaccess-api.clevelandart.org',
        'https://www.wikidata.org', 'https://en.wikipedia.org', 'https://fr.wikipedia.org', 'https://ipwho.is',
  'https://api.perplexity.ai', 'https://www.perplexity.ai', 'https://r.jina.ai', 'https://www.youtube.com', 'https://www.youtube-nocookie.com', 'https://i.ytimg.com',
];

/** connect-src is limited to the weather API, OpenAI, the art collections, and the feeds named in config.ts. */
export function contentSecurityPolicy() {
  const configSource = readFileSync(join(app, 'config.ts'), 'utf8');
  const feedOrigins = [...configSource.matchAll(/url:\s*'(https:\/\/[^']+)'/g)].map(match => new URL(match[1]).origin);
  // Articles live on the feeds' sites (feeds.arstechnica.com links to arstechnica.com), so the reader may fetch any subdomain of each.
  const articleOrigins = feedOrigins.flatMap(origin => {
    const site = new URL(origin).hostname.split('.').slice(-2).join('.');
    return [`https://${site}`, `https://*.${site}`];
  });
  const connect = ["'self'", ...new Set([...fixedOrigins, ...feedOrigins, ...articleOrigins])].join(' ');
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    'img-src https: data:',
    `connect-src ${connect}`,
        "frame-src https://www.youtube-nocookie.com https://www.youtube.com",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

export function stageStatic(target = dist) {
  ensureConfig();
  mkdirSync(target, { recursive: true });
  for (const file of ['style.css', 'icon.png']) cpSync(join(app, file), join(target, file));
  const policy = contentSecurityPolicy();
  const html = readFileSync(join(app, 'index.html'), 'utf8').replace('<!--CSP-->', `<meta http-equiv="Content-Security-Policy" content="${policy}">`);
  writeFileSync(join(target, 'index.html'), html);
  const widget = readFileSync(join(app, 'config.xml'), 'utf8').replace('<!--CSP-->', `<tizen:content-security-policy>${policy}</tizen:content-security-policy>`);
  writeFileSync(join(target, 'config.xml'), widget);
    cpSync(join(app, 'fonts'), join(target, 'fonts'), { recursive: true });
  cpSync(join(app, 'service'), join(target, 'service'), { recursive: true });
}

export function buildOptions(target = dist) {
  return {
    entryPoints: [join(app, 'src', 'main.ts')],
    bundle: true,
    minify: true,
    sourcemap: false,
    target: 'chrome85',
    format: 'iife',
    outfile: join(target, 'app.js'),
    define: {
      __BUILD_TIME__: JSON.stringify(new Date().toLocaleString('en-GB', { timeZone: 'Europe/Paris', dateStyle: 'medium', timeStyle: 'short' })),
    },
    logLevel: 'info',
  };
}

export async function buildOnce() {
  rmSync(dist, { recursive: true, force: true });
  stageStatic();
  await build(buildOptions());
}

export async function watch() {
  rmSync(dist, { recursive: true, force: true });
  stageStatic();
  const watcher = await context(buildOptions());
  await watcher.watch();
  return watcher;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await buildOnce();
