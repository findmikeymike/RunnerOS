import { RUNTIME_IDENTITY } from '../../config/runtime-identity.ts';
import { afterEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ManagedSkillRuntime, isPrivateSkillRuntimePath, type ManagedSkillRuntimeRecord } from './managed-skill-runtime.ts';
import { checkManagedSkillToolAccess } from './managed-skill-tool-guard.ts';
const roots: string[] = [];
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const fixture = (body = 'private original'): ManagedSkillRuntimeRecord => ({
  slug: 'test-skill', id: 'artist-os:skill:test-skill', revision: hash(body), content: body, path: '/old', metadata: { name: 'Test' },
  personalInstructions: [{ text: 'shared preference', scope: 'shared' }, { text: 'workspace preference', scope: 'workspace' }], personalRevision: hash('personal'),
  files: [{ path: 'SKILL.md', content: body, sha256: hash(body), kind: 'instruction' },
    { path: 'references/detail.md', content: 'private reference', sha256: hash('private reference'), kind: 'instruction' },
    { path: 'scripts/helper.py', content: 'print("work")', sha256: hash('print("work")'), kind: 'helper' }],
});
function runtime() { const root = mkdtempSync(join(tmpdir(), 'managed-runtime-')); roots.push(root); return { root, run: new ManagedSkillRuntime(root) }; }
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));

describe('private run guidance', () => {
  test('pins core, references and personal preferences once; new runs get current versions', () => {
    const { run } = runtime(); run.beginRun('one'); let loads = 0;
    run.pin('test-skill', () => { loads++; return fixture(); });
    run.pin('test-skill', () => { loads++; return fixture('updated'); });
    const first = run.instructions('test-skill'); expect(first.content).toContain('private original');
    expect(first.content.indexOf('shared personal instructions:')).toBeLessThan(first.content.indexOf('workspace personal instructions:'));
    expect(loads).toBe(1); expect(run.instructions('test-skill').alreadyLoaded).toBe(true);
    expect(run.instructions('test-skill', 'references/detail.md').content).toContain('private reference');
    run.resetContext(); expect(run.instructions('test-skill').alreadyLoaded).toBe(false);
    run.beginRun('two'); run.pin('test-skill', () => fixture('updated'));
    expect(run.instructions('test-skill').content).toContain('updated');
  });
  test('recovered runs retain exact files and rematerialize deleted helper copies', () => {
    const { run, root } = runtime(); run.beginRun('one'); const record = run.pin('test-skill', fixture);
    rmSync(join(root, '.skill-runtime', 'files'), { recursive: true });
    const restored = new ManagedSkillRuntime(root); restored.beginRun('one', true);
    expect(restored.instructions('test-skill').content).toContain('private original');
    expect(readFileSync(join(record.path, 'scripts/helper.py'), 'utf8')).toBe('print("work")');
  });
  test('missing, replaced and corrupted snapshots fail a resumed run', () => {
    const { run, root } = runtime(); expect(() => run.beginRun('missing', true)).toThrow('fresh run');
    run.beginRun('one'); run.pin('test-skill', fixture); run.beginRun('two');
    expect(() => new ManagedSkillRuntime(root).beginRun('one', true)).toThrow('fresh run');
    writeFileSync(join(root, '.skill-runtime/current.json'), '{bad');
    expect(() => new ManagedSkillRuntime(root).beginRun('two', true)).toThrow('fresh run');
  });
  test('invalid hashes, traversal, helper source and inherited object keys cannot load', () => {
    const { run } = runtime(); run.beginRun('one'); expect(run.get('constructor')).toBeUndefined();
    const bad = fixture(); bad.files = [{ ...bad.files[0]!, path: '../escape' }];
    expect(() => run.pin('test-skill', () => bad)).toThrow('fresh run');
    const corrupt = fixture(); corrupt.files = [{ ...corrupt.files[0]!, sha256: 'bad' }];
    expect(() => run.pin('test-skill', () => corrupt)).toThrow('fresh run');
    run.pin('test-skill', fixture);
    run.instructions('test-skill');
    expect(() => run.instructions('test-skill', 'scripts/helper.py')).toThrow('unavailable');
    expect(() => run.instructions('test-skill', 'SKILL.md')).toThrow('unavailable');
  });
  test('materialization refuses symlink destinations without changing the target', () => {
    const { root, run } = runtime(); run.beginRun('one'); const record = run.pin('test-skill', fixture);
    const target = join(root, 'user-work.md'); writeFileSync(target, 'keep exactly');
    const helper = join(record.path, 'scripts/helper.py'); rmSync(helper); symlinkSync(target, helper);
    expect(() => new ManagedSkillRuntime(root).beginRun('one', true)).toThrow('fresh run');
    expect(readFileSync(target, 'utf8')).toBe('keep exactly');
  });
  test('symlink aliases cannot expose existing snapshots or create files under private directories', () => {
    const { root, run } = runtime(); run.beginRun('one');
    const alias = join(root, 'public-alias');
    symlinkSync(join(root, '.skill-runtime'), alias);
    expect(isPrivateSkillRuntimePath(join(alias, 'current.json'))).toBe(true);
    expect(isPrivateSkillRuntimePath(join(alias, 'not-created', 'export.md'))).toBe(true);
    expect(isPrivateSkillRuntimePath(join(root, 'ordinary', 'file.md'))).toBe(false);
  });
  test.skipIf(RUNTIME_IDENTITY.variant !== 'artist-os')('ordinary file and copy tools are blocked while a pinned helper retains normal execution', () => {
    const { root, run } = runtime(); run.beginRun('one'); const record = run.pin('test-skill', fixture);
    const classify = (path: string) => run.classifyPath(path);
    expect(checkManagedSkillToolAccess('Bash', { command: `cp -R "${root}" /tmp/export-copy` }, root, classify, path => run.containsPrivatePath(path))).not.toBeNull();
    const core = join(record.path, 'SKILL.md'); const helper = join(record.path, 'scripts/helper.py');
    expect(checkManagedSkillToolAccess('Read', { file_path: core }, root, classify)).not.toBeNull();
    expect(checkManagedSkillToolAccess('Write', { file_path: core, content: 'replace' }, root, classify)).not.toBeNull();
    expect(checkManagedSkillToolAccess('Bash', { command: `cat "${helper}"` }, root, classify)).not.toBeNull();
    expect(checkManagedSkillToolAccess('Bash', { command: `cp "${core}" /tmp/export.md` }, root, classify)).not.toBeNull();
    expect(checkManagedSkillToolAccess('Bash', { command: `python3 "${helper}"` }, root, classify)).toBeNull();
    expect(checkManagedSkillToolAccess('Bash', { command: `cd "${record.path}" && python3 scripts/helper.py --output /tmp/out` }, root, classify)).toBeNull();
    expect(checkManagedSkillToolAccess('Bash', { command: `cat<"${core}"` }, root, classify)).not.toBeNull();
    expect(checkManagedSkillToolAccess('Bash', { command: `cd "${record.path}" && cat SKILL.md` }, root, classify)).not.toBeNull();
    expect(checkManagedSkillToolAccess('Bash', { command: `python3 "${helper}"; cat "${core}"` }, root, classify)).not.toBeNull();
    expect(checkManagedSkillToolAccess('Read', { file_path: join(root, 'user.md') }, root, classify)).toBeNull();
    expect(isPrivateSkillRuntimePath(join(root, '.skill-runtime/current.json'))).toBe(true);
  });
});
