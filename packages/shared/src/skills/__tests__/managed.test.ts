import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { STARTER_SKILLS } from '../starter-templates';
import { BUNDLED_STARTER_SKILLS } from '../bundled.generated';
import { getManagedSkill, getManagedSkillManifest, getManagedSkillsRoot, isManagedSkill, isManagedSkillPath, resolveManagedSkillPath, toSkillDescriptor } from '../managed';
import { deletePersonalInstruction, exportPersonalInstruction, getOrphanedPersonalSkillDescriptors, getPersonalInstructions, importPersonalInstruction, MAX_PERSONAL_INSTRUCTION_BYTES, resolveManagedSkillInstructions, savePersonalInstruction } from '../personal-instructions';
import type { LoadedSkill } from '../types';

let root: string;
let options: { globalSkillsDir: string };
let workspace: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'managed-skill-test-')); options = { globalSkillsDir: join(root, 'global') }; workspace = join(root, 'workspace'); });
afterEach(() => rmSync(root, { recursive: true, force: true }));

test('missing-parent cards retain discoverability without leaking text or marking installed disabled skills unavailable', () => {
  importPersonalInstruction(workspace, { parentManagedId: 'artist-os:skill:retired-skill', text: 'Private shared advice' }, 'shared', options);
  importPersonalInstruction(workspace, { parentManagedId: 'artist-os:skill:retired-skill', text: 'Private workspace advice' }, 'workspace', options);
  importPersonalInstruction(join(root, 'other-workspace'), { parentManagedId: 'artist-os:skill:other-retired', text: 'Another workspace only' }, 'workspace', options);
  savePersonalInstruction(workspace, 'zero', { scope: 'workspace', text: 'Disabled but parent installed', enabled: false }, options);
  const descriptors = getOrphanedPersonalSkillDescriptors(workspace, options);
  expect(descriptors).toHaveLength(1);
  expect(descriptors[0]?.slug).toBe('retired-skill');
  expect(descriptors[0]?.available).toBe(false);
  expect(descriptors[0]?.origin).toBe('managed');
  expect(Object.values(descriptors[0]!.capabilities).every(value => !value)).toBe(true);
  expect(JSON.stringify(descriptors)).not.toContain('Private');
  expect(JSON.stringify(descriptors)).not.toContain(root);
  const records = getPersonalInstructions(workspace, 'retired-skill', options);
  expect(records.every(record => !record.enabled)).toBe(true);
  expect(exportPersonalInstruction(records[0]!).text).toBe('Private shared advice');
  expect(() => savePersonalInstruction(workspace, 'retired-skill', { scope: 'shared', text: 'replace', enabled: true }, options)).toThrow('unavailable');
  deletePersonalInstruction(workspace, 'retired-skill', 'shared', options);
  expect(getOrphanedPersonalSkillDescriptors(workspace, options)[0]?.source).toBe('workspace');
  deletePersonalInstruction(workspace, 'retired-skill', 'workspace', options);
  expect(getOrphanedPersonalSkillDescriptors(workspace, options)).toEqual([]);
});

test('empty or malformed imports cannot erase existing same-scope personal instructions', () => {
  for (const scope of ['shared', 'workspace'] as const) {
    const saved = savePersonalInstruction(workspace, 'zero', { scope, text: 'Keep my exact advice  \n', enabled: false }, options)!;
    for (const input of [
      { parentManagedId: saved.parentManagedId, text: '' },
      { parentManagedId: saved.parentManagedId, text: ' \n\t' },
      { parentManagedId: saved.parentManagedId, text: null },
      { parentManagedId: saved.parentManagedId },
      null,
    ]) {
      expect(() => importPersonalInstruction(workspace, input as Parameters<typeof importPersonalInstruction>[1], scope, options)).toThrow('must contain text');
      expect(getPersonalInstructions(workspace, 'zero', options).find(record => record.scope === scope)).toEqual(saved);
    }
  }
});

test('manifest covers inline and bundled cores and every declared reference deterministically', () => {
  const manifest = getManagedSkillManifest();
  expect(manifest.size).toBe(STARTER_SKILLS.length + BUNDLED_STARTER_SKILLS.length);
  for (const starter of [...STARTER_SKILLS, ...BUNDLED_STARTER_SKILLS]) {
    const entry = manifest.get(starter.slug)!;
    expect(entry.id).toBe(`artist-os:skill:${starter.slug}`);
    expect(entry.revision).toMatch(/^[a-f0-9]{64}$/);
    expect(entry.files.map(file => file.path).sort()).toEqual(starter.files.map(file => file.path).sort());
    expect(entry.files.every(file => /^[a-f0-9]{64}$/.test(file.sha256))).toBe(true);
  }
  expect(getManagedSkillManifest()).toBe(manifest);
});

test('managed descriptor has no body, paths, file inventory, or permission internals', () => {
  const skill = getManagedSkill('zero', options)!;
  expect(isManagedSkill(skill)).toBe(true);
  const descriptor = toSkillDescriptor(skill);
  expect(descriptor.origin).toBe('managed');
  expect(descriptor.metadata.requiredSources).toEqual(['zero']);
  expect(Object.keys(descriptor).sort()).toEqual(['capabilities', 'id', 'metadata', 'origin', 'revision', 'slug', 'source']);
  expect(Object.values(descriptor.capabilities).every(value => value === false)).toBe(true);
  const encoded = JSON.stringify(descriptor);
  expect(encoded).not.toContain(skill.path);
  expect(encoded).not.toContain('zero-budget.mjs');
  expect(encoded).not.toContain('alwaysAllow');
  expect(encoded).not.toContain('content');
});

test('same slug/frontmatter flags cannot classify an unrelated custom skill as managed', () => {
  const stock = getManagedSkill('zero', options)!;
  const user: LoadedSkill = { ...stock, path: join(workspace, 'skills', 'zero'), managed: undefined, content: 'My private work' };
  const descriptor = toSkillDescriptor(user);
  expect(descriptor.origin).toBe('user');
  expect(descriptor.capabilities.canEdit).toBe(true);
  expect(isManagedSkill({ ...user, managed: stock.managed })).toBe(false);
  expect(JSON.stringify(descriptor)).not.toContain(user.content);
});

test('private materialization is repeatable and rejects modified references rather than silently replacing them', () => {
  const skill = getManagedSkill('zero', options)!;
  expect(getManagedSkill('zero', options)!.path).toBe(skill.path);
  const file = join(skill.path, 'SKILL.md');
  writeFileSync(file, 'modified managed core');
  expect(() => getManagedSkill('zero', options)).toThrow('need recovery');
  expect(readFileSync(file, 'utf8')).toBe('modified managed core');
});

test('path ownership protects current and old directories; helper classification stays narrow', () => {
  const skill = getManagedSkill('zero', options)!;
  expect(resolveManagedSkillPath(join(skill.path, 'SKILL.md'), options)?.kind).toBe('instruction');
  expect(resolveManagedSkillPath(join(skill.path, 'scripts/zero-budget.mjs'), options)?.kind).toBe('helper');
  expect(isManagedSkillPath(skill.path, options)).toBe(true);
  expect(isManagedSkillPath(join(getManagedSkillsRoot(options), 'zero', 'old-revision', 'SKILL.md'), options)).toBe(true);
  expect(isManagedSkillPath(join(workspace, 'skills', 'zero', 'SKILL.md'), options)).toBe(false);
  const link = join(root, 'linked-core');
  symlinkSync(join(skill.path, 'SKILL.md'), link);
  expect(isManagedSkillPath(link, options)).toBe(true);
});

test('personal preferences retain identity, correct precedence and workspace isolation without copying core', () => {
  const shared = savePersonalInstruction(workspace, 'zero', { scope: 'shared', text: 'Prefer short answers.' }, options)!;
  const local = savePersonalInstruction(workspace, 'zero', { scope: 'workspace', text: 'For this campaign, use a formal tone.' }, options)!;
  const updated = savePersonalInstruction(workspace, 'zero', { scope: 'shared', text: 'Use plain language.' }, options)!;
  expect(updated.id).toBe(shared.id);
  expect(getPersonalInstructions(workspace, 'zero', options).map(record => record.text)).toEqual([updated.text, local.text]);
  expect(getPersonalInstructions(join(root, 'another'), 'zero', options).map(record => record.id)).toEqual([shared.id]);
  const snapshot = resolveManagedSkillInstructions(workspace, 'zero', options)!;
  expect(snapshot.personalInstructions.map(record => record.id)).toEqual([shared.id, local.id]);
  expect(snapshot.metadata.requiredSources).toEqual(['zero']);
  expect(snapshot.files.some(file => file.path === 'scripts/zero-budget.mjs')).toBe(true);
  expect(exportPersonalInstruction(local)).toEqual({ parentManagedId: 'artist-os:skill:zero', text: local.text });
  expect(JSON.stringify(getPersonalInstructions(workspace, 'zero', options))).not.toContain('zero-budget.mjs');
});

test('disabled and empty preferences do not load; deletion leaves shared instructions intact', () => {
  savePersonalInstruction(workspace, 'zero', { scope: 'shared', text: 'Keep this.' }, options);
  savePersonalInstruction(workspace, 'zero', { scope: 'workspace', text: 'Disabled preference.', enabled: false }, options);
  expect(resolveManagedSkillInstructions(workspace, 'zero', options)!.personalInstructions).toHaveLength(1);
  deletePersonalInstruction(workspace, 'zero', 'workspace', options);
  expect(getPersonalInstructions(workspace, 'zero', options)).toHaveLength(1);
  expect(savePersonalInstruction(workspace, 'zero', { scope: 'shared', text: '  ' }, options)).toBeNull();
  expect(getPersonalInstructions(workspace, 'zero', options)).toEqual([]);
});

test('oversize and malformed saves fail without changing the last good text', () => {
  const record = savePersonalInstruction(workspace, 'zero', { scope: 'shared', text: 'Good text' }, options)!;
  expect(() => savePersonalInstruction(workspace, 'zero', { scope: 'shared', text: 'é'.repeat(MAX_PERSONAL_INSTRUCTION_BYTES) }, options)).toThrow('16 KB');
  expect(getPersonalInstructions(workspace, 'zero', options)[0]).toEqual(record);
  expect(() => getPersonalInstructions(workspace, '../outside', options)).toThrow('Invalid skill');
});

test('imported missing parent retains only user text and stays disabled', () => {
  const record = importPersonalInstruction(workspace, { parentManagedId: 'artist-os:skill:removed-parent', text: 'Keep this preference for later.' }, 'shared', options)!;
  expect(record.enabled).toBe(false);
  expect(getPersonalInstructions(workspace, 'removed-parent', options)[0]!.text).toBe(record.text);
  expect(resolveManagedSkillInstructions(workspace, 'removed-parent', options)).toBeNull();
});
