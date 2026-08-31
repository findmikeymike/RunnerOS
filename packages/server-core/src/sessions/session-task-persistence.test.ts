import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createSessionTaskList,
  getSessionFilePath,
  loadSession,
  saveSession,
  startSessionTask,
  type StoredSession,
} from '@craft-agent/shared/sessions'
import { SessionManager, createManagedSession } from './SessionManager.ts'

const NOW = '2026-08-30T12:00:00.000Z'

describe('SessionManager task-list persistence', () => {
  let root: string
  let manager: SessionManager
  const workspace = () => ({ id: 'ws-task', name: 'Task test', rootPath: root, createdAt: 1 })

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'session-task-persistence-'))
    manager = new SessionManager()
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function installSession() {
    const managed = createManagedSession({
      id: 'session-1',
      name: 'Task persistence test',
      createdAt: 1,
    }, workspace() as never, { messagesLoaded: true })
    ;(manager as unknown as { sessions: Map<string, unknown> }).sessions.set(managed.id, managed)
    return managed
  }

  it('flushes before exposing a committed task list', async () => {
    const managed = installSession()
    const next = createSessionTaskList(
      [{ content: 'Persist before render' }],
      'native-tool',
      { id: 'tasks_barrier', taskIds: ['task_barrier'], now: NOW },
    )
    let persistedAtEvent = false
    manager.setEventSink((_channel, _target, event) => {
      if (event.type === 'session_tasks_changed' && !event.degraded) {
        persistedAtEvent = loadSession(root, managed.id)?.sessionTasks?.id === next.id
      }
    })

    await (manager as unknown as {
      commitSessionTaskState(session: typeof managed, state: typeof next, operation: string): Promise<unknown>
    }).commitSessionTaskState(managed, next, 'create')

    expect(persistedAtEvent).toBe(true)
    expect(loadSession(root, managed.id)?.messages.at(-1)?.taskEvent?.snapshot).toEqual(next)
  })

  it('rolls back a failed advisory write and leaves the session usable', async () => {
    const managed = installSession()
    const next = createSessionTaskList(
      [{ content: 'Cannot persist' }],
      'native-tool',
      { id: 'tasks_failure', taskIds: ['task_failure'], now: NOW },
    )
    const events: Array<{ type: string; degraded?: boolean }> = []
    manager.setEventSink((_channel, _target, event) => events.push(event))
    ;(manager as unknown as { persistSession(session: typeof managed): void }).persistSession = () => {}
    ;(manager as unknown as { flushSession(id: string): Promise<void> }).flushSession = async () => {
      throw new Error('disk unavailable')
    }

    await expect((manager as unknown as {
      commitSessionTaskState(session: typeof managed, state: typeof next, operation: string): Promise<unknown>
    }).commitSessionTaskState(managed, next, 'create')).rejects.toThrow('chat remains available')

    expect(managed.sessionTasks).toBeUndefined()
    expect(managed.sessionTasksDegraded).toBe(true)
    expect(managed.isProcessing).toBe(false)
    expect(managed.messages.some(message => message.taskEvent)).toBe(false)
    expect(events).toContainEqual(expect.objectContaining({ type: 'session_tasks_changed', degraded: true }))
  })

  it('durably demotes in-progress work before exposing restored sessions', async () => {
    const list = startSessionTask(createSessionTaskList(
      [{ content: 'Interrupted work' }],
      'native-tool',
      { id: 'tasks_restart', taskIds: ['task_restart'], now: NOW },
    ), 'task_restart', '2026-08-30T12:01:00.000Z')
    const stored: StoredSession = {
      id: 'session-restart',
      workspaceRootPath: root,
      createdAt: 1,
      lastUsedAt: 1,
      sessionTasks: list,
      messages: [],
      tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 },
    }
    await saveSession(stored)

    await (manager as unknown as {
      loadSessionsFromDisk(workspaces: ReturnType<typeof workspace>[]): Promise<void>
    }).loadSessionsFromDisk([workspace()])

    const restored = await manager.getSession('session-restart')
    expect(restored?.sessionTasks?.items[0]?.status).toBe('pending')
    expect(loadSession(root, 'session-restart')?.messages.at(-1)?.taskEvent?.type).toBe('restart-recovered')
  })

  it('demotes event-log fallback work when the task header is damaged', async () => {
    const list = startSessionTask(createSessionTaskList(
      [{ content: 'Recover from event' }],
      'native-tool',
      { id: 'tasks_event_restart', taskIds: ['task_event_restart'], now: NOW },
    ), 'task_event_restart', '2026-08-30T12:01:00.000Z')
    const stored: StoredSession = {
      id: 'session-event-restart',
      workspaceRootPath: root,
      createdAt: 1,
      lastUsedAt: 1,
      sessionTasks: list,
      messages: [{
        id: 'task-event-active',
        type: 'info',
        content: 'Task list updated.',
        displayIntent: 'task-event',
        taskEvent: {
          type: 'updated',
          listId: list.id,
          revision: list.revision,
          timestamp: Date.parse(NOW),
          operation: 'start',
          snapshot: list,
        },
      }],
      tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 },
    }
    await saveSession(stored)
    const file = getSessionFilePath(root, stored.id)
    const lines = readFileSync(file, 'utf8').trimEnd().split('\n')
    const header = JSON.parse(lines[0]!)
    header.sessionTasks = { schemaVersion: 1, id: 'damaged' }
    lines[0] = JSON.stringify(header)
    writeFileSync(file, `${lines.join('\n')}\n`)

    await (manager as unknown as {
      loadSessionsFromDisk(workspaces: ReturnType<typeof workspace>[]): Promise<void>
    }).loadSessionsFromDisk([workspace()])

    const restored = await manager.getSession(stored.id)
    expect(restored?.sessionTasks?.items[0]?.status).toBe('pending')
    expect(loadSession(root, stored.id)?.sessionTasks?.items[0]?.status).toBe('pending')
  })
})
