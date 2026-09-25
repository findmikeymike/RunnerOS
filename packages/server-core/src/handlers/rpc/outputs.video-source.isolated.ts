import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mock } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as actualConfig from '@craft-agent/shared/config';
import { createOutputBundle, getOutputDir } from '@craft-agent/shared/outputs';
import { RPC_CHANNELS } from '@craft-agent/shared/protocol';

const root = mkdtempSync(join(tmpdir(), 'video-source-rpc-'));
const workspaceId = 'video-source-isolated';
const outputId = 'c1370000-1111-4111-8111-111111111112';
const originalLookup = actualConfig.getWorkspaceByNameOrId;
mock.module('@craft-agent/shared/config', () => ({ ...actualConfig,
  getWorkspaceByNameOrId: (id: string) => id === workspaceId ? { id, name: 'Fixture', rootPath: root } : originalLookup(id),
}));
try {
  const dir = getOutputDir(root, outputId);
  mkdirSync(dir, { recursive: true });
  const red = join(dir, 'red.png');
  const blue = join(dir, 'blue.png');
  writeFileSync(red, 'red pixels');
  writeFileSync(blue, 'blue pixels');
  const tone = join(dir, 'tone.wav');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.1', tone]);
  const silent = join(dir, 'silent.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=s=16x16:d=0.1', '-an', silent]);
  const alias = join(dir, 'red-alias.png');
  symlinkSync(red, alias);
  createOutputBundle(root, { id: outputId, workspaceId, title: 'Fixture', kind: 'video', origin: { source: 'manual' },
    assets: [{ id: 'image', label: 'Image', role: 'attachment', path: 'red.png', mimeType: 'image/png' }, { id: 'tone', label: 'Tone', role: 'attachment', path: 'tone.wav', mimeType: 'audio/wav' }, { id: 'silent', label: 'Silent', role: 'attachment', path: 'silent.mp4', mimeType: 'video/mp4' }] });
  const handlers = new Map<string, any>();
  const { registerOutputsHandlers } = await import('./outputs');
  registerOutputsHandlers({ handle: (channel: string, handler: any) => handlers.set(channel, handler), push() {}, invokeClient: async () => undefined } as any, { sessionManager: {} } as any);
  const handler = handlers.get(RPC_CHANNELS.outputs.READ_ASSET_DATA_URL);
  assert.equal(typeof handler, 'function');
  const read = (expected?: unknown, assetId = 'image') => handler({ clientId: 'fixture', workspaceId }, workspaceId, outputId, assetId, expected);
  const expectedData = `data:image/png;base64,${Buffer.from('red pixels').toString('base64')}`;
  assert.equal(await read(), expectedData);
  assert.equal(await read(red), expectedData);
  assert.equal(await read(alias), expectedData);
  assert.equal(await read(join(dir, 'nested', '..', 'red.png')), expectedData);
  await assert.rejects(read(blue), /Reimport or relink/);
  await assert.rejects(read(join(dir, 'missing.png')), /Reimport or relink/);
  await assert.rejects(read('red.png'), /Reimport or relink/);
  await assert.rejects(read(''), /Reimport or relink/);
  await assert.rejects(read(123), /Reimport or relink/);
  await assert.rejects(read('/etc/passwd'), /Reimport or relink/);
  await assert.rejects(read(blue, 'missing-asset'), /no asset/);
  const infoHandler = handlers.get(RPC_CHANNELS.outputs.READ_ASSET_MEDIA_INFO);
  const info = (assetId: string, expected?: unknown) => infoHandler({ clientId: 'fixture', workspaceId }, workspaceId, outputId, assetId, expected);
  assert.deepEqual(await info('tone', tone), { hasAudio: true });
  assert.deepEqual(await info('silent', silent), { hasAudio: false });
  await assert.rejects(info('tone', silent), /Reimport or relink/);
  await assert.rejects(info('tone'), /Reimport or relink/);
  await assert.rejects(info('tone', '/etc/passwd'), /Reimport or relink/);
  writeFileSync(red, '');
  await assert.rejects(info('image', red), /Could not inspect preview audio/);
  // Identity mismatch must be checked before reading even the selected asset.
  rmSync(red);
  await assert.rejects(read(blue), /Reimport or relink/);
} finally { rmSync(root, { recursive: true, force: true }); }
