import { describe, expect, test } from 'bun:test'
import type { ContextDocDTO } from '../../shared/types'
import {
  CAMPAIGN_CALENDAR_CONTEXT_SLUG,
  activeCampaignCalendarItems,
  applyCampaignCalendarWriteIntent,
  createCampaignCalendarItem,
  createCampaignScheduledJob,
  parseCampaignCalendarDocResult,
  selectDueCampaignScheduledJobs,
  serializeCampaignCalendarBody,
  updateCampaignCalendarItem,
} from './campaign-calendar'

function makeDoc(body: string): ContextDocDTO {
  return {
    slug: CAMPAIGN_CALENDAR_CONTEXT_SLUG,
    metadata: {
      name: 'Campaign Calendar',
      routing: { mode: 'broadcast' },
      enabled: true,
    },
    body,
    path: '/tmp/context/campaign-calendar',
    workspaceRootPath: '/tmp',
  } as ContextDocDTO
}

describe('campaign calendar utilities', () => {
  test('returns an empty campaign calendar when no doc exists', () => {
    const result = parseCampaignCalendarDocResult(undefined, 'campaign-1')

    expect(result.ok).toBe(true)
    expect(result.calendar.campaignId).toBe('campaign-1')
    expect(result.calendar.items).toEqual([])
  })

  test('round-trips manual, deadline, and approval items', () => {
    const manual = createCampaignCalendarItem({
      campaignId: 'campaign-1',
      date: '2026-07-10',
      time: '09:30',
      title: 'Post teaser clip',
      notes: 'Use locked final.',
    })
    const deadline = createCampaignCalendarItem({
      campaignId: 'campaign-1',
      date: '2026-07-12',
      title: 'Distributor upload due',
      kind: 'deadline',
    })
    const approval = createCampaignCalendarItem({
      campaignId: 'campaign-1',
      date: '2026-07-11',
      title: 'Review cover art',
      kind: 'approval',
      status: 'needs-approval',
      personIds: [' person-1 ', 'person-1'],
    })

    const body = serializeCampaignCalendarBody({
      version: 1,
      campaignId: 'campaign-1',
      items: [deadline, manual, approval],
      updatedAt: '2026-07-09T00:00:00.000Z',
    })
    const result = parseCampaignCalendarDocResult(makeDoc(body), 'campaign-1')

    expect(result.ok).toBe(true)
    expect(result.calendar.items.map((item) => item.title)).toEqual([
      'Post teaser clip',
      'Review cover art',
      'Distributor upload due',
    ])
    expect(result.calendar.items.find((item) => item.kind === 'approval')?.personIds).toEqual(['person-1'])
  })

  test('updates and soft-deletes items without losing required arrays', () => {
    const item = createCampaignCalendarItem({
      campaignId: 'campaign-1',
      date: '2026-07-10',
      title: 'Review final',
    })
    const updated = updateCampaignCalendarItem(item, {
      title: 'Review final video',
      kind: 'approval',
      status: 'needs-approval',
      time: '14:00',
    })
    const deleted = { ...updated, deletedAt: '2026-07-10T15:00:00.000Z' }

    expect(updated.assetRefs).toEqual([])
    expect(updated.runHistory).toEqual([])
    expect(updated.kind).toBe('approval')
    expect(updated.status).toBe('needs-approval')
    expect(activeCampaignCalendarItems([deleted])).toEqual([])
  })

  test('reports malformed calendar docs without throwing', () => {
    const result = parseCampaignCalendarDocResult(makeDoc('```json\n{ bad json\n```'), 'campaign-1')

    expect(result.ok).toBe(false)
    expect(result.calendar.campaignId).toBe('campaign-1')
    if (!result.ok) expect(result.error).toMatch(/malformed/i)
  })

  test('selects due local jobs but blocks live external jobs for approval', () => {
    const askAgent = createCampaignCalendarItem({
      campaignId: 'campaign-1',
      date: '2026-07-10',
      title: 'Prepare launch copy',
      kind: 'scheduled-job',
      job: createCampaignScheduledJob({
        runAt: '2026-07-10T14:00:00.000Z',
        actionType: 'ask-agent',
        payload: { prompt: 'Prepare launch copy.', agentSlug: 'copywriter' },
      }),
    })
    const postAsset = createCampaignCalendarItem({
      campaignId: 'campaign-1',
      date: '2026-07-10',
      title: 'Post teaser',
      kind: 'scheduled-job',
      job: createCampaignScheduledJob({
        runAt: '2026-07-10T14:00:00.000Z',
        actionType: 'post-asset',
        payload: { platform: 'instagram' },
      }),
    })

    const due = selectDueCampaignScheduledJobs({
      version: 1,
      campaignId: 'campaign-1',
      items: [askAgent, postAsset],
      updatedAt: '2026-07-10T13:00:00.000Z',
    }, new Date('2026-07-10T14:01:00.000Z'))

    expect(due).toHaveLength(2)
    expect(due.find((entry) => entry.item.id === askAgent.id)?.blockedReason).toBeUndefined()
    expect(due.find((entry) => entry.item.id === postAsset.id)?.blockedReason).toBe('needs-approval')
  })

  test('agent write intent creates scheduled external jobs as needs-approval', () => {
    const calendar = {
      version: 1 as const,
      campaignId: 'campaign-1',
      items: [],
      updatedAt: '2026-07-10T13:00:00.000Z',
    }

    const result = applyCampaignCalendarWriteIntent(calendar, {
      campaignId: 'campaign-1',
      operation: 'create',
      explanation: 'User asked to schedule the teaser post.',
      requiresUserConfirmation: false,
      item: {
        date: '2026-07-10',
        title: 'Post teaser',
        job: createCampaignScheduledJob({
          runAt: '2026-07-10T14:00:00.000Z',
          actionType: 'post-asset',
          payload: { platform: 'instagram' },
        }),
      },
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.item.source).toBe('agent')
      expect(result.item.kind).toBe('scheduled-job')
      expect(result.item.status).toBe('needs-approval')
    }
  })
})
