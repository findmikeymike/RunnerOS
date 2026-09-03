import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { Cron } from 'croner'
import type { ScheduleWorkToolInput } from '@craft-agent/session-tools-core'
import { loadGlobalAgent, readActivatedAgents } from '@craft-agent/shared/agent-definitions'
import {
  ARTIST_CALENDAR_CONTEXT_SLUG,
  artistCalendarMetadata,
  parseArtistCalendarDocResult,
  serializeArtistCalendarBody,
  type ArtistCalendar,
} from '@craft-agent/shared/artist-context'
import { loadGlobalWorkflow, readActivatedWorkflows } from '@craft-agent/shared/workflows'
import { normalizeWorkflowTriggerInputs } from '@craft-agent/shared/workflows/trigger-inputs'
import {
  CAMPAIGN_CALENDAR_CONTEXT_SLUG,
  campaignCalendarMetadata,
  createCampaignCalendarItem,
  parseCampaignCalendarDocResult,
  serializeCampaignCalendarBody,
} from '@craft-agent/shared/campaign-calendar'
import {
  SCHEDULED_WORK_CONTEXT_SLUG,
  applyScheduledWorkMutation,
  parseScheduledWorkDocResult,
  scheduledWorkDefinitionDigest,
  scheduledWorkMetadata,
  serializeScheduledWorkBody,
  type ScheduledWorkExecution,
  type ScheduledWorkOrder,
} from '@craft-agent/shared/scheduled-work'
import {
  assertWorkflowInputBindings,
  validateAutomationsConfig,
} from '@craft-agent/shared/automations'
import { suggestAutomaticSchedule, type ExistingAutomationSchedule } from '@craft-agent/shared/automations/staggered-schedule'
import { hqSemanticIntentId } from '@craft-agent/shared/hq-state'
import { generateShortId, resolveAutomationsConfigPath } from '@craft-agent/shared/automations/resolve-config-path'
import { loadAllContextDocs, loadContextDoc, upsertContextDoc, type LoadedContextDoc } from '@craft-agent/shared/workspace-context'
import { withWorkspaceContextLock } from './workspace-context-lock'
import { resolveVerifiedReleaseKitItemPathWhileLocked, withReleaseKitLockAsync } from '@craft-agent/shared/release-kit'

type WorkspaceScope = 'hq' | 'campaign'

export interface ScheduleWorkPersistenceOptions {
  workspaceId: string
  workspaceRootPath: string
  scope: WorkspaceScope
  input: ScheduleWorkToolInput
  onContextChanged: (docs: LoadedContextDoc[]) => void
  withAutomationLock: <T>(path: string, fn: () => Promise<T>) => Promise<T>
  withAutomaticScheduleLock?: <T>(fn: () => Promise<T>) => Promise<T>
  writeFileAtomic: (path: string, data: string) => Promise<void>
  automationWorkspaceRootPaths?: string[]
  continuationRuntimeId?: string
  continuationFenceToken?: string
}

export async function persistHnicScheduleWork(options: ScheduleWorkPersistenceOptions): Promise<{
  id: string
  title: string
  nextFireAt?: string
}> {
  if (options.input.destination === 'automation') {
    let execution: ScheduledWorkExecution
    try {
      execution = resolveExecution(options.workspaceRootPath, options.input)
    } catch (error) {
      const legacy = await findMatchingLegacyAutomation(options)
      if (legacy) return legacy
      throw error
    }
    return persistAutomation(options, execution)
  }
  return persistCalendarWork(options, resolveExecution(options.workspaceRootPath, options.input))
}

export function inferScheduledWorkScope(workspace: { artistWorkspaceScope?: WorkspaceScope | 'lab' | 'general' }): WorkspaceScope {
  if (!workspace.artistWorkspaceScope) {
    throw new Error('Workspace is missing its persisted artist calendar scope. Restart RunnerOS to migrate workspace metadata.')
  }
  if (workspace.artistWorkspaceScope === 'general' || workspace.artistWorkspaceScope === 'lab') {
    throw new Error('Scheduled artist work must be created from Artist HQ or a Campaign workspace.')
  }
  return workspace.artistWorkspaceScope
}

function resolveExecution(rootPath: string, request: ScheduleWorkToolInput): ScheduledWorkExecution {
  const input = request.execution
  if (input.type === 'agent-task') {
    if ('inputBindings' in input && input.inputBindings) {
      throw new Error('Workflow input bindings are available only for workflow work.')
    }
    if (!readActivatedAgents(rootPath).active.includes(input.agentSlug)) {
      throw new Error(`Agent is not active in this workspace: ${input.agentSlug}`)
    }
    if (!loadGlobalAgent(input.agentSlug)) throw new Error(`Agent definition was not found: ${input.agentSlug}`)
    return {
      type: 'agent-task',
      agentSlug: input.agentSlug,
      brief: input.brief.trim(),
      permissionMode: input.permissionMode ?? 'safe',
      expectedOutput: {
        requirement: input.expectedOutput?.requirement ?? 'none',
        kind: input.expectedOutput?.kind,
        title: input.expectedOutput?.title?.trim() || undefined,
      },
    }
  }

  if (!readActivatedWorkflows(rootPath).active.includes(input.workflowSlug)) {
    throw new Error(`Workflow is not active in this workspace: ${input.workflowSlug}`)
  }
  const workflow = loadGlobalWorkflow(input.workflowSlug)
  if (!workflow) throw new Error(`Workflow definition was not found: ${input.workflowSlug}`)
  const supplied = input.triggerInputs ?? {}
  let triggerInputs: Record<string, unknown>
  if (!input.inputBindings) {
    triggerInputs = normalizeWorkflowTriggerInputs(workflow, supplied)
  } else {
    if (request.destination !== 'automation') {
      throw new Error('Workflow input bindings are available only for Automations.')
    }
    assertWorkflowInputBindings(
      workflow.metadata.trigger.inputs ?? [],
      input.inputBindings,
      request.trigger!.type,
      { allowUnauthenticatedWebhook: request.trigger?.type === 'webhook' && request.trigger.allowUnauthenticated === true },
    )
    const raw: Record<string, unknown> = {}
    for (const control of ['enabled_source_slugs', 'permission_mode'] as const) {
      if (Object.prototype.hasOwnProperty.call(supplied, control)) raw[control] = supplied[control]
    }
    const unresolved: string[] = []
    for (const definition of workflow.metadata.trigger.inputs ?? []) {
      const binding = input.inputBindings[definition.name]
      if (binding?.mode === 'fixed') raw[definition.name] = binding.value
      if (binding && binding.mode !== 'fixed') unresolved.push(definition.name)
    }
    triggerInputs = normalizeWorkflowTriggerInputs(workflow, raw, {
      allowMissingRequired: unresolved,
      skipDefaultsFor: unresolved,
    })
  }
  return {
    type: 'workflow-run',
    workflowSlug: workflow.slug,
    workflowDigest: scheduledWorkDefinitionDigest({ metadata: workflow.metadata, body: workflow.body }),
    triggerInputs,
  }
}

async function persistCalendarWork(options: ScheduleWorkPersistenceOptions, execution: ScheduledWorkExecution): Promise<{ id: string; title: string }> {
  const startAt = new Date(options.input.startAt!).toISOString()
  const timezone = options.input.timezone!
  const local = formatInTimezone(startAt, timezone)
  const requestId = createHash('sha256').update(`${options.workspaceId}:${options.input.idempotencyKey}`).digest('hex').slice(0, 24)
  const orderId = `${options.scope === 'hq' ? 'hq-work' : 'scheduled-work'}-${requestId}`
  const calendarItemId = `${options.scope === 'hq' ? orderId : `campaign-item-${requestId}`}-calendar`
  const now = new Date().toISOString()
  const inputRefs = (options.input.inputRefs ?? []).map((ref) => ({
    kind: 'release-kit' as const,
    itemId: ref.itemId.trim(),
    sha256: ref.sha256.toLowerCase(),
    ...(ref.label?.trim() ? { label: ref.label.trim() } : {}),
  }))
  if (inputRefs.length > 0 && options.scope !== 'campaign') {
    throw new Error('Release Kit inputs belong to campaign Calendar work.')
  }
  const continuationInput = options.input.continuation
  if (continuationInput && execution.type !== 'agent-task') throw new Error('Continuation is available only for agent tasks.')
  const goalDoc = continuationInput ? loadContextDoc(options.workspaceRootPath, continuationInput.goalSlug) : undefined
  if (continuationInput && (!goalDoc || !goalDoc.metadata.enabled || goalDoc.metadata.status !== 'active')) {
    throw new Error(`Continuation Goal must exist, be enabled, and be active: ${continuationInput.goalSlug}`)
  }
  if (continuationInput && execution.type === 'agent-task' && execution.expectedOutput.requirement !== 'required') {
    throw new Error('Continuation requires a required Output contract.')
  }
  if (continuationInput && execution.type === 'agent-task' && execution.permissionMode !== 'safe') {
    throw new Error('Continuation runs are draft-only and require safe permission mode.')
  }
  if (continuationInput && (!Number.isInteger(continuationInput.maxRounds) || continuationInput.maxRounds < 2 || continuationInput.maxRounds > 8)) {
    throw new Error('Continuation maxRounds must be an integer from 2 through 8.')
  }
  const runtimeId = continuationInput ? options.continuationRuntimeId?.trim() : undefined
  const runnerFence = continuationInput ? options.continuationFenceToken?.trim() : undefined
  if (continuationInput && !runtimeId) throw new Error('Scheduled Work continuation runtime is unavailable.')
  if (continuationInput && !runnerFence) throw new Error('Scheduled Work continuation runner ownership could not be verified.')
  const goalRevision = goalDoc ? scheduledWorkDefinitionDigest({ metadata: goalDoc.metadata, body: goalDoc.body }) : undefined
  const runId = continuationInput ? `goal-run-${requestId}` : undefined
  const continuationDefinition = continuationInput ? {
    goalSlug: continuationInput.goalSlug,
    goalRevision,
    objective: continuationInput.objective.trim(),
    maxRounds: continuationInput.maxRounds,
    permissionCeiling: execution.type === 'agent-task' ? execution.permissionMode : undefined,
  } : undefined
  const payloadDigest = scheduledWorkDefinitionDigest({ execution, inputRefs, startAt, continuation: continuationDefinition })
  const order: ScheduledWorkOrder = {
    version: 1,
    id: orderId,
    owner: options.scope === 'hq'
      ? { scope: 'hq', workspaceId: options.workspaceId }
      : { scope: 'campaign', workspaceId: options.workspaceId, campaignId: options.workspaceId },
    calendarLink: { calendar: options.scope, itemId: calendarItemId },
    title: options.input.title.trim(),
    intentId: hqSemanticIntentId({ title: options.input.title, intent: JSON.stringify(execution) }),
    type: execution.type,
    status: continuationInput ? 'waiting' : 'scheduled',
    startAt,
    timezone,
    execution,
    inputRefs,
    approvals: [],
    runs: [],
    executionKey: { payloadDigest, idempotencyKey: `${orderId}:${startAt}:${payloadDigest}` },
    continuation: continuationInput && execution.type === 'agent-task' ? {
      role: 'coordinator',
      runId: runId!,
      coordinatorOrderId: orderId,
      goalSlug: continuationInput.goalSlug,
      goalRevision: goalRevision!,
      objective: continuationInput.objective.trim(),
      round: 0,
      maxRounds: continuationInput.maxRounds,
      runtimeId: runtimeId!,
      runnerFence: runnerFence!,
      permissionCeiling: execution.permissionMode,
    } : undefined,
    createdAt: now,
    updatedAt: now,
  }
  const firstRound: ScheduledWorkOrder | undefined = order.continuation && execution.type === 'agent-task' ? {
    ...order,
    id: `${orderId}-round-1`,
    calendarLink: { calendar: options.scope, itemId: `${calendarItemId}-round-1` },
    calendarVisibility: 'hidden',
    title: `${order.title} — round 1`,
    status: 'scheduled',
    continuation: {
      ...order.continuation,
      role: 'round',
      round: 1,
      parentOrderId: orderId,
    },
    executionKey: {
      payloadDigest: scheduledWorkDefinitionDigest({ payloadDigest, runId, round: 1 }),
      idempotencyKey: `${runId}:round:1:${goalRevision}`,
    },
  } : undefined

  const persist = () => withWorkspaceContextLock(options.workspaceRootPath, async () => {
    for (const ref of inputRefs) {
      resolveVerifiedReleaseKitItemPathWhileLocked(
        options.workspaceRootPath,
        options.workspaceId,
        options.workspaceId,
        ref.itemId,
        ref.sha256,
      )
    }
    const parsedWork = parseScheduledWorkDocResult(loadContextDoc(options.workspaceRootPath, SCHEDULED_WORK_CONTEXT_SLUG) ?? undefined, options.workspaceId)
    if (!parsedWork.ok) throw new Error(parsedWork.error)
    const existingOrder = parsedWork.work.items.find((candidate) => candidate.id === order.id)
    if (existingOrder && (
      existingOrder.executionKey.payloadDigest !== order.executionKey.payloadDigest
      || existingOrder.startAt !== order.startAt
      || existingOrder.timezone !== order.timezone
      || existingOrder.title !== order.title
    )) {
      throw new Error(`idempotencyKey is already bound to different scheduled work: ${options.input.idempotencyKey}`)
    }
    const mutation = existingOrder
      ? { ok: true as const, work: parsedWork.work, item: existingOrder }
      : applyScheduledWorkMutation(parsedWork.work, { operation: 'upsert', order, expectedUpdatedAt: null }, now)
    if (!mutation.ok) throw new Error(mutation.error)
    const firstRoundMutation = firstRound && !existingOrder
      ? applyScheduledWorkMutation(mutation.work, { operation: 'upsert', order: firstRound, expectedUpdatedAt: null }, now)
      : mutation
    if (!firstRoundMutation.ok) throw new Error(firstRoundMutation.error)
    let changed = !existingOrder

    if (options.scope === 'hq') {
      const artistCalendar = readArtistCalendar(options.workspaceRootPath)
      const existingEvent = artistCalendar.events.find((candidate) => candidate.id === calendarItemId)
      if (existingEvent && existingEvent.scheduledWorkId !== order.id) throw new Error('HQ Calendar id is already bound to different work.')
      if (!existingOrder) writeScheduledWork(options.workspaceRootPath, firstRoundMutation.work)
      if (!existingEvent) {
        changed = true
        writeArtistCalendar(options.workspaceRootPath, {
          ...artistCalendar,
          events: [...artistCalendar.events, {
            id: calendarItemId,
            date: local.date,
            time: local.time,
            title: order.title,
            notes: options.input.explanation.trim(),
            scheduledWorkId: order.id,
            workspaceLinks: [],
            relatedPersonIds: [],
            createdAt: now,
            updatedAt: now,
          }],
          updatedAt: now,
        })
      }
    } else {
      const parsedCalendar = parseCampaignCalendarDocResult(loadContextDoc(options.workspaceRootPath, CAMPAIGN_CALENDAR_CONTEXT_SLUG) ?? undefined, options.workspaceId)
      if (!parsedCalendar.ok) throw new Error(parsedCalendar.error)
      const existingItem = parsedCalendar.calendar.items.find((candidate) => candidate.id === calendarItemId)
      if (existingItem && existingItem.scheduledWorkId !== order.id) throw new Error('Campaign Calendar id is already bound to different work.')
      const calendarItem = createCampaignCalendarItem({
        id: calendarItemId,
        campaignId: options.workspaceId,
        date: local.date,
        time: local.time,
        timezone,
        title: order.title,
        notes: options.input.explanation.trim(),
        kind: 'scheduled-job',
        status: 'scheduled',
        source: 'agent',
        scheduledWorkId: order.id,
        releaseKitRefs: inputRefs.map(({ itemId, sha256, label }) => ({ itemId, sha256, label })),
      })
      if (!existingOrder) writeScheduledWork(options.workspaceRootPath, firstRoundMutation.work)
      if (!existingItem) {
        changed = true
        upsertContextDoc(options.workspaceRootPath, {
          slug: CAMPAIGN_CALENDAR_CONTEXT_SLUG,
          metadata: campaignCalendarMetadata(),
          body: serializeCampaignCalendarBody({ ...parsedCalendar.calendar, items: [...parsedCalendar.calendar.items, calendarItem], updatedAt: now }),
        })
      }
    }
    if (changed) options.onContextChanged(loadAllContextDocs(options.workspaceRootPath))
    return { id: order.id, title: order.title }
  })
  return inputRefs.length > 0
    ? withReleaseKitLockAsync(options.workspaceRootPath, persist)
    : persist()
}

async function persistAutomation(options: ScheduleWorkPersistenceOptions, execution: ScheduledWorkExecution): Promise<{ id: string; title: string; nextFireAt?: string }> {
  if (options.input.trigger?.type === 'schedule'
    && options.input.trigger.cadence
    && options.withAutomaticScheduleLock) {
    return options.withAutomaticScheduleLock(() => persistAutomationUnlocked(options, execution))
  }
  return persistAutomationUnlocked(options, execution)
}

async function persistAutomationUnlocked(options: ScheduleWorkPersistenceOptions, execution: ScheduledWorkExecution): Promise<{ id: string; title: string; nextFireAt?: string }> {
  const trigger = options.input.trigger!
  if (trigger.type === 'schedule') {
    const hasCron = Boolean(trigger.cron?.trim())
    const hasCadence = Boolean(trigger.cadence)
    if (hasCron === hasCadence) throw new Error('Scheduled automation requires exactly one of cron or cadence.')
  }
  const eventName = automationEventName(trigger)
  const matcherBase = automationMatcherBase(options, execution)
  const timezone = trigger.type === 'schedule' ? trigger.timezone ?? options.input.timezone : undefined
  const intentDigest = scheduledWorkDefinitionDigest({ eventName, matcherBase, trigger, timezone })

  const configPath = resolveAutomationsConfigPath(options.workspaceRootPath)
  return options.withAutomationLock(configPath, async () => {
    const config = await readAutomationConfig(configPath)
    for (const existingMatchers of Object.values(config.automations)) {
      if (!Array.isArray(existingMatchers)) throw new Error('Automation config contains a non-list event entry.')
      const existing = existingMatchers.find((candidate) => candidate.scheduleWorkKey === options.input.idempotencyKey)
      if (!existing) continue
      const expectedLegacyMatcher = legacyAutomationMatcher(matcherBase, trigger, timezone, options.input.idempotencyKey)
      const serializedExpectedLegacyMatcher = expectedLegacyMatcher
        ? JSON.parse(JSON.stringify(expectedLegacyMatcher)) as Record<string, unknown>
        : undefined
      const { id: _id, scheduleWorkDigest: persistedLegacyDigest, scheduleWorkIntentDigest: _intent, ...persistedLegacyMatcher } = existing
      const isMatchingLegacy = existing.scheduleWorkIntentDigest === undefined
        && serializedExpectedLegacyMatcher !== undefined
        && persistedLegacyDigest === scheduledWorkDefinitionDigest({ eventName, matcher: persistedLegacyMatcher })
        && scheduledWorkDefinitionDigest(legacyComparableMatcher(persistedLegacyMatcher)) === scheduledWorkDefinitionDigest(legacyComparableMatcher(serializedExpectedLegacyMatcher))
      if (existing.scheduleWorkIntentDigest !== intentDigest && !isMatchingLegacy) {
        throw new Error(`idempotencyKey is already bound to a different automation: ${options.input.idempotencyKey}`)
      }
      if (isMatchingLegacy) {
        existing.scheduleWorkIntentDigest = intentDigest
        existing.actions = matcherBase.actions
        const { id: _existingId, scheduleWorkDigest: _existingDigest, scheduleWorkIntentDigest: _existingIntent, ...healedMatcher } = existing
        existing.scheduleWorkDigest = scheduledWorkDefinitionDigest({ eventName, matcher: healedMatcher })
        const validation = validateAutomationsConfig(config)
        if (!validation.valid) throw new Error(`Automation validation failed: ${validation.errors.join('; ')}`)
        await options.writeFileAtomic(configPath, `${JSON.stringify(config, null, 2)}\n`)
      }
      const nextFireAt = eventName === 'SchedulerTick' && typeof existing.cron === 'string'
        ? nextCronRun(existing.cron, typeof existing.timezone === 'string' ? existing.timezone : undefined)
        : undefined
      return { id: String(existing.id), title: options.input.title.trim(), nextFireAt }
    }
    const matcher = { ...matcherBase }
    if (trigger.type === 'schedule') {
      const cron = trigger.cron ?? (await resolveAutomaticCron(options, trigger.cadence!, timezone))
      Object.assign(matcher, { cron, timezone })
    }
    matcher.scheduleWorkKey = options.input.idempotencyKey
    matcher.scheduleWorkIntentDigest = intentDigest
    matcher.scheduleWorkDigest = scheduledWorkDefinitionDigest({ eventName, matcher })
    config.automations[eventName] ??= []
    const id = generateShortId()
    config.automations[eventName]!.push({ ...matcher, id })
    const validation = validateAutomationsConfig(config)
    if (!validation.valid) throw new Error(`Automation validation failed: ${validation.errors.join('; ')}`)
    await options.writeFileAtomic(configPath, `${JSON.stringify(config, null, 2)}\n`)
    const nextFireAt = trigger.type === 'schedule' ? nextCronRun(String(matcher.cron), timezone) : undefined
    return { id, title: options.input.title.trim(), nextFireAt }
  })
}

function automationEventName(trigger: NonNullable<ScheduleWorkToolInput['trigger']>): string {
  return trigger.type === 'schedule' ? 'SchedulerTick'
    : trigger.type === 'file-change' ? 'FileWatch'
      : trigger.type === 'webhook' ? 'WebhookReceive'
        : trigger.type === 'url-change' ? 'PollUrl'
          : 'MessageReceive'
}

function automationMatcherBase(
  options: ScheduleWorkPersistenceOptions,
  execution: ScheduledWorkExecution,
): Record<string, unknown> {
  const matcher: Record<string, unknown> = {
    name: options.input.title.trim(),
    enabled: true,
    actions: [{
      type: 'queue-work',
      ownerScope: options.scope,
      calendarVisibility: options.input.showOnCalendar === false ? 'hidden' : 'visible',
      title: options.input.title.trim(),
      intentId: hqSemanticIntentId({ title: options.input.title.trim(), intent: JSON.stringify(execution) }),
      execution,
      ...(options.input.execution.type === 'workflow-run' && options.input.execution.inputBindings
        ? { inputBindings: options.input.execution.inputBindings }
        : {}),
      inputRefs: [],
    }],
  }
  const trigger = options.input.trigger!
  if (trigger.type === 'file-change') Object.assign(matcher, { watchPath: trigger.watchPath, watchGlob: trigger.watchGlob, watchChangeTypes: trigger.changeTypes })
  if (trigger.type === 'webhook') Object.assign(matcher, { slug: trigger.slug, secretEnv: trigger.secretEnv, allowUnauthenticated: trigger.allowUnauthenticated })
  if (trigger.type === 'url-change') Object.assign(matcher, { pollUrl: trigger.url, pollIntervalSec: trigger.intervalSeconds ?? 300 })
  if (trigger.type === 'message') Object.assign(matcher, { matcher: trigger.matcher })
  return matcher
}

async function readAutomationConfig(configPath: string): Promise<{
  version?: number
  automations: Record<string, Record<string, unknown>[]>
  [key: string]: unknown
}> {
  try {
    const config = JSON.parse(await readFile(configPath, 'utf-8')) as {
      version?: number
      automations?: Record<string, Record<string, unknown>[]>
      [key: string]: unknown
    }
    config.automations ??= {}
    return config as { version?: number; automations: Record<string, Record<string, unknown>[]>; [key: string]: unknown }
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { version: 2, automations: {} }
    }
    throw error
  }
}

async function findMatchingLegacyAutomation(
  options: ScheduleWorkPersistenceOptions,
): Promise<{ id: string; title: string; nextFireAt?: string } | undefined> {
  const trigger = options.input.trigger!
  if (trigger.type === 'schedule' && !trigger.cron) return undefined
  const execution = resolveLegacyExecution(options.workspaceRootPath, options.input)
  if (!execution) return undefined
  const eventName = automationEventName(trigger)
  const timezone = trigger.type === 'schedule' ? trigger.timezone ?? options.input.timezone : undefined
  const expected = legacyAutomationMatcher(
    automationMatcherBase(options, execution),
    trigger,
    timezone,
    options.input.idempotencyKey,
  )
  if (!expected) return undefined
  const serializedExpected = legacyComparableMatcher(expected)
  const configPath = resolveAutomationsConfigPath(options.workspaceRootPath)
  return options.withAutomationLock(configPath, async () => {
    const config = await readAutomationConfig(configPath)
    const existing = config.automations[eventName]?.find((candidate) => candidate.scheduleWorkKey === options.input.idempotencyKey)
    if (!existing || existing.scheduleWorkIntentDigest !== undefined) return undefined
    const { id: _id, scheduleWorkDigest, scheduleWorkIntentDigest: _intent, ...persistedMatcher } = existing
    if (scheduleWorkDigest !== scheduledWorkDefinitionDigest({ eventName, matcher: persistedMatcher })
      || scheduledWorkDefinitionDigest(legacyComparableMatcher(persistedMatcher)) !== scheduledWorkDefinitionDigest(serializedExpected)) {
      return undefined
    }
    const nextFireAt = eventName === 'SchedulerTick' && typeof existing.cron === 'string'
      ? nextCronRun(existing.cron, typeof existing.timezone === 'string' ? existing.timezone : undefined)
      : undefined
    return { id: String(existing.id), title: options.input.title.trim(), nextFireAt }
  })
}

function legacyComparableMatcher(value: Record<string, unknown>): Record<string, unknown> {
  const comparable = JSON.parse(JSON.stringify(value)) as Record<string, unknown>
  for (const action of Array.isArray(comparable.actions) ? comparable.actions : []) {
    if (action && typeof action === 'object') delete (action as Record<string, unknown>).intentId
  }
  return comparable
}

function resolveLegacyExecution(rootPath: string, request: ScheduleWorkToolInput): ScheduledWorkExecution | undefined {
  const input = request.execution
  if (input.type !== 'workflow-run' || input.inputBindings) return undefined
  if (!readActivatedWorkflows(rootPath).active.includes(input.workflowSlug)) return undefined
  const workflow = loadGlobalWorkflow(input.workflowSlug)
  if (!workflow) return undefined
  const supplied = input.triggerInputs ?? {}
  const triggerInputs: Record<string, unknown> = {}
  for (const definition of workflow.metadata.trigger.inputs ?? []) {
    const value = supplied[definition.name] ?? definition.default ?? legacyDefaultTriggerValue(definition.type)
    if (definition.required && (value === undefined || value === null || (typeof value === 'string' && !value.trim()))) return undefined
    triggerInputs[definition.name] = value
  }
  return {
    type: 'workflow-run',
    workflowSlug: workflow.slug,
    workflowDigest: scheduledWorkDefinitionDigest({ metadata: workflow.metadata, body: workflow.body }),
    triggerInputs,
  }
}

function legacyDefaultTriggerValue(type: 'string' | 'number' | 'boolean'): string | number | boolean {
  if (type === 'number') return 0
  if (type === 'boolean') return false
  return ''
}

function legacyAutomationMatcher(
  matcherBase: Record<string, unknown>,
  trigger: NonNullable<ScheduleWorkToolInput['trigger']>,
  timezone: string | undefined,
  idempotencyKey: string,
): Record<string, unknown> | undefined {
  const matcher = { ...matcherBase }
  if (trigger.type === 'schedule') {
    if (!trigger.cron) return undefined
    Object.assign(matcher, { cron: trigger.cron, timezone })
  }
  matcher.scheduleWorkKey = idempotencyKey
  return matcher
}

async function resolveAutomaticCron(
  options: ScheduleWorkPersistenceOptions,
  cadence: 'daily' | 'weekly',
  timezone?: string,
): Promise<string> {
  const roots = [...new Set(options.automationWorkspaceRootPaths ?? [options.workspaceRootPath])]
  const existing: ExistingAutomationSchedule[] = []
  for (const rootPath of roots) {
    const path = resolveAutomationsConfigPath(rootPath)
    let raw: unknown
    try {
      raw = JSON.parse(await readFile(path, 'utf-8'))
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw new Error(`Could not inspect automation schedules for ${rootPath}: ${error instanceof Error ? error.message : String(error)}`)
    }
    const parsed = validateAutomationsConfig(raw)
    if (!parsed.valid || !parsed.config) {
      throw new Error(`Could not inspect automation schedules for ${rootPath}: ${parsed.errors.join('; ')}`)
    }
    for (const matcher of parsed.config.automations.SchedulerTick ?? []) {
      existing.push({ cron: matcher.cron, timezone: matcher.timezone, enabled: matcher.enabled })
    }
  }
  return suggestAutomaticSchedule(existing, cadence, { timezone }).cron
}

function nextCronRun(cron: string, timezone?: string): string | undefined {
  return new Cron(cron, timezone ? { timezone } : {}).nextRun()?.toISOString()
}

function writeScheduledWork(rootPath: string, work: ReturnType<typeof parseScheduledWorkDocResult>['work']): void {
  upsertContextDoc(rootPath, { slug: SCHEDULED_WORK_CONTEXT_SLUG, metadata: scheduledWorkMetadata(), body: serializeScheduledWorkBody(work) })
}

function readArtistCalendar(rootPath: string): ArtistCalendar {
  const doc = loadContextDoc(rootPath, ARTIST_CALENDAR_CONTEXT_SLUG)
  const parsed = parseArtistCalendarDocResult(doc ?? undefined)
  if (!parsed.ok) throw new Error(parsed.error)
  return parsed.calendar
}

function writeArtistCalendar(rootPath: string, calendar: ArtistCalendar): void {
  upsertContextDoc(rootPath, {
    slug: ARTIST_CALENDAR_CONTEXT_SLUG,
    metadata: artistCalendarMetadata(),
    body: serializeArtistCalendarBody(calendar),
  })
}

function formatInTimezone(value: string, timezone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value))
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((candidate) => candidate.type === type)?.value ?? ''
  return { date: `${part('year')}-${part('month')}-${part('day')}`, time: `${part('hour')}:${part('minute')}` }
}
