import type { AgentTaskModeDefinition, LoadedAgent } from './types.ts';

export interface ResolvedAgentTaskMode {
  id: string;
  label: string;
  description: string;
  definitionRevision: string;
  primarySkillSlugs: string[];
  adjacentSkills: NonNullable<AgentTaskModeDefinition['adjacentSkills']>;
  requiredSourceSlugs: string[];
  optionalSourceSlugs: string[];
  context?: AgentTaskModeDefinition['context'];
  fullMode: boolean;
}

/** Resolve against the Agent's declared inventory. The model never self-selects capabilities. */
export function resolveAgentTaskMode(
  agent: Pick<LoadedAgent, 'slug' | 'metadata'>,
  taskModeId: string | undefined,
): ResolvedAgentTaskMode | undefined {
  if (!taskModeId) return undefined;
  const mode = agent.metadata.taskModes?.find((candidate) => candidate.id === taskModeId);
  if (!mode) throw new Error(`Task mode "${taskModeId}" is not available for ${agent.metadata.name}.`);

  const skillInventory = new Set(agent.metadata.skills ?? []);
  const sourceInventory = new Set([
    ...(agent.metadata.sources ?? []),
    ...(agent.metadata.optionalSources ?? []),
  ]);
  const invalidSkills = [
    ...mode.primarySkillSlugs,
    ...(mode.adjacentSkills ?? []).map((skill) => skill.slug),
  ].filter((slug) => !skillInventory.has(slug));
  if (invalidSkills.length > 0) {
    throw new Error(`Task mode "${mode.label}" references unavailable skills: ${Array.from(new Set(invalidSkills)).join(', ')}.`);
  }
  const invalidSources = [
    ...(mode.requiredSourceSlugs ?? []),
    ...(mode.optionalSourceSlugs ?? []),
  ].filter((slug) => !sourceInventory.has(slug));
  if (invalidSources.length > 0) {
    throw new Error(`Task mode "${mode.label}" references unavailable sources: ${Array.from(new Set(invalidSources)).join(', ')}.`);
  }

  return {
    id: mode.id,
    label: mode.label,
    description: mode.description,
    definitionRevision: taskModeRevision(mode),
    primarySkillSlugs: [...mode.primarySkillSlugs],
    adjacentSkills: [...(mode.adjacentSkills ?? [])],
    requiredSourceSlugs: [...(mode.requiredSourceSlugs ?? [])],
    optionalSourceSlugs: [...(mode.optionalSourceSlugs ?? [])],
    context: mode.context,
    fullMode: mode.fullMode === true,
  };
}

/** Keep authorized access unchanged while narrowing only launch-time delivery. */
export function filterContextDocsForTaskMode<T extends { slug: string }>(
  docs: T[],
  mode: ResolvedAgentTaskMode | undefined,
): T[] {
  const topics = mode?.context?.preloadTopics;
  if (!topics || topics.length === 0) return docs;
  const allowed = new Set(topics);
  return docs.filter((doc) => allowed.has(doc.slug));
}

export function buildAgentTaskModePromptSection(mode: ResolvedAgentTaskMode | undefined): string {
  if (!mode) return '';
  const lines = [
    'Task mode (host-selected):',
    `- Focus: ${mode.label}`,
    `- Outcome: ${mode.description}`,
    `- Primary ${mode.primarySkillSlugs.length === 1 ? 'skill' : 'skills'} already selected: ${mode.primarySkillSlugs.map((slug) => `\`${slug}\``).join(', ')}`,
  ];
  if (mode.adjacentSkills.length > 0) {
    lines.push('', 'Related capability boundaries (awareness only — not loaded in this pilot):');
    for (const adjacent of mode.adjacentSkills) {
      lines.push(`- \`${adjacent.slug}\`: ${adjacent.when} Route: ${adjacent.expansion}.`);
    }
    lines.push(
      '',
      'Stay focused on the selected outcome. If the conversation materially crosses one of these boundaries, name the better mode or handoff and offer that as the next focused step. Do not claim an adjacent skill was loaded or use one merely because it might help.',
    );
  }
  const retrieve = mode.context?.retrieveOnDemandTopics ?? [];
  if (retrieve.length > 0) {
    lines.push('', `Retrieve only if the task needs it: ${retrieve.join('; ')}.`);
  }
  lines.push('The selected mode grants no new tool, source, permission, approval, or spending authority.');
  return lines.join('\n');
}

function taskModeRevision(mode: AgentTaskModeDefinition): string {
  const input = JSON.stringify(mode);
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `task-mode-v1-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
