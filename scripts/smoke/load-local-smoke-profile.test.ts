import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, symlinkSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getOutputDir, listOutputManifests } from '../../packages/shared/src/outputs/index.ts';
import { getContextDocFile, loadContextDoc } from '../../packages/shared/src/workspace-context/index.ts';
import { seedDisposableSmoke } from './load-local-smoke-profile.ts';

const cleanup: string[] = [];
function temp() {
  const path = mkdtempSync(join(realpathSync(tmpdir()), 'smoke-fixtures-'));
  cleanup.push(path);
  return path;
}
afterEach(() => { for (const path of cleanup.splice(0)) rmSync(path, { recursive: true, force: true }); });

test('current readers load isolated HQ/campaign documents and previewable outputs; reseeding preserves edits', () => {
  const destination = join(temp(), 'fixtures');
  const roots = seedDisposableSmoke(destination);
  for (const scope of ['hq', 'campaign'] as const) {
    const docs = loadContextDoc(roots[scope], scope === 'hq' ? 'artist-profile' : 'mission-brief');
    expect(docs?.body).toContain(scope === 'hq' ? 'Example Lanterns' : 'Paper Moon Demo');
    const manifests = listOutputManifests(roots[scope]);
    expect(manifests).toHaveLength(1);
    const manifest = manifests[0]!;
    expect(manifest.workspaceId).toBe(scope === 'hq' ? 'smoke-hq' : 'smoke-campaign');
    expect(manifest.context).toEqual(scope === 'hq' ? { scope: 'hq' } : { scope: 'campaign', campaignId: 'smoke-campaign' });
    expect(manifest.primary).toBeDefined();
    expect(manifest.preview).toBeDefined();
    const outputDirectory = getOutputDir(roots[scope], manifest.id);
    const contentPath = join(outputDirectory, manifest.primary!.path);
    expect(readFileSync(contentPath, 'utf8')).toContain('#');
    writeFileSync(contentPath, 'User edited content');
  }
  const docPath = getContextDocFile(roots.hq, 'artist-profile');
  writeFileSync(docPath, readFileSync(docPath, 'utf8').replace('Example Lanterns', 'User edit'));
  seedDisposableSmoke(destination);
  expect(loadContextDoc(roots.hq, 'artist-profile')?.body).toContain('User edit');
  for (const root of Object.values(roots)) {
    const manifests = listOutputManifests(root);
    expect(manifests).toHaveLength(1);
    expect(readFileSync(join(getOutputDir(root, manifests[0]!.id), manifests[0]!.primary!.path), 'utf8')).toBe('User edited content');
  }
});

test('refuses existing unmarked workspace and never touches unrelated files', () => {
  const destination = temp();
  writeFileSync(join(destination, 'credentials.enc'), 'private sentinel');
  expect(() => seedDisposableSmoke(destination)).toThrow('unmarked');
  expect(readdirSync(destination)).toEqual(['credentials.enc']);
  expect(readFileSync(join(destination, 'credentials.enc'), 'utf8')).toBe('private sentinel');
});

test('rejects traversal, relative paths, symlink ancestors, children, and dangling links', () => {
  const base = temp();
  expect(() => seedDisposableSmoke('relative')).toThrow('absolute');
  expect(() => seedDisposableSmoke(`${base}/../other`)).toThrow('traversal');
  const link = join(base, 'link');
  symlinkSync(base, link);
  expect(() => seedDisposableSmoke(join(link, 'child'))).toThrow('Symlink');
  const destination = join(base, 'fixtures');
  const roots = seedDisposableSmoke(destination);
  symlinkSync(join(base, 'missing'), join(roots.hq, 'dangling'));
  expect(() => seedDisposableSmoke(destination)).toThrow('Symlink');
});

test('invalid marker and extra container files are refused; empty directories work', () => {
  const destination = temp();
  seedDisposableSmoke(destination);
  const marker = join(destination, '.artist-os-disposable-smoke.json');
  const original = readFileSync(marker, 'utf8');
  writeFileSync(marker, '{}');
  expect(() => seedDisposableSmoke(destination)).toThrow('marker');
  writeFileSync(marker, original);
  writeFileSync(join(destination, 'workspace.json'), '{}');
  expect(() => seedDisposableSmoke(destination)).toThrow('Unexpected');
});

test('production and custom profile/credential arguments are rejected', () => {
  const destination = join(temp(), 'fixtures');
  const script = join(import.meta.dir, 'load-local-smoke-profile.ts');
  const production = Bun.spawnSync([process.execPath, script, '--destination', destination], { env: { ...process.env, NODE_ENV: 'production' } });
  expect(production.exitCode).not.toBe(0);
  expect(production.stderr.toString()).toContain('Production seeding refused');
  const custom = Bun.spawnSync([process.execPath, script, '--profile', '/nonexistent/credentials'], { env: { ...process.env, NODE_ENV: 'test' } });
  expect(custom.exitCode).not.toBe(0);
  expect(custom.stderr.toString()).toContain('Usage:');
});
