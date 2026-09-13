import { expect, test } from 'bun:test'
import type { ScheduledWorkRuntimeStatus } from '@craft-agent/shared/scheduled-work'
import { scheduledWorkHealthLabel, scheduledWorkHealthMessages } from './scheduled-work-health'

test('ready does not promise punctual execution and known concerns remain passive facts', () => {
  const label = (state: ScheduledWorkRuntimeStatus['state']) => scheduledWorkHealthLabel({ workspaceId: 'campaign', checkedAt: '2026-09-10T12:00:00Z', state })
  expect(label('ready')).toBeNull()
  expect(label('scheduler-stopped')).toBe('Scheduler is stopped')
  expect(label('remote-host')).toBe('Scheduling is managed on the remote host')
  expect(label('other-runner')).toBe('Scheduling runs on another team computer')
  expect(label('unavailable')).toBe('Scheduler status unavailable')
})

test('health remains attributed to visible workspaces and stale scope results disappear', () => {
  const status = (workspaceId: string, state: ScheduledWorkRuntimeStatus['state']): ScheduledWorkRuntimeStatus => ({ workspaceId, state, checkedAt: '2026-09-10T12:00:00Z' })
  expect(scheduledWorkHealthMessages([
    status('hq', 'ready'), status('remote', 'remote-host'), status('campaign', 'license-required'), status('previous', 'scheduler-stopped'),
  ], [{ id: 'hq', name: 'HQ' }, { id: 'remote', name: 'Remote' }, { id: 'campaign', name: 'Release' }])).toEqual([
    'Remote: Scheduling is managed on the remote host', 'Release: Scheduling is waiting for license authorization',
  ])
})

test('old schedule check is reported as a timestamp fact without inferring an outage', () => {
  const now = Date.parse('2026-09-10T12:10:00.000Z')
  const status: ScheduledWorkRuntimeStatus = { workspaceId: 'hq', checkedAt: new Date(now).toISOString(), state: 'ready', lastTickAt: '2026-09-10T12:05:00.000Z' }
  expect(scheduledWorkHealthLabel(status, now)).toBe('No recent schedule checks (last 5m ago)')
  expect(scheduledWorkHealthLabel({ ...status, lastTickAt: '2026-09-10T12:07:00.000Z' }, now)).toBeNull()
  expect(scheduledWorkHealthLabel({ ...status, lastTickAt: undefined }, now)).toBeNull()
  expect(scheduledWorkHealthLabel({ ...status, lastTickAt: 'invalid' }, now)).toBeNull()
})
