import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadSession } from '@craft-agent/shared/sessions'
import { SessionManager, createManagedSession } from './SessionManager.ts'

type ToolResultEvent = {
  type: 'tool_result'
  toolUseId: string
  toolName: string
  result: string
  isError?: boolean
}

describe('Claude TodoWrite session-task adapter', () => {
  let root: string
  let manager: SessionManager

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'claude-todowrite-adapter-'))
    manager = new SessionManager()
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function installSession() {
    const workspace = { id: 'ws-test', name: 'Test', rootPath: root, createdAt: 1 }
    const managed = createManagedSession(
      { id: 'session-1', name: 'Claude session', createdAt: 1 },
      workspace as never,
      { messagesLoaded: true },
    )
    ;(manager as unknown as { sessions: Map<string, unknown> }).sessions.set(managed.id, managed)
    return managed
  }

  async function project(
    managed: ReturnType<typeof installSession>,
    toolUseId: string,
    todos: unknown[],
    isError = false,
  ) {
    managed.messages.push({
      id: `message-${toolUseId}`,
      role: 'tool',
      content: '',
      timestamp: Date.now(),
      toolName: 'TodoWrite',
      toolUseId,
      toolInput: { todos },
      toolStatus: 'executing',
    })
    await (manager as unknown as {
      processEvent(session: unknown, event: ToolResultEvent): Promise<void>
    }).processEvent(managed, {
      type: 'tool_result',
      toolUseId,
      toolName: 'TodoWrite',
      result: isError ? 'Error: rejected' : 'Todos updated',
      isError,
    })
  }

  it('projects a successful TodoWrite result through the durable task barrier', async () => {
    const managed = installSession()
    await project(managed, 'todo-1', [
      { content: 'Research release timing', activeForm: 'Researching release timing', status: 'in_progress' },
      { content: 'Draft campaign brief', status: 'pending' },
    ])

    expect(managed.sessionTasks?.source).toBe('todowrite-adapter')
    expect(managed.sessionTasks?.items.map(item => item.status)).toEqual(['in_progress', 'pending'])
    expect(loadSession(root, managed.id)?.sessionTasks).toEqual(managed.sessionTasks)
    expect(loadSession(root, managed.id)?.messages.some(message => message.taskEvent?.operation === 'todowrite-project')).toBe(true)
  })

  it('preserves matching task ids and ignores duplicate terminal events', async () => {
    const managed = installSession()
    await project(managed, 'todo-1', [
      { content: 'Research release timing', status: 'pending' },
      { content: 'Draft campaign brief', status: 'pending' },
    ])
    const firstId = managed.sessionTasks?.items[0]?.id
    await project(managed, 'todo-2', [
      { content: 'Research release timing', status: 'completed' },
      { content: 'Draft campaign brief', status: 'in_progress' },
    ])
    const revision = managed.sessionTasks?.revision

    await (manager as unknown as {
      processEvent(session: unknown, event: ToolResultEvent): Promise<void>
    }).processEvent(managed, {
      type: 'tool_result',
      toolUseId: 'todo-2',
      toolName: 'TodoWrite',
      result: 'Todos updated',
    })

    expect(managed.sessionTasks?.items[0]?.id).toBe(firstId)
    expect(managed.sessionTasks?.revision).toBe(revision)
  })

  it('does not overwrite state for failed or malformed TodoWrite results', async () => {
    const managed = installSession()
    await project(managed, 'todo-failed', [{ content: 'One', status: 'pending' }], true)
    expect(managed.sessionTasks).toBeUndefined()

    await project(managed, 'todo-malformed', [
      { content: 'One', status: 'in_progress' },
      { content: 'Two', status: 'in_progress' },
    ])
    expect(managed.sessionTasks).toBeUndefined()
    expect(managed.messages.find(message => message.toolUseId === 'todo-malformed')?.toolStatus).toBe('completed')
  })
})
