import { describe, expect, test } from 'bun:test'
import type { ExecutePromptAutomationInput } from '@craft-agent/server-core/handlers'
import { SessionManager } from './SessionManager'
import { messageToStored, storedToMessage } from '@craft-agent/core/types'

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
    backgroundFence: 'test-runner',
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


describe('automatic prompt ownership', () => {
  function harness() {
    const manager = new SessionManager()
    let fence = 'original'
    let created = 0
    let sent = 0
    const host = manager as any
    host.assertBackgroundExecutionFence = (_root: string, expected?: string) => {
      if (expected !== undefined && expected !== fence) throw new Error('Ownership changed')
    }
    host.resolveAgentSessionOptions = async () => ({})
    host.createSession = async () => { created++; return { id: 'test-session' } }
    host.sendEvent = () => {}
    host.sendMessage = async (_id: string, _message: string, _attachments: unknown, _stored: unknown, options: { backgroundFence?: string }) => {
      expect(options.backgroundFence).toBe('original')
      sent++
    }
    return { manager, host, handoff: () => { fence = 'replacement' }, counts: () => ({ created, sent }) }
  }

  test('handoff during agent preparation prevents creating or dispatching a session', async () => {
    const h = harness()
    const gate = deferred<void>()
    h.host.resolveAgentSessionOptions = async () => { await gate.promise; return {} }
    const run = h.manager.executePromptAutomation({ ...automationInput('task'), agentSlug: 'test-agent', backgroundFence: 'original' })
    h.handoff()
    gate.resolve()
    await expect(run).rejects.toThrow('Ownership changed')
    expect(h.counts()).toEqual({ created: 0, sent: 0 })
  })

  test('handoff while recording the created session prevents dispatch', async () => {
    const h = harness()
    await expect(h.manager.executePromptAutomation({
      ...automationInput('task'), backgroundFence: 'original', onSessionCreated: async () => h.handoff(),
    })).rejects.toThrow('Ownership changed')
    expect(h.counts()).toEqual({ created: 1, sent: 0 })
  })

  test('queued message persistence retains the original ownership token', () => {
    const recovered = storedToMessage(JSON.parse(JSON.stringify(messageToStored({
      id: 'queued', role: 'user', content: 'task', timestamp: 1,
      isQueued: true, backgroundFence: 'original',
    }))))
    expect(recovered.backgroundFence).toBe('original')
    expect(recovered.isQueued).toBe(true)
  })

  test('unchanged ownership carries the original token through to dispatch', async () => {
    const h = harness()
    await h.manager.executePromptAutomation({ ...automationInput('task'), backgroundFence: 'original' })
    expect(h.counts()).toEqual({ created: 1, sent: 1 })
  })
})
