import type { OutputKind } from '../outputs/types.ts'
import { hqNormalizeSemanticIntentId, hqSemanticIntentId } from '../hq-state/intent.ts'
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
  | 'waiting'
  | 'scheduled'
  | 'needs-setup'
  | 'needs-approval'
  | 'running'
  | 'awaiting-review'
  | 'done'
  | 'needs-attention'
  | 'canceled'

export type WorkAttentionReason =
  | 'agent-not-active'
  | 'workflow-not-active'
  | 'workflow-changed'
  | 'profile-login-required'
  | 'asset-missing'
  | 'required-output-missing'
  | 'execution-failed'
  | 'execution-uncertain'
  | 'idempotency-unavailable'
  | 'missed-start-window'
  | 'approval-expired'
  | 'approval-invalidated'
  | 'changes-requested'
  | 'produced-output-missing'
  | 'produced-output-ambiguous'
  | 'goal-not-active'
  | 'goal-revision-changed'
  | 'continuation-disarmed'
  | 'continuation-round-limit'
  | 'continuation-state-invalid'

export interface ScheduledWorkAttention {
  reason: WorkAttentionReason
  message: string
}

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
  | { kind: 'release-kit'; itemId: string; sha256: string; label?: string }
  | { kind: 'final'; outputId: string; assetId?: string; slot?: string; label?: string }
  | { kind: 'output'; outputId: string; title?: string; outputKind?: string }
  | { kind: 'vault'; assetId: string; label?: string; assetKind?: string }
  | {
      kind: 'produced-output'
      stepId: string
      selector?: { kind?: OutputKind }
      bindTo: { kind: 'review-target' } | { kind: 'workflow-trigger'; input: string }
      resolution?: {
        outputId: string
        parentResultDigest: string
        source: 'automatic' | 'user'
        resolvedAt: string
      }
    }

export interface ScheduledWorkChainLink {
  chainId: string
  stepId: string
  ordinal: 0 | 1
  predecessor?: {
    orderId: string
    stepId: string
    releaseOn: 'success' | 'creative-approval'
  }
}

export interface ScheduledWorkContinuation {
  role: 'coordinator' | 'round'
  runId: string
  coordinatorOrderId: string
  goalSlug: string
  goalRevision: string
  objective: string
  round: number
  maxRounds: number
  runtimeId: string
  runnerFence: string
  permissionCeiling: 'safe' | 'ask'
  parentOrderId?: string
  priorRoundSessionId?: string
  priorRoundOutputIds?: string[]
}

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
      postProcess?: 'youtube-intelligence'
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
  | { type: 'agent-task'; sessionId: string; outputIds: string[]; sharedIntelContextSlugs?: string[] }
  | { type: 'workflow-run'; workflowRunId: string; outputIds: string[] }
  | { type: 'social-publish'; receipt: CampaignExternalExecutionReceipt }
  | { type: 'review'; decision: 'approved' | 'changes-requested'; notes?: string }

export interface ScheduledWorkReviewDecision {
  decision: 'approved' | 'changes-requested'
  notes?: string
  decidedAt: string
  reviewerType: 'person' | 'agent' | 'user'
  reviewerId?: string
}

export interface ScheduledSocialActionPreview {
  actionId: string
  actionDigest: string
  mediaDigest?: string
  platform: string
  profileId: string
  preparedAt: string
  payloadDigest: string
  summary?: string
  dryRun: Record<string, unknown>
}

export interface ScheduledSocialApproval {
  id: string
  approvedAt: string
  expiresAt: string
  actionId: string
  actionDigest: string
  mediaDigest?: string
  payloadDigest: string
  platform: string
  profileId: string
  approvedBy: { type: 'user'; clientId: string }
}

/** Durable host-minted authorization for one exact scheduled use. */
export interface ScheduledWorkAuthorization {
  id: string
  authorizedAt: string
  expiresAt?: string
  payloadDigest: string
  authorizedBy: {
    type: 'user'
    clientId: string
    source: 'release-kit-ui' | 'calendar-ui' | 'hnic-confirmation'
    sessionId?: string
    userMessageId?: string
  }
  definition: {
    title: string
    releaseKitRef: { itemId: string; sha256: string; label?: string }
    platform: string
    profileId: string
    accountSetId?: string
    caption: string
    platformOptions?: Record<string, unknown>
    startAt: string
    timezone: string
  }
}

export interface ScheduledWorkOrder {
  version: 1
  id: string
  owner: ScheduledWorkOwner
  calendarLink: ScheduledWorkCalendarLink
  /** Hidden automation work keeps a reserved link id but creates no calendar shell. */
  calendarVisibility?: 'visible' | 'hidden'
  title: string
  /** Stable semantic identity shared by equivalent work across separate runs. */
  intentId?: string
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
  reviewDecision?: ScheduledWorkReviewDecision
  socialAction?: ScheduledSocialActionPreview
  socialApproval?: ScheduledSocialApproval
  authorization?: ScheduledWorkAuthorization
  authorizationPolicy?: 'durable-v1'
  attention?: ScheduledWorkAttention
  executionKey: {
    payloadDigest: string
    idempotencyKey: string
  }
  chain?: ScheduledWorkChainLink
  continuation?: ScheduledWorkContinuation
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

export interface ReleaseKitItemUseSummary {
  orderId: string
  calendarItemId: string
  title: string
  platform?: string
  profileId?: string
  startAt: string
  timezone: string
  status: 'draft' | 'scheduled' | 'done' | 'needs-attention' | 'canceled'
  attentionMessage?: string
  receipt?: {
    externalUrl?: string
    completedAt: string
    summary?: string
  }
  updatedAt: string
}

export interface ScheduleCampaignWorkInput {
  order: ScheduledWorkOrder
  calendarItem: CampaignCalendarItem
}

export interface ScheduleCampaignWorkResult {
  updated: boolean
  work: ScheduledWorkDocument
  order: ScheduledWorkOrder
  calendar: CampaignCalendar
  calendarItem: CampaignCalendarItem
}

export interface CancelCampaignWorkInput {
  orderId: string
  calendarItemId: string
}

export interface CancelCampaignWorkResult {
  updated: boolean
  work: ScheduledWorkDocument
  order: ScheduledWorkOrder
  calendar: CampaignCalendar
  calendarItem: CampaignCalendarItem
}

export interface DecideCampaignWorkInput {
  orderId: string
  calendarItemId: string
  expectedUpdatedAt: string
  decision: 'approved' | 'changes-requested'
  notes?: string
}

export interface DecideCampaignWorkResult {
  work: ScheduledWorkDocument
  order: ScheduledWorkOrder
  calendar: CampaignCalendar
  calendarItem: CampaignCalendarItem
}

export interface ScheduleCampaignChainInput {
  requestId: string
  orders: [ScheduledWorkOrder, ScheduledWorkOrder]
  calendarItems: [CampaignCalendarItem, CampaignCalendarItem]
}

export interface ScheduleCampaignChainResult {
  updated: boolean
  work: ScheduledWorkDocument
  orders: [ScheduledWorkOrder, ScheduledWorkOrder]
  calendar: CampaignCalendar
  calendarItems: [CampaignCalendarItem, CampaignCalendarItem]
}

export interface ResolveCampaignProducedOutputInput {
  orderId: string
  calendarItemId: string
  expectedUpdatedAt: string
  outputId: string
}

export interface ResolveCampaignProducedOutputResult {
  work: ScheduledWorkDocument
  order: ScheduledWorkOrder
  calendar: CampaignCalendar
  calendarItem: CampaignCalendarItem
}

export interface ApproveCampaignSocialWorkInput {
  orderId: string
  calendarItemId: string
  expectedUpdatedAt: string
}

export interface ApproveCampaignSocialWorkResult {
  work: ScheduledWorkDocument
  order: ScheduledWorkOrder
  calendar: CampaignCalendar
  calendarItem: CampaignCalendarItem
}

export interface AuthorizeReleaseKitSocialInput {
  requestId: string
  releaseKitItemId: string
  title?: string
  platform: string
  profileId: string
  accountSetId?: string
  caption: string
  platformOptions?: Record<string, unknown>
  startAt: string
  timezone: string
  source?: 'release-kit-ui' | 'calendar-ui'
}

export type AuthorizeReleaseKitSocialResult = ScheduleCampaignWorkResult

export type ScheduledSocialDefinitionChangeField = 'title' | 'asset' | 'account' | 'caption' | 'options' | 'time' | 'timezone'

export interface ScheduledSocialDefinitionChange {
  field: ScheduledSocialDefinitionChangeField
  before: string
  after: string
}

export interface ReauthorizeReleaseKitSocialInput {
  orderId: string
  calendarItemId: string
  expectedUpdatedAt: string
  releaseKitItemId: string
  title: string
  platform: string
  profileId: string
  accountSetId?: string
  caption: string
  platformOptions?: Record<string, unknown>
  startAt: string
  timezone: string
}

export interface ReauthorizeReleaseKitSocialResult extends ScheduleCampaignWorkResult {
  changes: ScheduledSocialDefinitionChange[]
}

export interface ScheduleHqWorkInput {
  requestId: string
  orders: ScheduledWorkOrder[]
}

export interface ScheduleHqWorkResult {
  updated: boolean
  work: ScheduledWorkDocument
  orders: ScheduledWorkOrder[]
}

export interface ManageGoalRunInput {
  runId: string
  operation: 'rearm' | 'pause' | 'cancel'
  expectedUpdatedAt: string
  explanation: string
  requiresUserConfirmation?: boolean
  objective?: string
  maxRounds?: number
}

export interface ManageGoalRunResult {
  work: ScheduledWorkDocument
  coordinator: ScheduledWorkOrder
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

export function scheduledWorkDefinitionDigest(value: unknown): string {
  const stable = stableStringify(value)
  let hash = 0x811c9dc5
  for (let index = 0; index < stable.length; index += 1) {
    hash ^= stable.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}`
}

export function emptyScheduledWorkDocument(workspaceId: string): ScheduledWorkDocument {
  return { version: 1, workspaceId, items: [], updatedAt: new Date().toISOString() }
}

export function listReleaseKitItemUses(
  work: ScheduledWorkDocument,
  itemId: string,
  now = new Date(),
): ScheduledWorkOrder[] {
  const nowMs = now.getTime()
  return work.items
    .filter((order) => !order.deletedAt && order.inputRefs.some((ref) => (
      ref.kind === 'release-kit' && ref.itemId === itemId
    )))
    .sort((a, b) => {
      const aGroup = releaseKitUseSortGroup(a, nowMs)
      const bGroup = releaseKitUseSortGroup(b, nowMs)
      if (aGroup !== bGroup) return aGroup - bGroup
      const byDate = aGroup === 2
        ? b.startAt.localeCompare(a.startAt)
        : a.startAt.localeCompare(b.startAt)
      return byDate || a.id.localeCompare(b.id)
    })
}

export function summarizeReleaseKitItemUses(
  work: ScheduledWorkDocument,
  itemId: string,
  options: { now?: Date; limit?: number } = {},
): ReleaseKitItemUseSummary[] {
  const limit = Math.max(1, Math.min(options.limit ?? 100, 100))
  return listReleaseKitItemUses(work, itemId, options.now).slice(0, limit).map((order) => {
    const execution = order.execution.type === 'social-publish' ? order.execution : undefined
    const receipt = order.result?.type === 'social-publish' ? order.result.receipt : undefined
    return {
      orderId: order.id,
      calendarItemId: order.calendarLink.itemId,
      title: order.title,
      platform: execution?.platform,
      profileId: execution?.profileId,
      startAt: order.startAt,
      timezone: order.timezone,
      status: releaseKitUseSummaryStatus(order),
      attentionMessage: order.attention?.message
        ?? (order.status === 'done' && !receipt ? 'Artist OS could not verify completion because the publishing receipt is missing.' : undefined),
      receipt: receipt ? {
        externalUrl: receipt.externalUrl,
        completedAt: receipt.completedAt,
        summary: receipt.summary,
      } : undefined,
      updatedAt: order.updatedAt,
    }
  })
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
      ...item.releaseKitRefs.map((ref) => ({ kind: 'release-kit' as const, ...ref })),
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

function releaseKitUseSortGroup(order: ScheduledWorkOrder, nowMs: number): 0 | 1 | 2 {
  if (releaseKitUseSummaryStatus(order) === 'needs-attention') return 0
  if (order.status !== 'done' && order.status !== 'canceled' && Date.parse(order.startAt) >= nowMs) return 1
  return 2
}

function releaseKitUseSummaryStatus(order: ScheduledWorkOrder): ReleaseKitItemUseSummary['status'] {
  const { status } = order
  if (status === 'needs-approval' && order.authorizationPolicy === 'durable-v1' && order.authorization) return 'scheduled'
  if (status === 'draft' || status === 'waiting' || status === 'needs-setup' || status === 'needs-approval') return 'draft'
  if (status === 'done') return order.result?.type === 'social-publish' ? 'done' : 'needs-attention'
  if (status === 'needs-attention' || status === 'canceled') return status
  return 'scheduled'
}

function normalizeScheduledWorkOrder(value: ScheduledWorkOrder): ScheduledWorkOrder {
  const now = new Date().toISOString()
  return {
    ...value,
    version: 1,
    title: clean(value.title) ?? 'Untitled work',
    intentId: hqNormalizeSemanticIntentId(value.intentId) ?? hqSemanticIntentId({ title: value.title, intent: JSON.stringify(value.execution) }),
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
    && (order.intentId === undefined || Boolean(clean(order.intentId)))
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
    && (order.calendarVisibility === undefined || order.calendarVisibility === 'visible' || order.calendarVisibility === 'hidden')
    && isScheduledWorkExecution(order.execution, order.type)
    && Array.isArray(order.inputRefs)
    && order.inputRefs.every(isScheduledWorkInputRef)
    && Array.isArray(order.approvals)
    && Array.isArray(order.runs)
    && (order.result === undefined || isScheduledWorkResult(order.result, order.type))
    && (order.reviewDecision === undefined || isScheduledWorkReviewDecision(order.reviewDecision))
    && (order.socialAction === undefined || isScheduledSocialActionPreview(order.socialAction))
    && (order.socialApproval === undefined || isScheduledSocialApproval(order.socialApproval))
    && (order.authorization === undefined || isScheduledWorkAuthorization(order.authorization))
    && (order.authorizationPolicy === undefined || order.authorizationPolicy === 'durable-v1')
    && (order.authorization === undefined || (order.authorizationPolicy === 'durable-v1' && order.execution?.type === 'social-publish'))
    && (order.authorizationPolicy === undefined || order.authorization !== undefined)
    && (order.attention === undefined || isScheduledWorkAttention(order.attention))
    && (order.chain === undefined || isScheduledWorkChainLink(order.chain))
    && (order.continuation === undefined || isScheduledWorkContinuation(order.continuation, order))
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
    || value === 'waiting'
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
      && (execution.postProcess === undefined || execution.postProcess === 'youtube-intelligence')
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
  if (ref.kind === 'release-kit') {
    return Boolean(clean(ref.itemId)) && /^[a-f0-9]{64}$/i.test(clean(ref.sha256) ?? '')
  }
  if (ref.kind === 'final' || ref.kind === 'output') return Boolean(clean(ref.outputId))
  if (ref.kind === 'vault') return Boolean(clean(ref.assetId))
  if (ref.kind !== 'produced-output' || !clean(ref.stepId) || !ref.bindTo) return false
  const validBinding = ref.bindTo.kind === 'review-target'
    || (ref.bindTo.kind === 'workflow-trigger' && Boolean(clean(ref.bindTo.input)))
  const validResolution = ref.resolution === undefined
    || (Boolean(clean(ref.resolution.outputId))
      && Boolean(clean(ref.resolution.parentResultDigest))
      && (ref.resolution.source === 'automatic' || ref.resolution.source === 'user')
      && Boolean(cleanIso(ref.resolution.resolvedAt)))
  return validBinding && validResolution
}

function isScheduledWorkChainLink(value: unknown): value is ScheduledWorkChainLink {
  if (!value || typeof value !== 'object') return false
  const chain = value as Partial<ScheduledWorkChainLink>
  const predecessor = chain.predecessor
  return Boolean(clean(chain.chainId))
    && Boolean(clean(chain.stepId))
    && (chain.ordinal === 0 || chain.ordinal === 1)
    && (predecessor === undefined || Boolean(
      clean(predecessor.orderId)
      && clean(predecessor.stepId)
      && (predecessor.releaseOn === 'success' || predecessor.releaseOn === 'creative-approval'),
    ))
}

function isScheduledWorkContinuation(value: unknown, order: Partial<ScheduledWorkOrder>): value is ScheduledWorkContinuation {
  if (!value || typeof value !== 'object') return false
  const continuation = value as Partial<ScheduledWorkContinuation>
  if (order.type !== 'agent-task' || order.execution?.type !== 'agent-task') return false
  if (continuation.role !== 'coordinator' && continuation.role !== 'round') return false
  if (!clean(continuation.runId) || !clean(continuation.coordinatorOrderId)
    || !clean(continuation.goalSlug) || !clean(continuation.goalRevision)
    || !clean(continuation.objective) || !clean(continuation.runtimeId) || !clean(continuation.runnerFence)) return false
  if (!Number.isInteger(continuation.maxRounds) || continuation.maxRounds! < 2 || continuation.maxRounds! > 8) return false
  if (!Number.isInteger(continuation.round) || continuation.round! < 0 || continuation.round! > continuation.maxRounds!) return false
  if (continuation.permissionCeiling !== 'safe' && continuation.permissionCeiling !== 'ask') return false
  if (continuation.priorRoundSessionId !== undefined && !clean(continuation.priorRoundSessionId)) return false
  if (continuation.priorRoundOutputIds !== undefined
    && (!Array.isArray(continuation.priorRoundOutputIds)
      || continuation.priorRoundOutputIds.some((id) => !clean(id)))) return false
  if (continuation.permissionCeiling !== 'safe') return false
  if (order.execution.permissionMode !== continuation.permissionCeiling
    || order.execution.expectedOutput.requirement !== 'required') return false
  if (continuation.role === 'coordinator') {
    return continuation.round === 0
      && continuation.coordinatorOrderId === order.id
      && continuation.parentOrderId === undefined
      && order.status !== 'scheduled'
      && order.status !== 'running'
  }
  return continuation.round! >= 1
    && continuation.coordinatorOrderId !== order.id
    && order.calendarVisibility === 'hidden'
    && (continuation.round === 1
      ? continuation.parentOrderId === continuation.coordinatorOrderId
      : Boolean(clean(continuation.parentOrderId)))
}

function isScheduledWorkResult(value: unknown, type: ScheduledWorkType): value is ScheduledWorkResult {
  if (!value || typeof value !== 'object') return false
  const result = value as Partial<ScheduledWorkResult>
  if (result.type !== type) return false
  if (result.type === 'agent-task') return Boolean(clean(result.sessionId))
    && Array.isArray(result.outputIds)
    && (result.sharedIntelContextSlugs === undefined || (Array.isArray(result.sharedIntelContextSlugs) && result.sharedIntelContextSlugs.every((slug) => Boolean(clean(slug)))))
  if (result.type === 'workflow-run') return Boolean(clean(result.workflowRunId)) && Array.isArray(result.outputIds)
  if (result.type === 'social-publish') return isExternalExecutionReceipt(result.receipt)
  return result.type === 'review' && (result.decision === 'approved' || result.decision === 'changes-requested')
}

function isExternalExecutionReceipt(value: unknown): value is CampaignExternalExecutionReceipt {
  if (!value || typeof value !== 'object') return false
  const receipt = value as Partial<CampaignExternalExecutionReceipt>
  return Boolean(clean(receipt.id)
    && receipt.actionType === 'post-asset'
    && cleanIso(receipt.completedAt)
    && clean(receipt.payloadDigest)
    && clean(receipt.approvalId)
    && (receipt.externalUrl === undefined || clean(receipt.externalUrl))
    && (receipt.summary === undefined || clean(receipt.summary)))
}

function isScheduledWorkAttention(value: unknown): value is ScheduledWorkAttention {
  if (!value || typeof value !== 'object') return false
  const attention = value as Partial<ScheduledWorkAttention>
  return (attention.reason === 'agent-not-active'
    || attention.reason === 'workflow-not-active'
    || attention.reason === 'workflow-changed'
    || attention.reason === 'profile-login-required'
    || attention.reason === 'asset-missing'
    || attention.reason === 'required-output-missing'
    || attention.reason === 'execution-failed'
    || attention.reason === 'execution-uncertain'
    || attention.reason === 'idempotency-unavailable'
    || attention.reason === 'missed-start-window'
    || attention.reason === 'approval-expired'
    || attention.reason === 'approval-invalidated'
    || attention.reason === 'changes-requested'
    || attention.reason === 'produced-output-missing'
    || attention.reason === 'produced-output-ambiguous'
    || attention.reason === 'goal-not-active'
    || attention.reason === 'goal-revision-changed'
    || attention.reason === 'continuation-disarmed'
    || attention.reason === 'continuation-round-limit'
    || attention.reason === 'continuation-state-invalid')
    && Boolean(clean(attention.message))
}

function isScheduledWorkReviewDecision(value: unknown): value is ScheduledWorkReviewDecision {
  if (!value || typeof value !== 'object') return false
  const decision = value as Partial<ScheduledWorkReviewDecision>
  return (decision.decision === 'approved' || decision.decision === 'changes-requested')
    && (decision.reviewerType === 'person' || decision.reviewerType === 'agent' || decision.reviewerType === 'user')
    && Boolean(cleanIso(decision.decidedAt))
}

function isScheduledSocialActionPreview(value: unknown): value is ScheduledSocialActionPreview {
  if (!value || typeof value !== 'object') return false
  const preview = value as Partial<ScheduledSocialActionPreview>
  return Boolean(clean(preview.actionId)
    && clean(preview.actionDigest)
    && clean(preview.platform)
    && clean(preview.profileId)
    && cleanIso(preview.preparedAt)
    && clean(preview.payloadDigest)
    && preview.dryRun
    && typeof preview.dryRun === 'object'
    && !Array.isArray(preview.dryRun))
}

function isScheduledSocialApproval(value: unknown): value is ScheduledSocialApproval {
  if (!value || typeof value !== 'object') return false
  const approval = value as Partial<ScheduledSocialApproval>
  return Boolean(clean(approval.id)
    && cleanIso(approval.approvedAt)
    && cleanIso(approval.expiresAt)
    && clean(approval.actionId)
    && clean(approval.actionDigest)
    && clean(approval.payloadDigest)
    && clean(approval.platform)
    && clean(approval.profileId)
    && approval.approvedBy?.type === 'user'
    && Boolean(clean(approval.approvedBy.clientId)))
}

export function isScheduledWorkAuthorization(value: unknown): value is ScheduledWorkAuthorization {
  if (!value || typeof value !== 'object') return false
  const authorization = value as Partial<ScheduledWorkAuthorization>
  const definition = authorization.definition
  const authorizedBy = authorization.authorizedBy
  return Boolean(clean(authorization.id)
    && cleanIso(authorization.authorizedAt)
    && (authorization.expiresAt === undefined || cleanIso(authorization.expiresAt))
    && clean(authorization.payloadDigest)
    && authorizedBy?.type === 'user'
    && clean(authorizedBy.clientId)
    && (authorizedBy.source === 'release-kit-ui' || authorizedBy.source === 'calendar-ui' || authorizedBy.source === 'hnic-confirmation')
    && (authorizedBy.sessionId === undefined || clean(authorizedBy.sessionId))
    && (authorizedBy.userMessageId === undefined || clean(authorizedBy.userMessageId))
    && definition
    && clean(definition.title)
    && clean(definition.releaseKitRef?.itemId)
    && /^[a-f0-9]{64}$/i.test(clean(definition.releaseKitRef?.sha256) ?? '')
    && clean(definition.platform)
    && clean(definition.profileId)
    && clean(definition.caption)
    && cleanIso(definition.startAt)
    && clean(definition.timezone)
    && (definition.platformOptions === undefined
      || (typeof definition.platformOptions === 'object' && !Array.isArray(definition.platformOptions))))
}

function pickPlatformOptions(payload: Record<string, unknown>): Record<string, unknown> | undefined {
  const options: Record<string, unknown> = {}
  for (const key of ['postType', 'visibility', 'madeForKids']) {
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

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
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
