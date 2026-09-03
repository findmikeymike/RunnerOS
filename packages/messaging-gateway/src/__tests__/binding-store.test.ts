/**
 * BindingStore tests
 *
 * Spec 26: a chat binds to an *agent*. `activeSessionId` is a replaceable cache.
 *
 * Covers:
 *   - bind / findByChannel / findByActiveSession / getAll roundtrip
 *   - one-channel-one-agent invariant (second bind evicts first)
 *   - authorized senders are required and fail closed
 *   - active-session cache set/clear without touching the target
 *   - malformed records are dropped on load (no legacy shape exists)
 *   - unbind counts, change listener, legacy directory migration, persistence
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { BindingStore } from '../binding-store'

let dir: string
let legacyDir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bind-'))
  legacyDir = mkdtempSync(join(tmpdir(), 'bind-legacy-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  rmSync(legacyDir, { recursive: true, force: true })
})

/** A well-formed persisted binding in the current (agent-targeted) shape. */
function storedBinding(over: Record<string, unknown> = {}) {
  return {
    id: 'b-1',
    workspaceId: 'ws1',
    platform: 'telegram',
    channelId: 'c1',
    target: { kind: 'agent', agentSlug: 'concierge', workspaceId: 'ws1' },
    authorizedSenderIds: ['sender-1'],
    enabled: true,
    createdAt: 1,
    config: {},
    ...over,
  }
}

describe('BindingStore', () => {
  it('binds a channel to an agent and finds it', () => {
    const store = new BindingStore(dir)
    const b = store.bind('ws1', 'concierge', 'telegram', 'chat-1', 'sender-1', 'Alice')

    expect(b.target).toEqual({ kind: 'agent', agentSlug: 'concierge', workspaceId: 'ws1' })
    expect(b.activeSessionId).toBeUndefined()
    expect(b.platform).toBe('telegram')
    expect(b.channelId).toBe('chat-1')
    expect(b.channelName).toBe('Alice')
    expect(b.enabled).toBe(true)

    expect(store.findByChannel('telegram', 'chat-1', 'sender-1')?.target.agentSlug).toBe('concierge')
    expect(store.findByChannel('telegram', 'unknown', 'sender-1')).toBeUndefined()
  })

  it('fails closed for unknown and missing senders', () => {
    const store = new BindingStore(dir)
    store.bind('ws1', 'concierge', 'telegram', 'chat-1', 'sender-1')

    expect(store.findByChannel('telegram', 'chat-1', 'sender-1')?.target.agentSlug).toBe('concierge')
    expect(store.findByChannel('telegram', 'chat-1', 'sender-2')).toBeUndefined()
    // No sender id at all must not fall through to "anyone may write".
    expect(store.findByChannel('telegram', 'chat-1')).toBeUndefined()
  })

  it('requires an authorized sender at bind time', () => {
    const store = new BindingStore(dir)
    expect(() => store.bind('ws1', 'concierge', 'telegram', 'chat-1', '')).toThrow()
  })

  it('evicts the prior binding when the same channel binds again', () => {
    const store = new BindingStore(dir)
    store.bind('ws1', 'agent-a', 'telegram', 'chat-1', 'sender-1')
    store.bind('ws1', 'agent-b', 'telegram', 'chat-1', 'sender-1')

    expect(store.findByChannel('telegram', 'chat-1', 'sender-1')?.target.agentSlug).toBe('agent-b')
    expect(store.getAll()).toHaveLength(1)
  })

  it('caches and clears the active session without touching the target', () => {
    const store = new BindingStore(dir)
    const b = store.bind('ws1', 'concierge', 'telegram', 'c1', 'sender-1')

    store.setActiveSession(b.id, 'sess-1')
    expect(store.findById(b.id)?.activeSessionId).toBe('sess-1')
    expect(store.findByActiveSession('sess-1')).toHaveLength(1)

    store.clearActiveSession(b.id)
    const after = store.findById(b.id)
    expect(after?.activeSessionId).toBeUndefined()
    // The counterpart is unchanged — only the cache was dropped.
    expect(after?.target.agentSlug).toBe('concierge')
    expect(store.findByActiveSession('sess-1')).toHaveLength(0)
  })

  it('persists the active session across instances', () => {
    const a = new BindingStore(dir)
    const b = a.bind('ws1', 'concierge', 'telegram', 'c1', 'sender-1')
    a.setActiveSession(b.id, 'sess-1')

    const reopened = new BindingStore(dir)
    expect(reopened.findById(b.id)?.activeSessionId).toBe('sess-1')
  })

  it('lists bindings by agent and by active session, only enabled', () => {
    const store = new BindingStore(dir)
    const one = store.bind('ws1', 'concierge', 'telegram', 'c1', 'sender-1')
    const two = store.bind('ws1', 'concierge', 'whatsapp', 'c2', 'sender-1')
    store.bind('ws1', 'other-agent', 'telegram', 'c3', 'sender-1')

    expect(store.findByAgent('concierge')).toHaveLength(2)

    store.setActiveSession(one.id, 'sess')
    store.setActiveSession(two.id, 'sess')
    const mine = store.findByActiveSession('sess')
    expect(mine).toHaveLength(2)
    expect(new Set(mine.map((b) => b.platform))).toEqual(new Set(['telegram', 'whatsapp']))
  })

  it('unbind returns true only when a row was removed', () => {
    const store = new BindingStore(dir)
    store.bind('ws1', 'concierge', 'telegram', 'c1', 'sender-1')

    expect(store.unbind('telegram', 'c1')).toBe(true)
    expect(store.unbind('telegram', 'c1')).toBe(false)
    expect(store.getAll()).toHaveLength(0)
  })

  it('unbindSession matches on the cached session, with optional platform filter', () => {
    const store = new BindingStore(dir)
    const a = store.bind('ws1', 'concierge', 'telegram', 'c1', 'sender-1')
    const b = store.bind('ws1', 'concierge', 'whatsapp', 'c2', 'sender-1')
    const c = store.bind('ws1', 'other-agent', 'telegram', 'c3', 'sender-1')
    store.setActiveSession(a.id, 'sess')
    store.setActiveSession(b.id, 'sess')
    store.setActiveSession(c.id, 'other')

    expect(store.unbindSession('sess', 'telegram')).toBe(1)
    expect(store.getAll()).toHaveLength(2)

    expect(store.unbindSession('sess')).toBe(1)
    expect(store.getAll()).toHaveLength(1)
    expect(store.getAll()[0]?.target.agentSlug).toBe('other-agent')
  })

  it('unbindById removes only the selected binding row', () => {
    const store = new BindingStore(dir)
    const a = store.bind('ws1', 'concierge', 'telegram', 'c1', 'sender-1')
    const b = store.bind('ws1', 'concierge', 'whatsapp', 'c2', 'sender-1')

    expect(store.unbindById(a.id)).toBe(true)
    expect(store.findByChannel('telegram', 'c1', 'sender-1')).toBeUndefined()
    expect(store.findByChannel('whatsapp', 'c2', 'sender-1')?.id).toBe(b.id)
    expect(store.unbindById(a.id)).toBe(false)
  })

  it('forces remote chat bindings to use desktop-only approvals', () => {
    const store = new BindingStore(dir)
    const whatsapp = store.bind('ws1', 'concierge', 'whatsapp', 'c2', 'sender-1')
    const telegram = store.bind('ws1', 'concierge', 'telegram', 'c3', 'sender-1', undefined, {
      approvalChannel: 'chat',
    })
    expect(whatsapp.config.approvalChannel).toBe('app')
    expect(telegram.config.approvalChannel).toBe('app')
  })

  it('fires change listener after mutation', () => {
    const store = new BindingStore(dir)
    let calls = 0
    store.onChange(() => calls++)

    store.bind('ws1', 'concierge', 'telegram', 'c1', 'sender-1')
    store.unbind('telegram', 'c1')

    expect(calls).toBe(2)
  })

  it('persists across instances via bindings.json', () => {
    const a = new BindingStore(dir)
    a.bind('ws1', 'concierge', 'telegram', 'c1', 'sender-1', 'name')

    const b = new BindingStore(dir)
    expect(b.findByChannel('telegram', 'c1', 'sender-1')?.channelName).toBe('name')
  })

  // --- Malformed records -----------------------------------------------------
  // There is no legacy binding shape (spec 26): the product shipped with agent
  // targets. A record without a valid target or sender is corrupt, and keeping
  // it would mean resolving a chat to the wrong counterpart.

  it('drops a record with no target', () => {
    const legacyShape = { ...storedBinding(), target: undefined, sessionId: 'sess-1' }
    writeFileSync(join(dir, 'bindings.json'), JSON.stringify([legacyShape]))

    const store = new BindingStore(dir)
    expect(store.getAll()).toEqual([])
  })

  it('drops a record whose target is not an agent target', () => {
    writeFileSync(
      join(dir, 'bindings.json'),
      JSON.stringify([storedBinding({ target: { kind: 'session', sessionId: 'sess-1' } })]),
    )

    const store = new BindingStore(dir)
    expect(store.getAll()).toEqual([])
  })

  it('drops a record with no authorized senders rather than admitting everyone', () => {
    writeFileSync(join(dir, 'bindings.json'), JSON.stringify([storedBinding({ authorizedSenderIds: [] })]))

    const store = new BindingStore(dir)
    expect(store.getAll()).toEqual([])
  })

  it('keeps well-formed records alongside dropped ones', () => {
    writeFileSync(
      join(dir, 'bindings.json'),
      JSON.stringify([
        storedBinding({ id: 'good', channelId: 'c1' }),
        storedBinding({ id: 'bad', channelId: 'c2', target: undefined }),
      ]),
    )

    const store = new BindingStore(dir)
    expect(store.getAll().map((b) => b.id)).toEqual(['good'])
  })

  it('migrates the legacy storage directory one-shot on construction', () => {
    // Directory-location migration, unrelated to binding shape.
    writeFileSync(join(legacyDir, 'bindings.json'), JSON.stringify([storedBinding({ id: 'moved-1' })]))

    const store = new BindingStore(dir, legacyDir)
    expect(store.findByChannel('telegram', 'c1', 'sender-1')?.id).toBe('moved-1')
    expect(existsSync(join(dir, 'bindings.json'))).toBe(true)
  })

  it('does not overwrite an existing file when legacy is also present', () => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'bindings.json'), JSON.stringify([storedBinding({ id: 'new-1' })]))
    writeFileSync(join(legacyDir, 'bindings.json'), JSON.stringify([storedBinding({ id: 'old-1' })]))

    const store = new BindingStore(dir, legacyDir)
    expect(store.findByChannel('telegram', 'c1', 'sender-1')?.id).toBe('new-1')
  })

  it('recovers from corrupt bindings.json as an empty store', () => {
    writeFileSync(join(dir, 'bindings.json'), 'not-json')
    const store = new BindingStore(dir)
    expect(store.getAll()).toEqual([])

    store.bind('ws1', 'concierge', 'telegram', 'c1', 'sender-1')
    expect(JSON.parse(readFileSync(join(dir, 'bindings.json'), 'utf-8'))).toHaveLength(1)
  })
})
