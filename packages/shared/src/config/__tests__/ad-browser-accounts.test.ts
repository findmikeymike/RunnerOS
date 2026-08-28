import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';

const MODULE_URL = pathToFileURL(join(import.meta.dir, '..', 'ad-browser-accounts.ts')).href;

function makeConfigDir(): string {
  return mkdtempSync(join(tmpdir(), 'runner-ad-accounts-'));
}

function runEval(configDir: string, code: string): string {
  const run = Bun.spawnSync([
    process.execPath,
    '--eval',
    `import * as store from '${MODULE_URL}'; ${code}`,
  ], {
    env: { ...process.env, CRAFT_CONFIG_DIR: configDir },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (run.exitCode !== 0) throw new Error(run.stderr.toString());
  return run.stdout.toString().trim();
}

describe('ad browser accounts', () => {
  it('round-trips, updates, and deletes account metadata without session secrets', () => {
    const dir = makeConfigDir();
    expect(runEval(dir, 'console.log(JSON.stringify(store.listAdBrowserAccounts()))')).toBe('[]');
    runEval(dir, `store.saveAdBrowserAccount({ provider: 'meta-ads', profile: 'artist-main', label: 'Main Meta', accountId: 'act_123 456' })`);
    const created = JSON.parse(runEval(dir, `console.log(JSON.stringify(store.getAdBrowserAccount('meta-ads', 'artist-main')))`));
    expect(created.accountId).toBe('act_123456');

    runEval(dir, `store.saveAdBrowserAccount({ provider: 'meta-ads', profile: 'artist-main', label: 'Updated Meta' })`);
    const updated = JSON.parse(runEval(dir, `console.log(JSON.stringify(store.getAdBrowserAccount('meta-ads', 'artist-main')))`));
    expect(updated.label).toBe('Updated Meta');
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.accountId).toBe('act_123456');

    const raw = readFileSync(join(dir, 'ad-browser-accounts.json'), 'utf8');
    expect(raw).not.toContain('cookie');
    expect(raw).not.toContain('token');
    expect(runEval(dir, `console.log(store.deleteAdBrowserAccount('meta-ads', 'artist-main'))`)).toBe('true');
    expect(runEval(dir, `console.log(store.deleteAdBrowserAccount('meta-ads', 'artist-main'))`)).toBe('false');
  });

  it('rejects unsafe providers and profile names', () => {
    const dir = makeConfigDir();
    expect(() => runEval(dir, `store.saveAdBrowserAccount({ provider: 'instagram', profile: 'main' })`)).toThrow();
    expect(() => runEval(dir, `store.saveAdBrowserAccount({ provider: 'google-ads', profile: '../main' })`)).toThrow();
  });

  it('drops malformed stored rows instead of trusting them', () => {
    const dir = makeConfigDir();
    writeFileSync(join(dir, 'ad-browser-accounts.json'), JSON.stringify({
      version: 1,
      accounts: [
        { provider: 'meta-ads', profile: 'valid', label: 'Valid' },
        { provider: 'unknown', profile: 'bad' },
        { provider: 'google-ads', profile: '../escape' },
      ],
    }));
    const rows = JSON.parse(runEval(dir, 'console.log(JSON.stringify(store.listAdBrowserAccounts()))'));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.profile).toBe('valid');
  });
});
