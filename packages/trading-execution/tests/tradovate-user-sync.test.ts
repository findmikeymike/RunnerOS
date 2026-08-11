import { describe, expect, test } from 'bun:test'

import {
  TRADOVATE_USER_SYNC_ENTITY_TYPES,
  TRADOVATE_USER_SYNC_URL,
  TradovateUserSyncClient,
  type TradovateUserSyncSocket,
} from '../src/adapters/tradovate-user-sync.ts'
import type { TradingConnection } from '@trade-god/contracts'

const NOW = '2026-08-11T15:00:00.000Z'

const connection: TradingConnection = {
  connection_schema_version: 'trading-connection@1',
  connection_id: 'connection-tradovate-paper-12345',
  display_name: 'Tradovate Paper',
  firm: { slug: 'tradovate', name: 'Tradovate' },
  platform: { slug: 'tradovate', name: 'Tradovate' },
  environment: 'paper',
  environment_class: 'rehearsal',
  transport_preference: 'api',
  account_ref: '12345',
  account_display: { label: 'SIM-12345' },
  credential_ref: 'trading-connection:connection-tradovate-paper-12345',
  risk_policy_ref: 'risk-paper',
  authorization_basis_ref: 'operator',
  approval_policy_ref: 'per-order',
  state: 'auth-required',
  capabilities: {
    read_accounts: true,
    read_orders: true,
    read_positions: true,
    read_executions: true,
    submit_market: true,
    submit_limit: true,
    submit_stop: true,
    submit_stop_limit: true,
    native_bracket: true,
    native_oco: true,
    native_multi_bracket: false,
    cancel_order: true,
    modify_order: true,
    partial_close: false,
    flatten: true,
    streaming_events: true,
  },
  certifications: [],
  enabled: false,
  created_at: NOW,
  updated_at: NOW,
}

class FakeSocket implements TradovateUserSyncSocket {
  readonly sent: string[] = []
  readonly closed: Array<{ code?: number; reason?: string }> = []
  private readonly listeners = new Map<string, Array<(...values: unknown[]) => void>>()

  on(event: 'open' | 'message' | 'close' | 'error', listener: (...values: never[]) => void): unknown {
    const current = this.listeners.get(event) ?? []
    current.push(listener as (...values: unknown[]) => void)
    this.listeners.set(event, current)
    return this
  }

  send(data: string): void { this.sent.push(data) }

  close(code?: number, reason?: string): void { this.closed.push({ code, reason }) }

  emit(event: 'open' | 'message' | 'close' | 'error', value?: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) listener(value)
  }
}

const settle = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

describe('Tradovate user-sync hint client', () => {
  test('authenticates, subscribes once, heartbeats, and treats duplicate hints idempotently', async () => {
    const socket = new FakeSocket()
    const hints: unknown[] = []
    const gaps: unknown[] = []
    const timers: Array<{ callback: () => void; delay: number }> = []
    const client = new TradovateUserSyncClient({
      connection,
      sessionManager: {
        credential: async () => ({
          access_token: 'demo-token-1234567890',
          account_id: 12345,
          account_spec: 'SIM-12345',
          expires_at: '2026-08-11T16:00:00.000Z',
        }),
      },
      socketFactory: (url) => {
        expect(url).toBe(TRADOVATE_USER_SYNC_URL)
        return socket
      },
      onHint: (hint) => { hints.push(hint) },
      onGap: (gap) => { gaps.push(gap) },
      now: () => NOW,
      heartbeatMs: 250,
      silenceTimeoutMs: 1_000,
      setTimer: (callback, delay) => {
        timers.push({ callback, delay })
        return timers.length as unknown as ReturnType<typeof setTimeout>
      },
      clearTimer: () => undefined,
    })

    await client.start()
    socket.emit('open')
    expect(socket.sent).toEqual(['authorize\n0\n\ndemo-token-1234567890'])
    socket.emit('message', 'o')
    socket.emit('message', 'h')
    expect(socket.sent.at(-1)).toBe('[]')

    socket.emit('message', 'a[{"i":0,"s":200}]')
    expect(socket.sent).toHaveLength(3)
    const syncRequest = socket.sent.find((message) => message.startsWith('user/syncrequest'))!
    const syncBody = JSON.parse(syncRequest.split('\n').slice(3).join('\n')) as {
      entityTypes: string[]
      accounts: number[]
    }
    expect(syncBody.entityTypes).toEqual([...TRADOVATE_USER_SYNC_ENTITY_TYPES])
    expect(syncBody.accounts).toEqual([12345])

    socket.emit('message', 'a[{"i":1,"s":200}]')
    const event = 'a[{"e":"props","d":{"entityType":"order","eventType":"Updated","entity":{"id":7,"accountId":12345,"ordStatus":"Working"}}}]'
    socket.emit('message', event)
    socket.emit('message', event)
    socket.emit('message', 'a[{"e":"props","d":{"entityType":"fill","eventType":"Created","entity":[{"id":8,"accountId":12345},{"id":9,"accountId":12345}]}}]')
    await settle()
    expect(hints).toHaveLength(4)
    expect((hints[1] as { entity_type: string }).entity_type).toBe('order')
    expect(gaps).toEqual([])

    const heartbeat = timers.find((timer) => timer.delay === 250)
    expect(heartbeat).toBeDefined()
    heartbeat!.callback()
    expect(socket.sent.at(-1)).toBe('[]')
    client.stop()
  })

  test('fails closed on a server close frame', async () => {
    const socket = new FakeSocket()
    const gaps: Array<{ reason: string }> = []
    const client = new TradovateUserSyncClient({
      connection,
      sessionManager: {
        credential: async () => ({
          access_token: 'demo-token-1234567890',
          account_id: 12345,
          account_spec: 'SIM-12345',
          expires_at: '2026-08-11T16:00:00.000Z',
        }),
      },
      socketFactory: () => socket,
      onHint: () => undefined,
      onGap: (gap) => { gaps.push(gap) },
      now: () => NOW,
      setTimer: (() => 1 as unknown as ReturnType<typeof setTimeout>),
      clearTimer: () => undefined,
    })

    await client.start()
    socket.emit('open')
    socket.emit('message', 'c[3000,"Go away!"]')
    await settle()

    expect(gaps[0]?.reason).toContain('server closed')
    expect(socket.closed.at(-1)?.code).toBe(1011)
    client.stop()
  })

  test('halts the hint stream on wrong-account or malformed provider evidence', async () => {
    const socket = new FakeSocket()
    const gaps: Array<{ reason: string }> = []
    const timers: Array<{ callback: () => void; delay: number }> = []
    const client = new TradovateUserSyncClient({
      connection,
      sessionManager: {
        credential: async () => ({
          access_token: 'demo-token-1234567890',
          account_id: 12345,
          account_spec: 'SIM-12345',
          expires_at: '2026-08-11T16:00:00.000Z',
        }),
      },
      socketFactory: () => socket,
      onHint: () => undefined,
      onGap: (gap) => { gaps.push(gap) },
      now: () => NOW,
      heartbeatMs: 250,
      silenceTimeoutMs: 1_000,
      reconnectBaseMs: 100,
      setTimer: (callback, delay) => {
        timers.push({ callback, delay })
        return timers.length as unknown as ReturnType<typeof setTimeout>
      },
      clearTimer: () => undefined,
    })

    await client.start()
    socket.emit('open')
    socket.emit('message', 'a[{"i":0,"s":200}]')
    socket.emit('message', 'a[{"i":1,"s":200}]')
    socket.emit('message', 'a[{"e":"props","d":[{"entityType":"position","eventType":"Updated","entity":{"id":4,"accountId":99999,"netPos":1}}]}]')
    await settle()

    expect(gaps).toHaveLength(1)
    expect(gaps[0]!.reason).toContain('exact account')
    expect(socket.closed.at(-1)).toEqual({ code: 1011, reason: 'User-sync truth gap' })
    expect(timers.some((timer) => timer.delay === 100)).toBeTrue()
    client.stop()
  })

  test('reconnects with a fresh encrypted token and never reconnects after stop', async () => {
    const sockets: FakeSocket[] = []
    const timers: Array<{ callback: () => void; delay: number }> = []
    let credentialReads = 0
    const client = new TradovateUserSyncClient({
      connection,
      sessionManager: {
        credential: async () => ({
          access_token: `demo-token-123456789${++credentialReads}`,
          account_id: 12345,
          account_spec: 'SIM-12345',
          expires_at: '2026-08-11T16:00:00.000Z',
        }),
      },
      socketFactory: () => {
        const socket = new FakeSocket()
        sockets.push(socket)
        return socket
      },
      onHint: () => undefined,
      onGap: () => undefined,
      now: () => NOW,
      heartbeatMs: 250,
      silenceTimeoutMs: 1_000,
      reconnectBaseMs: 100,
      setTimer: (callback, delay) => {
        timers.push({ callback, delay })
        return timers.length as unknown as ReturnType<typeof setTimeout>
      },
      clearTimer: () => undefined,
    })

    await client.start()
    sockets[0]!.emit('open')
    sockets[0]!.emit('close')
    await settle()
    const reconnect = timers.find((timer) => timer.delay === 100)
    expect(reconnect).toBeDefined()
    reconnect!.callback()
    await settle()
    expect(sockets).toHaveLength(2)
    sockets[1]!.emit('open')
    expect(sockets[1]!.sent[0]).toContain('demo-token-1234567892')

    client.stop()
    sockets[1]!.emit('close')
    await settle()
    const socketsBeforeTimers = sockets.length
    for (const timer of timers.filter((candidate) => candidate.delay === 100)) timer.callback()
    await settle()
    expect(sockets).toHaveLength(socketsBeforeTimers)
  })
})
