export * from '@craft-agent/shared/campaign-calendar'

import {
  CAMPAIGN_CALENDAR_CONTEXT_SLUG,
  campaignCalendarMetadata,
  createCampaignCalendarItem,
  createCampaignScheduledJob,
  isLiveExternalActionType,
  parseCampaignCalendarDocResult,
  serializeCampaignCalendarBody,
  updateCampaignCalendarItem,
  type CampaignCalendar,
  type CampaignCalendarItem,
  type CampaignCalendarItemKind,
  type CampaignCalendarItemStatus,
  type CampaignExternalExecutionReceipt,
  type CampaignFinalRef,
  type CampaignOutputRef,
  type CampaignScheduledJobActionType,
  type SocialProfileRef,
} from '@craft-agent/shared/campaign-calendar'
import type { ContextDocDTO } from '../../shared/types'

export interface CampaignCalendarComposerInput {
  campaignId: string
  date: string
  time?: string
  title: string
  notes?: string
  kind: CampaignCalendarItemKind
  status: CampaignCalendarItemStatus
  actionType?: CampaignScheduledJobActionType
  actionInput?: string
  finalRefs?: CampaignFinalRef[]
  outputRefs?: CampaignOutputRef[]
  socialProfileRefs?: SocialProfileRef[]
  accountSetId?: string
}

export type CampaignCalendarComposerResult =
  | { ok: true; item: CampaignCalendarItem }
  | { ok: false; error: string }

export interface CampaignCalendarPrefill {
  title: string
  kind: 'scheduled-job'
  actionType: CampaignScheduledJobActionType
  finalRefs?: CampaignFinalRef[]
  outputRefs?: CampaignOutputRef[]
}

let pendingCampaignCalendarPrefill: CampaignCalendarPrefill | undefined

export function setPendingCampaignCalendarPrefill(prefill: CampaignCalendarPrefill): void {
  pendingCampaignCalendarPrefill = prefill
}

export function takePendingCampaignCalendarPrefill(): CampaignCalendarPrefill | undefined {
  const prefill = pendingCampaignCalendarPrefill
  pendingCampaignCalendarPrefill = undefined
  return prefill
}

export async function mutateCampaignCalendarDoc(input: {
  campaignId: string
  load(): Promise<ContextDocDTO | null>
  upsert(value: {
    slug: string
    metadata: ReturnType<typeof campaignCalendarMetadata>
    body: string
    expectedBody: string | null
  }): Promise<unknown>
  mutate(calendar: CampaignCalendar): CampaignCalendar
  maxAttempts?: number
}): Promise<CampaignCalendar> {
  const maxAttempts = Math.max(1, input.maxAttempts ?? 3)
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const latestDoc = await input.load()
    const parsed = parseCampaignCalendarDocResult(latestDoc ?? undefined, input.campaignId)
    if (!parsed.ok) throw new Error(parsed.error)
    const nextCalendar = input.mutate(parsed.calendar)
    try {
      await input.upsert({
        slug: CAMPAIGN_CALENDAR_CONTEXT_SLUG,
        metadata: campaignCalendarMetadata(),
        body: serializeCampaignCalendarBody(nextCalendar),
        expectedBody: latestDoc?.body ?? null,
      })
      return nextCalendar
    } catch (error) {
      const conflict = error instanceof Error && error.message.includes('CONTEXT_DOC_CONFLICT')
      if (!conflict || attempt === maxAttempts) throw error
    }
  }
  throw new Error('Campaign Calendar update failed after repeated conflicts.')
}

export function createCampaignCalendarDraftItem(input: CampaignCalendarComposerInput): CampaignCalendarComposerResult {
  if (!input.title.trim()) return { ok: false, error: 'Add a title first.' }
  if (input.kind !== 'scheduled-job') {
    return {
      ok: true,
      item: createCampaignCalendarItem({
        campaignId: input.campaignId,
        date: input.date,
        time: input.time,
        title: input.title,
        notes: input.notes,
        kind: input.kind,
        status: input.status,
      }),
    }
  }
  if (!input.time) return { ok: false, error: 'Scheduled jobs require a time.' }
  const runAt = new Date(`${input.date}T${input.time}:00`)
  if (Number.isNaN(runAt.getTime())) return { ok: false, error: 'Scheduled job date or time is invalid.' }
  const actionType = input.actionType ?? 'ask-agent'
  const actionInput = input.actionInput?.trim()
  if (!actionInput) return { ok: false, error: actionType === 'post-asset' ? 'Add the final caption.' : 'Add the job instruction.' }
  if (actionType === 'post-asset') {
    const profiles = (input.socialProfileRefs ?? []).filter((ref) => ref.platform && ref.profileId)
    if (profiles.length !== 1) return { ok: false, error: 'Choose one exact social profile.' }
    if (!(input.finalRefs?.length || input.outputRefs?.length)) return { ok: false, error: 'Attach one Output or Final before scheduling a post.' }
  }
  const payload = actionType === 'run-workflow'
    ? { workflowSlug: actionInput }
    : actionType === 'post-asset'
      ? { caption: actionInput }
      : { prompt: actionInput }
  const job = createCampaignScheduledJob({
    runAt: runAt.toISOString(),
    actionType,
    payload,
  })
  return {
    ok: true,
    item: createCampaignCalendarItem({
      campaignId: input.campaignId,
      date: input.date,
      time: input.time,
      title: input.title,
      notes: input.notes,
      kind: 'scheduled-job',
      status: isLiveExternalActionType(actionType) ? 'needs-approval' : input.status,
      finalRefs: input.finalRefs,
      outputRefs: input.outputRefs,
      socialProfileRefs: input.socialProfileRefs,
      accountSetId: input.accountSetId,
      job,
    }),
  }
}

export function reviseCampaignCalendarDraftItem(
  item: CampaignCalendarItem,
  input: CampaignCalendarComposerInput,
): CampaignCalendarComposerResult {
  if (!item.job) return { ok: false, error: 'Only scheduled jobs can use the scheduled-job editor.' }
  const candidate = createCampaignCalendarDraftItem({ ...input, kind: 'scheduled-job' })
  if (!candidate.ok) return candidate
  const candidateJob = candidate.item.job
  if (!candidateJob) return { ok: false, error: 'Scheduled job revision did not produce a job.' }

  const executionChanged = item.job.actionType !== candidateJob.actionType
    || item.job.payloadDigest !== candidateJob.payloadDigest
  const scheduleChanged = item.job.runAt !== candidateJob.runAt
    || item.job.timezone !== candidateJob.timezone
  const bindingsChanged = JSON.stringify({
    accountSetId: item.accountSetId,
    socialProfileRefs: item.socialProfileRefs ?? [],
    finalRefs: item.finalRefs,
    outputRefs: item.outputRefs,
  }) !== JSON.stringify({
    accountSetId: candidate.item.accountSetId,
    socialProfileRefs: candidate.item.socialProfileRefs ?? [],
    finalRefs: candidate.item.finalRefs,
    outputRefs: candidate.item.outputRefs,
  })
  const invalidateApproval = executionChanged || scheduleChanged || bindingsChanged
  const nextJob = executionChanged
    ? candidateJob
    : {
        ...item.job,
        runAt: candidateJob.runAt,
        timezone: candidateJob.timezone,
        externalActionPreview: bindingsChanged ? undefined : item.job.externalActionPreview,
        error: bindingsChanged ? undefined : item.job.error,
      }

  return {
    ok: true,
    item: updateCampaignCalendarItem(item, {
      date: candidate.item.date,
      time: candidate.item.time,
      timezone: candidate.item.timezone,
      title: candidate.item.title,
      notes: candidate.item.notes,
      kind: 'scheduled-job',
      status: invalidateApproval && isLiveExternalActionType(nextJob.actionType)
        ? 'needs-approval'
        : input.status,
      finalRefs: candidate.item.finalRefs,
      outputRefs: candidate.item.outputRefs,
      accountSetId: candidate.item.accountSetId,
      socialProfileRefs: candidate.item.socialProfileRefs,
      job: nextJob,
      approvals: invalidateApproval ? [] : item.approvals,
      runHistory: executionChanged ? [] : item.runHistory,
    }),
  }
}

export function formatCampaignExternalReceiptLabel(receipt: CampaignExternalExecutionReceipt): string {
  const platform = receipt.platform
    ? `${receipt.platform.charAt(0).toUpperCase()}${receipt.platform.slice(1)}`
    : receipt.actionType.replace(/-/g, ' ')
  return [platform, receipt.profileId, receipt.id].filter(Boolean).join(' · ')
}
