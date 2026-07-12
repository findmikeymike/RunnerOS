import {
  PROTOCOL_VERSION,
  analysisArtifactSchema,
  cancelAnalysisResponseSchema,
  analyzeFixtureRequestSchema,
  assertCompatibleProtocol,
  healthResponseSchema,
  tradingErrorSchema,
  wireMetaSchema,
  type AnalysisArtifact,
  type AnalyzeFixtureRequest,
  type HealthResponse,
  type CancelAnalysisResponse,
  type TradingError,
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

export interface AnalyzeFixtureInput {
  fixture: AnalyzeFixtureRequest['fixture']
  instrument: AnalyzeFixtureRequest['instrument']
  session: AnalyzeFixtureRequest['session']
  analysis: AnalyzeFixtureRequest['analysis']
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
