import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { loadGlobalAgent, readActivatedAgents } from '@craft-agent/shared/agent-definitions'
import {
  ARTIST_CALENDAR_CONTEXT_SLUG,
  artistCalendarMetadata,
  parseArtistCalendarDocResult,
  serializeArtistCalendarBody,
  type ArtistCalendar,
  type ArtistCalendarEvent,
} from '@craft-agent/shared/artist-context'
import {
  CAMPAIGN_CALENDAR_CONTEXT_SLUG,
  campaignCalendarMetadata,
  createCampaignCalendarItem,
  parseCampaignCalendarDocResult,
  serializeCampaignCalendarBody,
  type CampaignCalendarItem,
} from '@craft-agent/shared/campaign-calendar'
import { assertWorkflowInputBindings, validateAutomationsConfig, type PendingQueuedWork, type QueueWorkAction, type WorkflowInputTriggerSource } from '@craft-agent/shared/automations'
import { resolveAutomationsConfigPath } from '@craft-agent/shared/automations/resolve-config-path'
import {
  SCHEDULED_WORK_CONTEXT_SLUG,
  assertScheduledWorkDocument,
  emptyScheduledWorkDocument,
  parseScheduledWorkDocResult,
  scheduledWorkDefinitionDigest,
  scheduledWorkMetadata,
  serializeScheduledWorkBody,
  type ScheduledWorkDocument,
  type ScheduledWorkExecution,
  type ScheduledWorkInputRef,
  type ScheduledWorkOrder,
} from '@craft-agent/shared/scheduled-work'
import { loadGlobalWorkflow, normalizeWorkflowTriggerInputs, readActivatedWorkflows } from '@craft-agent/shared/workflows'
import { hqNormalizeSemanticIntentId, hqSemanticIntentId } from '@craft-agent/shared/hq-state'
import { loadAllContextDocs, loadContextDoc, upsertContextDoc } from '@craft-agent/shared/workspace-context'
import { withWorkspaceContextLock } from './workspace-context-lock'

export interface AutomationWorkQueueResult {
  orderIds: string[]
  calendarItemIds: string[]
}

export interface AutomationWorkQueueDeps {
  emitContextChanged?(workspaceId: string, docs: ReturnType<typeof loadAllContextDocs>): void
  log?: Pick<Console, 'info'>
}

export async function cancelPendingAutomationWorkForMatcher(
  workspaceId: string,
  workspaceRootPath: string,
  matcherId: string,
  deps: AutomationWorkQueueDeps = {},
): Promise<string[]> {
  return withWorkspaceContextLock(workspaceRootPath, async () => cancelPendingAutomationWorkForMatcherLocked(
    workspaceId,
    workspaceRootPath,
    matcherId,
    deps,
  ))
}

export function cancelPendingAutomationWorkForMatcherLocked(
  workspaceId: string,
  workspaceRootPath: string,
  matcherId: string,
  deps: AutomationWorkQueueDeps = {},
): string[] {
    const parsed = parseScheduledWorkDocResult(
      loadContextDoc(workspaceRootPath, SCHEDULED_WORK_CONTEXT_SLUG) ?? undefined,
      workspaceId,
    )
    if (!parsed.ok) throw new Error(parsed.error)
    const roots = parsed.work.items.filter((order) => (
      !order.deletedAt
      && order.automationRef?.matcherId === matcherId
      && (order.status === 'needs-setup'
        || order.status === 'scheduled'
        || order.status === 'waiting'
        || order.status === 'needs-approval'
        || order.status === 'awaiting-review')
    ))
    const orderIds = new Set(roots.flatMap((root) => {
      const chainId = root.chain?.chainId
      return chainId
        ? parsed.work.items.filter((order) => (
            order.chain?.chainId === chainId
            && !order.deletedAt
            && order.status !== 'done'
            && order.status !== 'running'
            && order.status !== 'canceled'
          )).map((order) => order.id)
        : [root.id]
    }))
    if (orderIds.size === 0) return []
    const canceled = parsed.work.items.filter((order) => orderIds.has(order.id))
    preflightCalendarProjections(workspaceRootPath, workspaceId, canceled)
    const now = new Date().toISOString()
    const work: ScheduledWorkDocument = {
      ...parsed.work,
      items: parsed.work.items.map((order) => orderIds.has(order.id)
        ? { ...order, status: 'canceled' as const, attention: undefined, inputRequest: undefined, updatedAt: now }
        : order),
      updatedAt: now,
    }
    assertScheduledWorkDocument(work)
    upsertContextDoc(workspaceRootPath, {
      slug: SCHEDULED_WORK_CONTEXT_SLUG,
      metadata: scheduledWorkMetadata(),
      body: serializeScheduledWorkBody(work),
    })
    reconcileCanceledCalendarProjections(workspaceRootPath, workspaceId, canceled, now)
    deps.emitContextChanged?.(workspaceId, loadAllContextDocs(workspaceRootPath))
    return [...orderIds]
}

export function assertAutomationWorkRequestIsCurrent(
  workspaceRootPath: string,
  automationRef: ScheduledWorkOrder['automationRef'],
): void {
  if (!automationRef) return
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(resolveAutomationsConfigPath(workspaceRootPath), 'utf-8'))
  } catch {
    throw new Error('This automation no longer exists. Refresh Active work before supplying inputs.')
  }
  const parsed = validateAutomationsConfig(raw)
  if (!parsed.valid || !parsed.config) {
    throw new Error(`This automation configuration is invalid. Fix it before supplying inputs: ${parsed.errors.join('; ')}`)
  }
  const matcher = (Object.entries(parsed.config.automations)
    .find(([event]) => event === automationRef.event)?.[1] ?? [])
    .find((candidate) => candidate.id === automationRef.matcherId)
  if (!matcher || matcher.enabled === false) {
    throw new Error('This automation is disabled or no longer exists. Refresh Active work before supplying inputs.')
  }
  const actionIndex = automationRef.actionIndex ?? 0
  const configuredAction = matcher.actions.filter((action): action is QueueWorkAction => action.type === 'queue-work')[actionIndex]
  const stillCurrent = Boolean(configuredAction
    && scheduledWorkDefinitionDigest({
      matcherId: automationRef.matcherId,
      actionIndex,
      event: automationRef.event,
      action: configuredAction,
    }) === automationRef.configurationDigest)
  if (!stillCurrent) {
    throw new Error('This automation changed after requesting inputs. Wait for its next run before supplying values.')
  }
}

const WEEKLY_SIGNAL_INTENT_ID = 'artist-hq-weekly-signal-scan'
const ARTIST_INTEL_CONFIG_SLUG = 'artist-intel-config'

export async function queueAutomationWork(
  workspaceId: string,
  workspaceRootPath: string,
  pending: PendingQueuedWork,
  deps: AutomationWorkQueueDeps = {},
): Promise<AutomationWorkQueueResult> {
  return withWorkspaceContextLock(workspaceRootPath, async () => {
    if (!runtimeConfigAllowsAction(workspaceRootPath, pending)) {
      return { orderIds: [], calendarItemIds: [] }
    }
    validateAction(workspaceRootPath, pending.action)
    const resolved = resolveWorkflowInputBindings(workspaceRootPath, pending)
    const built = buildTriggeredWork(
      workspaceId,
      { ...pending, action: resolved.action },
      resolved.missingInputs,
      pending.configuredAction ?? pending.action,
    )
    if (resolved.missingInputs.length > 0 && built.orders[0]?.automationRef) {
      deps.log?.info('[ScheduledWork] automation fire needs input', {
        automation: built.orders[0].automationRef.matcherId,
        orderId: built.orders[0].id,
        unresolvedInputs: resolved.missingInputs,
        fireDefinitionDigest: built.orders[0].automationRef.definitionDigest,
      })
    }
    const parsedWork = parseScheduledWorkDocResult(
      loadContextDoc(workspaceRootPath, SCHEDULED_WORK_CONTEXT_SLUG) ?? undefined,
      workspaceId,
    )
    if (!parsedWork.ok) throw new Error(parsedWork.error)
    let currentWork = parsedWork.work ?? emptyScheduledWorkDocument(workspaceId)
    const repairedCanceledProjections = reconcileCanceledCalendarProjections(
      workspaceRootPath,
      workspaceId,
      currentWork.items.filter((order) => order.status === 'canceled'),
      built.now,
    )
    if (repairedCanceledProjections) {
      deps.emitContextChanged?.(workspaceId, loadAllContextDocs(workspaceRootPath))
    }
    if (isWeeklySignalAction(pending.action)) {
      const activeSignalOrder = currentWork.items.find((order) => (
        !order.deletedAt
        && hqNormalizeSemanticIntentId(order.intentId) === WEEKLY_SIGNAL_INTENT_ID
        && (order.status === 'scheduled' || order.status === 'running')
      ))
      if (activeSignalOrder) {
        return { orderIds: [activeSignalOrder.id], calendarItemIds: [] }
      }
    }
    const incomingRoot = built.orders[0]
    const incomingAutomationRef = incomingRoot?.automationRef
    const exactRoot = currentWork.items.find((candidate) => candidate.id === incomingRoot?.id)
    if (exactRoot) {
      if (!incomingRoot || !sameAutomationIdentity(exactRoot, incomingRoot)) {
        throw new Error(`Automation work id collision: ${incomingRoot?.id ?? 'missing'}`)
      }
      if (reconcileActiveCalendarProjections(workspaceRootPath, workspaceId, currentWork, exactRoot, built.now)) {
        deps.emitContextChanged?.(workspaceId, loadAllContextDocs(workspaceRootPath))
      }
      return representedWorkResult(currentWork, exactRoot)
    }
    const previouslyRepresented = incomingAutomationRef && currentWork.items.find((candidate) => (
      !candidate.deletedAt
      && candidate.automationRef?.matcherId === incomingAutomationRef.matcherId
      && candidate.automationRef?.configurationDigest === incomingAutomationRef.configurationDigest
      && candidate.inputSupplyReceipt?.fireDefinitionDigests.includes(incomingAutomationRef.definitionDigest)
    ))
    if (previouslyRepresented) {
      if (reconcileActiveCalendarProjections(workspaceRootPath, workspaceId, currentWork, previouslyRepresented, built.now)) {
        deps.emitContextChanged?.(workspaceId, loadAllContextDocs(workspaceRootPath))
      }
      return representedWorkResult(currentWork, previouslyRepresented)
    }

    const incomingActionIndex = incomingAutomationRef?.actionIndex ?? 0
    const supersededRoots = incomingAutomationRef
      ? currentWork.items.filter((candidate) => (
          !candidate.deletedAt
          && candidate.status === 'needs-setup'
          && candidate.automationRef?.matcherId === incomingAutomationRef.matcherId
          && candidate.automationRef.event === incomingAutomationRef.event
          && (candidate.automationRef.actionIndex ?? 0) === incomingActionIndex
          && candidate.automationRef.configurationDigest !== incomingAutomationRef.configurationDigest
        ))
      : []
    const supersededOrderIds = new Set(supersededRoots.flatMap((root) => {
      const chainId = root.chain?.chainId
      return chainId
        ? currentWork.items.filter((candidate) => (
            candidate.chain?.chainId === chainId
            && !candidate.deletedAt
            && candidate.status !== 'done'
            && candidate.status !== 'canceled'
          )).map((candidate) => candidate.id)
        : [root.id]
    }))
    const supersededOrders = currentWork.items.filter((candidate) => supersededOrderIds.has(candidate.id))
    if (supersededOrders.length > 0) {
      preflightCalendarProjections(workspaceRootPath, workspaceId, supersededOrders)
      currentWork = {
        ...currentWork,
        items: currentWork.items.map((candidate) => supersededOrderIds.has(candidate.id)
          ? { ...candidate, status: 'canceled' as const, attention: undefined, inputRequest: undefined, updatedAt: built.now }
          : candidate),
        updatedAt: built.now,
      }
      assertScheduledWorkDocument(currentWork)
      upsertContextDoc(workspaceRootPath, {
        slug: SCHEDULED_WORK_CONTEXT_SLUG,
        metadata: scheduledWorkMetadata(),
        body: serializeScheduledWorkBody(currentWork),
      })
      reconcileCanceledCalendarProjections(workspaceRootPath, workspaceId, supersededOrders, built.now)
      deps.log?.info('[ScheduledWork] superseded stale automation input request', {
        automation: incomingAutomationRef?.matcherId,
        actionIndex: incomingActionIndex,
        canceledOrderIds: [...supersededOrderIds],
      })
      deps.emitContextChanged?.(workspaceId, loadAllContextDocs(workspaceRootPath))
    }

    if (incomingRoot?.status === 'needs-setup') {
      const outstanding = currentWork.items.find((candidate) => (
        !candidate.deletedAt
        && candidate.status === 'needs-setup'
        && candidate.automationRef?.matcherId === incomingRoot.automationRef?.matcherId
        && candidate.automationRef?.event === incomingRoot.automationRef?.event
        && (candidate.automationRef?.actionIndex ?? 0) === (incomingRoot.automationRef?.actionIndex ?? 0)
        && candidate.automationRef?.configurationDigest === incomingRoot.automationRef?.configurationDigest
      ))
      if (outstanding?.inputRequest && incomingRoot.automationRef) {
        const alreadyRepresented = outstanding.inputRequest.fireDefinitionDigests.includes(incomingRoot.automationRef.definitionDigest)
        const nextOutstanding = alreadyRepresented ? outstanding : {
          ...outstanding,
          execution: incomingRoot.execution,
          inputRequest: {
            ...outstanding.inputRequest,
            lastTriggeredAt: built.now,
            coalescedFireCount: outstanding.inputRequest.coalescedFireCount + 1,
            fireDefinitionDigests: [
              ...outstanding.inputRequest.fireDefinitionDigests,
              incomingRoot.automationRef.definitionDigest,
            ],
          },
          updatedAt: built.now,
        }
        let representedWork = currentWork
        if (!alreadyRepresented) {
          const nextWork = {
            ...currentWork,
            items: currentWork.items.map((candidate) => candidate.id === nextOutstanding.id ? nextOutstanding : candidate),
            updatedAt: built.now,
          }
          representedWork = nextWork
          assertScheduledWorkDocument(nextWork)
          upsertContextDoc(workspaceRootPath, {
            slug: SCHEDULED_WORK_CONTEXT_SLUG,
            metadata: scheduledWorkMetadata(),
            body: serializeScheduledWorkBody(nextWork),
          })
          deps.emitContextChanged?.(workspaceId, loadAllContextDocs(workspaceRootPath))
        }
        if (reconcileActiveCalendarProjections(workspaceRootPath, workspaceId, representedWork, nextOutstanding, built.now)) {
          deps.emitContextChanged?.(workspaceId, loadAllContextDocs(workspaceRootPath))
        }
        const chainId = outstanding.chain?.chainId
        const representedOrders = chainId
          ? representedWork.items.filter((candidate) => candidate.chain?.chainId === chainId)
          : [nextOutstanding]
        return {
          orderIds: representedOrders.map((order) => order.id),
          calendarItemIds: pending.action.calendarVisibility === 'hidden'
            ? []
            : representedOrders.map((order) => order.calendarLink.itemId),
        }
      }
    }
    for (const order of built.orders) {
      const existing = currentWork.items.find((candidate) => candidate.id === order.id)
      if (existing && !sameAutomationIdentity(existing, order)) {
        throw new Error(`Automation work id collision: ${order.id}`)
      }
    }
    const missingOrders = built.orders.filter((order) => !currentWork.items.some((candidate) => candidate.id === order.id))

    // Calendar is the user-visible projection. Persist it before making new
    // work runnable so a projection failure can never create invisible work.
    if (pending.action.calendarVisibility !== 'hidden' && pending.action.ownerScope === 'campaign') {
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
    } else if (pending.action.calendarVisibility !== 'hidden') {
      const calendar = readArtistCalendar(workspaceRootPath)
      const missingEvents = built.hqEvents.filter((event) => !calendar.events.some((candidate) => candidate.id === event.id))
      if (missingEvents.length > 0) writeArtistCalendar(workspaceRootPath, {
        ...calendar,
        events: [...calendar.events, ...missingEvents],
        updatedAt: built.now,
      })
    }

    if (missingOrders.length > 0) {
      const nextWork = {
        ...currentWork,
        items: [...currentWork.items, ...missingOrders],
        updatedAt: built.now,
      }
      assertScheduledWorkDocument(nextWork)
      upsertContextDoc(workspaceRootPath, {
        slug: SCHEDULED_WORK_CONTEXT_SLUG,
        metadata: scheduledWorkMetadata(),
        body: serializeScheduledWorkBody(nextWork),
      })
    }

    deps.emitContextChanged?.(workspaceId, loadAllContextDocs(workspaceRootPath))
    return {
      orderIds: built.orders.map((order) => order.id),
      calendarItemIds: pending.action.calendarVisibility === 'hidden'
        ? []
        : built.orders.map((order) => order.calendarLink.itemId),
    }
  })
}

function representedWorkResult(
  work: ScheduledWorkDocument,
  represented: ScheduledWorkOrder,
): AutomationWorkQueueResult {
  const chainId = represented.chain?.chainId
  const orders = chainId
    ? work.items.filter((candidate) => candidate.chain?.chainId === chainId)
    : [represented]
  return {
    orderIds: orders.map((order) => order.id),
    calendarItemIds: orders
      .filter((order) => order.calendarVisibility !== 'hidden')
      .map((order) => order.calendarLink.itemId),
  }
}

function preflightCalendarProjections(
  rootPath: string,
  workspaceId: string,
  orders: ScheduledWorkOrder[],
): void {
  if (orders.some((order) => order.owner.scope === 'campaign' && order.calendarVisibility !== 'hidden')) {
    const parsed = parseCampaignCalendarDocResult(
      loadContextDoc(rootPath, CAMPAIGN_CALENDAR_CONTEXT_SLUG) ?? undefined,
      workspaceId,
    )
    if (!parsed.ok) throw new Error(parsed.error)
  }
  if (orders.some((order) => order.owner.scope === 'hq' && order.calendarVisibility !== 'hidden')) {
    readArtistCalendar(rootPath)
  }
}

function reconcileActiveCalendarProjections(
  rootPath: string,
  workspaceId: string,
  work: ScheduledWorkDocument,
  represented: ScheduledWorkOrder,
  now: string,
): boolean {
  const chainId = represented.chain?.chainId
  const orders = (chainId
    ? work.items.filter((candidate) => candidate.chain?.chainId === chainId)
    : [represented]
  ).filter((order) => (
    !order.deletedAt
    && order.status !== 'canceled'
    && order.status !== 'done'
    && order.calendarVisibility !== 'hidden'
  ))
  if (orders.length === 0) return false

  if (orders[0]?.owner.scope === 'campaign') {
    const parsed = parseCampaignCalendarDocResult(
      loadContextDoc(rootPath, CAMPAIGN_CALENDAR_CONTEXT_SLUG) ?? undefined,
      workspaceId,
    )
    if (!parsed.ok) throw new Error(parsed.error)
    let changed = false
    const byId = new Map(parsed.calendar.items.map((item) => [item.id, item]))
    for (const order of orders) {
      const expected = campaignItem(workspaceId, order, order.status === 'scheduled' || order.status === 'running' ? 'scheduled' : 'draft')
      const existing = byId.get(expected.id)
      if (!existing) {
        parsed.calendar.items.push(expected)
        changed = true
      } else if (existing.status === 'canceled') {
        Object.assign(existing, { status: expected.status, updatedAt: now })
        changed = true
      }
    }
    if (changed) {
      upsertContextDoc(rootPath, {
        slug: CAMPAIGN_CALENDAR_CONTEXT_SLUG,
        metadata: campaignCalendarMetadata(),
        body: serializeCampaignCalendarBody({ ...parsed.calendar, updatedAt: now }),
      })
    }
    return changed
  }

  const calendar = readArtistCalendar(rootPath)
  let changed = false
  const events = [...calendar.events]
  for (const order of orders) {
    const expected = hqEvent(order)
    const index = events.findIndex((event) => event.id === expected.id)
    if (index < 0) {
      events.push(expected)
      changed = true
    } else if (events[index]?.deletedAt) {
      const { deletedAt: _deletedAt, ...restored } = events[index]!
      events[index] = { ...restored, updatedAt: now }
      changed = true
    }
  }
  if (changed) writeArtistCalendar(rootPath, { ...calendar, events, updatedAt: now })
  return changed
}

function reconcileCanceledCalendarProjections(
  rootPath: string,
  workspaceId: string,
  orders: ScheduledWorkOrder[],
  now: string,
): boolean {
  let changed = false
  const campaignIds = new Set(orders
    .filter((order) => order.owner.scope === 'campaign' && order.calendarVisibility !== 'hidden')
    .map((order) => order.calendarLink.itemId))
  if (campaignIds.size > 0) {
    const parsed = parseCampaignCalendarDocResult(
      loadContextDoc(rootPath, CAMPAIGN_CALENDAR_CONTEXT_SLUG) ?? undefined,
      workspaceId,
    )
    if (!parsed.ok) throw new Error(parsed.error)
    const items = parsed.calendar.items.map((item) => campaignIds.has(item.id) && item.status !== 'canceled'
      ? (changed = true, { ...item, status: 'canceled' as const, updatedAt: now })
      : item)
    if (changed) {
      upsertContextDoc(rootPath, {
        slug: CAMPAIGN_CALENDAR_CONTEXT_SLUG,
        metadata: campaignCalendarMetadata(),
        body: serializeCampaignCalendarBody({ ...parsed.calendar, items, updatedAt: now }),
      })
    }
  }

  const hqIds = new Set(orders
    .filter((order) => order.owner.scope === 'hq' && order.calendarVisibility !== 'hidden')
    .map((order) => order.calendarLink.itemId))
  if (hqIds.size > 0) {
    const calendar = readArtistCalendar(rootPath)
    const events = calendar.events.map((event) => hqIds.has(event.id) && !event.deletedAt
      ? (changed = true, { ...event, deletedAt: now, updatedAt: now })
      : event)
    if (events.some((event, index) => event !== calendar.events[index])) {
      writeArtistCalendar(rootPath, { ...calendar, events, updatedAt: now })
    }
  }
  return changed
}

function runtimeConfigAllowsAction(workspaceRootPath: string, pending: PendingQueuedWork): boolean {
  if (!isWeeklySignalAction(pending.action)) return true
  if (pending.eventKey.startsWith('test:')) return true
  const body = loadContextDoc(workspaceRootPath, ARTIST_INTEL_CONFIG_SLUG)?.body
  if (!body) return false
  const fenced = body.match(/```json\s*([\s\S]*?)```/i)?.[1]
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  const json = fenced?.trim() || (start >= 0 && end > start ? body.slice(start, end + 1) : '')
  if (!json) return false
  try {
    const config = JSON.parse(json) as Record<string, unknown>
    return config.version === 1 && config.enabled === true && config.cadence === 'weekly'
  } catch {
    return false
  }
}

function isWeeklySignalAction(action: QueueWorkAction): boolean {
  return hqNormalizeSemanticIntentId(action.intentId) === WEEKLY_SIGNAL_INTENT_ID
}

function buildTriggeredWork(
  workspaceId: string,
  pending: PendingQueuedWork,
  missingInputs: string[] = [],
  configuredAction: QueueWorkAction = pending.action,
) {
  const now = new Date(pending.eventTimestamp).toISOString()
  const timezone = pending.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  const actionIndex = pending.actionIndex ?? 0
  const definitionDigest = scheduledWorkDefinitionDigest({
    matcherId: pending.matcherId,
    actionIndex,
    event: pending.event,
    eventKey: pending.eventKey,
    action: configuredAction,
  })
  const configurationDigest = scheduledWorkDefinitionDigest({
    matcherId: pending.matcherId,
    actionIndex,
    event: pending.event,
    action: configuredAction,
  })
  const key = createHash('sha256')
    .update(definitionDigest)
    .digest('hex')
    .slice(0, 20)
  const chainId = `automation-work-${pending.matcherId}-${key}`
  const automationRef = {
    matcherId: pending.matcherId,
    actionIndex,
    name: pending.automationName.trim() || pending.action.title.trim(),
    event: pending.event,
    definitionDigest,
    configurationDigest,
  }
  const root = buildOrder(workspaceId, pending.action, chainId, 0, now, timezone, missingInputs, automationRef)
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
      }, chainId, 1, now, timezone, [], automationRef)
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
    ? orders.map((order) => campaignItem(workspaceId, order, order.status === 'scheduled' ? 'scheduled' : 'draft'))
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
  missingInputs: string[] = [],
  automationRef?: ScheduledWorkOrder['automationRef'],
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
    calendarVisibility: action.calendarVisibility ?? 'visible',
    title: action.title,
    intentId: action.intentId ?? hqSemanticIntentId({ title: action.title, intent: JSON.stringify(action.execution) }),
    type: action.execution.type,
    status: missingInputs.length > 0 ? 'needs-setup' : 'scheduled',
    startAt: now,
    timezone,
    execution: action.execution,
    inputRefs,
    approvals: [],
    runs: [],
    attention: missingInputs.length > 0
      ? { reason: 'input-required', message: `Waiting for: ${missingInputs.join(', ')}` }
      : undefined,
    inputRequest: missingInputs.length > 0 ? {
      id: `${id}:input`,
      inputs: missingInputs,
      requestedAt: now,
      lastTriggeredAt: now,
      coalescedFireCount: 1,
      fireDefinitionDigests: automationRef ? [automationRef.definitionDigest] : [],
    } : undefined,
    automationRef,
    executionKey: {
      payloadDigest: scheduledWorkDefinitionDigest({ execution: action.execution, inputRefs, chainId, ordinal }),
      idempotencyKey: `${chainId}:${ordinal}`,
    },
    createdAt: now,
    updatedAt: now,
  }
}

function resolveWorkflowInputBindings(
  rootPath: string,
  pending: PendingQueuedWork,
): { action: QueueWorkAction; missingInputs: string[] } {
  const action = pending.action
  if (action.execution.type !== 'workflow-run') {
    if (!action.inputBindings) return { action, missingInputs: [] }
    throw new Error('Workflow input bindings require workflow work.')
  }

  const workflow = loadGlobalWorkflow(action.execution.workflowSlug)
  if (!workflow) throw new Error(`Automation workflow was not found: ${action.execution.workflowSlug}`)
  if (!action.inputBindings) {
    return {
      action: {
        ...action,
        execution: {
          ...action.execution,
          triggerInputs: normalizeWorkflowTriggerInputs(workflow, action.execution.triggerInputs),
        },
      },
      missingInputs: [],
    }
  }
  const definitions = workflow.metadata.trigger.inputs ?? []
  assertWorkflowInputBindings(definitions, action.inputBindings, workflowBindingTrigger(pending.event))

  const raw: Record<string, unknown> = {}
  for (const control of ['enabled_source_slugs', 'permission_mode'] as const) {
    if (Object.prototype.hasOwnProperty.call(action.execution.triggerInputs, control)) {
      raw[control] = action.execution.triggerInputs[control]
    }
  }
  const missingInputs: string[] = []
  const untrustedTriggerInputs: string[] = []
  for (const definition of definitions) {
    const binding = action.inputBindings[definition.name]
    if (!binding) {
      if (definition.default !== undefined) raw[definition.name] = definition.default
      else if (definition.required) throw new Error(`Workflow input needs a binding: ${definition.name}`)
      continue
    }
    if (binding.mode === 'fixed') {
      if (!Object.prototype.hasOwnProperty.call(binding, 'value') || binding.value === undefined) {
        throw new Error(`Fixed workflow input is missing a value: ${definition.name}`)
      }
      raw[definition.name] = binding.value
      continue
    }
    if (binding.mode === 'ask') {
      missingInputs.push(definition.name)
      continue
    }
    if (!Object.prototype.hasOwnProperty.call(pending.triggerData ?? {}, binding.from)) {
      throw new Error(`Trigger data is unavailable for workflow input "${definition.name}": ${binding.from}`)
    }
    raw[definition.name] = normalizeTriggerBoundValue(binding.from, pending.triggerData?.[binding.from])
    if (binding.from !== 'file.path') untrustedTriggerInputs.push(definition.name)
  }

  const triggerInputs = normalizeWorkflowTriggerInputs(workflow, raw, {
    allowMissingRequired: missingInputs,
    skipDefaultsFor: missingInputs,
  })
  return {
    action: {
      ...action,
      execution: {
        ...action.execution,
        triggerInputs,
        ...(untrustedTriggerInputs.length ? { untrustedTriggerInputs } : {}),
      },
    },
    missingInputs,
  }
}

function workflowBindingTrigger(event: PendingQueuedWork['event']): 'SchedulerTick' | 'FileWatch' | 'WebhookReceive' | 'PollUrl' | 'MessageReceive' {
  if (event === 'SchedulerTick' || event === 'FileWatch' || event === 'WebhookReceive' || event === 'PollUrl' || event === 'MessageReceive') return event
  throw new Error(`Event cannot supply workflow inputs: ${event}`)
}

const MAX_TRIGGER_TEXT_CHARS = 4_096

function normalizeTriggerBoundValue(source: WorkflowInputTriggerSource, value: unknown): unknown {
  if (source === 'file.path') return value
  const serialized = typeof value === 'string' ? value : JSON.stringify(value)
  if (!serialized || serialized === 'null') throw new Error(`Trigger data is empty: ${source}`)
  const encoded = new TextEncoder().encode(serialized)
  if (encoded.length <= MAX_TRIGGER_TEXT_CHARS) return serialized
  return `${new TextDecoder().decode(encoded.slice(0, MAX_TRIGGER_TEXT_CHARS))}\n[truncated]`
}

function validateAction(rootPath: string, action: QueueWorkAction): void {
  const executions = [action.execution, action.followUp?.execution].filter((value): value is ScheduledWorkExecution => Boolean(value))
  if (action.calendarVisibility === 'hidden' && (action.followUp || executions.some((execution) => execution.type !== 'agent-task' && execution.type !== 'workflow-run'))) {
    throw new Error('Hidden queue-work automations support standalone agent and workflow work only.')
  }
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
    calendarVisibility: order.calendarVisibility,
    title: order.title,
    execution: order.execution,
    inputRefs: order.inputRefs,
    executionKey: order.executionKey,
    chain: order.chain,
  }
}

function sameAutomationIdentity(existing: ScheduledWorkOrder, candidate: ScheduledWorkOrder): boolean {
  if (existing.automationRef && candidate.automationRef) {
    return existing.automationRef.definitionDigest === candidate.automationRef.definitionDigest
  }
  return scheduledWorkDefinitionDigest(identity(existing)) === scheduledWorkDefinitionDigest(identity(candidate))
}
