export * from '@craft-agent/shared/campaign-calendar'

import {
  createCampaignCalendarItem,
  createCampaignScheduledJob,
  isLiveExternalActionType,
  type CampaignCalendarItem,
  type CampaignCalendarItemKind,
  type CampaignCalendarItemStatus,
  type CampaignExternalExecutionReceipt,
  type CampaignFinalRef,
  type CampaignOutputRef,
  type CampaignScheduledJobActionType,
  type SocialProfileRef,
} from '@craft-agent/shared/campaign-calendar'

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

export function formatCampaignExternalReceiptLabel(receipt: CampaignExternalExecutionReceipt): string {
  const platform = receipt.platform
    ? `${receipt.platform.charAt(0).toUpperCase()}${receipt.platform.slice(1)}`
    : receipt.actionType.replace(/-/g, ' ')
  return [platform, receipt.profileId, receipt.id].filter(Boolean).join(' · ')
}
