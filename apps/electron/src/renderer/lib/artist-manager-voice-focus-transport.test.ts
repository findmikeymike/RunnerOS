import { describe, expect, test } from 'bun:test'
import type { VoiceFocusEvent, VoiceFocusSession, VoiceFocusTurnRequest } from '../../shared/artist-manager-voice-focus'
import { createVoiceFocusTransport } from './artist-manager-voice-focus-transport'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const session: VoiceFocusSession = { sessionId: 'voice-session', model: 'pi/deepseek-v4-flash', connection: 'pi-api-key', thinking: 'low' }
const tick = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }
async function settles<T>(promise: Promise<T>) {
  let timer: ReturnType<typeof setTimeout> | undefined
  try { return await Promise.race([promise.then(value => ({ value }), error => ({ error })), new Promise<'pending'>(resolve => { timer = setTimeout(() => resolve('pending'), 150) })]) }
  finally { clearTimeout(timer) }
}
function fixture(overrides: Partial<Parameters<typeof createVoiceFocusTransport>[0]> = {}) {
  const listeners = new Set<(event: VoiceFocusEvent) => void>()
  const starts: VoiceFocusTurnRequest[] = []
  const cancellations: Array<{ sessionId: string; turnId: string }> = []
  const stops: Array<string | undefined> = []
  const pending = deferred<void>()
  const transport = createVoiceFocusTransport({
    ensureSession: async () => session,
    refreshPrompt: async () => 'Refreshed bounded snapshot',
    api: {
      register: async () => session,
      startTurn: request => { starts.push(request); return pending.promise },
      cancel: async request => { cancellations.push(request) },
      stop: async id => { stops.push(id) },
      onEvent: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
    },
    ...overrides,
  })
  const emit = (event: VoiceFocusEvent) => { for (const listener of listeners) listener(event) }
  const request = async (signal = new AbortController().signal) => (await transport.generateReply({ userText: 'Hello', contextJson: '[]', signal }))[Symbol.asyncIterator]()
  return { transport, starts, cancellations, stops, listeners, pending, emit, request }
}

describe('focused voice transport', () => {
  test('streams answer text before completion or RPC settlement and ignores unrelated and late events', async () => {
    const h = fixture(), iterator = await h.request()
    const first = iterator.next(); await tick()
    const turn = h.starts[0]!
    h.emit({ sessionId: 'different-session', turnId: turn.turnId, type: 'text_delta', delta: 'wrong session' })
    h.emit({ sessionId: session.sessionId, turnId: 'old-turn', type: 'text_delta', delta: 'wrong turn' })
    h.emit({ sessionId: session.sessionId, turnId: turn.turnId, type: 'text_delta', delta: 'Hello back.' })
    expect(await settles(first)).toEqual({ value: { value: { text: 'Hello back.' }, done: false } })
    h.emit({ sessionId: session.sessionId, turnId: turn.turnId, type: 'done' })
    h.emit({ sessionId: session.sessionId, turnId: turn.turnId, type: 'text_delta', delta: 'late discarded' })
    expect(await iterator.next()).toEqual({ value: { text: '', done: true }, done: false })
    expect((await iterator.next()).done).toBe(true)
    expect(h.starts).toHaveLength(1); expect(h.cancellations).toHaveLength(0); expect(h.listeners.size).toBe(0)
    h.pending.resolve(); await h.transport.stop()
  })

  test('consumer return interrupts a waiting read and cancels its exact turn', async () => {
    const h = fixture(), iterator = await h.request()
    const read = settles(iterator.next()); await tick()
    const closing = iterator.return!()
    expect(await read).toEqual({ error: expect.any(Error) })
    expect((await settles(closing))).not.toBe('pending')
    expect(h.cancellations).toEqual([{ sessionId: session.sessionId, turnId: h.starts[0]!.turnId }])
    expect(h.listeners.size).toBe(0)
    h.pending.resolve(); await h.transport.stop()
  })

  test('provider failure and RPC rejection never retry or fallback', async () => {
    for (const mode of ['event', 'rpc']) {
      const h = fixture(), iterator = await h.request()
      const read = settles(iterator.next()); await tick()
      if (mode === 'event') h.emit({ sessionId: session.sessionId, turnId: h.starts[0]!.turnId, type: 'error', message: 'No fallback was used' })
      else h.pending.reject(new Error('admission failed'))
      expect(await read).toEqual({ error: expect.any(Error) })
      expect(h.transport.retryEmptyResponse).toBe(false)
      expect(h.starts).toHaveLength(1); expect(h.cancellations).toHaveLength(1)
      h.pending.resolve(); await h.transport.stop()
    }
  })

  test('stop interrupts setup and cleans up a session that registers late', async () => {
    const registration = deferred<VoiceFocusSession>()
    const h = fixture({ ensureSession: () => registration.promise }), iterator = await h.request()
    const read = settles(iterator.next()); await tick()
    const stopping = h.transport.stop()
    try {
      expect(await read).toEqual({ error: expect.any(Error) })
    } finally { registration.resolve(session); await stopping; await iterator.return?.() }
    expect(h.stops.length).toBeGreaterThan(0)
    expect(h.stops.every(id => id === undefined || id === session.sessionId)).toBe(true)
    expect(h.starts).toHaveLength(0)
    await expect(h.request()).rejects.toThrow('stopped')
  })

  test('consumer return cannot hang behind a pending context refresh or dispatch after it', async () => {
    const refresh = deferred<string>()
    const h = fixture({ refreshPrompt: () => refresh.promise }), iterator = await h.request()
    const read = settles(iterator.next()); await tick()
    const closing = iterator.return!()
    try {
      expect(await read).toEqual({ error: expect.any(Error) })
      expect(await settles(closing)).not.toBe('pending')
    } finally { refresh.resolve('Late snapshot'); await closing; await h.transport.stop() }
    expect(h.starts).toHaveLength(0); expect(h.listeners.size).toBe(0)
  })

  test('an iterable consumed after stop cannot register a new session after owner cleanup', async () => {
    let registrations = 0
    const h = fixture({ ensureSession: async () => { registrations++; return session } })
    const iterator = await h.request()
    await h.transport.stop()
    expect(await settles(iterator.next())).toEqual({ error: expect.any(Error) })
    expect(registrations).toBe(0)
    expect(h.starts).toHaveLength(0)
  })
})
