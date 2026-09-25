import { expect, test } from 'bun:test';
import { join } from 'node:path';

test('Output media source identity through registered RPC (isolated config)', () => {
  const child = Bun.spawnSync([process.execPath, join(import.meta.dir, 'outputs.video-source.isolated.ts')], { stdout: 'pipe', stderr: 'pipe' });
  expect(child.exitCode, new TextDecoder().decode(child.stderr)).toBe(0);
}, 30_000);
