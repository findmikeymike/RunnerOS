import type {
  ExpectedOutputContract,
  ScheduleCampaignWorkInput,
  ScheduleCampaignChainInput,
  ScheduleHqWorkInput,
  ScheduledWorkInputRef,
  ScheduledWorkOwner,
  ScheduledWorkOrder,
} from '@craft-agent/shared/scheduled-work'
import type { OutputKind } from '@craft-agent/shared/outputs'
import { scheduledWorkDefinitionDigest } from '@craft-agent/shared/scheduled-work'
import { createCampaignCalendarItem } from '@craft-agent/shared/campaign-calendar'
import type { QueueWorkAction, WorkflowInputBinding } from '@craft-agent/shared/automations'
import { hqSemanticIntentId } from '@craft-agent/shared/hq-state'

export type ScheduledWorkComposerType = 'event' | 'agent-task' | 'workflow-run' | 'social-publish' | 'review'
export type ScheduledWorkComposerSection = 'what' | 'runner' | 'inputs' | 'timing' | 'then' | 'safeguards'

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
  followUp: ScheduledWorkComposerFollowUp
}

export type ScheduledWorkComposerFollowUp =
  | { type: 'none' }
  | { type: 'review'; reviewerType: 'user' | 'agent'; reviewerId: string; reviewerName: string; outputKind?: OutputKind }
  | { type: 'workflow-run'; workflowSlug: string; workflowName: string; workflowDigest: string; triggerInputs: Record<string, unknown>; outputInput: string; outputKind?: OutputKind }
  | { type: 'social-publish'; platform: string; profileId: string; profileLabel: string; accountSetId: string; caption: string; platformOptions: Record<string, unknown> }

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

export interface WorkflowRunComposerPrefill {
  slug: string
  name: string
  digest: string
  triggerInputs: Record<string, unknown>
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

export function applyWorkflowRunComposerPrefill(
  draft: ScheduledWorkComposerDraft,
  prefill: WorkflowRunComposerPrefill | undefined,
  title?: string,
): ScheduledWorkComposerDraft {
  if (draft.type !== 'workflow-run' || !prefill) return draft
  return {
    ...draft,
    title: title || draft.title || prefill.name,
    workflowSlug: prefill.slug,
    workflowName: prefill.name,
    workflowDigest: prefill.digest,
    triggerInputs: { ...prefill.triggerInputs },
  }
}

export function scheduledWorkComposerSections(
  draft: ScheduledWorkComposerDraft,
  allowFollowUps: boolean,
  timingMode: 'scheduled' | 'triggered',
  workflowLocked = false,
): ScheduledWorkComposerSection[] {
  if (draft.type === 'event') return timingMode === 'triggered' ? ['inputs'] : ['inputs', 'timing']
  const sections: ScheduledWorkComposerSection[] = draft.type === 'workflow-run' && workflowLocked
    ? ['inputs']
    : draft.type === 'agent-task'
      ? ['what', 'inputs', 'runner']
      : ['what', 'runner', 'inputs']
  if (timingMode === 'scheduled') sections.push('timing')
  if (allowFollowUps && draft.type !== 'social-publish') sections.push('then')
  sections.push('safeguards')
  return sections
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
    const allowedKind = draft.owner.scope === 'campaign' ? 'release-kit' : undefined
    if (draft.inputRefs.length !== 1 || (allowedKind ? draft.inputRefs[0]?.kind !== allowedKind : (draft.inputRefs[0]?.kind !== 'final' && draft.inputRefs[0]?.kind !== 'output'))) {
      return allowedKind ? 'Choose one ready Release Kit item.' : 'Choose one exact Output or Final.'
    }
    const platformError = validateSocialPlatformOptions(draft.platform, draft.platformOptions)
    if (platformError) return platformError
  }
  if (draft.type === 'review') {
    if (!draft.reviewerId && draft.reviewerType !== 'user') return 'Choose a reviewer.'
    if (draft.inputRefs.length === 0 || draft.inputRefs.some((ref) => ref.kind !== 'release-kit' && ref.kind !== 'final' && ref.kind !== 'output')) {
      return 'Choose a Release Kit item, Output, or Final to review.'
    }
  }
  const followUpError = validateFollowUp(draft)
  if (followUpError) return followUpError
  return undefined
}

export function validateComposerSection(
  draft: ScheduledWorkComposerDraft,
  section: ScheduledWorkComposerSection,
): string | undefined {
  if (section === 'inputs') {
    if (!draft.title.trim()) return 'Add a title.'
    if (draft.type === 'agent-task' && !draft.brief.trim()) return 'Add a clear brief.'
    if (draft.type === 'social-publish') {
      if (!draft.caption.trim()) return 'Add the final caption.'
      const allowedKind = draft.owner.scope === 'campaign' ? 'release-kit' : undefined
      if (draft.inputRefs.length !== 1 || (allowedKind ? draft.inputRefs[0]?.kind !== allowedKind : (draft.inputRefs[0]?.kind !== 'final' && draft.inputRefs[0]?.kind !== 'output'))) {
        return allowedKind ? 'Choose one ready Release Kit item.' : 'Choose one exact Output or Final.'
      }
      return validateSocialPlatformOptions(draft.platform, draft.platformOptions)
    }
    if (draft.type === 'review' && (
      draft.inputRefs.length === 0
      || draft.inputRefs.some(ref => ref.kind !== 'release-kit' && ref.kind !== 'final' && ref.kind !== 'output')
    )) {
      return 'Choose a Release Kit item, Output, or Final to review.'
    }
    return undefined
  }
  if (section === 'runner') {
    if (draft.type === 'agent-task' && !draft.agentSlug) return 'Choose an active agent.'
    if (draft.type === 'workflow-run' && !draft.workflowSlug) return 'Choose an active workflow.'
    if (draft.type === 'social-publish' && !draft.profileId) return 'Choose one ready social profile.'
    if (draft.type === 'review' && !draft.reviewerId && draft.reviewerType !== 'user') return 'Choose a reviewer.'
    return undefined
  }
  if (section === 'timing') {
    if (!draft.date) return 'Choose a date.'
    if (draft.type !== 'event' && !draft.time) return 'Choose a start time.'
    return undefined
  }
  if (section === 'then' && draft.type !== 'event') return validateFollowUp(draft)
  return undefined
}

export function composerDefinitionDigest(value: unknown): string {
  return scheduledWorkDefinitionDigest(value)
}

export function buildAutomationQueueWorkAction(
  draft: Exclude<ScheduledWorkComposerDraft, EventComposerDraft>,
  options: { calendarVisibility?: 'visible' | 'hidden'; inputBindings?: Record<string, WorkflowInputBinding> } = {},
): QueueWorkAction {
  const execution = executionFromDraft(draft)
  const action: QueueWorkAction = {
    type: 'queue-work',
    ownerScope: draft.owner.scope,
    calendarVisibility: options.calendarVisibility,
    title: draft.title.trim(),
    intentId: hqSemanticIntentId({ title: draft.title.trim(), intent: JSON.stringify(execution) }),
    execution,
    ...(draft.type === 'workflow-run' && options.inputBindings ? { inputBindings: options.inputBindings } : {}),
    inputRefs: draft.inputRefs.filter((ref): ref is Exclude<ScheduledWorkInputRef, { kind: 'produced-output' }> => ref.kind !== 'produced-output'),
  }
  if (draft.followUp.type !== 'none') {
    action.followUp = {
      execution: executionFromFollowUp(draft.followUp, '', ''),
      outputKind: 'outputKind' in draft.followUp ? draft.followUp.outputKind : undefined,
      outputInput: draft.followUp.type === 'workflow-run' ? draft.followUp.outputInput : undefined,
    }
  }
  return action
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
    intentId: hqSemanticIntentId({ title: draft.title.trim(), intent: JSON.stringify(execution) }),
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
    releaseKitRefs: draft.inputRefs.filter((ref) => ref.kind === 'release-kit').map((ref) => ({ itemId: ref.itemId, sha256: ref.sha256, label: ref.label })),
    outputRefs: draft.inputRefs.filter((ref) => ref.kind === 'output').map((ref) => ({ outputId: ref.outputId, title: ref.title, kind: ref.outputKind })),
    accountSetId: draft.type === 'social-publish' ? draft.accountSetId || undefined : undefined,
    socialProfileRefs: draft.type === 'social-publish' ? [{ platform: draft.platform, profileId: draft.profileId, label: draft.profileLabel }] : undefined,
    scheduledWorkId: orderId,
  })
  return { order, calendarItem }
}

export function buildCampaignSchedulePlanFromComposer(
  draft: Exclude<ScheduledWorkComposerDraft, EventComposerDraft>,
  now = new Date().toISOString(),
): ScheduleCampaignWorkInput | ScheduleCampaignChainInput {
  const single = buildCampaignScheduleFromComposer(draft, now)
  if (draft.followUp.type === 'none') return single
  const chainId = `campaign-chain-${draft.requestId}`
  const rootStepId = `${chainId}-step-0`
  const childStepId = `${chainId}-step-1`
  const rootId = `${chainId}-0`
  const childId = `${chainId}-1`
  const rootCalendarId = `${chainId}-calendar-0`
  const childCalendarId = `${chainId}-calendar-1`
  const rootOrder: ScheduledWorkOrder = {
    ...single.order,
    id: rootId,
    calendarLink: { calendar: 'campaign', itemId: rootCalendarId },
    chain: { chainId, stepId: rootStepId, ordinal: 0 },
    executionKey: {
      payloadDigest: scheduledWorkDefinitionDigest({ execution: single.order.execution, inputRefs: single.order.inputRefs, chainId, ordinal: 0 }),
      idempotencyKey: `${chainId}:0`,
    },
  }
  const childExecution = executionFromFollowUp(draft.followUp, draft.dueDate, draft.dueTime)
  const childInputRefs: ScheduledWorkInputRef[] = draft.followUp.type === 'social-publish'
    ? draft.inputRefs
    : [{
        kind: 'produced-output',
        stepId: rootStepId,
        selector: draft.followUp.outputKind ? { kind: draft.followUp.outputKind } : undefined,
        bindTo: draft.followUp.type === 'review'
          ? { kind: 'review-target' }
          : { kind: 'workflow-trigger', input: draft.followUp.outputInput },
      }]
  const childTitle = draft.followUp.type === 'review'
    ? `Review: ${draft.title.trim()}`
    : draft.followUp.type === 'workflow-run'
      ? `${draft.followUp.workflowName}: ${draft.title.trim()}`
      : `Publish: ${draft.title.trim()}`
  const childOrder: ScheduledWorkOrder = {
    version: 1,
    id: childId,
    owner: draft.owner,
    calendarLink: { calendar: 'campaign', itemId: childCalendarId },
    title: childTitle,
    intentId: hqSemanticIntentId({ title: childTitle, intent: JSON.stringify(childExecution) }),
    type: draft.followUp.type,
    status: 'waiting',
    startAt: single.order.startAt,
    dueAt: single.order.dueAt,
    timezone: draft.timezone,
    execution: childExecution,
    inputRefs: childInputRefs,
    approvals: [],
    runs: [],
    executionKey: {
      payloadDigest: scheduledWorkDefinitionDigest({ execution: childExecution, inputRefs: childInputRefs, chainId, ordinal: 1 }),
      idempotencyKey: `${chainId}:1`,
    },
    chain: {
      chainId,
      stepId: childStepId,
      ordinal: 1,
      predecessor: { orderId: rootId, stepId: rootStepId, releaseOn: draft.type === 'review' ? 'creative-approval' : 'success' },
    },
    createdAt: now,
    updatedAt: now,
  }
  const rootCalendarItem = { ...single.calendarItem, id: rootCalendarId, scheduledWorkId: rootId }
  const childCalendarItem = createCampaignCalendarItem({
    id: childCalendarId,
    campaignId: draft.owner.campaignId!,
    date: draft.date,
    time: draft.time,
    timezone: draft.timezone,
    title: childTitle,
    kind: 'scheduled-job',
    status: 'draft',
    finalRefs: childInputRefs.filter((ref) => ref.kind === 'final').map((ref) => ({ outputId: ref.outputId, assetId: ref.assetId, slot: ref.slot, label: ref.label })),
    releaseKitRefs: childInputRefs.filter((ref) => ref.kind === 'release-kit').map((ref) => ({ itemId: ref.itemId, sha256: ref.sha256, label: ref.label })),
    outputRefs: childInputRefs.filter((ref) => ref.kind === 'output').map((ref) => ({ outputId: ref.outputId, title: ref.title, kind: ref.outputKind })),
    accountSetId: draft.followUp.type === 'social-publish' ? draft.followUp.accountSetId || undefined : undefined,
    socialProfileRefs: draft.followUp.type === 'social-publish' ? [{ platform: draft.followUp.platform, profileId: draft.followUp.profileId, label: draft.followUp.profileLabel }] : undefined,
    scheduledWorkId: childId,
  })
  return { requestId: draft.requestId, orders: [rootOrder, childOrder], calendarItems: [rootCalendarItem, childCalendarItem] }
}

export function buildHqSchedulePlanFromComposer(
  draft: Exclude<ScheduledWorkComposerDraft, EventComposerDraft>,
  now = new Date().toISOString(),
): ScheduleHqWorkInput {
  if (draft.owner.scope !== 'hq') throw new Error('HQ work requires an HQ owner.')
  const campaignDraft = {
    ...draft,
    owner: { scope: 'campaign' as const, workspaceId: draft.owner.workspaceId, campaignId: draft.owner.workspaceId },
  } as Exclude<ScheduledWorkComposerDraft, EventComposerDraft>
  const plan = buildCampaignSchedulePlanFromComposer(campaignDraft, now)
  const sourceOrders = 'orders' in plan ? plan.orders : [plan.order]
  const chainId = `hq-chain-${draft.requestId}`
  const orders = sourceOrders.map((order, index): ScheduledWorkOrder => {
    const id = sourceOrders.length === 1 ? `hq-work-${draft.requestId}` : `${chainId}-${index}`
    const stepId = `${chainId}-step-${index}`
    return {
      ...order,
      id,
      owner: draft.owner,
      calendarLink: { calendar: 'hq', itemId: `${id}-calendar` },
      chain: sourceOrders.length === 1 ? undefined : {
        chainId,
        stepId,
        ordinal: index as 0 | 1,
        predecessor: index === 0 ? undefined : {
          orderId: `${chainId}-0`,
          stepId: `${chainId}-step-0`,
          releaseOn: draft.type === 'review' ? 'creative-approval' : 'success',
        },
      },
      inputRefs: order.inputRefs.map((ref) => ref.kind === 'produced-output' ? { ...ref, stepId: `${chainId}-step-0` } : ref),
      executionKey: {
        payloadDigest: scheduledWorkDefinitionDigest({ execution: order.execution, inputRefs: order.inputRefs, chainId: sourceOrders.length === 1 ? undefined : chainId, ordinal: index }),
        idempotencyKey: `${id}:${order.startAt}`,
      },
    }
  })
  return { requestId: draft.requestId, orders }
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
      followUp: { type: 'none' },
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
      followUp: { type: 'none' },
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
      followUp: { type: 'none' },
    }
  }
  return {
    ...base,
    type,
    inputRefs,
    reviewerType: 'user',
    reviewerId: '',
    reviewerName: 'You',
    followUp: { type: 'none' },
  }
}

function validateFollowUp(draft: Exclude<ScheduledWorkComposerDraft, EventComposerDraft>): string | undefined {
  const followUp = draft.followUp
  if (followUp.type === 'none') return undefined
  const supported = (draft.type === 'agent-task' && (followUp.type === 'review' || followUp.type === 'workflow-run'))
    || (draft.type === 'workflow-run' && followUp.type === 'review')
    || (draft.type === 'review' && followUp.type === 'social-publish')
  if (!supported) return 'That follow-up sequence is not supported yet.'
  if (followUp.type === 'review' && !followUp.reviewerId && followUp.reviewerType !== 'user') return 'Choose a follow-up reviewer.'
  if (followUp.type === 'workflow-run' && (!followUp.workflowSlug || !followUp.outputInput)) return 'Choose a follow-up workflow and its Output input.'
  if (followUp.type === 'social-publish') {
    if (!followUp.profileId) return 'Choose the follow-up social profile.'
    if (!followUp.caption.trim()) return 'Add the follow-up caption.'
    if (draft.inputRefs.length !== 1 || draft.inputRefs[0]?.kind !== 'release-kit') return 'Review one exact Release Kit item before publishing.'
    const platformError = validateSocialPlatformOptions(followUp.platform, followUp.platformOptions)
    if (platformError) return platformError
  }
  if (draft.type !== 'review' && draft.type === 'agent-task' && followUp.type === 'review' && draft.expectedOutput.reviewRequired) {
    return 'Use either the agent review requirement or a Then review, not both.'
  }
  return undefined
}

function validateSocialPlatformOptions(platform: string, options: Record<string, unknown>): string | undefined {
  if (platform !== 'youtube') return undefined
  if (options.postType !== 'video') return 'Scheduled YouTube Shorts are blocked until Shorts classification can be verified.'
  if (options.visibility !== 'private' && options.visibility !== 'unlisted' && options.visibility !== 'public') {
    return 'Choose a valid YouTube visibility.'
  }
  if (options.madeForKids !== 'yes' && options.madeForKids !== 'no') return 'Choose the YouTube audience setting.'
  return undefined
}

function executionFromFollowUp(
  followUp: Exclude<ScheduledWorkComposerFollowUp, { type: 'none' }>,
  dueDate: string,
  dueTime: string,
): ScheduledWorkOrder['execution'] {
  if (followUp.type === 'review') {
    return {
      type: 'review',
      reviewerType: followUp.reviewerType,
      reviewerId: followUp.reviewerId || undefined,
      decisionDueAt: dueDate ? localDateTimeToIso(dueDate, dueTime || '23:59') : undefined,
    }
  }
  if (followUp.type === 'workflow-run') {
    return { type: 'workflow-run', workflowSlug: followUp.workflowSlug, workflowDigest: followUp.workflowDigest, triggerInputs: followUp.triggerInputs }
  }
  return {
    type: 'social-publish',
    platform: followUp.platform,
    profileId: followUp.profileId,
    accountSetId: followUp.accountSetId || undefined,
    caption: followUp.caption.trim(),
    platformOptions: Object.keys(followUp.platformOptions).length ? followUp.platformOptions : undefined,
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
