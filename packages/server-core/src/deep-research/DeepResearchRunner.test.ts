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
      topic: 'artist background',
      planPolicy: 'auto',
      sourceSlugs: ['exa'],
    }, {
      runId,
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

  test('public start ignores forged host-only fields', () => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'deep-research-public-boundary-'))
    const forgedId = '11111111-1111-4111-8111-111111111111'
    const runner = new DeepResearchRunner({
      createSession: async () => ({ id: 'unused' }),
      sendMessage: async () => {},
      getLastAssistantText: () => '',
      getSessionToolUseSummary: () => ({ count: 0, names: [] }),
      abortSession: async () => {},
      getWorkspaceRootPath: () => workspaceRoot,
      resolveSourceReadiness: () => ({ requested: ['exa'], usable: ['exa'], missing: [], unusable: [] }),
      resolveSourceProfiles: () => [{ slug: 'exa', name: 'Exa', provider: 'exa', type: 'api', capabilities: ['search'] }],
    })
    const run = runner.start('workspace-1', {
      topic: 'public research',
      planPolicy: 'approve',
      sourceSlugs: ['exa'],
      runId: forgedId,
      purpose: 'forged',
      owner: { type: 'forged', id: 'forged' },
      executionContract: { overallTimeoutMs: 1, researchToolsOnly: true, nativePublicWebOnly: true },
      outputSchema: { type: 'string' },
    } as unknown as Parameters<DeepResearchRunner['start']>[1])
    expect(run.id).not.toBe(forgedId)
    expect(run.purpose).toBeUndefined()
    expect(run.owner).toBeUndefined()
    expect(run.outputSchema).toBeUndefined()
    expect(run.executionContract?.overallTimeoutMs).toBe(15 * 60 * 1000)
    expect(run.executionContract?.researchToolsOnly).toBeUndefined()
    expect(run.executionContract?.nativePublicWebOnly).toBeUndefined()
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
        const call = (name: string, toolUseId: string, input: Record<string, unknown>) => {
          const decision = guard!.beforeToolUse({
            sessionId,
            toolUseId,
            toolName: 'mcp__exa__api_exa',
            input,
          })
          decisions.push({ name, allowed: decision.allowed })
        }
        call('search-1', 'search-1', { path: '/search', method: 'POST' })
        call('search-2', 'search-2', { path: '/search', method: 'POST' })
        call('page-1', 'page-1', { path: '/contents', params: { urls: ['https://example.com/a?view=one'] } })
        call('page-concurrent', 'page-2', { path: '/contents', params: { urls: ['https://example.com/b'] } })
        guard.onToolUseCompleted?.({ sessionId, toolUseId: 'page-1', toolName: 'mcp__exa__api_exa', isError: false })
        call('page-retry', 'page-3', { path: '/contents', params: { urls: ['https://example.com/a?view=one'] } })
        call('page-2', 'page-4', { path: '/contents', params: { urls: ['https://example.com/a?view=two'] } })
        guard.onToolUseCompleted?.({ sessionId, toolUseId: 'page-4', toolName: 'mcp__exa__api_exa', isError: false })
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

    const prepared = runner.prepare('workspace-1', {
      topic: 'bounded research',
      planPolicy: 'auto',
      sourceSlugs: ['exa'],
    }, {
      executionContract: {
        maxSearchCalls: 1,
        maxPageReads: 2,
        maxConcurrentPageReads: 1,
        maxRetriesPerPage: 0,
        maxTotalResearchToolCalls: 3,
      },
    })
    runner.begin('workspace-1', prepared.id)

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

  test('host-only research restriction rejects unrelated and source mutation tools without changing default runs', async () => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'deep-research-tools-only-'))
    for (const strict of [true, false]) {
      let guard: HostToolExecutionGuard | undefined
      const events: DeepResearchRunnerEvent[] = []
      const decisions: boolean[] = []
      let sessionCount = 0
      const runner = new DeepResearchRunner({
        createSession: async (_workspaceId, _options, executionGuard) => {
          guard = executionGuard
          return { id: `strict-${strict}-${++sessionCount}` }
        },
        sendMessage: async (sessionId) => {
          if (sessionCount !== 1) return
          const calls: Array<[string, Record<string, unknown>]> = [
            ['Bash', { command: 'echo unsafe' }],
            ['mcp__exa__delete_collection', {}],
            ['mcp__exa__api_exa', { path: '/contents', method: 'DELETE' }],
            ['mcp__exa__api_exa', { path: '/search/delete', method: 'POST' }],
            ['web_search', { query: 'research' }],
            ['mcp__exa__api_exa', { path: '/contents', method: 'POST' }],
          ]
          for (const [index, [toolName, input]] of calls.entries()) {
            const toolUseId = `call-${index}`
            decisions.push(guard!.beforeToolUse({ sessionId, toolUseId, toolName, input }).allowed)
            guard!.onToolUseCompleted?.({ sessionId, toolUseId, toolName, isError: false })
          }
        },
        getLastAssistantText: () => 'complete',
        getSessionToolUseSummary: () => ({ count: 1, names: ['web_search'] }),
        abortSession: async () => {},
        getWorkspaceRootPath: () => workspaceRoot,
        resolveSourceReadiness: () => ({ requested: ['exa'], usable: ['exa'], missing: [], unusable: [] }),
        resolveSourceProfiles: () => [{ slug: 'exa', name: 'Exa', provider: 'exa', type: 'api', capabilities: ['search', 'browser'] }],
        emit: (event) => events.push(event),
      })
      const prepared = runner.prepare('workspace-1', {
        topic: 'research restriction', planPolicy: 'auto', sourceSlugs: ['exa'],
      }, { executionContract: { researchToolsOnly: strict } })
      expect(readDeepResearchRun(workspaceRoot, prepared.id)?.executionContract?.researchToolsOnly).toBe(strict || undefined)
      runner.begin('workspace-1', prepared.id)
      await waitFor(() => events.some(event => event.type === 'run.completed'))
      expect(decisions).toEqual(strict ? [false, false, false, false, true, true] : [true, true, true, true, true, true])
      expect(readDeepResearchRun(workspaceRoot, prepared.id)?.executionContract?.researchToolsOnly).toBe(strict || undefined)
    }
  })

  test('host native public-web mode excludes integrations and recognizes real Pi hook aliases', async () => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'deep-research-native-web-'))
    const events: DeepResearchRunnerEvent[] = []
    const created: CreateSessionOptions[] = []
    let guard: HostToolExecutionGuard | undefined
    let sessionCount = 0
    const runner = new DeepResearchRunner({
      createSession: async (_workspaceId, options, executionGuard) => {
        created.push(options)
        guard = executionGuard
        return { id: `native-${++sessionCount}` }
      },
      sendMessage: async sessionId => {
        for (const toolName of ['WebSearch', 'WebFetch', 'web_search', 'web_fetch']) {
          expect(guard!.beforeToolUse({ sessionId, toolUseId: toolName, toolName, input: {} }).allowed).toBe(true)
          guard!.onToolUseCompleted?.({ sessionId, toolUseId: toolName, toolName, isError: false })
        }
        for (const toolName of ['Bash', 'mcp__native-public-web__search', 'mcp__monid__monid_discover']) {
          expect(guard!.beforeToolUse({ sessionId, toolUseId: toolName, toolName, input: {} }).allowed).toBe(false)
        }
      },
      getLastAssistantText: () => 'research complete',
      getSessionToolUseSummary: () => ({ count: 2, names: ['WebSearch', 'WebFetch'] }),
      getSessionToolUseRecords: () => [{ toolUseId: 'actual-page', toolName: 'WebFetch', toolInput: { url: 'https://example.com/article' }, toolResult: 'Source page text.' }],
      abortSession: async () => {},
      getWorkspaceRootPath: () => workspaceRoot,
      resolveSourceReadiness: () => { throw new Error('Must not select all configured sources') },
      resolveSourceProfiles: () => { throw new Error('Must not resolve configured profiles') },
      emit: event => events.push(event),
    })
    const prepared = runner.prepare('workspace-1', { topic: 'native research', planPolicy: 'auto', sourceSlugs: ['monid'] }, {
      executionContract: { nativePublicWebOnly: true, maxSearchCalls: 12, maxPageReads: 12, maxTotalResearchToolCalls: 24 },
    })
    expect(prepared.sourceReadiness.usable).toEqual([])
    expect(prepared.plan.requiredSourceSlugs).toEqual([])
    expect(prepared.plan.sourceProfiles.map(source => source.slug)).toEqual(['native-public-web'])
    expect(readDeepResearchRun(workspaceRoot, prepared.id)?.executionContract?.nativePublicWebOnly).toBe(true)
    runner.begin('workspace-1', prepared.id)
    await waitFor(() => events.some(event => event.type === 'run.completed'))
    expect(created.every(options => options.enabledSourceSlugs?.length === 0)).toBe(true)
    expect(created[0]?.customSystemPrompt).toContain('Use only the built-in web_search and web_fetch')
    const completed = readDeepResearchRun(workspaceRoot, prepared.id)!
    expect(completed.state).toBe('succeeded')
    expect(completed.steps[0]?.toolReceipts?.find(receipt => receipt.toolName === 'WebFetch')?.kind).toBe('page-read')
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
      getSessionToolUseRecords: (sessionId) => sessionId === 'receipt-1' || sessionId === 'receipt-2' ? [{
        toolUseId: `page-${sessionId.at(-1)}`,
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

    const prepared = runner.prepare('workspace-1', {
      topic: 'structured artist research',
      planPolicy: 'auto',
      sourceSlugs: ['exa'],
    }, {
      outputSchema: {
        type: 'object',
        required: ['summary'],
        properties: { summary: { type: 'string' } },
      },
    })
    runner.begin('workspace-1', prepared.id)

    await waitFor(() => events.some((event) => event.type === 'run.completed'))
    const completed = [...events].reverse().find((event) => event.type === 'run.completed')
    if (completed?.type !== 'run.completed') throw new Error('Expected completed run')
    expect(completed.run.state).toBe('succeeded')
    expect(completed.run.structuredOutput).toEqual({ summary: 'verified' })
    expect(sendCounts.get('receipt-3')).toBe(2)
    const receipt = completed.run.steps[0]?.toolReceipts?.[0]
    expect(receipt?.requestUrl).toBe('https://example.com/profile')
    expect(receipt?.responseUrl).toBeUndefined()
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

    const prepared = runner.prepare('workspace-1', {
      topic: 'deadline research',
      planPolicy: 'auto',
      sourceSlugs: ['exa'],
    }, {
      executionContract: { overallTimeoutMs: 20 },
    })
    runner.begin('workspace-1', prepared.id)

    await waitFor(() => events.some((event) => event.type === 'run.completed'))
    const completed = [...events].reverse().find((event) => event.type === 'run.completed')
    if (completed?.type !== 'run.completed') throw new Error('Expected completed run')
    expect(completed.run.state).toBe('failed')
    expect(completed.run.error).toBe('Deep research deadline exceeded.')
    expect(aborted).toBe(1)
  })

  test('overall deadline fences session creation and cleans up a late child', async () => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'deep-research-create-deadline-'))
    const events: DeepResearchRunnerEvent[] = []
    const deleted: string[] = []
    let finishCreate: ((value: { id: string }) => void) | undefined
    const runner = new DeepResearchRunner({
      createSession: async () => new Promise<{ id: string }>((resolve) => { finishCreate = resolve }),
      sendMessage: async () => {},
      getLastAssistantText: () => '',
      getSessionToolUseSummary: () => ({ count: 0, names: [] }),
      abortSession: async () => {},
      deleteSession: async (sessionId) => { deleted.push(sessionId) },
      getWorkspaceRootPath: () => workspaceRoot,
      resolveSourceReadiness: () => ({ requested: ['exa'], usable: ['exa'], missing: [], unusable: [] }),
      resolveSourceProfiles: () => [{ slug: 'exa', name: 'Exa', provider: 'exa', type: 'api', capabilities: ['search'] }],
      emit: (event) => events.push(event),
    })
    const prepared = runner.prepare('workspace-1', {
      topic: 'deadline before child exists',
      planPolicy: 'auto',
      sourceSlugs: ['exa'],
    }, { executionContract: { overallTimeoutMs: 20 } })
    runner.begin('workspace-1', prepared.id)
    await waitFor(() => events.some((event) => event.type === 'run.completed'))
    finishCreate?.({ id: 'late-session' })
    await waitFor(() => deleted.includes('late-session'))
    expect(readDeepResearchRun(workspaceRoot, prepared.id)?.state).toBe('failed')
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
