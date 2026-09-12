import { afterEach, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, lstatSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backupConfigSnapshot, readConfigSnapshot, writeConfigSnapshot } from '../config-recovery.ts';

const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'app-config-recovery-')); roots.push(root);
  const file = join(root, 'config.json');
  const workspace = join(root, 'workspace'); mkdirSync(workspace);
  writeFileSync(join(workspace, 'config.json'), JSON.stringify({ id: 'hq', name: 'HQ', slug: 'hq', createdAt: 1, updatedAt: 1 }));
  const config: import('../storage.ts').StoredConfig = { workspaces: [{ id: 'hq', name: 'HQ', slug: 'hq', rootPath: workspace, artistWorkspaceScope: 'hq', createdAt: 1 }], activeWorkspaceId: 'hq', activeSessionId: null };
  return { root, file, config, raw: JSON.stringify(config) };
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

test.each(['missing', 'broken', 'invalid-schema'])('restores %s primary from newest valid daily snapshot', (state) => {
  const f = fixture();
  writeFileSync(join(f.root, 'config.json.bak-2026-09-01'), f.raw);
  writeFileSync(join(f.root, 'config.json.bak-2026-09-02'), 'broken newest snapshot');
  if (state !== 'missing') writeFileSync(f.file, state === 'broken' ? '{broken' : '{"workspaces":[{}]}');
  expect(readConfigSnapshot(f.file)).toEqual(f.config);
  expect(readFileSync(f.file, 'utf8')).toBe(f.raw);
  expect(readdirSync(f.root).filter(name => name.includes('.corrupt-')).length).toBe(state === 'missing' ? 0 : 1);
  if (process.platform !== 'win32') expect(statSync(f.file).mode & 0o777).toBe(0o600);
});

test('does not rotate good snapshots when the primary is corrupt', () => {
  const f = fixture();
  for (let day = 1; day <= 3; day++) writeFileSync(join(f.root, `config.json.bak-2026-09-0${day}`), f.raw);
  writeFileSync(f.file, '{broken');
  expect(() => backupConfigSnapshot(f.file, new Date(2026, 8, 4))).toThrow();
  expect(readdirSync(f.root).filter(name => name.includes('.bak-'))).toHaveLength(3);
  expect(readFileSync(f.file, 'utf8')).toBe('{broken');
});

test('retains three validated days and repairs a corrupt same-day snapshot with evidence', () => {
  const f = fixture(); writeFileSync(f.file, f.raw);
  for (let day = 1; day <= 4; day++) backupConfigSnapshot(f.file, new Date(2026, 8, day));
  expect(existsSync(join(f.root, 'config.json.bak-2026-09-01'))).toBe(false);
  const latest = join(f.root, 'config.json.bak-2026-09-04');
  writeFileSync(latest, 'damaged backup');
  backupConfigSnapshot(f.file, new Date(2026, 8, 4));
  expect(readFileSync(latest, 'utf8')).toBe(f.raw);
  expect(readdirSync(f.root).filter(name => name.includes('.corrupt-'))).toHaveLength(1);
});

test('a same-day snapshot remains the first valid state of that day', () => {
  const f = fixture(); writeFileSync(f.file, f.raw);
  backupConfigSnapshot(f.file, new Date(2026, 8, 4));
  writeConfigSnapshot(f.file, JSON.stringify({ ...f.config, colorTheme: 'new-theme' }));
  backupConfigSnapshot(f.file, new Date(2026, 8, 4));
  expect(readFileSync(join(f.root, 'config.json.bak-2026-09-04'), 'utf8')).toBe(f.raw);
});

test.each(['missing', 'broken'])('unrecoverable %s primary preserves snapshots and never masquerades as first run', (state) => {
  const f = fixture();
  const backup = join(f.root, 'config.json.bak-2026-09-01'); writeFileSync(backup, 'broken backup');
  if (state === 'broken') writeFileSync(f.file, 'broken primary');
  expect(() => readConfigSnapshot(f.file)).toThrow('could not be recovered');
  expect(readFileSync(backup, 'utf8')).toBe('broken backup');
  expect(existsSync(f.file)).toBe(state === 'broken');
});

test('a genuinely new profile remains an ordinary first run', () => {
  expect(readConfigSnapshot(fixture().file)).toBeNull();
});

test.each(['broken primary', JSON.stringify({workspaces:[{rootPath:'/tmp/unusable',name:42}]})])('public config loader recovers damaged state (%s) and saves preserve unrecoverable data', (damaged) => {
  const f = fixture(); writeFileSync(f.file, damaged);
  const backup = join(f.root, 'config.json.bak-2026-09-01'); writeFileSync(backup, f.raw);
  const source = `import { loadStoredConfig, saveConfig } from ${JSON.stringify(join(import.meta.dir, '../storage.ts'))};
    import { writeFileSync, rmSync, readFileSync, readdirSync } from 'node:fs';
    const loaded = loadStoredConfig(); if (loaded?.workspaces[0]?.id !== 'hq') throw new Error('not recovered');
    writeFileSync(${JSON.stringify(f.file)}, 'preserve-broken'); for (const name of readdirSync(${JSON.stringify(f.root)})) if (/^config\\.json\\.bak-/.test(name)) rmSync(${JSON.stringify(f.root)} + '/' + name);
    let rejected = false; try { saveConfig({workspaces: [], activeWorkspaceId:null, activeSessionId:null}); } catch { rejected = true; }
    if (!rejected || readFileSync(${JSON.stringify(f.file)}, 'utf8') !== 'preserve-broken') throw new Error('overwrote damaged registry');`;
  const result = Bun.spawnSync([process.execPath, '--eval', source], { env: { ...process.env, CRAFT_CONFIG_DIR: f.root }, stdout: 'pipe', stderr: 'pipe' });
  expect({ exit: result.exitCode, stderr: result.stderr.toString() }).toEqual({ exit: 0, stderr: '' });
});

test('a dangling primary symlink is preserved instead of treated as a new profile', () => {
  const f = fixture();
  symlinkSync(join(f.root, 'unavailable-config'), f.file);
  expect(() => readConfigSnapshot(f.file)).toThrow('could not be recovered');
  expect(lstatSync(f.file).isSymbolicLink()).toBe(true);
  writeFileSync(join(f.root, 'config.json.bak-2026-09-01'), f.raw);
  expect(() => readConfigSnapshot(f.file)).toThrow('regular file');
  expect(lstatSync(f.file).isSymbolicLink()).toBe(true);
});
