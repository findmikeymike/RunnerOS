import type { ContextDocMetadata, LoadedContextDoc } from '../workspace-context/index.ts';

export const CAMPAIGN_CALENDAR_CONTEXT_SLUG = 'campaign-calendar';

export type CampaignCalendarItemKind = 'manual' | 'deadline' | 'approval' | 'scheduled-job';
export type CampaignCalendarItemStatus =
  | 'draft'
  | 'scheduled'
  | 'needs-approval'
  | 'running'
  | 'done'
  | 'failed'
  | 'missed'
  | 'canceled';
export type CampaignCalendarItemSource = 'user' | 'agent' | 'workflow' | 'import';
export type CampaignScheduledJobActionType =
  | 'post-asset'
  | 'run-workflow'
  | 'ask-agent'
  | 'generate-content'
  | 'outreach-batch'
  | 'review'
  | 'custom-prompt';
export type CampaignScheduledJobApprovalPolicy =
  | 'none'
  | 'approval-before-run'
  | 'approval-before-external-action'
  | 'preapproved-exact-payload';

export interface CampaignAssetRef {
  assetId: string;
  label?: string;
  kind?: string;
}

export interface CampaignFinalRef {
  outputId: string;
  slot?: string;
  assetId?: string;
  label?: string;
}

export interface CampaignOutputRef {
  outputId: string;
  title?: string;
  kind?: string;
}

export interface SocialProfileRef {
  platform: string;
  profileId?: string;
  label?: string;
}

export interface CampaignScheduledJob {
  id: string;
  runAt: string;
  timezone: string;
  actionType: CampaignScheduledJobActionType;
  payload: Record<string, unknown>;
  payloadDigest: string;
  idempotencyKey: string;
  approvalPolicy: CampaignScheduledJobApprovalPolicy;
  maxAttempts: number;
  attempts: number;
  lastRunAt?: string;
  completedAt?: string;
  externalActionPreview?: CampaignExternalActionPreview;
  error?: string;
}

export interface CampaignExternalActionPreview {
  actionId: string;
  actionDigest: string;
  platform: string;
  profileId: string;
  preparedAt: string;
  payloadDigest: string;
  summary?: string;
}

export interface CampaignScheduleApproval {
  id: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  approvedAt?: string;
  expiresAt?: string;
  payloadDigest?: string;
  binding?: CampaignScheduleApprovalBinding;
  notes?: string;
}

export interface CampaignScheduleApprovalBinding {
  campaignId: string;
  itemId: string;
  jobId: string;
  runAt: string;
  actionType: CampaignScheduledJobActionType;
  payloadDigest: string;
  externalActionId?: string;
  externalActionDigest?: string;
  accountSetId?: string;
  socialProfileRefs: SocialProfileRef[];
  assetRefs: CampaignAssetRef[];
  finalRefs: CampaignFinalRef[];
  outputRefs: CampaignOutputRef[];
}

export interface CampaignJobRun {
  id: string;
  jobId: string;
  startedAt: string;
  endedAt?: string;
  status: 'running' | 'done' | 'failed' | 'skipped';
  sessionId?: string;
  workflowRunId?: string;
  resultSummary?: string;
  externalReceipt?: CampaignExternalExecutionReceipt;
  error?: string;
}

export interface CampaignExternalExecutionReceipt {
  id: string;
  actionType: CampaignScheduledJobActionType;
  platform?: string;
  profileId?: string;
  accountSetId?: string;
  externalUrl?: string;
  completedAt: string;
  payloadDigest: string;
  approvalId: string;
  summary?: string;
}

export interface ExternalCalendarSyncState {
  provider?: 'google';
  eventId?: string;
  syncStatus?: 'not-synced' | 'synced' | 'local-change' | 'remote-change' | 'conflict' | 'error';
  lastSyncedAt?: string;
  error?: string;
}

export interface CampaignCalendarItem {
  id: string;
  date: string;
  time?: string;
  timezone: string;
  title: string;
  notes?: string;
  kind: CampaignCalendarItemKind;
  status: CampaignCalendarItemStatus;
  source: CampaignCalendarItemSource;
  assetRefs: CampaignAssetRef[];
  finalRefs: CampaignFinalRef[];
  outputRefs: CampaignOutputRef[];
  personIds: string[];
  accountSetId?: string;
  socialProfileRefs?: SocialProfileRef[];
  scheduledWorkId?: string;
  job?: CampaignScheduledJob;
  approvals?: CampaignScheduleApproval[];
  runHistory: CampaignJobRun[];
  hqCalendarEventId?: string;
  externalCalendar?: ExternalCalendarSyncState;
  deletedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignCalendar {
  version: 1;
  campaignId: string;
  items: CampaignCalendarItem[];
  updatedAt: string;
}

export type CampaignCalendarParseResult =
  | { ok: true; calendar: CampaignCalendar }
  | { ok: false; calendar: CampaignCalendar; error: string };

export type CampaignCalendarWriteIntent = {
  campaignId: string;
  operation: 'create' | 'update' | 'cancel';
  item: Partial<CampaignCalendarItem>;
  explanation: string;
  requiresUserConfirmation: boolean;
};

export type CampaignCalendarWriteResult =
  | { ok: true; calendar: CampaignCalendar; item: CampaignCalendarItem; operation: CampaignCalendarWriteIntent['operation'] }
  | { ok: false; calendar: CampaignCalendar; error: string };

export interface DueCampaignScheduledJob {
  item: CampaignCalendarItem;
  job: CampaignScheduledJob;
  dueAt: string;
  blockedReason?: 'needs-approval' | 'already-completed' | 'max-attempts' | 'invalid-run-at' | 'stale-running';
}

export const CAMPAIGN_JOB_RETRY_BACKOFF_MS = 5 * 60 * 1000;
export const CAMPAIGN_JOB_RUNNING_STALE_MS = 30 * 60 * 1000;
export const CAMPAIGN_EXACT_APPROVAL_GRACE_MS = 30 * 60 * 1000;

export function campaignCalendarMetadata(): ContextDocMetadata {
  return {
    name: 'Campaign Calendar',
    description: 'Campaign-scoped schedule, deadlines, review checkpoints, and one-shot planned work.',
    routing: { mode: 'broadcast' },
    enabled: true,
    status: 'active',
    priority: 'normal',
  };
}

export function emptyCampaignCalendar(campaignId: string): CampaignCalendar {
  return {
    version: 1,
    campaignId,
    items: [],
    updatedAt: new Date().toISOString(),
  };
}

export function parseCampaignCalendarDocResult(
  doc: Pick<LoadedContextDoc, 'body'> | undefined,
  campaignId: string,
): CampaignCalendarParseResult {
  if (!doc?.body.trim()) return { ok: true, calendar: emptyCampaignCalendar(campaignId) };
  const json = extractJson(doc.body);
  if (!json) {
    return {
      ok: false,
      calendar: emptyCampaignCalendar(campaignId),
      error: 'Campaign Calendar exists, but no JSON block could be read.',
    };
  }
  try {
    const parsed = JSON.parse(json) as Partial<CampaignCalendar>;
    if (parsed.version !== 1 || !Array.isArray(parsed.items)) {
      return {
        ok: false,
        calendar: emptyCampaignCalendar(campaignId),
        error: 'Campaign Calendar JSON has an unsupported shape.',
      };
    }
    return {
      ok: true,
      calendar: {
        version: 1,
        campaignId: clean(parsed.campaignId) ?? campaignId,
        items: parsed.items.filter(isCampaignCalendarItem).map(normalizeCampaignCalendarItem),
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
      },
    };
  } catch {
    return {
      ok: false,
      calendar: emptyCampaignCalendar(campaignId),
      error: 'Campaign Calendar JSON is malformed.',
    };
  }
}

export function serializeCampaignCalendarBody(calendar: CampaignCalendar): string {
  const sorted = {
    version: 1,
    campaignId: calendar.campaignId,
    items: [...calendar.items].sort((a, b) => `${a.date} ${a.time ?? ''}`.localeCompare(`${b.date} ${b.time ?? ''}`)),
    updatedAt: new Date().toISOString(),
  };
  return [
    'This is campaign-scoped calendar context. It stores local schedule items, deadlines, review points, and one-shot planned work. Do not treat it as global HQ calendar context.',
    '',
    'Live external actions are approval-only until Phase 4 live external execution is wired.',
    '',
    '```json',
    JSON.stringify(sorted, null, 2),
    '```',
  ].join('\n');
}

export function createCampaignCalendarItem(input: {
  id?: string;
  campaignId: string;
  date: string;
  title: string;
  timezone?: string;
  time?: string;
  notes?: string;
  kind?: CampaignCalendarItemKind;
  status?: CampaignCalendarItemStatus;
  source?: CampaignCalendarItemSource;
  personIds?: string[];
  assetRefs?: CampaignAssetRef[];
  finalRefs?: CampaignFinalRef[];
  outputRefs?: CampaignOutputRef[];
  socialProfileRefs?: SocialProfileRef[];
  accountSetId?: string;
  scheduledWorkId?: string;
  job?: CampaignScheduledJob;
  approvals?: CampaignScheduleApproval[];
}): CampaignCalendarItem {
  const now = new Date().toISOString();
  return normalizeCampaignCalendarItem({
    id: clean(input.id) ?? `campaign-item-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    date: input.date,
    title: input.title,
    time: input.time,
    timezone: input.timezone ?? getLocalTimezone(),
    notes: input.notes,
    kind: input.kind ?? (input.job ? 'scheduled-job' : 'manual'),
    status: input.status ?? 'scheduled',
    source: input.source ?? 'user',
    assetRefs: input.assetRefs ?? [],
    finalRefs: input.finalRefs ?? [],
    outputRefs: input.outputRefs ?? [],
    personIds: input.personIds ?? [],
    accountSetId: input.accountSetId,
    socialProfileRefs: input.socialProfileRefs,
    scheduledWorkId: input.scheduledWorkId,
    job: input.job,
    approvals: input.approvals ?? [],
    runHistory: [],
    createdAt: now,
    updatedAt: now,
  });
}

export function createCampaignScheduledJob(input: {
  runAt: string;
  timezone?: string;
  actionType: CampaignScheduledJobActionType;
  payload?: Record<string, unknown>;
  payloadDigest?: string;
  idempotencyKey?: string;
  approvalPolicy?: CampaignScheduledJobApprovalPolicy;
  maxAttempts?: number;
}): CampaignScheduledJob {
  const payload = input.payload ?? {};
  const payloadDigest = input.payloadDigest ?? stablePayloadDigest(payload);
  const runAt = cleanIso(input.runAt) ?? new Date().toISOString();
  const actionType = normalizeActionType(input.actionType);
  const approvalPolicy = input.approvalPolicy
    ?? (isLiveExternalActionType(actionType) ? 'approval-before-external-action' : 'none');
  const id = `campaign-job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  return {
    id,
    runAt,
    timezone: clean(input.timezone) ?? getLocalTimezone(),
    actionType,
    payload,
    payloadDigest,
    idempotencyKey: clean(input.idempotencyKey) ?? `${id}:${actionType}:${runAt}:${payloadDigest}`,
    approvalPolicy,
    maxAttempts: clampInt(input.maxAttempts, 1, 5, 1),
    attempts: 0,
  };
}

export function updateCampaignCalendarItem(
  item: CampaignCalendarItem,
  patch: Partial<Pick<CampaignCalendarItem, 'date' | 'time' | 'timezone' | 'title' | 'notes' | 'kind' | 'status' | 'personIds' | 'assetRefs' | 'finalRefs' | 'outputRefs' | 'accountSetId' | 'socialProfileRefs' | 'scheduledWorkId' | 'job' | 'approvals' | 'runHistory'>>,
): CampaignCalendarItem {
  return normalizeCampaignCalendarItem({
    ...item,
    ...patch,
    updatedAt: new Date().toISOString(),
  });
}

export function rescheduleCampaignCalendarItem(
  item: CampaignCalendarItem,
  schedule: { date: string; time?: string; timezone?: string },
): { ok: true; item: CampaignCalendarItem } | { ok: false; error: string } {
  if (!item.job) return { ok: false, error: 'Only scheduled jobs can be rescheduled.' };
  if (!isDateKey(schedule.date)) return { ok: false, error: 'Scheduled job date must use YYYY-MM-DD.' };
  const time = cleanTime(schedule.time);
  if (!time) return { ok: false, error: 'Scheduled jobs require a time.' };
  const runAt = new Date(`${schedule.date}T${time}:00`);
  if (Number.isNaN(runAt.getTime())) return { ok: false, error: 'Scheduled job date or time is invalid.' };
  const timezone = clean(schedule.timezone) ?? item.timezone;
  return {
    ok: true,
    item: updateCampaignCalendarItem(item, {
      date: schedule.date,
      time,
      timezone,
      job: {
        ...item.job,
        runAt: runAt.toISOString(),
        timezone,
      },
    }),
  };
}

export function approveCampaignCalendarItem(
  item: CampaignCalendarItem,
  options: { campaignId?: string; now?: string; notes?: string; expiresAt?: string } = {},
): CampaignCalendarItem {
  const now = cleanIso(options.now) ?? new Date().toISOString();
  const expiresAt = cleanIso(options.expiresAt)
    ?? defaultApprovalExpiresAt(item.job, now);
  const approval: CampaignScheduleApproval = {
    id: `campaign-approval-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    status: 'approved',
    approvedAt: now,
    expiresAt,
    payloadDigest: item.job?.payloadDigest,
    binding: item.job ? createApprovalBinding(item, item.job, options.campaignId) : undefined,
    notes: clean(options.notes) ?? (item.job && isLiveExternalActionType(item.job.actionType)
      ? 'Approved for review. Live external execution is still blocked until the external runner is connected.'
      : 'Approved from Campaign Calendar.'),
  };
  const liveExternal = item.job ? isLiveExternalActionType(item.job.actionType) : false;
  return updateCampaignCalendarItem(item, {
    status: liveExternal ? 'needs-approval' : 'scheduled',
    approvals: [...(item.approvals ?? []), approval],
    job: item.job
      ? {
          ...item.job,
          approvalPolicy: liveExternal ? 'preapproved-exact-payload' : 'none',
          error: liveExternal ? 'Approved in calendar; live external execution is not connected yet.' : undefined,
        }
      : item.job,
  });
}

export function requeueCampaignScheduledJob(item: CampaignCalendarItem): CampaignCalendarItem {
  if (!item.job) return item;
  if (item.status === 'done') return item;
  const liveExternal = isLiveExternalActionType(item.job.actionType);
  return updateCampaignCalendarItem(item, {
    status: liveExternal ? 'needs-approval' : 'scheduled',
    job: {
      ...item.job,
      attempts: 0,
      lastRunAt: undefined,
      completedAt: undefined,
      error: liveExternal ? 'Live external execution is not connected yet.' : undefined,
    },
  });
}

export function activeCampaignCalendarItems(items: CampaignCalendarItem[]): CampaignCalendarItem[] {
  return items.filter((item) => !item.deletedAt);
}

export function applyCampaignCalendarWriteIntent(
  calendar: CampaignCalendar,
  intent: CampaignCalendarWriteIntent,
  options: { actor?: CampaignCalendarItemSource; now?: string } = {},
): CampaignCalendarWriteResult {
  if (intent.campaignId && intent.campaignId !== calendar.campaignId) {
    return { ok: false, calendar, error: `Intent campaignId "${intent.campaignId}" does not match calendar "${calendar.campaignId}".` };
  }
  if (!intent.explanation.trim()) {
    return { ok: false, calendar, error: 'Calendar write intent requires an explanation.' };
  }
  if (intent.requiresUserConfirmation) {
    return { ok: false, calendar, error: 'Calendar write intent still requires user confirmation.' };
  }
  const now = cleanIso(options.now) ?? new Date().toISOString();
  const source = options.actor ?? 'agent';

  if (intent.operation === 'create') {
    if (!isDateKey(intent.item.date ?? '')) return { ok: false, calendar, error: 'Create intent requires item.date as YYYY-MM-DD.' };
    if (!clean(intent.item.title)) return { ok: false, calendar, error: 'Create intent requires item.title.' };
    const job = normalizeScheduledJob(intent.item.job);
    const status = job && shouldRequireApproval(intent.item.status, job)
      ? 'needs-approval'
      : normalizeStatus(intent.item.status);
    const item = normalizeCampaignCalendarItem({
      ...intent.item,
      id: clean(intent.item.id) ?? `campaign-item-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      date: intent.item.date!,
      title: intent.item.title!,
      timezone: clean(intent.item.timezone) ?? getLocalTimezone(),
      kind: job ? 'scheduled-job' : normalizeKind(intent.item.kind),
      status,
      source,
      assetRefs: intent.item.assetRefs ?? [],
      finalRefs: intent.item.finalRefs ?? [],
      outputRefs: intent.item.outputRefs ?? [],
      personIds: intent.item.personIds ?? [],
      approvals: intent.item.approvals ?? [],
      runHistory: intent.item.runHistory ?? [],
      job,
      createdAt: now,
      updatedAt: now,
    } as CampaignCalendarItem);
    return {
      ok: true,
      calendar: { ...calendar, items: [...calendar.items, item], updatedAt: now },
      item,
      operation: intent.operation,
    };
  }

  const itemId = clean(intent.item.id);
  if (!itemId) return { ok: false, calendar, error: `${intent.operation} intent requires item.id.` };
  const existing = calendar.items.find((item) => item.id === itemId && !item.deletedAt);
  if (!existing) return { ok: false, calendar, error: `Calendar item not found: ${itemId}` };

  if (intent.operation === 'cancel') {
    const item = updateCampaignCalendarItem(existing, { status: 'canceled' });
    return replaceCalendarItem(calendar, item, intent.operation, now);
  }

  const nextJob = intent.item.job === undefined ? existing.job : normalizeScheduledJob(intent.item.job);
  const nextStatus = nextJob && shouldRequireApproval(intent.item.status ?? existing.status, nextJob)
    ? 'needs-approval'
    : normalizeStatus(intent.item.status ?? existing.status);
  let item = updateCampaignCalendarItem(existing, {
    date: intent.item.date ?? existing.date,
    time: intent.item.time ?? existing.time,
    timezone: intent.item.timezone ?? existing.timezone,
    title: intent.item.title ?? existing.title,
    notes: intent.item.notes ?? existing.notes,
    kind: nextJob ? 'scheduled-job' : (intent.item.kind ?? existing.kind),
    status: nextStatus,
    personIds: intent.item.personIds ?? existing.personIds,
    assetRefs: intent.item.assetRefs ?? existing.assetRefs,
    finalRefs: intent.item.finalRefs ?? existing.finalRefs,
    outputRefs: intent.item.outputRefs ?? existing.outputRefs,
    accountSetId: intent.item.accountSetId ?? existing.accountSetId,
    socialProfileRefs: intent.item.socialProfileRefs ?? existing.socialProfileRefs,
    job: nextJob,
    approvals: intent.item.approvals ?? existing.approvals,
    runHistory: intent.item.runHistory ?? existing.runHistory,
  });
  const scheduleChanged = intent.item.job === undefined
    && Boolean(existing.job)
    && (intent.item.date !== undefined || intent.item.time !== undefined || intent.item.timezone !== undefined);
  if (scheduleChanged) {
    const rescheduled = rescheduleCampaignCalendarItem(item, {
      date: item.date,
      time: item.time,
      timezone: item.timezone,
    });
    if (!rescheduled.ok) return { ok: false, calendar, error: rescheduled.error };
    item = rescheduled.item;
  }
  const externalBindingsChanged = Boolean(item.job && isLiveExternalActionType(item.job.actionType))
    && (
      (existing.accountSetId ?? undefined) !== (item.accountSetId ?? undefined)
      || stableStringify(existing.socialProfileRefs ?? []) !== stableStringify(item.socialProfileRefs ?? [])
      || stableStringify(existing.assetRefs) !== stableStringify(item.assetRefs)
      || stableStringify(existing.finalRefs) !== stableStringify(item.finalRefs)
      || stableStringify(existing.outputRefs) !== stableStringify(item.outputRefs)
    );
  if (item.job && (externalBindingsChanged || scheduleChanged)) {
    item = updateCampaignCalendarItem(item, {
      status: isLiveExternalActionType(item.job.actionType) ? 'needs-approval' : item.status,
      approvals: [],
      job: externalBindingsChanged
        ? { ...item.job, externalActionPreview: undefined, error: undefined }
        : item.job,
    });
  }
  return replaceCalendarItem(calendar, item, intent.operation, now);
}

export function selectDueCampaignScheduledJobs(
  calendar: CampaignCalendar,
  now: Date = new Date(),
  options: { allowLiveExternal?: boolean; allowExternalPreparation?: boolean } = {},
): DueCampaignScheduledJob[] {
  const nowMs = now.getTime();
  return activeCampaignCalendarItems(calendar.items).flatMap((item) => {
    const job = item.job;
    if (!job || item.kind !== 'scheduled-job') return [];
    const dueMs = Date.parse(job.runAt);
    if (Number.isNaN(dueMs)) return [{ item, job, dueAt: job.runAt, blockedReason: 'invalid-run-at' }];
    if (dueMs > nowMs) return [];
    if (hasCompletedScheduledJob(item, job)) return [];
    if (item.status === 'draft' || item.status === 'done' || item.status === 'failed' || item.status === 'missed' || item.status === 'canceled') return [];
    if (job.attempts >= job.maxAttempts) return [{ item, job, dueAt: job.runAt, blockedReason: 'max-attempts' }];
    if (item.status === 'running') {
      const lastRunMs = Date.parse(job.lastRunAt ?? '');
      if (!Number.isNaN(lastRunMs) && nowMs - lastRunMs >= CAMPAIGN_JOB_RUNNING_STALE_MS) {
        return [{ item, job, dueAt: job.runAt, blockedReason: 'stale-running' }];
      }
      return [];
    }
    const liveExternal = isLiveExternalActionType(job.actionType);
    const liveExternalApproved = liveExternal
      && options.allowLiveExternal === true
      && job.approvalPolicy === 'preapproved-exact-payload'
      && hasApprovedScheduledJobPayload(item, job, now, calendar.campaignId);
    const canPrepareExternal = liveExternal
      && options.allowExternalPreparation === true
      && !job.externalActionPreview
      && (item.status === 'scheduled' || item.status === 'needs-approval');
    if (canPrepareExternal) return [{ item, job, dueAt: job.runAt }];
    if ((item.status === 'needs-approval' && !liveExternalApproved)
      || job.approvalPolicy === 'approval-before-run'
      || (liveExternal && !liveExternalApproved)
      || (job.actionType === 'review' && !hasPromptPayload(job.payload))) {
      return [{ item, job, dueAt: job.runAt, blockedReason: 'needs-approval' }];
    }
    if (item.status !== 'scheduled' && !liveExternalApproved) return [];
    const lastRunMs = Date.parse(job.lastRunAt ?? '');
    if (job.attempts > 0 && !Number.isNaN(lastRunMs) && nowMs - lastRunMs < CAMPAIGN_JOB_RETRY_BACKOFF_MS) return [];
    return [{ item, job, dueAt: job.runAt }];
  });
}

export function isLiveExternalActionType(actionType: CampaignScheduledJobActionType): boolean {
  return actionType === 'post-asset' || actionType === 'outreach-batch';
}

export function hasCompletedScheduledJob(item: CampaignCalendarItem, job: CampaignScheduledJob): boolean {
  if (job.completedAt) return true;
  return item.runHistory.some((run) => run.jobId === job.id && run.status === 'done');
}

export function hasApprovedScheduledJobPayload(
  item: CampaignCalendarItem,
  job: CampaignScheduledJob,
  now: Date = new Date(),
  campaignId?: string,
): boolean {
  return Boolean(findApprovedScheduledJobApproval(item, job, now, campaignId));
}

export function findApprovedScheduledJobApproval(
  item: CampaignCalendarItem,
  job: CampaignScheduledJob,
  now: Date = new Date(),
  campaignId?: string,
): CampaignScheduleApproval | undefined {
  return (item.approvals ?? []).findLast((approval) => (
    approval.status === 'approved'
    && !isApprovalExpired(approval, now)
    && approvalMatchesJob(approval, item, job, campaignId)
  ));
}

export function createCampaignJobRun(input: {
  jobId: string;
  status: CampaignJobRun['status'];
  startedAt?: string;
  endedAt?: string;
  sessionId?: string;
  workflowRunId?: string;
  resultSummary?: string;
  externalReceipt?: CampaignExternalExecutionReceipt;
  error?: string;
}): CampaignJobRun {
  const startedAt = cleanIso(input.startedAt) ?? new Date().toISOString();
  return {
    id: `campaign-run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    jobId: input.jobId,
    startedAt,
    endedAt: cleanIso(input.endedAt),
    status: input.status,
    sessionId: clean(input.sessionId),
    workflowRunId: clean(input.workflowRunId),
    resultSummary: clean(input.resultSummary),
    externalReceipt: normalizeExternalReceipt(input.externalReceipt),
    error: clean(input.error),
  };
}

function replaceCalendarItem(
  calendar: CampaignCalendar,
  item: CampaignCalendarItem,
  operation: CampaignCalendarWriteIntent['operation'],
  now: string,
): CampaignCalendarWriteResult {
  return {
    ok: true,
    calendar: {
      ...calendar,
      items: calendar.items.map((candidate) => candidate.id === item.id ? item : candidate),
      updatedAt: now,
    },
    item,
    operation,
  };
}

function shouldRequireApproval(status: CampaignCalendarItemStatus | undefined, job: CampaignScheduledJob): boolean {
  if (status === 'needs-approval') return true;
  if (job.approvalPolicy === 'approval-before-run' || job.approvalPolicy === 'approval-before-external-action') return true;
  if (job.actionType === 'review' && !hasPromptPayload(job.payload)) return true;
  return isLiveExternalActionType(job.actionType);
}

function hasPromptPayload(payload: Record<string, unknown>): boolean {
  const prompt = payload.prompt;
  return typeof prompt === 'string' && Boolean(prompt.trim());
}

function defaultApprovalExpiresAt(job: CampaignScheduledJob | undefined, approvedAt: string): string {
  const runAtMs = Date.parse(job?.runAt ?? '');
  const approvedAtMs = Date.parse(approvedAt);
  const validRunAtMs = Number.isNaN(runAtMs) ? approvedAtMs : runAtMs;
  const expiresMs = Math.max(validRunAtMs, approvedAtMs) + CAMPAIGN_EXACT_APPROVAL_GRACE_MS;
  return new Date(expiresMs).toISOString();
}

function createApprovalBinding(
  item: CampaignCalendarItem,
  job: CampaignScheduledJob,
  campaignId?: string,
): CampaignScheduleApprovalBinding {
  return {
    campaignId: clean(campaignId) ?? '',
    itemId: item.id,
    jobId: job.id,
    runAt: job.runAt,
    actionType: job.actionType,
    payloadDigest: job.payloadDigest,
    externalActionId: job.externalActionPreview?.actionId,
    externalActionDigest: job.externalActionPreview?.actionDigest,
    accountSetId: item.accountSetId,
    socialProfileRefs: item.socialProfileRefs ?? [],
    assetRefs: item.assetRefs,
    finalRefs: item.finalRefs,
    outputRefs: item.outputRefs,
  };
}

function isApprovalExpired(approval: CampaignScheduleApproval, now: Date): boolean {
  const expiresMs = Date.parse(approval.expiresAt ?? '');
  return Number.isNaN(expiresMs) || expiresMs <= now.getTime();
}

function approvalMatchesJob(
  approval: CampaignScheduleApproval,
  item: CampaignCalendarItem,
  job: CampaignScheduledJob,
  campaignId?: string,
): boolean {
  const binding = approval.binding;
  if (!binding) return false;
  if (binding.campaignId !== campaignId) return false;
  return binding.itemId === item.id
    && binding.jobId === job.id
    && binding.runAt === job.runAt
    && binding.actionType === job.actionType
    && binding.payloadDigest === job.payloadDigest
    && (binding.externalActionId ?? undefined) === (job.externalActionPreview?.actionId ?? undefined)
    && (binding.externalActionDigest ?? undefined) === (job.externalActionPreview?.actionDigest ?? undefined)
    && (binding.accountSetId ?? undefined) === (item.accountSetId ?? undefined)
    && stableStringify(binding.socialProfileRefs) === stableStringify(item.socialProfileRefs ?? [])
    && stableStringify(binding.assetRefs) === stableStringify(item.assetRefs)
    && stableStringify(binding.finalRefs) === stableStringify(item.finalRefs)
    && stableStringify(binding.outputRefs) === stableStringify(item.outputRefs);
}

function normalizeCampaignCalendarItem(item: CampaignCalendarItem): CampaignCalendarItem {
  const now = new Date().toISOString();
  return {
    ...item,
    date: isDateKey(item.date) ? item.date : now.slice(0, 10),
    time: cleanTime(item.time),
    timezone: clean(item.timezone) ?? getLocalTimezone(),
    title: clean(item.title) ?? 'Untitled item',
    notes: clean(item.notes),
    kind: normalizeKind(item.kind),
    status: normalizeStatus(item.status),
    source: normalizeSource(item.source),
    assetRefs: normalizeAssetRefs(item.assetRefs),
    finalRefs: normalizeFinalRefs(item.finalRefs),
    outputRefs: normalizeOutputRefs(item.outputRefs),
    personIds: normalizeIds(item.personIds),
    accountSetId: clean(item.accountSetId),
    socialProfileRefs: normalizeSocialProfileRefs(item.socialProfileRefs),
    scheduledWorkId: clean(item.scheduledWorkId),
    job: normalizeScheduledJob(item.job),
    approvals: normalizeApprovals(item.approvals),
    runHistory: normalizeJobRuns(item.runHistory),
    deletedAt: clean(item.deletedAt),
    createdAt: typeof item.createdAt === 'string' ? item.createdAt : now,
    updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : now,
  };
}

function normalizeScheduledJob(value: unknown): CampaignScheduledJob | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const job = value as Partial<CampaignScheduledJob>;
  if (typeof job.runAt !== 'string') return undefined;
  const actionType = normalizeActionType(job.actionType);
  const payload = isRecord(job.payload) ? job.payload : {};
  const payloadDigest = clean(job.payloadDigest) ?? stablePayloadDigest(payload);
  const id = clean(job.id) ?? `campaign-job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const runAt = clean(job.runAt) ?? new Date().toISOString();
  const legacyDefaultKey = `${actionType}:${runAt}:${payloadDigest}`;
  const storedIdempotencyKey = clean(job.idempotencyKey);
  return {
    id,
    runAt,
    timezone: clean(job.timezone) ?? getLocalTimezone(),
    actionType,
    payload,
    payloadDigest,
    idempotencyKey: !storedIdempotencyKey || storedIdempotencyKey === legacyDefaultKey
      ? `${id}:${actionType}:${runAt}:${payloadDigest}`
      : storedIdempotencyKey,
    approvalPolicy: normalizeApprovalPolicy(job.approvalPolicy, actionType),
    maxAttempts: clampInt(job.maxAttempts, 1, 5, 1),
    attempts: clampInt(job.attempts, 0, 999, 0),
    lastRunAt: cleanIso(job.lastRunAt),
    completedAt: cleanIso(job.completedAt),
    externalActionPreview: normalizeExternalActionPreview(job.externalActionPreview),
    error: clean(job.error),
  };
}

function extractJson(body: string): string | null {
  const fenced = body.match(/```json\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1];
  const firstBrace = body.indexOf('{');
  const lastBrace = body.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace <= firstBrace) return null;
  return body.slice(firstBrace, lastBrace + 1);
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.replace(/\s+/g, ' ').trim();
  return trimmed || undefined;
}

function cleanTime(value: string | undefined): string | undefined {
  const trimmed = clean(value);
  if (!trimmed) return undefined;
  return /^\d{2}:\d{2}$/.test(trimmed) ? trimmed : undefined;
}

function cleanIso(value: string | undefined): string | undefined {
  const trimmed = clean(value);
  if (!trimmed) return undefined;
  const time = Date.parse(trimmed);
  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
}

function isDateKey(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function normalizeKind(value: unknown): CampaignCalendarItemKind {
  return value === 'manual' || value === 'deadline' || value === 'approval' || value === 'scheduled-job'
    ? value
    : 'manual';
}

function normalizeStatus(value: unknown): CampaignCalendarItemStatus {
  return value === 'draft'
    || value === 'scheduled'
    || value === 'needs-approval'
    || value === 'running'
    || value === 'done'
    || value === 'failed'
    || value === 'missed'
    || value === 'canceled'
    ? value
    : 'scheduled';
}

function normalizeSource(value: unknown): CampaignCalendarItemSource {
  return value === 'user' || value === 'agent' || value === 'workflow' || value === 'import' ? value : 'user';
}

function normalizeActionType(value: unknown): CampaignScheduledJobActionType {
  return value === 'post-asset'
    || value === 'run-workflow'
    || value === 'ask-agent'
    || value === 'generate-content'
    || value === 'outreach-batch'
    || value === 'review'
    || value === 'custom-prompt'
    ? value
    : 'custom-prompt';
}

function normalizeApprovalPolicy(value: unknown, actionType: CampaignScheduledJobActionType): CampaignScheduledJobApprovalPolicy {
  if (value === 'none'
    || value === 'approval-before-run'
    || value === 'approval-before-external-action'
    || value === 'preapproved-exact-payload') {
    return value;
  }
  return isLiveExternalActionType(actionType) ? 'approval-before-external-action' : 'none';
}

function normalizeIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => typeof item === 'string' ? item.trim() : '').filter(Boolean))];
}

function normalizeAssetRefs(value: unknown): CampaignAssetRef[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is CampaignAssetRef => typeof item?.assetId === 'string' && Boolean(item.assetId.trim()))
    .map((item) => ({ assetId: item.assetId.trim(), label: clean(item.label), kind: clean(item.kind) }));
}

function normalizeFinalRefs(value: unknown): CampaignFinalRef[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is CampaignFinalRef => typeof item?.outputId === 'string' && Boolean(item.outputId.trim()))
    .map((item) => ({ outputId: item.outputId.trim(), slot: clean(item.slot), assetId: clean(item.assetId), label: clean(item.label) }));
}

function normalizeOutputRefs(value: unknown): CampaignOutputRef[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is CampaignOutputRef => typeof item?.outputId === 'string' && Boolean(item.outputId.trim()))
    .map((item) => ({ outputId: item.outputId.trim(), title: clean(item.title), kind: clean(item.kind) }));
}

function normalizeSocialProfileRefs(value: unknown): SocialProfileRef[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const refs = value
    .filter((item): item is SocialProfileRef => typeof item?.platform === 'string' && Boolean(item.platform.trim()))
    .map((item) => ({ platform: item.platform.trim(), profileId: clean(item.profileId), label: clean(item.label) }));
  return refs.length ? refs : undefined;
}

function normalizeApprovals(value: unknown): CampaignScheduleApproval[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const approval = entry as Partial<CampaignScheduleApproval>;
    const status = approval.status;
    if (status !== 'pending' && status !== 'approved' && status !== 'rejected' && status !== 'expired') return [];
    const binding = normalizeApprovalBinding(approval.binding);
    return [{
      id: clean(approval.id) ?? `campaign-approval-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      status,
      approvedAt: cleanIso(approval.approvedAt),
      expiresAt: cleanIso(approval.expiresAt),
      payloadDigest: clean(approval.payloadDigest),
      binding,
      notes: clean(approval.notes),
    }];
  });
}

function normalizeApprovalBinding(value: unknown): CampaignScheduleApprovalBinding | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const binding = value as Partial<CampaignScheduleApprovalBinding>;
  const actionType = normalizeActionType(binding.actionType);
  const campaignId = clean(binding.campaignId);
  const itemId = clean(binding.itemId);
  const jobId = clean(binding.jobId);
  const runAt = cleanIso(binding.runAt);
  const payloadDigest = clean(binding.payloadDigest);
  if (!campaignId || !itemId || !jobId || !runAt || !payloadDigest) return undefined;
  return {
    campaignId,
    itemId,
    jobId,
    runAt,
    actionType,
    payloadDigest,
    externalActionId: clean(binding.externalActionId),
    externalActionDigest: clean(binding.externalActionDigest),
    accountSetId: clean(binding.accountSetId),
    socialProfileRefs: normalizeSocialProfileRefs(binding.socialProfileRefs) ?? [],
    assetRefs: normalizeAssetRefs(binding.assetRefs),
    finalRefs: normalizeFinalRefs(binding.finalRefs),
    outputRefs: normalizeOutputRefs(binding.outputRefs),
  };
}

function normalizeJobRuns(value: unknown): CampaignJobRun[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const run = entry as Partial<CampaignJobRun>;
    const jobId = clean(run.jobId);
    const startedAt = cleanIso(run.startedAt);
    const status = run.status;
    if (!jobId || !startedAt || (status !== 'running' && status !== 'done' && status !== 'failed' && status !== 'skipped')) return [];
    return [{
      id: clean(run.id) ?? `campaign-run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      jobId,
      startedAt,
      endedAt: cleanIso(run.endedAt),
      status,
      sessionId: clean(run.sessionId),
      workflowRunId: clean(run.workflowRunId),
      resultSummary: clean(run.resultSummary),
      externalReceipt: normalizeExternalReceipt(run.externalReceipt),
      error: clean(run.error),
    }];
  });
}

function normalizeExternalReceipt(value: unknown): CampaignExternalExecutionReceipt | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const receipt = value as Partial<CampaignExternalExecutionReceipt>;
  const id = clean(receipt.id);
  const completedAt = cleanIso(receipt.completedAt);
  const payloadDigest = clean(receipt.payloadDigest);
  const approvalId = clean(receipt.approvalId);
  if (!id || !completedAt || !payloadDigest || !approvalId) return undefined;
  return {
    id,
    actionType: normalizeActionType(receipt.actionType),
    platform: clean(receipt.platform),
    profileId: clean(receipt.profileId),
    accountSetId: clean(receipt.accountSetId),
    externalUrl: clean(receipt.externalUrl),
    completedAt,
    payloadDigest,
    approvalId,
    summary: clean(receipt.summary),
  };
}

function normalizeExternalActionPreview(value: unknown): CampaignExternalActionPreview | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const preview = value as Partial<CampaignExternalActionPreview>;
  const actionId = clean(preview.actionId);
  const actionDigest = clean(preview.actionDigest);
  const platform = clean(preview.platform);
  const profileId = clean(preview.profileId);
  const preparedAt = cleanIso(preview.preparedAt);
  const payloadDigest = clean(preview.payloadDigest);
  if (!actionId || !actionDigest || !platform || !profileId || !preparedAt || !payloadDigest) return undefined;
  return {
    actionId,
    actionDigest,
    platform,
    profileId,
    preparedAt,
    payloadDigest,
    summary: clean(preview.summary),
  };
}

function isCampaignCalendarItem(value: unknown): value is CampaignCalendarItem {
  const candidate = value as Partial<CampaignCalendarItem>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.date === 'string' &&
    isDateKey(candidate.date) &&
    typeof candidate.title === 'string'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stablePayloadDigest(payload: Record<string, unknown>): string {
  const stable = stableStringify(payload);
  let hash = 0x811c9dc5;
  for (let index = 0; index < stable.length; index += 1) {
    hash ^= stable.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(max, Math.max(min, number));
}

function getLocalTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Chicago';
  } catch {
    return 'America/Chicago';
  }
}
