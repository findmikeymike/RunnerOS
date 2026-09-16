import { expect, test } from 'bun:test'
import { definitionReferencedByExecution } from './definition-edit-guard'
import type { ScheduledWorkExecution } from '@craft-agent/shared/scheduled-work'

test('shared agent edits find direct jobs and workflow dependencies across targets', () => {
  const workflow: ScheduledWorkExecution = { type: 'workflow-run', workflowSlug: 'weekly', workflowDigest: 'pinned', triggerInputs: {} }
  const agents = (slug: string) => slug === 'weekly' ? ['writer', 'critic'] : []
  expect(definitionReferencedByExecution('agent', 'writer', workflow, agents)).toBe(true)
  expect(definitionReferencedByExecution('agent', 'unrelated', workflow, agents)).toBe(false)
  expect(definitionReferencedByExecution('workflow', 'weekly', workflow, agents)).toBe(true)
  expect(definitionReferencedByExecution('workflow', 'other', workflow, agents)).toBe(false)
  const direct: ScheduledWorkExecution = { type: 'agent-task', agentSlug: 'writer', brief: 'Write', permissionMode: 'ask', expectedOutput: { requirement: 'none' } }
  expect(definitionReferencedByExecution('agent', 'writer', direct, agents)).toBe(true)
  expect(definitionReferencedByExecution('workflow', 'writer', direct, agents)).toBe(false)
  expect(definitionReferencedByExecution('agent', 'writer', { type: 'review', reviewerType: 'user' }, agents)).toBe(false)
})
