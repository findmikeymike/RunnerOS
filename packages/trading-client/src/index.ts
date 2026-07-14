import { createHash } from 'node:crypto'

import {
  PROTOCOL_VERSION,
  analysisArtifactSchema,
  analyzeMarketBatchRequestSchema,
  canonicalOrderFlowArtifactSchema,
  cancelAnalysisResponseSchema,
  analyzeFixtureRequestSchema,
  assertCompatibleProtocol,
  healthResponseSchema,
  canonicalJson,
  marketDataCapabilitiesResponseSchema,
  marketDataErrorSchema,
  marketDataHealthSchema,
  marketLoadFixtureRequestSchema,
  marketTradeBatchSchema,
  tradingErrorSchema,
  wireMetaSchema,
  type AnalysisArtifact,
  type AnalyzeMarketBatchRequest,
  type CanonicalOrderFlowArtifact,
  type AnalyzeFixtureRequest,
  type HealthResponse,
  type CancelAnalysisResponse,
  type TradingError,
  type MarketDataCapabilitiesResponse,
  type MarketDataError,
  type MarketDataHealth,
  type MarketQualityReport,
  type MarketTradeBatch,
  type WireMeta,
} from '@trade-god/contracts'
import type { z } from 'zod'

export interface RpcRequest {
  jsonrpc: '2.0'
  id: string
  method: string
  params: unknown
}

export interface RpcTransport {
  request(request: RpcRequest): Promise<unknown>
}

interface TradingClientOptions {
  transport: RpcTransport
  now: () => string
  nextId: (prefix: string) => string
  producer: WireMeta['producer']
}

interface MarketDataClientOptions {
  transport: RpcTransport
  nextId: (prefix: string) => string
}

export interface LoadMarketFixtureInput {
  fixtureId: string
  traceId: string
  batchId: string
}

export interface AnalyzeFixtureInput {
  fixture: AnalyzeFixtureRequest['fixture']
  instrument: AnalyzeFixtureRequest['instrument']
  session: AnalyzeFixtureRequest['session']
  analysis: AnalyzeFixtureRequest['analysis']
  timeoutMs: number
  cancellationId?: string
  traceId?: string
}

export interface AnalyzeMarketBatchInput {
  batch: AnalyzeMarketBatchRequest['input']['batch']
  session: AnalyzeMarketBatchRequest['session']
  analysis: AnalyzeMarketBatchRequest['analysis']
  timeoutMs: number
  cancellationId?: string
  traceId?: string
}

export class TradingClientError extends Error {
  readonly code: TradingError['code']
  readonly category: TradingError['category']
  readonly retryable: boolean
  readonly traceId: string

  constructor(error: TradingError) {
    super(error.message)
    this.name = 'TradingClientError'
    this.code = error.code
    this.category = error.category
    this.retryable = error.retryable
    this.traceId = error.meta.trace_id
  }
}

export class ResponseTraceMismatchError extends Error {
  constructor() {
    super('Trading response trace does not match its request.')
    this.name = 'ResponseTraceMismatchError'
  }
}

export class InvalidTradingResponseError extends Error {
  constructor(message = 'Trading response is malformed.') {
    super(message)
    this.name = 'InvalidTradingResponseError'
  }
}

export class InvalidMarketDataResponseError extends Error {
  constructor(message = 'Market-data response is malformed.') {
    super(message)
    this.name = 'InvalidMarketDataResponseError'
  }
}

export class MarketDataClientError extends Error {
  readonly code: MarketDataError['code']
  readonly category: MarketDataError['category']
  readonly retryable: false
  readonly qualityReport?: MarketQualityReport

  constructor(error: MarketDataError) {
    super(error.message)
    this.name = 'MarketDataClientError'
    this.code = error.code
    this.category = error.category
    this.retryable = error.retryable
    this.qualityReport = error.quality_report
  }
}

export class TradingClient {
  constructor(private readonly options: TradingClientOptions) {}

  async health(): Promise<HealthResponse> {
    const traceId = this.options.nextId('trace')
    const response = await this.request('trade.health', { meta: this.meta(traceId) }, traceId, healthResponseSchema)
    assertCompatibleProtocol(response.protocol_version)
    return response
  }

  async analyzeFixture(input: AnalyzeFixtureInput): Promise<AnalysisArtifact> {
    if (!Number.isFinite(input.timeoutMs) || input.timeoutMs <= 0) {
      throw new TypeError('timeoutMs must be a positive finite number.')
    }

    const traceId = input.traceId ?? this.options.nextId('trace')
    const now = this.options.now()
    const params = analyzeFixtureRequestSchema.parse({
      meta: this.meta(traceId),
      fixture: input.fixture,
      instrument: input.instrument,
      session: input.session,
      analysis: input.analysis,
      deadline_at: new Date(Date.parse(now) + input.timeoutMs).toISOString(),
      cancellation_id: input.cancellationId ?? this.options.nextId('cancel'),
    })

    return this.request('trade.analyze_fixture', params, traceId, analysisArtifactSchema)
  }

  async analyzeMarketBatch(input: AnalyzeMarketBatchInput): Promise<CanonicalOrderFlowArtifact> {
    if (!Number.isFinite(input.timeoutMs) || input.timeoutMs <= 0) {
      throw new TypeError('timeoutMs must be a positive finite number.')
    }

    const traceId = input.traceId ?? this.options.nextId('trace')
    const now = this.options.now()
    const params = analyzeMarketBatchRequestSchema.parse({
      meta: this.meta(traceId),
      input: { schema_version: 'order-flow-market-input@1', kind: 'canonical-market-batch', batch: input.batch },
      session: input.session,
      analysis: input.analysis,
      deadline_at: new Date(Date.parse(now) + input.timeoutMs).toISOString(),
      cancellation_id: input.cancellationId ?? this.options.nextId('cancel'),
    })
    const artifact = await this.request(
      'trade.analyze_market_batch', params, traceId, canonicalOrderFlowArtifactSchema,
    )
    const { meta: _meta, artifact_id: _artifactId, content_hash: _contentHash, ...deterministicContent } = artifact
    const checksum = createHash('sha256').update(canonicalJson(deterministicContent), 'utf8').digest('hex')
    if (checksum !== artifact.content_hash) {
      throw new InvalidTradingResponseError('Canonical Order Flow artifact checksum is invalid.')
    }
    if (
      artifact.input.batch_id !== input.batch.batch_id
      || artifact.input.batch_trace_id !== input.batch.trace_id
      || artifact.input.batch_schema_version !== input.batch.batch_schema_version
      || artifact.input.canonical_events_sha256 !== input.batch.canonical_events_sha256
      || artifact.input.source_sha256 !== input.batch.source.source_sha256
      || artifact.input.mode !== input.batch.mode
      || artifact.input.quality_state !== input.batch.quality.state
      || artifact.input.event_count !== input.batch.events.length
      || artifact.instrument_id !== input.batch.instrument_id
      || artifact.session_id !== input.session.session_id
      || artifact.event_time_range.start_ns !== input.batch.event_time_range.start_ns
      || artifact.event_time_range.end_ns !== input.batch.event_time_range.end_ns
      || canonicalJson(artifact.algorithm) !== canonicalJson(input.analysis)
      || artifact.quality.state !== input.batch.quality.state
      || canonicalJson(artifact.quality.flags) !== canonicalJson([...new Set(input.batch.quality.flags)].sort())
      || artifact.summary.event_count !== input.batch.events.length
    ) {
      throw new InvalidTradingResponseError('Canonical Order Flow artifact identity does not match its input.')
    }
    return artifact
  }

  async cancelAnalysis(cancellationId: string): Promise<CancelAnalysisResponse> {
    const traceId = this.options.nextId('trace')
    return this.request('trade.cancel', {
      meta: this.meta(traceId),
      cancellation_id: cancellationId,
    }, traceId, cancelAnalysisResponseSchema)
  }

  private meta(traceId: string): WireMeta {
    return wireMetaSchema.parse({
      schema_version: PROTOCOL_VERSION,
      trace_id: traceId,
      created_at: this.options.now(),
      producer: this.options.producer,
    })
  }

  private async request<T extends z.ZodType>(
    method: string,
    params: unknown,
    traceId: string,
    resultSchema: T,
  ): Promise<z.infer<T>> {
    const id = this.options.nextId('rpc')
    const raw = await this.options.transport.request({ jsonrpc: '2.0', id, method, params })
    if (!raw || typeof raw !== 'object') throw new InvalidTradingResponseError()
    const response = raw as Record<string, unknown>
    if (response.jsonrpc !== '2.0' || response.id !== id) throw new InvalidTradingResponseError('Trading response id is invalid.')

    if ('error' in response) {
      const rpcError = response.error
      if (!rpcError || typeof rpcError !== 'object') throw new InvalidTradingResponseError()
      const data = (rpcError as Record<string, unknown>).data
      const tradeErrorValue = data && typeof data === 'object'
        ? (data as Record<string, unknown>).trade_error
        : undefined
      const tradeError = tradingErrorSchema.safeParse(tradeErrorValue)
      if (!tradeError.success) throw new InvalidTradingResponseError('Trading error payload is malformed.')
      this.assertTrace(traceId, tradeError.data.meta.trace_id)
      throw new TradingClientError(tradeError.data)
    }

    const parsed = resultSchema.safeParse(response.result)
    if (!parsed.success) throw new InvalidTradingResponseError()
    const result = parsed.data as { meta?: { trace_id?: string } }
    if (!result.meta?.trace_id) throw new InvalidTradingResponseError('Trading response metadata is missing.')
    this.assertTrace(traceId, result.meta.trace_id)
    return parsed.data
  }

  private assertTrace(expected: string, actual: string): void {
    if (expected !== actual) throw new ResponseTraceMismatchError()
  }
}

export class MarketDataClient {
  constructor(private readonly options: MarketDataClientOptions) {}

  health(): Promise<MarketDataHealth> {
    return this.request('market.health', {}, marketDataHealthSchema)
  }

  capabilities(): Promise<MarketDataCapabilitiesResponse> {
    return this.request('market.capabilities', {}, marketDataCapabilitiesResponseSchema)
  }

  async loadFixture(input: LoadMarketFixtureInput): Promise<MarketTradeBatch> {
    const params = marketLoadFixtureRequestSchema.parse({
      fixture_id: input.fixtureId,
      trace_id: input.traceId,
      batch_id: input.batchId,
    })
    const batch = await this.request('market.load_fixture', params, marketTradeBatchSchema)
    const checksum = createHash('sha256').update(canonicalJson(batch.events), 'utf8').digest('hex')
    if (checksum !== batch.canonical_events_sha256) {
      throw new InvalidMarketDataResponseError('Market-data canonical event checksum is invalid.')
    }
    if (
      batch.trace_id !== input.traceId
      || batch.batch_id !== input.batchId
      || batch.source.fixture_id !== input.fixtureId
    ) {
      throw new InvalidMarketDataResponseError('Market-data response identity does not match its request.')
    }
    return batch
  }

  private async request<T extends z.ZodType>(
    method: string,
    params: unknown,
    resultSchema: T,
  ): Promise<z.infer<T>> {
    const id = this.options.nextId('market-rpc')
    const raw = await this.options.transport.request({ jsonrpc: '2.0', id, method, params })
    if (!raw || typeof raw !== 'object') throw new InvalidMarketDataResponseError()
    const response = raw as Record<string, unknown>
    if (response.jsonrpc !== '2.0' || response.id !== id) {
      throw new InvalidMarketDataResponseError('Market-data response id is invalid.')
    }
    if ('error' in response) {
      const rpcError = response.error
      if (!rpcError || typeof rpcError !== 'object') throw new InvalidMarketDataResponseError()
      const data = (rpcError as Record<string, unknown>).data
      const errorValue = data && typeof data === 'object'
        ? (data as Record<string, unknown>).market_error
        : undefined
      const parsedError = marketDataErrorSchema.safeParse(errorValue)
      if (!parsedError.success) throw new InvalidMarketDataResponseError('Market-data error payload is malformed.')
      throw new MarketDataClientError(parsedError.data)
    }
    const parsed = resultSchema.safeParse(response.result)
    if (!parsed.success) throw new InvalidMarketDataResponseError()
    return parsed.data
  }
}
