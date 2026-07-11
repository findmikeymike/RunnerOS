import { describe, expect, test } from 'bun:test'

import { ANALYSIS_ARTIFACT_SCHEMA_VERSION, PROTOCOL_VERSION, analysisArtifactSchema } from '@trade-god/contracts'
import { loadEsDemoFixture } from '@trade-god/testkit'

import { createOrderFlowRpcHandler } from '../src/index.ts'

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
        artifact_versions: [ANALYSIS_ARTIFACT_SCHEMA_VERSION],
        capabilities: {
          commands: ['health', 'capabilities', 'analyze_fixture', 'cancel', 'shutdown'],
          fixture_mode: true,
        },
      },
    })
    expect(JSON.stringify(response)).not.toContain('place_live_order')
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
