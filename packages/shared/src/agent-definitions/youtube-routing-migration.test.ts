import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { matter, stringifyFrontmatter } from '../config/frontmatter.ts';
import { BUNDLED_STARTER_SKILLS } from '../skills/bundled.generated.ts';
import { signalTrackPromptPrefix, youtubeProviderPromptPrefix } from './signal-track-prompts.ts';
import { STARTER_AGENTS } from './starter-templates.ts';
import { deleteGlobalAgent, ensureBuiltInAgentMetadataSlugs, ensureRequiredAgents, getGlobalAgentFile, loadGlobalAgent, readActivatedAgents, setAgentActive, writeGlobalAgent } from './storage.ts';
import { migrateYouTubeRouting, PREVIOUS_YOUTUBE_SKILL_HASHES } from './youtube-routing-migration.ts';

let root: string;
let options: { globalAgentsDir: string; globalSkillsDir: string };
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'youtube-routing-migration-'));
  options = { globalAgentsDir: join(root, 'agents'), globalSkillsDir: join(root, 'skills') };
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function oldSkill(slug: string): string {
  return readFileSync(new URL(`./__fixtures__/youtube-routing-v1/${slug}.md`, import.meta.url), 'utf-8');
}
function skillPath(slug: string): string { return join(options.globalSkillsDir, slug, 'SKILL.md'); }
function installSkill(slug: string, body: string): void {
  mkdirSync(join(options.globalSkillsDir, slug), { recursive: true });
  writeFileSync(skillPath(slug), body);
}

describe('known shipped YouTube skill migration', () => {
  for (const [slug, expectedHash] of Object.entries(PREVIOUS_YOUTUBE_SKILL_HASHES)) {
    test(`${slug}: upgrades exact old bytes to the entire current bundle, once`, () => {
      const previous = oldSkill(slug);
      expect(createHash('sha256').update(previous).digest('hex')).toBe(expectedHash);
      installSkill(slug, previous);
      const current = BUNDLED_STARTER_SKILLS.find(skill => skill.slug === slug)!.files.find(file => file.path === 'SKILL.md')!.content;
      expect(migrateYouTubeRouting(options).updatedSkills).toEqual([slug]);
      expect(readFileSync(skillPath(slug), 'utf-8')).toBe(current);
      expect(migrateYouTubeRouting(options).updatedSkills).toEqual([]);
      expect(readFileSync(skillPath(slug), 'utf-8')).toBe(current);
    });
    test(`${slug}: retains customized bytes, including whitespace-only changes`, () => {
      for (const body of [oldSkill(slug) + '\nMy custom provider rules.', oldSkill(slug) + '\n', oldSkill(slug).replace(/\n/g, '\r\n')]) {
        installSkill(slug, body);
        expect(migrateYouTubeRouting(options).updatedSkills).toEqual([]);
        expect(readFileSync(skillPath(slug), 'utf-8')).toBe(body);
      }
    });
  }
});

describe('post-normalization YouTube prompt migration', () => {
  for (const slug of ['youtube-research-agent', 'youtube-intelligence-agent']) {
    const agent = STARTER_AGENTS.find(item => item.slug === slug)!;
    const previous = agent.systemPrompt.replace(youtubeProviderPromptPrefix(slug), '');
    test(`${slug}: upgrades known prompt variants while preserving current metadata and activation`, () => {
      const workspace = join(root, 'workspace');
      setAgentActive(workspace, 'unrelated-agent', true);
      if (slug === 'youtube-intelligence-agent') setAgentActive(workspace, slug, true);
      const activation = readActivatedAgents(workspace);
      for (const old of new Set([previous, previous.slice(signalTrackPromptPrefix(slug).length)])) {
        writeGlobalAgent({ ...agent, metadata: { ...agent.metadata, name: 'My name', skills: ['my-skill'], optionalSources: ['my-source'] }, systemPrompt: old }, options);
        const file = getGlobalAgentFile(slug, options);
        const parsed = matter(readFileSync(file, 'utf-8'));
        writeFileSync(file, stringifyFrontmatter(parsed.content, { ...parsed.data, futureField: { keep: true } }));
        // Match startup: capability normalization writes before prompt migration.
        ensureBuiltInAgentMetadataSlugs(slug, agent.metadata, options);
        const metadata = loadGlobalAgent(slug, options)!.metadata;
        expect(migrateYouTubeRouting(options).updatedAgents).toEqual([slug]);
        expect(loadGlobalAgent(slug, options)!.systemPrompt).toBe(agent.systemPrompt);
        expect(loadGlobalAgent(slug, options)!.metadata).toEqual(metadata);
        expect(metadata.skills).toContain('monid');
        expect(metadata.optionalSources).toContain('monid');
        expect(metadata.skills).toContain('my-skill');
        expect(matter(readFileSync(file, 'utf-8')).data.futureField).toEqual({ keep: true });
        const upgradedBytes = readFileSync(file, 'utf-8');
        expect(migrateYouTubeRouting(options).updatedAgents).toEqual([]);
        expect(readFileSync(file, 'utf-8')).toBe(upgradedBytes);
        expect(readActivatedAgents(workspace)).toEqual(activation);
      }
    });
    test(`${slug}: custom and already-current bodies remain byte-identical`, () => {
      for (const prompt of [previous + '\nMy custom routing.', agent.systemPrompt, agent.systemPrompt + '\nKeep this note.']) {
        writeGlobalAgent({ ...agent, systemPrompt: prompt }, options);
        const file = getGlobalAgentFile(slug, options);
        const before = readFileSync(file, 'utf-8');
        ensureRequiredAgents([agent], options);
        expect(migrateYouTubeRouting(options).updatedAgents).toEqual([]);
        ensureBuiltInAgentMetadataSlugs(slug, agent.metadata, options);
        expect(readFileSync(file, 'utf-8')).toBe(before);
      }
    });
    test(`${slug}: both early and late upgrades preserve whitespace-only prompt edits`, () => {
      writeGlobalAgent({ ...agent, metadata: { ...agent.metadata, skills: [], optionalSources: [] }, systemPrompt: previous }, options);
      const file = getGlobalAgentFile(slug, options);
      const edited = readFileSync(file, 'utf-8') + '\n';
      writeFileSync(file, edited);
      ensureRequiredAgents([agent], options);
      expect(ensureBuiltInAgentMetadataSlugs(slug, agent.metadata, options).updated).toBe(true);
      expect(matter(readFileSync(file, 'utf-8')).content).toBe(matter(edited).content);
      expect(migrateYouTubeRouting(options).updatedAgents).toEqual([]);
      expect(matter(readFileSync(file, 'utf-8')).content).toBe(matter(edited).content);
    });
  }
  test('does not recreate missing or deleted agents/skills, or rewrite unrelated agents', () => {
    const agent = STARTER_AGENTS.find(item => item.slug === 'youtube-research-agent')!;
    writeGlobalAgent(agent, options);
    deleteGlobalAgent(agent.slug, [], options);
    writeGlobalAgent({ slug: 'custom-agent', metadata: agent.metadata, systemPrompt: agent.systemPrompt }, options);
    const file = getGlobalAgentFile('custom-agent', options);
    const before = readFileSync(file, 'utf-8');
    expect(migrateYouTubeRouting(options)).toEqual({ updatedAgents: [], updatedSkills: [] });
    expect(loadGlobalAgent(agent.slug, options)).toBeNull();
    expect(loadGlobalAgent('youtube-intelligence-agent', options)).toBeNull();
    expect(readFileSync(file, 'utf-8')).toBe(before);
  });
});
