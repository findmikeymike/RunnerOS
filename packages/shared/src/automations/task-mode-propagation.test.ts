import { describe, expect, test } from 'bun:test'
import { ActionDefinitionSchema, PromptActionSchema, PulseActionSchema, QueueWorkActionSchema } from './schemas.ts'

describe('automation focus contracts', () => {
  test('scheduled agent actions preserve focus and reject malformed or orphan modes', () => {
    const base = { type: 'queue-work', ownerScope: 'campaign', title: 'Focused work', execution: {
      type: 'agent-task', agentSlug: 'content-genius', taskModeId: 'ideas', brief: 'Write.',
      permissionMode: 'safe', expectedOutput: { requirement: 'none' },
    } }
    expect(QueueWorkActionSchema.parse(base).execution).toMatchObject({ taskModeId: 'ideas' })
    for (const taskModeId of ['', 'Full Mode', '-bad', null, 42]) {
      expect(QueueWorkActionSchema.safeParse({ ...base, execution: { ...base.execution, taskModeId } }).success).toBe(false)
    }
    expect(QueueWorkActionSchema.safeParse({ ...base, execution: { ...base.execution, agentSlug: undefined } }).success).toBe(false)
    expect(QueueWorkActionSchema.safeParse({ ...base, execution: {
      type: 'workflow-run', workflowSlug: 'workflow', workflowDigest: 'digest', triggerInputs: {}, taskModeId: 'ideas',
    } }).success).toBe(false)
  })

  test('preserves prompt and Pulse selections', () => {
    const prompt = { type: 'prompt', prompt: 'Write', agentSlug: 'content-genius', taskModeId: 'ideas' }
    const pulse = { type: 'pulse', driverAgentSlug: 'content-genius', taskModeId: 'ideas' }
    expect(PromptActionSchema.parse(prompt).taskModeId).toBe('ideas')
    expect(PulseActionSchema.parse(pulse).taskModeId).toBe('ideas')
    expect(ActionDefinitionSchema.parse(prompt)).toEqual(prompt)
    expect(ActionDefinitionSchema.parse(pulse)).toEqual(pulse)
  })
  test.each(['', 'Full Mode', '-full', ' full', 'a'.repeat(65), null, 42])('rejects malformed ID %p through the action union', (taskModeId) => {
    expect(ActionDefinitionSchema.safeParse({ type: 'prompt', prompt: 'Write', agentSlug: 'writer', taskModeId }).success).toBe(false)
    expect(ActionDefinitionSchema.safeParse({ type: 'pulse', driverAgentSlug: 'writer', taskModeId }).success).toBe(false)
  })
  test('rejects orphan modes while retaining no-mode actions', () => {
    expect(ActionDefinitionSchema.safeParse({ type: 'prompt', prompt: 'Write', taskModeId: 'ideas' }).success).toBe(false)
    expect(ActionDefinitionSchema.safeParse({ type: 'pulse', taskModeId: 'ideas' }).success).toBe(false)
    expect(ActionDefinitionSchema.safeParse({ type: 'prompt', prompt: 'Write' }).success).toBe(true)
    expect(ActionDefinitionSchema.safeParse({ type: 'pulse' }).success).toBe(true)
  })
})
