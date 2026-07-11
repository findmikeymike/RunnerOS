import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { AUTOMATIONS_CONFIG_FILE, AUTOMATIONS_HISTORY_FILE } from '@craft-agent/shared/automations'
import {
  hqIntentFingerprint,
  type HqOperationalItem,
  type HqOperationalScope,
  type HqOperationalSnapshot,
  type HqOperationalSourceHealth,
} from '@craft-agent/shared/hq-state'
import { listOutputManifests } from '@craft-agent/shared/outputs'
import {
  parseScheduledWorkDocResult,
  SCHEDULED_WORK_CONTEXT_SLUG,
  type ScheduledWorkOrder,
} from '@craft-agent/shared/scheduled-work'
import { loadContextDoc } from '@craft-agent/shared/workspace-context'
import { listRuns } from '@craft-agent/shared/workflows'
import type { WorkflowRunSnapshot } from '@craft-agent/shared/workflows'

const ACTIVE_SCHEDULED = new Set(['waiting', 'scheduled', 'running'])
const APPROVAL_SCHEDULED = new Set(['needs-approval', 'awaiting-review'])

export function buildHqOperationalSnapshot(workspaceRootPath: string): HqOperationalSnapshot {
  const generatedAt = new Date().toISOString()
  const active: HqOperationalItem[] = []
  const approvals: HqOperationalItem[] = []
  const failures: HqOperationalItem[] = []
  const sourceHealth: HqOperationalSourceHealth[] = []

  const outputs = listOutputManifests(workspaceRootPath)
  for (const output of outputs) {
    const scope = outputScope(output.context)
    const item: HqOperationalItem = {
      id: output.id,
      kind: 'output',
      title: output.title,
      status: output.approval?.state ?? output.status,
      updatedAt: output.updatedAt,
      scope,
      fingerprint: hqIntentFingerprint({ scope, worker: output.origin.agentSlug, title: output.title, intent: output.summary }),
      worker: output.origin.agentSlug,
      intent: output.summary,
      source: `output:${output.id}`,
    }
    if (output.approval?.state === 'pending') approvals.push(item)
    if (output.status === 'failed' || output.approval?.state === 'changes_requested') failures.push(item)
  }
  sourceHealth.push(health('outputs', generatedAt, outputs.map((item) => item.updatedAt)))

  const scheduledDoc = loadContextDoc(workspaceRootPath, SCHEDULED_WORK_CONTEXT_SLUG)
  const workspaceId = outputs[0]?.workspaceId ?? readScheduledWorkspaceId(scheduledDoc?.body) ?? 'workspace'
  const scheduled = parseScheduledWorkDocResult(scheduledDoc ?? undefined, workspaceId)
  const scheduledOrders = scheduled.ok ? scheduled.work.items.filter((item) => !item.deletedAt) : []
  if (scheduled.ok) {
    for (const order of scheduledOrders) {
      const item = scheduledItem(order)
      if (ACTIVE_SCHEDULED.has(order.status)) active.push(item)
      if (APPROVAL_SCHEDULED.has(order.status)) approvals.push(item)
      if (order.status === 'needs-attention') failures.push(item)
    }
    sourceHealth.push(health('scheduled-work', generatedAt, scheduled.work.items.map((item) => item.updatedAt)))
  } else {
    sourceHealth.push(health('scheduled-work', generatedAt, [], 'degraded', scheduled.error))
  }

  const workflowRuns = listRuns(workspaceRootPath)
  const workflowScopes: HqOperationalScope[] = []
  for (const run of workflowRuns) {
    const scope = workflowScope(run, scheduledOrders)
    workflowScopes.push(scope)
    const item: HqOperationalItem = {
      id: run.id,
      kind: 'workflow-run',
      title: run.workflowSnapshot.metadata.name ?? run.workflowSlug,
      status: run.state,
      updatedAt: run.updatedAt,
      expiresAt: run.state === 'failed' || run.state === 'interrupted' ? addDays(run.updatedAt, 30) : undefined,
      scope,
      fingerprint: hqIntentFingerprint({ scope, title: run.workflowSnapshot.metadata.name ?? run.workflowSlug, intent: run.workflowSlug }),
      intent: run.workflowSlug,
      source: `workflow-run:${run.id}`,
    }
    if (run.state === 'created' || run.state === 'queued' || run.state === 'running') active.push(item)
    if (run.state === 'paused' || run.steps.some((step) => step.state === 'awaiting-human')) approvals.push(item)
    if (run.state === 'failed' || run.state === 'interrupted') failures.push(item)
  }
  sourceHealth.push(health('workflow-runs', generatedAt, workflowRuns.map((item) => item.updatedAt)))

  const snapshotScope = inferSnapshotScope(
    outputs.map((output) => outputScope(output.context)),
    scheduledOrders.map(orderScope),
    workflowScopes,
  )
  const automationFailures = latestAutomationFailures(workspaceRootPath, snapshotScope)
  failures.push(...automationFailures.items)
  sourceHealth.push(health('automation-history', generatedAt, automationFailures.timestamps, automationFailures.status, automationFailures.message))

  return {
    generatedAt,
    scope: snapshotScope,
    active: newestFirst(active),
    approvals: newestFirst(approvals),
    failures: newestFirst(failures),
    recentOutputs: newestFirst(outputs.slice(0, 10).map((output) => ({
      id: output.id,
      kind: 'output' as const,
      title: output.title,
      status: output.status,
      updatedAt: output.updatedAt,
      scope: outputScope(output.context),
      fingerprint: hqIntentFingerprint({
        scope: outputScope(output.context),
        worker: output.origin.agentSlug,
        title: output.title,
        intent: output.summary,
      }),
      worker: output.origin.agentSlug,
      intent: output.summary,
      source: `output:${output.id}`,
    }))),
    sourceHealth,
  }
}

function scheduledItem(order: ScheduledWorkOrder): HqOperationalItem {
  const scope = orderScope(order)
  const worker = order.execution.type === 'agent-task' ? order.execution.agentSlug : undefined
  const intent = order.execution.type === 'agent-task'
    ? order.execution.brief
    : order.execution.type === 'workflow-run'
      ? order.execution.workflowSlug
      : order.title
  return {
    id: order.id,
    kind: 'scheduled-work',
    title: order.title,
    status: order.status,
    updatedAt: order.updatedAt,
    scope,
    fingerprint: hqIntentFingerprint({ scope, worker, title: order.title, intent }),
    worker,
    intent,
    source: `scheduled-work:${order.id}`,
  }
}

function latestAutomationFailures(workspaceRootPath: string, scope: HqOperationalScope): {
  items: HqOperationalItem[]
  timestamps: string[]
  status: HqOperationalSourceHealth['status']
  message?: string
} {
  const file = join(workspaceRootPath, AUTOMATIONS_HISTORY_FILE)
  if (!existsSync(file)) return { items: [], timestamps: [], status: 'fresh' }
  let lines: string[]
  try {
    lines = readFileSync(file, 'utf8').trim().split('\n').filter(Boolean)
  } catch {
    return { items: [], timestamps: [], status: 'unavailable', message: 'Automation history could not be read.' }
  }
  const latest = new Map<string, { id: string; ts: number; ok: boolean; error?: string }>()
  let malformedLines = 0
  for (const line of lines) {
    try {
      const value = JSON.parse(line) as Record<string, unknown>
      const id = typeof value.id === 'string' ? value.id : ''
      const ts = typeof value.ts === 'number' ? value.ts : 0
      if (!id || !ts) continue
      const webhook = value.webhook && typeof value.webhook === 'object' ? value.webhook as Record<string, unknown> : undefined
      const error = typeof value.error === 'string' ? value.error : typeof webhook?.error === 'string' ? webhook.error : undefined
      const prior = latest.get(id)
      if (!prior || ts > prior.ts) latest.set(id, { id, ts, ok: value.ok === true, error })
    } catch {
      malformedLines += 1
    }
  }
  const entries = [...latest.values()]
  const names = readAutomationNames(workspaceRootPath)
  return {
    items: entries.filter((entry) => !entry.ok).map((entry) => ({
    id: entry.id,
    kind: 'automation-run',
    title: names.get(entry.id) ?? `Automation ${entry.id}`,
    status: 'failed',
    updatedAt: new Date(entry.ts).toISOString(),
    expiresAt: addDays(new Date(entry.ts).toISOString(), 14),
    scope,
    fingerprint: hqIntentFingerprint({ scope, title: names.get(entry.id) ?? `Automation ${entry.id}`, intent: entry.error }),
    intent: entry.error,
    source: `automation:${entry.id}`,
    })),
    timestamps: entries.map((entry) => new Date(entry.ts).toISOString()),
    status: malformedLines > 0 ? 'degraded' : 'fresh',
    message: malformedLines > 0 ? `${malformedLines} malformed automation history ${malformedLines === 1 ? 'entry was' : 'entries were'} ignored.` : undefined,
  }
}

function readAutomationNames(workspaceRootPath: string): Map<string, string> {
  const names = new Map<string, string>()
  const file = join(workspaceRootPath, AUTOMATIONS_CONFIG_FILE)
  if (!existsSync(file)) return names
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { automations?: Record<string, unknown> }
    for (const matchers of Object.values(parsed.automations ?? {})) {
      if (!Array.isArray(matchers)) continue
      for (const matcher of matchers) {
        if (!matcher || typeof matcher !== 'object') continue
        const value = matcher as Record<string, unknown>
        if (typeof value.id === 'string' && typeof value.name === 'string' && value.name.trim()) {
          names.set(value.id, value.name.trim())
        }
      }
    }
  } catch {
    return names
  }
  return names
}

function outputScope(context: { scope: 'hq' | 'campaign'; campaignId?: string } | undefined): HqOperationalScope {
  return context?.scope === 'campaign' && context.campaignId
    ? { type: 'campaign', campaignId: context.campaignId }
    : { type: 'hq' }
}

function orderScope(order: ScheduledWorkOrder): HqOperationalScope {
  return order.owner.scope === 'campaign'
    ? { type: 'campaign', campaignId: order.owner.campaignId ?? order.owner.workspaceId }
    : { type: 'hq' }
}

function workflowScope(run: WorkflowRunSnapshot, orders: ScheduledWorkOrder[]): HqOperationalScope {
  const linkedOrder = orders.find((order) => (
    (order.result?.type === 'workflow-run' && order.result.workflowRunId === run.id)
    || order.runs.some((jobRun) => jobRun.workflowRunId === run.id)
  ))
  if (linkedOrder) return orderScope(linkedOrder)
  const campaignId = typeof run.trigger.inputs.campaignId === 'string' ? run.trigger.inputs.campaignId : undefined
  return campaignId ? { type: 'campaign', campaignId } : { type: 'hq' }
}

function inferSnapshotScope(
  outputScopes: HqOperationalScope[],
  scheduledScopes: HqOperationalScope[],
  workflowScopes: HqOperationalScope[],
): HqOperationalScope {
  const scopes = [...scheduledScopes, ...outputScopes, ...workflowScopes]
  if (scopes.some((scope) => scope.type === 'hq')) return { type: 'hq' }
  const campaigns = new Set(scopes.flatMap((scope) => scope.type === 'campaign' ? [scope.campaignId] : []))
  return campaigns.size === 1 ? { type: 'campaign', campaignId: [...campaigns][0]! } : { type: 'hq' }
}

function addDays(value: string, days: number): string | undefined {
  const timestamp = Date.parse(value)
  return Number.isNaN(timestamp) ? undefined : new Date(timestamp + days * 24 * 60 * 60 * 1000).toISOString()
}

function health(
  source: HqOperationalSourceHealth['source'],
  checkedAt: string,
  timestamps: string[],
  status: HqOperationalSourceHealth['status'] = 'fresh',
  message?: string,
): HqOperationalSourceHealth {
  return {
    source,
    status,
    checkedAt,
    latestDataAt: [...timestamps].sort().at(-1),
    itemCount: timestamps.length,
    message,
  }
}

function readScheduledWorkspaceId(body: string | undefined): string | undefined {
  if (!body) return undefined
  const fenced = body.match(/```json\s*([\s\S]*?)```/i)?.[1]
  try {
    const value = JSON.parse(fenced ?? body) as Record<string, unknown>
    return typeof value.workspaceId === 'string' ? value.workspaceId : undefined
  } catch {
    return undefined
  }
}

function newestFirst(items: HqOperationalItem[]): HqOperationalItem[] {
  return items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}
