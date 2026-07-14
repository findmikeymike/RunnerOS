import {
  MarketDataClient,
  type LoadMarketFixtureInput,
  type RpcRequest,
  type RpcTransport,
} from '@trade-god/client'
import type { AgentMarketSnapshot, MarketCandleSeries, MarketDataHealth, MarketTradeBatch } from '@trade-god/contracts'
import { buildAgentMarketSnapshot, buildMarketReplaySnapshot } from '@trade-god/market-state'

import {
  JsonlSidecarProcess,
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

  constructor(options: MarketDataManagerOptions) {
    this.process = new JsonlSidecarProcess({ serviceLabel: 'Market Data', ...options })
    this.client = new MarketDataClient({
      transport: this,
      nextId: (prefix) => this.nextId(prefix),
    })
  }

  health(): Promise<MarketDataHealth> {
    return this.client.health()
  }

  loadFixture(input: LoadMarketFixtureInput): Promise<MarketTradeBatch> {
    return this.client.loadFixture(input)
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
    return this.process.request(request)
  }

  status(): ReturnType<JsonlSidecarProcess['status']> {
    return this.process.status()
  }

  stop(): Promise<void> {
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
