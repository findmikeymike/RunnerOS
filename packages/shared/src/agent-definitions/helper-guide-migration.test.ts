import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { matter } from '../config/frontmatter.ts';
import { STARTER_SKILLS } from '../skills/starter-templates.ts';
import baselines from './__fixtures__/helper-guide-v1/baselines.json';
import { migrateHelperGuide, PREVIOUS_HELPER_GUIDE_HASHES, PREVIOUS_HELPER_PROMPT_HASHES } from './helper-guide-migration.ts';
import { STARTER_AGENTS } from './starter-templates.ts';
import { deleteGlobalAgent, getGlobalAgentFile, loadGlobalAgent, readActivatedAgents, setAgentActive, writeGlobalAgent } from './storage.ts';

let root: string;
let options: { globalAgentsDir: string; globalSkillsDir: string };
const helper = () => STARTER_AGENTS.find(agent => agent.slug === 'setup-concierge')!;
const guide = () => STARTER_SKILLS.find(skill => skill.slug === 'artist-os-guide')!.files.find(file => file.path === 'SKILL.md')!.content;
const fixture = (name: string) => readFileSync(new URL(`./__fixtures__/helper-guide-v1/${name}`, import.meta.url), 'utf8');
const digest = (content: string) => createHash('sha256').update(content).digest('hex');
const installGuide = (content: string) => {
  const file = join(options.globalSkillsDir, 'artist-os-guide', 'SKILL.md');
  mkdirSync(join(options.globalSkillsDir, 'artist-os-guide'), { recursive: true });
  writeFileSync(file, content);
  return file;
};
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'helper-guide-migration-'));
  options = { globalAgentsDir: join(root, 'agents'), globalSkillsDir: join(root, 'skills') };
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('Helper prompt migration', () => {
  for (const version of baselines.agents) {
    test(`upgrades exact shipped ${version.file} once, retaining metadata bytes and activation`, () => {
      writeGlobalAgent({ ...helper(), systemPrompt: fixture(version.file), metadata: {
        ...helper().metadata, name: 'My helper', model: 'my-model', permissionMode: 'safe',
        skills: ['my-skill'], description: 'My description',
      } }, options);
      const file = getGlobalAgentFile('setup-concierge', options);
      const before = readFileSync(file, 'utf8');
      const body = matter(before).content;
      expect(digest(body)).toBe(version.bodySha256);
      expect(PREVIOUS_HELPER_PROMPT_HASHES).toContain(version.bodySha256);
      const header = before.slice(0, before.length - body.length).replace('---\n', '---\n# Keep my formatting\ncustomSetting: keep\n');
      writeFileSync(file, header + body);
      const workspace = join(root, 'workspace');
      setAgentActive(workspace, 'another-agent', true);
      const activation = readActivatedAgents(workspace);
      const expectedBody = helper().systemPrompt.trimEnd() + '\n';
      expect(migrateHelperGuide(options).updatedAgents).toEqual(body === expectedBody ? [] : ['setup-concierge']);
      expect(readFileSync(file, 'utf8')).toBe(header + expectedBody);
      expect(loadGlobalAgent('setup-concierge', options)!.metadata.skills).toEqual(['my-skill']);
      expect(readActivatedAgents(workspace)).toEqual(activation);
      expect(migrateHelperGuide(options).updatedAgents).toEqual([]);
    });
  }

  test('preserves custom prompt bytes, including whitespace-only edits', () => {
    for (const suffix of ['\nCustom guidance.', '\n', '\r\n']) {
      writeGlobalAgent({ ...helper(), systemPrompt: fixture(baselines.agents[0]!.file) }, options);
      const file = getGlobalAgentFile('setup-concierge', options);
      const content = readFileSync(file, 'utf8') + suffix;
      writeFileSync(file, content);
      expect(migrateHelperGuide(options).updatedAgents).toEqual([]);
      expect(readFileSync(file, 'utf8')).toBe(content);
    }
  });

  test('does not override current prompts or custom metadata choices', () => {
    writeGlobalAgent({ ...helper(), metadata: { ...helper().metadata, name: 'Current custom helper', skills: ['my-skill'] } }, options);
    const file = getGlobalAgentFile('setup-concierge', options);
    const before = readFileSync(file, 'utf8');
    expect(migrateHelperGuide(options).updatedAgents).toEqual([]);
    expect(readFileSync(file, 'utf8')).toBe(before);
  });

  test('does not recreate deleted helpers or touch unrelated definitions', () => {
    writeGlobalAgent({ ...helper(), systemPrompt: fixture(baselines.agents[0]!.file) }, options);
    deleteGlobalAgent('setup-concierge', [], options);
    writeGlobalAgent({ ...helper(), slug: 'custom-helper' }, options);
    const file = getGlobalAgentFile('custom-helper', options);
    const before = readFileSync(file, 'utf8');
    expect(migrateHelperGuide(options)).toEqual({ updatedAgents: [], updatedSkills: [] });
    expect(loadGlobalAgent('setup-concierge', options)).toBeNull();
    expect(readFileSync(file, 'utf8')).toBe(before);
    expect(existsSync(options.globalSkillsDir)).toBe(false);
  });
});

describe('Inline guide skill migration', () => {
  for (const version of baselines.skills) {
    test(`upgrades exact shipped ${version.file}, preserving custom references`, () => {
      const previous = fixture(version.file);
      expect(digest(previous)).toBe(version.sha256);
      expect(PREVIOUS_HELPER_GUIDE_HASHES).toContain(version.sha256);
      const file = installGuide(previous);
      const reference = join(options.globalSkillsDir, 'artist-os-guide', 'references', 'features.md');
      mkdirSync(join(reference, '..'), { recursive: true });
      writeFileSync(reference, 'My private feature notes.');
      expect(migrateHelperGuide(options).updatedSkills).toEqual(previous === guide() ? [] : ['artist-os-guide']);
      expect(readFileSync(file, 'utf8')).toBe(guide());
      expect(readFileSync(reference, 'utf8')).toBe('My private feature notes.');
      expect(migrateHelperGuide(options).updatedSkills).toEqual([]);
    });
  }
  test('does not replace custom skills or recreate missing files', () => {
    for (const content of [fixture(baselines.skills[0]!.file) + '\n', '# My own guide\n']) {
      const file = installGuide(content);
      expect(migrateHelperGuide(options).updatedSkills).toEqual([]);
      expect(readFileSync(file, 'utf8')).toBe(content);
    }
    rmSync(join(options.globalSkillsDir, 'artist-os-guide'), { recursive: true });
    expect(migrateHelperGuide(options).updatedSkills).toEqual([]);
    expect(existsSync(join(options.globalSkillsDir, 'artist-os-guide'))).toBe(false);
  });
});
