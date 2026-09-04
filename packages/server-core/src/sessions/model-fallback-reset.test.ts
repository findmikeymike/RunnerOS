import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadSession, sessionPersistenceQueue } from '@craft-agent/shared/sessions'
import { SessionManager, createManagedSession } from './SessionManager.ts'

describe('model fallback transcript reset', () => {
  let root: string
  let manager: SessionManager

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'model-fallback-reset-'))
    manager = new SessionManager()
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('retracts only failed assistant text and preserves tool receipts', async () => {
    const workspace = { id: 'ws-test', name: 'Test', rootPath: root, createdAt: 1 }
    const managed = createManagedSession(
      { id: 'session-1', name: 'Fallback session', createdAt: 1 },
      workspace as never,
      { messagesLoaded: true },
    )
    managed.messages.push(
      { id: 'user-1', role: 'user', content: 'Earlier question', timestamp: 1 },
      { id: 'answer-1', role: 'assistant', content: 'Earlier answer', timestamp: 2, turnId: 'prior-turn' },
      { id: 'failed-1', role: 'assistant', content: 'Starting work', timestamp: 3, turnId: 'failed-turn' },
      {
        id: 'tool-1',
        role: 'tool',
        content: '',
        timestamp: 4,
        toolName: 'Write',
        toolUseId: 'write-1',
        toolResult: 'saved',
        toolStatus: 'completed',
      },
    )
    managed.streamingText = 'unfinished text'
    managed.lastFinalMessageId = 'failed-1'
    managed.lastMessageRole = 'assistant'
    ;(manager as unknown as { sessions: Map<string, unknown> }).sessions.set(managed.id, managed)

    const emitted: unknown[] = []
    ;(manager as unknown as { sendEvent: (event: unknown) => void }).sendEvent = (event) => {
      emitted.push(event)
    }

    await (manager as unknown as {
      processEvent: (session: unknown, event: {
        type: 'model_attempt_reset'
        completedTextCount: number
        turnIds: string[]
      }) => Promise<void>
    }).processEvent(managed, {
      type: 'model_attempt_reset',
      completedTextCount: 1,
      turnIds: ['failed-turn'],
    })

    expect(managed.messages.map(message => message.id)).toEqual(['user-1', 'answer-1', 'tool-1'])
    expect(managed.streamingText).toBe('')
    expect(managed.lastFinalMessageId).toBe('answer-1')
    expect(String(managed.lastMessageRole)).toBe('tool')
    expect(emitted).toContainEqual({
      type: 'model_attempt_reset',
      sessionId: 'session-1',
      messageIds: ['failed-1'],
      turnIds: ['failed-turn'],
    })
    await sessionPersistenceQueue.flush(managed.id)
    expect(loadSession(root, managed.id)?.messages.map(message => message.id)).toEqual([
      'user-1',
      'answer-1',
      'tool-1',
    ])
  })
})
