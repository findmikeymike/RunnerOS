import type { ScheduledWorkOrder } from '@craft-agent/shared/scheduled-work'
import { nextDailyWindowRuns } from '@craft-agent/shared/automations/daily-window'
import type { AutomationListItem, ExecutionEntry } from '@/components/automations/types'
import { computeNextRuns } from '@/components/automations/utils'
import type { ActiveWorkItem, ActiveWorkSection } from './types'

export interface ActiveSessionLike {
  id: string
  workspaceId: string
  name?: string
  preview?: string
  isProcessing?: boolean
  hidden?: boolean
  lastMessageAt?: number
  createdAt?: number
  spawnedFromAgent?: { agentSlug: string; agentName: string }
  triggeredByAutomationId?: string
  triggeredByAutomationName?: string
}

export interface ActiveWorkflowRunLike {
  id: string
  workspaceId: string
  workflowSlug: string
  state: 'created' | 'queued' | 'running' | 'interrupted' | 'paused' | 'succeeded' | 'failed' | 'cancelled'
  createdAt: string
  updatedAt: string
  workflowSnapshot?: { metadata?: { name?: string } }
}

export interface BuildActiveWorkItemsInput {
  workspaceId: string
  sessions: ActiveSessionLike[]
  workflowRuns: ActiveWorkflowRunLike[]
  scheduledWork: ScheduledWorkOrder[]
  automations: AutomationListItem[]
  automationExecutions?: Map<string, ExecutionEntry[]>
  describeCron?: (cron: string) => string
  runningWorkspaceIds?: ReadonlySet<string>
  automationsByWorkspace?: ReadonlyMap<string, AutomationListItem[]>
  workspaceNamesById?: ReadonlyMap<string, string>
}

const ATTENTION_STATUS = new Set(['needs-setup', 'needs-approval', 'awaiting-review', 'needs-attention'])
const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const RECENT_COMPLETION_MS = 30 * 24 * 60 * 60 * 1000

export function countStaleInputRequests(items: ActiveWorkItem[], now = Date.now()): number {
  return items.filter((item) => {
    const requestedAt = item.inputRequest?.requestedAt
    if (!requestedAt) return false
    const timestamp = Date.parse(requestedAt)
    return Number.isFinite(timestamp) && now - timestamp >= WEEK_MS
  }).length
}

function asIso(timestamp: number | undefined): string | undefined {
  return typeof timestamp === 'number' && Number.isFinite(timestamp)
    ? new Date(timestamp).toISOString()
    : undefined
}

function latestOrderLinks(order: ScheduledWorkOrder): { sessionId?: string; workflowRunId?: string } {
  const latest = [...order.runs].reverse().find((run) => run.sessionId || run.workflowRunId)
  if (latest?.sessionId || latest?.workflowRunId) {
    return { sessionId: latest.sessionId, workflowRunId: latest.workflowRunId }
  }
  if (order.result?.type === 'agent-task') return { sessionId: order.result.sessionId }
  if (order.result?.type === 'workflow-run') return { workflowRunId: order.result.workflowRunId }
  return {}
}

function scheduledSection(order: ScheduledWorkOrder): ActiveWorkSection | null {
  if (order.status === 'running') return 'running'
  if (order.status === 'scheduled' || order.status === 'waiting') return 'up-next'
  if (ATTENTION_STATUS.has(order.status)) return 'attention'
  return null
}

function scheduledStatusLabel(order: ScheduledWorkOrder): string {
  switch (order.status) {
    case 'running': return 'Running'
    case 'scheduled': return 'Scheduled'
    case 'waiting': return 'Waiting'
    case 'needs-setup': return 'Needs setup'
    case 'needs-approval': return 'Needs approval'
    case 'awaiting-review': return 'Ready for review'
    case 'needs-attention': return 'Needs attention'
    default: return order.status
  }
}

function scheduledActionLabel(order: ScheduledWorkOrder, missingSource: boolean): ActiveWorkItem['actionLabel'] {
  if (order.inputRequest) return 'Supply'
  if (missingSource) return 'Reschedule'
  if (order.status === 'needs-approval') return 'Approve again'
  if (order.status === 'awaiting-review') return 'Review'
  if (/connect|credential|account|token|sign.?in/i.test(order.attention?.message ?? '')) return 'Reconnect'
  if (/missed|schedule|time|window/i.test(order.attention?.message ?? '')) return 'Reschedule'
  if (order.status === 'needs-setup') return 'Activate'
  return ATTENTION_STATUS.has(order.status) ? 'Review' : undefined
}

function workflowSection(state: ActiveWorkflowRunLike['state']): ActiveWorkSection | null {
  if (state === 'running') return 'running'
  if (state === 'created' || state === 'queued') return 'up-next'
  if (state === 'paused' || state === 'interrupted' || state === 'failed') return 'attention'
  return null
}

function workflowStatusLabel(state: ActiveWorkflowRunLike['state']): string {
  switch (state) {
    case 'created': return 'Starting'
    case 'queued': return 'Queued'
    case 'running': return 'Running'
    case 'paused': return 'Paused'
    case 'interrupted': return 'Interrupted'
    case 'failed': return 'Failed'
    default: return state
  }
}

function automationCadence(automation: AutomationListItem, _describeCron?: (cron: string) => string): string {
  if (automation.event === 'FileWatch') return 'On file'
  if (automation.event === 'WebhookReceive') return 'Webhook'
  if (automation.event === 'MessageReceive') return 'On message'
  if (automation.event === 'PollUrl') return 'On URL'
  if (!automation.cron) return 'Triggered'
  const parts = automation.cron.trim().split(/\s+/)
  if (parts.length !== 5) return 'Custom schedule'
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts
  const fixedTime = /^\d+$/.test(minute!) && /^\d+$/.test(hour!)
  if (fixedTime && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') return 'Daily'
  if (fixedTime && dayOfMonth === '*' && month === '*' && /^(?:[0-7])$/.test(dayOfWeek!)) return 'Weekly'
  if (fixedTime && /^\d+$/.test(dayOfMonth!) && month === '*' && dayOfWeek === '*') return 'Monthly'
  return 'Custom schedule'
}

function originLabel(workspaceId: string, input: BuildActiveWorkItemsInput): string | undefined {
  return input.workspaceNamesById?.get(workspaceId)
}

function automationStateLabel(automation: AutomationListItem): string {
  if (automation.cron) return 'Scheduled'
  if (automation.event === 'FileWatch' || automation.event === 'PollUrl') return 'Watching'
  if (automation.event === 'WebhookReceive' || automation.event === 'MessageReceive') return 'Ready'
  return 'Active'
}

function cadenceForOrder(order: ScheduledWorkOrder, input: BuildActiveWorkItemsInput): string {
  if (!order.automationRef) return 'Once'
  const automation = (input.automationsByWorkspace?.get(order.owner.workspaceId) ?? input.automations)
    .find((candidate) => candidate.id === order.automationRef?.matcherId)
  if (automation) return automationCadence(automation, input.describeCron)
  const event = order.automationRef.event
  if (event === 'FileWatch') return 'On file'
  if (event === 'WebhookReceive') return 'Webhook'
  if (event === 'MessageReceive') return 'On message'
  if (event === 'PollUrl') return 'On URL'
  return 'Scheduled'
}

function cadenceForSession(session: ActiveSessionLike, input: BuildActiveWorkItemsInput): string {
  if (!session.triggeredByAutomationId && !session.triggeredByAutomationName) return 'Once'
  const workspaceAutomations = input.automationsByWorkspace?.get(session.workspaceId)
  const automationById = session.triggeredByAutomationId
    ? workspaceAutomations?.find((candidate) => (
      candidate.id === session.triggeredByAutomationId
      || candidate.rawMatcher?.slug === session.triggeredByAutomationId
    ))
    : undefined
  const automation = automationById ?? workspaceAutomations
    ?.find((candidate) => candidate.name === session.triggeredByAutomationName)
  return automation ? automationCadence(automation, input.describeCron) : 'Scheduled'
}

function compareItems(a: ActiveWorkItem, b: ActiveWorkItem): number {
  const sectionRank: Record<ActiveWorkSection, number> = {
    running: 0,
    attention: 1,
    'up-next': 2,
    paused: 3,
  }
  const sectionDelta = sectionRank[a.section] - sectionRank[b.section]
  if (sectionDelta !== 0) return sectionDelta

  if (a.section === 'attention') {
    const approval = (item: ActiveWorkItem) => /approval|review/i.test(item.statusLabel) ? 0 : 1
    const approvalDelta = approval(a) - approval(b)
    if (approvalDelta !== 0) return approvalDelta
    const updatedDelta = (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')
    if (updatedDelta !== 0) return updatedDelta
  } else {
    const timeDelta = (a.sortAt ?? '9999').localeCompare(b.sortAt ?? '9999')
    if (timeDelta !== 0) return timeDelta
  }

  return a.id.localeCompare(b.id)
}

export function buildActiveWorkItems(input: BuildActiveWorkItemsInput): ActiveWorkItem[] {
  const runningWorkspaceIds = input.runningWorkspaceIds ?? new Set([input.workspaceId])
  const latestCompletedByAutomation = new Map<string, ScheduledWorkOrder>()
  for (const order of input.scheduledWork) {
    if (order.deletedAt || order.status !== 'done' || !order.automationRef?.matcherId) continue
    const current = latestCompletedByAutomation.get(order.automationRef.matcherId)
    if (!current || current.updatedAt < order.updatedAt) latestCompletedByAutomation.set(order.automationRef.matcherId, order)
  }
  const orders = input.scheduledWork.filter((order) => (
    !order.deletedAt
    && (order.owner.workspaceId === input.workspaceId
      || ((order.status === 'running' || ATTENTION_STATUS.has(order.status)) && runningWorkspaceIds.has(order.owner.workspaceId)))
  ))
  const orderByWorkflowRun = new Map<string, ScheduledWorkOrder>()
  const orderBySession = new Map<string, ScheduledWorkOrder>()
  const availableWorkflowRunIds = new Set(input.workflowRuns
    .filter((run) => run.workspaceId === input.workspaceId || (run.state === 'running' && runningWorkspaceIds.has(run.workspaceId)))
    .map((run) => run.id))
  const availableSessionIds = new Set(input.sessions
    .filter((session) => (session.workspaceId === input.workspaceId || runningWorkspaceIds.has(session.workspaceId)) && !session.hidden && session.isProcessing)
    .map((session) => session.id))
  for (const order of orders) {
    const links = latestOrderLinks(order)
    if (links.workflowRunId) orderByWorkflowRun.set(links.workflowRunId, order)
    if (links.sessionId) orderBySession.set(links.sessionId, order)
  }

  const items: ActiveWorkItem[] = []
  const representedOrders = new Set<string>()
  for (const run of input.workflowRuns) {
    if (run.workspaceId !== input.workspaceId && (run.state !== 'running' || !runningWorkspaceIds.has(run.workspaceId))) continue
    const section = workflowSection(run.state)
    if (!section) continue
    const order = orderByWorkflowRun.get(run.id)
    if (order) representedOrders.add(order.id)
    items.push({
      id: `workflow-run:${run.id}`,
      source: 'workflow-run',
      sourceId: run.id,
      workspaceId: run.workspaceId,
      section,
      title: run.workflowSnapshot?.metadata?.name || run.workflowSlug.replace(/-/g, ' '),
      subtitle: order?.title,
      statusLabel: workflowStatusLabel(run.state),
      cadenceLabel: order ? cadenceForOrder(order, input) : 'Once',
      originLabel: originLabel(run.workspaceId, input),
      sortAt: order?.startAt ?? run.createdAt,
      updatedAt: run.updatedAt,
      attentionReason: section === 'attention' ? workflowStatusLabel(run.state) : undefined,
      actionLabel: section === 'attention' ? 'Review' : undefined,
      openTarget: { kind: 'workflow-run', id: run.id },
    })
  }

  for (const session of input.sessions) {
    if ((!runningWorkspaceIds.has(session.workspaceId) && session.workspaceId !== input.workspaceId) || !session.isProcessing || session.hidden) continue
    const order = orderBySession.get(session.id)
    if (order) representedOrders.add(order.id)
    items.push({
      id: `session:${session.id}`,
      source: 'session',
      sourceId: session.id,
      workspaceId: session.workspaceId,
      section: 'running',
      title: session.name || session.spawnedFromAgent?.agentName || session.preview || 'Worker session',
      subtitle: order?.title || session.spawnedFromAgent?.agentName,
      statusLabel: 'Running',
      cadenceLabel: order ? cadenceForOrder(order, input) : cadenceForSession(session, input),
      originLabel: originLabel(session.workspaceId, input),
      sortAt: order?.startAt ?? asIso(session.createdAt),
      updatedAt: asIso(session.lastMessageAt),
      openTarget: { kind: 'session', id: session.id },
    })
  }

  for (const order of orders) {
    if (representedOrders.has(order.id)) continue
    const links = latestOrderLinks(order)
    const hasLinkedTarget = Boolean(links.workflowRunId || links.sessionId)
    const hasAvailableTarget = Boolean(
      (links.workflowRunId && availableWorkflowRunIds.has(links.workflowRunId))
      || (links.sessionId && availableSessionIds.has(links.sessionId)),
    )
    const hasDurableAttention = ATTENTION_STATUS.has(order.status) && Boolean(order.attention?.message)
    const missingSource = hasLinkedTarget && !hasAvailableTarget && !hasDurableAttention
    const section = missingSource ? 'attention' : scheduledSection(order)
    if (!section) continue
    const openTarget = ATTENTION_STATUS.has(order.status)
      ? { kind: 'scheduled-work' as const, id: order.id }
      : links.workflowRunId && availableWorkflowRunIds.has(links.workflowRunId)
        ? { kind: 'workflow-run' as const, id: links.workflowRunId }
        : links.sessionId && availableSessionIds.has(links.sessionId)
          ? { kind: 'session' as const, id: links.sessionId }
          : { kind: 'scheduled-work' as const, id: order.id }
    items.push({
      id: `scheduled-work:${order.id}`,
      source: 'scheduled-work',
      sourceId: order.id,
      workspaceId: order.owner.workspaceId,
      section,
      title: order.title,
      subtitle: order.execution.type === 'workflow-run'
        ? order.execution.workflowSlug.replace(/-/g, ' ')
        : order.execution.type === 'agent-task'
          ? order.execution.agentSlug.replace(/-/g, ' ')
          : undefined,
      statusLabel: missingSource ? 'Missing source' : scheduledStatusLabel(order),
      cadenceLabel: cadenceForOrder(order, input),
      originLabel: originLabel(order.owner.workspaceId, input),
      sortAt: order.startAt,
      updatedAt: order.updatedAt,
      attentionReason: missingSource
        ? 'The linked run or worker session is no longer available. Open the scheduled item to review or remove it.'
        : order.attention?.message,
      inputRequest: order.inputRequest,
      actionLabel: scheduledActionLabel(order, missingSource),
      nextRunAt: section === 'up-next' ? order.startAt : undefined,
      openTarget,
    })
  }

  const attentionOrderIds = new Set(orders
    .filter((order) => ATTENTION_STATUS.has(order.status))
    .map((order) => order.id))

  for (const automation of input.automations) {
    const latest = [...(input.automationExecutions?.get(automation.id) ?? [])]
      .sort((a, b) => b.timestamp - a.timestamp)[0]
    const latestSuccess = [...(input.automationExecutions?.get(automation.id) ?? [])]
      .filter((entry) => entry.status === 'success')
      .sort((a, b) => b.timestamp - a.timestamp)[0]
    const latestCompletedOrder = latestCompletedByAutomation.get(automation.id)
    const queuesTrackedWork = automation.actions.some((action) => action.type === 'queue-work')
    const hasUnresolvedFailure = Boolean(
      automation.enabled
      &&
      latest
      && latest.status !== 'success'
      && !latest.workOrderIds?.some((id) => attentionOrderIds.has(id)),
    )
    const snoozedUntilMs = automation.snoozedUntil ? Date.parse(automation.snoozedUntil) : Number.NaN
    const isSnoozed = automation.enabled && Number.isFinite(snoozedUntilMs) && snoozedUntilMs > Date.now()
    const candidateRuns = automation.enabled && automation.cron
      ? automation.dailyWindow
        ? nextDailyWindowRuns(automation.id, automation.dailyWindow, 3, automation.timezone)
        : computeNextRuns(automation.cron, 10, automation.timezone)
      : []
    const nextRun = candidateRuns.find((run) => !isSnoozed || run.getTime() >= snoozedUntilMs)
    const recentCompletionAt = latestCompletedOrder?.updatedAt ?? (!queuesTrackedWork && latestSuccess ? asIso(latestSuccess.timestamp) : undefined)
    const recentCompletionMs = recentCompletionAt ? Date.parse(recentCompletionAt) : Number.NaN
    items.push({
      id: `automation:${automation.id}`,
      source: 'automation',
      sourceId: automation.id,
      workspaceId: input.workspaceId,
      section: isSnoozed ? 'paused' : hasUnresolvedFailure ? 'attention' : automation.enabled ? 'up-next' : 'paused',
      title: automation.name,
      subtitle: automation.summary,
      statusLabel: isSnoozed
        ? 'Snoozed'
        : hasUnresolvedFailure
        ? latest!.status === 'blocked' ? 'Blocked' : 'Failed'
        : automation.enabled ? automationStateLabel(automation) : 'Paused',
      cadenceLabel: automationCadence(automation, input.describeCron),
      originLabel: originLabel(input.workspaceId, input),
      sortAt: nextRun?.toISOString(),
      updatedAt: hasUnresolvedFailure ? asIso(latest!.timestamp) : asIso(automation.lastExecutedAt),
      attentionReason: !isSnoozed && hasUnresolvedFailure ? latest!.error : undefined,
      actionLabel: !automation.enabled || isSnoozed
        ? 'Activate'
        : hasUnresolvedFailure && /connect|credential|account|token|sign.?in/i.test(latest?.error ?? '')
          ? 'Reconnect'
          : hasUnresolvedFailure ? 'Review' : 'Snooze 24h',
      nextRunAt: nextRun?.toISOString(),
      recentCompletionAt: Number.isFinite(recentCompletionMs) && Date.now() - recentCompletionMs <= RECENT_COMPLETION_MS
        ? recentCompletionAt
        : undefined,
      snoozedUntil: Number.isFinite(snoozedUntilMs) && snoozedUntilMs > Date.now() ? automation.snoozedUntil : undefined,
      openTarget: { kind: 'automation', id: automation.id },
    })
  }

  return items.sort(compareItems)
}
