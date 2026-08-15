import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { SessionManager, createManagedSession } from './SessionManager.ts'

type TaskCompletedEvent = {
  type: 'task_completed'
  taskId: string
  status: 'completed' | 'failed' | 'stopped'
  outputFile?: string
  summary?: string
}

describe('idle background task completion surfacing', () => {
  let tmpRoot: string
  let manager: SessionManager

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'artist-os-bg-surface-'))
    manager = new SessionManager()
  })

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  function buildSession(sessionId: string, options: { keepAlive: boolean; processing: boolean }) {
    const workspace = {
      id: 'ws-test',
      name: 'Test Workspace',
      rootPath: tmpRoot,
      createdAt: Date.now(),
    }
    const managed = createManagedSession(
      { id: sessionId, name: 'background surface test' },
      workspace as never,
      { messagesLoaded: true },
    )
    managed.isProcessing = options.processing
    ;(manager as unknown as { sessions: Map<string, unknown> }).sessions.set(sessionId, managed)
    ;(manager as unknown as { keepBackgroundTasksAlive: boolean }).keepBackgroundTasksAlive = options.keepAlive
    return managed
  }

  function spyOnSendMessage() {
    const calls: Array<{ message: string; hidden?: boolean }> = []
    ;(manager as unknown as {
      sendMessage: (
        sessionId: string,
        message: string,
        attachments?: unknown,
        storedAttachments?: unknown,
        options?: { hidden?: boolean },
      ) => Promise<void>
    }).sendMessage = async (_sessionId, message, _attachments, _storedAttachments, options) => {
      calls.push({ message, hidden: options?.hidden })
    }
    return calls
  }

  async function complete(managed: unknown, event: TaskCompletedEvent) {
    await (manager as unknown as {
      processEvent: (session: unknown, taskEvent: TaskCompletedEvent) => Promise<void>
    }).processEvent(managed, event)
  }

  it('wakes an idle keep-alive session with a hidden checked-result prompt', async () => {
    const managed = buildSession('idle', { keepAlive: true, processing: false })
    const calls = spyOnSendMessage()

    await complete(managed, {
      type: 'task_completed',
      taskId: 'task-1',
      status: 'completed',
      outputFile: '/tmp/task-1.output',
      summary: 'Research complete',
    })

    expect(calls).toHaveLength(1)
    expect(calls[0]?.message).toContain('Review the result')
    expect(calls[0]?.message).toContain('/tmp/task-1.output')
    expect(calls[0]?.message).toContain('Do not spawn another background task')
    expect(calls[0]?.hidden).toBe(true)
  })

  it('does not wake while a turn is active or keep-alive is disabled', async () => {
    const active = buildSession('active', { keepAlive: true, processing: true })
    const disabled = buildSession('disabled', { keepAlive: false, processing: false })
    const calls = spyOnSendMessage()

    await complete(active, { type: 'task_completed', taskId: 'task-2', status: 'completed' })
    await complete(disabled, { type: 'task_completed', taskId: 'task-3', status: 'completed' })

    expect(calls).toEqual([])
  })

  it('surfaces a terminal notification at most once', async () => {
    const managed = buildSession('duplicate', { keepAlive: true, processing: false })
    const calls = spyOnSendMessage()
    const event: TaskCompletedEvent = {
      type: 'task_completed',
      taskId: 'task-4',
      status: 'completed',
    }

    await complete(managed, event)
    await complete(managed, event)

    expect(calls).toHaveLength(1)
  })
})
