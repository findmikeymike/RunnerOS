import type { ScheduledWorkOrder } from '@craft-agent/shared/scheduled-work'
import type { AutomationListItem, ExecutionEntry } from '@/components/automations/types'
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
}

const ATTENTION_STATUS = new Set(['needs-setup', 'needs-approval', 'awaiting-review', 'needs-attention'])

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

function automationCadence(automation: AutomationListItem, describeCron?: (cron: string) => string): string {
  if (!automation.cron) return 'Triggered'
  const described = describeCron?.(automation.cron) ?? automation.cron
  if (/^daily\b/i.test(described)) return 'Daily'
  if (/^weekly\b/i.test(described) || /weekday/i.test(described)) return 'Weekly'
  if (/^monthly\b/i.test(described)) return 'Monthly'
  if (described.trim() === automation.cron.trim()) return 'Custom schedule'
  return described
}

function compareItems(a: ActiveWorkItem, b: ActiveWorkItem): number {
  const sectionRank: Record<ActiveWorkSection, number> = {
    attention: 0,
    running: 1,
    'up-next': 2,
    recurring: 3,
  }
  const sectionDelta = sectionRank[a.section] - sectionRank[b.section]
  if (sectionDelta !== 0) return sectionDelta

  if (a.section === 'attention') {
    const approval = (item: ActiveWorkItem) => /approval|review/i.test(item.statusLabel) ? 0 : 1
    const approvalDelta = approval(a) - approval(b)
    if (approvalDelta !== 0) return approvalDelta
    const updatedDelta = (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')
    if (updatedDelta !== 0) return updatedDelta
  } else if (a.section === 'recurring') {
    const enabledDelta = Number(a.statusLabel === 'Paused') - Number(b.statusLabel === 'Paused')
    if (enabledDelta !== 0) return enabledDelta
  } else {
    const timeDelta = (a.sortAt ?? '9999').localeCompare(b.sortAt ?? '9999')
    if (timeDelta !== 0) return timeDelta
  }

  return a.id.localeCompare(b.id)
}

export function buildActiveWorkItems(input: BuildActiveWorkItemsInput): ActiveWorkItem[] {
  const orders = input.scheduledWork.filter((order) => (
    order.owner.workspaceId === input.workspaceId && !order.deletedAt
  ))
  const orderByWorkflowRun = new Map<string, ScheduledWorkOrder>()
  const orderBySession = new Map<string, ScheduledWorkOrder>()
  for (const order of orders) {
    const links = latestOrderLinks(order)
    if (links.workflowRunId) orderByWorkflowRun.set(links.workflowRunId, order)
    if (links.sessionId) orderBySession.set(links.sessionId, order)
  }

  const items: ActiveWorkItem[] = []
  const representedOrders = new Set<string>()

  for (const run of input.workflowRuns) {
    if (run.workspaceId !== input.workspaceId) continue
    const section = workflowSection(run.state)
    if (!section) continue
    const order = orderByWorkflowRun.get(run.id)
    if (order) representedOrders.add(order.id)
    items.push({
      id: `workflow-run:${run.id}`,
      source: 'workflow-run',
      sourceId: run.id,
      workspaceId: input.workspaceId,
      section,
      title: run.workflowSnapshot?.metadata?.name || run.workflowSlug.replace(/-/g, ' '),
      subtitle: order?.title,
      statusLabel: workflowStatusLabel(run.state),
      cadenceLabel: order ? 'Once' : 'Once',
      sortAt: order?.startAt ?? run.createdAt,
      updatedAt: run.updatedAt,
      attentionReason: section === 'attention' ? workflowStatusLabel(run.state) : undefined,
      openTarget: { kind: 'workflow-run', id: run.id },
    })
  }

  for (const session of input.sessions) {
    if (session.workspaceId !== input.workspaceId || !session.isProcessing || session.hidden) continue
    const order = orderBySession.get(session.id)
    if (order) representedOrders.add(order.id)
    items.push({
      id: `session:${session.id}`,
      source: 'session',
      sourceId: session.id,
      workspaceId: input.workspaceId,
      section: 'running',
      title: session.name || session.spawnedFromAgent?.agentName || session.preview || 'Worker session',
      subtitle: order?.title || session.spawnedFromAgent?.agentName,
      statusLabel: 'Running',
      cadenceLabel: 'Once',
      sortAt: order?.startAt ?? asIso(session.createdAt),
      updatedAt: asIso(session.lastMessageAt),
      openTarget: { kind: 'session', id: session.id },
    })
  }

  for (const order of orders) {
    if (representedOrders.has(order.id)) continue
    const section = scheduledSection(order)
    if (!section) continue
    const links = latestOrderLinks(order)
    const openTarget = links.workflowRunId
      ? { kind: 'workflow-run' as const, id: links.workflowRunId }
      : links.sessionId
        ? { kind: 'session' as const, id: links.sessionId }
        : { kind: 'scheduled-work' as const, id: order.id }
    items.push({
      id: `scheduled-work:${order.id}`,
      source: 'scheduled-work',
      sourceId: order.id,
      workspaceId: input.workspaceId,
      section,
      title: order.title,
      subtitle: order.execution.type === 'workflow-run'
        ? order.execution.workflowSlug.replace(/-/g, ' ')
        : order.execution.type === 'agent-task'
          ? order.execution.agentSlug.replace(/-/g, ' ')
          : undefined,
      statusLabel: scheduledStatusLabel(order),
      cadenceLabel: 'Once',
      sortAt: order.startAt,
      updatedAt: order.updatedAt,
      attentionReason: order.attention?.message,
      openTarget,
    })
  }

  const attentionOrderIds = new Set(orders
    .filter((order) => ATTENTION_STATUS.has(order.status))
    .map((order) => order.id))

  for (const automation of input.automations) {
    items.push({
      id: `automation:${automation.id}`,
      source: 'automation',
      sourceId: automation.id,
      workspaceId: input.workspaceId,
      section: 'recurring',
      title: automation.name,
      subtitle: automation.summary,
      statusLabel: automation.enabled ? 'Active' : 'Paused',
      cadenceLabel: automationCadence(automation, input.describeCron),
      sortAt: automation.cron ? undefined : asIso(automation.lastExecutedAt),
      updatedAt: asIso(automation.lastExecutedAt),
      openTarget: { kind: 'automation', id: automation.id },
    })

    const latest = [...(input.automationExecutions?.get(automation.id) ?? [])]
      .sort((a, b) => b.timestamp - a.timestamp)[0]
    if (!latest || latest.status === 'success') continue
    if (latest.workOrderIds?.some((id) => attentionOrderIds.has(id))) continue
    items.push({
      id: `automation-attention:${automation.id}:${latest.id}`,
      source: 'automation',
      sourceId: automation.id,
      workspaceId: input.workspaceId,
      section: 'attention',
      title: automation.name,
      subtitle: latest.actionSummary || automation.summary,
      statusLabel: latest.status === 'blocked' ? 'Blocked' : 'Failed',
      cadenceLabel: automationCadence(automation, input.describeCron),
      sortAt: asIso(latest.timestamp),
      updatedAt: asIso(latest.timestamp),
      attentionReason: latest.error,
      openTarget: { kind: 'automation', id: automation.id },
    })
  }

  return items.sort(compareItems)
}
