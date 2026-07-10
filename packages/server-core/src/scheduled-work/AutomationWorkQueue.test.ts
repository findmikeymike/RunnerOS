import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PendingQueuedWork } from '@craft-agent/shared/automations'
import { CAMPAIGN_CALENDAR_CONTEXT_SLUG, parseCampaignCalendarDocResult } from '@craft-agent/shared/campaign-calendar'
import { SCHEDULED_WORK_CONTEXT_SLUG, parseScheduledWorkDocResult, scheduledWorkDefinitionDigest } from '@craft-agent/shared/scheduled-work'
import { loadContextDoc } from '@craft-agent/shared/workspace-context'
import { queueAutomationWork } from './AutomationWorkQueue'

const roots: string[] = []
const workspaceId = 'campaign-1'

function root(): string {
  const value = mkdtempSync(join(tmpdir(), 'automation-work-queue-'))
  roots.push(value)
  return value
}

function reviewToSocial(): PendingQueuedWork {
  return {
    matcherId: 'review-trigger',
    automationName: 'Review then publish',
    event: 'WebhookReceive',
    eventTimestamp: Date.parse('2026-07-10T14:00:00.000Z'),
    eventKey: 'webhook:1720620000:sha256=signed-delivery',
    action: {
      type: 'queue-work',
      ownerScope: 'campaign',
      title: 'Approve launch post',
      execution: { type: 'review', reviewerType: 'user' },
      inputRefs: [{ kind: 'final', outputId: 'output-1', assetId: 'asset-1', label: 'Launch post' }],
      followUp: {
        execution: {
          type: 'social-publish',
          platform: 'x',
          profileId: 'artist-main',
          caption: 'Out Friday.',
        },
      },
    },
  }
}

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

describe('queueAutomationWork', () => {
  test('atomically queues a deterministic review-to-social chain and calendar shells', async () => {
    const workspaceRoot = root()
    const pending = reviewToSocial()
    const first = await queueAutomationWork(workspaceId, workspaceRoot, pending)
    const second = await queueAutomationWork(workspaceId, workspaceRoot, { ...pending, eventTimestamp: pending.eventTimestamp + 5_000 })

    expect(second).toEqual(first)
    const work = parseScheduledWorkDocResult(loadContextDoc(workspaceRoot, SCHEDULED_WORK_CONTEXT_SLUG) ?? undefined, workspaceId)
    if (!work.ok) throw new Error(work.error)
    expect(work.work.items).toHaveLength(2)
    expect(work.work.items.map((item) => item.status)).toEqual(['scheduled', 'waiting'])
    expect(work.work.items[1]).toMatchObject({
      type: 'social-publish',
      chain: { ordinal: 1, predecessor: { releaseOn: 'creative-approval' } },
      inputRefs: [{ kind: 'final', outputId: 'output-1', assetId: 'asset-1' }],
    })
    expect(work.work.items[1]?.executionKey.payloadDigest).toBe(scheduledWorkDefinitionDigest({
      execution: work.work.items[1]?.execution,
      inputRefs: work.work.items[1]?.inputRefs,
      chainId: work.work.items[1]?.chain?.chainId,
      ordinal: 1,
    }))

    const calendar = parseCampaignCalendarDocResult(loadContextDoc(workspaceRoot, CAMPAIGN_CALENDAR_CONTEXT_SLUG) ?? undefined, workspaceId)
    if (!calendar.ok) throw new Error(calendar.error)
    expect(calendar.calendar.items).toHaveLength(2)
    expect(calendar.calendar.items.map((item) => item.status)).toEqual(['scheduled', 'draft'])
    expect(calendar.calendar.items.map((item) => item.scheduledWorkId)).toEqual(first.orderIds)
  })

  test('rejects HQ review work before writing any context', async () => {
    const workspaceRoot = root()
    const pending = reviewToSocial()
    pending.action = { ...pending.action, ownerScope: 'hq', followUp: undefined }

    await expect(queueAutomationWork('hq-1', workspaceRoot, pending)).rejects.toThrow(/HQ queue-work/i)
    expect(loadContextDoc(workspaceRoot, SCHEDULED_WORK_CONTEXT_SLUG)).toBeNull()
  })

  test('preserves the scheduler timezone on work and calendar shells', async () => {
    const workspaceRoot = root()
    const pending = reviewToSocial()
    pending.event = 'SchedulerTick'
    pending.eventKey = 'SchedulerTick:1720620000000'
    pending.timezone = 'Pacific/Honolulu'

    await queueAutomationWork(workspaceId, workspaceRoot, pending)
    const work = parseScheduledWorkDocResult(loadContextDoc(workspaceRoot, SCHEDULED_WORK_CONTEXT_SLUG) ?? undefined, workspaceId)
    if (!work.ok) throw new Error(work.error)
    expect(work.work.items[0]?.timezone).toBe('Pacific/Honolulu')

    const calendar = parseCampaignCalendarDocResult(loadContextDoc(workspaceRoot, CAMPAIGN_CALENDAR_CONTEXT_SLUG) ?? undefined, workspaceId)
    if (!calendar.ok) throw new Error(calendar.error)
    expect(calendar.calendar.items[0]).toMatchObject({ date: '2026-07-10', time: '04:00', timezone: 'Pacific/Honolulu' })
  })
})
