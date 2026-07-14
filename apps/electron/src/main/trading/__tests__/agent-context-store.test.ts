import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { buildAgentMarketSnapshot } from '@trade-god/market-state'

import { AgentContextStore } from '../agent-context-store.ts'

const batchUrl = new URL('../../../../../../packages/trading-contracts/examples/market-trade-batch.v1.json', import.meta.url)

test('stores market context once, queues only its reference, and resolves only for the addressed specialist', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'trade-god-context-store-'))
  let clock = 0
  const times = [
    '2026-07-13T12:00:00.000Z', '2026-07-13T12:00:01.000Z',
    '2026-07-13T12:00:02.000Z', '2026-07-13T12:00:03.000Z',
  ]
  const store = new AgentContextStore(root, () => times[clock++]!, () => 'delivery-context-store-1')
  const batch = await Bun.file(batchUrl).json()
  const snapshot = buildAgentMarketSnapshot({
    snapshotId: 'snapshot-context-store-1', traceId: 'trace-context-store-1',
    intervalNs: '20000000000', watermarkNs: '1783780230000000000', staleAfterNs: '5000000000',
    recentTradeLimit: 2, closedCandleLimit: 1, batches: [batch],
  })

  try {
    const [reference, duplicate] = await Promise.all([store.publish(snapshot), store.publish(snapshot)])
    expect(duplicate).toEqual(reference)
    const delivery = await store.queue(reference, {
      agentId: 'order-flow-specialist', capability: 'order-flow-interpretation',
    })
    expect(delivery).not.toHaveProperty('snapshot')
    expect(delivery.context.content_sha256).toBe(snapshot.snapshot_content_sha256)
    await expect(store.resolveForConsumer(delivery.delivery_id, 'wrong-specialist')).rejects.toThrow('different consumer')
    const resolved = await store.resolveForConsumer(delivery.delivery_id, 'order-flow-specialist')
    expect(resolved.receipt.status).toBe('resolved')
    expect(resolved.snapshot).toEqual(snapshot)
    expect((await store.readDelivery(delivery.delivery_id)).status).toBe('resolved')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('fails closed when a reference is tampered', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'trade-god-context-tamper-'))
  const store = new AgentContextStore(root, () => '2026-07-13T12:00:00.000Z')
  const batch = await Bun.file(batchUrl).json()
  const snapshot = buildAgentMarketSnapshot({
    snapshotId: 'snapshot-context-tamper', traceId: 'trace-context-tamper', intervalNs: '20000000000',
    watermarkNs: '1783780230000000000', staleAfterNs: '5000000000', batches: [batch],
  })
  try {
    const reference = await store.publish(snapshot)
    await expect(store.queue({ ...reference, snapshot_id: 'snapshot-forged' }, {
      agentId: 'order-flow-specialist', capability: 'order-flow-interpretation',
    })).rejects.toThrow('does not match')
    await expect(store.queue({ ...reference, context_id: 'safe/../../outside' }, {
      agentId: 'order-flow-specialist', capability: 'order-flow-interpretation',
    })).rejects.toThrow('unsafe path')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
