import { expect, test } from 'bun:test'

import {
  WebullTradeEventStream,
  createWebullTradeEventMetadata,
  type WebullTradeEventSubscription,
  type WebullTradeEventTransport,
} from '../src/options/webull-trade-event-stream.ts'

test('subscribes to one exact sandbox account and treats order events as reconciliation hints', async () => {
  let request: Record<string, unknown> | undefined
  const listeners = new Map<string, Array<(value?: unknown) => void>>()
  const transport: WebullTradeEventTransport = {
    subscribe: (value) => {
      request = value
      const stream: WebullTradeEventSubscription = {
        on: (event, listener) => { const values = listeners.get(event) ?? []; values.push(listener as (value?: unknown) => void); listeners.set(event, values) },
        cancel: () => undefined,
      }
      queueMicrotask(() => listeners.get('data')?.forEach((listener) => listener({
        contentType: 'application/json',
        payload: JSON.stringify('subscribed'),
      })))
      return stream
    },
    close: () => undefined,
  }
  const client = new WebullTradeEventStream({
    account_id: 'sandbox-one', app_key: 'app-key', app_secret: 'secret-value', transport,
    now: () => new Date('2026-08-27T15:00:00.000Z'),
  })
  await client.start()
  expect(request).toEqual({ subscribeType: 7, timestamp: 1_787_842_800_000, accounts: ['sandbox-one'] })
  listeners.get('data')?.forEach((listener) => listener({
    eventType: 1024,
    subscribeType: 1,
    contentType: 'application/json',
    payload: JSON.stringify({
      id: 'event-one',
      event_type: 'TRADE',
      position: 'cursor-one',
      timestamp: '2026-08-27T15:00:01Z',
      payload: { account_id: 'sandbox-one', client_order_id: 'tgopt-one', order_status: 'FILLED' },
    }),
  }))
  expect(client.latest('tgopt-one')).toMatchObject({ account_id: 'sandbox-one', order_status: 'FILLED' })
  client.stop()
})

test('fails closed on authentication control frames and signs the exact protobuf bytes', async () => {
  const listeners = new Map<string, Array<(value?: unknown) => void>>()
  const gaps: string[] = []
  const client = new WebullTradeEventStream({
    account_id: 'sandbox-one', app_key: 'app-key', app_secret: 'secret-value', connect_timeout_ms: 100,
    onGap: (reason) => gaps.push(reason),
    transport: {
      subscribe: () => {
        const stream: WebullTradeEventSubscription = {
          on: (event, listener) => { const values = listeners.get(event) ?? []; values.push(listener as (value?: unknown) => void); listeners.set(event, values) },
          cancel: () => undefined,
        }
        queueMicrotask(() => listeners.get('data')?.forEach((listener) => listener({ eventType: 2, payload: '' })))
        return stream
      },
      close: () => undefined,
    },
  })
  await expect(client.start()).rejects.toThrow('control failure')
  expect(client.isHealthy()).toBe(false)
  expect(gaps).toHaveLength(1)

  const metadata = createWebullTradeEventMetadata({
    appKey: 'app-key', appSecret: 'secret-value', requestBytes: new Uint8Array([1, 2, 3]),
    now: () => new Date('2026-08-27T15:00:00.000Z'), nonce: () => 'nonce-one',
  })
  expect(metadata.get('x-signature-algorithm')).toEqual(['HMAC-SHA256'])
  expect(metadata.get('x-version')).toEqual([])
  expect(metadata.get('host')).toEqual([])
  expect(metadata.get('x-signature')).toEqual(['7BHAjv7hUVUXGlrtbNJpq2otDfxW1/Ecm1iJ3vB4Qcc='])
})

test('reports only payload field names when a live event omits account identity', async () => {
  const listeners = new Map<string, Array<(value?: unknown) => void>>()
  const gaps: string[] = []
  const client = new WebullTradeEventStream({
    account_id: 'sandbox-one', app_key: 'app-key', app_secret: 'secret-value',
    onGap: (reason) => gaps.push(reason),
    transport: {
      subscribe: () => {
        const stream: WebullTradeEventSubscription = {
          on: (event, listener) => { const values = listeners.get(event) ?? []; values.push(listener as (value?: unknown) => void); listeners.set(event, values) },
          cancel: () => undefined,
        }
        queueMicrotask(() => listeners.get('data')?.forEach((listener) => listener({ eventType: 0, payload: '' })))
        return stream
      },
      close: () => undefined,
    },
  })
  await client.start()
  listeners.get('data')?.forEach((listener) => listener({
    eventType: 1024,
    subscribeType: 1,
    contentType: 'application/json',
    payload: JSON.stringify({ request_id: 'must-not-leak' }),
  }))
  expect(gaps[0]).toContain('fields: request_id')
  expect(gaps[0]).not.toContain('must-not-leak')
})

test('ignores non-order event payloads that do not carry order account identity', async () => {
  const listeners = new Map<string, Array<(value?: unknown) => void>>()
  const gaps: string[] = []
  const client = new WebullTradeEventStream({
    account_id: 'sandbox-one', app_key: 'app-key', app_secret: 'secret-value',
    onGap: (reason) => gaps.push(reason),
    transport: {
      subscribe: () => {
        const stream: WebullTradeEventSubscription = {
          on: (event, listener) => { const values = listeners.get(event) ?? []; values.push(listener as (value?: unknown) => void); listeners.set(event, values) },
          cancel: () => undefined,
        }
        queueMicrotask(() => listeners.get('data')?.forEach((listener) => listener({ eventType: 0, payload: '' })))
        return stream
      },
      close: () => undefined,
    },
  })
  await client.start()
  listeners.get('data')?.forEach((listener) => listener({
    eventType: 1032,
    subscribeType: 4,
    contentType: 'application/json',
    payload: JSON.stringify('option-status-notice'),
  }))
  expect(gaps).toEqual([])
  expect(client.isHealthy()).toBe(true)
  client.stop()
})

test('closes the exact transport when subscription setup times out', async () => {
  let canceled = 0
  let closed = 0
  const client = new WebullTradeEventStream({
    account_id: 'sandbox-one', app_key: 'app-key', app_secret: 'secret-value', connect_timeout_ms: 5,
    transport: {
      subscribe: () => ({
        on: () => undefined,
        cancel: () => { canceled += 1 },
      }),
      close: () => { closed += 1 },
    },
  })
  await expect(client.start()).rejects.toThrow('timed out')
  expect(client.isHealthy()).toBe(false)
  expect(canceled).toBe(1)
  expect(closed).toBe(1)
})
