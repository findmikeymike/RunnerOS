import { describe, expect, test } from 'bun:test'
import { parseWorkflowFile, serializeWorkflow } from './parser.ts'
import type { WorkflowMetadata } from './types.ts'
import { STARTER_WORKFLOWS } from './starter-templates.ts'
import { STARTER_AGENTS } from '../agent-definitions/starter-templates.ts'
import { TIER_ONE_TASK_MODES } from '../agent-definitions/task-mode-recipes/tier-one.ts'
import { TIER_TWO_TASK_MODES } from '../agent-definitions/task-mode-recipes/tier-two.ts'

const metadata: WorkflowMetadata = {
  name: 'Focused workflow', description: 'Run two different focuses.', trigger: { type: 'manual' },
  steps: [
    { id: 'ideas', agent: 'content-genius', taskModeId: 'ideas', input: 'Develop the idea.' },
    { id: 'finish', agent: 'content-genius', taskModeId: 'captions', input: '{{steps.ideas.output}}' },
  ],
}

describe('workflow task mode persistence', () => {
  test('round-trips exact per-step focus IDs', () => {
    expect(parseWorkflowFile(serializeWorkflow(metadata, 'Body'))?.metadata.steps).toEqual(metadata.steps)
  })
  test.each(['', 'Full Mode', ' full', '-full', 'a'.repeat(65), null, 42])('rejects malformed mode %p instead of dropping it', (taskModeId) => {
    const file = `---\nname: Bad\ndescription: Bad mode\nsteps:\n  - id: work\n    agent: writer\n    input: Write\n    taskModeId: ${JSON.stringify(taskModeId)}\n---\n`
    expect(parseWorkflowFile(file)).toBeNull()
    expect(() => serializeWorkflow({ ...metadata, steps: [{ ...metadata.steps[0]!, taskModeId: taskModeId as string }] }, '')).toThrow()
  })
  test('rejects an orphan mode and preserves no-mode narrow steps', () => {
    const file = '---\nname: Bad\ndescription: Missing agent\nsteps:\n  - id: work\n    taskModeId: ideas\n    input: Write\n---\n'
    expect(parseWorkflowFile(file)).toBeNull()
    const narrow = { ...metadata, steps: [{ id: 'write', agent: 'writer', input: 'Write.' }] }
    expect(parseWorkflowFile(serializeWorkflow(narrow, ''))?.metadata.steps).toEqual(narrow.steps)
  })
  test('built-in workflows explicitly select existing focus IDs for multi-mode workers', () => {
    const maps = { ...TIER_ONE_TASK_MODES, ...TIER_TWO_TASK_MODES }
    for (const workflow of STARTER_WORKFLOWS) {
      for (const step of workflow.metadata.steps) {
        const modes = maps[step.agent] ?? STARTER_AGENTS.find(a => a.slug === step.agent)?.metadata.taskModes
        if (!modes?.length) continue
        expect(step.taskModeId, `${workflow.slug}/${step.id} needs a focus`).toBeDefined()
        expect(modes.some(mode => mode.id === step.taskModeId), `${workflow.slug}/${step.id} focus must exist`).toBe(true)
      }
    }
  })
})
