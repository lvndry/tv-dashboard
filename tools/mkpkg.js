// Build app/dist, then sign it into a .wgt with tizenjs.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildOnce, dist } from './build.js';

await buildOnce();

const tizenjs = process.env.TIZENJS ?? '/tmp/thb/node_modules/.bin/tizenjs';
if (!existsSync(tizenjs)) throw new Error(`tizenjs not found at ${tizenjs}. Set TIZENJS to its path.`);
const certs = join(process.env.HOME ?? '', '.tizen-certs');
const readPassword = name => existsSync(join(certs, name)) ? readFileSync(join(certs, name), 'utf8').trim() : '';

execFileSync(tizenjs, [
  'build', '.',
  '-t', 'wgt',
  '-o', join(dist, 'bonsoir.wgt'),
  '--author', join(certs, 'author.p12'),
  '--authorPwd', readPassword('author.pw'),
  '--distributor', join(certs, 'distributor.p12'),
  '--distributorPwd', readPassword('author.pw'),
], { cwd: dist, stdio: 'inherit' });
console.log('✓ signed →', join(dist, 'bonsoir.wgt'));
