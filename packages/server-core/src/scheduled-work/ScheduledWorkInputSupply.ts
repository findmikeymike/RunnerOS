import {
  ARTIST_CALENDAR_CONTEXT_SLUG,
  artistCalendarMetadata,
  parseArtistCalendarDocResult,
  serializeArtistCalendarBody,
  type ArtistCalendar,
} from '@craft-agent/shared/artist-context'
import {
  CAMPAIGN_CALENDAR_CONTEXT_SLUG,
  campaignCalendarMetadata,
  parseCampaignCalendarDocResult,
  serializeCampaignCalendarBody,
  type CampaignCalendar,
} from '@craft-agent/shared/campaign-calendar'
import {
  SCHEDULED_WORK_CONTEXT_SLUG,
  assertScheduledWorkDocument,
  parseScheduledWorkDocResult,
  scheduledWorkDefinitionDigest,
  scheduledWorkMetadata,
  serializeScheduledWorkBody,
  type ScheduledWorkDocument,
  type SupplyScheduledWorkInput,
  type SupplyScheduledWorkInputResult,
} from '@craft-agent/shared/scheduled-work'
import { loadGlobalWorkflow, normalizeWorkflowTriggerInputs, readActivatedWorkflows } from '@craft-agent/shared/workflows'
import { loadAllContextDocs, loadContextDoc, upsertContextDoc } from '@craft-agent/shared/workspace-context'
import { withWorkspaceContextLock } from './workspace-context-lock'
import {
  assertArtistAnswerSupportsValues,
  assertArtistManagerCanSupplyRequestedInputs,
} from './ScheduledWorkInputAnswerEvidence'
import { assertAutomationWorkRequestIsCurrent } from './AutomationWorkQueue'

export interface ScheduledWorkInputSupplyDeps {
  now?(): Date
  emitContextChanged?(workspaceId: string, docs: ReturnType<typeof loadAllContextDocs>): void
  log?: Pick<Console, 'info'>
}

export async function supplyScheduledWorkInputs(
  workspaceId: string,
  workspaceRootPath: string,
  input: SupplyScheduledWorkInput,
  deps: ScheduledWorkInputSupplyDeps = {},
): Promise<SupplyScheduledWorkInputResult> {
  assertSupplyInput(input)
  return withWorkspaceContextLock(workspaceRootPath, async () => {
    const parsed = parseScheduledWorkDocResult(
      loadContextDoc(workspaceRootPath, SCHEDULED_WORK_CONTEXT_SLUG) ?? undefined,
      workspaceId,
    )
    if (!parsed.ok) throw new Error(parsed.error)
    const order = parsed.work.items.find((candidate) => candidate.id === input.orderId && !candidate.deletedAt)
    if (!order) throw new Error(`Scheduled work order was not found: ${input.orderId}`)

    if (order.inputSupplyReceipt?.requestId === input.requestId) {
      return { updated: false, work: parsed.work, order }
    }
    if (order.status !== 'needs-setup' || order.execution.type !== 'workflow-run' || !order.inputRequest) {
      throw new Error('This work is not waiting for workflow inputs.')
    }
    if (order.inputRequest.id !== input.requestId) throw new Error('This input request no longer matches the work order.')
    if (input.expectedUpdatedAt && order.updatedAt !== input.expectedUpdatedAt) {
      throw new Error(`Scheduled work order changed before inputs were supplied: ${order.id}`)
    }
    assertAutomationWorkRequestIsCurrent(workspaceRootPath, order.automationRef)
    if (input.source === 'tool') {
      const sourceMessageAt = Date.parse(input.sourceMessageAt!)
      if (sourceMessageAt < Date.parse(order.inputRequest.requestedAt)) {
        throw new Error('Artist Manager needs a new artist answer after this input request was created.')
      }
      if (order.inputRequest.sessionId && order.inputRequest.sessionId !== input.sourceSessionId) {
        throw new Error('This input request is linked to a different Artist Manager session.')
      }
      if (order.inputRequest.messageId && order.inputRequest.messageId !== input.sourceMessageId) {
        throw new Error('This input request is linked to a different artist message.')
      }
      const alreadyUsed = parsed.work.items.some((candidate) => (
        candidate.id !== order.id
        && candidate.inputSupplyReceipt?.sourceMessageId === input.sourceMessageId
      ))
      if (alreadyUsed) {
        throw new Error('This artist message already supplied a different work request. Ask again for this request.')
      }
    }

    const suppliedKeys = Object.keys(input.values).sort()
    const requestedKeys = [...order.inputRequest.inputs].sort()
    if (suppliedKeys.length !== requestedKeys.length || suppliedKeys.some((key, index) => key !== requestedKeys[index])) {
      throw new Error(`Supply every requested workflow input exactly once: ${requestedKeys.join(', ')}`)
    }

    const workflow = loadGlobalWorkflow(order.execution.workflowSlug)
    if (!workflow) throw new Error(`Automation workflow was not found: ${order.execution.workflowSlug}`)
    if (!readActivatedWorkflows(workspaceRootPath).active.includes(order.execution.workflowSlug)) {
      throw new Error(`Automation workflow is not active: ${order.execution.workflowSlug}`)
    }
    const currentDigest = scheduledWorkDefinitionDigest({ metadata: workflow.metadata, body: workflow.body })
    if (currentDigest !== order.execution.workflowDigest) {
      throw new Error(`Automation workflow changed: ${order.execution.workflowSlug}`)
    }
    if (input.source === 'tool') {
      assertArtistManagerCanSupplyRequestedInputs(
        workflow.metadata.trigger.inputs ?? [],
        order.inputRequest.inputs,
      )
      assertArtistAnswerSupportsValues(
        input.sourceEvidenceText!,
        input.sourceAttachments ?? [],
        input.values,
      )
    }

    const triggerInputs = normalizeWorkflowTriggerInputs(workflow, {
      ...order.execution.triggerInputs,
      ...input.values,
    })
    const now = (deps.now?.() ?? new Date()).toISOString()
    const execution = { ...order.execution, triggerInputs }
    const nextOrder = {
      ...order,
      status: 'scheduled' as const,
      startAt: now,
      execution,
      attention: undefined,
      inputRequest: undefined,
      inputSupplyReceipt: {
        requestId: input.requestId,
        source: input.source,
        suppliedKeys,
        fireDefinitionDigests: [...order.inputRequest.fireDefinitionDigests],
        suppliedAt: now,
        ...(input.sourceSessionId ? { sourceSessionId: input.sourceSessionId } : {}),
        ...(input.sourceMessageId ? { sourceMessageId: input.sourceMessageId } : {}),
        ...(input.sourceMessageAt ? { sourceMessageAt: input.sourceMessageAt } : {}),
      },
      executionKey: {
        ...order.executionKey,
        payloadDigest: scheduledWorkDefinitionDigest({
          execution,
          inputRefs: order.inputRefs,
          idempotencyKey: order.executionKey.idempotencyKey,
        }),
      },
      updatedAt: now,
    }
    const work: ScheduledWorkDocument = {
      ...parsed.work,
      items: parsed.work.items.map((candidate) => candidate.id === nextOrder.id ? nextOrder : candidate),
      updatedAt: now,
    }

    const projection = updateCalendarProjection(workspaceRootPath, workspaceId, nextOrder, now)
    projection?.write()
    // Calendar is only a projection. Write it first so a partial failure leaves
    // the execution source in needs-setup instead of admitting invisible work.
    writeScheduledWork(workspaceRootPath, work)
    deps.log?.info('[ScheduledWork] workflow inputs supplied', {
      orderId: nextOrder.id,
      source: input.source,
      suppliedKeys,
      ...(input.source === 'tool' ? {
        sourceSessionId: input.sourceSessionId,
        sourceMessageId: input.sourceMessageId,
      } : {}),
    })
    deps.emitContextChanged?.(workspaceId, loadAllContextDocs(workspaceRootPath))
    return { updated: true, work, order: nextOrder }
  })
}

function updateCalendarProjection(
  rootPath: string,
  workspaceId: string,
  order: ScheduledWorkDocument['items'][number],
  now: string,
): { write(): void } | null {
  if (order.calendarVisibility === 'hidden') return null
  const local = formatInTimezone(order.startAt, order.timezone)
  if (order.owner.scope === 'campaign') {
    const parsed = parseCampaignCalendarDocResult(
      loadContextDoc(rootPath, CAMPAIGN_CALENDAR_CONTEXT_SLUG) ?? undefined,
      workspaceId,
    )
    if (!parsed.ok) throw new Error(parsed.error)
    const item = parsed.calendar.items.find((candidate) => (
      candidate.id === order.calendarLink.itemId
      && candidate.scheduledWorkId === order.id
      && !candidate.deletedAt
    ))
    if (!item) throw new Error('Linked campaign calendar item was not found.')
    if (item.date === local.date
      && item.time === local.time
      && item.timezone === order.timezone
      && item.status === 'scheduled') return null
    const nextItem = { ...item, date: local.date, time: local.time, timezone: order.timezone, status: 'scheduled' as const, updatedAt: now }
    const calendar: CampaignCalendar = {
      ...parsed.calendar,
      items: parsed.calendar.items.map((candidate) => candidate.id === nextItem.id ? nextItem : candidate),
      updatedAt: now,
    }
    return { write: () => writeCampaignCalendar(rootPath, calendar) }
  }

  const calendar = readArtistCalendar(rootPath)
  const event = calendar.events.find((candidate) => candidate.id === order.calendarLink.itemId && candidate.scheduledWorkId === order.id)
  if (!event) throw new Error('Linked Artist Calendar event was not found.')
  if (event.date === local.date && event.time === local.time) return null
  const nextCalendar: ArtistCalendar = {
    ...calendar,
    events: calendar.events.map((candidate) => candidate.id === event.id
      ? { ...candidate, date: local.date, time: local.time, updatedAt: now }
      : candidate),
    updatedAt: now,
  }
  return { write: () => writeArtistCalendar(rootPath, nextCalendar) }
}

function writeScheduledWork(rootPath: string, work: ScheduledWorkDocument): void {
  assertScheduledWorkDocument(work)
  upsertContextDoc(rootPath, {
    slug: SCHEDULED_WORK_CONTEXT_SLUG,
    metadata: scheduledWorkMetadata(),
    body: serializeScheduledWorkBody(work),
  })
}

function readArtistCalendar(rootPath: string): ArtistCalendar {
  const parsed = parseArtistCalendarDocResult(loadContextDoc(rootPath, ARTIST_CALENDAR_CONTEXT_SLUG) ?? undefined)
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

function writeCampaignCalendar(rootPath: string, calendar: CampaignCalendar): void {
  upsertContextDoc(rootPath, {
    slug: CAMPAIGN_CALENDAR_CONTEXT_SLUG,
    metadata: campaignCalendarMetadata(),
    body: serializeCampaignCalendarBody(calendar),
  })
}

function formatInTimezone(value: string, timezone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(value))
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` }
}

function assertSupplyInput(value: unknown): asserts value is SupplyScheduledWorkInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid scheduled-work input supply request.')
  const input = value as Partial<SupplyScheduledWorkInput>
  if (typeof input.orderId !== 'string' || !input.orderId.trim()
    || typeof input.requestId !== 'string' || !input.requestId.trim()
    || (input.expectedUpdatedAt !== undefined && (typeof input.expectedUpdatedAt !== 'string' || Number.isNaN(Date.parse(input.expectedUpdatedAt))))
    || (input.source !== 'list' && input.source !== 'tool')
    || (input.source === 'tool' && (
      typeof input.sourceSessionId !== 'string' || !input.sourceSessionId.trim()
      || typeof input.sourceMessageId !== 'string' || !input.sourceMessageId.trim()
      || typeof input.sourceMessageAt !== 'string' || Number.isNaN(Date.parse(input.sourceMessageAt))
      || typeof input.sourceEvidenceText !== 'string' || !input.sourceEvidenceText.trim()
      || (input.sourceAttachments !== undefined && (!Array.isArray(input.sourceAttachments)
        || input.sourceAttachments.some((attachment) => !attachment
          || typeof attachment.name !== 'string'
          || typeof attachment.storedPath !== 'string')))
    ))
    || !input.values || typeof input.values !== 'object' || Array.isArray(input.values)) {
    throw new Error('Invalid scheduled-work input supply request.')
  }
}
