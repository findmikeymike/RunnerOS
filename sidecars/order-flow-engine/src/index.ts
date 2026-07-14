import { createHash } from 'node:crypto'

import {
  ANALYSIS_ARTIFACT_SCHEMA_VERSION,
  ORDER_FLOW_MARKET_ARTIFACT_SCHEMA_VERSION,
  PROTOCOL_VERSION,
  analyzeFixtureRequestSchema,
  analyzeMarketBatchRequestSchema,
  assertCompatibleProtocol,
  healthResponseSchema,
  tradingErrorSchema,
  wireMetaSchema,
  type TradingError,
  type AnalysisArtifact,
  type CanonicalOrderFlowArtifact,
  type MarketTradeBatch,
  type WireMeta,
} from '@trade-god/contracts'
import {
  FixtureChecksumMismatchError,
  analyzeOrderFlowFixture,
  loadEsDemoFixture,
} from '@trade-god/testkit'
import {
  CANONICAL_ORDER_FLOW_CONFIGURATION,
  CanonicalOrderFlowInputError,
  ORDER_FLOW_MAX_REQUEST_BYTES,
  analyzeCanonicalMarketBatch,
} from './analyze-market-batch.ts'

type RpcId = string | number | null

interface RpcRequest {
  jsonrpc: '2.0'
  id: RpcId
  method: string
  params?: unknown
}

interface RpcSuccess {
  jsonrpc: '2.0'
  id: RpcId
  result: unknown
}

interface RpcFailure {
  jsonrpc: '2.0'
  id: RpcId
  error: { code: number; message: string; data?: { trade_error: TradingError } }
}

export type RpcResponse = RpcSuccess | RpcFailure

export interface OrderFlowRpcHandlerOptions {
  now: () => string
  instanceId: string
  analyzeFixture?: (
    fixture: Awaited<ReturnType<typeof loadEsDemoFixture>>,
    context: { signal: AbortSignal; meta: WireMeta; artifactId: string },
  ) => AnalysisArtifact | Promise<AnalysisArtifact>
  analyzeMarketBatch?: (
    batch: MarketTradeBatch,
    context: { signal: AbortSignal; meta: WireMeta; artifactId: string; sessionId: string },
  ) => CanonicalOrderFlowArtifact | Promise<CanonicalOrderFlowArtifact>
}

export interface OrderFlowRpcHandler {
  handle(request: RpcRequest): Promise<RpcResponse>
  state(): 'ready' | 'stopped'
}

const commands = ['health', 'capabilities', 'analyze_fixture', 'analyze_market_batch', 'cancel', 'shutdown'] as const
export const ORDER_FLOW_RPC_CACHE_MAX = 256
const ORDER_FLOW_PRECANCELED_MAX = 256

export function createOrderFlowRpcHandler(options: OrderFlowRpcHandlerOptions): OrderFlowRpcHandler {
  let lifecycle: 'ready' | 'stopped' = 'ready'
  const canceled = new Set<string>()
  const active = new Map<string, AbortController>()
  const handled = new Map<string, { digest: string; response: RpcResponse }>()
  const runAnalysis = options.analyzeFixture ?? ((fixture, context) => analyzeOrderFlowFixture(fixture, {
    meta: context.meta,
    artifact_id: context.artifactId,
  }))
  const runMarketAnalysis = options.analyzeMarketBatch ?? ((batch, context) => analyzeCanonicalMarketBatch(batch, {
    meta: context.meta,
    artifactId: context.artifactId,
    sessionId: context.sessionId,
  }))

  const serverMeta = (traceId: string): WireMeta => wireMetaSchema.parse({
    schema_version: PROTOCOL_VERSION,
    trace_id: traceId,
    created_at: options.now(),
    producer: {
      name: 'order-flow-engine',
      version: '0.1.0',
      instance_id: options.instanceId,
    },
  })

  const domainFailure = (
    id: RpcId,
    traceId: string,
    error: Omit<TradingError, 'meta'>,
    rpcCode = -32000,
  ): RpcFailure => ({
    jsonrpc: '2.0',
    id,
    error: {
      code: rpcCode,
      message: error.message,
      data: { trade_error: tradingErrorSchema.parse({ meta: serverMeta(traceId), ...error }) },
    },
  })

  const execute = async (request: RpcRequest): Promise<RpcResponse> => {
    const params = request.params && typeof request.params === 'object'
      ? request.params as Record<string, unknown>
      : {}
    const clientMeta = wireMetaSchema.safeParse(params.meta)
    const traceId = clientMeta.success ? clientMeta.data.trace_id : `untraced-${String(request.id)}`

    if (request.method === 'trade.health') {
      const result = healthResponseSchema.parse({
        meta: serverMeta(traceId),
        state: lifecycle,
        protocol_version: PROTOCOL_VERSION,
        artifact_versions: [ANALYSIS_ARTIFACT_SCHEMA_VERSION, ORDER_FLOW_MARKET_ARTIFACT_SCHEMA_VERSION],
        capabilities: { commands, fixture_mode: true },
        dependencies: [],
      })
      return { jsonrpc: '2.0', id: request.id, result }
    }

    if (request.method === 'trade.capabilities') {
      return {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          meta: serverMeta(traceId),
          protocol_version: PROTOCOL_VERSION,
          artifact_versions: [ANALYSIS_ARTIFACT_SCHEMA_VERSION, ORDER_FLOW_MARKET_ARTIFACT_SCHEMA_VERSION],
          commands,
          fixture_mode: true,
        },
      }
    }

    if (request.method === 'trade.cancel') {
      const cancellationId = typeof params.cancellation_id === 'string' ? params.cancellation_id : ''
      if (!cancellationId) {
        return domainFailure(request.id, traceId, {
          code: 'INVALID_REQUEST', category: 'validation', message: 'cancellation_id is required.', retryable: false,
        }, -32600)
      }
      if (!canceled.has(cancellationId) && canceled.size >= ORDER_FLOW_PRECANCELED_MAX) {
        const oldest = canceled.values().next().value
        if (oldest !== undefined) canceled.delete(oldest)
      }
      canceled.add(cancellationId)
      active.get(cancellationId)?.abort()
      return { jsonrpc: '2.0', id: request.id, result: { meta: serverMeta(traceId), cancellation_id: cancellationId, state: 'canceled' } }
    }

    if (request.method === 'trade.shutdown') {
      lifecycle = 'stopped'
      return { jsonrpc: '2.0', id: request.id, result: { state: 'stopped' } }
    }

    if (request.method === 'trade.analyze_fixture') {
      const parsed = analyzeFixtureRequestSchema.safeParse(params)
      if (!parsed.success) {
        return domainFailure(request.id, traceId, {
          code: 'INVALID_REQUEST', category: 'validation', message: 'Analyze fixture request is invalid.', retryable: false,
        }, -32600)
      }

      try {
        assertCompatibleProtocol(parsed.data.meta.schema_version)
      } catch {
        return domainFailure(request.id, traceId, {
          code: 'UNSUPPORTED_PROTOCOL_VERSION', category: 'incompatible', message: 'Trading protocol version is unsupported.', retryable: false,
        })
      }

      if (canceled.has(parsed.data.cancellation_id)) {
        canceled.delete(parsed.data.cancellation_id)
        return domainFailure(request.id, traceId, {
          code: 'CANCELED', category: 'canceled', message: 'Analysis was canceled before it started.', retryable: false,
        })
      }

      if (Date.parse(parsed.data.deadline_at) <= Date.parse(options.now())) {
        return domainFailure(request.id, traceId, {
          code: 'DEADLINE_EXCEEDED', category: 'timeout', message: 'Analysis deadline has elapsed.', retryable: false,
        })
      }

      const fixture = await loadEsDemoFixture()
      if (parsed.data.fixture.id !== fixture.manifest.fixture_id) {
        return domainFailure(request.id, traceId, {
          code: 'FIXTURE_NOT_FOUND', category: 'validation', message: 'Requested fixture is unavailable.', retryable: false,
        })
      }
      if (parsed.data.fixture.sha256 !== fixture.manifest.events_sha256) {
        return domainFailure(request.id, traceId, {
          code: 'FIXTURE_CHECKSUM_MISMATCH', category: 'validation', message: 'Fixture checksum does not match its manifest.', retryable: false,
        })
      }

      if (canceled.has(parsed.data.cancellation_id)) {
        canceled.delete(parsed.data.cancellation_id)
        return domainFailure(request.id, traceId, {
          code: 'CANCELED', category: 'canceled', message: 'Analysis was canceled while preparing its input.', retryable: false,
        })
      }

      const controller = new AbortController()
      active.set(parsed.data.cancellation_id, controller)
      try {
        const artifact = await runAnalysis(fixture, {
          signal: controller.signal,
          meta: serverMeta(traceId),
          artifactId: `artifact-${String(request.id)}`,
        })
        if (controller.signal.aborted) {
          return domainFailure(request.id, traceId, {
            code: 'CANCELED', category: 'canceled', message: 'Analysis was canceled while running.', retryable: false,
          })
        }
        return { jsonrpc: '2.0', id: request.id, result: artifact }
      } catch (error) {
        if (controller.signal.aborted) {
          return domainFailure(request.id, traceId, {
            code: 'CANCELED', category: 'canceled', message: 'Analysis was canceled while running.', retryable: false,
          })
        }
        if (error instanceof FixtureChecksumMismatchError) {
          return domainFailure(request.id, traceId, {
            code: 'FIXTURE_CHECKSUM_MISMATCH', category: 'validation', message: error.message, retryable: false,
          })
        }
        return domainFailure(request.id, traceId, {
          code: 'INTERNAL_ERROR', category: 'internal', message: 'Order Flow analysis failed.', retryable: false,
        })
      } finally {
        active.delete(parsed.data.cancellation_id)
        canceled.delete(parsed.data.cancellation_id)
      }
    }

    if (request.method === 'trade.analyze_market_batch') {
      if (Buffer.byteLength(JSON.stringify(params), 'utf8') > ORDER_FLOW_MAX_REQUEST_BYTES) {
        return domainFailure(request.id, traceId, {
          code: 'INVALID_REQUEST', category: 'validation', message: 'Canonical Order Flow request is too large.', retryable: false,
        }, -32600)
      }
      const parsed = analyzeMarketBatchRequestSchema.safeParse(params)
      if (!parsed.success) {
        return domainFailure(request.id, traceId, {
          code: 'INVALID_REQUEST', category: 'validation', message: 'Canonical Order Flow request is invalid.', retryable: false,
        }, -32600)
      }
      try {
        assertCompatibleProtocol(parsed.data.meta.schema_version)
      } catch {
        return domainFailure(request.id, traceId, {
          code: 'UNSUPPORTED_PROTOCOL_VERSION', category: 'incompatible', message: 'Trading protocol version is unsupported.', retryable: false,
        })
      }
      if (JSON.stringify(parsed.data.analysis) !== JSON.stringify(CANONICAL_ORDER_FLOW_CONFIGURATION)) {
        return domainFailure(request.id, traceId, {
          code: 'INVALID_REQUEST', category: 'validation', message: 'Canonical Order Flow configuration is unsupported.', retryable: false,
        }, -32600)
      }
      if (canceled.has(parsed.data.cancellation_id)) {
        canceled.delete(parsed.data.cancellation_id)
        return domainFailure(request.id, traceId, {
          code: 'CANCELED', category: 'canceled', message: 'Analysis was canceled before it started.', retryable: false,
        })
      }
      if (Date.parse(parsed.data.deadline_at) <= Date.parse(options.now())) {
        return domainFailure(request.id, traceId, {
          code: 'DEADLINE_EXCEEDED', category: 'timeout', message: 'Analysis deadline has elapsed.', retryable: false,
        })
      }

      const controller = new AbortController()
      active.set(parsed.data.cancellation_id, controller)
      try {
        const artifact = await runMarketAnalysis(parsed.data.input.batch, {
          signal: controller.signal,
          meta: serverMeta(traceId),
          artifactId: `artifact-${String(request.id)}`,
          sessionId: parsed.data.session.session_id,
        })
        if (controller.signal.aborted) {
          return domainFailure(request.id, traceId, {
            code: 'CANCELED', category: 'canceled', message: 'Analysis was canceled while running.', retryable: false,
          })
        }
        return { jsonrpc: '2.0', id: request.id, result: artifact }
      } catch (error) {
        if (controller.signal.aborted) {
          return domainFailure(request.id, traceId, {
            code: 'CANCELED', category: 'canceled', message: 'Analysis was canceled while running.', retryable: false,
          })
        }
        if (error instanceof CanonicalOrderFlowInputError) {
          return domainFailure(request.id, traceId, {
            code: 'INVALID_REQUEST', category: 'validation', message: error.message, retryable: false,
          }, -32600)
        }
        return domainFailure(request.id, traceId, {
          code: 'INTERNAL_ERROR', category: 'internal', message: 'Canonical Order Flow analysis failed.', retryable: false,
        })
      } finally {
        active.delete(parsed.data.cancellation_id)
        canceled.delete(parsed.data.cancellation_id)
      }
    }

    return { jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Method not found' } }
  }

  return {
    async handle(request) {
      const key = String(request.id)
      const digest = createHash('sha256').update(JSON.stringify(request), 'utf8').digest('hex')
      const prior = handled.get(key)
      if (prior) {
        if (prior.digest === digest) return prior.response
        return domainFailure(request.id, 'duplicate-request-id', {
          code: 'INVALID_REQUEST', category: 'validation', message: 'Request id was reused with different content.', retryable: false,
        }, -32600)
      }

      const response = await execute(request)
      if (handled.size >= ORDER_FLOW_RPC_CACHE_MAX) {
        const oldest = handled.keys().next().value
        if (oldest !== undefined) handled.delete(oldest)
      }
      handled.set(key, { digest, response })
      return response
    },
    state: () => lifecycle,
  }
}
