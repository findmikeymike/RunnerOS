import { isGeneralAgentTaskMode } from '@craft-agent/shared/agent-definitions/task-modes';
import { createHash } from 'node:crypto';
import type { AgentMetadata } from '@craft-agent/shared/agent-definitions/types';
import type { LoadedSkill } from '@craft-agent/shared/skills/types';
import type { AgentCapabilityExpansionReceipt, SessionLaunchReceipt } from '@craft-agent/shared/sessions/types';
import type { LoadAgentCapabilityResult } from '@craft-agent/session-tools-core';

export interface AgentCapabilityExpansionInput {
  skillSlug: string;
  reason: string;
  /** Snapshot admitted for this response, never the pending next-turn selection. */
  taskMode: SessionLaunchReceipt['taskMode'];
  agentMetadata: Pick<AgentMetadata, 'skills'>;
  /** Only an installed, already available skill; caller must not install or activate it. */
  skill: Pick<LoadedSkill, 'slug' | 'content' | 'metadata' | 'aliases'> | null | undefined;
  expansions: readonly AgentCapabilityExpansionReceipt[];
  /** Stable user-input identity, shared by fallback/auth retry attempts. */
  inputMessageId: string;
  enabledSourceSlugs: readonly string[];
  authorizedToolNames?: readonly string[];
  currentSkillSlugs: readonly string[];
  now: number;
}

/** Pure host policy: no IO, permission changes, source enabling, or prompt mutation. */
export function resolveAgentCapabilityExpansion(input: AgentCapabilityExpansionInput): {
  receipt: AgentCapabilityExpansionReceipt;
  result: LoadAgentCapabilityResult;
  expansions: AgentCapabilityExpansionReceipt[];
  nextSkillSlugs: string[];
} {
  const { taskMode, skill, skillSlug } = input;
  if (!taskMode || !input.inputMessageId.trim()) throw new Error('An admitted focused response is required to load an adjacent capability.');
  const reason = input.reason.trim();
  if (!reason || reason.length > 1000) throw new Error('Explain the current need in 1000 characters or fewer.');
  if (!(input.agentMetadata.skills ?? []).includes(skillSlug)) throw new Error('This capability is outside the worker inventory.');
  const adjacent = taskMode.adjacentSkills.find(entry => entry.slug === skillSlug);
  if (!adjacent || adjacent.expansion !== 'same-session') {
    throw new Error('This capability is not a declared same-session expansion. Use a focused handoff.');
  }
  if (!skill || (skill.slug !== skillSlug && !skill.aliases?.includes(skillSlug)) || !skill.content.trim()) throw new Error('The capability instructions are not installed and available.');
  const missingSources = (skill.metadata.requiredSources ?? []).filter(slug => !input.enabledSourceSlugs.includes(slug));
  if (missingSources.length) throw new Error(`This capability requires new sources: ${missingSources.join(', ')}. Use a focused handoff.`);
  const newTools = (skill.metadata.alwaysAllow ?? []).filter(name => !(input.authorizedToolNames ?? []).includes(name));
  if (newTools.length) throw new Error(`This capability requests additional tool authority: ${newTools.join(', ')}. Use a focused handoff.`);

  // Include policy metadata: a changed source/tool prerequisite must not reuse an old receipt.
  const contentRevision = createHash('sha256').update(JSON.stringify({
    content: skill.content,
    requiredSources: skill.metadata.requiredSources ?? [],
    alwaysAllow: skill.metadata.alwaysAllow ?? [],
  })).digest('hex');
  const general = isGeneralAgentTaskMode(taskMode);
  // General selects skills afresh each response; historical receipts remain audit evidence.
  const relevantExpansions = input.expansions.filter(entry => entry.taskModeId === taskMode.id
    && entry.taskModeRevision === taskMode.definitionRevision
    && (!general || entry.inputMessageId === input.inputMessageId));
  const previous = relevantExpansions.find(entry => entry.skillSlug === skillSlug);
  if (previous && previous.contentRevision !== contentRevision) throw new Error('The capability changed since it was loaded. Start a new focused session.');
  if (!general && !previous && relevantExpansions.some(entry => entry.inputMessageId === input.inputMessageId)) {
    throw new Error('Only one new capability may be loaded per response. Continue on the next user turn.');
  }
  if (!general && !previous && relevantExpansions.length >= 2) throw new Error('This session already loaded two adjacent capabilities. Start a linked focused or Full session.');
  const receipt: AgentCapabilityExpansionReceipt = previous ?? {
    skillSlug,
    contentRevision,
    taskModeId: taskMode.id,
    taskModeRevision: taskMode.definitionRevision,
    inputMessageId: input.inputMessageId,
    reason,
    loadedAt: input.now,
  };
  return {
    receipt,
    result: { skillSlug, instructions: skill.content, alreadyLoaded: Boolean(previous) },
    expansions: previous ? [...input.expansions] : [...input.expansions, receipt],
    nextSkillSlugs: [...new Set([...input.currentSkillSlugs, skillSlug])],
  };
}


/** Register an existing global instruction package only after every authority check passes. */
export async function prepareAgentCapabilityExpansion(
  input: AgentCapabilityExpansionInput,
  registerInstalledGlobalSkill?: () => void | Promise<void>,
): Promise<ReturnType<typeof resolveAgentCapabilityExpansion>> {
  const result = resolveAgentCapabilityExpansion(input);
  if (registerInstalledGlobalSkill) {
    if (!isGeneralAgentTaskMode(input.taskMode)) throw new Error('On-demand registration requires General mode.');
    await registerInstalledGlobalSkill();
  }
  return result;
}
