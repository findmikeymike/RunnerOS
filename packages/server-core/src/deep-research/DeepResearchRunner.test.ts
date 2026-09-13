import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CreateSessionOptions } from '@craft-agent/shared/protocol'
import type { HostToolExecutionGuard } from '@craft-agent/shared/agent/backend'
import { readDeepResearchRun } from '@craft-agent/shared/deep-research'
import { DeepResearchRunner, type DeepResearchRunnerEvent } from './DeepResearchRunner.ts'

let workspaceRoot = ''

afterEach(() => {
  if (workspaceRoot) rmSync(workspaceRoot, { recursive: true, force: true })
  workspaceRoot = ''
})

async function waitFor(pred: () => boolean, maxMs = 2000): Promise<void> {
  const start = Date.now()
  while (!pred() && Date.now() - start < maxMs) {
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  if (!pred()) throw new Error(`waitFor timed out after ${maxMs}ms`)
}

describe('DeepResearchRunner', () => {
  test('auto mode uses safe permissions, accepts native web tools, and deletes hidden step sessions', async () => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'deep-research-runner-'))
    const created: Array<{ id: string; options: CreateSessionOptions }> = []
    const deleted: string[] = []
    const outputs = new Map<string, string>()
    const events: DeepResearchRunnerEvent[] = []

    const runner = new DeepResearchRunner({
      createSession: async (_workspaceId, options) => {
        const id = `dr-sess-${created.length + 1}`
        created.push({ id, options })
        outputs.set(id, `output ${created.length}`)
        return { id }
      },
      sendMessage: async () => {},
      getLastAssistantText: (sessionId) => outputs.get(sessionId) ?? '',
      getSessionToolUseSummary: () => ({ count: 1, names: ['web_search'] }),
      abortSession: async () => {},
      deleteSession: async (sessionId) => {
        deleted.push(sessionId)
      },
      getWorkspaceRootPath: () => workspaceRoot,
      resolveSourceReadiness: () => ({ requested: ['exa'], usable: ['exa'], missing: [], unusable: [] }),
      resolveSourceProfiles: () => [{
        slug: 'exa',
        name: 'Exa',
        provider: 'exa',
        type: 'api',
        capabilities: ['search'],
      }],
      emit: (event) => events.push(event),
    })

    const started = runner.start('workspace-1', {
      topic: 'native web search',
      sourceSlugs: ['exa'],
      planPolicy: 'auto',
      depth: 'quick',
    })

    await waitFor(() => events.some((event) => event.type === 'run.completed'))
    const completedEvent = [...events].reverse().find((event) => event.type === 'run.completed')
    if (completedEvent?.type !== 'run.completed') {
      throw new Error('Expected deep research run to complete')
    }
    const completed = completedEvent.run

    expect(started.state).toBe('running')
    expect(started.executionContract).toMatchObject({
      maxSearchCalls: 2,
      maxPageReads: 5,
      maxConcurrentPageReads: 2,
      maxRetriesPerPage: 1,
    })
    expect(completed.state).toBe('succeeded')
    expect(created.map((item) => item.options.permissionMode)).toEqual(['safe', 'safe', 'safe'])
    expect(deleted).toEqual(['dr-sess-1', 'dr-sess-2', 'dr-sess-3'])
  })

  test('prepare persists host ownership before any child execution', async () => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'deep-research-prepare-'))
    const created: string[] = []
    const outputs = new Map<string, string>()
    const events: DeepResearchRunnerEvent[] = []
    const runId = '11111111-1111-4111-8111-111111111111'
    const runner = new DeepResearchRunner({
      createSession: async () => {
        const id = `prepared-${created.length + 1}`
        created.push(id)
        outputs.set(id, 'complete')
        return { id }
      },
      sendMessage: async () => {},
      getLastAssistantText: (sessionId) => outputs.get(sessionId) ?? '',
      getSessionToolUseSummary: () => ({ count: 1, names: ['web_search'] }),
      abortSession: async () => {},
      deleteSession: async () => {},
      getWorkspaceRootPath: () => workspaceRoot,
      resolveSourceReadiness: () => ({ requested: ['exa'], usable: ['exa'], missing: [], unusable: [] }),
      resolveSourceProfiles: () => [{ slug: 'exa', name: 'Exa', provider: 'exa', type: 'api', capabilities: ['search'] }],
      emit: (event) => events.push(event),
    })

    const prepared = runner.prepare('workspace-1', {
      runId,
      topic: 'artist background',
      planPolicy: 'auto',
      sourceSlugs: ['exa'],
      purpose: 'artist-profile-enrichment',
      owner: { type: 'artist-career-research', id: 'artist-42', generation: 3 },
    })

    expect(prepared.state).toBe('created')
    expect(created).toHaveLength(0)
    expect(readDeepResearchRun(workspaceRoot, runId)?.owner).toEqual({
      type: 'artist-career-research',
      id: 'artist-42',
      generation: 3,
    })

    const begun = runner.begin('workspace-1', runId)
    expect(begun.state).toBe('running')
    expect(begun.executionContract?.deadlineAt).toBeTruthy()
    await waitFor(() => events.some((event) => event.type === 'run.completed'))
    expect(created).toHaveLength(3)
  })

  test('host guard blocks search, concurrency, and per-page retry overflow before execution', async () => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'deep-research-budget-'))
    const outputs = new Map<string, string>()
    const decisions: Array<{ name: string; allowed: boolean }> = []
    let guard: HostToolExecutionGuard | undefined
    let sessionCount = 0
    const events: DeepResearchRunnerEvent[] = []
    const runner = new DeepResearchRunner({
      createSession: async (_workspaceId, _options, executionGuard) => {
        guard = executionGuard
        const id = `budget-${++sessionCount}`
        outputs.set(id, 'complete')
        return { id }
      },
      sendMessage: async (sessionId) => {
        if (sessionId !== 'budget-1' || !guard) return
        const call = (name: string, toolUseId: string, toolName: string, url?: string) => {
          const decision = guard!.beforeToolUse({
            sessionId,
            toolUseId,
            toolName,
            input: url ? { url } : {},
          })
          decisions.push({ name, allowed: decision.allowed })
        }
        call('search-1', 'search-1', 'web_search')
        call('search-2', 'search-2', 'web_search')
        call('page-1', 'page-1', 'web_fetch', 'https://example.com/a')
        call('page-concurrent', 'page-2', 'web_fetch', 'https://example.com/b')
        guard.onToolUseCompleted?.({ sessionId, toolUseId: 'page-1', toolName: 'web_fetch', isError: false })
        call('page-retry', 'page-3', 'web_fetch', 'https://example.com/a')
        call('page-2', 'page-4', 'web_fetch', 'https://example.com/b')
        guard.onToolUseCompleted?.({ sessionId, toolUseId: 'page-4', toolName: 'web_fetch', isError: false })
      },
      getLastAssistantText: (sessionId) => outputs.get(sessionId) ?? '',
      getSessionToolUseSummary: () => ({ count: 1, names: ['web_search'] }),
      abortSession: async () => {},
      deleteSession: async () => {},
      getWorkspaceRootPath: () => workspaceRoot,
      resolveSourceReadiness: () => ({ requested: ['exa'], usable: ['exa'], missing: [], unusable: [] }),
      resolveSourceProfiles: () => [{ slug: 'exa', name: 'Exa', provider: 'exa', type: 'api', capabilities: ['search', 'browser'] }],
      emit: (event) => events.push(event),
    })

    runner.start('workspace-1', {
      topic: 'bounded research',
      planPolicy: 'auto',
      sourceSlugs: ['exa'],
      executionContract: {
        maxSearchCalls: 1,
        maxPageReads: 2,
        maxConcurrentPageReads: 1,
        maxRetriesPerPage: 0,
        maxTotalResearchToolCalls: 3,
      },
    })

    await waitFor(() => events.some((event) => event.type === 'run.completed'))
    expect(decisions).toEqual([
      { name: 'search-1', allowed: true },
      { name: 'search-2', allowed: false },
      { name: 'page-1', allowed: true },
      { name: 'page-concurrent', allowed: false },
      { name: 'page-retry', allowed: false },
      { name: 'page-2', allowed: true },
    ])
  })

  test('persists sanitized tool receipts and repairs structured synthesis once', async () => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'deep-research-receipts-'))
    const outputs = new Map<string, string>()
    const sendCounts = new Map<string, number>()
    const events: DeepResearchRunnerEvent[] = []
    let sessionCount = 0
    const runner = new DeepResearchRunner({
      createSession: async () => ({ id: `receipt-${++sessionCount}` }),
      sendMessage: async (sessionId) => {
        const count = (sendCounts.get(sessionId) ?? 0) + 1
        sendCounts.set(sessionId, count)
        if (sessionId === 'receipt-3') {
          outputs.set(sessionId, count === 1 ? 'not json' : '{"summary":"verified"}')
        } else {
          outputs.set(sessionId, 'research complete')
        }
      },
      getLastAssistantText: (sessionId) => outputs.get(sessionId) ?? '',
      getSessionToolUseSummary: () => ({ count: 1, names: ['web_fetch'] }),
      getSessionToolUseRecords: (sessionId) => sessionId === 'receipt-1' ? [{
        toolUseId: 'page-1',
        toolName: 'web_fetch',
        toolInput: { url: 'https://user:pass@example.com/profile?token=secret#private' },
        toolResult: '{"url":"https://example.com/profile?token=secret","token":"raw-secret","text":"Career evidence"}',
      }] : [],
      abortSession: async () => {},
      deleteSession: async () => {},
      getWorkspaceRootPath: () => workspaceRoot,
      resolveSourceReadiness: () => ({ requested: ['exa'], usable: ['exa'], missing: [], unusable: [] }),
      resolveSourceProfiles: () => [{ slug: 'exa', name: 'Exa', provider: 'exa', type: 'api', capabilities: ['search', 'browser'] }],
      emit: (event) => events.push(event),
    })

    runner.start('workspace-1', {
      topic: 'structured artist research',
      planPolicy: 'auto',
      sourceSlugs: ['exa'],
      outputSchema: {
        type: 'object',
        required: ['summary'],
        properties: { summary: { type: 'string' } },
      },
    })

    await waitFor(() => events.some((event) => event.type === 'run.completed'))
    const completed = [...events].reverse().find((event) => event.type === 'run.completed')
    if (completed?.type !== 'run.completed') throw new Error('Expected completed run')
    expect(completed.run.state).toBe('succeeded')
    expect(completed.run.structuredOutput).toEqual({ summary: 'verified' })
    expect(sendCounts.get('receipt-3')).toBe(2)
    const receipt = completed.run.steps[0]?.toolReceipts?.[0]
    expect(receipt?.requestUrl).toBe('https://example.com/profile')
    expect(receipt?.responseUrl).toBe('https://example.com/profile')
    expect(receipt?.resultSha256).toHaveLength(64)
    expect(receipt?.supportExcerpt).not.toContain('secret')
  })

  test('overall deadline aborts the active child and fails the run', async () => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'deep-research-deadline-'))
    const events: DeepResearchRunnerEvent[] = []
    let aborted = 0
    const runner = new DeepResearchRunner({
      createSession: async () => ({ id: 'deadline-session' }),
      sendMessage: async () => new Promise<void>(() => {}),
      getLastAssistantText: () => '',
      getSessionToolUseSummary: () => ({ count: 0, names: [] }),
      abortSession: async () => { aborted += 1 },
      deleteSession: async () => {},
      getWorkspaceRootPath: () => workspaceRoot,
      resolveSourceReadiness: () => ({ requested: ['exa'], usable: ['exa'], missing: [], unusable: [] }),
      resolveSourceProfiles: () => [{ slug: 'exa', name: 'Exa', provider: 'exa', type: 'api', capabilities: ['search'] }],
      emit: (event) => events.push(event),
    })

    runner.start('workspace-1', {
      topic: 'deadline research',
      planPolicy: 'auto',
      sourceSlugs: ['exa'],
      executionContract: { overallTimeoutMs: 20 },
    })

    await waitFor(() => events.some((event) => event.type === 'run.completed'))
    const completed = [...events].reverse().find((event) => event.type === 'run.completed')
    if (completed?.type !== 'run.completed') throw new Error('Expected completed run')
    expect(completed.run.state).toBe('failed')
    expect(completed.run.error).toBe('Deep research deadline exceeded.')
    expect(aborted).toBe(1)
  })

  test('cancellation is durable before abort and late completion cannot publish', async () => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'deep-research-cancel-'))
    let releaseSend: (() => void) | undefined
    let sendStarted = false
    let runId = ''
    let stateObservedDuringAbort: string | undefined
    const runner = new DeepResearchRunner({
      createSession: async () => ({ id: 'cancel-session' }),
      sendMessage: async () => {
        sendStarted = true
        await new Promise<void>((resolve) => { releaseSend = resolve })
      },
      getLastAssistantText: () => 'late output',
      getSessionToolUseSummary: () => ({ count: 1, names: ['web_search'] }),
      abortSession: async () => {
        stateObservedDuringAbort = readDeepResearchRun(workspaceRoot, runId)?.state
      },
      deleteSession: async () => {},
      getWorkspaceRootPath: () => workspaceRoot,
      resolveSourceReadiness: () => ({ requested: ['exa'], usable: ['exa'], missing: [], unusable: [] }),
      resolveSourceProfiles: () => [{ slug: 'exa', name: 'Exa', provider: 'exa', type: 'api', capabilities: ['search'] }],
    })

    runId = runner.start('workspace-1', {
      topic: 'cancelled research',
      planPolicy: 'auto',
      sourceSlugs: ['exa'],
    }).id
    await waitFor(() => sendStarted)
    const cancelled = await runner.cancel('workspace-1', runId)
    expect(cancelled.state).toBe('cancelled')
    expect(stateObservedDuringAbort).toBe('cancelled')
    releaseSend?.()
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(readDeepResearchRun(workspaceRoot, runId)?.state).toBe('cancelled')
    expect(readDeepResearchRun(workspaceRoot, runId)?.outputId).toBeUndefined()
  })
})
