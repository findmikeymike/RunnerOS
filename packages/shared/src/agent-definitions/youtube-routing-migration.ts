import { readFileSync } from 'node:fs';
import { matter } from '../config/frontmatter.ts';
import { BUNDLED_STARTER_SKILLS } from '../skills/bundled.generated.ts';
import { replaceRequiredGlobalSkillFileIfHashMatches } from '../skills/storage.ts';
import { isPreviousSignalTrackPrompt } from './signal-track-prompts.ts';
import { STARTER_AGENTS } from './starter-templates.ts';
import { getGlobalAgentFile, loadGlobalAgent, replaceBuiltInAgentPromptText, type AgentStorageOptions } from './storage.ts';

// Exact SKILL.md bytes shipped at 7ca3dd2d46b2cf97b97fd33f1dbb96ab1152b53e.
export const PREVIOUS_YOUTUBE_SKILL_HASHES = {
  monid: '7dead1570fe44e2481b327380e19a6c8024d2c396eb121db0f92bebf3412f6ca',
  'youtube-research': '241ee3e6560a2f21c2aa3960ee4eb3a7141123d2f4b9a3eb3456c16a8663788e',
  'youtube-intelligence': '72ce640adfd02ee409950e3993e34d755bd2c2ea7ac8ed958f407d37c07fb9c8',
} as const;

/** Run after the legacy YouTube paragraph normalizers; never seed or activate agents. */
export function migrateYouTubeRouting(options?: AgentStorageOptions & { globalSkillsDir?: string }): {
  updatedAgents: string[];
  updatedSkills: string[];
} {
  const updatedAgents: string[] = [];
  const updatedSkills: string[] = [];
  for (const slug of ['youtube-research-agent', 'youtube-intelligence-agent']) {
    const current = STARTER_AGENTS.find(agent => agent.slug === slug)!;
    const existing = loadGlobalAgent(slug, options);
    if (!existing || !isPreviousSignalTrackPrompt(slug, existing.systemPrompt, current.systemPrompt, '')) continue;
    // Parsing trims whitespace. Require the actual shipped body too so even
    // whitespace-only customizations are not mistaken for an untouched copy.
    const body = matter(readFileSync(getGlobalAgentFile(slug, options), 'utf-8')).content;
    if (body !== `${existing.systemPrompt}\n`) continue;
    if (replaceBuiltInAgentPromptText(slug, existing.systemPrompt, current.systemPrompt, options).updated) updatedAgents.push(slug);
  }
  for (const [slug, expectedHash] of Object.entries(PREVIOUS_YOUTUBE_SKILL_HASHES)) {
    const content = BUNDLED_STARTER_SKILLS.find(skill => skill.slug === slug)?.files.find(file => file.path === 'SKILL.md')?.content;
    if (content && replaceRequiredGlobalSkillFileIfHashMatches(slug, 'SKILL.md', expectedHash, content, options?.globalSkillsDir).updated) updatedSkills.push(slug);
  }
  return { updatedAgents, updatedSkills };
}
