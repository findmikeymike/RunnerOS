import { expect, test } from 'bun:test'

import {
  agentContextDeliveryReceiptSchema,
  agentContextReferenceSchema,
} from '../src/index.ts'

const reference = {
  reference_schema_version: 'agent-context-reference@1' as const,
  context_id: `market-context-${'a'.repeat(64)}`,
  context_schema_version: 'agent-market-snapshot@2' as const,
  content_sha256: 'a'.repeat(64),
  snapshot_id: 'snapshot-agent-context-1',
  trace_id: 'trace-agent-context-1',
  instrument_id: 'CME:ESU6',
  created_at: '2026-07-13T12:00:00.000Z',
  authority: { purpose: 'analysis' as const, execution_allowed: false as const, order_submission_allowed: false as const },
}

test('accepts a bounded analysis-only market context reference', () => {
  expect(agentContextReferenceSchema.parse(reference)).toEqual(reference)
  expect(agentContextReferenceSchema.safeParse({ ...reference, authority: { ...reference.authority, execution_allowed: true } }).success).toBe(false)
})

test('requires honest reference-only delivery lifecycle receipts', () => {
  const queued = {
    delivery_receipt_schema_version: 'agent-context-delivery-receipt@1' as const,
    delivery_id: 'delivery-agent-context-1', trace_id: reference.trace_id,
    consumer: { agent_id: 'order-flow-specialist', capability: 'order-flow-interpretation' },
    delivery_mode: 'reference' as const, context: reference, status: 'queued' as const,
    queued_at: '2026-07-13T12:00:01.000Z',
  }
  expect(agentContextDeliveryReceiptSchema.parse(queued)).toEqual(queued)
  expect(agentContextDeliveryReceiptSchema.safeParse({ ...queued, status: 'resolved' }).success).toBe(false)
  expect(agentContextDeliveryReceiptSchema.safeParse({ ...queued, trace_id: 'trace-wrong' }).success).toBe(false)
})
