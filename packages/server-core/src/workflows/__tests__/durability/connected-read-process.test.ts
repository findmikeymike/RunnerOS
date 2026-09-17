import { expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startProcess, type RunningProcess } from './process-support';

for (const stage of ['saved', 'unsaved'] as const) test(`SIGKILL ${stage} connected read preserves replay/attempt semantics and account access`, async () => {
  const root = mkdtempSync(join(tmpdir(), 'connected-read-crash-')); let child: RunningProcess | undefined;
  try {
    writeFileSync(join(root, 'synthetic-only'), 'connected-read-fixture');
    writeFileSync(join(root, 'synthetic-token'), 'synthetic-original-token');
    mkdirSync(join(root, 'sources', 'account'), { recursive: true });
    writeFileSync(join(root, 'sources', 'account', 'config.json'), JSON.stringify({ id: 'account', slug: 'account', name: 'Account',
      type: 'api', provider: 'fixture', enabled: true, isAuthenticated: true, api: { baseUrl: 'https://api.example.com/v1/', authType: 'bearer' } }));
    const env = { CRAFT_CONFIG_DIR: join(root, 'isolated-config'), DURABILITY_FIXTURE_KEY: randomBytes(32).toString('hex') };
    child = startProcess([join(import.meta.dir, 'connected-read-worker.ts'), root, stage], env);
    await child.line(line => line.includes(stage === 'saved' ? 'response-saved' : 'response-before-save'));
    child.child.kill('SIGKILL'); expect((await child.done).signal).toBe('SIGKILL');
    for (const mode of [stage === 'saved' ? 'recover-saved' : 'recover-unsaved', 'rotated']) {
      if (mode === 'rotated') writeFileSync(join(root, 'synthetic-token'), 'synthetic-replacement-token');
      child = startProcess([join(import.meta.dir, 'connected-read-worker.ts'), root, mode], env);
      const result = await child.done;
      expect({ code: result.code, stderr: result.code ? result.stderr : '' }).toEqual({ code: 0, stderr: '' });
      expect(result.stdout).toContain('recovery-verified'); expect(result.stdout).not.toContain('PRIVATE_ACCOUNT_RESULT');
    }
    expect(readFileSync(join(root, 'fetches'), 'utf8')).toBe(stage === 'saved' ? 'fetch\n' : 'fetch\nfetch\n');
    expect(readFileSync(join(root, 'durable-execution', 'journal.sqlite')).includes(Buffer.from('PRIVATE_ACCOUNT_RESULT'))).toBe(false);
  } finally {
    if (child && child.child.exitCode === null) { child.child.kill('SIGKILL'); await child.done; }
    rmSync(root, { recursive: true, force: true });
  }
}, 20000);
