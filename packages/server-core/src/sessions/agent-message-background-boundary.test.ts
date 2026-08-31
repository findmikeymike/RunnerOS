import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentMessageNoticeMetadata } from '@craft-agent/core/types'
import { createChatGoalState, loadSession, pauseChatGoalState } from '@craft-agent/shared/sessions'
import { SessionManager, createManagedSession } from './SessionManager.ts'

type ToolResultEvent = {
  type: 'tool_result'
  toolUseId: string
  toolName: string
  result: string
  isError?: boolean
}

describe('message_agent background boundary', () => {
  let root: string
  let manager: SessionManager

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'agent-message-boundary-'))
    manager = new SessionManager()
    ;(manager as unknown as { dispatchChatGoalContinuation(): void }).dispatchChatGoalContinuation = () => {}
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function installSession(options: { pausedGoal?: boolean } = {}) {
    const workspace = { id: 'ws-test', name: 'Test', rootPath: root, createdAt: 1 }
    let chatGoal = createChatGoalState({ objective: 'Finish delegated work' }, { id: 'goal-1', now: 100 })
    if (options.pausedGoal) {
      chatGoal = pauseChatGoalState(chatGoal, {
        code: 'waiting-external',
        message: 'Waiting for delegated work.',
      })
    }
    const managed = createManagedSession(
      { id: 'session-1', name: 'Parent', createdAt: 1, chatGoal },
      workspace as never,
      { messagesLoaded: true },
    )
    ;(manager as unknown as { sessions: Map<string, unknown> }).sessions.set(managed.id, managed)
    return managed
  }

  async function recordBackgroundResult(managed: ReturnType<typeof installSession>, receiptId = 'receipt-1') {
    managed.messages.push({
      id: 'tool-1',
      role: 'tool',
      content: '',
      timestamp: 1,
      toolName: 'mcp__session__message_agent',
      toolUseId: 'tool-use-1',
      toolInput: { agentSlug: 'critic' },
      toolStatus: 'executing',
    })
    await (manager as unknown as {
      processEvent(session: unknown, event: ToolResultEvent): Promise<void>
    }).processEvent(managed, {
      type: 'tool_result',
      toolUseId: 'tool-use-1',
      toolName: 'mcp__session__message_agent',
      result: [
        'Agent "critic" started delegated task in the background.',
        `receiptId: ${receiptId}`,
        'childSessionId: child-1',
        'toolUseCount: 0',
      ].join('\n'),
    })
    return managed.messages.find(message => message.id === 'tool-1')!
  }

  async function deliver(
    managed: ReturnType<typeof installSession>,
    status: AgentMessageNoticeMetadata['status'],
    receiptId = 'receipt-1',
  ) {
    await (manager as unknown as {
      deliverPassiveAgentMessage(
        session: unknown,
        message: string,
        metadata: AgentMessageNoticeMetadata,
      ): Promise<void>
    }).deliverPassiveAgentMessage(managed, `Agent notice: ${status}`, {
      receiptId,
      childSessionId: 'child-1',
      targetAgentSlug: 'critic',
      status,
    })
  }

  it('persists a running receipt as the exact Goal boundary', async () => {
    const managed = installSession()
    const tool = await recordBackgroundResult(managed)

    expect(tool.toolStatus).toBe('backgrounded')
    expect(tool.isBackground).toBe(true)
    expect(tool.agentMessage).toEqual({
      receiptId: 'receipt-1',
      childSessionId: 'child-1',
      targetAgentSlug: 'critic',
      status: 'running',
    })
  })

  it('ignores start and unrelated notices, then clears a terminal receipt once', async () => {
    const managed = installSession()
    const tool = await recordBackgroundResult(managed)

    await deliver(managed, 'running')
    await deliver(managed, 'succeeded', 'receipt-other')
    expect(tool.toolStatus).toBe('backgrounded')

    await deliver(managed, 'succeeded')
    await deliver(managed, 'succeeded')

    expect(tool.toolStatus).toBe('completed')
    expect(tool.isError).toBe(false)
    expect(tool.agentMessage?.status).toBe('succeeded')
    expect(loadSession(root, managed.id)?.messages.find(message => message.id === tool.id)?.toolStatus).toBe('completed')
  })

  it.each(['failed', 'cancelled', 'timed-out'] as const)('maps %s receipts to an error boundary', async (status) => {
    const managed = installSession()
    const tool = await recordBackgroundResult(managed)

    await deliver(managed, status)

    expect(tool.toolStatus).toBe('error')
    expect(tool.isError).toBe(true)
    expect(tool.agentMessage?.status).toBe(status)
  })

  it('does not reopen the boundary when completion wins the startup race', async () => {
    const managed = installSession()
    await deliver(managed, 'succeeded')

    const tool = await recordBackgroundResult(managed)

    expect(tool.toolStatus).toBe('completed')
    expect(tool.agentMessage?.status).toBe('succeeded')
  })

  it('allows a waiting Goal to resume after its terminal receipt clears', async () => {
    const managed = installSession({ pausedGoal: true })
    const tool = await recordBackgroundResult(managed)
    await expect(manager.resumeChatGoal(managed.id, {
      goalId: managed.chatGoal!.id,
      revision: managed.chatGoal!.revision,
    })).rejects.toThrow('background work')

    await deliver(managed, 'succeeded')
    const resumed = await manager.resumeChatGoal(managed.id, {
      goalId: managed.chatGoal!.id,
      revision: managed.chatGoal!.revision,
    })

    expect(tool.toolStatus).toBe('completed')
    expect(resumed.status).toBe('active')
  })

  it('lets the settle path reserve after the terminal boundary is cleared', async () => {
    const managed = installSession()
    const tool = await recordBackgroundResult(managed)
    await deliver(managed, 'succeeded')

    const reservation = await (manager as unknown as {
      settleChatGoalAtIdle(
        session: unknown,
        reason: 'complete',
        didReceiveFinal: boolean,
        turn: undefined,
      ): Promise<unknown>
    }).settleChatGoalAtIdle(managed, 'complete', true, undefined)

    expect(tool.toolStatus).toBe('completed')
    expect(reservation).toBeDefined()
  })
})
