import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentMessageNoticeMetadata } from '@craft-agent/core/types'
import {
  createChatGoalState,
  createSessionTaskList,
  pauseChatGoalState,
  startSessionTask,
} from '@craft-agent/shared/sessions'
import { SessionManager, createManagedSession } from './SessionManager.ts'

type ToolResultEvent = {
  type: 'tool_result'
  toolUseId: string
  toolName: string
  result: string
}

describe('agent message task resolution and wake', () => {
  let root: string
  let manager: SessionManager
  let dispatched: number

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'agent-message-task-wake-'))
    manager = new SessionManager()
    dispatched = 0
    ;(manager as unknown as { dispatchChatGoalContinuation(): void }).dispatchChatGoalContinuation = () => {
      dispatched += 1
    }
  })

  afterEach(async () => {
    await new Promise<void>(resolve => setImmediate(resolve))
    await manager.flushAllSessions()
    rmSync(root, { recursive: true, force: true })
  })

  function activeTaskList() {
    const list = createSessionTaskList(
      [{ content: 'Review the campaign' }, { content: 'Publish the result' }],
      'native-tool',
      { now: '2026-08-30T12:00:00.000Z' },
    )
    return startSessionTask(list, list.items[0]!.id, '2026-08-30T12:01:00.000Z')
  }

  function installSession(options: {
    goal?: 'active' | 'waiting-external' | 'user-paused'
    tasks?: boolean
    maxRounds?: number
  } = {}) {
    const workspace = { id: 'ws-test', name: 'Test', rootPath: root, createdAt: 1 }
    let chatGoal = options.goal
      ? createChatGoalState(
          { objective: 'Finish delegated work', maxRounds: options.maxRounds },
          { id: 'goal-1', now: 100 },
        )
      : undefined
    if (chatGoal && options.goal !== 'active') {
      chatGoal = pauseChatGoalState(chatGoal, {
        code: options.goal === 'waiting-external' ? 'waiting-external' : 'user-paused',
        message: options.goal === 'waiting-external' ? 'Waiting for a specialist.' : 'Paused by user.',
      })
    }
    const managed = createManagedSession(
      {
        id: 'session-1',
        name: 'Parent',
        createdAt: 1,
        chatGoal,
        sessionTasks: options.tasks ? activeTaskList() : undefined,
      },
      workspace as never,
      { messagesLoaded: true },
    )
    ;(manager as unknown as { sessions: Map<string, unknown> }).sessions.set(managed.id, managed)
    return managed
  }

  async function recordBackgroundResult(
    managed: ReturnType<typeof installSession>,
    receiptId = 'receipt-1',
    agentSlug = 'critic',
  ) {
    managed.messages.push({
      id: `tool-${receiptId}`,
      role: 'tool',
      content: '',
      timestamp: Date.parse('2026-08-30T12:02:00.000Z'),
      toolName: 'mcp__session__message_agent',
      toolUseId: `tool-use-${receiptId}`,
      toolInput: { agentSlug },
      toolStatus: 'executing',
    })
    await (manager as unknown as {
      processEvent(session: unknown, event: ToolResultEvent): Promise<void>
    }).processEvent(managed, {
      type: 'tool_result',
      toolUseId: `tool-use-${receiptId}`,
      toolName: 'mcp__session__message_agent',
      result: [
        `Agent "${agentSlug}" started delegated task in the background.`,
        `receiptId: ${receiptId}`,
        `childSessionId: child-${receiptId}`,
        'toolUseCount: 0',
      ].join('\n'),
    })
  }

  async function deliver(
    managed: ReturnType<typeof installSession>,
    status: AgentMessageNoticeMetadata['status'],
    options: { receiptId?: string; agentSlug?: string; summary?: string } = {},
  ) {
    const receiptId = options.receiptId ?? 'receipt-1'
    await (manager as unknown as {
      deliverPassiveAgentMessage(
        session: unknown,
        message: string,
        metadata: AgentMessageNoticeMetadata,
      ): Promise<void>
    }).deliverPassiveAgentMessage(managed, `Agent notice: ${status}`, {
      receiptId,
      childSessionId: `child-${receiptId}`,
      targetAgentSlug: options.agentSlug ?? 'critic',
      status,
      summary: options.summary,
    })
  }

  const flushWake = () => new Promise<void>(resolve => setImmediate(resolve))
  async function waitFor(predicate: () => boolean): Promise<void> {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (predicate()) return
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    throw new Error('Timed out waiting for deferred task wake')
  }

  it('links the active task to a background receipt and settles success exactly once', async () => {
    const managed = installSession({ tasks: true })
    await recordBackgroundResult(managed)

    expect(managed.sessionTasks?.items[0]).toMatchObject({
      status: 'delegated',
      delegation: {
        receiptId: 'receipt-1',
        childSessionId: 'child-receipt-1',
        targetAgentSlug: 'critic',
      },
    })

    await deliver(managed, 'running')
    expect(managed.sessionTasks?.items[0]?.status).toBe('delegated')

    await deliver(managed, 'succeeded', { summary: 'Campaign reviewed.' })
    const revision = managed.sessionTasks!.revision
    await deliver(managed, 'succeeded', { summary: 'Campaign reviewed.' })

    expect(managed.sessionTasks?.items[0]).toMatchObject({
      status: 'completed',
      delegation: { outcome: 'succeeded', summary: 'Campaign reviewed.' },
    })
    expect(managed.sessionTasks?.revision).toBe(revision)
    expect(managed.messages.filter(message => (
      message.displayIntent === 'agent-message-passive'
      && message.agentMessage?.status === 'succeeded'
    ))).toHaveLength(1)
    expect(managed.messages.find(message => message.agentMessage?.status === 'succeeded')?.agentMessage?.wakeEligible).toBe(true)
  })

  it('returns failed delegated work to pending with the receipt error visible', async () => {
    const managed = installSession({ tasks: true })
    await recordBackgroundResult(managed)
    await deliver(managed, 'failed', { summary: 'provider-error: child failed' })

    expect(managed.sessionTasks?.items[0]).toMatchObject({
      status: 'pending',
      delegation: { outcome: 'failed', summary: 'provider-error: child failed' },
    })
  })

  it('bounds an oversized child summary without stranding the delegated task', async () => {
    const managed = installSession({ tasks: true })
    await recordBackgroundResult(managed)
    await deliver(managed, 'succeeded', { summary: 'x'.repeat(1_500) })

    expect(managed.sessionTasks?.items[0]?.status).toBe('completed')
    expect(managed.sessionTasks?.items[0]?.delegation?.summary).toHaveLength(1_000)
  })

  it('returns active work to pending when delegation is refused before a receipt exists', async () => {
    const managed = installSession({ tasks: true })
    managed.messages.push({
      id: 'tool-refused',
      role: 'tool',
      content: '',
      timestamp: Date.parse('2026-08-30T12:02:00.000Z'),
      toolName: 'mcp__session__message_agent',
      toolUseId: 'tool-use-refused',
      toolInput: { agentSlug: 'critic' },
      toolStatus: 'executing',
    })

    await (manager as unknown as {
      processEvent(session: unknown, event: ToolResultEvent): Promise<void>
    }).processEvent(managed, {
      type: 'tool_result',
      toolUseId: 'tool-use-refused',
      toolName: 'mcp__session__message_agent',
      result: '[ERROR] Agent "critic" delegation failed.\ndelegation-limit: limit reached',
    })

    expect(managed.sessionTasks?.items[0]?.status).toBe('pending')
  })

  it('cross-checks the target agent before settling an exact receipt', async () => {
    const managed = installSession({ tasks: true })
    await recordBackgroundResult(managed)
    await deliver(managed, 'succeeded', { agentSlug: 'different-agent' })

    expect(managed.sessionTasks?.items[0]?.status).toBe('delegated')
  })

  it('settles a task when the terminal notice wins the completion-before-start race', async () => {
    const managed = installSession({ tasks: true })
    await deliver(managed, 'succeeded', { summary: 'Fast result.' })
    await recordBackgroundResult(managed)

    expect(managed.sessionTasks?.items[0]).toMatchObject({
      status: 'completed',
      delegation: { receiptId: 'receipt-1', outcome: 'succeeded', summary: 'Fast result.' },
    })
  })

  it('auto-resumes only a Goal waiting on external work', async () => {
    const waiting = installSession({ goal: 'waiting-external' })
    await deliver(waiting, 'succeeded')
    await waitFor(() => dispatched === 1)
    expect(waiting.chatGoal?.status).toBe('active')
    expect(dispatched).toBe(1)
  })

  it('never overrides a human-paused Goal', async () => {
    const paused = installSession({ goal: 'user-paused' })
    await deliver(paused, 'succeeded')
    await flushWake()
    expect(paused.chatGoal?.status).toBe('paused')
    expect(paused.chatGoal?.stop?.code).toBe('user-paused')
    expect(dispatched).toBe(0)
  })

  it('drops wakes for archived sessions', async () => {
    const managed = installSession({ goal: 'active' })
    managed.isArchived = true
    await deliver(managed, 'succeeded')
    await flushWake()

    expect(managed.chatGoal?.status).toBe('active')
    expect(dispatched).toBe(0)
  })

  it('does not start another turn when the parent is already processing', async () => {
    const managed = installSession({ goal: 'active' })
    managed.isProcessing = true
    await deliver(managed, 'succeeded')
    await flushWake()

    expect(dispatched).toBe(0)
  })

  it('does not wake on start notices and coalesces terminal receipts', async () => {
    const managed = installSession({ goal: 'active' })
    await deliver(managed, 'running')
    await flushWake()
    expect(dispatched).toBe(0)

    await Promise.all([
      deliver(managed, 'succeeded', { receiptId: 'receipt-1' }),
      deliver(managed, 'succeeded', { receiptId: 'receipt-2' }),
    ])
    await waitFor(() => dispatched === 1)
    expect(dispatched).toBe(1)
  })

  it('keeps coalescing enabled until the asynchronous wake fully settles', async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    let runs = 0
    ;(manager as unknown as { runAgentMessageTaskWake(): Promise<void> }).runAgentMessageTaskWake = async () => {
      runs += 1
      await gate
    }
    const scheduler = manager as unknown as {
      scheduleAgentMessageTaskWake(sessionId: string, receiptId: string): void
    }

    scheduler.scheduleAgentMessageTaskWake('session-1', 'receipt-1')
    await flushWake()
    scheduler.scheduleAgentMessageTaskWake('session-1', 'receipt-2')
    expect(runs).toBe(1)

    release()
    await flushWake()
    expect(runs).toBe(1)
  })

  it('respects the Goal round cap during a receipt wake', async () => {
    const managed = installSession({ goal: 'active', maxRounds: 2 })
    managed.chatGoal = { ...managed.chatGoal!, round: 2 }
    await deliver(managed, 'succeeded')
    await waitFor(() => managed.chatGoal?.status === 'budget-limited')

    expect(dispatched).toBe(0)
    expect(managed.chatGoal?.status).toBe('budget-limited')
  })
})
