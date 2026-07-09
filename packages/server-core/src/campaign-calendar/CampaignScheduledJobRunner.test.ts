import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  CAMPAIGN_CALENDAR_CONTEXT_SLUG,
  campaignCalendarMetadata,
  createCampaignCalendarItem,
  createCampaignScheduledJob,
  parseCampaignCalendarDocResult,
  serializeCampaignCalendarBody,
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
    upsertContextDoc(root, {
      slug: CAMPAIGN_CALENDAR_CONTEXT_SLUG,
      metadata: campaignCalendarMetadata(),
      body: serializeCampaignCalendarBody({
        version: 1,
        campaignId: 'campaign-1',
        items: [item],
        updatedAt: '2026-07-10T13:00:00.000Z',
      }),
    })

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
    upsertContextDoc(root, {
      slug: CAMPAIGN_CALENDAR_CONTEXT_SLUG,
      metadata: campaignCalendarMetadata(),
      body: serializeCampaignCalendarBody({
        version: 1,
        campaignId: 'campaign-1',
        items: [item],
        updatedAt: '2026-07-10T13:00:00.000Z',
      }),
    })

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
  })
})
