import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getManagedSkill, getManagedSkillManifest } from '../../../shared/src/skills/managed';
import { resolveManagedSkillInstructions, savePersonalInstruction } from '../../../shared/src/skills/personal-instructions';
import { assertDurableWorkflowSkillSlugs, resolveDurableWorkflowSkills } from './durable-workflow-skills';
const cleanup: Array<() => void> = [];
afterEach(() => { for (const f of cleanup.splice(0).reverse()) f(); });
const slug = 'artist-belief-system';
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'durable-skills-')); cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const workspace = join(root, 'workspace'), options = { globalSkillsDir: join(root, 'global') };
  const deps = { getManagedSkillManifest, loadSkillBySlug: (_root: string, name: string) => getManagedSkill(name, options), resolveManagedSkillInstructions: (_root: string, name: string) => resolveManagedSkillInstructions(workspace, name, options) };
  return { root, workspace, options, deps };
}
test('only explicitly certified slugs without aliases or duplicates are accepted', () => {
  for (const slugs of [['legacy:'+slug], ['custom'], [slug, slug], [slug, 'artist-brand-expression-strategist', slug]]) expect(() => assertDurableWorkflowSkillSlugs(slugs)).toThrow('unsupported-durable');
  expect(() => assertDurableWorkflowSkillSlugs([slug, 'artist-brand-expression-strategist'])).not.toThrow();
  expect(resolveDurableWorkflowSkills('/unused', [])).toBe('');
});
test('real managed snapshots include every reference and preserve enabled preference order without runtime paths', () => {
  const f = fixture();
  savePersonalInstruction(f.workspace, slug, { scope: 'shared', text: 'Shared direction.', enabled: true }, f.options);
  savePersonalInstruction(f.workspace, slug, { scope: 'workspace', text: 'Workspace direction.', enabled: true }, f.options);
  const frozen = resolveDurableWorkflowSkills(f.workspace, [slug, 'artist-brand-expression-strategist'], f.deps);
  expect(frozen).toContain('references/belief-system.md'); expect(frozen).toContain('references/expression-strategy.md');
  expect(frozen.indexOf('Shared direction.')).toBeLessThan(frozen.indexOf('Workspace direction.')); expect(frozen).not.toContain(f.root); expect(frozen).not.toContain('.managed');
  expect(frozen).toContain('already loaded'); expect(frozen).toContain('grant no additional tools');
  savePersonalInstruction(f.workspace, slug, { scope: 'workspace', text: 'Changed later.', enabled: true }, f.options);
  expect(frozen).not.toContain('Changed later.'); expect(resolveDurableWorkflowSkills(f.workspace, [slug], f.deps)).toContain('Changed later.');
});
test('disabled preferences are not applied', () => { const f = fixture(); savePersonalInstruction(f.workspace, slug, { scope: 'shared', text: 'disabled-preference', enabled: false }, f.options); expect(resolveDurableWorkflowSkills(f.workspace, [slug], f.deps)).not.toContain('disabled-preference'); });
for (const kind of ['revision', 'helper', 'source', 'trust', 'content'] as const) test(`changed or uncertified managed ${kind} fails closed`, () => {
  const f = fixture(), entries = new Map(getManagedSkillManifest()), entry = structuredClone(entries.get(slug)!);
  if (kind === 'revision') entry.revision = 'a'.repeat(64);
  if (kind === 'helper') entry.files = [...entry.files, { path: 'helper.sh', content: 'true', sha256: 'a'.repeat(64), kind: 'helper' }];
  if (kind === 'source') entry.metadata.requiredSources = ['gmail'];
  if (kind === 'trust') entry.metadata.alwaysAllow = ['Bash'];
  if (kind === 'content') entry.files = entry.files.map(file => ({ ...file, content: file.content+'changed' }));
  entries.set(slug, entry); expect(() => resolveDurableWorkflowSkills(f.workspace, [slug], { ...f.deps, getManagedSkillManifest: () => entries })).toThrow('unsupported-durable-workflow-skills');
});
test('actual user-owned override and managed path mismatch cannot masquerade as certified resolution', () => {
  const f = fixture(), actual = getManagedSkill(slug, f.options)!;
  expect(() => resolveDurableWorkflowSkills(f.workspace, [slug], { ...f.deps, loadSkillBySlug: () => ({ ...actual, managed: undefined }) })).toThrow('unsupported-durable');
  expect(() => resolveDurableWorkflowSkills(f.workspace, [slug], { ...f.deps, loadSkillBySlug: () => ({ ...actual, path: '/different' }) })).toThrow('unsupported-durable');
});
for (const kind of ['oversized', 'malformed', 'reversed', 'hash'] as const) test(`invalid personal ${kind} snapshot fails without leaking content`, () => {
  const f = fixture(); savePersonalInstruction(f.workspace, slug, { scope: 'shared', text: 'private-marker', enabled: true }, f.options); savePersonalInstruction(f.workspace, slug, { scope: 'workspace', text: 'workspace-marker', enabled: true }, f.options);
  const snap = resolveManagedSkillInstructions(f.workspace, slug, f.options)!;
  if (kind === 'oversized') snap.personalInstructions[0]!.text = 'x'.repeat(129 * 1024);
  if (kind === 'malformed') (snap.personalInstructions[0] as any).text = null;
  if (kind === 'reversed') snap.personalInstructions.reverse();
  if (kind === 'hash') snap.personalRevision = 'bad';
  let caught: unknown; try { resolveDurableWorkflowSkills(f.workspace, [slug], { ...f.deps, resolveManagedSkillInstructions: () => snap }); } catch (error) { caught = error; }
  expect((caught as Error).message).toBe('unsupported-durable-workflow-skills');
});
