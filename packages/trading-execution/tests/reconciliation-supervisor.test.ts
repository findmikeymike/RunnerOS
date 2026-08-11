import { describe, expect, test } from 'bun:test'

import type { ExecutionRecord } from '@trade-god/contracts'

import { ExecutionGatewayError, ExecutionReconciliationSupervisor } from '../src/index.ts'

const record = (intentId: string, connectionId: string): ExecutionRecord => ({
  state: 'protected',
  command: {},
  intent: { intent_id: intentId, connection_id: connectionId },
} as ExecutionRecord)

describe('execution reconciliation supervisor', () => {
  test('serializes one cycle, reconciles active records, and ignores inert records', async () => {
    const calls: string[] = []
    let release!: () => void
    const blocked = new Promise<void>((resolve) => { release = resolve })
    const active = record('intent-active', 'connection-one')
    const gateway = {
      list: async () => [active, { ...active, state: 'closed', intent: { ...active.intent, intent_id: 'closed' } }],
      reconcile: async (intentId: string) => { calls.push(intentId); await blocked; return active },
      verifyConnectionAccountCoverage: async () => ({} as never),
      setConnectionKill: async () => undefined,
      activateEmergencyHalt: async () => undefined,
    }
    const supervisor = new ExecutionReconciliationSupervisor({ gateway })
    const first = supervisor.runOnce()
    const second = supervisor.runOnce()
    release()
    await Promise.all([first, second])

    expect(calls).toEqual(['intent-active'])
    expect(supervisor.health().consecutive_failures).toBe(0)
    expect(supervisor.health().fresh_connection_ids).toEqual(['connection-one'])
    expect(supervisor.canReleaseConnectionHalt('connection-one')).toBe(true)
  })

  test('halts new entries after sustained stale truth without changing execution state', async () => {
    let nowMs = Date.parse('2026-08-10T15:00:00.000Z')
    const killed: string[] = []
    const active = record('intent-active', 'connection-one')
    const supervisor = new ExecutionReconciliationSupervisor({
      gateway: {
        list: async () => [active],
        reconcile: async () => { throw new Error('provider unavailable') },
        verifyConnectionAccountCoverage: async () => { throw new Error('not expected') },
        setConnectionKill: async (connectionId: string) => { killed.push(connectionId) },
        activateEmergencyHalt: async () => undefined,
      },
      now: () => new Date(nowMs).toISOString(),
      intervalMs: 1_000,
      staleAfterMs: 2_000,
    })

    await supervisor.runOnce()
    nowMs += 1_000
    await supervisor.runOnce()
    expect(killed).toEqual([])
    nowMs += 1_000
    await supervisor.runOnce()

    expect(killed).toEqual(['connection-one'])
    expect(active.state).toBe('protected')
    expect(supervisor.health().stale_connection_ids).toEqual(['connection-one'])
    expect(supervisor.canReleaseConnectionHalt('connection-one')).toBe(false)
  })

  test('stop clears scheduling and waits for an in-flight cycle', async () => {
    let scheduled: (() => void) | undefined
    let cleared = false
    let release!: () => void
    const blocked = new Promise<void>((resolve) => { release = resolve })
    const active = record('intent-active', 'connection-one')
    const supervisor = new ExecutionReconciliationSupervisor({
      gateway: {
        list: async () => [active],
        reconcile: async () => { await blocked; return active },
        verifyConnectionAccountCoverage: async () => ({} as never),
        setConnectionKill: async () => undefined,
        activateEmergencyHalt: async () => undefined,
      },
      setTimer: (callback) => { scheduled = callback; return 1 as ReturnType<typeof setTimeout> },
      clearTimer: () => { cleared = true },
    })
    supervisor.start()
    scheduled!()
    const stopping = supervisor.stop()
    release()
    await stopping

    expect(cleared).toBe(false)
    expect(supervisor.health().running).toBe(false)
  })

  test('falls back to the process emergency halt if durable connection halt fails', async () => {
    let nowMs = Date.parse('2026-08-10T15:00:00.000Z')
    let emergencyHalts = 0
    const active = record('intent-active', 'connection-one')
    const supervisor = new ExecutionReconciliationSupervisor({
      gateway: {
        list: async () => [active],
        reconcile: async () => { throw new Error('provider unavailable') },
        verifyConnectionAccountCoverage: async () => { throw new Error('not expected') },
        setConnectionKill: async () => { throw new Error('disk unavailable') },
        activateEmergencyHalt: async () => { emergencyHalts += 1 },
      },
      now: () => new Date(nowMs).toISOString(),
      intervalMs: 1_000,
      staleAfterMs: 1_000,
    })

    await supervisor.runOnce()
    nowMs += 1_000
    await supervisor.runOnce()

    expect(emergencyHalts).toBe(1)
    expect(supervisor.health().stale_connection_ids).toEqual(['connection-one'])
  })

  test('emergency-halts immediately when execution records cannot be enumerated', async () => {
    let emergencyHalts = 0
    const supervisor = new ExecutionReconciliationSupervisor({
      gateway: {
        list: async () => { throw new Error('execution store unavailable') },
        reconcile: async () => { throw new Error('unreachable') },
        verifyConnectionAccountCoverage: async () => { throw new Error('unreachable') },
        setConnectionKill: async () => undefined,
        activateEmergencyHalt: async () => { emergencyHalts += 1 },
      },
    })

    await supervisor.runOnce()

    expect(emergencyHalts).toBe(1)
    expect(supervisor.health().consecutive_failures).toBe(1)
  })

  test('rebuilds exact flat REST truth for an event hint even without an execution record', async () => {
    const probes: string[] = []
    const supervisor = new ExecutionReconciliationSupervisor({
      gateway: {
        list: async () => [],
        reconcile: async () => { throw new Error('not expected') },
        verifyConnectionAccountCoverage: async (connectionId: string) => {
          probes.push(connectionId)
          return {} as never
        },
        setConnectionKill: async () => undefined,
        activateEmergencyHalt: async () => undefined,
      },
    })

    supervisor.invalidate('connection-flat')
    await supervisor.runOnce()

    expect(probes).toEqual(['connection-flat'])
    expect(supervisor.health().fresh_connection_ids).toEqual(['connection-flat'])
  })

  test('halts immediately when REST proves unmanaged provider exposure', async () => {
    const killed: string[] = []
    const supervisor = new ExecutionReconciliationSupervisor({
      gateway: {
        list: async () => [],
        reconcile: async () => { throw new Error('not expected') },
        verifyConnectionAccountCoverage: async () => {
          throw new ExecutionGatewayError(
            'RECONCILIATION_DIVERGENCE',
            'Manual provider exposure is not Trade God-owned.',
          )
        },
        setConnectionKill: async (connectionId: string) => { killed.push(connectionId) },
        activateEmergencyHalt: async () => undefined,
      },
      intervalMs: 1_000,
      staleAfterMs: 360_000,
    })

    supervisor.invalidate('connection-divergent')
    await supervisor.runOnce()

    expect(killed).toEqual(['connection-divergent'])
    expect(supervisor.health().stale_connection_ids).toEqual(['connection-divergent'])
  })

  test('does not lose a same-account hint that arrives during its in-flight REST rebuild', async () => {
    const scheduled: Array<{ callback: () => void; delay: number }> = []
    const probes: string[] = []
    let release!: () => void
    const blocked = new Promise<void>((resolve) => { release = resolve })
    let probeCount = 0
    const supervisor = new ExecutionReconciliationSupervisor({
      gateway: {
        list: async () => [],
        reconcile: async () => { throw new Error('not expected') },
        verifyConnectionAccountCoverage: async (connectionId: string) => {
          probes.push(connectionId)
          probeCount += 1
          if (probeCount === 1) await blocked
          return {} as never
        },
        setConnectionKill: async () => undefined,
        activateEmergencyHalt: async () => undefined,
      },
      intervalMs: 1_000,
      setTimer: (callback, delay) => {
        scheduled.push({ callback, delay })
        return scheduled.length as unknown as ReturnType<typeof setTimeout>
      },
      clearTimer: () => undefined,
    })

    supervisor.start()
    supervisor.invalidate('connection-flat')
    scheduled.shift()!.callback()
    await Promise.resolve()
    supervisor.invalidate('connection-flat')
    release()
    await Bun.sleep(0)
    const immediate = scheduled.find((timer) => timer.delay === 0)
    expect(immediate).toBeDefined()
    immediate!.callback()
    await Bun.sleep(0)

    expect(probes).toEqual(['connection-flat', 'connection-flat'])
    expect(supervisor.health().fresh_connection_ids).toEqual(['connection-flat'])
    await supervisor.stop()
  })
})
