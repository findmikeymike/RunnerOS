import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { matter, stringifyFrontmatter } from '../config/frontmatter.ts';
import { BUNDLED_STARTER_SKILLS } from '../skills/bundled.generated.ts';
import { replaceRequiredGlobalSkillFileIfHashMatches } from '../skills/storage.ts';
import { atomicWriteFileSync } from '../utils/files.ts';
import baselines from './__fixtures__/monid-routing-v1/baselines.json';
import { STARTER_AGENTS } from './starter-templates.ts';
import { getGlobalAgentFile, loadGlobalAgent, type AgentStorageOptions } from './storage.ts';

export const PREVIOUS_MONID_SKILL_HASHES: Readonly<Record<string, readonly string[]>> = baselines.skills;
const routingKeys = ['skills', 'sources', 'optionalSources'] as const;
const descriptiveKeys = ['tags', 'description', 'greeting', 'inputs', 'outputs'] as const;
const equal = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);
const digest = (content: string): string => createHash('sha256').update(content).digest('hex');

/** Upgrade only recognized shipped definitions. Never create, enable, or restore anything. */
export function migrateMonidRouting(options?: AgentStorageOptions & { globalSkillsDir?: string }): {
  updatedAgents: string[];
  updatedSkills: string[];
} {
  const updatedAgents: string[] = [];
  const updatedSkills: string[] = [];
  for (const previous of baselines.agents) {
    const current = STARTER_AGENTS.find(agent => agent.slug === previous.slug);
    if (!current || !loadGlobalAgent(previous.slug, options)) continue;
    const file = getGlobalAgentFile(previous.slug, options);
    const original = readFileSync(file, 'utf-8');
    const parsed = matter(original);
    const currentBody = `${current.systemPrompt}\n`;
    const isPreviousBody = [previous.bodySha256, 'normalizedBodySha256' in previous ? previous.normalizedBodySha256 : undefined].includes(digest(parsed.content));
    // Even whitespace-only prompt customizations remain untouched.
    if (!isPreviousBody && parsed.content !== currentBody) continue;
    const data: Record<string, unknown> = { ...parsed.data };
    const prior: Record<string, unknown> = previous.metadata;
    const next = current.metadata;
    let changed = isPreviousBody && parsed.content !== currentBody;
    const update = (key: typeof routingKeys[number] | typeof descriptiveKeys[number]): void => {
      if (equal(data[key], next[key])) return;
      if (next[key] === undefined) delete data[key];
      else data[key] = next[key];
      changed = true;
    };
    // Treat routing selections as one user-owned set. A removed/disabled/custom
    // selection must not be reintroduced by upgrading another routing field.
    if (routingKeys.every(key => equal(data[key], prior[key]))) {
      for (const key of routingKeys) update(key);
    }
    for (const key of descriptiveKeys) {
      if (equal(data[key], prior[key])) update(key);
    }
    if (!changed) continue;
    const header = stringifyFrontmatter('', data);
    atomicWriteFileSync(file, header.slice(0, header.length - matter(header).content.length) + currentBody);
    updatedAgents.push(previous.slug);
  }
  for (const [slug, previousHashes] of Object.entries(PREVIOUS_MONID_SKILL_HASHES)) {
    const content = BUNDLED_STARTER_SKILLS.find(skill => skill.slug === slug)?.files.find(file => file.path === 'SKILL.md')?.content;
    if (!content) continue;
    for (const hash of previousHashes) {
      if (hash === digest(content)) continue;
      if (replaceRequiredGlobalSkillFileIfHashMatches(slug, 'SKILL.md', hash, content, options?.globalSkillsDir).updated) {
        updatedSkills.push(slug);
        break;
      }
    }
  }
  return { updatedAgents, updatedSkills };
}
