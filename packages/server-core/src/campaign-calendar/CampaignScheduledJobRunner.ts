import {
  CAMPAIGN_CALENDAR_CONTEXT_SLUG,
  campaignCalendarMetadata,
  createCampaignJobRun,
  hasCompletedScheduledJob,
  isLiveExternalActionType,
  parseCampaignCalendarDocResult,
  selectDueCampaignScheduledJobs,
  serializeCampaignCalendarBody,
  updateCampaignCalendarItem,
  type CampaignCalendar,
  type CampaignCalendarItem,
  type CampaignJobRun,
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
  emitContextChanged?(workspaceId: string, docs: ReturnType<typeof loadAllContextDocs>): void
  now?(): Date
  log?: Pick<Console, 'info' | 'warn' | 'error'>
}

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
      const due = selectDueCampaignScheduledJobs(calendar, now)
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
            markFailed(current, current.job, now, 'Invalid runAt timestamp.'),
          )
          result.failed += 1
          continue
        }

        if (dueJob.blockedReason === 'max-attempts') {
          calendar = await this.persistItem(
            workspaceId,
            workspaceRootPath,
            calendar,
            markFailed(current, current.job, now, 'Max attempts reached.'),
          )
          result.failed += 1
          continue
        }

        const lateBy = now.getTime() - Date.parse(current.job.runAt)
        if (isLiveExternalActionType(current.job.actionType) && lateBy > EXTERNAL_REVIEW_GRACE_MS) {
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

        const running = markRunning(current, current.job, now)
        calendar = await this.persistItem(workspaceId, workspaceRootPath, calendar, running)

        try {
          const completed = await this.executeDueJob(workspaceId, workspaceRootPath, running, running.job!, now)
          calendar = await this.persistItem(workspaceId, workspaceRootPath, calendar, completed)
          result.started += 1
        } catch (error) {
          const failed = markFailed(running, running.job!, now, error instanceof Error ? error.message : String(error))
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
      return markNeedsApproval(item, job, 'Live external action requires exact approval before execution.')
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
    const nextCalendar = {
      ...calendar,
      items: calendar.items.map((candidate) => candidate.id === item.id ? item : candidate),
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
  output: Pick<CampaignJobRun, 'sessionId' | 'workflowRunId' | 'resultSummary'>,
): CampaignCalendarItem {
  const nowIso = now.toISOString()
  const run = createCampaignJobRun({
    jobId: job.id,
    status: 'done',
    startedAt: job.lastRunAt ?? nowIso,
    endedAt: nowIso,
    ...output,
  })
  return updateCampaignCalendarItem(item, {
    status: 'done',
    job: {
      ...job,
      completedAt: nowIso,
      error: undefined,
    },
    runHistory: [...item.runHistory, run],
  })
}

function markFailed(item: CampaignCalendarItem, job: CampaignScheduledJob, now: Date, error: string): CampaignCalendarItem {
  const nowIso = now.toISOString()
  return updateCampaignCalendarItem(item, {
    status: 'failed',
    job: { ...job, error },
    runHistory: [
      ...item.runHistory,
      createCampaignJobRun({ jobId: job.id, status: 'failed', startedAt: job.lastRunAt ?? nowIso, endedAt: nowIso, error }),
    ],
  })
}

function markMissed(item: CampaignCalendarItem, job: CampaignScheduledJob, now: Date, error: string): CampaignCalendarItem {
  const nowIso = now.toISOString()
  return updateCampaignCalendarItem(item, {
    status: 'missed',
    job: { ...job, error },
    runHistory: [
      ...item.runHistory,
      createCampaignJobRun({ jobId: job.id, status: 'skipped', startedAt: nowIso, endedAt: nowIso, error }),
    ],
  })
}

function markNeedsApproval(item: CampaignCalendarItem, job: CampaignScheduledJob, error: string): CampaignCalendarItem {
  if (item.status === 'needs-approval' && job.error === error) return item
  return updateCampaignCalendarItem(item, {
    status: 'needs-approval',
    job: { ...job, error },
  })
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
