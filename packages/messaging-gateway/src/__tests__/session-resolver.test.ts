/**
 * SessionResolver tests — the core of spec 26.
 *
 * The point of the feature: a chat thread survives its session ending. These
 * tests exercise the cache-vs-identity distinction directly.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { BindingStore } from '../binding-store'
import { MESSAGING_SESSION_LABEL, SessionResolver } from '../session-resolver'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'resolver-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

interface FakeSession {
  id: string
  workspaceId: string
  isArchived?: boolean
  spawnedFromAgent?: { agentSlug: string; agentName: string; timestamp: number }
}

/** Minimal ISessionManager surface the resolver actually uses. */
function fakeSessionManager(seed: FakeSession[] = []) {
  const sessions = new Map(seed.map((s) => [s.id, s]))
  let counter = 0
  const calls = { resolveAgentSessionOptions: 0, createSession: 0 }
  return {
    calls,
    sessions,
    resolveAgentSessionOptions: async (workspaceId: string, agentSlug: string) => {
      calls.resolveAgentSessionOptions += 1
      if (agentSlug === 'missing-agent') throw new Error(`No agent: ${agentSlug}`)
      return {
        spawnedFromAgent: { agentSlug, agentName: `Agent ${agentSlug}`, timestamp: 1 },
        labels: ['preset'],
      }
    },
    createSession: async (workspaceId: string, options: any) => {
      calls.createSession += 1
      const session: FakeSession = {
        id: `sess-${++counter}`,
        workspaceId,
        spawnedFromAgent: options.spawnedFromAgent,
      }
      sessions.set(session.id, session)
      ;(session as any).options = options
      return session
    },
    getSession: async (id: string) => sessions.get(id) ?? null,
  }
}

function makeBinding(store: BindingStore, agentSlug = 'concierge') {
  return store.bind('ws1', agentSlug, 'telegram', 'chat-1', 'sender-1')
}

describe('SessionResolver', () => {
  it('creates a session for the bound agent and caches it', async () => {
    const store = new BindingStore(dir)
    const sm = fakeSessionManager()
    const resolver = new SessionResolver(sm as any, store)
    const binding = makeBinding(store)

    const result = await resolver.resolve(binding)

    expect(result.created).toBe(true)
    const created = sm.sessions.get(result.sessionId)!
    expect(created.spawnedFromAgent?.agentSlug).toBe('concierge')
    // Persisted before dispatch so a crash cannot orphan the session.
    expect(store.findById(binding.id)?.activeSessionId).toBe(result.sessionId)
    expect((created as any).options.labels).toContain(MESSAGING_SESSION_LABEL)
    expect((created as any).options.labels).toContain('preset')
  })

  it('reuses the cached session on the next message', async () => {
    const store = new BindingStore(dir)
    const sm = fakeSessionManager()
    const resolver = new SessionResolver(sm as any, store)
    const binding = makeBinding(store)

    const first = await resolver.resolve(binding)
    const second = await resolver.resolve(store.findById(binding.id)!)

    expect(second.sessionId).toBe(first.sessionId)
    expect(second.created).toBe(false)
    expect(sm.calls.createSession).toBe(1)
  })

  it('serializes concurrent resolution so two messages do not create two sessions', async () => {
    const store = new BindingStore(dir)
    const sm = fakeSessionManager()
    const resolver = new SessionResolver(sm as any, store)
    const binding = makeBinding(store)

    const [a, b] = await Promise.all([resolver.resolve(binding), resolver.resolve(binding)])

    expect(a.sessionId).toBe(b.sessionId)
    expect(sm.calls.createSession).toBe(1)
  })

  // --- Staleness: the whole point is that identity outlives the cache --------

  it('creates a fresh session when the cached one no longer exists', async () => {
    const store = new BindingStore(dir)
    const sm = fakeSessionManager()
    const resolver = new SessionResolver(sm as any, store)
    const binding = makeBinding(store)

    const first = await resolver.resolve(binding)
    sm.sessions.delete(first.sessionId) // session ended

    const second = await resolver.resolve(store.findById(binding.id)!)

    expect(second.created).toBe(true)
    expect(second.sessionId).not.toBe(first.sessionId)
    expect(store.findById(binding.id)?.activeSessionId).toBe(second.sessionId)
    // The counterpart never changed.
    expect(store.findById(binding.id)?.target.agentSlug).toBe('concierge')
  })

  it('discards an archived cached session', async () => {
    const store = new BindingStore(dir)
    const sm = fakeSessionManager()
    const resolver = new SessionResolver(sm as any, store)
    const binding = makeBinding(store)

    const first = await resolver.resolve(binding)
    sm.sessions.get(first.sessionId)!.isArchived = true

    const second = await resolver.resolve(store.findById(binding.id)!)
    expect(second.sessionId).not.toBe(first.sessionId)
  })

  it('discards a cached session that now belongs to a different agent', async () => {
    const store = new BindingStore(dir)
    const sm = fakeSessionManager()
    const resolver = new SessionResolver(sm as any, store)
    const binding = makeBinding(store)

    const first = await resolver.resolve(binding)
    // Repurposed: same session id, different counterpart.
    sm.sessions.get(first.sessionId)!.spawnedFromAgent = {
      agentSlug: 'someone-else',
      agentName: 'Someone Else',
      timestamp: 1,
    }

    const second = await resolver.resolve(store.findById(binding.id)!)
    expect(second.created).toBe(true)
    expect(second.sessionId).not.toBe(first.sessionId)
  })

  it('discards a cached session from another workspace', async () => {
    const store = new BindingStore(dir)
    const sm = fakeSessionManager()
    const resolver = new SessionResolver(sm as any, store)
    const binding = makeBinding(store)

    const first = await resolver.resolve(binding)
    sm.sessions.get(first.sessionId)!.workspaceId = 'other-ws'

    const second = await resolver.resolve(store.findById(binding.id)!)
    expect(second.sessionId).not.toBe(first.sessionId)
  })

  it('surfaces an unresolvable agent instead of falling back to a generic session', async () => {
    const store = new BindingStore(dir)
    const sm = fakeSessionManager()
    const resolver = new SessionResolver(sm as any, store)
    const binding = makeBinding(store, 'missing-agent')

    await expect(resolver.resolve(binding)).rejects.toThrow(/missing-agent/)
    expect(sm.calls.createSession).toBe(0)
    expect(store.findById(binding.id)?.activeSessionId).toBeUndefined()
  })

  it('recovers after a failed resolution rather than deadlocking the binding', async () => {
    const store = new BindingStore(dir)
    const sm = fakeSessionManager()
    const resolver = new SessionResolver(sm as any, store)
    const binding = makeBinding(store, 'missing-agent')

    await expect(resolver.resolve(binding)).rejects.toThrow()
    // The in-flight entry must be cleared, or every later message would reject.
    await expect(resolver.resolve(binding)).rejects.toThrow()
    expect(sm.calls.resolveAgentSessionOptions).toBe(2)
  })
})
