import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { Cron } from 'croner'
import type { ScheduleWorkToolInput } from '@craft-agent/session-tools-core'
import { loadGlobalAgent, readActivatedAgents } from '@craft-agent/shared/agent-definitions'
import { loadGlobalWorkflow, readActivatedWorkflows } from '@craft-agent/shared/workflows'
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
import { validateAutomationsConfig } from '@craft-agent/shared/automations'
import { generateShortId, resolveAutomationsConfigPath } from '@craft-agent/shared/automations/resolve-config-path'
import { loadAllContextDocs, loadContextDoc, upsertContextDoc, type LoadedContextDoc } from '@craft-agent/shared/workspace-context'
import { withWorkspaceContextLock } from './workspace-context-lock'

type WorkspaceScope = 'hq' | 'campaign'

export interface ScheduleWorkPersistenceOptions {
  workspaceId: string
  workspaceRootPath: string
  scope: WorkspaceScope
  input: ScheduleWorkToolInput
  onContextChanged: (docs: LoadedContextDoc[]) => void
  withAutomationLock: <T>(path: string, fn: () => Promise<T>) => Promise<T>
  writeFileAtomic: (path: string, data: string) => Promise<void>
}

export async function persistHnicScheduleWork(options: ScheduleWorkPersistenceOptions): Promise<{
  id: string
  title: string
  nextFireAt?: string
}> {
  const execution = resolveExecution(options.workspaceRootPath, options.input.execution)
  if (options.input.destination === 'automation') {
    return persistAutomation(options, execution)
  }
  return persistCalendarWork(options, execution)
}

export function inferScheduledWorkScope(workspace: { artistWorkspaceScope?: WorkspaceScope }): WorkspaceScope {
  if (!workspace.artistWorkspaceScope) {
    throw new Error('Workspace is missing its persisted artist calendar scope. Restart RunnerOS to migrate workspace metadata.')
  }
  return workspace.artistWorkspaceScope
}

function resolveExecution(rootPath: string, input: ScheduleWorkToolInput['execution']): ScheduledWorkExecution {
  if (input.type === 'agent-task') {
    if (!readActivatedAgents(rootPath).active.includes(input.agentSlug)) {
      throw new Error(`Agent is not active in this workspace: ${input.agentSlug}`)
    }
    if (!loadGlobalAgent(input.agentSlug)) throw new Error(`Agent definition was not found: ${input.agentSlug}`)
    return {
      type: 'agent-task',
      agentSlug: input.agentSlug,
      brief: input.brief.trim(),
      permissionMode: input.permissionMode ?? 'ask',
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
  const triggerInputs = Object.fromEntries((workflow.metadata.trigger.inputs ?? []).map((definition) => {
    const value = supplied[definition.name] ?? definition.default ?? defaultTriggerValue(definition.type)
    if (definition.required && (value === undefined || value === null || (typeof value === 'string' && !value.trim()))) {
      throw new Error(`Workflow input is required: ${definition.name}`)
    }
    return [definition.name, value]
  }))
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
  const payloadDigest = scheduledWorkDefinitionDigest({ execution, inputRefs: [], startAt })
  const order: ScheduledWorkOrder = {
    version: 1,
    id: orderId,
    owner: options.scope === 'hq'
      ? { scope: 'hq', workspaceId: options.workspaceId }
      : { scope: 'campaign', workspaceId: options.workspaceId, campaignId: options.workspaceId },
    calendarLink: { calendar: options.scope, itemId: calendarItemId },
    title: options.input.title.trim(),
    intentId: options.input.idempotencyKey,
    type: execution.type,
    status: 'scheduled',
    startAt,
    timezone,
    execution,
    inputRefs: [],
    approvals: [],
    runs: [],
    executionKey: { payloadDigest, idempotencyKey: `${orderId}:${startAt}:${payloadDigest}` },
    createdAt: now,
    updatedAt: now,
  }

  return withWorkspaceContextLock(options.workspaceRootPath, async () => {
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
    let changed = !existingOrder

    if (options.scope === 'hq') {
      const artistCalendar = readArtistCalendar(options.workspaceRootPath)
      const existingEvent = artistCalendar.events.find((candidate) => candidate.id === calendarItemId)
      if (existingEvent && existingEvent.scheduledWorkId !== order.id) throw new Error('HQ Calendar id is already bound to different work.')
      if (!existingOrder) writeScheduledWork(options.workspaceRootPath, mutation.work)
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
      })
      if (!existingOrder) writeScheduledWork(options.workspaceRootPath, mutation.work)
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
}

async function persistAutomation(options: ScheduleWorkPersistenceOptions, execution: ScheduledWorkExecution): Promise<{ id: string; title: string; nextFireAt?: string }> {
  const trigger = options.input.trigger!
  const eventName = trigger.type === 'schedule' ? 'SchedulerTick'
    : trigger.type === 'file-change' ? 'FileWatch'
      : trigger.type === 'webhook' ? 'WebhookReceive'
        : trigger.type === 'url-change' ? 'PollUrl'
          : 'MessageReceive'
  const matcher: Record<string, unknown> = {
    name: options.input.title.trim(),
    enabled: true,
    actions: [{
      type: 'queue-work',
      ownerScope: options.scope,
      calendarVisibility: options.input.showOnCalendar === false ? 'hidden' : 'visible',
      title: options.input.title.trim(),
      execution,
      inputRefs: [],
    }],
  }
  if (trigger.type === 'schedule') Object.assign(matcher, { cron: trigger.cron, timezone: trigger.timezone ?? options.input.timezone })
  if (trigger.type === 'file-change') Object.assign(matcher, { watchPath: trigger.watchPath, watchGlob: trigger.watchGlob, watchChangeTypes: trigger.changeTypes })
  if (trigger.type === 'webhook') Object.assign(matcher, { slug: trigger.slug, secretEnv: trigger.secretEnv, allowUnauthenticated: trigger.allowUnauthenticated })
  if (trigger.type === 'url-change') Object.assign(matcher, { pollUrl: trigger.url, pollIntervalSec: trigger.intervalSeconds ?? 300 })
  if (trigger.type === 'message') Object.assign(matcher, { matcher: trigger.matcher })
  matcher.scheduleWorkKey = options.input.idempotencyKey
  const definitionDigest = scheduledWorkDefinitionDigest({ eventName, matcher })
  matcher.scheduleWorkDigest = definitionDigest
  const nextFireAt = trigger.type === 'schedule'
    ? new Cron(trigger.cron, trigger.timezone || options.input.timezone ? { timezone: trigger.timezone ?? options.input.timezone } : {}).nextRun()?.toISOString()
    : undefined

  const configPath = resolveAutomationsConfigPath(options.workspaceRootPath)
  return options.withAutomationLock(configPath, async () => {
    let config: { version?: number; automations?: Record<string, Record<string, unknown>[]>; [key: string]: unknown }
    try {
      config = JSON.parse(await readFile(configPath, 'utf-8'))
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') config = { version: 2, automations: {} }
      else throw error
    }
    config.automations ??= {}
    for (const existingMatchers of Object.values(config.automations)) {
      if (!Array.isArray(existingMatchers)) throw new Error('Automation config contains a non-list event entry.')
      const existing = existingMatchers.find((candidate) => candidate.scheduleWorkKey === options.input.idempotencyKey)
      if (!existing) continue
      if (existing.scheduleWorkDigest !== definitionDigest) {
        throw new Error(`idempotencyKey is already bound to a different automation: ${options.input.idempotencyKey}`)
      }
      return { id: String(existing.id), title: options.input.title.trim(), nextFireAt }
    }
    config.automations[eventName] ??= []
    const id = generateShortId()
    config.automations[eventName]!.push({ ...matcher, id })
    const validation = validateAutomationsConfig(config)
    if (!validation.valid) throw new Error(`Automation validation failed: ${validation.errors.join('; ')}`)
    await options.writeFileAtomic(configPath, `${JSON.stringify(config, null, 2)}\n`)
    return { id, title: options.input.title.trim(), nextFireAt }
  })
}

function writeScheduledWork(rootPath: string, work: ReturnType<typeof parseScheduledWorkDocResult>['work']): void {
  upsertContextDoc(rootPath, { slug: SCHEDULED_WORK_CONTEXT_SLUG, metadata: scheduledWorkMetadata(), body: serializeScheduledWorkBody(work) })
}

type ArtistCalendarDocument = {
  version: 1
  events: Array<{ id: string; date: string; time?: string; title: string; notes?: string; scheduledWorkId?: string; workspaceLinks: unknown[]; relatedPersonIds: string[]; createdAt: string; updatedAt: string }>
  updatedAt: string
}

function readArtistCalendar(rootPath: string): ArtistCalendarDocument {
  const doc = loadContextDoc(rootPath, 'artist-calendar')
  if (!doc) return { version: 1, events: [], updatedAt: new Date().toISOString() }
  const match = doc.body.match(/```json\s*([\s\S]*?)```/i)
  if (!match?.[1]) throw new Error('Artist Calendar JSON block is missing.')
  const parsed = JSON.parse(match[1]) as ArtistCalendarDocument
  if (parsed.version !== 1 || !Array.isArray(parsed.events)) throw new Error('Artist Calendar JSON has an unsupported shape.')
  return parsed
}

function writeArtistCalendar(rootPath: string, calendar: ArtistCalendarDocument): void {
  upsertContextDoc(rootPath, {
    slug: 'artist-calendar',
    metadata: { name: 'Artist Calendar', description: 'Global dates, deadlines, meetings, releases, reminders, and scheduled work.', routing: { mode: 'broadcast' }, enabled: true },
    body: ['This is global artist calendar context. Treat it as long-term creator context, not one-campaign context.', '', '```json', JSON.stringify(calendar, null, 2), '```'].join('\n'),
  })
}

function formatInTimezone(value: string, timezone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value))
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((candidate) => candidate.type === type)?.value ?? ''
  return { date: `${part('year')}-${part('month')}-${part('day')}`, time: `${part('hour')}:${part('minute')}` }
}

function defaultTriggerValue(type: 'string' | 'number' | 'boolean'): string | number | boolean {
  if (type === 'number') return 0
  if (type === 'boolean') return false
  return ''
}
