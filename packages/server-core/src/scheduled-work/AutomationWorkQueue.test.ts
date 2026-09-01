import { afterEach, describe, expect, mock, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PendingQueuedWork } from '@craft-agent/shared/automations'
import { CAMPAIGN_CALENDAR_CONTEXT_SLUG, parseCampaignCalendarDocResult } from '@craft-agent/shared/campaign-calendar'
import { SCHEDULED_WORK_CONTEXT_SLUG, parseScheduledWorkDocResult, scheduledWorkDefinitionDigest } from '@craft-agent/shared/scheduled-work'
import { loadContextDoc, upsertContextDoc } from '@craft-agent/shared/workspace-context'
import * as actualAgentDefinitions from '@craft-agent/shared/agent-definitions'
import { queueAutomationWork } from './AutomationWorkQueue'
import { withWorkspaceContextLock } from './workspace-context-lock'

mock.module('@craft-agent/shared/agent-definitions', () => ({
  ...actualAgentDefinitions,
  readActivatedAgents: (rootPath: string) => rootPath.includes('automation-work-queue-')
    ? { version: 1, active: ['youtube-intel'] }
    : actualAgentDefinitions.readActivatedAgents(rootPath),
  loadGlobalAgent: (slug: string) => slug === 'youtube-intel'
    ? { slug, metadata: { name: 'YouTube Intel', description: 'Creates YouTube intelligence reports.' }, systemPrompt: 'Research YouTube.', path: '/tmp/youtube-intel', source: 'global' }
    : actualAgentDefinitions.loadGlobalAgent(slug),
}))

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

  test('queues hidden standalone work without creating a calendar shell', async () => {
    const workspaceRoot = root()
    const pending = reviewToSocial()
    pending.action = {
      type: 'queue-work',
      ownerScope: 'campaign',
      calendarVisibility: 'hidden',
      title: 'Weekly YouTube intelligence report',
      execution: {
        type: 'agent-task',
        agentSlug: 'youtube-intel',
        brief: 'Gather this week\'s YouTube intelligence and create a report.',
        permissionMode: 'safe',
        expectedOutput: { requirement: 'required', kind: 'report' },
      },
    }

    const result = await queueAutomationWork(workspaceId, workspaceRoot, pending)
    expect(result.calendarItemIds).toEqual([])
    expect(loadContextDoc(workspaceRoot, CAMPAIGN_CALENDAR_CONTEXT_SLUG)).toBeNull()
    const work = parseScheduledWorkDocResult(loadContextDoc(workspaceRoot, SCHEDULED_WORK_CONTEXT_SLUG) ?? undefined, workspaceId)
    if (!work.ok) throw new Error(work.error)
    expect(work.work.items[0]).toMatchObject({
      title: 'Weekly YouTube intelligence report',
      calendarVisibility: 'hidden',
      type: 'agent-task',
    })
  })

  test('stale weekly Signal automation cannot queue work when current settings are off', async () => {
    const workspaceRoot = root()
    upsertContextDoc(workspaceRoot, {
      slug: 'artist-intel-config',
      metadata: { name: 'Signal config', routing: { mode: 'broadcast' }, enabled: true },
      body: '```json\n{"version":1,"enabled":false,"cadence":"manual"}\n```',
    })
    const result = await queueAutomationWork(workspaceId, workspaceRoot, {
      matcherId: 'weekly-signal-scan',
      automationName: 'Weekly Signal Scan',
      event: 'SchedulerTick',
      eventTimestamp: Date.parse('2026-07-10T14:00:00.000Z'),
      eventKey: 'SchedulerTick:1720620000000',
      action: {
        type: 'queue-work',
        ownerScope: 'hq',
        calendarVisibility: 'hidden',
        title: 'Weekly Signal Scan',
        intentId: 'artist-hq:weekly-signal-scan',
        execution: {
          type: 'workflow-run',
          workflowSlug: 'weekly-signal-scan',
          workflowDigest: 'stale-digest',
          triggerInputs: {},
        },
      },
    })

    expect(result).toEqual({ orderIds: [], calendarItemIds: [] })
    expect(loadContextDoc(workspaceRoot, SCHEDULED_WORK_CONTEXT_SLUG)).toBeNull()
  })

  test('manual Signal runs bypass the weekly-enabled guard', async () => {
    const workspaceRoot = root()
    upsertContextDoc(workspaceRoot, {
      slug: 'artist-intel-config',
      metadata: { name: 'Signal config', routing: { mode: 'broadcast' }, enabled: true },
      body: '```json\n{"version":1,"enabled":false,"cadence":"manual"}\n```',
    })
    const result = await queueAutomationWork(workspaceId, workspaceRoot, {
      matcherId: 'manual-signal-scan',
      automationName: 'Manual Signal Scan',
      event: 'SchedulerTick',
      eventTimestamp: Date.parse('2026-07-10T14:00:00.000Z'),
      eventKey: 'test:1720620000000',
      action: {
        type: 'queue-work',
        ownerScope: 'hq',
        calendarVisibility: 'hidden',
        title: 'Weekly Signal Scan',
        intentId: 'artist-hq:weekly-signal-scan',
        execution: {
          type: 'agent-task',
          agentSlug: 'youtube-intel',
          brief: 'Run the manually requested Signal scan.',
          permissionMode: 'safe',
          expectedOutput: { requirement: 'none' },
        },
      },
    })

    expect(result.orderIds).toHaveLength(1)
  })

  test('collapses overlapping Signal runs onto the active order', async () => {
    const workspaceRoot = root()
    upsertContextDoc(workspaceRoot, {
      slug: 'artist-intel-config',
      metadata: { name: 'Signal config', routing: { mode: 'broadcast' }, enabled: true },
      body: '```json\n{"version":1,"enabled":true,"cadence":"weekly"}\n```',
    })
    const pending: PendingQueuedWork = {
      matcherId: 'weekly-signal-scan',
      automationName: 'Weekly Signal Scan',
      event: 'SchedulerTick',
      eventTimestamp: Date.parse('2026-07-10T14:00:00.000Z'),
      eventKey: 'SchedulerTick:1720620000000',
      action: {
        type: 'queue-work',
        ownerScope: 'hq',
        calendarVisibility: 'hidden',
        title: 'Weekly Signal Scan',
        intentId: 'artist-hq:weekly-signal-scan',
        execution: {
          type: 'agent-task',
          agentSlug: 'youtube-intel',
          brief: 'Run the weekly Signal scan.',
          permissionMode: 'safe',
          expectedOutput: { requirement: 'none' },
        },
      },
    }

    const first = await queueAutomationWork(workspaceId, workspaceRoot, pending)
    const second = await queueAutomationWork(workspaceId, workspaceRoot, {
      ...pending,
      eventTimestamp: pending.eventTimestamp + 60_000,
      eventKey: 'SchedulerTick:1720620060000',
      action: {
        ...pending.action,
        intentId: 'artist-hq-weekly-signal-scan',
      },
    })
    const work = parseScheduledWorkDocResult(loadContextDoc(workspaceRoot, SCHEDULED_WORK_CONTEXT_SLUG) ?? undefined, workspaceId)
    if (!work.ok) throw new Error(work.error)

    expect(second).toEqual(first)
    expect(work.work.items).toHaveLength(1)
  })

  test('weekly Signal automation proceeds to normal validation when current settings enable it', async () => {
    const workspaceRoot = root()
    upsertContextDoc(workspaceRoot, {
      slug: 'artist-intel-config',
      metadata: { name: 'Signal config', routing: { mode: 'broadcast' }, enabled: true },
      body: '```json\n{"version":1,"enabled":true,"cadence":"weekly"}\n```',
    })
    const pending: PendingQueuedWork = {
      matcherId: 'weekly-signal-scan',
      automationName: 'Weekly Signal Scan',
      event: 'SchedulerTick',
      eventTimestamp: Date.parse('2026-07-10T14:00:00.000Z'),
      eventKey: 'SchedulerTick:1720620000000',
      action: {
        type: 'queue-work',
        ownerScope: 'hq',
        calendarVisibility: 'hidden',
        title: 'Weekly Signal Scan',
        intentId: 'artist-hq:weekly-signal-scan',
        execution: {
          type: 'workflow-run',
          workflowSlug: 'weekly-signal-scan',
          workflowDigest: 'stale-digest',
          triggerInputs: {},
        },
      },
    }

    await expect(queueAutomationWork(workspaceId, workspaceRoot, pending)).rejects.toThrow(/not active/i)
  })

  test('concurrent Signal disable wins before queued work is persisted', async () => {
    const workspaceRoot = root()
    const writeConfig = (enabled: boolean, cadence: 'manual' | 'weekly') => upsertContextDoc(workspaceRoot, {
      slug: 'artist-intel-config',
      metadata: { name: 'Signal config', routing: { mode: 'broadcast' }, enabled: true },
      body: `\`\`\`json\n${JSON.stringify({ version: 1, enabled, cadence })}\n\`\`\``,
    })
    writeConfig(true, 'weekly')

    let releaseDisable!: () => void
    let disableLockEntered!: () => void
    const disableReady = new Promise<void>((resolve) => { disableLockEntered = resolve })
    const disableGate = new Promise<void>((resolve) => { releaseDisable = resolve })
    const disable = withWorkspaceContextLock(workspaceRoot, async () => {
      disableLockEntered()
      await disableGate
      writeConfig(false, 'manual')
    })
    await disableReady

    const queued = queueAutomationWork(workspaceId, workspaceRoot, {
      matcherId: 'weekly-signal-scan',
      automationName: 'Weekly Signal Scan',
      event: 'SchedulerTick',
      eventTimestamp: Date.parse('2026-07-10T14:00:00.000Z'),
      eventKey: 'SchedulerTick:1720620000000',
      action: {
        type: 'queue-work',
        ownerScope: 'hq',
        calendarVisibility: 'hidden',
        title: 'Weekly Signal Scan',
        intentId: 'artist-hq:weekly-signal-scan',
        execution: {
          type: 'workflow-run',
          workflowSlug: 'weekly-signal-scan',
          workflowDigest: 'stale-digest',
          triggerInputs: {},
        },
      },
    })
    releaseDisable()
    await disable

    expect(await queued).toEqual({ orderIds: [], calendarItemIds: [] })
    expect(loadContextDoc(workspaceRoot, SCHEDULED_WORK_CONTEXT_SLUG)).toBeNull()
  })
})
