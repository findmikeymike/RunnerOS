import { afterEach, describe, expect, mock, test } from 'bun:test'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { ScheduleWorkToolInput } from '@craft-agent/session-tools-core'
import * as actualAgentDefinitions from '@craft-agent/shared/agent-definitions'
import * as actualWorkflows from '@craft-agent/shared/workflows'
import { CAMPAIGN_CALENDAR_CONTEXT_SLUG, campaignCalendarMetadata, parseCampaignCalendarDocResult, serializeCampaignCalendarBody } from '@craft-agent/shared/campaign-calendar'
import { resolveAutomationsConfigPath } from '@craft-agent/shared/automations/resolve-config-path'
import { SCHEDULED_WORK_CONTEXT_SLUG, parseScheduledWorkDocResult, scheduledWorkDefinitionDigest } from '@craft-agent/shared/scheduled-work'
import { hqSemanticIntentId } from '@craft-agent/shared/hq-state'
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

mock.module('@craft-agent/shared/workflows', () => ({
  ...actualWorkflows,
  readActivatedWorkflows: (rootPath: string) => rootPath.includes('hnic-scheduled-work-')
    ? { version: 1, active: ['input-workflow', 'legacy-input-workflow'] }
    : actualWorkflows.readActivatedWorkflows(rootPath),
  loadGlobalWorkflow: (slug: string) => {
    if (slug === 'legacy-input-workflow') {
      return {
        slug,
        metadata: {
          name: 'Legacy Input Workflow',
          description: 'Represents an automation saved before input bindings existed.',
          trigger: {
            type: 'manual',
            inputs: [
              { name: 'count', type: 'number', required: true },
              { name: 'enabled', type: 'boolean', required: true },
            ],
          },
          steps: [{ id: 'draft', agent: 'youtube-intel', input: '{{trigger.count}}' }],
        },
        body: 'Run the legacy workflow.',
        path: '/tmp/legacy-input-workflow',
        source: 'global',
      }
    }
    return slug === 'input-workflow' ? {
        slug,
        metadata: {
          name: 'Input Workflow',
          description: 'Uses one required topic and one optional limit.',
          trigger: {
            type: 'manual',
            inputs: [
              { name: 'topic', type: 'string', required: true },
              { name: 'limit', type: 'number', default: 5 },
            ],
          },
          steps: [{ id: 'draft', agent: 'youtube-intel', input: '{{trigger.topic}}' }],
        },
        body: 'Run the workflow.',
        path: '/tmp/input-workflow',
        source: 'global',
      }
      : actualWorkflows.loadGlobalWorkflow(slug)
  },
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

function workflowAutomation(overrides: Partial<ScheduleWorkToolInput> = {}): ScheduleWorkToolInput {
  return input({
    idempotencyKey: 'input-workflow-automation',
    destination: 'automation',
    startAt: undefined,
    execution: {
      type: 'workflow-run',
      workflowSlug: 'input-workflow',
      inputBindings: {
        topic: { mode: 'ask' },
        limit: { mode: 'fixed', value: 7 },
      },
    },
    trigger: { type: 'schedule', cadence: 'weekly', timezone: 'America/Chicago' },
    ...overrides,
  })
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

  test('backfills legacy idempotency metadata when the saved definition still matches', async () => {
    const root = createRoot()
    const automationInput = input({
      destination: 'automation',
      startAt: undefined,
      trigger: { type: 'schedule', cron: '0 9 * * 1', timezone: 'America/Chicago' },
    })
    const first = await persistHnicScheduleWork(options(root, automationInput))
    const path = resolveAutomationsConfigPath(root)
    const config = await Bun.file(path).json()
    const saved = config.automations.SchedulerTick[0]
    const { id: _id, scheduleWorkDigest: _digest, scheduleWorkIntentDigest: _intent, ...legacyMatcher } = saved
    delete legacyMatcher.actions[0].intentId
    saved.actions = legacyMatcher.actions
    saved.scheduleWorkDigest = scheduledWorkDefinitionDigest({ eventName: 'SchedulerTick', matcher: legacyMatcher })
    delete saved.scheduleWorkIntentDigest
    await writeFile(path, `${JSON.stringify(config, null, 2)}\n`)

    const retried = await persistHnicScheduleWork(options(root, automationInput))
    const healed = await Bun.file(path).json()
    expect(retried.id).toBe(first.id)
    expect(healed.automations.SchedulerTick[0].scheduleWorkIntentDigest).toBeString()
    expect(healed.automations.SchedulerTick[0].actions[0].intentId).toBeString()
  })

  test('reuses an exact legacy workflow automation before strict input resolution', async () => {
    const root = createRoot()
    const workInput = input({
      idempotencyKey: 'legacy-workflow-retry',
      destination: 'automation',
      startAt: undefined,
      execution: { type: 'workflow-run', workflowSlug: 'legacy-input-workflow' },
      trigger: { type: 'schedule', cron: '0 9 * * 1', timezone: 'America/Chicago' },
    })
    const workflow = {
      slug: 'legacy-input-workflow',
      metadata: {
        name: 'Legacy Input Workflow', description: 'Represents an automation saved before input bindings existed.', trigger: {
          type: 'manual' as const,
          inputs: [
            { name: 'count', type: 'number' as const, required: true },
            { name: 'enabled', type: 'boolean' as const, required: true },
          ],
        },
        steps: [{ id: 'draft', agent: 'youtube-intel', input: '{{trigger.count}}' }],
      },
      body: 'Run the legacy workflow.', path: '/tmp/legacy-input-workflow', source: 'global' as const,
    }
    const execution = {
      type: 'workflow-run' as const,
      workflowSlug: 'legacy-input-workflow',
      workflowDigest: scheduledWorkDefinitionDigest({ metadata: workflow.metadata, body: workflow.body }),
      triggerInputs: { count: 0, enabled: false },
    }
    const matcher: Record<string, unknown> = {
      name: workInput.title,
      enabled: true,
      actions: [{
        type: 'queue-work', ownerScope: 'campaign', calendarVisibility: 'visible',
        title: workInput.title, execution, inputRefs: [],
      }],
      cron: '0 9 * * 1',
      timezone: 'America/Chicago',
      scheduleWorkKey: workInput.idempotencyKey,
    }
    const saved = {
      ...matcher,
      id: 'legacy-workflow-id',
      scheduleWorkDigest: scheduledWorkDefinitionDigest({ eventName: 'SchedulerTick', matcher }),
    }
    const path = resolveAutomationsConfigPath(root)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, `${JSON.stringify({ version: 2, automations: { SchedulerTick: [saved] } }, null, 2)}\n`)

    const retried = await persistHnicScheduleWork(options(root, workInput))
    const after = await Bun.file(path).json()
    expect(retried.id).toBe('legacy-workflow-id')
    expect(after.automations.SchedulerTick).toEqual([saved])
  })

  test('persists explicit workflow bindings without inventing missing values', async () => {
    const root = createRoot()
    await persistHnicScheduleWork(options(root, workflowAutomation()))
    const config = await Bun.file(resolveAutomationsConfigPath(root)).json()
    const action = config.automations.SchedulerTick[0].actions[0]

    expect(action.inputBindings).toEqual({
      topic: { mode: 'ask' },
      limit: { mode: 'fixed', value: 7 },
    })
    expect(action.intentId).toBe(hqSemanticIntentId({
      title: workflowAutomation().title.trim(),
      intent: JSON.stringify(action.execution),
    }))
    expect(action.execution.triggerInputs).toEqual({ limit: 7 })
  })

  test('requires a binding for every required workflow input', async () => {
    const root = createRoot()
    await expect(persistHnicScheduleWork(options(root, workflowAutomation({
      execution: {
        type: 'workflow-run',
        workflowSlug: 'input-workflow',
        inputBindings: { limit: { mode: 'fixed', value: 3 } },
      },
    })))).rejects.toThrow(/needs a binding: topic/)
  })

  test('rejects a trigger binding the selected event cannot provide', async () => {
    const root = createRoot()
    await expect(persistHnicScheduleWork(options(root, workflowAutomation({
      execution: {
        type: 'workflow-run',
        workflowSlug: 'input-workflow',
        inputBindings: {
          topic: { mode: 'trigger', from: 'file.path' },
          limit: { mode: 'fixed', value: 3 },
        },
      },
    })))).rejects.toThrow(/schedule cannot provide.*file\.path/)
  })

  test('rejects trigger text bound to non-string workflow inputs', async () => {
    const root = createRoot()
    await expect(persistHnicScheduleWork(options(root, workflowAutomation({
      execution: {
        type: 'workflow-run',
        workflowSlug: 'input-workflow',
        inputBindings: {
          topic: { mode: 'ask' },
          limit: { mode: 'trigger', from: 'message.text' },
        },
      },
      trigger: { type: 'message' },
    })))).rejects.toThrow(/must be a string: limit/)
  })

  test('places automatic schedules across workspaces and keeps retries idempotent', async () => {
    const root = createRoot()
    const occupiedRoot = createRoot()
    const occupiedPath = resolveAutomationsConfigPath(occupiedRoot)
    await mkdir(dirname(occupiedPath), { recursive: true })
    await writeFile(occupiedPath, JSON.stringify({
      version: 2,
      automations: {
        SchedulerTick: [{ id: 'taken', name: 'Taken', cron: '0 9 * * 1', timezone: 'America/Chicago', enabled: true, actions: [{ type: 'prompt', prompt: 'Run.' }] }],
      },
    }))
    const workInput = workflowAutomation()
    const persistenceOptions = {
      ...options(root, workInput),
      automationWorkspaceRootPaths: [root, occupiedRoot],
    }

    const first = await persistHnicScheduleWork(persistenceOptions)
    const second = await persistHnicScheduleWork(persistenceOptions)
    const config = await Bun.file(resolveAutomationsConfigPath(root)).json()

    expect(second.id).toBe(first.id)
    expect(config.automations.SchedulerTick).toHaveLength(1)
    expect(config.automations.SchedulerTick[0].cron).toBe('0 9 * * 2')
  })

  test('serializes simultaneous automatic placement across workspaces', async () => {
    const firstRoot = createRoot()
    const secondRoot = createRoot()
    let lane: Promise<void> = Promise.resolve()
    const withAutomaticScheduleLock = <T>(callback: () => Promise<T>): Promise<T> => {
      const next = lane.then(callback, callback)
      lane = next.then(() => {}, () => {})
      return next
    }
    const rootsForPlacement = [firstRoot, secondRoot]
    const firstInput = workflowAutomation({ idempotencyKey: 'automatic-first' })
    const secondInput = workflowAutomation({ idempotencyKey: 'automatic-second' })

    await Promise.all([
      persistHnicScheduleWork({
        ...options(firstRoot, firstInput),
        automationWorkspaceRootPaths: rootsForPlacement,
        withAutomaticScheduleLock,
      }),
      persistHnicScheduleWork({
        ...options(secondRoot, secondInput),
        automationWorkspaceRootPaths: rootsForPlacement,
        withAutomaticScheduleLock,
      }),
    ])

    const firstConfig = await Bun.file(resolveAutomationsConfigPath(firstRoot)).json()
    const secondConfig = await Bun.file(resolveAutomationsConfigPath(secondRoot)).json()
    expect(new Set([
      firstConfig.automations.SchedulerTick[0].cron,
      secondConfig.automations.SchedulerTick[0].cron,
    ])).toEqual(new Set(['0 9 * * 1', '0 9 * * 2']))
  })

  test('fails automatic placement when another workspace schedule cannot be inspected', async () => {
    const root = createRoot()
    const brokenRoot = createRoot()
    const brokenPath = resolveAutomationsConfigPath(brokenRoot)
    await mkdir(dirname(brokenPath), { recursive: true })
    await writeFile(brokenPath, '{not-json')

    await expect(persistHnicScheduleWork({
      ...options(root, workflowAutomation()),
      automationWorkspaceRootPaths: [root, brokenRoot],
    })).rejects.toThrow(/Could not inspect automation schedules/)
  })

  test('rejects ambiguous automatic schedule definitions at the persistence boundary', async () => {
    const root = createRoot()
    await expect(persistHnicScheduleWork(options(root, workflowAutomation({
      trigger: { type: 'schedule', cron: '0 9 * * 1', cadence: 'weekly', timezone: 'America/Chicago' },
    })))).rejects.toThrow(/exactly one of cron or cadence/)
  })
})
