import { createHash, createHmac, randomUUID } from 'node:crypto'

import * as grpc from '@grpc/grpc-js'
import { parse } from 'protobufjs'

const WEBULL_EVENTS_HOST = 'events-api.sandbox.webull.com:443'
const PROTO = `
syntax = "proto3";
package grpc.trade.event;
service EventService { rpc Subscribe(SubscribeRequest) returns (stream SubscribeResponse); }
message SubscribeRequest { uint32 subscribeType = 1; int64 timestamp = 2; string contentType = 3; string payload = 4; repeated string accounts = 5; }
message SubscribeResponse { EventType eventType = 1; uint32 subscribeType = 2; string contentType = 3; string payload = 4; string requestId = 5; int64 timestamp = 6; }
enum EventType { SubscribeSuccess = 0; Ping = 1; AuthError = 2; NumOfConnExceed = 3; SubscribeExpired = 4; }
`

const root = parse(PROTO).root
const SubscribeRequest = root.lookupType('grpc.trade.event.SubscribeRequest')
const SubscribeResponse = root.lookupType('grpc.trade.event.SubscribeResponse')

export type WebullTradeEvent = {
  request_id?: string
  account_id: string
  client_order_id?: string
  order_id?: string
  instrument_id?: string
  order_status?: string
  qty?: string
  filled_price?: string
  filled_qty?: string
  side?: string
  scene_type?: string
  category?: string
  order_type?: string
}

export type WebullTradeEventSubscription = {
  on(event: 'data', listener: (value: unknown) => void): void
  on(event: 'error', listener: (error: Error) => void): void
  on(event: 'end', listener: () => void): void
  cancel(): void
}

export type WebullTradeEventTransport = {
  subscribe(request: Record<string, unknown>, metadata: grpc.Metadata): WebullTradeEventSubscription
  close(): void
}

export class WebullTradeEventStream {
  private subscription?: WebullTradeEventSubscription
  private activeTransport?: WebullTradeEventTransport
  private healthy = false
  private stopped = false
  private generationValue = 0
  private readonly events = new Map<string, WebullTradeEvent>()
  private readonly waiters = new Map<string, Set<(event: WebullTradeEvent) => void>>()
  private connectPromise?: Promise<void>

  constructor(private readonly config: {
    account_id: string
    app_key: string
    app_secret: string
    transport?: WebullTradeEventTransport
    now?: () => Date
    nonce?: () => string
    connect_timeout_ms?: number
    onGap?: (reason: string) => void
  }) {}

  get generation(): number { return this.generationValue }
  isHealthy(): boolean { return this.healthy && !this.stopped }

  async start(): Promise<void> {
    if (this.isHealthy()) return
    if (this.connectPromise) return this.connectPromise
    const prior = this.subscription
    const priorTransport = this.activeTransport
    this.subscription = undefined
    this.activeTransport = undefined
    prior?.cancel()
    priorTransport?.close()
    this.stopped = false
    this.connectPromise = this.connect()
    try { await this.connectPromise } finally { this.connectPromise = undefined }
  }

  stop(): void {
    this.stopped = true
    this.healthy = false
    const prior = this.subscription
    const priorTransport = this.activeTransport
    this.subscription = undefined
    this.activeTransport = undefined
    prior?.cancel()
    priorTransport?.close()
    for (const waiters of this.waiters.values()) for (const resolve of waiters) resolve({ account_id: this.config.account_id, scene_type: 'STREAM_STOPPED' })
    this.waiters.clear()
  }

  latest(clientOrderId: string): WebullTradeEvent | undefined { return this.events.get(clientOrderId) }

  async waitFor(clientOrderId: string, timeoutMs = 2_000): Promise<WebullTradeEvent | undefined> {
    const existing = this.events.get(clientOrderId)
    if (existing) return existing
    return new Promise((resolve) => {
      const listener = (event: WebullTradeEvent) => { clearTimeout(timer); set.delete(listener); resolve(event) }
      const set = this.waiters.get(clientOrderId) ?? new Set()
      set.add(listener)
      this.waiters.set(clientOrderId, set)
      const timer = setTimeout(() => { set.delete(listener); resolve(undefined) }, timeoutMs)
    })
  }

  private async connect(): Promise<void> {
    const timestamp = (this.config.now ?? (() => new Date()))().getTime()
    // Webull's sandbox acknowledges the combined subscription. We still
    // consume only order-status events below; position/option notices are
    // valid but irrelevant reconciliation hints with different payload shapes.
    const request = { subscribeType: 7, timestamp, accounts: [this.config.account_id] }
    const bytes = Buffer.from(SubscribeRequest.encode(SubscribeRequest.create(request)).finish())
    const metadata = createWebullTradeEventMetadata({
      appKey: this.config.app_key,
      appSecret: this.config.app_secret,
      requestBytes: bytes,
      now: this.config.now,
      nonce: this.config.nonce,
    })
    const transport = this.config.transport ?? createGrpcTransport()
    this.activeTransport = transport
    const subscription = transport.subscribe(request, metadata)
    this.subscription = subscription
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const error = new Error('Webull trade-event subscription timed out.')
        this.gap(error.message)
        reject(error)
      }, this.config.connect_timeout_ms ?? 8_000)
      subscription.on('data', (raw) => {
        try {
          // SubscribeSuccess is enum value 0. Proto3 may omit zero-valued
          // scalar fields on the wire, so materialize defaults before routing.
          const response = SubscribeResponse.toObject(SubscribeResponse.fromObject(raw as Record<string, unknown>), {
            longs: Number,
            defaults: true,
          }) as Record<string, unknown>
          const eventType = Number(response.eventType)
          if (eventType === 0) {
            clearTimeout(timeout); this.healthy = true; this.generationValue += 1; resolve(); return
          }
          if (eventType === 1) return
          if (eventType >= 2 && eventType <= 4) throw new Error(`Webull trade-event control failure (${eventType}).`)
          const subscribeType = Number(response.subscribeType)
          if (eventType !== 1024 || subscribeType !== 1) return
          if (typeof response.payload === 'string' && response.payload.trim()) {
            const event = parsePayload(response.payload)
            if (event.account_id !== this.config.account_id) throw new Error('Webull trade event belongs to another account.')
            this.generationValue += 1
            if (event.client_order_id) {
              this.events.set(event.client_order_id, event)
              for (const waiter of this.waiters.get(event.client_order_id) ?? []) waiter(event)
              this.waiters.delete(event.client_order_id)
            }
            return
          }
          throw new Error(`Webull trade event (${eventType}) omitted its payload.`)
        } catch (error) { clearTimeout(timeout); this.gap(error instanceof Error ? error.message : String(error)); reject(error) }
      })
      subscription.on('error', (error) => { clearTimeout(timeout); this.gap(error.message); reject(error) })
      subscription.on('end', () => { clearTimeout(timeout); if (!this.stopped) this.gap('Webull trade-event stream ended.') })
    })
  }

  private gap(reason: string): void {
    this.healthy = false
    this.generationValue += 1
    const prior = this.subscription
    const priorTransport = this.activeTransport
    this.subscription = undefined
    this.activeTransport = undefined
    prior?.cancel()
    priorTransport?.close()
    this.config.onGap?.(reason)
  }
}

export function createWebullTradeEventMetadata(input: {
  appKey: string
  appSecret: string
  requestBytes: Uint8Array
  now?: () => Date
  nonce?: () => string
}): grpc.Metadata {
  const metadata = new grpc.Metadata()
  const values: Record<string, string> = {
    'x-app-key': input.appKey,
    'x-signature-algorithm': 'HMAC-SHA256',
    'x-signature-version': '1.0',
    'x-signature-nonce': (input.nonce ?? (() => randomUUID()))(),
    'x-timestamp': (input.now ?? (() => new Date()))().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  }
  const joined = Object.keys(values).sort().map((key) => `${key}=${values[key]}`).join('=')
  const bodyHash = createHash('sha256').update(input.requestBytes).digest('hex')
  const encoded = encodeURIComponent(`${joined}&${bodyHash}`).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
  values['x-signature'] = createHmac('sha256', `${input.appSecret}&`).update(encoded).digest('base64')
  for (const [key, value] of Object.entries(values)) metadata.set(key, value)
  return metadata
}

const parsePayload = (payload: unknown): WebullTradeEvent => {
  const parsed = typeof payload === 'string' ? JSON.parse(payload) : payload
  const envelope = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined
  const nested = envelope?.payload
  const value = nested && typeof nested === 'object' && !Array.isArray(nested)
    ? nested as Record<string, unknown>
    : envelope
  const accountId = typeof value?.account_id === 'string' ? value.account_id : ''
  if (!accountId) {
    const envelopeFields = envelope ? Object.keys(envelope).sort().join(',') || '(none)' : '(not-an-object)'
    const payloadFields = value && value !== envelope ? Object.keys(value).sort().join(',') || '(none)' : '(none)'
    throw new Error(`Webull trade event omitted account identity (fields: ${envelopeFields}; payload fields: ${payloadFields}).`)
  }
  const exact = value as Record<string, unknown>
  const text = (key: string): string | undefined => typeof exact[key] === 'string' ? String(exact[key]) : exact[key] != null ? String(exact[key]) : undefined
  return {
    account_id: accountId,
    request_id: text('request_id'), client_order_id: text('client_order_id'), order_id: text('order_id'),
    instrument_id: text('instrument_id'), order_status: text('order_status'), qty: text('qty'),
    filled_price: text('filled_price'), filled_qty: text('filled_qty'), side: text('side'),
    scene_type: text('scene_type'), category: text('category'), order_type: text('order_type'),
  }
}

const createGrpcTransport = (): WebullTradeEventTransport => {
  const Client = grpc.makeGenericClientConstructor({
    Subscribe: {
      path: '/grpc.trade.event.EventService/Subscribe', requestStream: false, responseStream: true,
      requestSerialize: (value: unknown) => Buffer.from(SubscribeRequest.encode(SubscribeRequest.fromObject(value as Record<string, unknown>)).finish()),
      requestDeserialize: (bytes: Buffer) => SubscribeRequest.toObject(SubscribeRequest.decode(bytes), { longs: Number }),
      responseSerialize: (value: unknown) => Buffer.from(SubscribeResponse.encode(SubscribeResponse.fromObject(value as Record<string, unknown>)).finish()),
      responseDeserialize: (bytes: Buffer) => SubscribeResponse.toObject(SubscribeResponse.decode(bytes), {
        longs: Number,
        defaults: true,
      }),
    },
  }, 'EventService') as unknown as new (address: string, credentials: grpc.ChannelCredentials) => {
    Subscribe(request: unknown, metadata: grpc.Metadata): WebullTradeEventSubscription
    close(): void
  }
  const client = new Client(WEBULL_EVENTS_HOST, grpc.credentials.createSsl())
  return { subscribe: (request, metadata) => client.Subscribe(request, metadata), close: () => client.close() }
}
