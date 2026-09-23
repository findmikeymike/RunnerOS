import { expect, test } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { assertBundledBun } = require('./bun-runtime-gate.cjs');

test('package gate rejects missing, empty and non-executable Bun before accepting a prepared target', () => {
  const root = mkdtempSync(join(tmpdir(), 'bun-gate-'));
  try {
    expect(() => assertBundledBun(root, 'darwin')).toThrow('bundled Bun');
    mkdirSync(join(root, 'vendor/bun'), { recursive: true });
    const runtime = join(root, 'vendor/bun/bun');
    writeFileSync(runtime, '');
    expect(() => assertBundledBun(root, 'darwin')).toThrow('bundled Bun');
    writeFileSync(runtime, 'target executable');
    chmodSync(runtime, 0o644);
    if (process.platform !== 'win32') expect(() => assertBundledBun(root, 'darwin')).toThrow('bundled Bun');
    chmodSync(runtime, 0o755);
    expect(() => assertBundledBun(root, 'darwin')).not.toThrow();
    expect(() => assertBundledBun(root, 'win32')).toThrow('bundled Bun');
    writeFileSync(join(root, 'vendor/bun/bun.exe'), 'windows target');
    expect(() => assertBundledBun(root, 'win32')).not.toThrow();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('beforePack still checks Bun when the gateway is already prepared', async () => {
  const root = mkdtempSync(join(tmpdir(), 'beforepack-bun-'));
  const prior = process.env.ARTIST_OS_UPDATE_URL;
  process.env.ARTIST_OS_UPDATE_URL = 'https://updates.example.com/artist-os';
  try {
    const server = join(root, 'vendor/omniroute-runtime/node_modules/omniroute/dist');
    mkdirSync(server, { recursive: true });
    writeFileSync(join(server, 'server-ws.mjs'), '// prepared');
    const beforePack = require('./beforePack.cjs').default;
    await expect(beforePack({ packager: { projectDir: root }, electronPlatformName: 'darwin' })).rejects.toThrow('bundled Bun');
  } finally {
    if (prior === undefined) delete process.env.ARTIST_OS_UPDATE_URL;
    else process.env.ARTIST_OS_UPDATE_URL = prior;
    rmSync(root, { recursive: true, force: true });
  }
});
