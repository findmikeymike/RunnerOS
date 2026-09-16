import type { ScheduledWorkExecution } from '@craft-agent/shared/scheduled-work'

export function definitionReferencedByExecution(kind: 'agent' | 'workflow', slug: string, execution: ScheduledWorkExecution, workflowAgents: (slug: string) => string[]): boolean {
  if (execution.type === 'agent-task') return kind === 'agent' && execution.agentSlug === slug
  if (execution.type !== 'workflow-run') return false
  return kind === 'workflow' ? execution.workflowSlug === slug : workflowAgents(execution.workflowSlug).includes(slug)
}
