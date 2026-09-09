import type { AgentTaskModeDefinition, LoadedAgent } from './types.ts';

/**
 * Older built-in agent installs may retain qualified `legacy:<slug>` skill
 * assignments so migrations do not overwrite user state. Focus recipes use
 * canonical slugs, so expose both spellings while validating the inventory.
 */
export function buildTaskModeSkillInventory(skillSlugs: readonly string[]): Set<string> {
  const inventory = new Set<string>();
  for (const slug of skillSlugs) {
    inventory.add(slug);
    if (slug.startsWith('legacy:')) inventory.add(slug.slice('legacy:'.length));
  }
  return inventory;
}

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

  const skillInventory = buildTaskModeSkillInventory(agent.metadata.skills ?? []);
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

/** Select only adapters justified by the recipe at launch; optional candidates remain on demand. */
export function selectTaskModeSourceSlugs(
  mode: Pick<ResolvedAgentTaskMode, 'id' | 'primarySkillSlugs' | 'requiredSourceSlugs' | 'optionalSourceSlugs'>,
  usableSlugs: readonly string[],
): string[] {
  const usable = new Set(usableSlugs);
  const selected = mode.requiredSourceSlugs.filter(slug => usable.has(slug));
  // Publishing has an explicit product routing policy; do not activate every alternative.
  if (mode.id === 'publish' && mode.primarySkillSlugs.includes('social-publishing')) {
    const candidates = new Set([...mode.requiredSourceSlugs, ...mode.optionalSourceSlugs]);
    const route = ['trypost', 'postiz', 'printing-press-social'].find(slug => candidates.has(slug) && usable.has(slug));
    if (route) selected.push(route);
  }
  return [...new Set(selected)];
}

/** Keep authorized access unchanged while narrowing only launch-time delivery. */
export function filterContextDocsForTaskMode<T extends { slug: string; body?: string }>(
  docs: T[],
  mode: ResolvedAgentTaskMode | undefined,
): T[] {
  const topics = mode?.context?.preloadTopics;
  const allowed = topics ? new Set(topics) : undefined;
  const selected = allowed ? docs.filter((doc) => allowed.has(doc.slug)) : docs;
  return selected;
}

export function buildAgentTaskModePromptSection(mode: ResolvedAgentTaskMode | undefined): string {
  if (!mode) return '';
  const lines = [
    'Task mode (host-selected):',
    'This selected recipe governs initial scope. General persona instructions describing other disciplines do not require loading or executing them. Read the selected primary skills before substantive work, and retrieve only context needed for this outcome.',
    `- Focus: ${mode.label}`,
    `- Outcome: ${mode.description}`,
    `- Primary ${mode.primarySkillSlugs.length === 1 ? 'skill' : 'skills'} already selected: ${mode.primarySkillSlugs.map((slug) => `\`${slug}\``).join(', ')}`,
  ];
  if (mode.primarySkillSlugs.length > 1 && !mode.fullMode) {
    lines.push(
      'Use every selected primary skill together for the selected outcome. Read all selected skill instructions before substantive work; do not pick only one.',
      'Develop one coherent result through the conversation, not separate exercises or duplicate questionnaires. Reuse known artist context, ask only what is missing, and connect the selected disciplines explicitly. Stay within this focused outcome.',
    );
  }
  if (mode.adjacentSkills.length > 0) {
    lines.push('', 'Related capabilities (available on demand — not preloaded):');
    for (const adjacent of mode.adjacentSkills) {
      lines.push(`- \`${adjacent.slug}\`: ${adjacent.when} Route: ${adjacent.expansion}.`);
    }
    lines.push(
      '',
      'Stay focused on the selected outcome. If the conversation materially crosses a same-session boundary, call load_agent_capability with its skillSlug and the concrete reason, then read the returned instructions before using it. If the host refuses, offer a linked focused session rather than bypassing the refusal. For new-session or delegate boundaries, name the better handoff and offer it as the next focused step. Never preload adjacent skills just in case.',
    );
  }
  if (mode.optionalSourceSlugs.length > 0) {
    lines.push(
      '',
      `Optional adapter candidates (awareness only unless selected by the host): ${mode.optionalSourceSlugs.join(', ')}.`,
      'Do not activate these merely because they are listed. When the user-requested task needs one, use list_sources(activeOnly: true) to inspect that exact existing adapter and read its guide. Only for an already enabled, authenticated adapter within the current task authorization, call source_test(sourceSlug, autoEnable: true) to make its tools available; this may automatically restart the current response. Do not install, connect a new account, enable a disabled adapter, or treat activation as approval to generate, send, publish, or spend. If unavailable, explain the missing connection or offer the appropriate focused handoff. Media generation is only relevant when the user actually requests it.',
    );
  }
  const retrieve = mode.context?.retrieveOnDemandTopics ?? [];
  if (retrieve.length > 0) {
    lines.push('', `Retrieve only if the task needs it: ${retrieve.join('; ')}.`);
  }
  lines.push('The selected mode grants no new tool, source, permission, approval, or spending authority.');
  return lines.join('\n');
}

/** Hidden host prompt used after the artist deliberately chooses the first focus card. */
export function buildAgentTaskModeStarterPrompt(
  mode: Pick<ResolvedAgentTaskMode, 'label' | 'fullMode'>,
): string {
  const focus = mode.label;
  return [
    `The artist just selected ${focus} from the visible focus row.`,
    'Start the conversation now. Acknowledge the chosen focus naturally in one short sentence, then ask one sharp, useful opening question grounded in any artist context you already have.',
    'Do not mention this internal start signal, task-mode machinery, or skill loading. Do not produce the full deliverable before the artist answers.',
  ].join('\n');
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
