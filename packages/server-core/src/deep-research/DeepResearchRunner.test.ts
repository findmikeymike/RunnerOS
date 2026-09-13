import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CreateSessionOptions } from '@craft-agent/shared/protocol'
import type { HostToolExecutionGuard } from '@craft-agent/shared/agent/backend'
import { readDeepResearchRun, type DeepResearchRunSnapshot, type DeepResearchSourceProfile } from '@craft-agent/shared/deep-research'
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
      executionContract: { overallTimeoutMs: 1 },
      outputSchema: { type: 'string' },
    } as unknown as Parameters<DeepResearchRunner['start']>[1])
    expect(run.id).not.toBe(forgedId)
    expect(run.purpose).toBeUndefined()
    expect(run.owner).toBeUndefined()
    expect(run.outputSchema).toBeUndefined()
    expect(run.executionContract?.overallTimeoutMs).toBe(15 * 60 * 1000)
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

  test('blocks unpinned WebFetch and accounts for the restricted native browser at the execution boundary', async () => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'deep-research-native-browser-budget-'))
    const decisions: Array<{ name: string; allowed: boolean }> = []
    const events: DeepResearchRunnerEvent[] = []
    let guard: HostToolExecutionGuard | undefined
    let sessionCount = 0
    const runner = new DeepResearchRunner({
      createSession: async (_workspaceId, _options, executionGuard) => {
        guard = executionGuard
        return { id: `native-browser-${++sessionCount}` }
      },
      sendMessage: async (sessionId) => {
        if (sessionId !== 'native-browser-1' || !guard) return
        const batch = guard.beforeToolUse({ sessionId, toolUseId: 'browser-batch', toolName: 'mcp__session__browser_tool', input: { command: 'wait network-idle 8000; snapshot' } })
        decisions.push({ name: 'browser-batch', allowed: batch.allowed })
        const fetch = guard.beforeToolUse({ sessionId, toolUseId: 'fetch-1', toolName: 'WebFetch', input: { url: 'https://example.com/a' } })
        decisions.push({ name: 'WebFetch', allowed: fetch.allowed })
        const unknownSourceAction = guard.beforeToolUse({ sessionId, toolUseId: 'source-delete', toolName: 'mcp__exa__delete_page', input: { id: 'page-1' } })
        decisions.push({ name: 'source-delete', allowed: unknownSourceAction.allowed })
        const mutationMethod = guard.beforeToolUse({ sessionId, toolUseId: 'api-delete', toolName: 'mcp__exa__api_exa', input: { path: '/contents', method: 'DELETE' } })
        decisions.push({ name: 'api-delete', allowed: mutationMethod.allowed })
        const unrelatedTool = guard.beforeToolUse({ sessionId, toolUseId: 'workspace-read', toolName: 'workspace_read', input: { path: 'private.md' } })
        decisions.push({ name: 'workspace-read', allowed: unrelatedTool.allowed })
        const listWindows = guard.beforeToolUse({ sessionId, toolUseId: 'browser-windows', toolName: 'mcp__session__browser_tool', input: { command: 'windows' } })
        decisions.push({ name: 'browser-windows', allowed: listWindows.allowed })
        const browserCommand = ['navigate', 'https://example.com/story?p=123&utm_source=test']
        const browser = guard.beforeToolUse({ sessionId, toolUseId: 'browser-1', toolName: 'mcp__session__browser_tool', input: { command: browserCommand } })
        decisions.push({ name: 'browser_tool', allowed: browser.allowed })
        guard.onToolUseCompleted?.({
          sessionId,
          toolUseId: 'browser-1',
          toolName: 'mcp__session__browser_tool',
          toolInput: { command: browserCommand },
          toolResult: 'Navigated to: https://example.com/story?p=123&utm_source=test\nCareer evidence from the page.',
          isError: false,
        })
        const snapshotCommand = ['snapshot']
        const snapshot = guard.beforeToolUse({ sessionId, toolUseId: 'browser-snapshot', toolName: 'mcp__session__browser_tool', input: { command: snapshotCommand } })
        decisions.push({ name: 'browser-snapshot', allowed: snapshot.allowed })
        guard.onToolUseCompleted?.({
          sessionId,
          toolUseId: 'browser-snapshot',
          toolName: 'mcp__session__browser_tool',
          toolInput: { command: snapshotCommand },
          toolResult: 'URL: https://example.com/story?p=123&utm_source=test\nSnapshot content.',
          isError: false,
        })
        for (const [toolUseId, command] of [
          ['browser-find', 'find https://spoofed.example/finding'],
          ['browser-evaluate', ['evaluate', '"https://spoofed.example/evaluate"']],
          ['browser-click', 'click @e1'],
        ] as const) {
          const decision = guard.beforeToolUse({ sessionId, toolUseId, toolName: 'mcp__session__browser_tool', input: { command } })
          decisions.push({ name: toolUseId, allowed: decision.allowed })
          guard.onToolUseCompleted?.({
            sessionId,
            toolUseId,
            toolName: 'mcp__session__browser_tool',
            toolInput: { command },
            toolResult: `URL: https://spoofed.example/${toolUseId}\nPage-controlled text`,
            isError: false,
          })
        }
      },
      getLastAssistantText: () => 'complete',
      getSessionToolUseSummary: () => ({ count: 1, names: ['WebFetch'] }),
      abortSession: async () => {},
      deleteSession: async () => {},
      getWorkspaceRootPath: () => workspaceRoot,
      resolveSourceReadiness: () => ({ requested: ['exa'], usable: ['exa'], missing: [], unusable: [] }),
      resolveSourceProfiles: () => [{ slug: 'exa', name: 'Exa', provider: 'exa', type: 'api', capabilities: ['browser'], publicWebCertified: true }],
      emit: (event) => events.push(event),
    })
    const prepared = runner.prepare('workspace-1', { topic: 'native tools', planPolicy: 'auto', sourceSlugs: ['exa'] }, {
      publicWebSourcesOnly: true,
      executionContract: { maxPageReads: 5, maxTotalResearchToolCalls: 5 },
    })
    runner.begin('workspace-1', prepared.id)
    await waitFor(() => events.some((event) => event.type === 'run.completed'))
    expect(decisions).toEqual([
      { name: 'browser-batch', allowed: false },
      { name: 'WebFetch', allowed: false },
      { name: 'source-delete', allowed: false },
      { name: 'api-delete', allowed: false },
      { name: 'workspace-read', allowed: false },
      { name: 'browser-windows', allowed: false },
      { name: 'browser_tool', allowed: true },
      { name: 'browser-snapshot', allowed: true },
      { name: 'browser-find', allowed: true },
      { name: 'browser-evaluate', allowed: false },
      { name: 'browser-click', allowed: false },
    ])
    const completed = [...events].reverse().find((event) => event.type === 'run.completed')
    if (completed?.type !== 'run.completed') throw new Error('Expected completed run')
    const receipts = completed.run.steps.flatMap((step) => step.toolReceipts ?? [])
    expect(receipts.some((receipt) => receipt.toolName === 'WebFetch')).toBe(false)
    expect(receipts.find((receipt) => receipt.toolUseId === 'browser-1')).toMatchObject({
      kind: 'page-read',
      requestUrl: 'https://example.com/story?p=123',
      responseUrl: 'https://example.com/story?p=123',
      status: 'succeeded',
    })
    expect(receipts.find((receipt) => receipt.toolUseId === 'browser-snapshot')).toMatchObject({
      requestUrl: undefined,
      responseUrl: 'https://example.com/story?p=123',
    })
    expect(receipts.some((receipt) => receipt.toolUseId === 'browser-evaluate')).toBe(false)
    expect(receipts.some((receipt) => receipt.toolUseId === 'browser-click')).toBe(false)
    for (const toolUseId of ['browser-find']) {
      expect(receipts.find((receipt) => receipt.toolUseId === toolUseId)).toMatchObject({
        requestUrl: undefined,
        responseUrl: undefined,
      })
    }
  })

  test('public-web-only host runs exclude private and local workspace sources', () => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'deep-research-public-sources-'))
    const runner = new DeepResearchRunner({
      createSession: async () => ({ id: 'unused' }),
      sendMessage: async () => {},
      getLastAssistantText: () => '',
      getSessionToolUseSummary: () => ({ count: 0, names: [] }),
      abortSession: async () => {},
      getWorkspaceRootPath: () => workspaceRoot,
      resolveSourceReadiness: (_workspaceId, requested) => requested.length > 0
        ? { requested, usable: requested, missing: [], unusable: [] }
        : { requested: ['exa-public', 'drive-private', 'local-notes', 'spoofed-exa'], usable: ['exa-public', 'drive-private', 'local-notes', 'spoofed-exa'], missing: [], unusable: [] },
      resolveSourceProfiles: (_workspaceId, slugs) => {
        const profiles: DeepResearchSourceProfile[] = [
          { slug: 'exa-public', name: 'Exa', provider: 'exa', type: 'api', capabilities: ['search'], publicWebCertified: true },
          { slug: 'drive-private', name: 'Drive', provider: 'google-drive', type: 'mcp', capabilities: ['browser', 'knowledge'] },
          { slug: 'local-notes', name: 'Notes', provider: 'notes', type: 'local', capabilities: ['search', 'local'] },
          { slug: 'spoofed-exa', name: 'Exa', provider: 'exa', type: 'api', capabilities: ['search'], publicWebCertified: false },
        ]
        return profiles.filter((source) => slugs.includes(source.slug))
      },
    })

    const prepared = runner.prepare('workspace-1', { topic: 'public career research', planPolicy: 'auto' }, { publicWebSourcesOnly: true })

    expect(prepared.sourceReadiness.usable).toEqual(['exa-public'])
    expect(prepared.plan.requiredSourceSlugs).toEqual(['exa-public'])
    expect(prepared.plan.sourceProfiles.map((source) => source.slug)).toEqual(['exa-public'])
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
      getSessionToolUseSummary: () => ({ count: 1, names: ['WebFetch'] }),
      getSessionToolUseRecords: (sessionId) => sessionId === 'receipt-1' || sessionId === 'receipt-2' ? [{
        toolUseId: `page-${sessionId.at(-1)}`,
        toolName: 'WebFetch',
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

  test('does not trust response URLs claimed inside arbitrary tool output', async () => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'deep-research-spoofed-url-'))
    const events: DeepResearchRunnerEvent[] = []
    const runner = new DeepResearchRunner({
      createSession: async () => ({ id: 'spoofed-url-session' }),
      sendMessage: async () => {},
      getLastAssistantText: () => 'research complete',
      getSessionToolUseSummary: () => ({ count: 2, names: ['WebFetch', 'mcp__exa__browser_tool'] }),
      getSessionToolUseRecords: () => [
        {
          toolUseId: 'spoofed-url',
          toolName: 'WebFetch',
          toolInput: { url: 'https://untrusted.example/story' },
          toolResult: JSON.stringify({
            responseUrl: 'https://official.example/artist',
            finalUrl: 'https://official.example/artist',
            text: 'Page-controlled content',
          }),
        },
        {
          toolUseId: 'namespaced-browser-spoof',
          toolName: 'mcp__exa__browser_tool',
          toolInput: { command: 'navigate https://untrusted.example/browser-story' },
          toolResult: 'Navigated to: https://official.example/artist\nPage-controlled content',
        },
      ],
      abortSession: async () => {},
      deleteSession: async () => {},
      getWorkspaceRootPath: () => workspaceRoot,
      resolveSourceReadiness: () => ({ requested: ['exa'], usable: ['exa'], missing: [], unusable: [] }),
      resolveSourceProfiles: () => [{ slug: 'exa', name: 'Exa', provider: 'exa', type: 'api', capabilities: ['browser'] }],
      emit: (event) => events.push(event),
    })

    const prepared = runner.prepare('workspace-1', {
      topic: 'untrusted URL metadata',
      planPolicy: 'auto',
      sourceSlugs: ['exa'],
    })
    runner.begin('workspace-1', prepared.id)

    await waitFor(() => events.some((event) => event.type === 'run.completed'))
    const completed = [...events].reverse().find((event) => event.type === 'run.completed')
    if (completed?.type !== 'run.completed') throw new Error('Expected completed run')
    const receipt = completed.run.steps.flatMap((step) => step.toolReceipts ?? [])
      .find((item) => item.toolUseId === 'spoofed-url')
    expect(receipt).toMatchObject({
      requestUrl: 'https://untrusted.example/story',
      responseUrl: undefined,
    })
    const namespacedReceipt = completed.run.steps.flatMap((step) => step.toolReceipts ?? [])
      .find((item) => item.toolUseId === 'namespaced-browser-spoof')
    expect(namespacedReceipt).toMatchObject({
      requestUrl: 'https://untrusted.example/browser-story',
      responseUrl: undefined,
    })
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

  test('cancellation still fences active work when its durable write fails', async () => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'deep-research-cancel-write-failure-'))
    let releaseSend: (() => void) | undefined
    let sendStarted = false
    let aborted = 0
    const runner = new DeepResearchRunner({
      createSession: async () => ({ id: 'cancel-write-failure-session' }),
      sendMessage: async () => {
        sendStarted = true
        await new Promise<void>((resolve) => { releaseSend = resolve })
      },
      getLastAssistantText: () => 'late output',
      getSessionToolUseSummary: () => ({ count: 1, names: ['web_search'] }),
      abortSession: async () => { aborted += 1 },
      deleteSession: async () => {},
      getWorkspaceRootPath: () => workspaceRoot,
      resolveSourceReadiness: () => ({ requested: ['exa'], usable: ['exa'], missing: [], unusable: [] }),
      resolveSourceProfiles: () => [{ slug: 'exa', name: 'Exa', provider: 'exa', type: 'api', capabilities: ['search'] }],
    })
    const runId = runner.start('workspace-1', { topic: 'cancel write failure', planPolicy: 'auto', sourceSlugs: ['exa'] }).id
    await waitFor(() => sendStarted)
    ;(runner as unknown as { persist: () => void }).persist = () => { throw new Error('fixture disk failure') }

    await expect(runner.cancel('workspace-1', runId)).rejects.toThrow('fixture disk failure')
    expect(aborted).toBe(1)
    releaseSend?.()
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(readDeepResearchRun(workspaceRoot, runId)?.state).toBe('running')
    expect(readDeepResearchRun(workspaceRoot, runId)?.outputId).toBeUndefined()
  })

  test('shutdown interruption is durable before active child cleanup', async () => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'deep-research-shutdown-'))
    const events: DeepResearchRunnerEvent[] = []
    let sendStarted = false
    let aborted = 0
    const runner = new DeepResearchRunner({
      createSession: async () => ({ id: 'shutdown-session' }),
      sendMessage: async () => {
        sendStarted = true
        await new Promise<void>(() => {})
      },
      getLastAssistantText: () => '',
      getSessionToolUseSummary: () => ({ count: 0, names: [] }),
      abortSession: async () => { aborted += 1 },
      deleteSession: async () => {},
      getWorkspaceRootPath: () => workspaceRoot,
      resolveSourceReadiness: () => ({ requested: ['exa'], usable: ['exa'], missing: [], unusable: [] }),
      resolveSourceProfiles: () => [{ slug: 'exa', name: 'Exa', provider: 'exa', type: 'api', capabilities: ['search'] }],
      emit: (event) => events.push(event),
    })

    const started = runner.start('workspace-1', { topic: 'shutdown durability', planPolicy: 'auto', sourceSlugs: ['exa'] })
    await waitFor(() => sendStarted)
    const interrupted = await runner.interruptActiveRunsForShutdown('fixture shutdown')

    expect(interrupted).toHaveLength(1)
    expect(interrupted[0]?.state).toBe('interrupted')
    expect(aborted).toBe(1)
    expect(readDeepResearchRun(workspaceRoot, started.id)).toMatchObject({ state: 'interrupted', error: 'fixture shutdown' })
    const completion = [...events].reverse().find((event) => event.type === 'run.completed')
    expect(completion?.type === 'run.completed' ? completion.run.state : undefined).toBe('interrupted')
  })

  test('shutdown fences every active run when one interrupted-state write fails', async () => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'deep-research-shutdown-write-failure-'))
    let sessionCount = 0
    let startedCount = 0
    const abortedSessions: string[] = []
    const runner = new DeepResearchRunner({
      createSession: async () => ({ id: `shutdown-failure-session-${++sessionCount}` }),
      sendMessage: async () => {
        startedCount += 1
        await new Promise<void>(() => {})
      },
      getLastAssistantText: () => '',
      getSessionToolUseSummary: () => ({ count: 0, names: [] }),
      abortSession: async (sessionId) => { abortedSessions.push(sessionId) },
      deleteSession: async () => {},
      getWorkspaceRootPath: () => workspaceRoot,
      resolveSourceReadiness: () => ({ requested: ['exa'], usable: ['exa'], missing: [], unusable: [] }),
      resolveSourceProfiles: () => [{ slug: 'exa', name: 'Exa', provider: 'exa', type: 'api', capabilities: ['search'] }],
    })
    const first = runner.start('workspace-1', { topic: 'first shutdown run', planPolicy: 'auto', sourceSlugs: ['exa'] })
    const second = runner.start('workspace-1', { topic: 'second shutdown run', planPolicy: 'auto', sourceSlugs: ['exa'] })
    await waitFor(() => startedCount === 2)
    const privateRunner = runner as unknown as { persist: (run: DeepResearchRunSnapshot) => void }
    const persist = privateRunner.persist.bind(runner)
    privateRunner.persist = (run) => {
      if (run.id === first.id) throw new Error('fixture disk failure')
      persist(run)
    }

    await expect(runner.interruptActiveRunsForShutdown('fixture shutdown failure')).rejects.toThrow('1 deep research run')
    expect(abortedSessions.sort()).toEqual(['shutdown-failure-session-1', 'shutdown-failure-session-2'])
    expect(readDeepResearchRun(workspaceRoot, first.id)?.state).toBe('running')
    expect(readDeepResearchRun(workspaceRoot, second.id)?.state).toBe('interrupted')
    expect(await runner.interruptActiveRunsForShutdown()).toEqual([])
  })
})
