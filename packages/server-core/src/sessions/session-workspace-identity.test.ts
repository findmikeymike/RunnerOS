import { afterEach, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { StoredMessage } from '@craft-agent/core/types'
import { getSessionFilePath } from '@craft-agent/shared/sessions/storage'
import { SessionManager, createManagedSession } from './SessionManager'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

test('an async send and its queued replay stay in campaign A while the artist views campaign B', async () => {
  const manager = new SessionManager()
  const host = manager as unknown as {
    sessions: Map<string, ReturnType<typeof createManagedSession>>
    getOrCreateAgent: () => Promise<never>
    persistSession: (session: ReturnType<typeof createManagedSession>) => void
    flushSession: (sessionId: string) => Promise<void>
  }
  function session(id: string) {
    const rootPath = mkdtempSync(join(tmpdir(), 'workspace-identity-'))
    roots.push(rootPath)
    const workspace = { id: `workspace-${id}`, slug: `workspace-${id}`, name: `Campaign ${id}`, rootPath, createdAt: Date.now() }
    const managed = createManagedSession({ id, name: `Session ${id}` }, workspace, { messagesLoaded: true })
    host.sessions.set(id, managed)
    return managed
  }
  const a = session('identity-a')
  const b = session('identity-b')
  host.persistSession(b)
  await host.flushSession(b.id)
  const bPath = getSessionFilePath(b.workspace.rootPath, b.id)
  const originalB = readFileSync(bPath, 'utf8')
  const entered = deferred()
  const release = deferred()
  const replayed = deferred()
  let initializations = 0
  host.getOrCreateAgent = async () => {
    initializations += 1
    if (initializations === 1) { entered.resolve(); await release.promise }
    else replayed.resolve()
    // Stop at the provider boundary: all host admission, queueing and disk
    // persistence are real; no provider or artist profile is initialized.
    throw new Error('Controlled provider boundary')
  }
  manager.setActiveViewingSession(a.id, a.workspace.id)
  const first = manager.sendMessage(a.id, 'First campaign A message').catch(() => {})
  try {
    await entered.promise
    manager.clearActiveViewingSession(a.workspace.id)
    manager.setActiveViewingSession(b.id, b.workspace.id)
    await manager.sendMessage(a.id, 'Queued campaign A correction')
    expect(a.messageQueue).toHaveLength(1)
    const queuedId = a.messageQueue[0]!.messageId
    expect(queuedId).toBeDefined()
    const aPath = getSessionFilePath(a.workspace.rootPath, a.id)
    expect(readFileSync(aPath, 'utf8')).toContain('Queued campaign A correction')
    expect(readFileSync(bPath, 'utf8')).toBe(originalB)
    release.resolve()
    await first
    await Promise.race([replayed.promise, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Queue was not replayed')), 1500))])
    await host.flushSession(a.id)
    const stored = readFileSync(aPath, 'utf8').trim().split('\n').slice(1).map(line => JSON.parse(line) as StoredMessage)
    expect(stored.filter(message => message.type === 'user').map(message => message.content)).toEqual(['First campaign A message', 'Queued campaign A correction'])
    expect(stored.filter(message => message.id === queuedId)).toHaveLength(1)
    expect(initializations).toBe(2)
    expect(a.workspace.id).toBe('workspace-identity-a')
    expect(readFileSync(bPath, 'utf8')).toBe(originalB)
    expect(existsSync(getSessionFilePath(b.workspace.rootPath, a.id))).toBe(false)
    expect(b.messages).toHaveLength(0)
  } finally {
    a.messageQueue = []
    release.resolve()
    await first
    await host.flushSession(a.id)
    await host.flushSession(b.id)
  }
})
