// Package the offline bundle: dist/local-compiler.zip with MicroLab/{server.py, web/, source/, ...}.
import {readdir, readFile, stat, writeFile} from 'node:fs/promises';
import {join, relative} from 'node:path';
import {deflateRawSync} from 'node:zlib';

const crcTable = Array.from({length: 256}, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

async function walk(dir, skip = () => false) {
  const out = [];
  for (const entry of await readdir(dir, {withFileTypes: true})) {
    const full = join(dir, entry.name);
    if (skip(full, entry)) continue;
    if (entry.isDirectory()) out.push(...await walk(full, skip)); else out.push(full);
  }
  return out;
}

const files = []; // [archivePath, absolutePath, mode]
const add = (archive, file, mode = 0o644) => files.push([archive.replaceAll('\\', '/'), file, mode]);
for (const f of await walk('dist', full => full.endsWith('local-compiler.zip'))) { add('MicroLab/web/' + relative('dist', f), f); add('MicroLab/source/dist/' + relative('dist', f), f); }
add('MicroLab/server.py', 'local/server.py', 0o755);
add('MicroLab/Start-Windows.bat', 'local/Start-Windows.bat');
add('MicroLab/Start-Mac.command', 'local/Start-Mac.command', 0o755);
add('MicroLab/README.txt', 'local/README.txt');
const skipSource = (full, entry) => ['node_modules', 'dist', '.git', 'web', '__pycache__'].includes(entry.name);
for (const top of ['src', 'tests', 'local', 'scripts']) for (const f of await walk(top, skipSource)) add('MicroLab/source/' + f, f);
for (const f of ['package.json', 'package-lock.json', 'README.md', 'LICENSE']) add('MicroLab/source/' + f, f);

const chunks = [], central = [];
let offset = 0;
const dosTime = (d => ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff)(new Date());
const dosDate = (d => (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff)(new Date());
for (const [name, file, mode] of files) {
  const data = await readFile(file), packed = deflateRawSync(data, {level: 9}), crc = crc32(data), nameBuf = Buffer.from(name, 'utf8');
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
  local.writeUInt16LE(dosTime, 10); local.writeUInt16LE(dosDate, 12); local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26);
  chunks.push(local, nameBuf, packed);
  const entry = Buffer.alloc(46);
  entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(0x0314, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(0x0800, 8); entry.writeUInt16LE(8, 10);
  entry.writeUInt16LE(dosTime, 12); entry.writeUInt16LE(dosDate, 14); entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(packed.length, 20);
  entry.writeUInt32LE(data.length, 24); entry.writeUInt16LE(nameBuf.length, 28); entry.writeUInt32LE(((0o100000 | mode) << 16) >>> 0, 38); entry.writeUInt32LE(offset, 42);
  central.push(entry, nameBuf);
  offset += 30 + nameBuf.length + packed.length;
}
const centralSize = central.reduce((a, b) => a + b.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16);
await writeFile('dist/local-compiler.zip', Buffer.concat([...chunks, ...central, end]));
console.log(`dist/local-compiler.zip: ${files.length} files, ${((await stat('dist/local-compiler.zip')).size / 1024 / 1024).toFixed(2)} MB`);
