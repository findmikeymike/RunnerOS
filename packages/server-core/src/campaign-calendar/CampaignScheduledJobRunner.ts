import {
  CAMPAIGN_CALENDAR_CONTEXT_SLUG,
  campaignCalendarMetadata,
  createCampaignJobRun,
  findApprovedScheduledJobApproval,
  hasCompletedScheduledJob,
  isLiveExternalActionType,
  parseCampaignCalendarDocResult,
  selectDueCampaignScheduledJobs,
  serializeCampaignCalendarBody,
  updateCampaignCalendarItem,
  type CampaignCalendar,
  type CampaignCalendarItem,
  type CampaignExternalActionPreview,
  type CampaignExternalExecutionReceipt,
  type CampaignJobRun,
  type CampaignScheduleApproval,
  type CampaignScheduledJob,
} from '@craft-agent/shared/campaign-calendar'
import {
  loadAllContextDocs,
  loadContextDoc,
  upsertContextDoc,
} from '@craft-agent/shared/workspace-context'

export interface CampaignScheduledJobRunnerDeps {
  executePromptJob(input: {
    workspaceId: string
    workspaceRootPath: string
    prompt: string
    agentSlug?: string
    permissionMode?: 'safe' | 'ask' | 'allow-all'
    automationName?: string
  }): Promise<{ sessionId: string }>
  startWorkflow(input: {
    workspaceId: string
    workflowSlug: string
    triggerInputs: Record<string, unknown>
  }): Promise<{ runId: string }>
  prepareExternalJob?(input: {
    workspaceId: string
    workspaceRootPath: string
    item: CampaignCalendarItem
    job: CampaignScheduledJob
  }): Promise<{
    actionId: string
    actionDigest: string
    platform: string
    profileId: string
    summary?: string
  }>
  executeExternalJob?(input: {
    workspaceId: string
    workspaceRootPath: string
    item: CampaignCalendarItem
    job: CampaignScheduledJob
    approval: CampaignScheduleApproval
  }): Promise<{
    receiptId: string
    platform?: string
    profileId?: string
    externalUrl?: string
    approvalId?: string
    resultSummary?: string
  }>
  emitContextChanged?(workspaceId: string, docs: ReturnType<typeof loadAllContextDocs>): void
  now?(): Date
  log?: Pick<Console, 'info' | 'warn' | 'error'>
}

export type CampaignExternalJobPreparer = NonNullable<CampaignScheduledJobRunnerDeps['prepareExternalJob']>

export interface CampaignScheduledJobRunnerResult {
  scanned: number
  started: number
  blocked: number
  missed: number
  failed: number
}

const LOCAL_PREP_GRACE_MS = 24 * 60 * 60 * 1000
const EXTERNAL_REVIEW_GRACE_MS = 30 * 60 * 1000

export class CampaignScheduledJobRunner {
  private readonly deps: CampaignScheduledJobRunnerDeps
  private readonly inFlight = new Set<string>()

  constructor(deps: CampaignScheduledJobRunnerDeps) {
    this.deps = deps
  }

  async scanWorkspace(
    workspaceId: string,
    workspaceRootPath: string,
    now = this.deps.now?.() ?? new Date(),
  ): Promise<CampaignScheduledJobRunnerResult> {
    if (this.inFlight.has(workspaceId)) {
      return { scanned: 0, started: 0, blocked: 0, missed: 0, failed: 0 }
    }
    this.inFlight.add(workspaceId)
    try {
      const doc = loadContextDoc(workspaceRootPath, CAMPAIGN_CALENDAR_CONTEXT_SLUG)
      const parsed = parseCampaignCalendarDocResult(doc ?? undefined, workspaceId)
      if (!parsed.ok) {
        this.deps.log?.warn?.(`[CampaignScheduledJobs] ${parsed.error}`)
        return { scanned: 0, started: 0, blocked: 0, missed: 0, failed: 0 }
      }

      let calendar = parsed.calendar
      const due = selectDueCampaignScheduledJobs(calendar, now, {
        allowLiveExternal: Boolean(this.deps.executeExternalJob),
        allowExternalPreparation: Boolean(this.deps.prepareExternalJob),
      })
      const result: CampaignScheduledJobRunnerResult = {
        scanned: due.length,
        started: 0,
        blocked: 0,
        missed: 0,
        failed: 0,
      }

      for (const dueJob of due) {
        const current = calendar.items.find((item) => item.id === dueJob.item.id)
        if (!current?.job) continue
        if (dueJob.blockedReason === 'already-completed') continue

        if (dueJob.blockedReason === 'needs-approval') {
          calendar = await this.persistItem(
            workspaceId,
            workspaceRootPath,
            calendar,
            markNeedsApproval(current, current.job, 'Approval required before this scheduled job can run.'),
          )
          result.blocked += 1
          continue
        }

        if (dueJob.blockedReason === 'invalid-run-at') {
          calendar = await this.persistItem(
            workspaceId,
            workspaceRootPath,
            calendar,
            markTerminalFailed(current, current.job, now, 'Invalid runAt timestamp.'),
          )
          result.failed += 1
          continue
        }

        if (dueJob.blockedReason === 'max-attempts') {
          calendar = await this.persistItem(
            workspaceId,
            workspaceRootPath,
            calendar,
            markTerminalFailed(current, current.job, now, 'Max attempts reached.'),
          )
          result.failed += 1
          continue
        }

        if (dueJob.blockedReason === 'stale-running') {
          calendar = await this.persistItem(
            workspaceId,
            workspaceRootPath,
            calendar,
            markRetryableFailure(current, current.job, now, 'Recovered stale running job; retry is scheduled.'),
          )
          result.failed += 1
          continue
        }

        const lateBy = now.getTime() - Date.parse(current.job.runAt)
        const lateReviewApproval = isLiveExternalActionType(current.job.actionType)
          ? findApprovedScheduledJobApproval(current, current.job, now, workspaceId)
          : undefined
        const approvedAfterLateThreshold = Date.parse(lateReviewApproval?.approvedAt ?? '')
          >= Date.parse(current.job.runAt) + EXTERNAL_REVIEW_GRACE_MS
        if (isLiveExternalActionType(current.job.actionType)
          && lateBy > EXTERNAL_REVIEW_GRACE_MS
          && !approvedAfterLateThreshold) {
          calendar = await this.persistItem(
            workspaceId,
            workspaceRootPath,
            calendar,
            markNeedsApproval(current, current.job, 'External job is more than 30 minutes late and needs review.'),
          )
          result.blocked += 1
          continue
        }
        if (!isLiveExternalActionType(current.job.actionType) && lateBy > LOCAL_PREP_GRACE_MS) {
          calendar = await this.persistItem(
            workspaceId,
            workspaceRootPath,
            calendar,
            markMissed(current, current.job, now, 'Scheduled job missed the 24 hour grace window.'),
          )
          result.missed += 1
          continue
        }

        if (isLiveExternalActionType(current.job.actionType) && !current.job.externalActionPreview && this.deps.prepareExternalJob) {
          try {
            const prepared = await this.deps.prepareExternalJob({
              workspaceId,
              workspaceRootPath,
              item: current,
              job: current.job,
            })
            const preview = validateExternalActionPreview(current, current.job, prepared, now)
            calendar = await this.persistItem(
              workspaceId,
              workspaceRootPath,
              calendar,
              markExternalPrepared(current, current.job, preview),
            )
            result.blocked += 1
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            calendar = await this.persistItem(
              workspaceId,
              workspaceRootPath,
              calendar,
              markTerminalFailed(current, current.job, now, `External dry-run failed: ${message}`),
            )
            result.failed += 1
          }
          continue
        }

        const running = markRunning(current, current.job, now)
        calendar = await this.persistItem(workspaceId, workspaceRootPath, calendar, running)

        try {
          const completed = await this.executeDueJob(workspaceId, workspaceRootPath, running, running.job!, now)
          calendar = await this.persistItem(workspaceId, workspaceRootPath, calendar, completed)
          result.started += 1
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          const failed = running.job!.attempts >= running.job!.maxAttempts
            ? markTerminalFailed(running, running.job!, now, message)
            : markRetryableFailure(running, running.job!, now, message)
          calendar = await this.persistItem(workspaceId, workspaceRootPath, calendar, failed)
          result.failed += 1
        }
      }

      return result
    } finally {
      this.inFlight.delete(workspaceId)
    }
  }

  private async executeDueJob(
    workspaceId: string,
    workspaceRootPath: string,
    item: CampaignCalendarItem,
    job: CampaignScheduledJob,
    now: Date,
  ): Promise<CampaignCalendarItem> {
    if (hasCompletedScheduledJob(item, job)) return item
    if (isLiveExternalActionType(job.actionType)) {
      if (!this.deps.executeExternalJob) {
        return markNeedsApproval(item, job, 'Live external action requires exact approval before execution.')
      }
      const approval = findApprovedScheduledJobApproval(item, job, now, workspaceId)
      if (!approval) return markNeedsApproval(item, job, 'Exact approval no longer matches this scheduled job.')
      const result = await this.deps.executeExternalJob({ workspaceId, workspaceRootPath, item, job, approval })
      if (!result.receiptId.trim()) throw new Error('External executor did not return a receipt id.')
      const externalReceipt: CampaignExternalExecutionReceipt = {
        id: result.receiptId,
        actionType: job.actionType,
        platform: result.platform,
        profileId: result.profileId,
        accountSetId: item.accountSetId,
        externalUrl: result.externalUrl,
        completedAt: now.toISOString(),
        payloadDigest: job.payloadDigest,
        approvalId: result.approvalId ?? approval.id,
        summary: result.resultSummary,
      }
      return markDone(item, job, now, {
        externalReceipt,
        resultSummary: result.resultSummary ?? `External action receipt ${result.receiptId}.`,
      })
    }
    if (job.actionType === 'review' && !readPayloadString(job.payload, 'prompt')) {
      return markNeedsApproval(item, job, 'Review job requires manual approval or a prompt payload before execution.')
    }

    if (job.actionType === 'run-workflow') {
      const workflowSlug = readPayloadString(job.payload, 'workflowSlug')
      if (!workflowSlug) throw new Error('run-workflow job payload requires workflowSlug.')
      const triggerInputs = readPayloadRecord(job.payload, 'triggerInputs') ?? {}
      const { runId } = await this.deps.startWorkflow({ workspaceId, workflowSlug, triggerInputs })
      return markDone(item, job, now, { workflowRunId: runId, resultSummary: `Started workflow ${workflowSlug}.` })
    }

    const prompt = readPayloadString(job.payload, 'prompt')
    if (!prompt) throw new Error(`${job.actionType} job payload requires prompt.`)
    const agentSlug = readPayloadString(job.payload, 'agentSlug')
    const permissionMode = readPermissionMode(job.payload)
    const { sessionId } = await this.deps.executePromptJob({
      workspaceId,
      workspaceRootPath,
      prompt,
      agentSlug,
      permissionMode,
      automationName: `Campaign job: ${item.title}`,
    })
    return markDone(item, job, now, { sessionId, resultSummary: agentSlug ? `Started @${agentSlug}.` : 'Started scheduled prompt session.' })
  }

  private async persistItem(
    workspaceId: string,
    workspaceRootPath: string,
    calendar: CampaignCalendar,
    item: CampaignCalendarItem,
  ): Promise<CampaignCalendar> {
    const latestDoc = loadContextDoc(workspaceRootPath, CAMPAIGN_CALENDAR_CONTEXT_SLUG)
    const latestParsed = parseCampaignCalendarDocResult(latestDoc ?? undefined, calendar.campaignId)
    if (!latestParsed.ok) throw new Error(latestParsed.error)
    const latestCalendar = latestParsed.calendar
    const latestItem = latestCalendar.items.find((candidate) => candidate.id === item.id)
    if (!latestItem || latestItem.job?.id !== item.job?.id) return latestCalendar
    const mergedItem: CampaignCalendarItem = {
      ...latestItem,
      status: item.status,
      job: item.job,
      runHistory: item.runHistory,
      updatedAt: item.updatedAt,
    }
    const nextCalendar = {
      ...latestCalendar,
      items: latestCalendar.items.map((candidate) => candidate.id === item.id ? mergedItem : candidate),
      updatedAt: new Date().toISOString(),
    }
    upsertContextDoc(workspaceRootPath, {
      slug: CAMPAIGN_CALENDAR_CONTEXT_SLUG,
      metadata: campaignCalendarMetadata(),
      body: serializeCampaignCalendarBody(nextCalendar),
    })
    this.deps.emitContextChanged?.(workspaceId, loadAllContextDocs(workspaceRootPath))
    return nextCalendar
  }
}

function validateExternalActionPreview(
  item: CampaignCalendarItem,
  job: CampaignScheduledJob,
  prepared: Awaited<ReturnType<NonNullable<CampaignScheduledJobRunnerDeps['prepareExternalJob']>>>,
  now: Date,
): CampaignExternalActionPreview {
  const actionId = prepared.actionId.trim()
  const actionDigest = prepared.actionDigest.trim()
  const platform = prepared.platform.trim()
  const profileId = prepared.profileId.trim()
  if (!actionId.startsWith('act_')) throw new Error('Social dry-run returned an invalid action id.')
  if (!actionDigest) throw new Error('Social dry-run returned no action digest.')
  const matchesProfile = (item.socialProfileRefs ?? []).some((ref) => (
    ref.platform === platform && ref.profileId === profileId
  ))
  if (!matchesProfile) throw new Error(`Social dry-run resolved unexpected profile ${platform}/${profileId}.`)
  return {
    actionId,
    actionDigest,
    platform,
    profileId,
    preparedAt: now.toISOString(),
    payloadDigest: job.payloadDigest,
    summary: prepared.summary?.trim() || undefined,
  }
}

function markExternalPrepared(
  item: CampaignCalendarItem,
  job: CampaignScheduledJob,
  preview: CampaignExternalActionPreview,
): CampaignCalendarItem {
  return updateCampaignCalendarItem(item, {
    status: 'needs-approval',
    job: {
      ...job,
      externalActionPreview: preview,
      error: `Dry-run ${preview.actionId} is ready for exact approval.`,
    },
  })
}

function markRunning(item: CampaignCalendarItem, job: CampaignScheduledJob, now: Date): CampaignCalendarItem {
  const nowIso = now.toISOString()
  return updateCampaignCalendarItem(item, {
    status: 'running',
    job: {
      ...job,
      attempts: job.attempts + 1,
      lastRunAt: nowIso,
      error: undefined,
    },
    runHistory: [
      ...item.runHistory,
      createCampaignJobRun({ jobId: job.id, status: 'running', startedAt: nowIso }),
    ],
  })
}

function markDone(
  item: CampaignCalendarItem,
  job: CampaignScheduledJob,
  now: Date,
  output: Pick<CampaignJobRun, 'sessionId' | 'workflowRunId' | 'resultSummary' | 'externalReceipt'>,
): CampaignCalendarItem {
  const nowIso = now.toISOString()
  return updateCampaignCalendarItem(item, {
    status: 'done',
    job: {
      ...job,
      completedAt: nowIso,
      error: undefined,
    },
    runHistory: finishLatestRun(item.runHistory, job, 'done', nowIso, output),
  })
}

function markRetryableFailure(item: CampaignCalendarItem, job: CampaignScheduledJob, now: Date, error: string): CampaignCalendarItem {
  const nowIso = now.toISOString()
  return updateCampaignCalendarItem(item, {
    status: 'scheduled',
    job: { ...job, error },
    runHistory: finishLatestRun(item.runHistory, job, 'failed', nowIso, { error }),
  })
}

function markTerminalFailed(item: CampaignCalendarItem, job: CampaignScheduledJob, now: Date, error: string): CampaignCalendarItem {
  const nowIso = now.toISOString()
  return updateCampaignCalendarItem(item, {
    status: 'failed',
    job: { ...job, error },
    runHistory: finishLatestRun(item.runHistory, job, 'failed', nowIso, { error }),
  })
}

function markMissed(item: CampaignCalendarItem, job: CampaignScheduledJob, now: Date, error: string): CampaignCalendarItem {
  const nowIso = now.toISOString()
  return updateCampaignCalendarItem(item, {
    status: 'missed',
    job: { ...job, error },
    runHistory: finishLatestRun(item.runHistory, job, 'skipped', nowIso, { error }),
  })
}

function markNeedsApproval(item: CampaignCalendarItem, job: CampaignScheduledJob, error: string): CampaignCalendarItem {
  if (item.status === 'needs-approval' && job.error === error) return item
  return updateCampaignCalendarItem(item, {
    status: 'needs-approval',
    job: { ...job, error },
    runHistory: finishLatestRun(item.runHistory, job, 'skipped', new Date().toISOString(), { error }, false),
  })
}

function finishLatestRun(
  runHistory: CampaignJobRun[],
  job: CampaignScheduledJob,
  status: CampaignJobRun['status'],
  endedAt: string,
  output: Partial<Pick<CampaignJobRun, 'sessionId' | 'workflowRunId' | 'resultSummary' | 'externalReceipt' | 'error'>>,
  appendIfMissing = true,
): CampaignJobRun[] {
  for (let index = runHistory.length - 1; index >= 0; index -= 1) {
    const run = runHistory[index]
    if (run?.jobId === job.id && run.status === 'running') {
      return runHistory.map((candidate, candidateIndex) => candidateIndex === index
        ? { ...candidate, status, endedAt, ...output }
        : candidate)
    }
  }
  if (!appendIfMissing) return runHistory
  return [
    ...runHistory,
    createCampaignJobRun({
      jobId: job.id,
      status,
      startedAt: job.lastRunAt ?? endedAt,
      endedAt,
      ...output,
    }),
  ]
}

function readPayloadString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function readPayloadRecord(payload: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = payload[key]
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function readPermissionMode(payload: Record<string, unknown>): 'safe' | 'ask' | 'allow-all' | undefined {
  const value = payload.permissionMode
  return value === 'safe' || value === 'ask' || value === 'allow-all' ? value : undefined
}
