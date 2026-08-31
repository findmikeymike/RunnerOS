import { afterEach, describe, expect, mock, test } from 'bun:test'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { ScheduleWorkToolInput } from '@craft-agent/session-tools-core'
import * as actualAgentDefinitions from '@craft-agent/shared/agent-definitions'
import { CAMPAIGN_CALENDAR_CONTEXT_SLUG, campaignCalendarMetadata, parseCampaignCalendarDocResult, serializeCampaignCalendarBody } from '@craft-agent/shared/campaign-calendar'
import { resolveAutomationsConfigPath } from '@craft-agent/shared/automations/resolve-config-path'
import { SCHEDULED_WORK_CONTEXT_SLUG, parseScheduledWorkDocResult } from '@craft-agent/shared/scheduled-work'
import { loadContextDoc, upsertContextDoc } from '@craft-agent/shared/workspace-context'
import { persistHnicScheduleWork } from './HnicScheduledWork'
import { materializeReleaseKitItem } from '@craft-agent/shared/release-kit'

mock.module('@craft-agent/shared/agent-definitions', () => ({
  ...actualAgentDefinitions,
  readActivatedAgents: (rootPath: string) => rootPath.includes('hnic-scheduled-work-')
    ? { version: 1, active: ['youtube-intel'] }
    : actualAgentDefinitions.readActivatedAgents(rootPath),
  loadGlobalAgent: (slug: string) => slug === 'youtube-intel'
    ? { slug, metadata: { name: 'YouTube Intel', description: 'Creates reports.' }, systemPrompt: 'Research.', path: '/tmp/youtube-intel', source: 'global' }
    : actualAgentDefinitions.loadGlobalAgent(slug),
}))

const roots: string[] = []

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'hnic-scheduled-work-'))
  roots.push(root)
  return root
}

function input(overrides: Partial<ScheduleWorkToolInput> = {}): ScheduleWorkToolInput {
  return {
    idempotencyKey: 'weekly-youtube-report',
    destination: 'calendar',
    title: 'Weekly YouTube report',
    explanation: 'The user confirmed this schedule.',
    startAt: '2026-07-15T14:00:00.000Z',
    timezone: 'America/Chicago',
    execution: {
      type: 'agent-task',
      agentSlug: 'youtube-intel',
      brief: 'Create the weekly YouTube intelligence report.',
      expectedOutput: { requirement: 'required', kind: 'report' },
    },
    ...overrides,
  }
}

function options(root: string, workInput: ScheduleWorkToolInput, scope: 'hq' | 'campaign' = 'campaign') {
  return {
    workspaceId: 'campaign-1',
    workspaceRootPath: root,
    scope,
    input: workInput,
    onContextChanged: () => {},
    withAutomationLock: async <T>(_path: string, callback: () => Promise<T>) => callback(),
    writeFileAtomic: async (path: string, data: string) => {
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, data, 'utf-8')
    },
    continuationRuntimeId: 'runtime-1',
    continuationFenceToken: 'solo',
  }
}

afterEach(async () => {
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true })
})

describe('persistHnicScheduleWork', () => {
  test('creates one visible coordinator and one hidden first round for confirmed continuation', async () => {
    const root = createRoot()
    upsertContextDoc(root, {
      slug: 'launch-goal',
      metadata: { name: 'Launch Goal', routing: { mode: 'broadcast' }, enabled: true, status: 'active' },
      body: 'Finish the launch plan.',
    })
    const workInput = input({
      execution: {
        type: 'agent-task', agentSlug: 'youtube-intel', brief: 'Create the report.', permissionMode: 'safe',
        expectedOutput: { requirement: 'required', kind: 'report' },
      },
      continuation: { goalSlug: 'launch-goal', objective: 'Finish the launch plan.', maxRounds: 3 },
    })

    const saved = await persistHnicScheduleWork(options(root, workInput))
    const parsed = parseScheduledWorkDocResult(loadContextDoc(root, SCHEDULED_WORK_CONTEXT_SLUG) ?? undefined, 'campaign-1')
    const calendar = parseCampaignCalendarDocResult(loadContextDoc(root, CAMPAIGN_CALENDAR_CONTEXT_SLUG) ?? undefined, 'campaign-1')
    if (!parsed.ok) throw new Error(parsed.error)
    if (!calendar.ok) throw new Error(calendar.error)

    expect(parsed.work.items).toHaveLength(2)
    const coordinator = parsed.work.items.find((item) => item.id === saved.id)
    const round = parsed.work.items.find((item) => item.continuation?.role === 'round')
    expect(coordinator?.status).toBe('waiting')
    expect(coordinator?.continuation?.role).toBe('coordinator')
    expect(round?.status).toBe('scheduled')
    expect(round?.calendarVisibility).toBe('hidden')
    expect(calendar.calendar.items).toHaveLength(1)
    expect(calendar.calendar.items[0]?.scheduledWorkId).toBe(coordinator?.id)
  })

  test('rejects continuation against a non-active Goal', async () => {
    const root = createRoot()
    upsertContextDoc(root, {
      slug: 'paused-goal',
      metadata: { name: 'Paused Goal', routing: { mode: 'broadcast' }, enabled: true, status: 'paused' },
      body: 'Wait.',
    })
    await expect(persistHnicScheduleWork(options(root, input({
      execution: {
        type: 'agent-task', agentSlug: 'youtube-intel', brief: 'Create the report.', permissionMode: 'safe',
        expectedOutput: { requirement: 'required', kind: 'report' },
      },
      continuation: { goalSlug: 'paused-goal', objective: 'Wait.', maxRounds: 3 },
    })))).rejects.toThrow(/must exist, be enabled, and be active/)
  })
  test('writes one idempotent work order and linked campaign item', async () => {
    const root = createRoot()
    const first = await persistHnicScheduleWork(options(root, input()))
    const second = await persistHnicScheduleWork(options(root, input()))

    expect(second).toEqual(first)
    const work = parseScheduledWorkDocResult(loadContextDoc(root, SCHEDULED_WORK_CONTEXT_SLUG) ?? undefined, 'campaign-1')
    const calendar = parseCampaignCalendarDocResult(loadContextDoc(root, CAMPAIGN_CALENDAR_CONTEXT_SLUG) ?? undefined, 'campaign-1')
    if (!work.ok) throw new Error(work.error)
    if (!calendar.ok) throw new Error(calendar.error)
    expect(work.work.items).toHaveLength(1)
    expect(calendar.calendar.items).toHaveLength(1)
    expect(calendar.calendar.items[0]?.scheduledWorkId).toBe(work.work.items[0]?.id)
  })

  test('binds an exact verified Release Kit item to HNIC work and its calendar shell', async () => {
    const root = createRoot()
    const source = join(root, 'teaser.mp4')
    await writeFile(source, 'approved-teaser')
    const promoted = materializeReleaseKitItem(root, {
      workspaceId: 'campaign-1', campaignId: 'campaign-1',
      source: { type: 'campaign-asset', assetId: 'asset-1' }, sourcePath: source,
      category: 'video', subtype: 'teaser', promotedBy: 'user',
    })
    await persistHnicScheduleWork(options(root, input({
      inputRefs: [{ kind: 'release-kit', itemId: promoted.item.id, sha256: promoted.item.sha256, label: 'Approved teaser' }],
    })))
    const work = parseScheduledWorkDocResult(loadContextDoc(root, SCHEDULED_WORK_CONTEXT_SLUG) ?? undefined, 'campaign-1')
    const calendar = parseCampaignCalendarDocResult(loadContextDoc(root, CAMPAIGN_CALENDAR_CONTEXT_SLUG) ?? undefined, 'campaign-1')
    if (!work.ok) throw new Error(work.error)
    if (!calendar.ok) throw new Error(calendar.error)
    expect(work.work.items[0]?.inputRefs).toEqual([{ kind: 'release-kit', itemId: promoted.item.id, sha256: promoted.item.sha256, label: 'Approved teaser' }])
    expect(calendar.calendar.items[0]?.releaseKitRefs).toEqual([{ itemId: promoted.item.id, sha256: promoted.item.sha256, label: 'Approved teaser' }])
  })

  test('rejects a changed or mismatched Release Kit input before persistence', async () => {
    const root = createRoot()
    await expect(persistHnicScheduleWork(options(root, input({
      inputRefs: [{ kind: 'release-kit', itemId: 'kit_missing', sha256: 'a'.repeat(64) }],
    })))).rejects.toThrow(/not found/i)
    expect(loadContextDoc(root, SCHEDULED_WORK_CONTEXT_SLUG)).toBeNull()
  })

  test('rejects reusing an idempotency key for different work', async () => {
    const root = createRoot()
    await persistHnicScheduleWork(options(root, input()))
    await expect(persistHnicScheduleWork(options(root, input({ title: 'Different report' })))).rejects.toThrow(/idempotencyKey/)
  })

  test('heals a missing campaign shell without duplicating the work order', async () => {
    const root = createRoot()
    await persistHnicScheduleWork(options(root, input()))
    upsertContextDoc(root, {
      slug: CAMPAIGN_CALENDAR_CONTEXT_SLUG,
      metadata: campaignCalendarMetadata(),
      body: serializeCampaignCalendarBody({ version: 1, campaignId: 'campaign-1', items: [], updatedAt: '2026-07-15T00:00:00.000Z' }),
    })

    await persistHnicScheduleWork(options(root, input()))
    const work = parseScheduledWorkDocResult(loadContextDoc(root, SCHEDULED_WORK_CONTEXT_SLUG) ?? undefined, 'campaign-1')
    const calendar = parseCampaignCalendarDocResult(loadContextDoc(root, CAMPAIGN_CALENDAR_CONTEXT_SLUG) ?? undefined, 'campaign-1')
    if (!work.ok) throw new Error(work.error)
    if (!calendar.ok) throw new Error(calendar.error)
    expect(work.work.items).toHaveLength(1)
    expect(calendar.calendar.items).toHaveLength(1)
  })

  test('writes HQ work to the global calendar contract', async () => {
    const root = createRoot()
    await persistHnicScheduleWork(options(root, input(), 'hq'))
    const work = parseScheduledWorkDocResult(loadContextDoc(root, SCHEDULED_WORK_CONTEXT_SLUG) ?? undefined, 'campaign-1')
    if (!work.ok) throw new Error(work.error)

    expect(work.work.items[0]?.owner).toEqual({ scope: 'hq', workspaceId: 'campaign-1' })
    expect(loadContextDoc(root, 'artist-calendar')?.body).toContain(work.work.items[0]!.id)
  })

  test('writes one hidden scheduled automation and reuses it on retry', async () => {
    const root = createRoot()
    const automationInput = input({
      destination: 'automation',
      startAt: undefined,
      showOnCalendar: false,
      trigger: { type: 'schedule', cron: '0 9 * * 1', timezone: 'America/Chicago' },
    })
    const first = await persistHnicScheduleWork(options(root, automationInput))
    const second = await persistHnicScheduleWork(options(root, automationInput))
    const config = await Bun.file(resolveAutomationsConfigPath(root)).json()

    expect(second.id).toBe(first.id)
    expect(config.automations.SchedulerTick).toHaveLength(1)
    expect(config.automations.SchedulerTick[0].actions[0]).toMatchObject({
      type: 'queue-work',
      ownerScope: 'campaign',
      calendarVisibility: 'hidden',
    })
  })
})
