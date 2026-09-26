import { expect, test } from 'bun:test'
import type { ScheduledWorkOrder } from '@craft-agent/shared/scheduled-work'
import { scheduledWorkTiming } from './scheduled-work-timing'

const planned = '2026-09-10T12:00:00.000Z'
const order = (runs: ScheduledWorkOrder['runs'], status: ScheduledWorkOrder['status'] = 'running') => ({ startAt: planned, runs, status } as ScheduledWorkOrder)
const run = (sessionId: string, startedAt: string) => ({ sessionId, startedAt } as ScheduledWorkOrder['runs'][number])

test('records late start from the matching run, not a different attempt', () => {
  const work = order([run('first', '2026-09-10T12:02:00.000Z'), run('second', '2026-09-10T12:07:00.000Z')])
  expect(scheduledWorkTiming(work, { sessionId: 'first' }).timingLabel).toBe('Started 2m late')
  expect(scheduledWorkTiming(work).timingLabel).toBe('Started 7m late')
  expect(scheduledWorkTiming(work, { sessionId: 'missing' }).actualStartAt).toBeUndefined()
})

test('sub-minute, early, and invalid starts do not claim lateness', () => {
  for (const time of ['2026-09-10T12:00:59.000Z', '2026-09-10T11:59:00.000Z', 'invalid']) {
    expect(scheduledWorkTiming(order([run('session', time)])).timingLabel).toBeUndefined()
  }
})

test('waiting past the plan reports elapsed time without diagnosing outage', () => {
  const now = Date.parse('2026-09-10T12:05:00.000Z')
  expect(scheduledWorkTiming(order([], 'waiting'), undefined, now).timingLabel).toBe('Waiting 5m past planned start')
  expect(scheduledWorkTiming(order([], 'needs-attention'), undefined, now).timingLabel).toBeUndefined()
  expect(scheduledWorkTiming(order([], 'scheduled'), undefined, Date.parse(planned)).timingLabel).toBeUndefined()
})

test('queued retry keeps prior attempt separate from the new planned start', () => {
  const work = order([run('previous', '2026-09-10T12:02:00.000Z')], 'waiting')
  const timing = scheduledWorkTiming(work, undefined, Date.parse('2026-09-10T12:10:00.000Z'))
  expect(timing.timingLabel).toBe('Waiting 10m past planned start')
  expect(timing.actualStartAt).toBeUndefined()
  expect(timing.lastAttemptStartAt).toBe('2026-09-10T12:02:00.000Z')
  work.startAt = '2026-09-10T13:00:00.000Z'
  expect(scheduledWorkTiming(work, undefined, Date.parse('2026-09-10T12:10:00.000Z')).timingLabel).toBeUndefined()
})
