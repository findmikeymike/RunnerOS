import { describe, expect, test } from 'bun:test'

import {
  ANALYSIS_ARTIFACT_SCHEMA_VERSION,
  ORDER_FLOW_MARKET_ARTIFACT_SCHEMA_VERSION,
  PROTOCOL_VERSION,
  analysisArtifactSchema,
  canonicalOrderFlowArtifactSchema,
} from '@trade-god/contracts'
import { loadEsDemoFixture } from '@trade-god/testkit'

import { ORDER_FLOW_RPC_CACHE_MAX, createOrderFlowRpcHandler } from '../src/index.ts'
import { CANONICAL_ORDER_FLOW_CONFIGURATION } from '../src/analyze-market-batch.ts'

const clientMeta = {
  schema_version: PROTOCOL_VERSION,
  trace_id: 'trace-sidecar-test',
  created_at: '2026-07-11T15:30:00.000Z',
  producer: { name: 'phase0-test-client', version: '0.1.0', instance_id: 'test-client-1' },
}

function rpc(id: string, method: string, params: unknown = {}) {
  return { jsonrpc: '2.0' as const, id, method, params }
}

describe('Order Flow JSON-RPC handler', () => {
  test('reports a ready fixture-only service with no execution capability', async () => {
    const handler = createOrderFlowRpcHandler({
      now: () => '2026-07-11T15:30:00.000Z',
      instanceId: 'order-flow-test-1',
    })

    const response = await handler.handle(rpc('health-1', 'trade.health', { meta: clientMeta }))

    expect(response).toMatchObject({
      jsonrpc: '2.0',
      id: 'health-1',
      result: {
        state: 'ready',
        protocol_version: PROTOCOL_VERSION,
        artifact_versions: [ANALYSIS_ARTIFACT_SCHEMA_VERSION, ORDER_FLOW_MARKET_ARTIFACT_SCHEMA_VERSION],
        capabilities: {
          commands: ['health', 'capabilities', 'analyze_fixture', 'analyze_market_batch', 'cancel', 'shutdown'],
          fixture_mode: true,
        },
      },
    })
    expect(JSON.stringify(response)).not.toContain('place_live_order')
  })

  test('analyzes a canonical market batch without fixture or provider objects entering the calculator', async () => {
    const batch = await Bun.file(new URL('../../../packages/trading-contracts/examples/market-trade-batch.v1.json', import.meta.url)).json()
    const handler = createOrderFlowRpcHandler({
      now: () => '2026-07-13T12:00:00.000Z',
      instanceId: 'order-flow-canonical-test',
    })
    const response = await handler.handle(rpc('canonical-1', 'trade.analyze_market_batch', {
      meta: { ...clientMeta, trace_id: 'trace-canonical-analysis', created_at: '2026-07-13T12:00:00.000Z' },
      input: { schema_version: 'order-flow-market-input@1', kind: 'canonical-market-batch', batch },
      session: { exchange_timezone: 'America/Chicago', session_id: 'CME-2026-07-11-RTH' },
      analysis: CANONICAL_ORDER_FLOW_CONFIGURATION,
      deadline_at: '2026-07-13T12:00:05.000Z', cancellation_id: 'cancel-canonical-1',
    }))

    expect('result' in response).toBe(true)
    if ('result' in response) {
      const artifact = canonicalOrderFlowArtifactSchema.parse(response.result)
      expect(artifact.artifact_schema_version).toBe(ORDER_FLOW_MARKET_ARTIFACT_SCHEMA_VERSION)
      expect(artifact.summary).toEqual({
        event_count: 4, total_volume: '28', buy_volume: '17', sell_volume: '11', unknown_volume: '0',
        delta: '6', point_of_control_price: '5592.25',
      })
      expect(artifact.input).not.toHaveProperty('fixture_id')
      expect(JSON.stringify(artifact)).not.toContain('nautilus')
    }
  })

  test('fails closed on a checksum-corrupt canonical market batch', async () => {
    const batch = await Bun.file(new URL('../../../packages/trading-contracts/examples/market-trade-batch.v1.json', import.meta.url)).json()
    batch.events[0].price = { value: '5591.00', raw: '559100', precision: 2 }
    const handler = createOrderFlowRpcHandler({ now: () => '2026-07-13T12:00:00.000Z', instanceId: 'order-flow-canonical-test' })
    const response = await handler.handle(rpc('canonical-corrupt', 'trade.analyze_market_batch', {
      meta: { ...clientMeta, trace_id: 'trace-canonical-corrupt', created_at: '2026-07-13T12:00:00.000Z' },
      input: { schema_version: 'order-flow-market-input@1', kind: 'canonical-market-batch', batch },
      session: { exchange_timezone: 'America/Chicago', session_id: 'CME-2026-07-11-RTH' },
      analysis: CANONICAL_ORDER_FLOW_CONFIGURATION,
      deadline_at: '2026-07-13T12:00:05.000Z', cancellation_id: 'cancel-canonical-corrupt',
    }))

    expect(response).toMatchObject({
      error: { data: { trade_error: { code: 'INVALID_REQUEST', category: 'validation', retryable: false } } },
    })
  })

  test('analyzes the checksummed ES fixture into a validated artifact', async () => {
    const fixture = await loadEsDemoFixture()
    const handler = createOrderFlowRpcHandler({
      now: () => '2026-07-11T15:30:00.000Z',
      instanceId: 'order-flow-test-1',
    })

    const response = await handler.handle(rpc('analyze-1', 'trade.analyze_fixture', {
      meta: clientMeta,
      fixture: { id: fixture.manifest.fixture_id, sha256: fixture.manifest.events_sha256 },
      instrument: fixture.manifest.instrument,
      session: fixture.manifest.session,
      analysis: { name: 'order-flow-summary', version: '0.1.0', configuration_hash: 'b'.repeat(64) },
      deadline_at: '2026-07-11T15:30:05.000Z',
      cancellation_id: 'cancel-analyze-1',
    }))

    expect('result' in response).toBe(true)
    if ('result' in response) {
      const artifact = analysisArtifactSchema.parse(response.result)
      expect(artifact.summary.delta).toBe('6')
      expect(artifact.meta.trace_id).toBe(clientMeta.trace_id)
    }
  })

  test('returns the cached response for an identical duplicate request id', async () => {
    const handler = createOrderFlowRpcHandler({ now: () => '2026-07-11T15:30:00.000Z', instanceId: 'order-flow-test-1' })
    const request = rpc('health-duplicate', 'trade.health', { meta: clientMeta })

    const first = await handler.handle(request)
    const second = await handler.handle(request)

    expect(second).toEqual(first)
  })

  test('bounds cached request identities instead of retaining canonical payloads forever', async () => {
    const handler = createOrderFlowRpcHandler({ now: () => '2026-07-11T15:30:00.000Z', instanceId: 'bounded-cache-test' })
    for (let index = 0; index <= ORDER_FLOW_RPC_CACHE_MAX; index += 1) {
      await handler.handle(rpc(`bounded-${index}`, 'trade.health', { meta: clientMeta }))
    }

    const evictedIdCanBeReused = await handler.handle(rpc('bounded-0', 'trade.capabilities', { meta: clientMeta }))
    expect(evictedIdCanBeReused).toMatchObject({ result: { commands: expect.arrayContaining(['analyze_market_batch']) } })
  })

  test('rejects reuse of a request id with different content', async () => {
    const handler = createOrderFlowRpcHandler({ now: () => '2026-07-11T15:30:00.000Z', instanceId: 'order-flow-test-1' })
    await handler.handle(rpc('reused-id', 'trade.health', { meta: clientMeta }))

    const response = await handler.handle(rpc('reused-id', 'trade.capabilities', { meta: clientMeta }))

    expect(response).toMatchObject({
      error: { code: -32600, data: { trade_error: { code: 'INVALID_REQUEST', retryable: false } } },
    })
  })

  test('honors cancellation registered before analysis begins', async () => {
    const fixture = await loadEsDemoFixture()
    const handler = createOrderFlowRpcHandler({ now: () => '2026-07-11T15:30:00.000Z', instanceId: 'order-flow-test-1' })
    await handler.handle(rpc('cancel-1', 'trade.cancel', { meta: clientMeta, cancellation_id: 'cancel-before-start' }))

    const response = await handler.handle(rpc('analyze-canceled', 'trade.analyze_fixture', {
      meta: clientMeta,
      fixture: { id: fixture.manifest.fixture_id, sha256: fixture.manifest.events_sha256 },
      instrument: fixture.manifest.instrument,
      session: fixture.manifest.session,
      analysis: { name: 'order-flow-summary', version: '0.1.0', configuration_hash: 'b'.repeat(64) },
      deadline_at: '2026-07-11T15:30:05.000Z',
      cancellation_id: 'cancel-before-start',
    }))

    expect(response).toMatchObject({
      error: { data: { trade_error: { code: 'CANCELED', category: 'canceled', retryable: false } } },
    })
  })

  test('aborts analysis already in progress and remains healthy', async () => {
    const fixture = await loadEsDemoFixture()
    let markStarted!: () => void
    const started = new Promise<void>((resolve) => { markStarted = resolve })
    const handler = createOrderFlowRpcHandler({
      now: () => '2026-07-11T15:30:00.000Z',
      instanceId: 'order-flow-test-1',
      analyzeFixture: async (_fixture, context) => {
        markStarted()
        await new Promise<void>((resolve) => context.signal.addEventListener('abort', () => resolve(), { once: true }))
        throw new Error('analysis aborted')
      },
    })
    const analysis = handler.handle(rpc('analyze-active-cancel', 'trade.analyze_fixture', {
      meta: clientMeta,
      fixture: { id: fixture.manifest.fixture_id, sha256: fixture.manifest.events_sha256 },
      instrument: fixture.manifest.instrument,
      session: fixture.manifest.session,
      analysis: { name: 'order-flow-summary', version: '0.1.0', configuration_hash: 'b'.repeat(64) },
      deadline_at: '2026-07-11T15:30:05.000Z',
      cancellation_id: 'cancel-active-analysis',
    }))

    await Promise.race([
      started,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('analysis did not enter injectable work')), 100)),
    ])
    const cancellation = await handler.handle(rpc('cancel-active', 'trade.cancel', {
      meta: clientMeta,
      cancellation_id: 'cancel-active-analysis',
    }))
    const response = await analysis

    expect(cancellation).toMatchObject({ result: { state: 'canceled' } })
    expect(response).toMatchObject({
      error: { data: { trade_error: { code: 'CANCELED', category: 'canceled', retryable: false } } },
    })
    await expect(handler.handle(rpc('health-after-cancel', 'trade.health', { meta: clientMeta })))
      .resolves.toMatchObject({ result: { state: 'ready' } })
  })

  test('returns JSON-RPC method-not-found without crashing', async () => {
    const handler = createOrderFlowRpcHandler({ now: () => '2026-07-11T15:30:00.000Z', instanceId: 'order-flow-test-1' })

    const response = await handler.handle(rpc('unknown-1', 'trade.place_live_order', { meta: clientMeta }))

    expect(response).toEqual({
      jsonrpc: '2.0',
      id: 'unknown-1',
      error: { code: -32601, message: 'Method not found' },
    })
  })

  test('acknowledges shutdown and transitions to stopped', async () => {
    const handler = createOrderFlowRpcHandler({ now: () => '2026-07-11T15:30:00.000Z', instanceId: 'order-flow-test-1' })

    const response = await handler.handle(rpc('shutdown-1', 'trade.shutdown', { meta: clientMeta }))

    expect(response).toEqual({ jsonrpc: '2.0', id: 'shutdown-1', result: { state: 'stopped' } })
    expect(handler.state()).toBe('stopped')
  })
})
