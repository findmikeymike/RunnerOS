import {
  MarketDataClient,
  type LoadMarketFixtureInput,
  type StartMarketReplayInput,
  type RpcRequest,
  type RpcTransport,
} from '@trade-god/client'
import type {
  AgentMarketSnapshot, MarketCandleSeries, MarketDataHealth, MarketReplayCancellation,
  MarketReplaySession, MarketReplayStep, MarketTradeBatch, MarketTradeEvent,
} from '@trade-god/contracts'
import { buildAgentMarketSnapshot, buildMarketReplaySnapshot } from '@trade-god/market-state'

import {
  JsonlSidecarProcess,
  JsonlSidecarRequestTimeoutError,
  type JsonlSidecarProcessOptions,
} from './jsonl-sidecar-process.ts'


type MarketDataManagerOptions = Omit<JsonlSidecarProcessOptions, 'serviceLabel'>

export interface LoadFixtureSnapshotInput extends LoadMarketFixtureInput {
  snapshotId: string
  intervalNs: string
  watermarkNs: string
}

export interface LoadFixtureAgentSnapshotInput extends LoadFixtureSnapshotInput {
  staleAfterNs: string
  recentTradeLimit?: number
  closedCandleLimit?: number
  qualityIssueLimit?: number
}

export class MarketDataSidecarManager implements RpcTransport {
  private readonly process: JsonlSidecarProcess
  private readonly client: MarketDataClient
  private sequence = 0
  private readonly baseRequestTimeoutMs: number
  private readonly replayTiming = new Map<string, { cancellationId: string; paceIntervalMs: number }>()

  constructor(options: MarketDataManagerOptions) {
    this.process = new JsonlSidecarProcess({ serviceLabel: 'Market Data', ...options })
    this.baseRequestTimeoutMs = options.requestTimeoutMs
    this.client = new MarketDataClient({
      transport: this,
      nextId: (prefix) => this.nextId(prefix),
      now: () => new Date().toISOString(),
    })
  }

  health(): Promise<MarketDataHealth> {
    return this.client.health()
  }

  loadFixture(input: LoadMarketFixtureInput): Promise<MarketTradeBatch> {
    return this.client.loadFixture(input)
  }

  async startReplay(input: StartMarketReplayInput): Promise<MarketReplaySession> {
    const session = await this.client.startReplay(input)
    this.replayTiming.set(session.replay_id, {
      cancellationId: session.cancellation_id,
      paceIntervalMs: session.pace_interval_ms,
    })
    return session
  }

  async nextReplay(replayId: string): Promise<MarketReplayStep> {
    try {
      const step = await this.client.nextReplay(replayId)
      if (step.state === 'completed') this.replayTiming.delete(replayId)
      return step
    } catch (error) {
      const timing = this.replayTiming.get(replayId)
      if (error instanceof JsonlSidecarRequestTimeoutError && timing) {
        try {
          await this.client.cancelReplay(timing.cancellationId)
        } catch {
          // Preserve the original transport timeout; stop() remains the final cleanup boundary.
        }
        this.replayTiming.delete(replayId)
      }
      throw error
    }
  }

  async cancelReplay(cancellationId: string): Promise<MarketReplayCancellation> {
    const result = await this.client.cancelReplay(cancellationId)
    this.replayTiming.delete(result.replay_id)
    return result
  }

  async replayFixture(
    input: StartMarketReplayInput,
    onEvent?: (event: MarketTradeEvent, step: Extract<MarketReplayStep, { state: 'event' }>) => void | Promise<void>,
  ): Promise<MarketTradeBatch> {
    const session = await this.startReplay(input)
    while (true) {
      const step = await this.nextReplay(session.replay_id)
      if (step.state === 'completed') return step.batch
      await onEvent?.(step.event, step)
    }
  }

  async loadFixtureSnapshot(input: LoadFixtureSnapshotInput): Promise<MarketCandleSeries> {
    const batch = await this.loadFixture(input)
    return buildMarketReplaySnapshot({
      snapshotId: input.snapshotId,
      traceId: input.traceId,
      intervalNs: input.intervalNs,
      watermarkNs: input.watermarkNs,
      batches: [batch],
    })
  }

  async loadFixtureAgentSnapshot(input: LoadFixtureAgentSnapshotInput): Promise<AgentMarketSnapshot> {
    const batch = await this.loadFixture(input)
    return buildAgentMarketSnapshot({
      snapshotId: input.snapshotId,
      traceId: input.traceId,
      intervalNs: input.intervalNs,
      watermarkNs: input.watermarkNs,
      staleAfterNs: input.staleAfterNs,
      ...(input.recentTradeLimit === undefined ? {} : { recentTradeLimit: input.recentTradeLimit }),
      ...(input.closedCandleLimit === undefined ? {} : { closedCandleLimit: input.closedCandleLimit }),
      ...(input.qualityIssueLimit === undefined ? {} : { qualityIssueLimit: input.qualityIssueLimit }),
      batches: [batch],
    })
  }

  request(request: RpcRequest): Promise<unknown> {
    if (request.method !== 'market.replay_next' || !request.params || typeof request.params !== 'object') {
      return this.process.request(request)
    }
    const replayId = (request.params as Record<string, unknown>).replay_id
    const timing = typeof replayId === 'string' ? this.replayTiming.get(replayId) : undefined
    const timeoutMs = timing
      ? Math.max(this.baseRequestTimeoutMs, timing.paceIntervalMs + 1_000)
      : this.baseRequestTimeoutMs
    return this.process.request(request, timeoutMs)
  }

  status(): ReturnType<JsonlSidecarProcess['status']> {
    return this.process.status()
  }

  stop(): Promise<void> {
    this.replayTiming.clear()
    return this.process.stop({
      jsonrpc: '2.0',
      id: this.nextId('market-rpc'),
      method: 'market.shutdown',
      params: {},
    })
  }

  private nextId(prefix: string): string {
    this.sequence += 1
    return `${prefix}-${this.sequence}`
  }
}
