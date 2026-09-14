import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { STARTER_AGENTS } from './starter-templates.ts';
import { STARTER_SKILLS } from '../skills/starter-templates.ts';
import { SYSTEM_GLOBAL_SKILL_SLUGS } from '../skills/system.ts';
import { resolveAgentTaskMode } from './task-modes.ts';
import { loadGlobalAgent, migrateBuiltInAgentTaskModes, writeGlobalAgent } from './storage.ts';
import oldModes from './__fixtures__/helper-guide-v1/setup-task-modes-pre-domains.json';
import type { AgentTaskModeDefinition } from './types.ts';
const helper = STARTER_AGENTS.find(agent => agent.slug === 'setup-concierge')!;
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, {recursive:true,force:true}); });
test('HQ helper starts with on-demand General and focused domain skills in setup order', () => {
  expect(helper.metadata.taskModes!.map(mode => mode.label)).toEqual(['General','LLM Setup','Tools','Social & Spotify','Brain & Profile','People & Community','App Help']);
  const general = resolveAgentTaskMode(helper, 'general')!;
  expect(general.primarySkillSlugs).toEqual([]);
  expect(general.context?.preloadTopics).toEqual([]);
  expect(general.fullMode).toBe(false);
  expect(general.adjacentSkills?.map(skill => skill.slug)).toContain('setup-brain');
  for (const recipe of helper.metadata.taskModes!.slice(1)) {
    const resolved = resolveAgentTaskMode(helper, recipe.id)!;
    expect(resolved.primarySkillSlugs).toHaveLength(1);
    const slug = resolved.primarySkillSlugs[0]!;
    expect(SYSTEM_GLOBAL_SKILL_SLUGS).toContain(slug as never);
    expect(STARTER_SKILLS.find(skill => skill.slug === slug)?.files.some(file => file.path === 'SKILL.md')).toBe(true);
  }
  expect(helper.systemPrompt.length).toBeLessThan(3000);
});
test('upgrades stock old cards and skills together while preserving custom modes and inventories', () => {
  for (const custom of ['none','modes','skills'] as const) {
    const root = mkdtempSync(join(tmpdir(),'setup-domain-migration-')); roots.push(root);
    const options = { globalAgentsDir: join(root,'agents') };
    const modes = structuredClone(oldModes) as AgentTaskModeDefinition[];
    if (custom === 'modes') modes[0]!.description += ' My custom card.';
    const skills = ['artist-os-guide','source-recipe',...(custom==='skills'?['my-skill']:[])];
    writeGlobalAgent({...helper,systemPrompt:'My custom prompt.',metadata:{...helper.metadata,skills,taskModes:modes}},options);
    expect(migrateBuiltInAgentTaskModes(helper,options).updated).toBe(custom==='none');
    const saved = loadGlobalAgent(helper.slug,options)!;
    expect(saved.systemPrompt).toBe('My custom prompt.');
    expect(saved.metadata.skills).toEqual(custom==='none'?helper.metadata.skills:skills);
    expect(saved.metadata.taskModes).toEqual(custom==='none'?helper.metadata.taskModes:modes);
    expect(migrateBuiltInAgentTaskModes(helper,options).updated).toBe(false);
  }
});
