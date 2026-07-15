import { randomUUID } from 'node:crypto'

import {
  ORDER_FLOW_SPECIALIST_AGENT,
  ORDER_FLOW_SPECIALIST_DOCTRINE_SHA256,
  ORDER_FLOW_SPECIALIST_DOCTRINE_VERSION,
  ORDER_FLOW_SPECIALIST_REQUEST_SCHEMA_VERSION,
  orderFlowSpecialistRequestSchema,
  type OrderFlowInterpretation,
} from '@trade-god/contracts'
import type { AnalyzeFixtureInput } from '@trade-god/client'
import { buildAgentMarketSnapshot } from '@trade-god/market-state'

import type { AgentContextStore } from './agent-context-store.ts'
import type { CanonicalOrderFlowPipeline } from './canonical-order-flow-pipeline.ts'
import type { LoadFixtureAgentSnapshotInput } from './market-data-sidecar-manager.ts'
import type { OrderFlowSpecialist } from './order-flow-specialist.ts'

export interface InterpretFixtureInput {
  analysis: AnalyzeFixtureInput
  context: Omit<LoadFixtureAgentSnapshotInput, 'fixtureId' | 'traceId' | 'batchId'>
  assignment: { question: string; horizon: 'immediate' | 'intraday' }
}

export class OrderFlowSpecialistPipeline {
  constructor(
    private readonly canonical: Pick<CanonicalOrderFlowPipeline, 'analyzeFixtureEvidence'>,
    private readonly contextStore: Pick<AgentContextStore, 'publish' | 'queue' | 'resolveForConsumer'>,
    private readonly specialist: Pick<OrderFlowSpecialist, 'interpret'>,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async interpretFixture(input: InterpretFixtureInput): Promise<OrderFlowInterpretation> {
    const traceId = input.analysis.traceId ?? `trace-order-flow-specialist-${randomUUID()}`
    const { batch, artifact } = await this.canonical.analyzeFixtureEvidence({ ...input.analysis, traceId })
    const snapshot = buildAgentMarketSnapshot({
      snapshotId: input.context.snapshotId,
      traceId,
      intervalNs: input.context.intervalNs,
      watermarkNs: input.context.watermarkNs,
      staleAfterNs: input.context.staleAfterNs,
      ...(input.context.recentTradeLimit === undefined ? {} : { recentTradeLimit: input.context.recentTradeLimit }),
      ...(input.context.closedCandleLimit === undefined ? {} : { closedCandleLimit: input.context.closedCandleLimit }),
      ...(input.context.qualityIssueLimit === undefined ? {} : { qualityIssueLimit: input.context.qualityIssueLimit }),
      batches: [batch],
    })
    const reference = await this.contextStore.publish(snapshot)
    const queued = await this.contextStore.queue(reference, {
      agentId: ORDER_FLOW_SPECIALIST_AGENT.id,
      capability: 'order-flow-interpretation',
    })
    const resolved = await this.contextStore.resolveForConsumer(queued.delivery_id, ORDER_FLOW_SPECIALIST_AGENT.id)
    const request = orderFlowSpecialistRequestSchema.parse({
      request_schema_version: ORDER_FLOW_SPECIALIST_REQUEST_SCHEMA_VERSION,
      request_id: `order-flow-request-${randomUUID()}`,
      trace_id: traceId,
      created_at: this.now(),
      assignment: input.assignment,
      agent: {
        id: ORDER_FLOW_SPECIALIST_AGENT.id,
        version: ORDER_FLOW_SPECIALIST_AGENT.version,
        doctrine_version: ORDER_FLOW_SPECIALIST_DOCTRINE_VERSION,
        doctrine_sha256: ORDER_FLOW_SPECIALIST_DOCTRINE_SHA256,
      },
      authority: { purpose: 'analysis', execution_allowed: false, order_submission_allowed: false },
      delivery: resolved.receipt,
      snapshot: resolved.snapshot,
      artifact,
    })
    return this.specialist.interpret(request)
  }
}
