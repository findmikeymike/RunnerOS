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
