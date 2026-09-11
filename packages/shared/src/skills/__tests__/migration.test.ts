import * as fs from 'node:fs';
import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { getManagedSkillManifest } from '../managed';
import { skillDigest } from '../managed';
import { replaceRequiredGlobalSkillFileIfHashMatches } from '../storage';
import { getLegacySkillMigration, migrateManagedSkillScope, resolveLegacySkillAlias, rewriteLegacySkillAssignments } from '../migration';

let root: string, globalSkillsDir: string, scope: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'skill-migration-')); globalSkillsDir = join(root, 'global'); scope = join(root, 'workspace', 'skills'); mkdirSync(scope, { recursive: true }); });
afterEach(() => rmSync(root, { recursive: true, force: true }));
function write(slug: string, path: string, content: string | Buffer) { const target = join(scope, slug, path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, content); }

test('exact shipped copy retires without duplicate; rerun does not resurrect deleted copies', () => {
  for (const file of getManagedSkillManifest().get('zero')!.files) write('zero', file.path, file.content);
  expect(migrateManagedSkillScope(scope, { globalSkillsDir })).toEqual({ aliases: {}, retired: ['zero'] });
  expect(existsSync(join(scope, 'zero'))).toBe(false);
  expect(getLegacySkillMigration(scope, 'zero')?.copySlug).toBeNull();
  expect(migrateManagedSkillScope(scope, { globalSkillsDir }).retired).toEqual([]);
});

test('exact historical hashes can upgrade before migration but never mutate prepared or retired ownership', () => {
  write('zero', 'SKILL.md', 'known old stock');
  expect(replaceRequiredGlobalSkillFileIfHashMatches('zero', 'SKILL.md', skillDigest('known old stock'), 'new stock', scope).updated).toBe(true);
  migrateManagedSkillScope(scope, { globalSkillsDir, retireOriginals: false });
  expect(replaceRequiredGlobalSkillFileIfHashMatches('zero', 'SKILL.md', skillDigest('new stock'), 'later stock', scope).updated).toBe(false);
  expect(readFileSync(join(scope, 'zero', 'SKILL.md'), 'utf8')).toBe('new stock');
  migrateManagedSkillScope(scope, { globalSkillsDir });
  expect(replaceRequiredGlobalSkillFileIfHashMatches('zero', 'SKILL.md', skillDigest('new stock'), 'later stock', scope).updated).toBe(false);
  expect(existsSync(join(scope, 'zero'))).toBe(false);
});

test('proven historical core is stock only when the remaining file inventory is untouched', () => {
  const priorCore = readFileSync(new URL('../../agent-definitions/__fixtures__/helper-guide-v1/artist-os-guide.md', import.meta.url), 'utf8');
  for (const file of getManagedSkillManifest().get('artist-os-guide')!.files) write('artist-os-guide', file.path, file.path === 'SKILL.md' ? priorCore : file.content);
  expect(migrateManagedSkillScope(scope, { globalSkillsDir }).aliases).toEqual({});
  const secondScope = join(root, 'second-scope');
  for (const file of getManagedSkillManifest().get('artist-os-guide')!.files) {
    const target = join(secondScope, 'artist-os-guide', file.path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, file.path === 'SKILL.md' ? priorCore : file.content);
  }
  mkdirSync(join(secondScope, 'artist-os-guide', 'my-empty-folder'));
  expect(migrateManagedSkillScope(secondScope, { globalSkillsDir }).aliases['artist-os-guide']).toMatch(/^artist-os-guide-personal-/);
});

test('custom body, references, binary assets and whitespace survive under stable editable identity', () => {
  write('zero', 'SKILL.md', '---\nname: My Zero\n---\n\n custom  \n');
  const binary = Buffer.from([0, 255, 12, 99]);
  write('zero', 'assets/audio.bin', binary);
  write('zero', 'references/private.md', 'my reference\n');
  const migrated = migrateManagedSkillScope(scope, { globalSkillsDir });
  const alias = migrated.aliases.zero!;
  expect(alias).toMatch(/^zero-personal-[a-f0-9]{12}$/);
  expect(readFileSync(join(scope, alias, 'assets/audio.bin'))).toEqual(binary);
  expect(readFileSync(join(scope, alias, 'SKILL.md'), 'utf8')).toBe('---\nname: My Zero\n---\n\n custom  \n');
  expect(resolveLegacySkillAlias(scope, 'zero')).toBe(alias);
  rmSync(join(scope, alias), { recursive: true });
  migrateManagedSkillScope(scope, { globalSkillsDir });
  expect(existsSync(join(scope, alias))).toBe(false);
});

test('different scopes retain independent overrides and stock override is recorded', () => {
  write('zero', 'SKILL.md', 'workspace override');
  const first = migrateManagedSkillScope(scope, { globalSkillsDir }).aliases.zero;
  const other = join(root, 'project', '.agents', 'skills');
  mkdirSync(join(other, 'zero'), { recursive: true });
  writeFileSync(join(other, 'zero', 'SKILL.md'), 'project override');
  const second = migrateManagedSkillScope(other, { globalSkillsDir }).aliases.zero;
  expect(first).not.toBe(second);
  expect(resolveLegacySkillAlias(scope, 'zero')).toBe(first!);
  expect(resolveLegacySkillAlias(other, 'zero')).toBe(second!);
});

test('symlink escape leaves original untouched and does not create an alias', () => {
  write('zero', 'SKILL.md', 'custom');
  symlinkSync(root, join(scope, 'zero', 'escape'));
  expect(() => migrateManagedSkillScope(scope, { globalSkillsDir })).toThrow('symbolic links');
  expect(readFileSync(join(scope, 'zero', 'SKILL.md'), 'utf8')).toBe('custom');
  expect(resolveLegacySkillAlias(scope, 'zero')).toBeNull();
});

test('corrupt journal cannot redirect aliases outside scope or retire originals', () => {
  write('zero', 'SKILL.md', 'custom');
  writeFileSync(join(scope, '.managed-skill-migration.json'), JSON.stringify({ version: 1, entries: { zero: { digest: 'a'.repeat(64), copySlug: '../outside', retired: false } } }));
  expect(() => migrateManagedSkillScope(scope, { globalSkillsDir })).toThrow('recovery');
  expect(existsSync(join(scope, 'zero'))).toBe(true);
});

test('removed bundled parent retains its historical alias without breaking other skills', () => {
  writeFileSync(join(scope, '.managed-skill-migration.json'), JSON.stringify({ version: 1, entries: { 'removed-parent': { digest: 'a'.repeat(64), copySlug: 'removed-parent-personal-abcdef', retired: true } } }));
  expect(resolveLegacySkillAlias(scope, 'removed-parent')).toBe('removed-parent-personal-abcdef');
  expect(() => migrateManagedSkillScope(scope, { globalSkillsDir })).not.toThrow();
  expect(resolveLegacySkillAlias(scope, 'zero')).toBeNull();
});

test('interrupted retirement resumes and an intervening edit is never overwritten', () => {
  write('zero', 'SKILL.md', 'custom');
  const alias = migrateManagedSkillScope(scope, { globalSkillsDir }).aliases.zero!;
  write('zero', 'SKILL.md', 'custom');
  expect(migrateManagedSkillScope(scope, { globalSkillsDir }).aliases.zero).toBe(alias);
  write('zero', 'SKILL.md', 'newer edit');
  expect(() => migrateManagedSkillScope(scope, { globalSkillsDir })).toThrow('changed during migration');
  expect(readFileSync(join(scope, 'zero', 'SKILL.md'), 'utf8')).toBe('newer edit');
});

test('assignment rewriting is idempotent and leaves prompt text and unrelated slugs untouched', () => {
  const original = { skills: ['zero', 'other'], prompt: '[skill:zero]', taskModes: [{ primarySkillSlugs: ['zero'], adjacentSkills: [{ slug: 'zero', reason: 'zero' }] }], agentSkillSlugs: ['zero'] };
  const changed = rewriteLegacySkillAssignments(original, new Set(['zero']));
  expect(changed.skills).toEqual(['legacy:zero', 'other']);
  expect(changed.taskModes[0]!.adjacentSkills[0]!.slug).toBe('legacy:zero');
  expect(changed.prompt).toBe(original.prompt);
  expect(original.skills[0]).toBe('zero');
  expect(rewriteLegacySkillAssignments(changed, new Set(['zero']))).toEqual(changed);
});

test('real loaders keep activation and project/workspace/global legacy precedence', () => {
  const script = `
    import {mkdirSync,writeFileSync,rmSync} from 'node:fs';
    import {join} from 'node:path';
    import {GLOBAL_AGENT_SKILLS_DIR,loadSkillBySlug,loadAllSkills,setGlobalSkillEnabled} from ${JSON.stringify(import.meta.resolve('../storage.ts'))};
    import {migrateManagedSkillScope} from ${JSON.stringify(import.meta.resolve('../migration.ts'))};
    import {getManagedSkillManifest} from ${JSON.stringify(import.meta.resolve('../managed.ts'))};
    const workspace=${JSON.stringify(join(root, 'loader-workspace'))}, project=${JSON.stringify(join(root, 'loader-project'))};
    const put=(dir,text)=>{mkdirSync(join(dir,'zero'),{recursive:true});writeFileSync(join(dir,'zero','SKILL.md'),'---\\nname: Custom\\ndescription: Custom\\n---\\n'+text)};
    put(GLOBAL_AGENT_SKILLS_DIR,'global custom');
    migrateManagedSkillScope(GLOBAL_AGENT_SKILLS_DIR);
    const dormant=loadSkillBySlug(workspace,'zero')===null;
    setGlobalSkillEnabled(workspace,'zero',true);
    const core=Boolean(loadSkillBySlug(workspace,'zero')?.managed);
    const global=loadSkillBySlug(workspace,'legacy:zero')?.content.trim();
    const customSlug=loadSkillBySlug(workspace,'legacy:zero').slug;
    setGlobalSkillEnabled(workspace,'zero',false);
    setGlobalSkillEnabled(workspace,customSlug,true);
    const customOnly=loadSkillBySlug(workspace,'legacy:zero')?.content.trim()==='global custom' && loadSkillBySlug(workspace,'zero')===null;
    setGlobalSkillEnabled(workspace,'zero',true);
    put(join(workspace,'skills'),'workspace custom');
    const alias=migrateManagedSkillScope(join(workspace,'skills')).aliases.zero;
    const local=loadSkillBySlug(workspace,'legacy:zero')?.content.trim();
    const projectSkills=join(project,'.agents','skills');
    for(const file of getManagedSkillManifest().get('zero').files){const path=join(projectSkills,'zero',file.path);mkdirSync((await import('node:path')).dirname(path),{recursive:true});writeFileSync(path,file.content)}
    migrateManagedSkillScope(projectSkills);
    const projectStock=Boolean(loadSkillBySlug(workspace,'legacy:zero',project)?.managed);
    const listed=loadAllSkills(workspace).some(skill=>skill.slug===alias);
    rmSync(join(workspace,'skills',alias),{recursive:true});
    const deleted=loadSkillBySlug(workspace,'legacy:zero')===null;
    console.log(JSON.stringify({dormant,core,global,local,projectStock,listed,deleted,customOnly}));
  `;
  const result = Bun.spawnSync([process.execPath, '-e', script], { env: { ...process.env, CRAFT_PRODUCT_VARIANT: 'artist-os', CRAFT_CONFIG_DIR: join(root, 'isolated-profile') } });
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout.toString().trim())).toEqual({ dormant: true, core: true, global: 'global custom', local: 'workspace custom', projectStock: true, listed: true, deleted: true, customOnly: true });
});

test('Runner keeps loose skill precedence, seeding, deletion and never materializes managed bundles', () => {
  const script = `
    import {mock} from 'bun:test';
    import * as os from 'node:os';
    import {mkdirSync,writeFileSync,existsSync,readFileSync} from 'node:fs';
    import {join} from 'node:path';
    const isolatedHome=${JSON.stringify(join(root, 'runner-home'))};
    mock.module('os',()=>({...os,homedir:()=>isolatedHome}));
    mock.module('node:os',()=>({...os,homedir:()=>isolatedHome}));
    const storage=await import(${JSON.stringify(import.meta.resolve('../storage.ts'))});
    const managed=await import(${JSON.stringify(import.meta.resolve('../managed.ts'))});
    const workspace=${JSON.stringify(join(root, 'runner-workspace'))};
    const put=(dir,text)=>{mkdirSync(join(dir,'zero'),{recursive:true});writeFileSync(join(dir,'zero','SKILL.md'),'---\\nname: Custom\\ndescription: Custom\\n---\\n'+text)};
    put(storage.GLOBAL_AGENT_SKILLS_DIR,'global user content');
    storage.setGlobalSkillEnabled(workspace,'zero',true);
    const global=storage.loadGlobalSkillBySlug('zero').content.trim();
    const catalog=storage.loadGlobalSkills().map(s=>s.slug);
    put(join(workspace,'skills'),'workspace user content');
    const local=storage.loadSkillBySlug(workspace,'zero').content.trim();
    storage.ensureRequiredGlobalSkills([{slug:'zero',files:[{path:'SKILL.md',content:'must not replace custom'}]}]);
    const unchanged=storage.loadGlobalSkillBySlug('zero').content.trim()===global;
    const deleted=storage.deleteSkill(workspace,'zero');
    const direct=managed.getManagedSkill('zero');
    console.log(JSON.stringify({global,catalog,local,unchanged,deleted,direct,managedExists:existsSync(join(storage.GLOBAL_AGENT_SKILLS_DIR,'.managed')),isolated:storage.GLOBAL_AGENT_SKILLS_DIR.startsWith(isolatedHome)}));
  `;
  const result = Bun.spawnSync([process.execPath, '-e', script], { env: { ...process.env, CRAFT_PRODUCT_VARIANT: 'runner', CRAFT_CONFIG_DIR: join(root, 'runner-config') } });
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout.toString().trim())).toEqual({ global: 'global user content', catalog: ['zero'], local: 'workspace user content', unchanged: true, deleted: true, direct: null, managedExists: false, isolated: true });
});


test('partially removed owned retirement staging resumes without touching replacement originals', () => {
  write('zero', 'SKILL.md', 'custom');
  write('zero', 'references/notes.txt', 'important');
  const realRemove = fs.rmSync;
  const remover = spyOn(fs, 'rmSync').mockImplementation((path, options) => {
    if (String(path).includes('.zero.retiring-')) {
      realRemove(join(String(path), 'references'), { recursive: true });
      throw new Error('interrupted staged removal');
    }
    realRemove(path, options);
  });
  try { expect(() => migrateManagedSkillScope(scope, { globalSkillsDir })).toThrow('interrupted staged removal'); }
  finally { remover.mockRestore(); }
  const journal = JSON.parse(readFileSync(join(scope, '.managed-skill-migration.json'), 'utf8'));
  const staged = join(scope, journal.entries.zero.retirement.name);
  expect(existsSync(join(staged, 'SKILL.md'))).toBe(true);
  expect(existsSync(join(staged, 'references'))).toBe(false);
  write('zero', 'SKILL.md', 'new user replacement');
  expect(() => migrateManagedSkillScope(scope, { globalSkillsDir })).toThrow('nothing was removed');
  expect(readFileSync(join(scope, 'zero', 'SKILL.md'), 'utf8')).toBe('new user replacement');
  realRemove(join(scope, 'zero'), { recursive: true });
  const resumed = migrateManagedSkillScope(scope, { globalSkillsDir });
  expect(resumed.retired).toEqual(['zero']);
  expect(readFileSync(join(scope, resumed.aliases.zero!, 'references/notes.txt'), 'utf8')).toBe('important');
  expect(existsSync(staged)).toBe(false);
  expect(migrateManagedSkillScope(scope, { globalSkillsDir }).retired).toEqual([]);
});

test('startup containment keeps custom precedence and prepared aliases without hiding unrelated skills', () => {
  const script = `
    import {mkdirSync,writeFileSync} from 'node:fs';
    import {join,dirname} from 'node:path';
    import {GLOBAL_AGENT_SKILLS_DIR,loadGlobalSkillBySlug,loadSkillBySlug,loadAllSkills,setGlobalSkillEnabled} from ${JSON.stringify(import.meta.resolve('../storage.ts'))};
    import {migrateManagedSkillScope} from ${JSON.stringify(import.meta.resolve('../migration.ts'))};
    import {runManagedSkillStartupMigration} from ${JSON.stringify(import.meta.resolve('../startup-migration.ts'))};
    const workspace=${JSON.stringify(join(root, 'containment-workspace'))},project=${JSON.stringify(join(root, 'containment-project'))},agentsDir=${JSON.stringify(join(root, 'containment-agents'))};
    const put=(dir,slug,text)=>{mkdirSync(join(dir,slug),{recursive:true});writeFileSync(join(dir,slug,'SKILL.md'),'---\\nname: Custom\\ndescription: Custom\\n---\\n'+text)};
    put(GLOBAL_AGENT_SKILLS_DIR,'zero','prepared global custom');
    const alias=migrateManagedSkillScope(GLOBAL_AGENT_SKILLS_DIR).aliases.zero;
    setGlobalSkillEnabled(workspace,'zero',true);
    put(join(workspace,'skills'),'zero','workspace custom');
    put(join(project,'.agents','skills'),'zero','project custom');
    put(join(workspace,'skills'),'my-helper','unrelated user skill');
    mkdirSync(join(agentsDir,'broken'),{recursive:true});writeFileSync(join(agentsDir,'broken','AGENT.md'),'broken frontmatter');
    const result=runManagedSkillStartupMigration({workspaceRoots:[workspace],globalSkillsDir:GLOBAL_AGENT_SKILLS_DIR,agentsDir,runtimeVariant:'artist-os'});
    const projectValue=loadSkillBySlug(workspace,'zero',project)?.content.trim();
    const workspaceValue=loadSkillBySlug(workspace,'zero')?.content.trim();
    const otherWorkspace=${JSON.stringify(join(root, 'other-workspace'))};setGlobalSkillEnabled(otherWorkspace,'zero',true);
    const globalValue=loadSkillBySlug(otherWorkspace,'legacy:zero')?.content.trim();
    const bareRemainsManaged=Boolean(loadSkillBySlug(otherWorkspace,'zero')?.managed);
    writeFileSync(join(workspace,'skills','.managed-skill-migration.json'),'{broken');
    const customWithBrokenJournal=loadSkillBySlug(workspace,'zero')?.content.trim();
    const unrelated=loadSkillBySlug(workspace,'my-helper')?.content.trim();
    const noGuess=loadSkillBySlug(workspace,'agent-creator')===null;
    const catalog=loadAllSkills(workspace).some(skill=>skill.content.trim()==='workspace custom');
    const catalogNoGuess=!loadAllSkills(workspace).some(skill=>skill.slug==='agent-creator');
    const completedWorkspace=${JSON.stringify(join(root, 'completed-workspace'))};
    put(join(completedWorkspace,'skills'),'zero','completed workspace custom');
    migrateManagedSkillScope(join(completedWorkspace,'skills'));
    put(GLOBAL_AGENT_SKILLS_DIR,'zero','pending global custom');
    const completedScopeWins=Boolean(loadSkillBySlug(completedWorkspace,'zero')?.managed);
    (await import('node:fs')).rmSync(join(GLOBAL_AGENT_SKILLS_DIR,'zero'),{recursive:true});
    setGlobalSkillEnabled(otherWorkspace,'zero',false);setGlobalSkillEnabled(otherWorkspace,alias,true);
    const customOnly=loadSkillBySlug(otherWorkspace,'legacy:zero')?.content.trim()==='prepared global custom';
    writeFileSync(join(GLOBAL_AGENT_SKILLS_DIR,'.managed-skill-migration.json'),'{broken');
    const directGlobalNoGuess=loadGlobalSkillBySlug('legacy:zero')===null;
    console.log(JSON.stringify({ok:result.ok,projectValue,workspaceValue,globalValue,customWithBrokenJournal,unrelated,noGuess,catalog,customOnly,directGlobalNoGuess,bareRemainsManaged,catalogNoGuess,completedScopeWins}));
  `;
  const result = Bun.spawnSync([process.execPath, '-e', script], { env: { ...process.env, CRAFT_PRODUCT_VARIANT: 'artist-os', CRAFT_CONFIG_DIR: join(root, 'containment-profile') } });
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout.toString().trim())).toEqual({ ok: false, projectValue: 'project custom', workspaceValue: 'workspace custom', globalValue: 'prepared global custom', customWithBrokenJournal: 'workspace custom', unrelated: 'unrelated user skill', noGuess: true, catalog: true, customOnly: true, directGlobalNoGuess: true, bareRemainsManaged: true, catalogNoGuess: true, completedScopeWins: true });
});

test('edits during retirement intent publication leave the original in place', () => {
  write('zero', 'SKILL.md', 'custom');
  const realRename = fs.renameSync;
  const rename = spyOn(fs, 'renameSync').mockImplementation((from, to) => {
    realRename(from, to);
    if (String(to) === join(scope, '.managed-skill-migration.json')) {
      const journal = JSON.parse(readFileSync(to, 'utf8'));
      if (journal.entries.zero?.retirement) write('zero', 'SKILL.md', 'new user edit');
    }
  });
  try { expect(() => migrateManagedSkillScope(scope, { globalSkillsDir })).toThrow('changed before retirement'); }
  finally { rename.mockRestore(); }
  expect(readFileSync(join(scope, 'zero', 'SKILL.md'), 'utf8')).toBe('new user edit');
});
