import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { matter, stringifyFrontmatter } from '../config/frontmatter.ts';
import { BUNDLED_STARTER_SKILLS } from '../skills/bundled.generated.ts';
import previousAgents from './__fixtures__/monid-routing-v1/agents.json';
import skillVersions from './__fixtures__/monid-routing-v1/skills.json';
import { migrateMonidRouting, PREVIOUS_MONID_SKILL_HASHES } from './monid-routing-migration.ts';
import { STARTER_AGENTS } from './starter-templates.ts';
import { deleteGlobalAgent, getGlobalAgentFile, loadGlobalAgent, readActivatedAgents, setAgentActive, writeGlobalAgent, type CreateAgentInput } from './storage.ts';

let root: string;
let options: { globalAgentsDir: string; globalSkillsDir: string };
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'monid-routing-migration-'));
  options = { globalAgentsDir: join(root, 'agents'), globalSkillsDir: join(root, 'skills') };
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
const priorAgents = previousAgents as CreateAgentInput[];
function installSkill(slug: string, content: string): string {
  const file = join(options.globalSkillsDir, slug, 'SKILL.md');
  mkdirSync(join(options.globalSkillsDir, slug), { recursive: true });
  writeFileSync(file, content);
  return file;
}
function fixture(file: string): string {
  return readFileSync(new URL(`./__fixtures__/monid-routing-v1/${file}`, import.meta.url), 'utf-8');
}
function currentSkill(slug: string): string {
  return BUNDLED_STARTER_SKILLS.find(skill => skill.slug === slug)!.files.find(file => file.path === 'SKILL.md')!.content;
}

describe('Monid migration of recognized shipped agents', () => {
  for (const prior of priorAgents) {
    test(`${prior.slug}: upgrades stock definitions once without changing activation`, () => {
      const current = STARTER_AGENTS.find(agent => agent.slug === prior.slug)!;
      writeGlobalAgent(prior, options);
      const workspace = join(root, 'workspace');
      setAgentActive(workspace, 'another-agent', true);
      const activation = readActivatedAgents(workspace);
      const file = getGlobalAgentFile(prior.slug, options);
      const parsed = matter(readFileSync(file, 'utf-8'));
      writeFileSync(file, stringifyFrontmatter(parsed.content, { ...parsed.data, futureField: { preserve: true } }));
      migrateMonidRouting(options);
      const result = loadGlobalAgent(prior.slug, options)!;
      expect(result.systemPrompt).toBe(current.systemPrompt);
      for (const key of ['skills', 'sources', 'optionalSources', 'description', 'tags'] as const) {
        expect(result.metadata[key]).toEqual(current.metadata[key]);
      }
      expect(matter(readFileSync(file, 'utf-8')).data.futureField).toEqual({ preserve: true });
      const upgraded = readFileSync(file, 'utf-8');
      expect(migrateMonidRouting(options).updatedAgents).toEqual([]);
      expect(readFileSync(file, 'utf-8')).toBe(upgraded);
      expect(readActivatedAgents(workspace)).toEqual(activation);
    });
    test(`${prior.slug}: leaves prompt customizations byte-identical`, () => {
      for (const suffix of ['\nCustom policy.', '\n', '\r\n']) {
        writeGlobalAgent(prior, options);
        const file = getGlobalAgentFile(prior.slug, options);
        const bytes = readFileSync(file, 'utf-8') + suffix;
        writeFileSync(file, bytes);
        expect(migrateMonidRouting(options).updatedAgents).toEqual([]);
        expect(readFileSync(file, 'utf-8')).toBe(bytes);
      }
    });
    test(`${prior.slug}: preserves removed and customized routing selections`, () => {
      const current = STARTER_AGENTS.find(agent => agent.slug === prior.slug)!;
      for (const selection of [[], ['my-private-skill']]) {
        writeGlobalAgent({ ...prior, metadata: { ...prior.metadata, name: 'My worker', description: 'My description', skills: selection } }, options);
        const before = loadGlobalAgent(prior.slug, options)!.metadata;
        migrateMonidRouting(options);
        const after = loadGlobalAgent(prior.slug, options)!;
        expect(after.systemPrompt).toBe(current.systemPrompt);
        expect(after.metadata.name).toBe('My worker');
        expect(after.metadata.description).toBe('My description');
        for (const key of ['skills', 'sources', 'optionalSources'] as const) expect(after.metadata[key]).toEqual(before[key]);
      }
    });
  }
  test('does not recreate deleted agents or missing skills, nor rewrite unrelated agents', () => {
    const prior = priorAgents[0]!;
    writeGlobalAgent(prior, options);
    deleteGlobalAgent(prior.slug, [], options);
    writeGlobalAgent({ ...prior, slug: 'my-custom-agent' }, options);
    const file = getGlobalAgentFile('my-custom-agent', options);
    const bytes = readFileSync(file, 'utf-8');
    expect(migrateMonidRouting(options)).toEqual({ updatedAgents: [], updatedSkills: [] });
    expect(loadGlobalAgent(prior.slug, options)).toBeNull();
    expect(readFileSync(file, 'utf-8')).toBe(bytes);
  });
});

describe('Monid migration of exact shipped skill versions', () => {
  for (const [slug, versions] of Object.entries(skillVersions)) {
    for (const version of versions) {
      test(`${slug}: upgrades ${version.commit.slice(0, 9)} ${version.sha256.slice(0, 8)} once`, () => {
        const previous = fixture(version.file);
        expect(createHash('sha256').update(previous).digest('hex')).toBe(version.sha256);
        expect(PREVIOUS_MONID_SKILL_HASHES[slug]).toContain(version.sha256);
        const file = installSkill(slug, previous);
        const current = currentSkill(slug);
        expect(migrateMonidRouting(options).updatedSkills).toEqual(previous === current ? [] : [slug]);
        expect(readFileSync(file, 'utf-8')).toBe(current);
        expect(migrateMonidRouting(options).updatedSkills).toEqual([]);
      });
    }
    test(`${slug}: preserves custom skill bytes and whitespace`, () => {
      const previous = fixture(versions[0]!.file);
      for (const text of [previous + '\nCustom tool.', previous + '\n', previous.replace(/\n/g, '\r\n')]) {
        const file = installSkill(slug, text);
        expect(migrateMonidRouting(options).updatedSkills).toEqual([]);
        expect(readFileSync(file, 'utf-8')).toBe(text);
      }
    });
  }
});
