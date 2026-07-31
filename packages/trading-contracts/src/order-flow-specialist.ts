import { z } from 'zod'

import { agentContextDeliveryReceiptSchema } from './agent-context.ts'
import { decimalStringSchema, identifierSchema, semverSchema, sha256Schema, utcTimestampSchema } from './common.ts'
import { agentMarketSnapshotSchema } from './market-data.ts'
import { canonicalOrderFlowArtifactSchema } from './order-flow.ts'
import {
  ORDER_FLOW_INTERPRETATION_SCHEMA_VERSION,
  ORDER_FLOW_SPECIALIST_REQUEST_SCHEMA_VERSION,
} from './version.ts'

export const ORDER_FLOW_SPECIALIST_AGENT = {
  id: 'order-flow-specialist',
  version: '0.1.0',
  skill: { id: 'order-flow-specialist', version: '0.1.0' },
} as const

export const ORDER_FLOW_SPECIALIST_DOCTRINE = `Interpret only supplied deterministic evidence.
Copy deterministic measurements exactly; never invent, recalculate, or silently correct them.
Separate measurements, observations, and hypotheses.
Treat aggressor classification as unavailable unless explicit upstream provenance proves observed or inferred status.
Displayed liquidity is not participant intent; never diagnose spoofing from size or a snapshot.
Do not claim absorption, exhaustion, or hidden liquidity without adequate event sequence and feed capability.
State feed limitations, a plausible alternative hypothesis, disconfirming evidence, conditions, invalidation, and expiry.
Refuse stale, unavailable, mismatched, or invalid evidence.
Provide analysis only: never provide an order, entry, size, stop, target, broker action, or execution instruction.`
export const ORDER_FLOW_SPECIALIST_DOCTRINE_VERSION = '0.1.0'
export const ORDER_FLOW_SPECIALIST_DOCTRINE_SHA256 = '1b16624b002f4d411c855006145270c1793c94f755473f74928ab6930d18c8a2'

const analysisAuthoritySchema = z.object({
  purpose: z.literal('analysis'),
  execution_allowed: z.literal(false),
  order_submission_allowed: z.literal(false),
}).strict()

export const orderFlowSpecialistRequestSchema = z.object({
  request_schema_version: z.literal(ORDER_FLOW_SPECIALIST_REQUEST_SCHEMA_VERSION),
  request_id: identifierSchema,
  trace_id: identifierSchema,
  created_at: utcTimestampSchema,
  assignment: z.object({
    question: z.string().trim().min(1).max(2_000),
    horizon: z.enum(['immediate', 'intraday']),
  }).strict(),
  agent: z.object({
    id: z.literal(ORDER_FLOW_SPECIALIST_AGENT.id),
    version: semverSchema,
    doctrine_version: z.literal(ORDER_FLOW_SPECIALIST_DOCTRINE_VERSION),
    doctrine_sha256: z.literal(ORDER_FLOW_SPECIALIST_DOCTRINE_SHA256),
  }).strict(),
  authority: analysisAuthoritySchema,
  delivery: agentContextDeliveryReceiptSchema,
  snapshot: agentMarketSnapshotSchema,
  artifact: canonicalOrderFlowArtifactSchema,
}).strict().superRefine((request, context) => {
  const identities = [request.delivery.trace_id, request.snapshot.trace_id, request.artifact.meta.trace_id]
  if (identities.some((traceId) => traceId !== request.trace_id)) {
    context.addIssue({ code: 'custom', path: ['trace_id'], message: 'All specialist inputs must share one trace identity' })
  }
  if (request.delivery.status !== 'resolved') {
    context.addIssue({ code: 'custom', path: ['delivery', 'status'], message: 'Specialist context must be resolved before interpretation' })
  }
  if (request.delivery.consumer.agent_id !== request.agent.id) {
    context.addIssue({ code: 'custom', path: ['delivery', 'consumer'], message: 'Context must be addressed to this specialist' })
  }
  if (request.delivery.consumer.capability !== 'order-flow-interpretation') {
    context.addIssue({ code: 'custom', path: ['delivery', 'consumer', 'capability'], message: 'Context capability is not Order Flow interpretation' })
  }
  const delivered = request.delivery.context
  if (
    delivered.snapshot_id !== request.snapshot.snapshot_id
    || delivered.content_sha256 !== request.snapshot.snapshot_content_sha256
    || delivered.trace_id !== request.snapshot.trace_id
    || delivered.instrument_id !== request.snapshot.instrument.id
    || delivered.context_schema_version !== request.snapshot.snapshot_schema_version
    || JSON.stringify(delivered.authority) !== JSON.stringify(request.snapshot.authority)
  ) {
    context.addIssue({ code: 'custom', path: ['delivery', 'context'], message: 'Delivered context identity must match the supplied snapshot' })
  }
  if (request.snapshot.instrument.id !== request.artifact.instrument_id) {
    context.addIssue({ code: 'custom', path: ['artifact', 'instrument_id'], message: 'Snapshot and artifact instruments must match' })
  }
  if (request.snapshot.readiness.session.window.session_id !== request.artifact.session_id) {
    context.addIssue({ code: 'custom', path: ['snapshot', 'readiness', 'session'], message: 'Snapshot and artifact sessions must match' })
  }
  if (!request.snapshot.provenance.batches.some((batch) => (
    batch.batch_id === request.artifact.input.batch_id
    &&
    batch.canonical_events_sha256 === request.artifact.input.canonical_events_sha256
    && batch.source_sha256 === request.artifact.input.source_sha256
  ))) {
    context.addIssue({ code: 'custom', path: ['snapshot', 'provenance'], message: 'Artifact source must exist in snapshot provenance' })
  }
})

export const orderFlowMeasurementsSchema = z.object({
  event_count: z.number().int().positive(),
  total_volume: decimalStringSchema,
  buy_volume: decimalStringSchema,
  sell_volume: decimalStringSchema,
  unknown_volume: decimalStringSchema,
  delta: decimalStringSchema,
  point_of_control_price: decimalStringSchema,
}).strict()

const evidenceRefsSchema = z.array(identifierSchema).min(1).max(8)
const orderFlowEvidencePredicateSchema = z.discriminatedUnion('signal', [
  z.object({ signal: z.literal('delta'), state: z.enum(['positive', 'negative', 'balanced', 'increasing', 'decreasing']), evidence_refs: evidenceRefsSchema }).strict(),
  z.object({ signal: z.literal('aggressor-volume'), state: z.enum(['dominant', 'balanced', 'increasing', 'decreasing']), evidence_refs: evidenceRefsSchema }).strict(),
  z.object({ signal: z.literal('price-response'), state: z.enum(['positive', 'negative', 'balanced', 'increasing', 'decreasing']), evidence_refs: evidenceRefsSchema }).strict(),
  z.object({ signal: z.literal('sample-size'), state: z.enum(['sufficient', 'insufficient']), evidence_refs: evidenceRefsSchema }).strict(),
  z.object({ signal: z.literal('freshness'), state: z.enum(['fresh', 'stale']), evidence_refs: evidenceRefsSchema }).strict(),
  z.object({ signal: z.literal('quality'), state: z.enum(['valid', 'invalid']), evidence_refs: evidenceRefsSchema }).strict(),
])

const interpretationBase = {
  interpretation_schema_version: z.literal(ORDER_FLOW_INTERPRETATION_SCHEMA_VERSION),
  interpretation_id: identifierSchema,
  trace_id: identifierSchema,
  created_at: utcTimestampSchema,
  agent: z.object({
    id: z.literal(ORDER_FLOW_SPECIALIST_AGENT.id),
    version: semverSchema,
    doctrine_version: z.literal(ORDER_FLOW_SPECIALIST_DOCTRINE_VERSION),
    doctrine_sha256: z.literal(ORDER_FLOW_SPECIALIST_DOCTRINE_SHA256),
  }).strict(),
  model: z.object({ provider_model: identifierSchema, warning: z.string().max(500).optional() }).strict(),
  authority: analysisAuthoritySchema.extend({ trade_instruction_provided: z.literal(false) }).strict(),
  inputs: z.object({
    request_id: identifierSchema,
    snapshot_id: identifierSchema,
    snapshot_sha256: sha256Schema,
    artifact_id: identifierSchema,
    artifact_sha256: sha256Schema,
    delivery_id: identifierSchema,
  }).strict(),
  quality: z.object({
    state: z.enum(['sufficient', 'limited', 'refused']),
    feed_aggressor_side: z.enum(['observed', 'inferred', 'unavailable']),
    depth: z.enum(['mbo', 'mbp', 'trades-only', 'unavailable']),
    limitations: z.array(z.string().min(1).max(500)).max(20),
  }).strict(),
}

const analyzedInterpretationSchema = z.object({
  ...interpretationBase,
  status: z.literal('analyzed'),
  measurements: orderFlowMeasurementsSchema,
  observations: z.array(z.object({
    statement: z.string().min(1).max(1_000),
    evidence_refs: z.array(identifierSchema).min(1).max(8),
  }).strict()).min(1).max(12),
  thesis: z.object({
    classification: z.enum(['buying-pressure', 'selling-pressure', 'balanced', 'indeterminate']),
    confidence: z.number().min(0).max(1),
    rationale: z.string().min(1).max(2_000),
  }).strict(),
  alternative_hypotheses: z.array(z.object({
    hypothesis: z.string().min(1).max(1_000),
    disconfirming_evidence: z.string().min(1).max(1_000),
  }).strict()).min(1).max(5),
  // Scenarios are deliberately machine-coded instead of executable prose. They
  // describe evidence state transitions and cannot encode an order instruction.
  scenarios: z.array(z.object({
    name: identifierSchema,
    condition: orderFlowEvidencePredicateSchema,
    invalidation: orderFlowEvidencePredicateSchema,
    expires: z.enum(['next-context-refresh', 'session-end']),
  }).strict()).max(3),
  no_trade_reasons: z.array(z.string().min(1).max(500)).max(10),
  warnings: z.array(z.string().min(1).max(500)).max(10),
}).strict()

const refusedInterpretationSchema = z.object({
  ...interpretationBase,
  status: z.literal('refused'),
  refusal: z.object({ code: identifierSchema, reason: z.string().min(1).max(1_000) }).strict(),
}).strict()

export const orderFlowInterpretationSchema = z.discriminatedUnion('status', [
  analyzedInterpretationSchema,
  refusedInterpretationSchema,
])

export type OrderFlowSpecialistRequest = z.infer<typeof orderFlowSpecialistRequestSchema>
export type OrderFlowInterpretation = z.infer<typeof orderFlowInterpretationSchema>
