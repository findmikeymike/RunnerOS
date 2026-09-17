import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startProcess, type RunningProcess } from './process-support';

test('saved source binding survives process death and refuses a rotated account credential on reopen', async () => {
  const root = mkdtempSync(join(tmpdir(), 'connected-binding-process-'));
  let child: RunningProcess | undefined;
  try {
    writeFileSync(join(root, 'synthetic-only'), 'connected-binding-fixture');
    writeFileSync(join(root, 'synthetic-token'), 'synthetic-first-token');
    mkdirSync(join(root, 'sources', 'account'), { recursive: true });
    writeFileSync(join(root, 'sources', 'account', 'config.json'), JSON.stringify({
      id: 'account', name: 'Account', slug: 'account', provider: 'fixture', type: 'api', enabled: true, isAuthenticated: true,
      api: { baseUrl: 'https://api.example.com/v1/', authType: 'bearer' },
    }));
    const env = { CRAFT_CONFIG_DIR: join(root, 'isolated-config'), CRAFT_PRODUCT_VARIANT: 'artist-os' };
    child = startProcess([join(import.meta.dir, 'connected-binding-worker.ts'), root, 'capture'], env);
    await child.line(line => line.includes('binding-saved'));
    child.child.kill('SIGKILL'); expect((await child.done).signal).toBe('SIGKILL');
    expect(readFileSync(join(root, 'saved-binding.json'), 'utf8')).not.toContain('synthetic-first-token');
    for (const mode of ['unchanged', 'changed']) {
      if (mode === 'changed') writeFileSync(join(root, 'synthetic-token'), 'synthetic-replacement-token');
      child = startProcess([join(import.meta.dir, 'connected-binding-worker.ts'), root, mode], env);
      const done = await child.done;
      expect({ code: done.code, stderr: done.code ? done.stderr : '' }).toEqual({ code: 0, stderr: '' });
      expect(done.stdout).toContain('binding-verified');
      expect(done.stdout).not.toContain('synthetic-first-token');
      expect(done.stdout).not.toContain('synthetic-replacement-token');
    }
  } finally {
    if (child && child.child.exitCode === null) { child.child.kill('SIGKILL'); await child.done; }
    rmSync(root, { recursive: true, force: true });
  }
}, 15000);
