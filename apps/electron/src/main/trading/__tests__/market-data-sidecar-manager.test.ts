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

      expect(health).toMatchObject({ state: 'ready', protocol_version: 'market-data-rpc@1' })
      expect(batch.events).toHaveLength(4)
      expect(batch.trace_id).toBe('trace-electron-market-001')
      expect(snapshot).toMatchObject({
        current_price: { value: '5592.00' },
        closed: [{ trade_count: 2 }],
        developing: { trade_count: 2 },
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
})
