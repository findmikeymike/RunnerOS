import type { AgentDefinitionDTO } from '../../shared/types'

type AgentFocusOwner = Pick<AgentDefinitionDTO, 'slug' | 'metadata'>

/** Scheduling cannot pause for a focus choice after a job has started. */
export function agentTaskModeSelectionError(agent: AgentFocusOwner, taskModeId?: string): string | undefined {
  const modes = agent.metadata.taskModes ?? []
  if (taskModeId && !modes.some(mode => mode.id === taskModeId)) return `That focus is no longer available for ${agent.metadata.name}. Choose another focus.`
  if (!taskModeId && agent.slug !== 'concierge' && modes.length > 1) return `Choose a focus for ${agent.metadata.name}.`
  return undefined
}
