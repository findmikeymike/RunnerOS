import * as fs from 'node:fs';
import { afterEach, expect, spyOn, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { assertUsableOutputAsset } from './asset-usability';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const id = '11111111-1111-4111-8111-111111111111';
function fixture() { const root = mkdtempSync(join(tmpdir(), 'output-asset-check-')); roots.push(root); mkdirSync(join(root, 'outputs', id), { recursive: true }); return root; }

test('relative bundle files, absolute workspace files and contained symlinks resolve to readable files', () => {
  const root = fixture(), file = join(root, 'outputs', id, 'content.bin');
  writeFileSync(file, Buffer.from([0, 255]));
  symlinkSync(file, join(root, 'linked.bin'));
  expect(assertUsableOutputAsset(root, id, 'content.bin')).toBe(realpathSync(file));
  expect(assertUsableOutputAsset(root, id, file)).toBe(realpathSync(file));
  expect(assertUsableOutputAsset(root, id, join(root, 'linked.bin'))).toBe(realpathSync(file));
});

test('escaping symlinks, missing files and directories are unavailable', () => {
  const root = fixture(), outside = fixture();
  writeFileSync(join(outside, 'outside.bin'), 'external');
  symlinkSync(join(outside, 'outside.bin'), join(root, 'escape.bin'));
  expect(() => assertUsableOutputAsset(root, id, join(root, 'escape.bin'))).toThrow('outside');
  expect(() => assertUsableOutputAsset(root, id, 'missing.bin')).toThrow('unavailable');
  expect(() => assertUsableOutputAsset(root, id, join(root, 'outputs'))).toThrow('regular file');
});

(process.platform === 'win32' ? test.skip : test)('named pipes are rejected without waiting for a writer', () => {
  const root = fixture(), pipe = join(root, 'pipe');
  execFileSync('mkfifo', [pipe]);
  expect(() => assertUsableOutputAsset(root, id, pipe)).toThrow('regular file');
});


test('a read error after opening the file is reported as unavailable', () => {
  const root = fixture(), file = join(root, 'outputs', id, 'content.bin');
  writeFileSync(file, 'retained bytes');
  const read = spyOn(fs, 'readSync').mockImplementation(() => { throw Object.assign(new Error('injected read error'), { code: 'EIO' }); });
  try { expect(() => assertUsableOutputAsset(root, id, 'content.bin')).toThrow('unavailable'); }
  finally { read.mockRestore(); }
  expect(assertUsableOutputAsset(root, id, 'content.bin')).toBe(realpathSync(file));
});
