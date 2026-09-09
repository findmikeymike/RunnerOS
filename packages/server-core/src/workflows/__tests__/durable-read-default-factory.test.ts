import { expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

test('real host default factory authenticates Pi IPC, reads a native file, and commits completion', async () => {
  const root = mkdtempSync(join(tmpdir(), 'artist-os-default-host-'));
  writeFileSync(join(root, '.synthetic-host-fixture'), 'synthetic-only');
  const child = spawn(process.execPath, [join(import.meta.dir, 'durable-read-default-factory.fixture.ts')], {
    cwd: root, env: { ...process.env, DURABLE_HOST_FIXTURE_ROOT: root, CRAFT_CONFIG_DIR: join(root, 'config'),
      CRAFT_PRODUCT_VARIANT: 'artist-os', CRAFT_BUNDLED_ASSETS_ROOT: resolve(import.meta.dir, '../../../../../apps/electron/resources') }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '', stderr = '';
  child.stdout!.on('data', chunk => { stdout += chunk; }); child.stderr!.on('data', chunk => { stderr += chunk; });
  const timer = setTimeout(() => child.kill('SIGKILL'), 45000);
  try {
    const code = await new Promise<number | null>((yes, no) => { child.once('error', no); child.once('exit', yes); });
    expect({ code, stderr: code === 0 ? '' : stderr, stdout: code === 0 ? '' : stdout }).toEqual({ code: 0, stderr: '', stdout: '' });
    const result = JSON.parse(stdout.split('\n').find(line => line.startsWith('DURABLE_HOST_RESULT:'))!.slice('DURABLE_HOST_RESULT:'.length));
    expect(result).toEqual({ status: 'succeeded', providerRequests: 2, modelAttempts: 2, nativeReadRecorded: true });
  } finally { clearTimeout(timer); child.kill('SIGKILL'); rmSync(root, { recursive: true, force: true }); }
}, 50000);
