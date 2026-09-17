import { afterEach, beforeEach, expect, test } from 'bun:test';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getManagedSkillManifest, skillDigest } from '../managed';
import { getLegacySkillMigration, migrateManagedSkillScope } from '../migration';
import baselines from '../__fixtures__/artist-direction-skills-v1/baselines.json';

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'direction-skills-migration-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });
const fixtureRoot = new URL('../__fixtures__/artist-direction-skills-v1/', import.meta.url).pathname;

for (const [slug, files] of Object.entries(baselines)) {
  test(`${slug}: historical stock body and reference upgrade without a duplicate personal skill`, () => {
    const scope = join(root, 'skills');
    const globalSkillsDir = join(root, 'global');
    mkdirSync(scope);
    cpSync(join(fixtureRoot, slug), join(scope, slug), { recursive: true });
    for (const [path, digest] of Object.entries(files)) expect(skillDigest(readFileSync(join(scope, slug, path), 'utf8'))).toBe(digest);
    expect(migrateManagedSkillScope(scope, { globalSkillsDir })).toEqual({ aliases: {}, retired: [slug] });
    expect(getLegacySkillMigration(scope, slug)?.copySlug).toBeNull();
    expect(existsSync(join(scope, slug))).toBe(false);
    const backup = join(globalSkillsDir, '.managed', '.legacy', skillDigest(scope), slug);
    for (const path of Object.keys(files)) expect(readFileSync(join(backup, readdirSync(backup)[0]!, path), 'utf8')).toBe(readFileSync(join(fixtureRoot, slug, path), 'utf8'));
    expect(migrateManagedSkillScope(scope, { globalSkillsDir }).retired).toEqual([]);
  });

  test(`${slug}: an edited reference survives as custom even when its core is stock`, () => {
    const scope = join(root, 'skills');
    mkdirSync(scope);
    cpSync(join(fixtureRoot, slug), join(scope, slug), { recursive: true });
    const reference = Object.keys(files).find(path => path.startsWith('references/'))!;
    const custom = readFileSync(join(scope, slug, reference), 'utf8') + '\nMy specific artist preferences.\n';
    writeFileSync(join(scope, slug, reference), custom);
    const result = migrateManagedSkillScope(scope, { globalSkillsDir: join(root, 'global') });
    const alias = result.aliases[slug];
    expect(alias).toMatch(new RegExp(`^${slug}-personal-`));
    expect(readFileSync(join(scope, alias!, reference), 'utf8')).toBe(custom);
  });
}

test('managed direction skills retain usable references after bundle regeneration', () => {
  for (const slug of Object.keys(baselines)) {
    const entry = getManagedSkillManifest().get(slug)!;
    expect(entry.content.length).toBeGreaterThan(100);
    expect(entry.files.some(file => file.path.startsWith('references/'))).toBe(true);
    expect(entry.content).not.toContain('5. Add cult mechanics.');
    expect(entry.content).not.toContain('2. Define the enemy.');
    expect(entry.content).not.toContain('Include at least two:');
  }
});
