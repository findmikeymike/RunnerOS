#!/usr/bin/env bun

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const resourcesDir = resolve(import.meta.dir, '../apps/electron/resources');
const source = join(resourcesDir, 'artist-os-icon.svg');
const temporary = mkdtempSync(join(tmpdir(), 'artist-os-icons-'));

async function render(size: number): Promise<Buffer> {
  const output = join(temporary, `icon-${size}.png`);
  const process = Bun.spawn([
    'magick',
    source,
    '-background', 'none',
    '-resize', `${size}x${size}`,
    '-depth', '8',
    `PNG32:${output}`,
  ], { stdout: 'pipe', stderr: 'pipe' });
  const [stderr, exitCode] = await Promise.all([
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (exitCode !== 0) throw new Error(`ImageMagick failed for ${size}px: ${stderr}`);
  return readFileSync(output);
}

function icnsChunk(type: string, png: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.write(type, 0, 4, 'ascii');
  header.writeUInt32BE(png.length + 8, 4);
  return Buffer.concat([header, png]);
}

const sizes = [16, 32, 64, 128, 256, 512, 1024] as const;
const pngs = new Map<number, Buffer>();
for (const size of sizes) pngs.set(size, await render(size));

const chunks = [
  icnsChunk('icp4', pngs.get(16)!),
  icnsChunk('icp5', pngs.get(32)!),
  icnsChunk('icp6', pngs.get(64)!),
  icnsChunk('ic07', pngs.get(128)!),
  icnsChunk('ic08', pngs.get(256)!),
  icnsChunk('ic09', pngs.get(512)!),
  icnsChunk('ic10', pngs.get(1024)!),
];
const icnsHeader = Buffer.alloc(8);
icnsHeader.write('icns', 0, 4, 'ascii');
icnsHeader.writeUInt32BE(chunks.reduce((size, chunk) => size + chunk.length, 8), 4);
writeFileSync(join(resourcesDir, 'artist-os-icon.icns'), Buffer.concat([icnsHeader, ...chunks]));
writeFileSync(join(resourcesDir, 'artist-os-icon.png'), pngs.get(512)!);

const ico = Bun.spawn([
  'magick',
  source,
  '-background', 'none',
  '-define', 'icon:auto-resize=256,128,64,48,32,24,16',
  join(resourcesDir, 'artist-os-icon.ico'),
], { stdout: 'pipe', stderr: 'pipe' });
const [icoStderr, icoExitCode] = await Promise.all([
  new Response(ico.stderr).text(),
  ico.exited,
]);
if (icoExitCode !== 0) throw new Error(`ImageMagick failed for ICO: ${icoStderr}`);

console.log('Generated Artist OS PNG, ICNS, and ICO assets.');
