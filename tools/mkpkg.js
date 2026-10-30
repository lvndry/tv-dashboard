// Build app/dist, then package it as app/dist/tv-dashboard.wgt: signed with tizenjs when it
// and the certificates are available, unsigned otherwise (Tizen Tap re-signs every package
// with the TV's own certificate at install time).
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { buildOnce, dist } from './build.js';
import { loadEnv, root } from './env.js';

loadEnv();
await buildOnce();

const output = join(dist, 'tv-dashboard.wgt');
const certs = join(process.env.HOME ?? '', '.tizen-certs');
const siblingTizenjs = join(root, '..', 'tizen-tap', 'node_modules', '.bin', 'tizenjs');

/** Why the package can't be signed here, or null when it can. */
function unsignedReason(tizenjs) {
  if (!tizenjs) return `no TIZENJS set and no tizenjs at ${siblingTizenjs}`;
  if (!existsSync(tizenjs)) return `TIZENJS points at ${tizenjs}, which does not exist`;
  const missing = ['author.p12', 'distributor.p12'].filter(name => !existsSync(join(certs, name)));
  if (missing.length) return `no ${missing.join(' or ')} in ${certs}`;
  return null;
}

function sign(tizenjs) {
  const readPassword = name => existsSync(join(certs, name)) ? readFileSync(join(certs, name), 'utf8').trim() : '';
  execFileSync(tizenjs, [
    'build', '.',
    '-t', 'wgt',
    '-o', output,
    '--author', join(certs, 'author.p12'),
    '--authorPwd', readPassword('author.pw'),
    '--distributor', join(certs, 'distributor.p12'),
    '--distributorPwd', readPassword('author.pw'),
  ], { cwd: dist, stdio: 'inherit' });
}

function filesUnder(directory) {
  return readdirSync(directory).flatMap(name => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xEDB88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(buffer) {
  let crc = 0xFFFFFFFF;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/** A plain deflate zip of app/dist, which is all an unsigned .wgt is. */
function packUnsigned() {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const path of filesUnder(dist).filter(path => path !== output)) {
    const name = Buffer.from(relative(dist, path).split(sep).join('/'));
    const data = readFileSync(path);
    const packed = deflateRawSync(data);
    const fields = Buffer.alloc(26);
    fields.writeUInt16LE(20, 0);
    fields.writeUInt16LE(0x0800, 2);
    fields.writeUInt16LE(8, 4);
    fields.writeUInt16LE(0, 6);
    fields.writeUInt16LE(0x21, 8);
    fields.writeUInt32LE(crc32(data), 10);
    fields.writeUInt32LE(packed.length, 14);
    fields.writeUInt32LE(data.length, 18);
    fields.writeUInt16LE(name.length, 22);
    fields.writeUInt16LE(0, 24);
    const local = Buffer.concat([Buffer.from([0x50, 0x4B, 0x03, 0x04]), fields, name, packed]);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014B50, 0);
    central.writeUInt16LE(20, 4);
    fields.copy(central, 6);
    central.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([central, name]));
    locals.push(local);
    offset += local.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054B50, 0);
  end.writeUInt16LE(centrals.length, 8);
  end.writeUInt16LE(centrals.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  writeFileSync(output, Buffer.concat([...locals, directory, end]));
}

const tizenjs = process.env.TIZENJS ? resolve(root, process.env.TIZENJS) : existsSync(siblingTizenjs) ? siblingTizenjs : '';
const reason = unsignedReason(tizenjs);
if (reason) {
  packUnsigned();
  console.log(`✓ unsigned → ${output} (${reason}; Tizen Tap signs it on install)`);
} else {
  sign(tizenjs);
  console.log(`✓ signed with ${tizenjs} → ${output}`);
}
