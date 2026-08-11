import type { TradingConnection } from '@trade-god/contracts'

import { sha256 } from '../canonical.ts'
import { ExecutionGatewayError } from '../errors.ts'
import type { TradovateSessionManager } from './tradovate-session-manager.ts'

export const TRADOVATE_USER_SYNC_URL = 'wss://demo.tradovateapi.com/v1/websocket'
export const TRADOVATE_USER_SYNC_ENTITY_TYPES = [
  'account',
  'command',
  'commandReport',
  'executionReport',
  'fill',
  'order',
  'orderStrategy',
  'position',
] as const

export interface TradovateUserSyncSocket {
  on(event: 'open', listener: () => void): unknown
  on(event: 'message', listener: (data: unknown) => void): unknown
  on(event: 'close', listener: () => void): unknown
  on(event: 'error', listener: (error: unknown) => void): unknown
  send(data: string): void
  close(code?: number, reason?: string): void
}

export interface TradovateUserSyncHint {
  connection_id: string
  account_ref: string
  entity_type: typeof TRADOVATE_USER_SYNC_ENTITY_TYPES[number] | 'subscription'
  event_type: string
  evidence_checksum: string
  observed_at: string
}

export interface TradovateUserSyncGap {
  connection_id: string
  account_ref: string
  reason: string
  observed_at: string
}

export interface TradovateUserSyncHealth {
  connection_id: string
  state: 'stopped' | 'connecting' | 'authenticating' | 'subscribing' | 'subscribed' | 'reconnecting' | 'gap'
  reconnect_attempt: number
  last_hint_at?: string
  last_gap_at?: string
  last_gap_reason?: string
}

export interface TradovateUserSyncClientOptions {
  connection: TradingConnection
  sessionManager: Pick<TradovateSessionManager, 'credential'>
  socketFactory: (url: string) => TradovateUserSyncSocket
  onHint: (hint: TradovateUserSyncHint) => void | Promise<void>
  onGap: (gap: TradovateUserSyncGap) => void | Promise<void>
  now?: () => string
  heartbeatMs?: number
  silenceTimeoutMs?: number
  reconnectBaseMs?: number
  reconnectMaxMs?: number
  setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void
}

/**
 * Tradovate user-sync is a hint channel only. It never mutates execution state
 * or supplies provider truth; every accepted hint wakes the authoritative REST
 * reconciliation path. Any wire gap is surfaced so the caller can halt entry.
 */
export class TradovateUserSyncClient {
  private readonly now: () => string
  private readonly heartbeatMs: number
  private readonly silenceTimeoutMs: number
  private readonly reconnectBaseMs: number
  private readonly reconnectMaxMs: number
  private readonly setTimer: NonNullable<TradovateUserSyncClientOptions['setTimer']>
  private readonly clearTimer: NonNullable<TradovateUserSyncClientOptions['clearTimer']>
  private socket?: TradovateUserSyncSocket
  private heartbeatTimer?: ReturnType<typeof setTimeout>
  private silenceTimer?: ReturnType<typeof setTimeout>
  private reconnectTimer?: ReturnType<typeof setTimeout>
  private running = false
  private generation = 0
  private reconnectAttempt = 0
  private subscribed = false
  private gapReported = false
  private state: TradovateUserSyncHealth['state'] = 'stopped'
  private lastHintAt?: string
  private lastGapAt?: string
  private lastGapReason?: string

  constructor(private readonly options: TradovateUserSyncClientOptions) {
    if (
      options.connection.platform.slug !== 'tradovate'
      || options.connection.environment !== 'paper'
      || options.connection.transport_preference !== 'api'
      || !options.connection.credential_ref
      || !/^\d+$/.test(options.connection.account_ref)
    ) {
      throw new ExecutionGatewayError(
        'CONNECTION_UNAVAILABLE',
        'Tradovate user-sync requires one exact API paper account.',
      )
    }
    this.now = options.now ?? (() => new Date().toISOString())
    this.heartbeatMs = Math.max(250, options.heartbeatMs ?? 2_500)
    this.silenceTimeoutMs = Math.max(this.heartbeatMs * 2, options.silenceTimeoutMs ?? 10_000)
    this.reconnectBaseMs = Math.max(100, options.reconnectBaseMs ?? 1_000)
    this.reconnectMaxMs = Math.max(this.reconnectBaseMs, options.reconnectMaxMs ?? 10_000)
    this.setTimer = options.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs))
    this.clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer))
  }

  async start(): Promise<void> {
    if (this.running) return
    this.running = true
    this.state = 'connecting'
    await this.connect()
  }

  stop(): void {
    if (!this.running) return
    this.running = false
    this.state = 'stopped'
    this.generation += 1
    this.clearTimers()
    const socket = this.socket
    this.socket = undefined
    socket?.close(1000, 'Trade God shutdown')
  }

  health(): TradovateUserSyncHealth {
    return {
      connection_id: this.options.connection.connection_id,
      state: this.state,
      reconnect_attempt: this.reconnectAttempt,
      ...(this.lastHintAt ? { last_hint_at: this.lastHintAt } : {}),
      ...(this.lastGapAt ? { last_gap_at: this.lastGapAt } : {}),
      ...(this.lastGapReason ? { last_gap_reason: this.lastGapReason } : {}),
    }
  }

  private async connect(): Promise<void> {
    const generation = ++this.generation
    this.subscribed = false
    this.gapReported = false
    try {
      const credential = await this.options.sessionManager.credential(this.options.connection)
      if (!this.running || generation !== this.generation) return
      const socket = this.options.socketFactory(TRADOVATE_USER_SYNC_URL)
      this.socket = socket
      socket.on('open', () => {
        if (!this.isCurrent(generation, socket)) return
        this.state = 'authenticating'
        try {
          socket.send(`authorize\n0\n\n${credential.access_token}`)
          this.scheduleHeartbeat(generation, socket)
          this.resetSilenceTimer(generation, socket)
        } catch {
          this.failGap('Tradovate user-sync authentication could not be sent.', generation, socket)
        }
      })
      socket.on('message', (data) => {
        if (!this.isCurrent(generation, socket)) return
        this.resetSilenceTimer(generation, socket)
        this.handleMessage(toMessageText(data), generation, socket)
      })
      socket.on('error', () => {
        if (!this.isCurrent(generation, socket)) return
        this.failGap('Tradovate user-sync transport error.', generation, socket)
      })
      socket.on('close', () => {
        if (!this.isCurrent(generation, socket)) return
        this.socket = undefined
        this.clearConnectionTimers()
        void this.reportGap('Tradovate user-sync disconnected before a complete REST rebuild.')
        this.scheduleReconnect()
      })
    } catch {
      if (!this.running || generation !== this.generation) return
      await this.reportGap('Tradovate user-sync could not obtain a current encrypted session.')
      this.scheduleReconnect()
    }
  }

  private handleMessage(
    text: string,
    generation: number,
    socket: TradovateUserSyncSocket,
  ): void {
    if (text === '[]' || text === '') return
    if (text === 'o') return
    if (text === 'h') {
      try {
        socket.send('[]')
      } catch {
        this.failGap('Tradovate user-sync heartbeat response failed.', generation, socket)
      }
      return
    }
    if (text.startsWith('c')) {
      this.failGap('Tradovate user-sync server closed the session.', generation, socket)
      return
    }
    if (!text.startsWith('a')) {
      this.failGap('Tradovate user-sync returned an unknown frame.', generation, socket)
      return
    }
    let frames: unknown
    try {
      frames = JSON.parse(text.slice(1))
    } catch {
      this.failGap('Tradovate user-sync returned malformed JSON.', generation, socket)
      return
    }
    if (!Array.isArray(frames)) {
      this.failGap('Tradovate user-sync response was not an array.', generation, socket)
      return
    }
    for (const frame of frames) {
      if (!frame || typeof frame !== 'object' || Array.isArray(frame)) {
        this.failGap('Tradovate user-sync returned a malformed response item.', generation, socket)
        return
      }
      const value = frame as Record<string, unknown>
      if (value.i === 0) {
        if (value.s !== 200 || this.subscribed) {
          this.failGap('Tradovate user-sync authentication was rejected or repeated.', generation, socket)
          return
        }
        try {
          socket.send(`user/syncrequest\n1\n\n${JSON.stringify({
            splitResponses: true,
            accounts: [Number(this.options.connection.account_ref)],
            entityTypes: TRADOVATE_USER_SYNC_ENTITY_TYPES,
          })}`)
          this.subscribed = true
          this.state = 'subscribing'
        } catch {
          this.failGap('Tradovate user-sync subscription could not be sent.', generation, socket)
        }
        continue
      }
      if (value.i === 1) {
        if (!this.subscribed || value.s !== 200) {
          this.failGap('Tradovate user-sync subscription was rejected.', generation, socket)
          return
        }
        this.reconnectAttempt = 0
        this.state = 'subscribed'
        void this.emitHint('subscription', 'Subscribed', sha256(value))
        continue
      }
      if (value.e === 'props') {
        const events = Array.isArray(value.d) ? value.d : [value.d]
        if (events.length === 0 || events.length > 1_000 || events.some((event) => event === undefined)) {
          this.failGap('Tradovate user-sync event payload was malformed.', generation, socket)
          return
        }
        for (const event of events) {
          const parsed = parseUserSyncEvent(event, Number(this.options.connection.account_ref))
          if (!parsed) {
            this.failGap('Tradovate user-sync event did not prove the exact account.', generation, socket)
            return
          }
          const evidence = sha256(parsed)
          // Hints perform no mutation, so duplicate delivery is already
          // idempotent. Always wake REST: the same entity bytes can recur after
          // a different provider transition and must not be suppressed.
          void this.emitHint(parsed.entityType, parsed.eventType, evidence)
        }
        continue
      }
      this.failGap('Tradovate user-sync returned an unrecognized response.', generation, socket)
      return
    }
  }

  private emitHint(
    entityType: TradovateUserSyncHint['entity_type'],
    eventType: string,
    evidenceChecksum: string,
  ): void | Promise<void> {
    this.lastHintAt = this.now()
    return this.options.onHint({
      connection_id: this.options.connection.connection_id,
      account_ref: this.options.connection.account_ref,
      entity_type: entityType,
      event_type: eventType,
      evidence_checksum: evidenceChecksum,
      observed_at: this.lastHintAt,
    })
  }

  private failGap(
    reason: string,
    generation: number,
    socket: TradovateUserSyncSocket,
  ): void {
    if (!this.isCurrent(generation, socket)) return
    void this.reportGap(reason)
    this.socket = undefined
    this.clearConnectionTimers()
    socket.close(1011, 'User-sync truth gap')
    this.scheduleReconnect()
  }

  private async reportGap(reason: string): Promise<void> {
    if (this.gapReported) return
    this.gapReported = true
    this.state = 'gap'
    this.lastGapAt = this.now()
    this.lastGapReason = reason
    await this.options.onGap({
      connection_id: this.options.connection.connection_id,
      account_ref: this.options.connection.account_ref,
      reason,
      observed_at: this.lastGapAt,
    })
  }

  private scheduleHeartbeat(
    generation: number,
    socket: TradovateUserSyncSocket,
  ): void {
    if (this.heartbeatTimer) this.clearTimer(this.heartbeatTimer)
    this.heartbeatTimer = this.setTimer(() => {
      this.heartbeatTimer = undefined
      if (!this.isCurrent(generation, socket)) return
      try {
        socket.send('[]')
        this.scheduleHeartbeat(generation, socket)
      } catch {
        this.failGap('Tradovate user-sync heartbeat failed.', generation, socket)
      }
    }, this.heartbeatMs)
  }

  private resetSilenceTimer(
    generation: number,
    socket: TradovateUserSyncSocket,
  ): void {
    if (this.silenceTimer) this.clearTimer(this.silenceTimer)
    this.silenceTimer = this.setTimer(() => {
      this.silenceTimer = undefined
      this.failGap('Tradovate user-sync server heartbeat timed out.', generation, socket)
    }, this.silenceTimeoutMs)
  }

  private scheduleReconnect(): void {
    if (!this.running || this.reconnectTimer) return
    const delay = Math.min(
      this.reconnectMaxMs,
      this.reconnectBaseMs * (2 ** Math.min(this.reconnectAttempt, 8)),
    )
    this.reconnectAttempt += 1
    this.state = 'reconnecting'
    this.reconnectTimer = this.setTimer(() => {
      this.reconnectTimer = undefined
      if (this.running) void this.connect()
    }, delay)
  }

  private isCurrent(generation: number, socket: TradovateUserSyncSocket): boolean {
    return this.running && generation === this.generation && socket === this.socket
  }

  private clearConnectionTimers(): void {
    if (this.heartbeatTimer) this.clearTimer(this.heartbeatTimer)
    if (this.silenceTimer) this.clearTimer(this.silenceTimer)
    this.heartbeatTimer = undefined
    this.silenceTimer = undefined
  }

  private clearTimers(): void {
    this.clearConnectionTimers()
    if (this.reconnectTimer) this.clearTimer(this.reconnectTimer)
    this.reconnectTimer = undefined
  }
}

const parseUserSyncEvent = (
  input: unknown,
  expectedAccountId: number,
): {
  entityType: typeof TRADOVATE_USER_SYNC_ENTITY_TYPES[number]
  eventType: string
  entity: Record<string, unknown> | Record<string, unknown>[]
} | null => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const value = input as Record<string, unknown>
  if (
    typeof value.entityType !== 'string'
    || !TRADOVATE_USER_SYNC_ENTITY_TYPES.includes(
      value.entityType as typeof TRADOVATE_USER_SYNC_ENTITY_TYPES[number],
    )
    || typeof value.eventType !== 'string'
    || !value.eventType.trim()
    || !value.entity
    || typeof value.entity !== 'object'
  ) return null
  const entity = value.entity as Record<string, unknown> | unknown[]
  if (
    Array.isArray(entity)
    && (
      entity.length === 0
      || entity.length > 1_000
      || entity.some((item) => !item || typeof item !== 'object' || Array.isArray(item))
    )
  ) return null
  const normalizedEntity = entity as Record<string, unknown> | Record<string, unknown>[]
  const accountIds = collectAccountIds(entity)
  const accountMatches = value.entityType === 'account'
    ? (Array.isArray(normalizedEntity)
        ? normalizedEntity.every((item) => item.id === expectedAccountId)
        : normalizedEntity.id === expectedAccountId)
    : accountIds.length > 0 && accountIds.every((id) => id === expectedAccountId)
  if (!accountMatches) return null
  return {
    entityType: value.entityType as typeof TRADOVATE_USER_SYNC_ENTITY_TYPES[number],
    eventType: value.eventType,
    entity: normalizedEntity,
  }
}

const collectAccountIds = (value: unknown, depth = 0): number[] => {
  if (depth > 4 || !value || typeof value !== 'object') return []
  if (Array.isArray(value)) return value.flatMap((item) => collectAccountIds(item, depth + 1))
  const ids: number[] = []
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'accountId' && typeof nested === 'number' && Number.isSafeInteger(nested)) {
      ids.push(nested)
    } else if (nested && typeof nested === 'object') {
      ids.push(...collectAccountIds(nested, depth + 1))
    }
  }
  return ids
}

const toMessageText = (value: unknown): string => {
  if (typeof value === 'string') return value
  if (value instanceof ArrayBuffer) return new TextDecoder().decode(value)
  if (ArrayBuffer.isView(value)) {
    return new TextDecoder().decode(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
  }
  return String(value ?? '')
}
