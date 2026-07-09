import type {
  ExpectedOutputContract,
  ScheduleCampaignWorkInput,
  ScheduledWorkInputRef,
  ScheduledWorkOwner,
  ScheduledWorkOrder,
} from '@craft-agent/shared/scheduled-work'
import { scheduledWorkDefinitionDigest } from '@craft-agent/shared/scheduled-work'
import { createCampaignCalendarItem } from '@craft-agent/shared/campaign-calendar'

export type ScheduledWorkComposerType = 'event' | 'agent-task' | 'workflow-run' | 'social-publish' | 'review'

interface ComposerBase {
  requestId: string
  owner: ScheduledWorkOwner
  title: string
  date: string
  time: string
  dueDate: string
  dueTime: string
  timezone: string
  notes: string
}

export interface EventComposerDraft extends ComposerBase {
  type: 'event'
  endTime: string
}

interface WorkComposerBase extends ComposerBase {
  inputRefs: ScheduledWorkInputRef[]
}

export interface AgentTaskComposerDraft extends WorkComposerBase {
  type: 'agent-task'
  agentSlug: string
  agentName: string
  brief: string
  permissionMode: 'safe' | 'ask'
  expectedOutput: ExpectedOutputContract
}

export interface WorkflowRunComposerDraft extends WorkComposerBase {
  type: 'workflow-run'
  workflowSlug: string
  workflowName: string
  workflowDigest: string
  triggerInputs: Record<string, unknown>
}

export interface SocialPublishComposerDraft extends WorkComposerBase {
  type: 'social-publish'
  platform: string
  profileId: string
  profileLabel: string
  accountSetId: string
  caption: string
  platformOptions: Record<string, unknown>
}

export interface ReviewComposerDraft extends WorkComposerBase {
  type: 'review'
  reviewerType: 'person' | 'agent' | 'user'
  reviewerId: string
  reviewerName: string
}

export type ScheduledWorkComposerDraft =
  | EventComposerDraft
  | AgentTaskComposerDraft
  | WorkflowRunComposerDraft
  | SocialPublishComposerDraft
  | ReviewComposerDraft

export interface ComposerDefaults {
  owner: ScheduledWorkOwner
  date: string
  timezone?: string
  title?: string
  inputRefs?: ScheduledWorkInputRef[]
  suggestedType?: ScheduledWorkComposerType
}

export function createScheduledWorkComposerDraft(defaults: ComposerDefaults): ScheduledWorkComposerDraft {
  const base: ComposerBase = {
    requestId: crypto.randomUUID(),
    owner: defaults.owner,
    title: defaults.title ?? '',
    date: defaults.date,
    time: '',
    dueDate: '',
    dueTime: '',
    timezone: defaults.timezone ?? localTimezone(),
    notes: '',
  }
  return draftForType(base, defaults.suggestedType ?? 'event', defaults.inputRefs ?? [])
}

export function selectScheduledWorkComposerType(
  draft: ScheduledWorkComposerDraft,
  type: ScheduledWorkComposerType,
): ScheduledWorkComposerDraft {
  if (draft.type === type) return draft
  const inputRefs = draft.type === 'event' ? [] : draft.inputRefs
  return draftForType(commonFields(draft), type, inputRefs)
}

export function composerReviewSentence(draft: ScheduledWorkComposerDraft): string {
  const when = formatWhen(draft)
  if (draft.type === 'event') {
    return draft.title.trim()
      ? `${draft.title.trim()} will be added to the calendar${when ? ` ${when}` : ''}.`
      : 'Add the event details to continue.'
  }
  if (draft.type === 'agent-task') {
    const agent = draft.agentName || 'The selected agent'
    const output = draft.expectedOutput.requirement === 'required'
      ? ` and must produce ${draft.expectedOutput.title || articleForKind(draft.expectedOutput.kind)}`
      : ''
    return `${agent} will start${when ? ` ${when}` : ''}${output} before this work is marked done.`
  }
  if (draft.type === 'workflow-run') {
    return `${draft.workflowName || 'The selected workflow'} will run${when ? ` ${when}` : ''}.`
  }
  if (draft.type === 'social-publish') {
    const target = draft.profileLabel || 'the selected social profile'
    return `The selected asset will be prepared for ${target}${when ? ` ${when}` : ''}. Exact approval is required before publishing.`
  }
  return `Review will be requested from ${draft.reviewerName || 'the selected reviewer'}${when ? ` ${when}` : ''}.`
}

export function validateComposerDraft(draft: ScheduledWorkComposerDraft): string | undefined {
  if (!draft.title.trim()) return 'Add a title.'
  if (!draft.date) return 'Choose a date.'
  if (draft.type === 'event') return undefined
  if (!draft.time) return 'Choose a start time.'
  if (draft.type === 'agent-task') {
    if (!draft.agentSlug) return 'Choose an active agent.'
    if (!draft.brief.trim()) return 'Add a clear brief.'
  }
  if (draft.type === 'workflow-run' && !draft.workflowSlug) return 'Choose an active workflow.'
  if (draft.type === 'social-publish') {
    if (!draft.profileId) return 'Choose one ready social profile.'
    if (!draft.caption.trim()) return 'Add the final caption.'
    if (draft.inputRefs.length !== 1 || (draft.inputRefs[0]?.kind !== 'final' && draft.inputRefs[0]?.kind !== 'output')) {
      return 'Choose one exact Output or Final.'
    }
  }
  if (draft.type === 'review') {
    if (!draft.reviewerId && draft.reviewerType !== 'user') return 'Choose a reviewer.'
    if (draft.inputRefs.length === 0 || draft.inputRefs.some((ref) => ref.kind !== 'final' && ref.kind !== 'output')) {
      return 'Choose an Output or Final to review.'
    }
  }
  return undefined
}

export function composerDefinitionDigest(value: unknown): string {
  return scheduledWorkDefinitionDigest(value)
}

export function buildCampaignScheduleFromComposer(
  draft: Exclude<ScheduledWorkComposerDraft, EventComposerDraft>,
  now = new Date().toISOString(),
): ScheduleCampaignWorkInput {
  if (draft.owner.scope !== 'campaign' || !draft.owner.campaignId) {
    throw new Error('Campaign work requires a campaign owner.')
  }
  const validationError = validateComposerDraft(draft)
  if (validationError) throw new Error(validationError)
  const startAt = localDateTimeToIso(draft.date, draft.time)
  const dueAt = draft.dueDate ? localDateTimeToIso(draft.dueDate, draft.dueTime || '23:59') : undefined
  const calendarItemId = `campaign-item-${draft.requestId}`
  const orderId = `scheduled-work-${draft.requestId}`
  const execution = executionFromDraft(draft)
  const payloadDigest = composerDefinitionDigest({ execution, inputRefs: draft.inputRefs, startAt, dueAt })
  const status = draft.type === 'social-publish'
    ? 'needs-approval' as const
    : 'scheduled' as const
  const order: ScheduledWorkOrder = {
    version: 1,
    id: orderId,
    owner: draft.owner,
    calendarLink: { calendar: 'campaign', itemId: calendarItemId },
    title: draft.title.trim(),
    type: draft.type,
    status,
    startAt,
    dueAt,
    timezone: draft.timezone,
    execution,
    inputRefs: draft.inputRefs,
    approvals: [],
    runs: [],
    executionKey: {
      payloadDigest,
      idempotencyKey: `${orderId}:${startAt}:${payloadDigest}`,
    },
    createdAt: now,
    updatedAt: now,
  }
  const calendarItem = createCampaignCalendarItem({
    id: calendarItemId,
    campaignId: draft.owner.campaignId,
    date: draft.date,
    time: draft.time,
    timezone: draft.timezone,
    title: draft.title.trim(),
    notes: draft.notes,
    kind: 'scheduled-job',
    status,
    assetRefs: draft.inputRefs.filter((ref) => ref.kind === 'vault').map((ref) => ({ assetId: ref.assetId, label: ref.label, kind: ref.assetKind })),
    finalRefs: draft.inputRefs.filter((ref) => ref.kind === 'final').map((ref) => ({ outputId: ref.outputId, assetId: ref.assetId, slot: ref.slot, label: ref.label })),
    outputRefs: draft.inputRefs.filter((ref) => ref.kind === 'output').map((ref) => ({ outputId: ref.outputId, title: ref.title, kind: ref.outputKind })),
    accountSetId: draft.type === 'social-publish' ? draft.accountSetId || undefined : undefined,
    socialProfileRefs: draft.type === 'social-publish' ? [{ platform: draft.platform, profileId: draft.profileId, label: draft.profileLabel }] : undefined,
    scheduledWorkId: orderId,
  })
  return { order, calendarItem }
}

function draftForType(base: ComposerBase, type: ScheduledWorkComposerType, inputRefs: ScheduledWorkInputRef[]): ScheduledWorkComposerDraft {
  if (type === 'event') return { ...base, type, endTime: '' }
  if (type === 'agent-task') {
    return {
      ...base,
      type,
      inputRefs,
      agentSlug: '',
      agentName: '',
      brief: '',
      permissionMode: 'safe',
      expectedOutput: { requirement: 'none' },
    }
  }
  if (type === 'workflow-run') {
    return {
      ...base,
      type,
      inputRefs,
      workflowSlug: '',
      workflowName: '',
      workflowDigest: '',
      triggerInputs: {},
    }
  }
  if (type === 'social-publish') {
    return {
      ...base,
      type,
      inputRefs,
      platform: '',
      profileId: '',
      profileLabel: '',
      accountSetId: '',
      caption: '',
      platformOptions: {},
    }
  }
  return {
    ...base,
    type,
    inputRefs,
    reviewerType: 'user',
    reviewerId: '',
    reviewerName: 'You',
  }
}

function commonFields(draft: ScheduledWorkComposerDraft): ComposerBase {
  return {
    requestId: draft.requestId,
    owner: draft.owner,
    title: draft.title,
    date: draft.date,
    time: draft.time,
    dueDate: draft.dueDate,
    dueTime: draft.dueTime,
    timezone: draft.timezone,
    notes: draft.notes,
  }
}

function executionFromDraft(draft: Exclude<ScheduledWorkComposerDraft, EventComposerDraft>): ScheduledWorkOrder['execution'] {
  if (draft.type === 'agent-task') {
    return {
      type: draft.type,
      agentSlug: draft.agentSlug,
      brief: draft.brief.trim(),
      permissionMode: draft.permissionMode,
      expectedOutput: draft.expectedOutput,
    }
  }
  if (draft.type === 'workflow-run') {
    return {
      type: draft.type,
      workflowSlug: draft.workflowSlug,
      workflowDigest: draft.workflowDigest,
      triggerInputs: draft.triggerInputs,
    }
  }
  if (draft.type === 'social-publish') {
    return {
      type: draft.type,
      platform: draft.platform,
      profileId: draft.profileId,
      accountSetId: draft.accountSetId || undefined,
      caption: draft.caption.trim(),
      platformOptions: Object.keys(draft.platformOptions).length ? draft.platformOptions : undefined,
    }
  }
  return {
    type: draft.type,
    reviewerType: draft.reviewerType,
    reviewerId: draft.reviewerId || undefined,
    decisionDueAt: draft.dueDate ? localDateTimeToIso(draft.dueDate, draft.dueTime || '23:59') : undefined,
  }
}

function localDateTimeToIso(date: string, time: string): string {
  const parsed = new Date(`${date}T${time}:00`)
  if (Number.isNaN(parsed.getTime())) throw new Error('Choose a valid date and time.')
  return parsed.toISOString()
}

function formatWhen(draft: ScheduledWorkComposerDraft): string {
  if (!draft.date) return ''
  const date = new Date(`${draft.date}T${draft.time || '12:00'}:00`)
  if (Number.isNaN(date.getTime())) return ''
  const formatted = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  if (!draft.time) return `on ${formatted}`
  const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return `on ${formatted} at ${time}`
}

function articleForKind(kind: ExpectedOutputContract['kind']): string {
  if (!kind) return 'the required Output'
  return `${kind === 'image' || kind === 'audio' ? 'an' : 'a'} ${kind} Output`
}

function localTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}
