import { describe, expect, test } from 'bun:test'
import { buildScheduledWorkRuntimeStatus, type ScheduledWorkRuntimeStatusInput } from './runtime-status'

const base: ScheduledWorkRuntimeStatusInput = {
  workspaceId: 'campaign-one',
  checkedAt: '2026-09-10T14:00:00.000Z',
  remote: false,
  executionAuthorized: true,
  schedulerRunning: true,
  background: { allowed: true, reason: 'solo' },
}

function status(overrides: Partial<ScheduledWorkRuntimeStatusInput> = {}) {
  return buildScheduledWorkRuntimeStatus({ ...base, ...overrides })
}

describe('scheduled work runtime status', () => {
  test('reports local scheduler readiness without implying a run was claimed or completed', () => {
    expect(status()).toEqual({ workspaceId: base.workspaceId, checkedAt: base.checkedAt, state: 'ready' })
    expect(status({ schedulerRunning: false }).state).toBe('scheduler-stopped')
    expect(status({ background: { allowed: true, reason: 'runner' } }).state).toBe('ready')
  })

  test('remote host wins over local license, scheduler, and team status', () => {
    expect(status({ remote: true, executionAuthorized: false, schedulerRunning: false,
      background: { allowed: false, reason: 'unsupported' } }).state).toBe('remote-host')
  })

  test('local execution entitlement is reported without mutating work', () => {
    const input = Object.freeze({ ...base, executionAuthorized: false, background: Object.freeze({ ...base.background }) })
    expect(buildScheduledWorkRuntimeStatus(input).state).toBe('license-required')
    expect(input.executionAuthorized).toBe(false)
  })

  test('a healthy designated runner elsewhere is distinct from a stopped local scheduler', () => {
    expect(status({ schedulerRunning: false, background: { allowed: false, reason: 'not-runner', runnerIsStale: false } }).state).toBe('other-runner')
    expect(status({ background: { allowed: false, reason: 'not-runner', runnerIsStale: true } }).state).toBe('runner-unavailable')
    expect(status({ background: { allowed: true, reason: 'runner', runnerIsStale: true } }).state).toBe('runner-unavailable')
  })

  test.each(['no-runner', 'handover-pending', 'recovery-pending', 'stale-observed-revision', 'stale-observed-epoch'])(
    'reports unavailable runner for %s', reason => {
      expect(status({ background: { allowed: false, reason } }).state).toBe('runner-unavailable')
    },
  )

  test.each(['manual-only', 'background-disabled', 'team-disabled'])(
    'reports deliberately disabled background work for %s', reason => {
      expect(status({ schedulerRunning: false, background: { allowed: false, reason, runnerIsStale: true } }).state).toBe('background-disabled')
    },
  )

  test.each(['unsupported', 'not-shared-folder', 'read-error', 'future-reason'])(
    'does not invent readiness for unsupported status %s', reason => {
      expect(status({ background: { allowed: false, reason } }).state).toBe('unavailable')
      expect(status({ background: { allowed: true, reason } }).state).toBe('unavailable')
    },
  )

  test('inconsistent allowed flag does not report ready', () => {
    expect(status({ background: { allowed: false, reason: 'solo' } }).state).toBe('unavailable')
  })

  test('preserves last tick as evidence without inferring offline from its age or absence', () => {
    const lastTickAt = '2020-01-01T00:00:00.000Z'
    expect(status({ lastTickAt })).toEqual({ workspaceId: base.workspaceId, checkedAt: base.checkedAt, state: 'ready', lastTickAt })
    expect(status().state).toBe('ready')
    expect(status({ schedulerRunning: false, lastTickAt: base.checkedAt }).state).toBe('scheduler-stopped')
  })
})
