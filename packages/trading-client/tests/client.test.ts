import { describe, expect, test } from 'bun:test'

import { PROTOCOL_VERSION, type AnalyzeFixtureRequest } from '@trade-god/contracts'
import { loadEsDemoFixture } from '@trade-god/testkit'
import { createOrderFlowRpcHandler } from '../../../sidecars/order-flow-engine/src/index.ts'

import {
  InvalidTradingResponseError,
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
    })
    const canceled = await trading.cancelAnalysis('cancel-from-workbench')

    expect(requests[0].params.cancellation_id).toBe('cancel-from-workbench')
    expect(canceled).toMatchObject({ cancellation_id: 'cancel-from-workbench', state: 'canceled' })
  })
})
