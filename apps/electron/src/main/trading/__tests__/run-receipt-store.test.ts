import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { TradingRunReceiptStore } from '../run-receipt-store.ts'

test('atomically persists and validates a trace-linked run receipt', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'trade-god-receipts-'))
  const store = new TradingRunReceiptStore(directory)
  const receipt = {
    receipt_schema_version: 'trade-run-receipt@1' as const, receipt_id: 'receipt-test-1', trace_id: 'trace-test-1',
    status: 'succeeded' as const, started_at: '2026-07-12T12:00:00.000Z', completed_at: '2026-07-12T12:00:01.000Z',
    request: { fixture_id: 'es-demo', fixture_sha256: 'a'.repeat(64) },
    artifact: { artifact_id: 'artifact-test-1', content_hash: 'b'.repeat(64) },
  }
  try { await store.write(receipt); expect(await store.read(receipt.receipt_id)).toEqual(receipt) }
  finally { rmSync(directory, { recursive: true, force: true }) }
})

test('persists a canonical market-batch receipt without fixture-shaped identity', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'trade-god-canonical-receipts-'))
  const store = new TradingRunReceiptStore(directory)
  const receipt = {
    receipt_schema_version: 'trade-run-receipt@2' as const, receipt_id: 'receipt-canonical-1', trace_id: 'trace-analysis-1',
    status: 'succeeded' as const, started_at: '2026-07-13T12:00:00.000Z', completed_at: '2026-07-13T12:00:01.000Z',
    request: {
      kind: 'canonical-market-batch' as const, batch_id: 'batch-canonical-1', batch_trace_id: 'trace-market-1',
      canonical_events_sha256: 'a'.repeat(64), source_sha256: 'b'.repeat(64), instrument_id: 'CME:ESU6',
    },
    artifact: { artifact_id: 'artifact-canonical-1', content_hash: 'c'.repeat(64) },
  }
  try { await store.write(receipt); expect(await store.read(receipt.receipt_id)).toEqual(receipt) }
  finally { rmSync(directory, { recursive: true, force: true }) }
})
