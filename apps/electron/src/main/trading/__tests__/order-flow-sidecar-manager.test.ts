import { describe, expect, test } from 'bun:test'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { loadEsDemoFixture } from '@trade-god/testkit'

import {
  OrderFlowSidecarManager,
  SidecarExitedError,
  SidecarProtocolError,
  SidecarRequestTimeoutError,
} from '../order-flow-sidecar-manager.ts'

const repoRoot = path.resolve(import.meta.dir, '../../../../../..')
const orderFlowCli = path.join(repoRoot, 'sidecars/order-flow-engine/src/cli.ts')
const fixtureDir = path.join(import.meta.dir, 'fixtures')

function manager(
  script = orderFlowCli,
  requestTimeoutMs = 1_000,
  limits: { maxLineBytes?: number; maxStderrBytes?: number } = {},
  env: Record<string, string> = {},
) {
  return new OrderFlowSidecarManager({
    command: [process.execPath, script],
    cwd: repoRoot,
    requestTimeoutMs,
    maxLineBytes: limits.maxLineBytes ?? 1_000_000,
    maxStderrBytes: limits.maxStderrBytes ?? 4_096,
    env: { TRADE_GOD_SIDECAR_INSTANCE_ID: 'electron-test-sidecar', ...env },
    now: () => new Date().toISOString(),
  })
}

describe('OrderFlowSidecarManager', () => {
  test('supervises the real sidecar through health, analysis, and clean shutdown', async () => {
    const fixture = await loadEsDemoFixture()
    const sidecar = manager()

    const health = await sidecar.health()
    const artifact = await sidecar.analyzeFixture({
      fixture: { id: fixture.manifest.fixture_id, sha256: fixture.manifest.events_sha256 },
      instrument: fixture.manifest.instrument,
      session: fixture.manifest.session,
      analysis: { name: 'order-flow-summary', version: '0.1.0', configuration_hash: 'b'.repeat(64) },
      timeoutMs: 500,
    })

    expect(health.state).toBe('ready')
    expect(artifact.summary.delta).toBe('6')
    expect(sidecar.status()).toMatchObject({ state: 'ready', pid: expect.any(Number) })

    await sidecar.stop()
    expect(sidecar.status().state).toBe('stopped')
  })

  test('times out a silent process and can still stop it', async () => {
    const sidecar = manager(path.join(fixtureDir, 'silent-sidecar.ts'), 50)

    await expect(sidecar.health()).rejects.toBeInstanceOf(SidecarRequestTimeoutError)
    await sidecar.stop()

    expect(sidecar.status().state).toBe('stopped')
  })

  test('rejects pending work when the child exits', async () => {
    const sidecar = manager(path.join(fixtureDir, 'crashing-sidecar.ts'), 500)

    await expect(sidecar.health()).rejects.toBeInstanceOf(SidecarExitedError)
    expect(sidecar.status().state).toBe('failed')

    await sidecar.stop()
  })

  test('fails closed when stdout exceeds the protocol line limit', async () => {
    const sidecar = manager(path.join(fixtureDir, 'oversized-sidecar.ts'), 500, { maxLineBytes: 64 })

    await expect(sidecar.health()).rejects.toBeInstanceOf(SidecarProtocolError)
    expect(sidecar.status().state).toBe('failed')

    await sidecar.stop()
  })

  test('bounds captured stderr to the configured tail', async () => {
    const sidecar = manager(path.join(fixtureDir, 'noisy-crashing-sidecar.ts'), 500, { maxStderrBytes: 32 })

    await expect(sidecar.health()).rejects.toBeInstanceOf(SidecarExitedError)
    expect(sidecar.status().stderr).toHaveLength(32)

    await sidecar.stop()
  })

  test('assembles a response split across stdout chunks', async () => {
    const sidecar = manager(path.join(fixtureDir, 'partial-frame-sidecar.ts'), 500)

    const health = await sidecar.health()
    expect(health).toMatchObject({ state: 'ready' })

    await sidecar.stop()
  })

  test('restarts on the next request after a crash without replaying failed work', async () => {
    const marker = path.join(tmpdir(), `trade-god-crash-once-${process.pid}.marker`)
    rmSync(marker, { force: true })
    const sidecar = manager(path.join(fixtureDir, 'crash-once-sidecar.ts'), 500, {}, {
      TRADE_GOD_CRASH_ONCE_MARKER: marker,
      TRADE_GOD_REAL_SIDECAR: orderFlowCli,
    })

    try {
      await expect(sidecar.health()).rejects.toBeInstanceOf(SidecarExitedError)
      const health = await sidecar.health()
      expect(health.state).toBe('ready')
    } finally {
      await sidecar.stop()
      rmSync(marker, { force: true })
    }
  })
})
