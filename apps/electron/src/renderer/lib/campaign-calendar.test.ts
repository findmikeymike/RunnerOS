import { describe, expect, test } from 'bun:test'
import type { ContextDocDTO } from '../../shared/types'
import {
  CAMPAIGN_CALENDAR_CONTEXT_SLUG,
  activeCampaignCalendarItems,
  applyCampaignCalendarWriteIntent,
  approveCampaignCalendarItem,
  createCampaignCalendarItem,
  createCampaignScheduledJob,
  formatCampaignExternalReceiptLabel,
  parseCampaignCalendarDocResult,
  requeueCampaignScheduledJob,
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
  test('formats external execution receipts for the calendar', () => {
    expect(formatCampaignExternalReceiptLabel({
      id: 'receipt-1',
      actionType: 'post-asset',
      platform: 'instagram',
      profileId: 'ig-main',
      completedAt: '2026-07-10T14:01:00.000Z',
      payloadDigest: 'fnv1a:12345678',
      approvalId: 'approval-1',
    })).toBe('Instagram · ig-main · receipt-1')
  })

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

  test('approves local scheduled jobs back into the runnable queue', () => {
    const job = createCampaignScheduledJob({
      runAt: '2026-07-10T14:00:00.000Z',
      actionType: 'ask-agent',
      approvalPolicy: 'approval-before-run',
      payload: { prompt: 'Prepare launch copy.' },
    })
    const item = createCampaignCalendarItem({
      campaignId: 'campaign-1',
      date: '2026-07-10',
      title: 'Prepare launch copy',
      kind: 'scheduled-job',
      status: 'needs-approval',
      job,
    })

    const approved = approveCampaignCalendarItem(item, { campaignId: 'campaign-1', now: '2026-07-10T13:50:00.000Z' })
    const due = selectDueCampaignScheduledJobs({
      version: 1,
      campaignId: 'campaign-1',
      items: [approved],
      updatedAt: '2026-07-10T13:50:00.000Z',
    }, new Date('2026-07-10T14:01:00.000Z'))

    expect(approved.status).toBe('scheduled')
    expect(approved.job?.approvalPolicy).toBe('none')
    expect(approved.approvals?.at(-1)?.status).toBe('approved')
    expect(due).toHaveLength(1)
    expect(due[0]?.blockedReason).toBeUndefined()
  })

  test('records external approvals without enabling live execution before the external runner', () => {
    const job = createCampaignScheduledJob({
      runAt: '2026-07-10T14:00:00.000Z',
      actionType: 'post-asset',
      approvalPolicy: 'approval-before-external-action',
      payload: { platform: 'instagram' },
    })
    const item = createCampaignCalendarItem({
      campaignId: 'campaign-1',
      date: '2026-07-10',
      title: 'Post teaser',
      kind: 'scheduled-job',
      status: 'needs-approval',
      job,
    })

    const approved = approveCampaignCalendarItem(item, { now: '2026-07-10T13:50:00.000Z' })
    const due = selectDueCampaignScheduledJobs({
      version: 1,
      campaignId: 'campaign-1',
      items: [approved],
      updatedAt: '2026-07-10T13:50:00.000Z',
    }, new Date('2026-07-10T14:01:00.000Z'))

    expect(approved.status).toBe('needs-approval')
    expect(approved.job?.approvalPolicy).toBe('preapproved-exact-payload')
    expect(approved.approvals?.at(-1)?.status).toBe('approved')
    expect(approved.job?.error).toContain('not connected')
    expect(due[0]?.blockedReason).toBe('needs-approval')
  })

  test('selects exact-approved external jobs only when live external execution is enabled', () => {
    const job = createCampaignScheduledJob({
      runAt: '2026-07-10T14:00:00.000Z',
      actionType: 'post-asset',
      approvalPolicy: 'approval-before-external-action',
      payload: { platform: 'instagram' },
    })
    const item = approveCampaignCalendarItem(createCampaignCalendarItem({
      campaignId: 'campaign-1',
      date: '2026-07-10',
      title: 'Post teaser',
      kind: 'scheduled-job',
      status: 'needs-approval',
      job,
    }), { campaignId: 'campaign-1', now: '2026-07-10T13:50:00.000Z' })

    const due = selectDueCampaignScheduledJobs({
      version: 1,
      campaignId: 'campaign-1',
      items: [item],
      updatedAt: '2026-07-10T13:50:00.000Z',
    }, new Date('2026-07-10T14:01:00.000Z'), { allowLiveExternal: true })

    expect(due).toHaveLength(1)
    expect(due[0]?.blockedReason).toBeUndefined()
  })

  test('invalidates exact external approval when bound run time or account changes', () => {
    const job = createCampaignScheduledJob({
      runAt: '2026-07-10T14:00:00.000Z',
      actionType: 'post-asset',
      approvalPolicy: 'approval-before-external-action',
      payload: { platform: 'instagram' },
    })
    const approved = approveCampaignCalendarItem(createCampaignCalendarItem({
      campaignId: 'campaign-1',
      date: '2026-07-10',
      title: 'Post teaser',
      kind: 'scheduled-job',
      status: 'needs-approval',
      accountSetId: 'artist-main',
      socialProfileRefs: [{ platform: 'instagram', profileId: 'ig-main' }],
      job,
    }), { campaignId: 'campaign-1', now: '2026-07-10T13:50:00.000Z' })
    const moved = updateCampaignCalendarItem(approved, {
      job: { ...approved.job!, runAt: '2026-07-11T14:00:00.000Z' },
    })
    const changedAccount = updateCampaignCalendarItem(approved, {
      socialProfileRefs: [{ platform: 'instagram', profileId: 'ig-alt' }],
    })

    const movedDue = selectDueCampaignScheduledJobs({
      version: 1,
      campaignId: 'campaign-1',
      items: [moved],
      updatedAt: '2026-07-10T13:50:00.000Z',
    }, new Date('2026-07-11T14:01:00.000Z'), { allowLiveExternal: true })
    const changedAccountDue = selectDueCampaignScheduledJobs({
      version: 1,
      campaignId: 'campaign-1',
      items: [changedAccount],
      updatedAt: '2026-07-10T13:50:00.000Z',
    }, new Date('2026-07-10T14:01:00.000Z'), { allowLiveExternal: true })

    expect(movedDue[0]?.blockedReason).toBe('needs-approval')
    expect(changedAccountDue[0]?.blockedReason).toBe('needs-approval')
  })

  test('expires exact external approvals after the approved execution window', () => {
    const job = createCampaignScheduledJob({
      runAt: '2026-07-10T14:00:00.000Z',
      actionType: 'post-asset',
      approvalPolicy: 'approval-before-external-action',
      payload: { platform: 'instagram' },
    })
    const item = approveCampaignCalendarItem(createCampaignCalendarItem({
      campaignId: 'campaign-1',
      date: '2026-07-10',
      title: 'Post teaser',
      kind: 'scheduled-job',
      status: 'needs-approval',
      job,
    }), { campaignId: 'campaign-1', now: '2026-07-10T13:50:00.000Z', expiresAt: '2026-07-10T14:30:00.000Z' })

    const due = selectDueCampaignScheduledJobs({
      version: 1,
      campaignId: 'campaign-1',
      items: [item],
      updatedAt: '2026-07-10T13:50:00.000Z',
    }, new Date('2026-07-10T14:31:00.000Z'), { allowLiveExternal: true })

    expect(due[0]?.blockedReason).toBe('needs-approval')
  })

  test('requeues terminal local jobs with fresh attempts', () => {
    const job = createCampaignScheduledJob({
      runAt: '2026-07-10T14:00:00.000Z',
      actionType: 'ask-agent',
      payload: { prompt: 'Prepare launch copy.' },
    })
    const failed = updateCampaignCalendarItem(createCampaignCalendarItem({
      campaignId: 'campaign-1',
      date: '2026-07-10',
      title: 'Prepare launch copy',
      kind: 'scheduled-job',
      status: 'failed',
      job,
    }), {
      job: {
        ...job,
        attempts: 1,
        lastRunAt: '2026-07-10T14:01:00.000Z',
        error: 'Agent failed.',
      },
    })

    const requeued = requeueCampaignScheduledJob(failed)

    expect(requeued.status).toBe('scheduled')
    expect(requeued.job?.attempts).toBe(0)
    expect(requeued.job?.lastRunAt).toBeUndefined()
    expect(requeued.job?.error).toBeUndefined()
  })

  test('does not requeue completed jobs because completed run history is terminal', () => {
    const job = createCampaignScheduledJob({
      runAt: '2026-07-10T14:00:00.000Z',
      actionType: 'ask-agent',
      payload: { prompt: 'Prepare launch copy.' },
    })
    const done = updateCampaignCalendarItem(createCampaignCalendarItem({
      campaignId: 'campaign-1',
      date: '2026-07-10',
      title: 'Prepare launch copy',
      kind: 'scheduled-job',
      status: 'done',
      job,
    }), {
      runHistory: [{ id: 'run-1', jobId: job.id, startedAt: '2026-07-10T14:01:00.000Z', endedAt: '2026-07-10T14:02:00.000Z', status: 'done' }],
      job: { ...job, completedAt: '2026-07-10T14:02:00.000Z' },
    })

    const requeued = requeueCampaignScheduledJob(done)

    expect(requeued.status).toBe('done')
    expect(requeued.job?.completedAt).toBe('2026-07-10T14:02:00.000Z')
  })
})
