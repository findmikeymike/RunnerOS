import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionManager, createManagedSession } from './SessionManager'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'provider-recovery-')); roots.push(root)
  const manager = new SessionManager()
  const session = createManagedSession({ id: 'recovery-session' }, {
    id: 'recovery-ws', slug: 'recovery', name: 'Recovery', rootPath: root, createdAt: 1,
  }, { messagesLoaded: true })
  // Exercise real private lifecycle methods with a controlled transport boundary.
  const internal = manager as any
  internal.sessions.set(session.id, session)
  internal.sendEvent = () => {}
  internal.persistSession = () => {}
  session.isProcessing = true
  session.processingGeneration = 1
  session.lastSentMessage = 'Original request'
  session.agent = { forceAbort: () => {}, dispose: () => {} } as any
  return { manager, internal, session }
}

describe('provider recovery cancellation', () => {
  test('Stop cancels an authentication retry already scheduled for dispatch', async () => {
    const { manager, internal, session } = setup()
    let sends = 0
    manager.sendMessage = async () => { sends++ }
    expect(internal.attemptAuthRetry(session.id, session, session.workspace.id)).toBe(true)
    await manager.cancelProcessing(session.id, true)
    await new Promise<void>(resolve => setImmediate(resolve))
    session.isProcessing = false
    expect(sends).toBe(0)
  })

  test('a scheduled authentication retry cannot replace a newer request', async () => {
    const { manager, internal, session } = setup()
    let sends = 0
    manager.sendMessage = async () => { sends++ }
    internal.attemptAuthRetry(session.id, session, session.workspace.id)
    session.processingGeneration++
    const newerAgent = session.agent
    session.lastSentMessage = 'Newer request'
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(sends).toBe(0)
    expect(session.agent).toBe(newerAgent)
  })

  test('a Stop timeout cannot settle a later request generation', async () => {
    const { manager, internal, session } = setup()
    const callbacks: Array<() => void> = []
    const originalTimeout = globalThis.setTimeout
    const settled: number[] = []
    internal.onProcessingStopped = () => { settled.push(session.processingGeneration) }
    try {
      globalThis.setTimeout = ((callback: () => void) => { callbacks.push(callback); return 0 }) as any
      await manager.cancelProcessing(session.id, true)
      session.isProcessing = false; session.stopRequested = false
      session.processingGeneration++; session.isProcessing = true
      await manager.cancelProcessing(session.id, true)
      callbacks[0]!()
      expect(settled).toEqual([])
      callbacks[1]!()
      expect(settled).toEqual([2])
    } finally { globalThis.setTimeout = originalTimeout; session.isProcessing = false }
  })
  test('provider initialization failure settles an ordinary session', async () => {
    const { manager, internal, session } = setup()
    manager.setPaidExecutionAuthorizer(() => true)
    session.isProcessing = false
    internal.flushSession = async () => {}
    internal.getOrCreateAgent = async () => { throw new Error('startup failed') }
    const stopped: string[] = []
    internal.onProcessingStopped = async (_id: string, reason: string) => {
      stopped.push(reason); session.isProcessing = false
    }
    await expect(manager.sendMessage(session.id, 'Request', undefined, undefined, { hidden: true }))
      .rejects.toThrow('startup failed')
    expect(stopped).toEqual(['error'])
    expect(session.isProcessing).toBe(false)
  })

  test('Stop during initialization prevents dispatch to the ready backend', async () => {
    const { manager, internal, session } = setup()
    manager.setPaidExecutionAuthorizer(() => true)
    session.isProcessing = false
    internal.flushSession = async () => {}
    let ready!: (backend: any) => void
    let initializing!: () => void
    const started = new Promise<void>(resolve => { initializing = resolve })
    internal.getOrCreateAgent = () => {
      initializing()
      return new Promise(resolve => { ready = resolve })
    }
    let chats = 0
    internal.onProcessingStopped = async () => { session.isProcessing = false; session.stopRequested = false }
    const request = manager.sendMessage(session.id, 'Request', undefined, undefined, { hidden: true })
    await started
    await manager.cancelProcessing(session.id, true)
    ready({ chat: () => { chats++; throw new Error('must not dispatch') } })
    await request
    expect(chats).toBe(0)
    expect(session.isProcessing).toBe(false)
  })

  test('an admitted auth retry still reports its own initialization failure', async () => {
    const { manager, internal, session } = setup()
    const events: any[] = []
    internal.sendEvent = (event: any) => { events.push(event) }
    internal.onProcessingStopped = async () => { session.isProcessing = false }
    manager.sendMessage = async (...args: Parameters<SessionManager['sendMessage']>) => {
      session.processingGeneration++
      const token = args[9]!
      token.generation = session.processingGeneration
      throw new Error('retry startup failed')
    }
    internal.attemptAuthRetry(session.id, session, session.workspace.id)
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(events.some(event => event.type === 'error' && event.error.includes('Authentication failed'))).toBe(true)
    expect(session.isProcessing).toBe(false)
  })

  test('delayed settlement cannot clean up a newer turn after an await', async () => {
    const { internal, session } = setup()
    let release!: () => void
    internal.browserPaneManager = {
      clearVisualsForSession: () => new Promise<void>(resolve => { release = resolve }),
    }
    const settling = internal.onProcessingStopped(session.id, 'complete', 1)
    session.processingGeneration = 2
    session.isProcessing = true
    session.activeHumanMessageId = 'new-input'
    release()
    await settling
    expect(session.isProcessing).toBe(true)
    expect(session.activeHumanMessageId).toBe('new-input')
    expect(session.lastSettledProcessingGeneration).toBe(1)
  })

})
