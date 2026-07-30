import { describe, expect, test } from 'bun:test'
import type { ScheduledWorkOrder } from '@craft-agent/shared/scheduled-work'
import type { AutomationListItem } from '@/components/automations/types'
import type { ArtistCalendarEvent } from '@/lib/artist-calendar'
import {
  buildHqProjectColumns,
  buildHqThisWeekItems,
  buildHqWorkerItems,
  hqHeaderNextLabel,
  shouldRefreshHqStateOnOpen,
} from './artist-hq-home-feed'

const now = new Date(2026, 6, 30, 12)

describe('Artist HQ home feed', () => {
  test('builds This Week from real calendar and scheduled work without duplicating linked work', () => {
    const items = buildHqThisWeekItems([
      event('event-1', '2026-07-30', 'Master delivery', { time: '14:00', scheduledWorkId: 'work-1' }),
      event('event-2', '2026-08-02', 'Press photos'),
      event('deleted', '2026-07-31', 'Deleted', { deletedAt: '2026-07-29T00:00:00.000Z' }),
    ], [
      order('work-1', 'Master delivery worker', 'scheduled', '2026-07-30T19:00:00.000Z'),
      order('work-2', 'Weekly intel', 'running', '2026-07-31T15:00:00.000Z'),
      order('later', 'Later work', 'scheduled', '2026-08-12T15:00:00.000Z'),
    ], now)

    expect(items.map((item) => item.title)).toEqual(['Master delivery', 'Weekly intel', 'Press photos'])
    expect(items[0]?.when).toContain('Today')
  })

  test('builds Workers from enabled automations and active work only', () => {
    const automations: AutomationListItem[] = [
      automation('spotify', 'Weekly Spotify Snapshot', true),
      automation('paused', 'Paused job', false),
    ]
    const items = buildHqWorkerItems(automations, [
      order('running', 'YouTube Intel', 'running'),
      order('done', 'Completed task', 'done'),
    ])

    expect(items.map((item) => item.title)).toEqual(['YouTube Intel', 'Weekly Spotify Snapshot'])
  })

  test('prefers a running worker over its enabled automation definition', () => {
    const items = buildHqWorkerItems([
      automation('spotify', 'Weekly Spotify Snapshot', true),
    ], [
      order('spotify-run', 'Weekly Spotify Snapshot', 'running'),
    ])

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'scheduled-work', status: 'running' })
  })

  test('sorts scheduled work by the displayed timezone rather than its UTC timestamp', () => {
    const items = buildHqThisWeekItems([
      event('event-1', '2026-07-31', 'Afternoon review', { time: '14:00' }),
    ], [
      order('work-1', 'Morning worker', 'scheduled', '2026-07-31T15:00:00.000Z'),
    ], now)

    expect(items.map((item) => item.title)).toEqual(['Morning worker', 'Afternoon review'])
  })

  test('builds Projects from campaign workspaces and live work states', () => {
    const columns = buildHqProjectColumns([
      { id: 'campaign-1', name: 'New Single', primary: true },
      { id: 'campaign-2', name: 'Next EP' },
    ], [
      order('active', 'Content batch', 'scheduled'),
      order('waiting', 'Approve final post', 'needs-approval'),
    ])

    expect(columns.find((column) => column.id === 'focus')?.cards[0]?.title).toBe('New Single')
    expect(columns.find((column) => column.id === 'active')?.cards[0]?.title).toBe('Content batch')
    expect(columns.find((column) => column.id === 'waiting')?.cards[0]?.title).toBe('Approve final post')
    expect(columns.find((column) => column.id === 'upcoming')?.cards[0]?.title).toBe('Next EP')
  })

  test('uses the nearest dated item for the header and refreshes stale state on open', () => {
    const timeline = buildHqThisWeekItems([
      event('event-1', '2026-07-31', 'Release check'),
    ], [], now)
    expect(hqHeaderNextLabel('Run HQ review', timeline)).toContain('Release check')
    expect(hqHeaderNextLabel('Run HQ review', [])).toBe('Run HQ review')
    expect(shouldRefreshHqStateOnOpen('2026-07-29T12:00:00.000Z', now)).toBe(true)
    expect(shouldRefreshHqStateOnOpen('2026-07-30T06:00:00.000Z', now)).toBe(false)
  })
})

function automation(id: string, name: string, enabled: boolean): AutomationListItem {
  return {
    id,
    event: 'SchedulerTick',
    matcherIndex: 0,
    name,
    summary: '',
    enabled,
    cron: '0 9 * * 1',
    actions: [],
  }
}

function event(
  id: string,
  date: string,
  title: string,
  extra: Partial<ArtistCalendarEvent> = {},
): ArtistCalendarEvent {
  return {
    id,
    date,
    title,
    workspaceLinks: [],
    relatedPersonIds: [],
    createdAt: '2026-07-30T00:00:00.000Z',
    updatedAt: '2026-07-30T00:00:00.000Z',
    ...extra,
  }
}

function order(
  id: string,
  title: string,
  status: ScheduledWorkOrder['status'],
  startAt = '2026-07-31T15:00:00.000Z',
): ScheduledWorkOrder {
  return {
    version: 1,
    id,
    owner: { scope: 'hq', workspaceId: 'hq' },
    calendarLink: { calendar: 'hq', itemId: `calendar-${id}` },
    title,
    type: 'agent-task',
    status,
    startAt,
    timezone: 'America/Chicago',
    execution: {
      type: 'agent-task',
      agentSlug: 'researcher',
      brief: title,
      permissionMode: 'safe',
      expectedOutput: { requirement: 'none' },
    },
    inputRefs: [],
    approvals: [],
    runs: [],
    executionKey: { payloadDigest: id, idempotencyKey: id },
    createdAt: '2026-07-30T00:00:00.000Z',
    updatedAt: '2026-07-30T00:00:00.000Z',
  }
}
