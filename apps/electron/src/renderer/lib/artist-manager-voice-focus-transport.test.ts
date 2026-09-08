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


test('completion metadata is not EOF and a length error remains a failure', async () => {
  const timing: unknown[] = []
  const h = fixture({ onTiming: (stage, details) => timing.push({ stage, details }) }), iterator = await h.request()
  const first = iterator.next(); await tick()
  const ids = { sessionId: session.sessionId, turnId: h.starts[0]!.turnId }
  h.emit({ ...ids, type: 'text_delta', delta: 'An idea. Can' })
  await first
  h.emit({ ...ids, type: 'completion', finishReason: 'length', outputTokens: 512 })
  h.emit({ ...ids, type: 'error', message: 'The voice reply was cut short.' })
  await expect(iterator.next()).rejects.toThrow('cut short')
  expect(timing).toContainEqual({ stage: 'manager-complete', details: { finishReason: 'length', outputTokens: 512, reasoningTokens: undefined } })
  expect(timing.some(item => (item as { stage: string }).stage === 'answer-delivered')).toBe(false)
  h.pending.resolve(); await h.transport.stop()
})

test('handoff notification is scoped to this turn and does not end acknowledgement speech', async () => {
  const handoffs: unknown[] = []
  const h = fixture({ onHandoffReady: proposal => handoffs.push(proposal) }), iterator = await h.request()
  const first = iterator.next(); await tick()
  const ids = { sessionId: session.sessionId, turnId: h.starts[0]!.turnId }
  const proposal = { id: 'offer', agentSlug: 'concierge', agentName: 'Artist Manager', taskTitle: 'Release plan', brief: 'Review the agreed release plan.' }
  h.emit({ ...ids, turnId: 'stale', type: 'handoff_ready', proposal })
  expect(handoffs).toEqual([])
  h.emit({ ...ids, type: 'handoff_ready', proposal })
  h.emit({ ...ids, type: 'text_delta', delta: "I'll open Command." })
  expect(await first).toEqual({ value: { text: "I'll open Command." }, done: false })
  expect(handoffs).toEqual([proposal])
  h.emit({ ...ids, type: 'done' })
  expect(await iterator.next()).toEqual({ value: { text: '', done: true }, done: false })
  await iterator.next()
  h.pending.resolve(); await h.transport.stop()
})


describe('focused voice preparation', () => {
  test('prepares eagerly without generating or refreshing, deduplicates registration and reuses it on the first turn', async () => {
    const registration = deferred<VoiceFocusSession>()
    let registrations = 0
    let refreshes = 0
    const h = fixture({
      ensureSession: () => { registrations++; return registration.promise },
      refreshPrompt: async () => { refreshes++; return 'Current snapshot' },
    })
    const firstPrepare = h.transport.prepare()
    const secondPrepare = h.transport.prepare()
    expect(registrations).toBe(1)
    expect(h.starts).toHaveLength(0)
    expect(h.listeners.size).toBe(0)
    expect(refreshes).toBe(0)
    registration.resolve(session)
    await Promise.all([firstPrepare, secondPrepare])
    await h.transport.prepare()
    expect(registrations).toBe(1)
    const iterator = await h.request()
    const next = iterator.next(); await tick()
    expect(registrations).toBe(1)
    expect(refreshes).toBe(1)
    expect(h.starts).toHaveLength(1)
    const ids = { sessionId: session.sessionId, turnId: h.starts[0]!.turnId }
    h.emit({ ...ids, type: 'text_delta', delta: 'Ready.' })
    expect(await next).toEqual({ value: { text: 'Ready.' }, done: false })
    h.emit({ ...ids, type: 'done' })
    await iterator.next(); await iterator.next()
    h.pending.resolve(); await h.transport.stop()
  })

  test('stop settles all waiting prepares and cancels pending registration without waiting for it', async () => {
    const registration = deferred<VoiceFocusSession>()
    let registrations = 0
    const h = fixture({ ensureSession: () => { registrations++; return registration.promise } })
    const first = settles(h.transport.prepare())
    const second = settles(h.transport.prepare())
    await h.transport.stop()
    expect(await first).toEqual({ error: expect.any(Error) })
    expect(await second).toEqual({ error: expect.any(Error) })
    expect(h.stops).toEqual([undefined])
    registration.resolve(session); await tick()
    await expect(h.transport.prepare()).rejects.toThrow('stopped')
    await expect(h.request()).rejects.toThrow('stopped')
    expect(registrations).toBe(1)
    expect(h.starts).toHaveLength(0)
  })

  test('preparation failures are delivered to every caller and first-turn reuse without another registration', async () => {
    const registration = deferred<VoiceFocusSession>()
    let registrations = 0
    const h = fixture({ ensureSession: () => { registrations++; return registration.promise } })
    const first = settles(h.transport.prepare())
    const second = settles(h.transport.prepare())
    registration.reject(new Error('Selected voice connection was deleted'))
    expect(await first).toEqual({ error: expect.any(Error) })
    expect(await second).toEqual({ error: expect.any(Error) })
    const iterator = await h.request()
    await expect(iterator.next()).rejects.toThrow('connection was deleted')
    expect(registrations).toBe(1)
    expect(h.starts).toHaveLength(0)
    await h.transport.stop()
  })

  test('a late registration rejection after stop is observed and cannot start a turn', async () => {
    const registration = deferred<VoiceFocusSession>()
    const h = fixture({ ensureSession: () => registration.promise })
    const pending = settles(h.transport.prepare())
    await h.transport.stop()
    expect(await pending).toEqual({ error: expect.any(Error) })
    registration.reject(new Error('Late cancelled registration'))
    await tick()
    expect(h.starts).toHaveLength(0)
    expect(h.listeners.size).toBe(0)
  })
})


for (const outcome of ['success', 'failure'] as const) {
  test(`repeated stop shares one immediate IPC request and its ${outcome}`, async () => {
    const gate = deferred<void>()
    let stops = 0
    const h = fixture({ api: {
      register: async () => session,
      startTurn: async () => {},
      cancel: async () => {},
      stop: () => { stops++; return gate.promise },
      onEvent: () => () => {},
    } })
    const first = h.transport.stop()
    const result = first.then(() => undefined, error => error)
    expect(stops).toBe(1)
    expect(h.transport.stop()).toBe(first)
    await expect(h.transport.prepare()).rejects.toThrow('stopped')
    const failure = new Error('Shutdown could not be confirmed')
    if (outcome === 'failure') gate.reject(failure)
    else gate.resolve()
    expect(await result).toBe(outcome === 'failure' ? failure : undefined)
    expect(h.transport.stop()).toBe(first)
    expect(stops).toBe(1)
  })
}

describe('automatic opening turn', () => {
  test('uses the existing speech input once, hides its internal cue, and skips a context refresh', async () => {
    const userTexts: string[] = []
    let refreshed = 0
    const h = fixture({ onUserText: text => userTexts.push(text), refreshPrompt: async () => { refreshed++; return 'context' } })
    let submissions = 0
    const greet = () => h.transport.greet(async text => {
      submissions++
      expect(h.transport.isOpeningTranscript(text)).toBe(true)
      const stream = await h.transport.generateReply({ userText: text, contextJson: '[]', signal: new AbortController().signal })
      const iterator = stream[Symbol.asyncIterator]()
      const first = iterator.next(); await tick()
      const turn = h.starts[0]!
      expect(turn.opening).toBe(true)
      expect(turn.text).toBe('Call opened')
      h.emit({ sessionId: session.sessionId, turnId: turn.turnId, type: 'text_delta', delta: 'Yo, Nova!' })
      expect((await first).value).toEqual({ text: 'Yo, Nova!' })
      h.emit({ sessionId: session.sessionId, turnId: turn.turnId, type: 'done' })
      await iterator.next(); await iterator.next()
    })
    await Promise.all([greet(), greet()])
    expect(submissions).toBe(1)
    expect(refreshed).toBe(0)
    expect(userTexts).toEqual([])
    h.pending.resolve(); await h.transport.stop()
    await greet()
    expect(submissions).toBe(1)
  })

  test('does not greet over a user who has already started a turn', async () => {
    const h = fixture()
    const iterator = await h.request()
    let submissions = 0
    await h.transport.greet(async () => { submissions++ })
    expect(submissions).toBe(0)
    await iterator.return?.(); await h.transport.stop()
  })
})
