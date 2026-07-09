import type { OutputKind } from '../outputs/types.ts'
import type { ContextDocMetadata, LoadedContextDoc } from '../workspace-context/types.ts'
import type {
  CampaignCalendar,
  CampaignCalendarItem,
  CampaignCalendarItemStatus,
  CampaignExternalExecutionReceipt,
  CampaignJobRun,
  CampaignScheduleApproval,
  CampaignScheduledJob,
} from '../campaign-calendar/index.ts'

export const SCHEDULED_WORK_CONTEXT_SLUG = 'scheduled-work'

export type ScheduledWorkScope = 'hq' | 'campaign'
export type ScheduledWorkType = 'agent-task' | 'workflow-run' | 'social-publish' | 'review'
export type ScheduledWorkStatus =
  | 'draft'
  | 'scheduled'
  | 'needs-setup'
  | 'needs-approval'
  | 'running'
  | 'awaiting-review'
  | 'done'
  | 'needs-attention'
  | 'canceled'

export interface ScheduledWorkOwner {
  scope: ScheduledWorkScope
  workspaceId: string
  campaignId?: string
}

export interface ScheduledWorkCalendarLink {
  calendar: 'hq' | 'campaign'
  itemId: string
}

export type ScheduledWorkInputRef =
  | { kind: 'final'; outputId: string; assetId?: string; slot?: string; label?: string }
  | { kind: 'output'; outputId: string; title?: string; outputKind?: string }
  | { kind: 'produced-output'; stepId: string; selector?: { kind?: OutputKind } }

export interface ExpectedOutputContract {
  requirement: 'none' | 'optional' | 'required'
  kind?: OutputKind
  title?: string
  minimumCount?: number
  reviewRequired?: boolean
}

export type ScheduledWorkExecution =
  | {
      type: 'agent-task'
      agentSlug: string
      brief: string
      permissionMode: 'safe' | 'ask'
      expectedOutput: ExpectedOutputContract
    }
  | {
      type: 'workflow-run'
      workflowSlug: string
      workflowDigest: string
      triggerInputs: Record<string, unknown>
    }
  | {
      type: 'social-publish'
      platform: string
      profileId: string
      accountSetId?: string
      caption: string
      platformOptions?: Record<string, unknown>
    }
  | {
      type: 'review'
      reviewerType: 'person' | 'agent' | 'user'
      reviewerId?: string
      decisionDueAt?: string
    }

export type ScheduledWorkResult =
  | { type: 'agent-task'; sessionId: string; outputIds: string[] }
  | { type: 'workflow-run'; workflowRunId: string; outputIds: string[] }
  | { type: 'social-publish'; receipt: CampaignExternalExecutionReceipt }
  | { type: 'review'; decision: 'approved' | 'changes-requested'; notes?: string }

export interface ScheduledWorkOrder {
  version: 1
  id: string
  owner: ScheduledWorkOwner
  calendarLink: ScheduledWorkCalendarLink
  title: string
  type: ScheduledWorkType
  status: ScheduledWorkStatus
  startAt: string
  dueAt?: string
  timezone: string
  execution: ScheduledWorkExecution
  inputRefs: ScheduledWorkInputRef[]
  approvals: CampaignScheduleApproval[]
  runs: CampaignJobRun[]
  result?: ScheduledWorkResult
  executionKey: {
    payloadDigest: string
    idempotencyKey: string
  }
  legacyRef?: {
    campaignItemId: string
    campaignJobId: string
  }
  createdAt: string
  updatedAt: string
  deletedAt?: string
}

export interface ScheduledWorkDocument {
  version: 1
  workspaceId: string
  items: ScheduledWorkOrder[]
  updatedAt: string
}

export type ScheduledWorkParseResult =
  | { ok: true; work: ScheduledWorkDocument }
  | { ok: false; work: ScheduledWorkDocument; error: string }

export type ScheduledWorkMutation =
  | { operation: 'upsert'; order: ScheduledWorkOrder; expectedUpdatedAt: string | null }
  | { operation: 'cancel' | 'delete'; id: string; expectedUpdatedAt: string }

export type ScheduledWorkMutationResult =
  | { ok: true; work: ScheduledWorkDocument; item: ScheduledWorkOrder }
  | { ok: false; work: ScheduledWorkDocument; error: string }

export function scheduledWorkMetadata(): ContextDocMetadata {
  return {
    name: 'Scheduled Work',
    description: 'Workspace-owned one-shot agent, workflow, review, and publishing work orders.',
    routing: { mode: 'broadcast' },
    enabled: true,
  }
}

export function emptyScheduledWorkDocument(workspaceId: string): ScheduledWorkDocument {
  return { version: 1, workspaceId, items: [], updatedAt: new Date().toISOString() }
}

export function parseScheduledWorkDocResult(
  doc: Pick<LoadedContextDoc, 'body'> | undefined,
  workspaceId: string,
): ScheduledWorkParseResult {
  if (!doc) return { ok: true, work: emptyScheduledWorkDocument(workspaceId) }
  const json = extractJson(doc.body)
  if (!json) {
    return { ok: false, work: emptyScheduledWorkDocument(workspaceId), error: 'Scheduled Work JSON block is missing.' }
  }
  try {
    const parsed = JSON.parse(json) as Partial<ScheduledWorkDocument>
    if (parsed.version !== 1 || !Array.isArray(parsed.items)) {
      return { ok: false, work: emptyScheduledWorkDocument(workspaceId), error: 'Scheduled Work JSON has an unsupported shape.' }
    }
    const parsedWorkspaceId = clean(parsed.workspaceId)
    if (parsedWorkspaceId && parsedWorkspaceId !== workspaceId) {
      return { ok: false, work: emptyScheduledWorkDocument(workspaceId), error: `Scheduled Work belongs to workspace ${parsedWorkspaceId}, not ${workspaceId}.` }
    }
    const invalidIndex = parsed.items.findIndex((item) => !isScheduledWorkOrder(item))
    if (invalidIndex >= 0) {
      return { ok: false, work: emptyScheduledWorkDocument(workspaceId), error: `Scheduled Work item ${invalidIndex + 1} is invalid.` }
    }
    return {
      ok: true,
      work: {
        version: 1,
        workspaceId,
        items: parsed.items.map((item) => normalizeScheduledWorkOrder(item as ScheduledWorkOrder)),
        updatedAt: cleanIso(parsed.updatedAt) ?? new Date().toISOString(),
      },
    }
  } catch {
    return { ok: false, work: emptyScheduledWorkDocument(workspaceId), error: 'Scheduled Work JSON is malformed.' }
  }
}

export function serializeScheduledWorkBody(work: ScheduledWorkDocument): string {
  const sorted = {
    version: 1,
    workspaceId: work.workspaceId,
    items: [...work.items].sort((a, b) => a.startAt.localeCompare(b.startAt)),
    updatedAt: new Date().toISOString(),
  }
  return [
    'This document stores workspace-owned executable one-shot work. Calendar docs may link to these ids but are not the execution source of truth.',
    '',
    '```json',
    JSON.stringify(sorted, null, 2),
    '```',
  ].join('\n')
}

export function applyScheduledWorkMutation(
  work: ScheduledWorkDocument,
  mutation: ScheduledWorkMutation,
  now = new Date().toISOString(),
): ScheduledWorkMutationResult {
  if (mutation.operation === 'upsert') {
    if (!isScheduledWorkOrder(mutation.order)) {
      return { ok: false, work, error: 'Scheduled work order is invalid.' }
    }
    if (mutation.order.owner.workspaceId !== work.workspaceId) {
      return { ok: false, work, error: `Scheduled work order belongs to workspace ${mutation.order.owner.workspaceId}, not ${work.workspaceId}.` }
    }
    const item = normalizeScheduledWorkOrder({ ...mutation.order, updatedAt: now })
    const existingIndex = work.items.findIndex((candidate) => candidate.id === item.id)
    const existing = existingIndex >= 0 ? work.items[existingIndex] : undefined
    if (!matchesExpectedVersion(existing, mutation.expectedUpdatedAt)) {
      return { ok: false, work, error: `Scheduled work order changed before this update: ${item.id}` }
    }
    const items = existingIndex >= 0
      ? work.items.map((candidate, index) => index === existingIndex ? item : candidate)
      : [...work.items, item]
    return { ok: true, work: { ...work, items, updatedAt: now }, item }
  }
  if (mutation.operation !== 'cancel' && mutation.operation !== 'delete') {
    return { ok: false, work, error: 'Scheduled work mutation is invalid.' }
  }
  const existing = work.items.find((candidate) => candidate.id === mutation.id && !candidate.deletedAt)
  if (!existing) return { ok: false, work, error: `Scheduled work order not found: ${mutation.id}` }
  if (existing.updatedAt !== mutation.expectedUpdatedAt) {
    return { ok: false, work, error: `Scheduled work order changed before this update: ${mutation.id}` }
  }
  const item = normalizeScheduledWorkOrder({
    ...existing,
    status: mutation.operation === 'cancel' ? 'canceled' : existing.status,
    deletedAt: mutation.operation === 'delete' ? now : existing.deletedAt,
    updatedAt: now,
  })
  return {
    ok: true,
    work: {
      ...work,
      items: work.items.map((candidate) => candidate.id === item.id ? item : candidate),
      updatedAt: now,
    },
    item,
  }
}

export function migrateCampaignCalendarJobs(
  calendar: CampaignCalendar,
  work: ScheduledWorkDocument,
): { calendar: CampaignCalendar; work: ScheduledWorkDocument; migrated: number } {
  const existingJobIds = new Set(work.items.map((item) => item.legacyRef?.campaignJobId).filter(Boolean))
  const nextWorkItems = [...work.items]
  let migrated = 0
  const nextCalendarItems = calendar.items.map((item) => {
    if (!item.job) return item
    const existing = nextWorkItems.find((candidate) => candidate.legacyRef?.campaignJobId === item.job?.id)
    if (item.scheduledWorkId && existing) return item
    if (existing) return { ...item, scheduledWorkId: existing.id }
    if (existingJobIds.has(item.job.id)) return item
    const order = workOrderFromCampaignItem(calendar.campaignId, item, item.job)
    if (!order) return item
    nextWorkItems.push(order)
    existingJobIds.add(item.job.id)
    migrated += 1
    return { ...item, scheduledWorkId: order.id }
  })
  if (migrated === 0 && nextCalendarItems.every((item, index) => item === calendar.items[index])) {
    return { calendar, work, migrated: 0 }
  }
  const now = new Date().toISOString()
  return {
    calendar: { ...calendar, items: nextCalendarItems, updatedAt: now },
    work: { ...work, workspaceId: calendar.campaignId, items: nextWorkItems, updatedAt: now },
    migrated,
  }
}

function workOrderFromCampaignItem(
  campaignId: string,
  item: CampaignCalendarItem,
  job: CampaignScheduledJob,
): ScheduledWorkOrder | undefined {
  const execution = executionFromCampaignItem(item, job)
  if (!execution) return undefined
  const type = execution.type
  return normalizeScheduledWorkOrder({
    version: 1,
    id: item.scheduledWorkId ?? `scheduled-work-${job.id}`,
    owner: { scope: 'campaign', workspaceId: campaignId, campaignId },
    calendarLink: { calendar: 'campaign', itemId: item.id },
    title: item.title,
    type,
    status: statusFromCampaignStatus(item.status),
    startAt: job.runAt,
    timezone: job.timezone || item.timezone,
    execution,
    inputRefs: [
      ...item.finalRefs.map((ref) => ({ kind: 'final' as const, ...ref })),
      ...item.outputRefs.map((ref) => ({ kind: 'output' as const, outputId: ref.outputId, title: ref.title, outputKind: ref.kind })),
    ],
    approvals: item.approvals ?? [],
    runs: item.runHistory,
    result: resultFromRuns(type, item.runHistory),
    executionKey: { payloadDigest: job.payloadDigest, idempotencyKey: job.idempotencyKey },
    legacyRef: { campaignItemId: item.id, campaignJobId: job.id },
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    deletedAt: item.deletedAt,
  })
}

function executionFromCampaignItem(
  item: CampaignCalendarItem,
  job: CampaignScheduledJob,
): ScheduledWorkExecution | undefined {
  if (job.actionType === 'run-workflow') {
    const workflowSlug = readString(job.payload, 'workflowSlug')
    const workflowDigest = readString(job.payload, 'workflowDigest')
    if (!workflowSlug || !workflowDigest) return undefined
    return {
      type: 'workflow-run',
      workflowSlug,
      workflowDigest,
      triggerInputs: readRecord(job.payload, 'triggerInputs') ?? {},
    }
  }
  if (job.actionType === 'post-asset') {
    const profile = (item.socialProfileRefs ?? []).filter((ref) => ref.platform && ref.profileId)
    const caption = readString(job.payload, 'caption') ?? readString(job.payload, 'text')
    if (profile.length !== 1 || !caption) return undefined
    return {
      type: 'social-publish',
      platform: profile[0]!.platform,
      profileId: profile[0]!.profileId!,
      accountSetId: item.accountSetId,
      caption,
      platformOptions: pickPlatformOptions(job.payload),
    }
  }
  if (job.actionType === 'review') {
    return { type: 'review', reviewerType: 'user' }
  }
  if (job.actionType === 'outreach-batch') return undefined
  const brief = readString(job.payload, 'prompt')
  const agentSlug = readString(job.payload, 'agentSlug')
  if (!brief || !agentSlug) return undefined
  return {
    type: 'agent-task',
    agentSlug,
    brief,
    permissionMode: readPermissionMode(job.payload),
    expectedOutput: { requirement: 'none' },
  }
}

function resultFromRuns(type: ScheduledWorkType, runs: CampaignJobRun[]): ScheduledWorkResult | undefined {
  const done = [...runs].reverse().find((run) => run.status === 'done')
  if (!done) return undefined
  if (type === 'agent-task' && done.sessionId) return { type, sessionId: done.sessionId, outputIds: [] }
  if (type === 'workflow-run' && done.workflowRunId) return { type, workflowRunId: done.workflowRunId, outputIds: [] }
  if (type === 'social-publish' && done.externalReceipt) return { type, receipt: done.externalReceipt }
  return undefined
}

function statusFromCampaignStatus(status: CampaignCalendarItemStatus): ScheduledWorkStatus {
  if (status === 'failed' || status === 'missed') return 'needs-attention'
  if (status === 'done' || status === 'running' || status === 'scheduled' || status === 'needs-approval' || status === 'draft' || status === 'canceled') return status
  return 'scheduled'
}

function normalizeScheduledWorkOrder(value: ScheduledWorkOrder): ScheduledWorkOrder {
  const now = new Date().toISOString()
  return {
    ...value,
    version: 1,
    title: clean(value.title) ?? 'Untitled work',
    startAt: cleanIso(value.startAt) ?? now,
    dueAt: cleanIso(value.dueAt),
    timezone: clean(value.timezone) ?? 'UTC',
    inputRefs: Array.isArray(value.inputRefs) ? value.inputRefs : [],
    approvals: Array.isArray(value.approvals) ? value.approvals : [],
    runs: Array.isArray(value.runs) ? value.runs : [],
    createdAt: cleanIso(value.createdAt) ?? now,
    updatedAt: cleanIso(value.updatedAt) ?? now,
    deletedAt: cleanIso(value.deletedAt),
  }
}

function isScheduledWorkOrder(value: unknown): value is ScheduledWorkOrder {
  if (!value || typeof value !== 'object') return false
  const order = value as Partial<ScheduledWorkOrder>
  return order.version === 1
    && Boolean(clean(order.id))
    && Boolean(clean(order.title))
    && Boolean(cleanIso(order.startAt))
    && (order.dueAt === undefined || Boolean(cleanIso(order.dueAt)))
    && Boolean(clean(order.timezone))
    && isScheduledWorkType(order.type)
    && isScheduledWorkStatus(order.status)
    && Boolean(order.owner
      && (order.owner.scope === 'hq' || order.owner.scope === 'campaign')
      && Boolean(clean(order.owner.workspaceId))
      && order.owner.scope === order.calendarLink?.calendar
      && (order.owner.scope === 'campaign'
        ? clean(order.owner.campaignId) === clean(order.owner.workspaceId)
        : order.owner.campaignId === undefined))
    && Boolean(order.calendarLink
      && (order.calendarLink.calendar === 'hq' || order.calendarLink.calendar === 'campaign')
      && Boolean(clean(order.calendarLink.itemId)))
    && isScheduledWorkExecution(order.execution, order.type)
    && Array.isArray(order.inputRefs)
    && order.inputRefs.every(isScheduledWorkInputRef)
    && Array.isArray(order.approvals)
    && Array.isArray(order.runs)
    && (order.result === undefined || isScheduledWorkResult(order.result, order.type))
    && Boolean(order.executionKey
      && clean(order.executionKey.payloadDigest)
      && clean(order.executionKey.idempotencyKey))
    && Boolean(cleanIso(order.createdAt))
    && Boolean(cleanIso(order.updatedAt))
    && (order.deletedAt === undefined || Boolean(cleanIso(order.deletedAt)))
}

function isScheduledWorkType(value: unknown): value is ScheduledWorkType {
  return value === 'agent-task' || value === 'workflow-run' || value === 'social-publish' || value === 'review'
}

function isScheduledWorkStatus(value: unknown): value is ScheduledWorkStatus {
  return value === 'draft'
    || value === 'scheduled'
    || value === 'needs-setup'
    || value === 'needs-approval'
    || value === 'running'
    || value === 'awaiting-review'
    || value === 'done'
    || value === 'needs-attention'
    || value === 'canceled'
}

function isScheduledWorkExecution(value: unknown, type: ScheduledWorkType): value is ScheduledWorkExecution {
  if (!value || typeof value !== 'object') return false
  const execution = value as Partial<ScheduledWorkExecution>
  if (execution.type !== type) return false
  if (execution.type === 'agent-task') {
    return Boolean(clean(execution.agentSlug))
      && Boolean(clean(execution.brief))
      && (execution.permissionMode === 'safe' || execution.permissionMode === 'ask')
      && Boolean(execution.expectedOutput
        && (execution.expectedOutput.requirement === 'none'
          || execution.expectedOutput.requirement === 'optional'
          || execution.expectedOutput.requirement === 'required'))
  }
  if (execution.type === 'workflow-run') {
    return Boolean(clean(execution.workflowSlug))
      && Boolean(clean(execution.workflowDigest))
      && Boolean(execution.triggerInputs && typeof execution.triggerInputs === 'object' && !Array.isArray(execution.triggerInputs))
  }
  if (execution.type === 'social-publish') {
    return Boolean(clean(execution.platform))
      && Boolean(clean(execution.profileId))
      && Boolean(clean(execution.caption))
  }
  return execution.type === 'review'
    && (execution.reviewerType === 'person' || execution.reviewerType === 'agent' || execution.reviewerType === 'user')
}

function matchesExpectedVersion(existing: ScheduledWorkOrder | undefined, expectedUpdatedAt: string | null): boolean {
  return existing ? existing.updatedAt === expectedUpdatedAt : expectedUpdatedAt === null
}

function isScheduledWorkInputRef(value: unknown): value is ScheduledWorkInputRef {
  if (!value || typeof value !== 'object') return false
  const ref = value as Partial<ScheduledWorkInputRef>
  if (ref.kind === 'final' || ref.kind === 'output') return Boolean(clean(ref.outputId))
  return ref.kind === 'produced-output' && Boolean(clean(ref.stepId))
}

function isScheduledWorkResult(value: unknown, type: ScheduledWorkType): value is ScheduledWorkResult {
  if (!value || typeof value !== 'object') return false
  const result = value as Partial<ScheduledWorkResult>
  if (result.type !== type) return false
  if (result.type === 'agent-task') return Boolean(clean(result.sessionId)) && Array.isArray(result.outputIds)
  if (result.type === 'workflow-run') return Boolean(clean(result.workflowRunId)) && Array.isArray(result.outputIds)
  if (result.type === 'social-publish') return Boolean(result.receipt && typeof result.receipt === 'object')
  return result.type === 'review' && (result.decision === 'approved' || result.decision === 'changes-requested')
}

function pickPlatformOptions(payload: Record<string, unknown>): Record<string, unknown> | undefined {
  const options: Record<string, unknown> = {}
  for (const key of ['postType', 'visibility']) {
    if (payload[key] !== undefined) options[key] = payload[key]
  }
  return Object.keys(options).length > 0 ? options : undefined
}

function readString(value: Record<string, unknown>, key: string): string | undefined {
  return typeof value[key] === 'string' ? clean(value[key] as string) : undefined
}

function readRecord(value: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const child = value[key]
  return child && typeof child === 'object' && !Array.isArray(child) ? child as Record<string, unknown> : undefined
}

function readPermissionMode(payload: Record<string, unknown>): 'safe' | 'ask' {
  return payload.permissionMode === 'safe' ? 'safe' : 'ask'
}

function extractJson(body: string): string | undefined {
  const fenced = body.match(/```json\s*([\s\S]*?)```/i)
  if (fenced?.[1]) return fenced[1]
  const first = body.indexOf('{')
  const last = body.lastIndexOf('}')
  return first >= 0 && last > first ? body.slice(first, last + 1) : undefined
}

function clean(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

function cleanIso(value: unknown): string | undefined {
  const cleaned = clean(value)
  if (!cleaned || Number.isNaN(Date.parse(cleaned))) return undefined
  return new Date(cleaned).toISOString()
}
