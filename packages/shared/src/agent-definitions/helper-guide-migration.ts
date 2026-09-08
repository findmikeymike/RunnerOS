import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { matter } from '../config/frontmatter.ts';
import { replaceRequiredGlobalSkillFileIfHashMatches } from '../skills/storage.ts';
import { STARTER_SKILLS } from '../skills/starter-templates.ts';
import { atomicWriteFileSync } from '../utils/files.ts';
import baselines from './__fixtures__/helper-guide-v1/baselines.json';
import { STARTER_AGENTS } from './starter-templates.ts';
import { getGlobalAgentFile, loadGlobalAgent, type AgentStorageOptions } from './storage.ts';

const digest = (content: string): string => createHash('sha256').update(content).digest('hex');
export const PREVIOUS_HELPER_PROMPT_HASHES: readonly string[] = baselines.agents.map(version => version.bodySha256);
export const PREVIOUS_HELPER_GUIDE_HASHES: readonly string[] = baselines.skills.map(version => version.sha256);

/** Upgrade exact shipped helper text only. Do not create files or change user metadata/activation. */
export function migrateHelperGuide(options?: AgentStorageOptions & { globalSkillsDir?: string }): {
  updatedAgents: string[];
  updatedSkills: string[];
} {
  const updatedAgents: string[] = [];
  const updatedSkills: string[] = [];
  const current = STARTER_AGENTS.find(agent => agent.slug === 'setup-concierge');
  if (current && loadGlobalAgent(current.slug, options)) {
    const file = getGlobalAgentFile(current.slug, options);
    const original = readFileSync(file, 'utf-8');
    const previousBody = matter(original).content;
    const currentBody = `${current.systemPrompt.trimEnd()}\n`;
    if (previousBody !== currentBody && PREVIOUS_HELPER_PROMPT_HASHES.includes(digest(previousBody))
      && original.endsWith(previousBody)) {
      // Preserve frontmatter byte-for-byte, including custom metadata, comments and formatting.
      const next = original.slice(0, original.length - previousBody.length) + currentBody;
      atomicWriteFileSync(file, next);
      updatedAgents.push(current.slug);
    }
  }
  const guide = STARTER_SKILLS.find(skill => skill.slug === 'artist-os-guide')
    ?.files.find(file => file.path === 'SKILL.md')?.content;
  if (guide) {
    for (const hash of PREVIOUS_HELPER_GUIDE_HASHES) {
      if (hash === digest(guide)) continue;
      if (replaceRequiredGlobalSkillFileIfHashMatches('artist-os-guide', 'SKILL.md', hash, guide, options?.globalSkillsDir).updated) {
        updatedSkills.push('artist-os-guide');
        break;
      }
    }
  }
  // New reference files belong to ensureRequiredGlobalSkills, which seeds missing files.
  // This migration must never restore a deleted helper/skill or replace a custom reference.
  return { updatedAgents, updatedSkills };
}
