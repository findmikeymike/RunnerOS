import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'

import { PROTOCOL_VERSION, canonicalJson, type AnalyzeFixtureRequest } from '@trade-god/contracts'
import { loadEsDemoFixture } from '@trade-god/testkit'
import { createOrderFlowRpcHandler } from '../../../sidecars/order-flow-engine/src/index.ts'
import { CANONICAL_ORDER_FLOW_CONFIGURATION } from '../../../sidecars/order-flow-engine/src/analyze-market-batch.ts'

import {
  InvalidMarketDataResponseError,
  InvalidTradingResponseError,
  MarketDataClient,
  MarketDataClientError,
  ResponseTraceMismatchError,
  TradingClient,
  TradingClientError,
  type RpcTransport,
} from '../src/index.ts'

function realHandlerTransport(): RpcTransport {
  const handler = createOrderFlowRpcHandler({
    now: () => '2026-07-11T15:30:00.000Z',
    instanceId: 'client-test-sidecar',
  })
  return { request: (request) => handler.handle(request) }
}

function client(transport: RpcTransport) {
  let sequence = 0
  return new TradingClient({
    transport,
    now: () => '2026-07-11T15:30:00.000Z',
    nextId: (prefix) => `${prefix}-${++sequence}`,
    producer: { name: 'trade-god-client', version: '0.1.0', instance_id: 'client-test-1' },
  })
}

describe('TradingClient', () => {
  test('validates health and analyzes the fixture through the typed boundary', async () => {
    const fixture = await loadEsDemoFixture()
    const trading = client(realHandlerTransport())

    const health = await trading.health()
    const artifact = await trading.analyzeFixture({
      fixture: { id: fixture.manifest.fixture_id, sha256: fixture.manifest.events_sha256 },
      instrument: fixture.manifest.instrument,
      session: fixture.manifest.session,
      analysis: { name: 'order-flow-summary', version: '0.1.0', configuration_hash: 'b'.repeat(64) },
      timeoutMs: 5_000,
    })

    expect(health.state).toBe('ready')
    expect(artifact.summary.delta).toBe('6')
  })

  test('rejects a response whose trace does not match its request', async () => {
    const transport: RpcTransport = {
      request: async (request) => ({
        jsonrpc: '2.0',
        id: request.id,
        result: {
          meta: {
            schema_version: PROTOCOL_VERSION,
            trace_id: 'wrong-trace',
            created_at: '2026-07-11T15:30:00.000Z',
            producer: { name: 'bad-sidecar', version: '0.1.0', instance_id: 'bad-1' },
          },
          state: 'ready',
          protocol_version: PROTOCOL_VERSION,
          artifact_versions: ['order-flow-artifact@1'],
          capabilities: { commands: ['health'], fixture_mode: true },
          dependencies: [],
        },
      }),
    }

    await expect(client(transport).health()).rejects.toBeInstanceOf(ResponseTraceMismatchError)
  })

  test('rejects malformed successful payloads before callers see them', async () => {
    const transport: RpcTransport = {
      request: async (request) => ({ jsonrpc: '2.0', id: request.id, result: { state: 'ready' } }),
    }

    await expect(client(transport).health()).rejects.toBeInstanceOf(InvalidTradingResponseError)
  })

  test('normalizes typed sidecar errors', async () => {
    const transport: RpcTransport = {
      request: async (request) => ({
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: -32000,
          message: 'Requested fixture is unavailable.',
          data: {
            trade_error: {
              meta: (request.params as AnalyzeFixtureRequest).meta,
              code: 'FIXTURE_NOT_FOUND',
              category: 'validation',
              message: 'Requested fixture is unavailable.',
              retryable: false,
            },
          },
        },
      }),
    }
    const fixture = await loadEsDemoFixture()

    const action = client(transport).analyzeFixture({
      fixture: { id: fixture.manifest.fixture_id, sha256: fixture.manifest.events_sha256 },
      instrument: fixture.manifest.instrument,
      session: fixture.manifest.session,
      analysis: { name: 'order-flow-summary', version: '0.1.0', configuration_hash: 'b'.repeat(64) },
      timeoutMs: 5_000,
    })

    await expect(action).rejects.toMatchObject<Partial<TradingClientError>>({
      code: 'FIXTURE_NOT_FOUND',
      category: 'validation',
      retryable: false,
    })
  })

  test('uses a caller-owned cancellation id and sends a typed cancel command', async () => {
    const fixture = await loadEsDemoFixture()
    const requests: any[] = []
    const handler = createOrderFlowRpcHandler({ now: () => '2026-07-11T15:30:00.000Z', instanceId: 'cancel-client-test' })
    const trading = client({ request: async (request) => { requests.push(request); return handler.handle(request) } })

    await trading.analyzeFixture({
      fixture: { id: fixture.manifest.fixture_id, sha256: fixture.manifest.events_sha256 },
      instrument: fixture.manifest.instrument,
      session: fixture.manifest.session,
      analysis: { name: 'order-flow-summary', version: '0.1.0', configuration_hash: 'b'.repeat(64) },
      timeoutMs: 5_000,
      cancellationId: 'cancel-from-workbench',
      traceId: 'trace-from-workbench',
    })
    const canceled = await trading.cancelAnalysis('cancel-from-workbench')

    expect(requests[0].params.cancellation_id).toBe('cancel-from-workbench')
    expect(requests[0].params.meta.trace_id).toBe('trace-from-workbench')
    expect(canceled).toMatchObject({ cancellation_id: 'cancel-from-workbench', state: 'canceled' })
  })

  test('validates canonical Order Flow artifact identity and content hash', async () => {
    const batch = await Bun.file(new URL('../../trading-contracts/examples/market-trade-batch.v1.json', import.meta.url)).json()
    const artifact = await client(realHandlerTransport()).analyzeMarketBatch({
      batch,
      session: { exchange_timezone: 'America/Chicago', session_id: 'CME-2026-07-11-RTH' },
      analysis: CANONICAL_ORDER_FLOW_CONFIGURATION,
      timeoutMs: 5_000,
      traceId: 'trace-client-canonical',
    })

    expect(artifact.summary).toMatchObject({ total_volume: '28', delta: '6', point_of_control_price: '5592.25' })
    expect(artifact.input.batch_id).toBe(batch.batch_id)
  })

  test('rejects a self-consistent artifact whose provenance does not match the requested market batch', async () => {
    const batch = await Bun.file(new URL('../../trading-contracts/examples/market-trade-batch.v1.json', import.meta.url)).json()
    const real = realHandlerTransport()
    const transport: RpcTransport = {
      request: async (request) => {
        const response = await real.request(request) as any
        if (request.method !== 'trade.analyze_market_batch' || !response.result) return response
        response.result.session_id = 'CME-WRONG-SESSION'
        const { meta: _meta, artifact_id: _artifactId, content_hash: _oldHash, ...content } = response.result
        response.result.content_hash = createHash('sha256').update(canonicalJson(content), 'utf8').digest('hex')
        return response
      },
    }

    await expect(client(transport).analyzeMarketBatch({
      batch,
      session: { exchange_timezone: 'America/Chicago', session_id: 'CME-2026-07-11-RTH' },
      analysis: CANONICAL_ORDER_FLOW_CONFIGURATION,
      timeoutMs: 5_000,
    })).rejects.toBeInstanceOf(InvalidTradingResponseError)
  })
})

describe('MarketDataClient', () => {
  function marketClient(transport: RpcTransport) {
    let sequence = 0
    return new MarketDataClient({ transport, nextId: (prefix) => `${prefix}-${++sequence}` })
  }

  test('validates health and canonical fixture batches', async () => {
    const batch = await Bun.file(new URL('../../trading-contracts/examples/market-trade-batch.v1.json', import.meta.url)).json()
    const transport: RpcTransport = {
      request: async (request) => request.method === 'market.health'
        ? {
            jsonrpc: '2.0', id: request.id, result: {
              service: 'trade-god-market-data-engine', version: '0.1.0', state: 'ready',
              protocol_version: 'market-data-rpc@1', artifact_versions: ['market-trade-batch@1'],
              capabilities: {
                commands: ['market.health', 'market.capabilities', 'market.load_fixture', 'market.shutdown'],
                fixture_mode: true, fixture_ids: ['es-demo-2026-07-11'], live_data: false,
                broker_access: false, trade_execution: false,
              },
              dependencies: [{ name: 'es-demo-2026-07-11', state: 'ready' }],
            },
          }
        : { jsonrpc: '2.0', id: request.id, result: batch },
    }
    const market = marketClient(transport)

    expect((await market.health()).state).toBe('ready')
    expect((await market.loadFixture({
      fixtureId: 'es-demo-2026-07-11', traceId: 'trace-market-replay-001', batchId: 'batch-es-demo-001',
    })).events).toHaveLength(4)
  })

  test('rejects malformed and trace-mismatched market-data responses', async () => {
    const malformed = marketClient({
      request: async (request) => ({ jsonrpc: '2.0', id: request.id, result: { state: 'ready' } }),
    })
    await expect(malformed.health()).rejects.toBeInstanceOf(InvalidMarketDataResponseError)

    const batch = await Bun.file(new URL('../../trading-contracts/examples/market-trade-batch.v1.json', import.meta.url)).json()
    const mismatched = marketClient({
      request: async (request) => ({ jsonrpc: '2.0', id: request.id, result: { ...batch, trace_id: 'trace-wrong' } }),
    })
    await expect(mismatched.loadFixture({
      fixtureId: 'es-demo-2026-07-11', traceId: 'trace-expected', batchId: 'batch-es-demo-001',
    })).rejects.toBeInstanceOf(InvalidMarketDataResponseError)

    const tamperedBatch = await Bun.file(new URL('../../trading-contracts/examples/market-trade-batch.v1.json', import.meta.url)).json()
    tamperedBatch.events[0].price = { value: '1.00', raw: '100', precision: 2 }
    const tampered = marketClient({
      request: async (request) => ({ jsonrpc: '2.0', id: request.id, result: tamperedBatch }),
    })
    await expect(tampered.loadFixture({
      fixtureId: 'es-demo-2026-07-11', traceId: 'trace-market-replay-001', batchId: 'batch-es-demo-001',
    })).rejects.toBeInstanceOf(InvalidMarketDataResponseError)
  })

  test('normalizes typed market-data failures', async () => {
    const market = marketClient({
      request: async (request) => ({
        jsonrpc: '2.0', id: request.id, error: {
          code: -32000, message: 'Requested market-data fixture is unavailable.', data: {
            market_error: {
              code: 'FIXTURE_NOT_FOUND', category: 'validation',
              message: 'Requested market-data fixture is unavailable.', retryable: false,
            },
          },
        },
      }),
    })

    await expect(market.loadFixture({
      fixtureId: 'missing', traceId: 'trace-missing', batchId: 'batch-missing',
    })).rejects.toMatchObject<Partial<MarketDataClientError>>({
      code: 'FIXTURE_NOT_FOUND', category: 'validation', retryable: false,
    })
  })

  test('rejects invalid fixture request identities before transport', async () => {
    let calls = 0
    const market = marketClient({ request: async () => { calls += 1; return {} } })

    await expect(market.loadFixture({
      fixtureId: 'es-demo-2026-07-11', traceId: 'not valid', batchId: 'batch-valid',
    })).rejects.toBeDefined()
    expect(calls).toBe(0)
  })
})
