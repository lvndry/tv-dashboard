// Creates app/config.ts from the committed template the first time, so a fresh clone builds.
import { copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = join(dirname(fileURLToPath(import.meta.url)), '..', 'app');

export function ensureConfig() {
  const target = join(app, 'config.ts');
  if (existsSync(target)) return;
  copyFileSync(join(app, 'config.example.ts'), target);
  console.log('Created app/config.ts from app/config.example.ts. Edit it to make the dashboard yours.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) ensureConfig();
