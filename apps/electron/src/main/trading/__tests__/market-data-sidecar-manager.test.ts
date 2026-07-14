import { describe, expect, test } from 'bun:test'
import path from 'node:path'

import { MarketDataClientError } from '@trade-god/client'

import { MarketDataSidecarManager } from '../market-data-sidecar-manager.ts'


const repoRoot = path.resolve(import.meta.dir, '../../../../../..')
const sidecarRoot = path.join(repoRoot, 'sidecars', 'market-data-engine')
const fixtureRoot = path.join(repoRoot, 'packages', 'trading-testkit', 'fixtures', 'es-demo')


function manager(): MarketDataSidecarManager {
  return new MarketDataSidecarManager({
    command: [
      path.join(sidecarRoot, '.venv', 'bin', 'python'),
      '-m',
      'trade_god_market_data.cli',
      '--fixture-root',
      fixtureRoot,
    ],
    cwd: sidecarRoot,
    requestTimeoutMs: 5_000,
    maxLineBytes: 1_000_000,
    maxStderrBytes: 4_096,
  })
}


describe('MarketDataSidecarManager', () => {
  test('supervises the real Python sidecar through validated health, fixture load, and shutdown', async () => {
    const sidecar = manager()
    try {
      const health = await sidecar.health()
      const batch = await sidecar.loadFixture({
        fixtureId: 'es-demo-2026-07-11',
        traceId: 'trace-electron-market-001',
        batchId: 'batch-electron-market-001',
      })
      const snapshot = await sidecar.loadFixtureSnapshot({
        fixtureId: 'es-demo-2026-07-11',
        traceId: 'trace-electron-candles-001',
        batchId: 'batch-electron-candles-001',
        snapshotId: 'snapshot-electron-candles-001',
        intervalNs: '20000000000',
        watermarkNs: '1783780230000000000',
      })
      const agentContext = await sidecar.loadFixtureAgentSnapshot({
        fixtureId: 'es-demo-2026-07-11',
        traceId: 'trace-electron-agent-context',
        batchId: 'batch-electron-agent-context',
        snapshotId: 'snapshot-electron-agent-context',
        intervalNs: '20000000000',
        watermarkNs: '1783780230000000000',
        staleAfterNs: '5000000000',
        recentTradeLimit: 2,
        closedCandleLimit: 1,
      })

      expect(health).toMatchObject({ state: 'ready', protocol_version: 'market-data-rpc@1' })
      expect(batch.events).toHaveLength(4)
      expect(batch.trace_id).toBe('trace-electron-market-001')
      expect(snapshot).toMatchObject({
        current_price: { value: '5592.00' },
        closed: [{ trade_count: 2 }],
        developing: { trade_count: 2 },
      })
      expect(agentContext).toMatchObject({
        authority: { purpose: 'analysis', execution_allowed: false, order_submission_allowed: false },
        current: { price: { value: '5592.00' } },
        trades: { returned_count: 2, visible_count: 4, truncated: true },
        freshness: { state: 'fresh' },
      })
      expect(sidecar.status()).toMatchObject({ state: 'ready', pid: expect.any(Number) })
    } finally {
      await sidecar.stop()
    }
    expect(sidecar.status().state).toBe('stopped')
  })

  test('normalizes a real typed fixture error without crashing the supervised process', async () => {
    const sidecar = manager()
    try {
      await expect(sidecar.loadFixture({
        fixtureId: 'missing-fixture',
        traceId: 'trace-missing-fixture',
        batchId: 'batch-missing-fixture',
      })).rejects.toBeInstanceOf(MarketDataClientError)
      expect((await sidecar.health()).state).toBe('ready')
      expect(sidecar.status().state).toBe('ready')
    } finally {
      await sidecar.stop()
    }
  })

  test('pulls a real fixture at a bounded pace with consumer backpressure', async () => {
    const sidecar = manager()
    const eventIds: string[] = []
    const started = performance.now()
    try {
      const batch = await sidecar.replayFixture({
        fixtureId: 'es-demo-2026-07-11', traceId: 'trace-paced-replay', batchId: 'batch-paced-replay',
        replayId: 'replay-paced-manager', cancellationId: 'cancel-paced-manager',
        paceIntervalMs: 10, timeoutMs: 5_000,
      }, async (event) => {
        eventIds.push(event.event_id)
        await Bun.sleep(2)
      })
      expect(batch.events.map((event) => event.event_id)).toEqual(eventIds)
      expect(batch.events).toHaveLength(4)
      expect(performance.now() - started).toBeGreaterThanOrEqual(25)
      expect(sidecar.status().state).toBe('ready')
    } finally {
      await sidecar.stop()
    }
  })

  test('cancels a waiting replay as a typed domain outcome while the process stays ready', async () => {
    const sidecar = manager()
    try {
      const session = await sidecar.startReplay({
        fixtureId: 'es-demo-2026-07-11', traceId: 'trace-canceled-replay', batchId: 'batch-canceled-replay',
        replayId: 'replay-canceled-manager', cancellationId: 'cancel-canceled-manager',
        paceIntervalMs: 500, timeoutMs: 5_000,
      })
      expect((await sidecar.nextReplay(session.replay_id)).state).toBe('event')
      const waiting = sidecar.nextReplay(session.replay_id).catch((error) => error)
      await Bun.sleep(20)
      expect((await sidecar.cancelReplay(session.cancellation_id)).state).toBe('canceled')
      expect(await waiting).toMatchObject({
        code: 'CANCELED', category: 'canceled', retryable: false,
      })
      expect(sidecar.status().state).toBe('ready')
      expect((await sidecar.health()).state).toBe('ready')
    } finally {
      await sidecar.stop()
    }
  })
})
