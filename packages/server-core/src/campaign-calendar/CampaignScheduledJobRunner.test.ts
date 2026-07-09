import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  CAMPAIGN_CALENDAR_CONTEXT_SLUG,
  campaignCalendarMetadata,
  createCampaignCalendarItem,
  createCampaignJobRun,
  createCampaignScheduledJob,
  approveCampaignCalendarItem,
  parseCampaignCalendarDocResult,
  serializeCampaignCalendarBody,
  updateCampaignCalendarItem,
  type CampaignCalendarItem,
} from '@craft-agent/shared/campaign-calendar'
import {
  loadContextDoc,
  upsertContextDoc,
} from '@craft-agent/shared/workspace-context'
import { CampaignScheduledJobRunner } from './CampaignScheduledJobRunner'

let roots: string[] = []

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
  roots = []
})

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'campaign-jobs-'))
  roots.push(root)
  return root
}

function readCalendar(root: string) {
  const doc = loadContextDoc(root, CAMPAIGN_CALENDAR_CONTEXT_SLUG)
  const parsed = parseCampaignCalendarDocResult(doc ?? undefined, 'campaign-1')
  if (!parsed.ok) throw new Error(parsed.error)
  return parsed.calendar
}

function writeCalendar(root: string, items: CampaignCalendarItem[]) {
  upsertContextDoc(root, {
    slug: CAMPAIGN_CALENDAR_CONTEXT_SLUG,
    metadata: campaignCalendarMetadata(),
    body: serializeCampaignCalendarBody({
      version: 1,
      campaignId: 'campaign-1',
      items,
      updatedAt: '2026-07-10T13:00:00.000Z',
    }),
  })
}

describe('CampaignScheduledJobRunner', () => {
  test('runs a due ask-agent job once and records run history', async () => {
    const root = makeRoot()
    const item = createCampaignCalendarItem({
      campaignId: 'campaign-1',
      date: '2026-07-10',
      title: 'Prepare launch copy',
      kind: 'scheduled-job',
      job: createCampaignScheduledJob({
        runAt: '2026-07-10T14:00:00.000Z',
        actionType: 'ask-agent',
        payload: { prompt: 'Prepare copy.', agentSlug: 'copywriter' },
      }),
    })
    writeCalendar(root, [item])

    const promptCalls: string[] = []
    const runner = new CampaignScheduledJobRunner({
      executePromptJob: async (input) => {
        promptCalls.push(`${input.agentSlug}:${input.prompt}`)
        return { sessionId: 'session-1' }
      },
      startWorkflow: async () => ({ runId: 'run-1' }),
    })

    const first = await runner.scanWorkspace('campaign-1', root, new Date('2026-07-10T14:01:00.000Z'))
    const second = await runner.scanWorkspace('campaign-1', root, new Date('2026-07-10T14:02:00.000Z'))
    const saved = readCalendar(root).items[0]!

    expect(first.started).toBe(1)
    expect(second.started).toBe(0)
    expect(promptCalls).toEqual(['copywriter:Prepare copy.'])
    expect(saved.status).toBe('done')
    expect(saved.job?.completedAt).toBeTruthy()
    expect(saved.runHistory.some((run) => run.status === 'done' && run.sessionId === 'session-1')).toBe(true)
    expect(saved.runHistory.some((run) => run.status === 'running')).toBe(false)
  })

  test('blocks due live external jobs instead of executing them', async () => {
    const root = makeRoot()
    const item = createCampaignCalendarItem({
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
    writeCalendar(root, [item])

    let executed = false
    const runner = new CampaignScheduledJobRunner({
      executePromptJob: async () => {
        executed = true
        return { sessionId: 'session-1' }
      },
      startWorkflow: async () => {
        executed = true
        return { runId: 'run-1' }
      },
    })

    const result = await runner.scanWorkspace('campaign-1', root, new Date('2026-07-10T14:01:00.000Z'))
    const saved = readCalendar(root).items[0]!

    expect(result.blocked).toBe(1)
    expect(executed).toBe(false)
    expect(saved.status).toBe('needs-approval')
    expect(saved.job?.error).toContain('Approval')
    expect(saved.job?.attempts).toBe(0)
    expect(saved.runHistory).toEqual([])
  })

  test('blocks preapproved external jobs until live external execution exists', async () => {
    const root = makeRoot()
    const item = createCampaignCalendarItem({
      campaignId: 'campaign-1',
      date: '2026-07-10',
      title: 'Post approved teaser',
      kind: 'scheduled-job',
      job: createCampaignScheduledJob({
        runAt: '2026-07-10T14:00:00.000Z',
        actionType: 'post-asset',
        payload: { platform: 'instagram' },
        approvalPolicy: 'preapproved-exact-payload',
      }),
    })
    writeCalendar(root, [item])

    const runner = new CampaignScheduledJobRunner({
      executePromptJob: async () => ({ sessionId: 'session-1' }),
      startWorkflow: async () => ({ runId: 'run-1' }),
    })

    const result = await runner.scanWorkspace('campaign-1', root, new Date('2026-07-10T14:01:00.000Z'))
    const saved = readCalendar(root).items[0]!

    expect(result.blocked).toBe(1)
    expect(saved.status).toBe('needs-approval')
    expect(saved.job?.attempts).toBe(0)
    expect(saved.runHistory).toHaveLength(0)
  })

  test('records a structured receipt for an exact-approved external job', async () => {
    const root = makeRoot()
    const job = createCampaignScheduledJob({
      runAt: '2026-07-10T14:00:00.000Z',
      actionType: 'post-asset',
      payload: { platform: 'instagram' },
      approvalPolicy: 'approval-before-external-action',
    })
    const item = approveCampaignCalendarItem(createCampaignCalendarItem({
      campaignId: 'campaign-1',
      date: '2026-07-10',
      title: 'Post teaser',
      kind: 'scheduled-job',
      status: 'needs-approval',
      accountSetId: 'artist-main',
      socialProfileRefs: [{ platform: 'instagram', profileId: 'ig-main' }],
      job,
    }), { campaignId: 'campaign-1', now: '2026-07-10T13:50:00.000Z' })
    writeCalendar(root, [item])

    const externalCalls: string[] = []
    const runner = new CampaignScheduledJobRunner({
      executePromptJob: async () => ({ sessionId: 'session-1' }),
      startWorkflow: async () => ({ runId: 'run-1' }),
      executeExternalJob: async ({ item, job, approval }) => {
        externalCalls.push(job.actionType)
        return {
          receiptId: 'receipt-1',
          platform: 'instagram',
          profileId: item.socialProfileRefs?.[0]?.profileId,
          externalUrl: 'https://instagram.com/p/post-1',
          resultSummary: 'Published teaser to Instagram.',
          approvalId: approval.id,
        }
      },
    })

    const result = await runner.scanWorkspace('campaign-1', root, new Date('2026-07-10T14:01:00.000Z'))
    const saved = readCalendar(root).items[0]!

    expect(result.started).toBe(1)
    expect(externalCalls).toEqual(['post-asset'])
    expect(saved.status).toBe('done')
    expect(saved.job?.attempts).toBe(1)
    expect(saved.runHistory.at(-1)?.status).toBe('done')
    expect(saved.runHistory.at(-1)?.externalReceipt).toEqual({
      id: 'receipt-1',
      actionType: 'post-asset',
      platform: 'instagram',
      profileId: 'ig-main',
      accountSetId: 'artist-main',
      externalUrl: 'https://instagram.com/p/post-1',
      completedAt: '2026-07-10T14:01:00.000Z',
      payloadDigest: job.payloadDigest,
      approvalId: item.approvals!.at(-1)!.id,
      summary: 'Published teaser to Instagram.',
    })
  })

  test('records executor failure without creating an external receipt', async () => {
    const root = makeRoot()
    const job = createCampaignScheduledJob({
      runAt: '2026-07-10T14:00:00.000Z',
      actionType: 'post-asset',
      payload: { platform: 'instagram' },
      approvalPolicy: 'approval-before-external-action',
      maxAttempts: 2,
    })
    const item = approveCampaignCalendarItem(createCampaignCalendarItem({
      campaignId: 'campaign-1',
      date: '2026-07-10',
      title: 'Post teaser',
      kind: 'scheduled-job',
      status: 'needs-approval',
      accountSetId: 'artist-main',
      socialProfileRefs: [{ platform: 'instagram', profileId: 'ig-main' }],
      job,
    }), { campaignId: 'campaign-1', now: '2026-07-10T13:50:00.000Z' })
    writeCalendar(root, [item])

    const runner = new CampaignScheduledJobRunner({
      executePromptJob: async () => ({ sessionId: 'session-1' }),
      startWorkflow: async () => ({ runId: 'run-1' }),
      executeExternalJob: async () => {
        throw new Error('Social executor unavailable.')
      },
    })

    const result = await runner.scanWorkspace('campaign-1', root, new Date('2026-07-10T14:01:00.000Z'))
    const saved = readCalendar(root).items[0]!

    expect(result.failed).toBe(1)
    expect(saved.status).toBe('scheduled')
    expect(saved.job?.error).toBe('Social executor unavailable.')
    expect(saved.runHistory.at(-1)?.status).toBe('failed')
    expect(saved.runHistory.at(-1)?.externalReceipt).toBeUndefined()
  })

  test('rejects external execution that returns no receipt id', async () => {
    const root = makeRoot()
    const job = createCampaignScheduledJob({
      runAt: '2026-07-10T14:00:00.000Z',
      actionType: 'post-asset',
      payload: { platform: 'instagram' },
      approvalPolicy: 'approval-before-external-action',
    })
    const item = approveCampaignCalendarItem(createCampaignCalendarItem({
      campaignId: 'campaign-1',
      date: '2026-07-10',
      title: 'Post teaser',
      kind: 'scheduled-job',
      status: 'needs-approval',
      job,
    }), { campaignId: 'campaign-1', now: '2026-07-10T13:50:00.000Z' })
    writeCalendar(root, [item])

    const runner = new CampaignScheduledJobRunner({
      executePromptJob: async () => ({ sessionId: 'session-1' }),
      startWorkflow: async () => ({ runId: 'run-1' }),
      executeExternalJob: async () => ({ receiptId: '' }),
    })

    const result = await runner.scanWorkspace('campaign-1', root, new Date('2026-07-10T14:01:00.000Z'))
    const saved = readCalendar(root).items[0]!

    expect(result.failed).toBe(1)
    expect(saved.status).toBe('failed')
    expect(saved.job?.error).toContain('receipt id')
    expect(saved.runHistory.at(-1)?.externalReceipt).toBeUndefined()
  })

  test('recovers stale running jobs back to scheduled retry state', async () => {
    const root = makeRoot()
    const job = createCampaignScheduledJob({
      runAt: '2026-07-10T14:00:00.000Z',
      actionType: 'ask-agent',
      payload: { prompt: 'Prepare copy.' },
      maxAttempts: 2,
    })
    const running = updateCampaignCalendarItem(createCampaignCalendarItem({
      campaignId: 'campaign-1',
      date: '2026-07-10',
      title: 'Prepare copy',
      kind: 'scheduled-job',
      job,
    }), {
      status: 'running',
      job: { ...job, attempts: 1, lastRunAt: '2026-07-10T14:00:00.000Z' },
      runHistory: [createCampaignJobRun({ jobId: job.id, status: 'running', startedAt: '2026-07-10T14:00:00.000Z' })],
    })
    writeCalendar(root, [running])

    const runner = new CampaignScheduledJobRunner({
      executePromptJob: async () => ({ sessionId: 'session-1' }),
      startWorkflow: async () => ({ runId: 'run-1' }),
    })

    const result = await runner.scanWorkspace('campaign-1', root, new Date('2026-07-10T14:31:00.000Z'))
    const saved = readCalendar(root).items[0]!

    expect(result.failed).toBe(1)
    expect(saved.status).toBe('scheduled')
    expect(saved.job?.attempts).toBe(1)
    expect(saved.runHistory.at(-1)?.status).toBe('failed')
    expect(saved.runHistory.at(-1)?.endedAt).toBeTruthy()
  })

  test('retries failed local jobs after backoff and stops at max attempts', async () => {
    const root = makeRoot()
    const item = createCampaignCalendarItem({
      campaignId: 'campaign-1',
      date: '2026-07-10',
      title: 'Prepare copy',
      kind: 'scheduled-job',
      job: createCampaignScheduledJob({
        runAt: '2026-07-10T14:00:00.000Z',
        actionType: 'ask-agent',
        payload: { prompt: 'Prepare copy.' },
        maxAttempts: 2,
      }),
    })
    writeCalendar(root, [item])

    let calls = 0
    const runner = new CampaignScheduledJobRunner({
      executePromptJob: async () => {
        calls += 1
        throw new Error('Agent failed.')
      },
      startWorkflow: async () => ({ runId: 'run-1' }),
    })

    const first = await runner.scanWorkspace('campaign-1', root, new Date('2026-07-10T14:01:00.000Z'))
    const tooSoon = await runner.scanWorkspace('campaign-1', root, new Date('2026-07-10T14:03:00.000Z'))
    const second = await runner.scanWorkspace('campaign-1', root, new Date('2026-07-10T14:07:00.000Z'))
    const saved = readCalendar(root).items[0]!

    expect(first.failed).toBe(1)
    expect(tooSoon.scanned).toBe(0)
    expect(second.failed).toBe(1)
    expect(calls).toBe(2)
    expect(saved.status).toBe('failed')
    expect(saved.job?.attempts).toBe(2)
  })

  test('marks local jobs missed after the 24 hour grace window', async () => {
    const root = makeRoot()
    const item = createCampaignCalendarItem({
      campaignId: 'campaign-1',
      date: '2026-07-09',
      title: 'Prepare copy',
      kind: 'scheduled-job',
      job: createCampaignScheduledJob({
        runAt: '2026-07-09T14:00:00.000Z',
        actionType: 'ask-agent',
        payload: { prompt: 'Prepare copy.' },
      }),
    })
    writeCalendar(root, [item])

    const runner = new CampaignScheduledJobRunner({
      executePromptJob: async () => ({ sessionId: 'session-1' }),
      startWorkflow: async () => ({ runId: 'run-1' }),
    })

    const result = await runner.scanWorkspace('campaign-1', root, new Date('2026-07-10T14:01:00.000Z'))
    const saved = readCalendar(root).items[0]!

    expect(result.missed).toBe(1)
    expect(saved.status).toBe('missed')
    expect(saved.runHistory.at(-1)?.status).toBe('skipped')
  })

  test('fails invalid runAt and max-attempt jobs without execution', async () => {
    const root = makeRoot()
    const invalidJob = {
      ...createCampaignScheduledJob({
        runAt: '2026-07-10T14:00:00.000Z',
        actionType: 'ask-agent',
        payload: { prompt: 'Prepare copy.' },
      }),
      runAt: 'not-a-date',
    }
    const invalid = createCampaignCalendarItem({
      campaignId: 'campaign-1',
      date: '2026-07-10',
      title: 'Invalid job',
      kind: 'scheduled-job',
      job: invalidJob,
    })
    const maxedJob = createCampaignScheduledJob({
      runAt: '2026-07-10T14:00:00.000Z',
      actionType: 'ask-agent',
      payload: { prompt: 'Prepare copy.' },
    })
    const maxed = updateCampaignCalendarItem(createCampaignCalendarItem({
      campaignId: 'campaign-1',
      date: '2026-07-10',
      title: 'Maxed job',
      kind: 'scheduled-job',
      job: maxedJob,
    }), {
      job: { ...maxedJob, attempts: 1, maxAttempts: 1 },
    })
    writeCalendar(root, [invalid, maxed])

    let executed = false
    const runner = new CampaignScheduledJobRunner({
      executePromptJob: async () => {
        executed = true
        return { sessionId: 'session-1' }
      },
      startWorkflow: async () => {
        executed = true
        return { runId: 'run-1' }
      },
    })

    const result = await runner.scanWorkspace('campaign-1', root, new Date('2026-07-10T14:01:00.000Z'))
    const saved = readCalendar(root).items

    expect(result.failed).toBe(2)
    expect(executed).toBe(false)
    expect(saved.map((item) => item.status)).toEqual(['failed', 'failed'])
  })

  test('keeps approval-required jobs blocked without attempts', async () => {
    const root = makeRoot()
    const item = createCampaignCalendarItem({
      campaignId: 'campaign-1',
      date: '2026-07-10',
      title: 'Review final',
      kind: 'scheduled-job',
      job: createCampaignScheduledJob({
        runAt: '2026-07-10T14:00:00.000Z',
        actionType: 'ask-agent',
        payload: { prompt: 'Prepare copy.' },
        approvalPolicy: 'approval-before-run',
      }),
    })
    writeCalendar(root, [item])

    const runner = new CampaignScheduledJobRunner({
      executePromptJob: async () => ({ sessionId: 'session-1' }),
      startWorkflow: async () => ({ runId: 'run-1' }),
    })

    const result = await runner.scanWorkspace('campaign-1', root, new Date('2026-07-10T14:01:00.000Z'))
    const saved = readCalendar(root).items[0]!

    expect(result.blocked).toBe(1)
    expect(saved.status).toBe('needs-approval')
    expect(saved.job?.attempts).toBe(0)
    expect(saved.runHistory).toHaveLength(0)
  })
})
