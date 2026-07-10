import { createHash } from 'node:crypto'
import { loadGlobalAgent, readActivatedAgents } from '@craft-agent/shared/agent-definitions'
import {
  CAMPAIGN_CALENDAR_CONTEXT_SLUG,
  campaignCalendarMetadata,
  createCampaignCalendarItem,
  parseCampaignCalendarDocResult,
  serializeCampaignCalendarBody,
  type CampaignCalendarItem,
} from '@craft-agent/shared/campaign-calendar'
import type { PendingQueuedWork, QueueWorkAction } from '@craft-agent/shared/automations'
import {
  SCHEDULED_WORK_CONTEXT_SLUG,
  emptyScheduledWorkDocument,
  parseScheduledWorkDocResult,
  scheduledWorkDefinitionDigest,
  scheduledWorkMetadata,
  serializeScheduledWorkBody,
  type ScheduledWorkExecution,
  type ScheduledWorkInputRef,
  type ScheduledWorkOrder,
} from '@craft-agent/shared/scheduled-work'
import { loadGlobalWorkflow, readActivatedWorkflows } from '@craft-agent/shared/workflows'
import { loadAllContextDocs, loadContextDoc, upsertContextDoc } from '@craft-agent/shared/workspace-context'
import { withWorkspaceContextLock } from './workspace-context-lock'

export interface AutomationWorkQueueResult {
  orderIds: string[]
  calendarItemIds: string[]
}

export interface AutomationWorkQueueDeps {
  emitContextChanged?(workspaceId: string, docs: ReturnType<typeof loadAllContextDocs>): void
}

export async function queueAutomationWork(
  workspaceId: string,
  workspaceRootPath: string,
  pending: PendingQueuedWork,
  deps: AutomationWorkQueueDeps = {},
): Promise<AutomationWorkQueueResult> {
  validateAction(workspaceRootPath, pending.action)
  const built = buildTriggeredWork(workspaceId, pending)
  return withWorkspaceContextLock(workspaceRootPath, async () => {
    const parsedWork = parseScheduledWorkDocResult(
      loadContextDoc(workspaceRootPath, SCHEDULED_WORK_CONTEXT_SLUG) ?? undefined,
      workspaceId,
    )
    if (!parsedWork.ok) throw new Error(parsedWork.error)
    const currentWork = parsedWork.work ?? emptyScheduledWorkDocument(workspaceId)
    for (const order of built.orders) {
      const existing = currentWork.items.find((candidate) => candidate.id === order.id)
      if (existing && scheduledWorkDefinitionDigest(identity(existing)) !== scheduledWorkDefinitionDigest(identity(order))) {
        throw new Error(`Automation work id collision: ${order.id}`)
      }
    }
    const missingOrders = built.orders.filter((order) => !currentWork.items.some((candidate) => candidate.id === order.id))
    if (missingOrders.length > 0) {
      upsertContextDoc(workspaceRootPath, {
        slug: SCHEDULED_WORK_CONTEXT_SLUG,
        metadata: scheduledWorkMetadata(),
        body: serializeScheduledWorkBody({
          ...currentWork,
          items: [...currentWork.items, ...missingOrders],
          updatedAt: built.now,
        }),
      })
    }

    if (pending.action.ownerScope === 'campaign') {
      const parsedCalendar = parseCampaignCalendarDocResult(
        loadContextDoc(workspaceRootPath, CAMPAIGN_CALENDAR_CONTEXT_SLUG) ?? undefined,
        workspaceId,
      )
      if (!parsedCalendar.ok) throw new Error(parsedCalendar.error)
      const missingItems = built.campaignItems.filter((item) => !parsedCalendar.calendar.items.some((candidate) => candidate.id === item.id))
      if (missingItems.length > 0) {
        upsertContextDoc(workspaceRootPath, {
          slug: CAMPAIGN_CALENDAR_CONTEXT_SLUG,
          metadata: campaignCalendarMetadata(),
          body: serializeCampaignCalendarBody({
            ...parsedCalendar.calendar,
            items: [...parsedCalendar.calendar.items, ...missingItems],
            updatedAt: built.now,
          }),
        })
      }
    } else {
      const calendar = readArtistCalendar(workspaceRootPath)
      const missingEvents = built.hqEvents.filter((event) => !calendar.events.some((candidate) => candidate.id === event.id))
      if (missingEvents.length > 0) writeArtistCalendar(workspaceRootPath, {
        ...calendar,
        events: [...calendar.events, ...missingEvents],
        updatedAt: built.now,
      })
    }
    deps.emitContextChanged?.(workspaceId, loadAllContextDocs(workspaceRootPath))
    return {
      orderIds: built.orders.map((order) => order.id),
      calendarItemIds: built.orders.map((order) => order.calendarLink.itemId),
    }
  })
}

function buildTriggeredWork(workspaceId: string, pending: PendingQueuedWork) {
  const now = new Date(pending.eventTimestamp).toISOString()
  const timezone = pending.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  const key = createHash('sha256')
    .update(scheduledWorkDefinitionDigest({
      matcherId: pending.matcherId,
      event: pending.event,
      eventKey: pending.eventKey,
      action: pending.action,
    }))
    .digest('hex')
    .slice(0, 20)
  const chainId = `automation-work-${pending.matcherId}-${key}`
  const root = buildOrder(workspaceId, pending.action, chainId, 0, now, timezone)
  const orders = [root]
  if (pending.action.followUp) {
    const rootStepId = `${chainId}-step-0`
    root.chain = { chainId, stepId: rootStepId, ordinal: 0 }
    const childExecution = pending.action.followUp.execution
    const childInputRefs: ScheduledWorkInputRef[] = childExecution.type === 'social-publish'
      ? [...(pending.action.inputRefs ?? [])]
      : [{
          kind: 'produced-output',
          stepId: rootStepId,
          selector: pending.action.followUp.outputKind ? { kind: pending.action.followUp.outputKind } : undefined,
          bindTo: childExecution.type === 'review'
            ? { kind: 'review-target' }
            : { kind: 'workflow-trigger', input: pending.action.followUp.outputInput ?? firstWorkflowInput(childExecution) },
        }]
    const childBase = buildOrder(workspaceId, {
        ...pending.action,
        title: followUpTitle(pending.action.title, childExecution),
        execution: childExecution,
        inputRefs: childInputRefs.filter((ref): ref is Exclude<ScheduledWorkInputRef, { kind: 'produced-output' }> => ref.kind !== 'produced-output'),
        followUp: undefined,
      }, chainId, 1, now, timezone)
    orders.push({
      ...childBase,
      status: 'waiting',
      inputRefs: childInputRefs,
      executionKey: {
        ...childBase.executionKey,
        payloadDigest: scheduledWorkDefinitionDigest({ execution: childExecution, inputRefs: childInputRefs, chainId, ordinal: 1 }),
      },
      chain: {
        chainId,
        stepId: `${chainId}-step-1`,
        ordinal: 1,
        predecessor: {
          orderId: root.id,
          stepId: rootStepId,
          releaseOn: root.type === 'review' ? 'creative-approval' : 'success',
        },
      },
    })
  }
  const campaignItems = pending.action.ownerScope === 'campaign'
    ? orders.map((order) => campaignItem(workspaceId, order, order.status === 'waiting' ? 'draft' : 'scheduled'))
    : []
  const hqEvents = pending.action.ownerScope === 'hq' ? orders.map(hqEvent) : []
  return { now, orders, campaignItems, hqEvents }
}

function buildOrder(
  workspaceId: string,
  action: QueueWorkAction,
  chainId: string,
  ordinal: number,
  now: string,
  timezone: string,
): ScheduledWorkOrder {
  const id = `${chainId}-${ordinal}`
  const inputRefs = [...(action.inputRefs ?? [])]
  return {
    version: 1,
    id,
    owner: action.ownerScope === 'campaign'
      ? { scope: 'campaign', workspaceId, campaignId: workspaceId }
      : { scope: 'hq', workspaceId },
    calendarLink: { calendar: action.ownerScope, itemId: `${id}-calendar` },
    title: action.title,
    type: action.execution.type,
    status: 'scheduled',
    startAt: now,
    timezone,
    execution: action.execution,
    inputRefs,
    approvals: [],
    runs: [],
    executionKey: {
      payloadDigest: scheduledWorkDefinitionDigest({ execution: action.execution, inputRefs, chainId, ordinal }),
      idempotencyKey: `${chainId}:${ordinal}`,
    },
    createdAt: now,
    updatedAt: now,
  }
}

function validateAction(rootPath: string, action: QueueWorkAction): void {
  const executions = [action.execution, action.followUp?.execution].filter((value): value is ScheduledWorkExecution => Boolean(value))
  if (action.ownerScope === 'hq' && (action.followUp || executions.some((execution) => execution.type !== 'agent-task' && execution.type !== 'workflow-run'))) {
    throw new Error('HQ queue-work automations support standalone agent and workflow work only.')
  }
  if (action.followUp && !supportedTopology(action.execution, action.followUp.execution)) {
    throw new Error(`Unsupported queue-work chain: ${action.execution.type} -> ${action.followUp.execution.type}`)
  }
  for (const execution of executions) {
    if (execution.type === 'agent-task') {
      if (!readActivatedAgents(rootPath).active.includes(execution.agentSlug) || !loadGlobalAgent(execution.agentSlug)) {
        throw new Error(`Automation agent is not active: ${execution.agentSlug}`)
      }
    }
    if (execution.type === 'workflow-run') {
      if (!readActivatedWorkflows(rootPath).active.includes(execution.workflowSlug)) {
        throw new Error(`Automation workflow is not active: ${execution.workflowSlug}`)
      }
      const workflow = loadGlobalWorkflow(execution.workflowSlug)
      if (!workflow) throw new Error(`Automation workflow was not found: ${execution.workflowSlug}`)
      const digest = scheduledWorkDefinitionDigest({ metadata: workflow.metadata, body: workflow.body })
      if (digest !== execution.workflowDigest) throw new Error(`Automation workflow changed: ${execution.workflowSlug}`)
    }
  }
  if (action.execution.type === 'social-publish' && !hasExactPublishAsset(action.inputRefs ?? [])) {
    throw new Error('Social queue-work requires one exact Output or Final.')
  }
  if (action.followUp?.execution.type === 'social-publish' && !hasExactPublishAsset(action.inputRefs ?? [])) {
    throw new Error('Review-to-social queue-work requires one exact Output or Final.')
  }
  if (action.execution.type === 'review' && !hasReviewAsset(action.inputRefs ?? [])) {
    throw new Error('Review queue-work requires an Output or Final.')
  }
}

function supportedTopology(root: ScheduledWorkExecution, child: ScheduledWorkExecution): boolean {
  return (root.type === 'agent-task' && (child.type === 'review' || child.type === 'workflow-run'))
    || (root.type === 'workflow-run' && child.type === 'review')
    || (root.type === 'review' && child.type === 'social-publish')
}

function firstWorkflowInput(execution: ScheduledWorkExecution): string {
  if (execution.type !== 'workflow-run') throw new Error('Produced Output can bind only to workflow work.')
  const input = Object.keys(execution.triggerInputs)[0]
  if (!input) throw new Error('Follow-up workflow needs one trigger input for the produced Output.')
  return input
}

function hasExactPublishAsset(refs: ScheduledWorkInputRef[]): boolean {
  return refs.length === 1 && (refs[0]?.kind === 'final' || refs[0]?.kind === 'output')
}

function hasReviewAsset(refs: ScheduledWorkInputRef[]): boolean {
  return refs.length > 0 && refs.every((ref) => ref.kind === 'final' || ref.kind === 'output')
}

function followUpTitle(title: string, execution: ScheduledWorkExecution): string {
  if (execution.type === 'review') return `Review: ${title}`
  if (execution.type === 'social-publish') return `Publish: ${title}`
  return `Workflow: ${title}`
}

function campaignItem(campaignId: string, order: ScheduledWorkOrder, status: 'draft' | 'scheduled'): CampaignCalendarItem {
  const local = formatInTimezone(order.startAt, order.timezone)
  return createCampaignCalendarItem({
    id: order.calendarLink.itemId,
    campaignId,
    date: local.date,
    time: local.time,
    timezone: order.timezone,
    title: order.title,
    kind: 'scheduled-job',
    status,
    source: 'workflow',
    scheduledWorkId: order.id,
  })
}

type ArtistCalendarEvent = {
  id: string
  date: string
  title: string
  time?: string
  scheduledWorkId?: string
  workspaceLinks: unknown[]
  relatedPersonIds: string[]
  createdAt: string
  updatedAt: string
}
type ArtistCalendarDocument = { version: 1; events: ArtistCalendarEvent[]; updatedAt: string }
const ARTIST_CALENDAR_CONTEXT_SLUG = 'artist-calendar'

function hqEvent(order: ScheduledWorkOrder): ArtistCalendarEvent {
  const local = formatInTimezone(order.startAt, order.timezone)
  return {
    id: order.calendarLink.itemId,
    date: local.date,
    time: local.time,
    title: order.title,
    scheduledWorkId: order.id,
    workspaceLinks: [],
    relatedPersonIds: [],
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  }
}

function readArtistCalendar(rootPath: string): ArtistCalendarDocument {
  const doc = loadContextDoc(rootPath, ARTIST_CALENDAR_CONTEXT_SLUG)
  if (!doc) return { version: 1, events: [], updatedAt: new Date().toISOString() }
  const match = doc.body.match(/```json\s*([\s\S]*?)```/i)
  if (!match?.[1]) throw new Error('Artist Calendar JSON block is missing.')
  const parsed = JSON.parse(match[1]) as Partial<ArtistCalendarDocument>
  if (parsed.version !== 1 || !Array.isArray(parsed.events)) throw new Error('Artist Calendar JSON has an unsupported shape.')
  return { version: 1, events: parsed.events as ArtistCalendarEvent[], updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString() }
}

function writeArtistCalendar(rootPath: string, calendar: ArtistCalendarDocument): void {
  upsertContextDoc(rootPath, {
    slug: ARTIST_CALENDAR_CONTEXT_SLUG,
    metadata: { name: 'Artist Calendar', description: 'Global dates, deadlines, meetings, releases, reminders, and scheduled work.', routing: { mode: 'broadcast' }, enabled: true },
    body: ['This is global artist calendar context. Treat it as long-term creator context, not one-campaign context.', '', '```json', JSON.stringify(calendar, null, 2), '```'].join('\n'),
  })
}

function formatInTimezone(value: string, timezone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(value))
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` }
}

function identity(order: ScheduledWorkOrder) {
  return {
    id: order.id,
    owner: order.owner,
    calendarLink: order.calendarLink,
    title: order.title,
    execution: order.execution,
    inputRefs: order.inputRefs,
    executionKey: order.executionKey,
    chain: order.chain,
  }
}
