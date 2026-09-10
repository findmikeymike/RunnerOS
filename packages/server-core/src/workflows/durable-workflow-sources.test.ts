import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, renameSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveDurableLocalSources, assertDurableLocalSourcesCurrent, selectDurableOptionalSources } from './durable-workflow-sources';
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'durable-source-')); roots.push(root);
  const folder = join(root, 'sources', 'notes'), path = join(root, 'notes');
  mkdirSync(folder, { recursive: true }); mkdirSync(path);
  const config = { id: 'notes', slug: 'notes', name: 'Notes', type: 'local', enabled: true, provider: 'local', local: { format: 'filesystem', path } };
  const save = (value: unknown = config) => writeFileSync(join(folder, 'config.json'), JSON.stringify(value)); save();
  writeFileSync(join(folder, 'guide.md'), 'Read release notes');
  return { root, folder, path, config, save };
}
test('freezes only selected local source descriptors, revalidates and deduplicates', () => {
  const f = fixture(); const saved = resolveDurableLocalSources(f.root, ['notes'], ['notes']);
  expect(saved).toHaveLength(1); expect(saved[0]).toMatchObject({ name: 'Notes', slug: 'notes', path: realpathSync(f.path), guide: 'Read release notes' });
  expect(saved[0]!.configDigest).toHaveLength(64); expect(() => assertDurableLocalSourcesCurrent(f.root, saved)).not.toThrow();
  expect(resolveDurableLocalSources(f.root)).toEqual([]);
});
test('missing and disabled required sources fail; absent or disabled optional sources stay unselected', () => {
  const f = fixture(); expect(() => resolveDurableLocalSources(f.root, ['missing'])).toThrow();
  expect(selectDurableOptionalSources(f.root, ['notes', 'missing'])).toEqual(['notes']);
  f.save({ ...f.config, enabled: false }); expect(selectDurableOptionalSources(f.root, ['notes'])).toEqual([]);
  expect(() => resolveDurableLocalSources(f.root, ['notes'])).toThrow();
});
test('rejects remote, generic local, file targets, path escape and hidden connector fields', () => {
  const f = fixture();
  for (const patch of [{ type: 'mcp' }, { mcp: {} }, { api: {} }, { local: { path: f.path } }, { local: { format: 'git', path: f.path } },
    { local: { format: 'filesystem', path: tmpdir() } }, { local: { format: 'filesystem', path: join(f.folder, 'config.json') } }, { slug: 'different' }]) {
    f.save({ ...f.config, ...patch }); expect(() => resolveDurableLocalSources(f.root, ['notes'])).toThrow('unsupported-durable-agent-bundle');
  }
  expect(() => resolveDurableLocalSources(f.root, ['../escape'])).toThrow();
});
test('guide/config edits and same-path directory replacement invalidate frozen source', () => {
  const f = fixture(), saved = resolveDurableLocalSources(f.root, ['notes']);
  writeFileSync(join(f.folder, 'guide.md'), 'Changed'); expect(() => assertDurableLocalSourcesCurrent(f.root, saved)).toThrow('durable-local-source-changed');
  writeFileSync(join(f.folder, 'guide.md'), 'Read release notes'); f.save({ ...f.config, name: 'Changed' }); expect(() => assertDurableLocalSourcesCurrent(f.root, saved)).toThrow();
  f.save(); renameSync(f.path, f.path + '-old'); mkdirSync(f.path); expect(() => assertDurableLocalSourcesCurrent(f.root, saved)).toThrow();
});
test('source directory and descriptor symlink swaps fail closed', () => {
  const f = fixture(), saved = resolveDurableLocalSources(f.root, ['notes']);
  renameSync(f.path, f.path + '-old'); symlinkSync(f.path + '-old', f.path); expect(() => assertDurableLocalSourcesCurrent(f.root, saved)).toThrow();
  rmSync(f.path); renameSync(f.path + '-old', f.path);
  renameSync(join(f.folder, 'guide.md'), join(f.folder, 'guide-original.md'));
  symlinkSync(join(f.folder, 'guide-original.md'), join(f.folder, 'guide.md')); expect(() => resolveDurableLocalSources(f.root, ['notes'])).toThrow();
});

test('mixed case and separator slugs revalidate in the same lexical order', () => {
  const f = fixture();
  const slugs = ['a-b', 'a_b', 'Alpha', 'beta'];
  for (const slug of slugs) {
    const folder = join(f.root, 'sources', slug); mkdirSync(folder);
    writeFileSync(join(folder, 'config.json'), JSON.stringify({ ...f.config, slug, id: slug }));
  }
  const saved = resolveDurableLocalSources(f.root, slugs);
  expect(saved.map(source => source.slug)).toEqual([...slugs].sort());
  expect(() => assertDurableLocalSourcesCurrent(f.root, saved)).not.toThrow();
});

test('canonical recovery root recognizes the original workspace alias without following child links', () => {
  const f = fixture();
  const saved = resolveDurableLocalSources(f.root, ['notes']);
  expect(() => assertDurableLocalSourcesCurrent(realpathSync(f.root), saved)).not.toThrow();
  renameSync(f.path, f.path + '-old'); symlinkSync(f.path + '-old', f.path);
  expect(() => assertDurableLocalSourcesCurrent(realpathSync(f.root), saved)).toThrow();
});
