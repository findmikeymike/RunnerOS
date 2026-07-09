import { describe, expect, test } from 'bun:test'
import type { ContextDocDTO } from '../../shared/types'
import {
  CAMPAIGN_CALENDAR_CONTEXT_SLUG,
  activeCampaignCalendarItems,
  applyCampaignCalendarWriteIntent,
  approveCampaignCalendarItem,
  createCampaignCalendarItem,
  createCampaignCalendarDraftItem,
  createCampaignScheduledJob,
  formatCampaignExternalReceiptLabel,
  mutateCampaignCalendarDoc,
  parseCampaignCalendarDocResult,
  requeueCampaignScheduledJob,
  reviseCampaignCalendarDraftItem,
  rescheduleCampaignCalendarItem,
  selectDueCampaignScheduledJobs,
  serializeCampaignCalendarBody,
  updateCampaignCalendarItem,
  setPendingCampaignCalendarPrefill,
  takePendingCampaignCalendarPrefill,
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
  test('creates an executable scheduled job from the Calendar composer', () => {
    const result = createCampaignCalendarDraftItem({
      campaignId: 'campaign-1',
      date: '2026-07-10',
      time: '09:30',
      title: 'Prepare launch copy',
      notes: 'Use the locked campaign voice.',
      kind: 'scheduled-job',
      status: 'scheduled',
      actionType: 'ask-agent',
      actionInput: 'Prepare the launch caption.',
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.item.job?.actionType).toBe('ask-agent')
      expect(result.item.job?.payload).toEqual({ prompt: 'Prepare the launch caption.' })
      expect(result.item.job?.runAt).toBe(new Date('2026-07-10T09:30:00').toISOString())
    }
  })

  test('carries an exact Final pointer into the Calendar composer', () => {
    setPendingCampaignCalendarPrefill({
      title: 'Post teaser image',
      kind: 'scheduled-job',
      actionType: 'post-asset',
      finalRefs: [{ outputId: 'output-1', assetId: 'asset-1', slot: 'social-teaser' }],
    })

    expect(takePendingCampaignCalendarPrefill()).toEqual({
      title: 'Post teaser image',
      kind: 'scheduled-job',
      actionType: 'post-asset',
      finalRefs: [{ outputId: 'output-1', assetId: 'asset-1', slot: 'social-teaser' }],
    })
    expect(takePendingCampaignCalendarPrefill()).toBeUndefined()
  })

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

  test('retries a conflicting calendar mutation against the latest document', async () => {
    const existing = createCampaignCalendarItem({ campaignId: 'campaign-1', date: '2026-07-10', title: 'Existing' })
    const concurrent = createCampaignCalendarItem({ campaignId: 'campaign-1', date: '2026-07-11', title: 'Concurrent runner write' })
    const added = createCampaignCalendarItem({ campaignId: 'campaign-1', date: '2026-07-12', title: 'User addition' })
    const bodyFor = (items: typeof existing[]) => serializeCampaignCalendarBody({
      version: 1,
      campaignId: 'campaign-1',
      items,
      updatedAt: '2026-07-10T13:00:00.000Z',
    })
    let latestDoc = makeDoc(bodyFor([existing]))
    let attempts = 0
    let savedBody = ''

    await mutateCampaignCalendarDoc({
      campaignId: 'campaign-1',
      load: async () => latestDoc,
      upsert: async (input) => {
        attempts += 1
        if (attempts === 1) {
          latestDoc = makeDoc(bodyFor([existing, concurrent]))
          throw new Error('CONTEXT_DOC_CONFLICT: campaign-calendar changed')
        }
        savedBody = input.body
      },
      mutate: (calendar) => ({ ...calendar, items: [...calendar.items, added] }),
    })

    const saved = parseCampaignCalendarDocResult(makeDoc(savedBody), 'campaign-1')
    expect(saved.ok).toBe(true)
    expect(saved.calendar.items.map((item) => item.title)).toEqual([
      'Existing',
      'Concurrent runner write',
      'User addition',
    ])
    expect(attempts).toBe(2)
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

  test('rejects agent write intents that still require user confirmation', () => {
    const result = applyCampaignCalendarWriteIntent({
      version: 1,
      campaignId: 'campaign-1',
      items: [],
      updatedAt: '2026-07-10T13:00:00.000Z',
    }, {
      campaignId: 'campaign-1',
      operation: 'create',
      explanation: 'The target time is still ambiguous.',
      requiresUserConfirmation: true,
      item: { date: '2026-07-10', title: 'Tentative post' },
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('confirmation')
  })

  test('agent updates preserve exact asset, output, and profile binding changes', () => {
    const existing = createCampaignCalendarItem({
      campaignId: 'campaign-1',
      date: '2026-07-10',
      title: 'Post teaser',
      assetRefs: [{ assetId: 'asset-old' }],
      finalRefs: [{ outputId: 'output-old', assetId: 'asset-old' }],
      outputRefs: [{ outputId: 'output-old' }],
      accountSetId: 'account-old',
      socialProfileRefs: [{ platform: 'instagram', profileId: 'old-profile' }],
    })
    const result = applyCampaignCalendarWriteIntent({
      version: 1,
      campaignId: 'campaign-1',
      items: [existing],
      updatedAt: '2026-07-10T13:00:00.000Z',
    }, {
      campaignId: 'campaign-1',
      operation: 'update',
      explanation: 'Use the corrected final and profile.',
      requiresUserConfirmation: false,
      item: {
        id: existing.id,
        assetRefs: [{ assetId: 'asset-new' }],
        finalRefs: [{ outputId: 'output-new', assetId: 'asset-new' }],
        outputRefs: [{ outputId: 'output-new' }],
        accountSetId: 'account-new',
        socialProfileRefs: [{ platform: 'instagram', profileId: 'new-profile' }],
      },
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.item.assetRefs).toEqual([{ assetId: 'asset-new' }])
      expect(result.item.finalRefs).toEqual([{ outputId: 'output-new', assetId: 'asset-new' }])
      expect(result.item.outputRefs).toEqual([{ outputId: 'output-new' }])
      expect(result.item.accountSetId).toBe('account-new')
      expect(result.item.socialProfileRefs).toEqual([{ platform: 'instagram', profileId: 'new-profile' }])
    }
  })

  test('agent binding changes invalidate an external dry-run and its approval', () => {
    const job = createCampaignScheduledJob({
      runAt: '2026-07-10T14:00:00.000Z',
      actionType: 'post-asset',
      payload: { caption: 'Post this.' },
    })
    const existing = approveCampaignCalendarItem(createCampaignCalendarItem({
      campaignId: 'campaign-1',
      date: '2026-07-10',
      title: 'Post teaser',
      kind: 'scheduled-job',
      status: 'needs-approval',
      socialProfileRefs: [{ platform: 'instagram', profileId: 'old-profile' }],
      job: {
        ...job,
        externalActionPreview: {
          actionId: 'act_old',
          actionDigest: 'sha256:old',
          platform: 'instagram',
          profileId: 'old-profile',
          preparedAt: '2026-07-10T13:30:00.000Z',
          payloadDigest: job.payloadDigest,
        },
      },
    }), { campaignId: 'campaign-1', now: '2026-07-10T13:40:00.000Z' })

    const result = applyCampaignCalendarWriteIntent({
      version: 1,
      campaignId: 'campaign-1',
      items: [existing],
      updatedAt: '2026-07-10T13:40:00.000Z',
    }, {
      campaignId: 'campaign-1',
      operation: 'update',
      explanation: 'Use the corrected profile.',
      requiresUserConfirmation: false,
      item: {
        id: existing.id,
        socialProfileRefs: [{ platform: 'instagram', profileId: 'new-profile' }],
      },
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.item.job?.externalActionPreview).toBeUndefined()
      expect(result.item.approvals).toEqual([])
      expect(result.item.status).toBe('needs-approval')
    }
  })

  test('rescheduling a calendar job updates the actual due timestamp', () => {
    const item = createCampaignCalendarItem({
      campaignId: 'campaign-1',
      date: '2026-07-10',
      time: '09:30',
      title: 'Prepare launch copy',
      kind: 'scheduled-job',
      job: createCampaignScheduledJob({
        runAt: new Date('2026-07-10T09:30:00').toISOString(),
        actionType: 'ask-agent',
        payload: { prompt: 'Prepare launch copy.' },
      }),
    })

    const result = rescheduleCampaignCalendarItem(item, { date: '2026-07-12', time: '14:45' })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.item.date).toBe('2026-07-12')
      expect(result.item.time).toBe('14:45')
      expect(result.item.job?.runAt).toBe(new Date('2026-07-12T14:45:00').toISOString())
    }
  })

  test('revising a scheduled post invalidates stale approval and dry-run state', () => {
    const job = createCampaignScheduledJob({
      runAt: new Date('2026-07-10T09:30:00').toISOString(),
      actionType: 'post-asset',
      payload: { caption: 'Old caption' },
    })
    const item = approveCampaignCalendarItem(createCampaignCalendarItem({
      campaignId: 'campaign-1',
      date: '2026-07-10',
      time: '09:30',
      title: 'Post launch art',
      kind: 'scheduled-job',
      status: 'needs-approval',
      finalRefs: [{ outputId: 'output-1', assetId: 'asset-1' }],
      socialProfileRefs: [{ platform: 'instagram', profileId: 'old-profile' }],
      job: {
        ...job,
        externalActionPreview: {
          actionId: 'act_old',
          actionDigest: 'sha256:old',
          platform: 'instagram',
          profileId: 'old-profile',
          preparedAt: '2026-07-10T09:00:00.000Z',
          payloadDigest: job.payloadDigest,
        },
      },
    }), { campaignId: 'campaign-1', now: '2026-07-10T09:05:00.000Z' })

    const result = reviseCampaignCalendarDraftItem(item, {
      campaignId: 'campaign-1',
      date: '2026-07-11',
      time: '10:45',
      title: 'Post launch art',
      kind: 'scheduled-job',
      status: 'needs-approval',
      actionType: 'post-asset',
      actionInput: 'New caption',
      finalRefs: item.finalRefs,
      socialProfileRefs: [{ platform: 'instagram', profileId: 'new-profile' }],
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.item.job?.payload).toEqual({ caption: 'New caption' })
      expect(result.item.job?.runAt).toBe(new Date('2026-07-11T10:45:00').toISOString())
      expect(result.item.job?.externalActionPreview).toBeUndefined()
      expect(result.item.approvals).toEqual([])
      expect(result.item.socialProfileRefs).toEqual([{ platform: 'instagram', profileId: 'new-profile' }])
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

  test('never selects canceled external jobs even when exact approval is valid', () => {
    const job = createCampaignScheduledJob({
      runAt: '2026-07-10T14:00:00.000Z',
      actionType: 'post-asset',
      payload: { caption: 'New song Friday.' },
    })
    const approved = approveCampaignCalendarItem(createCampaignCalendarItem({
      campaignId: 'campaign-1',
      date: '2026-07-10',
      title: 'Post teaser',
      kind: 'scheduled-job',
      status: 'needs-approval',
      job,
    }), { campaignId: 'campaign-1', now: '2026-07-10T13:50:00.000Z' })
    const canceled = updateCampaignCalendarItem(approved, { status: 'canceled' })

    const due = selectDueCampaignScheduledJobs({
      version: 1,
      campaignId: 'campaign-1',
      items: [canceled],
      updatedAt: '2026-07-10T13:50:00.000Z',
    }, new Date('2026-07-10T14:01:00.000Z'), { allowLiveExternal: true })

    expect(due).toEqual([])
  })

  test('never selects exact-approved external jobs already marked done', () => {
    const job = createCampaignScheduledJob({
      runAt: '2026-07-10T14:00:00.000Z',
      actionType: 'post-asset',
      payload: { caption: 'Already posted.' },
    })
    const approved = approveCampaignCalendarItem(createCampaignCalendarItem({
      campaignId: 'campaign-1',
      date: '2026-07-10',
      title: 'Already handled',
      kind: 'scheduled-job',
      status: 'needs-approval',
      job,
    }), { campaignId: 'campaign-1', now: '2026-07-10T13:50:00.000Z' })
    const item = updateCampaignCalendarItem(approved, { status: 'done' })

    const due = selectDueCampaignScheduledJobs({
      version: 1,
      campaignId: 'campaign-1',
      items: [item],
      updatedAt: '2026-07-10T14:01:00.000Z',
    }, new Date('2026-07-10T14:01:00.000Z'), { allowLiveExternal: true })

    expect(due).toEqual([])
  })

  test('gives late approvals a full approval window from approval time', () => {
    const item = createCampaignCalendarItem({
      campaignId: 'campaign-1',
      date: '2026-07-10',
      title: 'Post teaser',
      kind: 'scheduled-job',
      status: 'needs-approval',
      job: createCampaignScheduledJob({
        runAt: '2026-07-10T14:00:00.000Z',
        actionType: 'post-asset',
        payload: { caption: 'New song Friday.' },
      }),
    })

    const approved = approveCampaignCalendarItem(item, {
      campaignId: 'campaign-1',
      now: '2026-07-10T14:31:00.000Z',
    })

    expect(approved.approvals?.at(-1)?.expiresAt).toBe('2026-07-10T15:01:00.000Z')
  })

  test('generates unique default idempotency keys for distinct jobs', () => {
    const first = createCampaignScheduledJob({
      runAt: '2026-07-10T14:00:00.000Z',
      actionType: 'post-asset',
      payload: { caption: 'Same post.' },
    })
    const second = createCampaignScheduledJob({
      runAt: '2026-07-10T14:00:00.000Z',
      actionType: 'post-asset',
      payload: { caption: 'Same post.' },
    })

    expect(first.idempotencyKey).not.toBe(second.idempotencyKey)
    expect(first.idempotencyKey).toContain(first.id)
  })
})
