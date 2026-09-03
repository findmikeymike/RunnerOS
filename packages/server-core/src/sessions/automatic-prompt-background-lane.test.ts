import { describe, expect, test } from 'bun:test'
import type { ExecutePromptAutomationInput } from '@craft-agent/server-core/handlers'
import { SessionManager } from './SessionManager'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}

async function waitFor(predicate: () => boolean, attempts = 100): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('Condition was not met in time.')
}

type LaneHarness = {
  executeAutomaticPromptInBackgroundLane(input: ExecutePromptAutomationInput): Promise<{ sessionId: string }>
  executePromptAutomation(input: ExecutePromptAutomationInput): Promise<{ sessionId: string }>
  getScheduledWorkRunner(): { isBackgroundLaneOccupied(root: string, workspaceId: string): Promise<boolean> }
  isAutomationSessionWaitingForUser(sessionId: string): boolean
}

function automationInput(prompt: string): ExecutePromptAutomationInput {
  return {
    workspaceId: 'workspace-1',
    workspaceRootPath: '/tmp/workspace-1',
    prompt,
  }
}

describe('automatic prompt background lane', () => {
  test('serializes legacy prompt automations', async () => {
    const manager = new SessionManager()
    const lane = manager as unknown as LaneHarness
    const gates = [deferred<void>(), deferred<void>()]
    let starts = 0
    lane.getScheduledWorkRunner = () => ({ isBackgroundLaneOccupied: async () => false })
    lane.executePromptAutomation = async (input) => {
      const index = starts++
      const sessionId = `session-${index + 1}`
      await input.onSessionCreated?.(sessionId)
      await gates[index]!.promise
      return { sessionId }
    }

    const first = lane.executeAutomaticPromptInBackgroundLane(automationInput('first'))
    const second = lane.executeAutomaticPromptInBackgroundLane(automationInput('second'))
    await waitFor(() => starts === 1)
    expect(starts).toBe(1)

    gates[0]!.resolve()
    await first
    await waitFor(() => starts === 2)
    gates[1]!.resolve()
    await second
  })

  test('releases the lane while an automatic session waits for the artist', async () => {
    const manager = new SessionManager()
    const lane = manager as unknown as LaneHarness
    const gates = [deferred<void>(), deferred<void>()]
    const waiting = new Set<string>()
    let starts = 0
    lane.getScheduledWorkRunner = () => ({ isBackgroundLaneOccupied: async () => false })
    lane.isAutomationSessionWaitingForUser = (sessionId) => waiting.has(sessionId)
    lane.executePromptAutomation = async (input) => {
      const index = starts++
      const sessionId = `session-${index + 1}`
      await input.onSessionCreated?.(sessionId)
      await gates[index]!.promise
      return { sessionId }
    }

    const first = lane.executeAutomaticPromptInBackgroundLane(automationInput('first'))
    await waitFor(() => starts === 1)
    waiting.add('session-1')
    const second = lane.executeAutomaticPromptInBackgroundLane(automationInput('second'))
    await waitFor(() => starts === 2)

    gates[0]!.resolve()
    gates[1]!.resolve()
    await Promise.all([first, second])
  })
})
