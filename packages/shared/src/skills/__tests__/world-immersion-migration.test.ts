import { afterEach, beforeEach, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getManagedSkill, skillDigest } from '../managed';
import { getLegacySkillMigration, migrateManagedSkillScope } from '../migration';

const prior = readFileSync(new URL('../__fixtures__/world-immersion-v1/SKILL.md', import.meta.url), 'utf8');
let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'world-skill-migration-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });
function install(body: string) {
  const scope = join(root, 'skills');
  mkdirSync(join(scope, 'world-immersion'), { recursive: true });
  writeFileSync(join(scope, 'world-immersion', 'SKILL.md'), body);
  return scope;
}

test('proven old world skill adopts current managed revision and preserves original backup', () => {
  expect(skillDigest(prior)).toBe('91ce0fc1b9698309457ad5c6efa6900c4a1571eff2de88338c81106cd3c51aa2');
  const scope = install(prior);
  const options = { globalSkillsDir: join(root, 'global') };
  expect(migrateManagedSkillScope(scope, options)).toEqual({ aliases: {}, retired: ['world-immersion'] });
  expect(getLegacySkillMigration(scope, 'world-immersion')?.copySlug).toBeNull();
  expect(existsSync(join(scope, 'world-immersion'))).toBe(false);
  const backup = join(options.globalSkillsDir, '.managed', '.legacy', skillDigest(scope), 'world-immersion');
  expect(readFileSync(join(backup, readdirSync(backup)[0]!, 'SKILL.md'), 'utf8')).toBe(prior);
  expect(getManagedSkill('world-immersion', options)?.content).toContain('A separate immersive experience is optional');
  expect(migrateManagedSkillScope(scope, options).retired).toEqual([]);
});

test('personal world instructions and companion files remain editable custom skills', () => {
  for (const variant of ['body', 'companion']) {
    const parent = join(root, variant);
    const scope = join(parent, 'skills');
    mkdirSync(join(scope, 'world-immersion'), { recursive: true });
    const body = variant === 'body' ? prior + '\nMy personal working method.\n' : prior;
    writeFileSync(join(scope, 'world-immersion', 'SKILL.md'), body);
    if (variant === 'companion') writeFileSync(join(scope, 'world-immersion', 'notes.md'), 'Keep my notes');
    const result = migrateManagedSkillScope(scope, { globalSkillsDir: join(parent, 'global') });
    const alias = result.aliases['world-immersion'];
    expect(alias).toMatch(/^world-immersion-personal-/);
    expect(readFileSync(join(scope, alias!, 'SKILL.md'), 'utf8')).toBe(body);
    if (variant === 'companion') expect(readFileSync(join(scope, alias!, 'notes.md'), 'utf8')).toBe('Keep my notes');
  }
});
