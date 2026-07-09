import { createCampaignJobRun, type CampaignJobRun } from '@craft-agent/shared/campaign-calendar'
import type { OutputManifest } from '@craft-agent/shared/outputs'
import {
  SCHEDULED_WORK_CONTEXT_SLUG,
  parseScheduledWorkDocResult,
  scheduledWorkMetadata,
  serializeScheduledWorkBody,
  type ExpectedOutputContract,
  type ScheduledWorkAttention,
  type ScheduledWorkDocument,
  type ScheduledWorkInputRef,
  type ScheduledWorkOrder,
} from '@craft-agent/shared/scheduled-work'
import {
  loadAllContextDocs,
  loadContextDoc,
  upsertContextDoc,
  type LoadedContextDoc,
} from '@craft-agent/shared/workspace-context'
import type { WorkflowRunSnapshot, WorkflowRunState } from '@craft-agent/shared/workflows'

const ACTIVE_WORKFLOW_STATES = new Set<WorkflowRunState>(['created', 'queued', 'running', 'paused'])
const START_GRACE_MS = 24 * 60 * 60 * 1000

export interface ScheduledWorkRunnerDeps {
  withLock<T>(workspaceRootPath: string, fn: () => Promise<T> | T): Promise<T>
  executeAgentTask(input: {
    workOrderId: string
    workspace: { id: string; rootPath: string }
    agentSlug: string
    brief: string
    permissionMode: 'safe' | 'ask'
    expectedOutput: ExpectedOutputContract
    inputRefs: ScheduledWorkInputRef[]
    onStarted: (sessionId: string) => void | Promise<void>
  }): Promise<{ sessionId?: string } | void>
  startWorkflow(input: {
    workOrderId: string
    workspace: { id: string; rootPath: string }
    workflowSlug: string
    workflowDigest: string
    triggerInputs: Record<string, unknown>
  }): Promise<{ runId: string }>
  readWorkflowRun(workspaceRootPath: string, runId: string): WorkflowRunSnapshot | null | undefined
  listOutputManifests(workspaceRootPath: string): OutputManifest[]
  emitContextChanged?(workspaceId: string, docs: LoadedContextDoc[]): void
  now?(): Date
  log?: Pick<Console, 'info' | 'warn' | 'error'>
}

export interface ScheduledWorkRunnerResult {
  scanned: number
  started: number
  blocked: number
  completed: number
  failed: number
}

interface PersistResult {
  updated: boolean
  work: ScheduledWorkDocument
  order?: ScheduledWorkOrder
}

interface OutputMatchResult {
  matched: OutputManifest[]
  satisfied: boolean
  message?: string
}

export class ScheduledWorkRunner {
  private readonly inFlight = new Set<string>()

  constructor(private readonly deps: ScheduledWorkRunnerDeps) {}

  async scanWorkspace(
    workspaceId: string,
    workspaceRootPath: string,
    now = this.deps.now?.() ?? new Date(),
  ): Promise<ScheduledWorkRunnerResult> {
    if (this.inFlight.has(workspaceRootPath)) {
      return { scanned: 0, started: 0, blocked: 0, completed: 0, failed: 0 }
    }
    this.inFlight.add(workspaceRootPath)
    try {
      const parsed = this.readWork(workspaceRootPath, workspaceId)
      if (!parsed.ok) {
        this.deps.log?.warn?.(`[ScheduledWork] ${parsed.error}`)
        return { scanned: 0, started: 0, blocked: 0, completed: 0, failed: 0 }
      }
      const candidates = parsed.work.items
        .filter((order) => this.shouldScanOrder(order, now))
        .map((order) => order.id)
      const result: ScheduledWorkRunnerResult = {
        scanned: candidates.length,
        started: 0,
        blocked: 0,
        completed: 0,
        failed: 0,
      }

      for (const orderId of candidates) {
        const current = this.getCurrentOrder(workspaceRootPath, workspaceId, orderId)
        if (!current || current.deletedAt || current.legacyRef) continue
        if (current.status === 'scheduled') {
          if (isPastStartGrace(current, now)) {
            const persisted = await this.updateOrder(
              workspaceId,
              workspaceRootPath,
              orderId,
              (order, nowIso) => order.status === 'scheduled'
                ? {
                    ...order,
                    status: 'needs-attention',
                    attention: this.buildAttention(
                      'missed-start-window',
                      `${order.title} missed its 24-hour start window. Reschedule it before running.`,
                    ),
                    updatedAt: nowIso,
                  }
                : null,
            )
            if (persisted.updated) result.blocked += 1
            continue
          }
          if (current.execution.type === 'review') {
            const persisted = await this.updateOrder(
              workspaceId,
              workspaceRootPath,
              orderId,
              (order, nowIso) => ({ ...order, status: 'awaiting-review', attention: undefined, updatedAt: nowIso }),
            )
            if (persisted.updated) {
              result.blocked += 1
              result.completed += 1
            }
            continue
          }

          if (current.execution.type === 'social-publish') {
            const persisted = await this.updateOrder(
              workspaceId,
              workspaceRootPath,
              orderId,
              (order, nowIso) => ({ ...order, status: 'needs-approval', attention: undefined, updatedAt: nowIso }),
            )
            if (persisted.updated) result.blocked += 1
            continue
          }

          const claimed = await this.claimRunning(workspaceId, workspaceRootPath, orderId)
          if (!claimed.order) continue
          if (claimed.order.execution.type === 'workflow-run') {
            const started = await this.startWorkflow(workspaceId, workspaceRootPath, claimed.order)
            if (started === 'started') result.started += 1
            if (started === 'failed') result.failed += 1
            continue
          }
          if (claimed.order.execution.type === 'agent-task') {
            const outcome = await this.runAgentTask(workspaceId, workspaceRootPath, claimed.order)
            result.started += 1
            if (outcome === 'done') result.completed += 1
            if (outcome === 'failed') result.failed += 1
          }
          continue
        }

        if (current.status !== 'running') continue
        if (current.execution.type === 'workflow-run') {
          const outcome = await this.pollWorkflowRun(workspaceId, workspaceRootPath, current)
          if (outcome === 'done') result.completed += 1
          if (outcome === 'failed') result.failed += 1
          continue
        }

        if (current.execution.type === 'agent-task') {
          const attention = this.buildAttention(
            'execution-failed',
            runningAgentMessage(current),
          )
          const persisted = await this.finishWithAttention(workspaceId, workspaceRootPath, current.id, attention)
          if (persisted.updated) result.failed += 1
          continue
        }

        if (current.execution.type === 'review') {
          const persisted = await this.updateOrder(
            workspaceId,
            workspaceRootPath,
            current.id,
            (order, nowIso) => ({ ...order, status: 'awaiting-review', attention: undefined, updatedAt: nowIso }),
          )
          if (persisted.updated) {
            result.blocked += 1
            result.completed += 1
          }
          continue
        }

        const persisted = await this.updateOrder(
          workspaceId,
          workspaceRootPath,
          current.id,
          (order, nowIso) => ({ ...order, status: 'needs-approval', attention: undefined, updatedAt: nowIso }),
        )
        if (persisted.updated) result.blocked += 1
      }

      return result
    } finally {
      this.inFlight.delete(workspaceRootPath)
    }
  }

  private async runAgentTask(
    workspaceId: string,
    workspaceRootPath: string,
    order: ScheduledWorkOrder,
  ): Promise<'done' | 'failed'> {
    let sessionId = currentSessionId(order)
    try {
      const execution = order.execution
      if (execution.type !== 'agent-task') return 'failed'
      const started = await this.deps.executeAgentTask({
        workOrderId: order.id,
        workspace: { id: workspaceId, rootPath: workspaceRootPath },
        agentSlug: execution.agentSlug,
        brief: execution.brief,
        permissionMode: execution.permissionMode,
        expectedOutput: execution.expectedOutput,
        inputRefs: order.inputRefs,
        onStarted: async (startedSessionId) => {
          const cleaned = clean(startedSessionId)
          if (!cleaned) return
          sessionId = cleaned
          await this.persistRunningSessionId(workspaceId, workspaceRootPath, order.id, cleaned)
        },
      })
      if (!sessionId) {
        const returnedSessionId = clean(started && typeof started === 'object' && 'sessionId' in started ? started.sessionId : undefined)
        if (returnedSessionId) {
          sessionId = returnedSessionId
          await this.persistRunningSessionId(workspaceId, workspaceRootPath, order.id, returnedSessionId)
        }
      }
      if (!sessionId) {
        throw new Error(`Agent task ${order.id} completed without reporting a session id.`)
      }
      const outputs = this.matchExpectedOutputs(
        execution.expectedOutput,
        sessionId,
        this.deps.listOutputManifests(workspaceRootPath),
      )
      if (!outputs.satisfied) {
        await this.finishWithAttention(
          workspaceId,
          workspaceRootPath,
          order.id,
          this.buildAttention('required-output-missing', outputs.message ?? 'Required output was not produced.'),
        )
        return 'failed'
      }
      await this.finishAgentDone(workspaceId, workspaceRootPath, order.id, sessionId, outputs.matched.map((output) => output.id))
      return 'done'
    } catch (error) {
      await this.finishWithAttention(
        workspaceId,
        workspaceRootPath,
        order.id,
        this.buildAttention('execution-failed', errorMessage(error)),
      )
      return 'failed'
    }
  }

  private async startWorkflow(
    workspaceId: string,
    workspaceRootPath: string,
    order: ScheduledWorkOrder,
  ): Promise<'started' | 'failed'> {
    try {
      const execution = order.execution
      if (execution.type !== 'workflow-run') return 'failed'
      const { runId } = await this.deps.startWorkflow({
        workOrderId: order.id,
        workspace: { id: workspaceId, rootPath: workspaceRootPath },
        workflowSlug: execution.workflowSlug,
        workflowDigest: execution.workflowDigest,
        triggerInputs: execution.triggerInputs,
      })
      const cleanedRunId = clean(runId)
      if (!cleanedRunId) throw new Error(`Workflow job ${order.id} did not return a run id.`)
      await this.persistRunningWorkflowRunId(workspaceId, workspaceRootPath, order.id, cleanedRunId)
      return 'started'
    } catch (error) {
      await this.finishWithAttention(
        workspaceId,
        workspaceRootPath,
        order.id,
        this.buildAttention('execution-failed', errorMessage(error)),
      )
      return 'failed'
    }
  }

  private async pollWorkflowRun(
    workspaceId: string,
    workspaceRootPath: string,
    order: ScheduledWorkOrder,
  ): Promise<'running' | 'done' | 'failed'> {
    const runId = currentWorkflowRunId(order)
    if (!runId) {
      await this.finishWithAttention(
        workspaceId,
        workspaceRootPath,
        order.id,
        this.buildAttention('execution-failed', `Workflow run for ${order.title} is missing its run id.`),
      )
      return 'failed'
    }
    const run = this.deps.readWorkflowRun(workspaceRootPath, runId)
    if (!run) {
      await this.finishWithAttention(
        workspaceId,
        workspaceRootPath,
        order.id,
        this.buildAttention('execution-failed', `Workflow run ${runId} could not be found.`),
      )
      return 'failed'
    }
    if (ACTIVE_WORKFLOW_STATES.has(run.state)) return 'running'
    if (run.state === 'succeeded') {
      await this.finishWorkflowDone(
        workspaceId,
        workspaceRootPath,
        order.id,
        run.id,
        uniqueOutputIds(run),
      )
      return 'done'
    }
    await this.finishWithAttention(
      workspaceId,
      workspaceRootPath,
      order.id,
      this.buildAttention('execution-failed', summarizeWorkflowFailure(run)),
    )
    return 'failed'
  }

  private matchExpectedOutputs(
    expectedOutput: ExpectedOutputContract,
    sessionId: string,
    manifests: OutputManifest[],
  ): OutputMatchResult {
    const fromSession = manifests.filter((manifest) => manifest.origin.sessionId === sessionId)
    const matching = fromSession.filter((manifest) => matchesExpectedOutput(manifest, expectedOutput))
    if (expectedOutput.requirement === 'none') {
      return { matched: matching.length > 0 ? matching : fromSession, satisfied: true }
    }
    if (expectedOutput.requirement === 'optional') {
      return { matched: matching, satisfied: true }
    }
    const minimumCount = Math.max(expectedOutput.minimumCount ?? 1, 1)
    if (matching.length >= minimumCount) return { matched: matching, satisfied: true }
    return {
      matched: matching,
      satisfied: false,
      message: buildRequiredOutputMessage(expectedOutput, sessionId, matching.length, minimumCount),
    }
  }

  private async claimRunning(
    workspaceId: string,
    workspaceRootPath: string,
    orderId: string,
  ): Promise<PersistResult> {
    return this.updateOrder(workspaceId, workspaceRootPath, orderId, (order, nowIso) => {
      if (order.status !== 'scheduled' || order.deletedAt || order.legacyRef) return null
      return {
        ...order,
        status: 'running',
        attention: undefined,
        updatedAt: nowIso,
        runs: [...order.runs, createCampaignJobRun({ jobId: order.id, status: 'running', startedAt: nowIso })],
      }
    })
  }

  private async persistRunningSessionId(
    workspaceId: string,
    workspaceRootPath: string,
    orderId: string,
    sessionId: string,
  ): Promise<PersistResult> {
    return this.updateOrder(workspaceId, workspaceRootPath, orderId, (order, nowIso) => {
      if (order.status !== 'running') return null
      return {
        ...order,
        updatedAt: nowIso,
        runs: updateLatestRun(order.runs, order.id, {
          status: 'running',
          sessionId,
        }),
      }
    })
  }

  private async persistRunningWorkflowRunId(
    workspaceId: string,
    workspaceRootPath: string,
    orderId: string,
    workflowRunId: string,
  ): Promise<PersistResult> {
    return this.updateOrder(workspaceId, workspaceRootPath, orderId, (order, nowIso) => {
      if (order.status !== 'running') return null
      return {
        ...order,
        updatedAt: nowIso,
        runs: updateLatestRun(order.runs, order.id, {
          status: 'running',
          workflowRunId,
          resultSummary: `Started workflow ${workflowRunId}.`,
        }),
      }
    })
  }

  private async finishAgentDone(
    workspaceId: string,
    workspaceRootPath: string,
    orderId: string,
    sessionId: string,
    outputIds: string[],
  ): Promise<PersistResult> {
    return this.updateOrder(workspaceId, workspaceRootPath, orderId, (order, nowIso) => {
      if (order.status !== 'running' || order.execution.type !== 'agent-task') return null
      return {
        ...order,
        status: order.execution.expectedOutput.reviewRequired ? 'awaiting-review' : 'done',
        attention: undefined,
        updatedAt: nowIso,
        result: { type: 'agent-task', sessionId, outputIds },
        runs: updateLatestRun(order.runs, order.id, {
          status: 'done',
          sessionId,
          endedAt: nowIso,
          resultSummary: outputIds.length > 0
            ? `Completed with ${outputIds.length} output${outputIds.length === 1 ? '' : 's'}.`
            : 'Completed without output bundles.',
        }),
      }
    })
  }

  private async finishWorkflowDone(
    workspaceId: string,
    workspaceRootPath: string,
    orderId: string,
    workflowRunId: string,
    outputIds: string[],
  ): Promise<PersistResult> {
    return this.updateOrder(workspaceId, workspaceRootPath, orderId, (order, nowIso) => {
      if (order.status !== 'running' || order.execution.type !== 'workflow-run') return null
      return {
        ...order,
        status: 'done',
        attention: undefined,
        updatedAt: nowIso,
        result: { type: 'workflow-run', workflowRunId, outputIds },
        runs: updateLatestRun(order.runs, order.id, {
          status: 'done',
          workflowRunId,
          endedAt: nowIso,
          resultSummary: outputIds.length > 0
            ? `Workflow completed with ${outputIds.length} output${outputIds.length === 1 ? '' : 's'}.`
            : 'Workflow completed.',
        }),
      }
    })
  }

  private async finishWithAttention(
    workspaceId: string,
    workspaceRootPath: string,
    orderId: string,
    attention: ScheduledWorkAttention,
  ): Promise<PersistResult> {
    return this.updateOrder(workspaceId, workspaceRootPath, orderId, (order, nowIso) => {
      if (order.deletedAt || order.status !== 'running') return null
      const summary = attention.message
      return {
        ...order,
        status: 'needs-attention',
        attention,
        updatedAt: nowIso,
        runs: updateLatestRun(order.runs, order.id, {
          status: 'failed',
          endedAt: nowIso,
          error: attention.message,
          resultSummary: summary,
        }),
      }
    })
  }

  private async updateOrder(
    workspaceId: string,
    workspaceRootPath: string,
    orderId: string,
    mutate: (order: ScheduledWorkOrder, nowIso: string) => ScheduledWorkOrder | null,
  ): Promise<PersistResult> {
    return this.deps.withLock(workspaceRootPath, async () => {
      const parsed = this.readWork(workspaceRootPath, workspaceId)
      if (!parsed.ok) throw new Error(parsed.error)
      const index = parsed.work.items.findIndex((candidate) => candidate.id === orderId && !candidate.deletedAt)
      if (index < 0) return { updated: false, work: parsed.work }
      const current = parsed.work.items[index]!
      const nowIso = (this.deps.now?.() ?? new Date()).toISOString()
      const nextOrder = mutate(current, nowIso)
      if (!nextOrder) return { updated: false, work: parsed.work, order: current }
      const nextWork: ScheduledWorkDocument = {
        ...parsed.work,
        items: parsed.work.items.map((candidate, candidateIndex) => candidateIndex === index ? nextOrder : candidate),
        updatedAt: nowIso,
      }
      this.writeWork(workspaceRootPath, nextWork)
      this.deps.emitContextChanged?.(workspaceId, loadAllContextDocs(workspaceRootPath))
      return { updated: true, work: nextWork, order: nextOrder }
    })
  }

  private getCurrentOrder(
    workspaceRootPath: string,
    workspaceId: string,
    orderId: string,
  ): ScheduledWorkOrder | undefined {
    const parsed = this.readWork(workspaceRootPath, workspaceId)
    if (!parsed.ok) return undefined
    return parsed.work.items.find((order) => order.id === orderId && !order.deletedAt)
  }

  private readWork(workspaceRootPath: string, workspaceId: string) {
    return parseScheduledWorkDocResult(loadContextDoc(workspaceRootPath, SCHEDULED_WORK_CONTEXT_SLUG) ?? undefined, workspaceId)
  }

  private writeWork(workspaceRootPath: string, work: ScheduledWorkDocument): void {
    upsertContextDoc(workspaceRootPath, {
      slug: SCHEDULED_WORK_CONTEXT_SLUG,
      metadata: scheduledWorkMetadata(),
      body: serializeScheduledWorkBody(work),
    })
  }

  private shouldScanOrder(order: ScheduledWorkOrder, now: Date): boolean {
    if (order.deletedAt || order.legacyRef) return false
    if (order.status === 'running') return true
    if (order.status !== 'scheduled') return false
    const startedAt = Date.parse(order.startAt)
    return !Number.isNaN(startedAt) && startedAt <= now.getTime()
  }

  private buildAttention(reason: ScheduledWorkAttention['reason'], message: string): ScheduledWorkAttention {
    return { reason, message }
  }
}

function isPastStartGrace(order: ScheduledWorkOrder, now: Date): boolean {
  const startAt = Date.parse(order.startAt)
  return !Number.isNaN(startAt) && now.getTime() - startAt > START_GRACE_MS
}

function currentSessionId(order: ScheduledWorkOrder): string | undefined {
  const fromRuns = [...order.runs].reverse().find((run) => run.sessionId)?.sessionId
  return clean(fromRuns)
}

function currentWorkflowRunId(order: ScheduledWorkOrder): string | undefined {
  const fromRuns = [...order.runs].reverse().find((run) => run.workflowRunId)?.workflowRunId
  return clean(fromRuns)
}

function updateLatestRun(
  runs: CampaignJobRun[],
  jobId: string,
  patch: Partial<CampaignJobRun> & Pick<CampaignJobRun, 'status'>,
): CampaignJobRun[] {
  for (let index = runs.length - 1; index >= 0; index -= 1) {
    const run = runs[index]
    if (!run || run.jobId !== jobId || run.status !== 'running') continue
    return runs.map((candidate, candidateIndex) => candidateIndex === index
      ? { ...candidate, ...patch }
      : candidate)
  }
  return [
    ...runs,
    createCampaignJobRun({
      jobId,
      status: patch.status,
      sessionId: patch.sessionId,
      workflowRunId: patch.workflowRunId,
      startedAt: patch.startedAt,
      endedAt: patch.endedAt,
      resultSummary: patch.resultSummary,
      error: patch.error,
      externalReceipt: patch.externalReceipt,
    }),
  ]
}

function matchesExpectedOutput(output: OutputManifest, expected: ExpectedOutputContract): boolean {
  if (expected.kind && output.kind !== expected.kind) return false
  if (expected.title && output.title.trim().toLowerCase() !== expected.title.trim().toLowerCase()) return false
  return true
}

function buildRequiredOutputMessage(
  expected: ExpectedOutputContract,
  sessionId: string,
  found: number,
  minimumCount: number,
): string {
  const parts = [`Expected at least ${minimumCount} output${minimumCount === 1 ? '' : 's'}`]
  if (expected.kind) parts.push(`of kind "${expected.kind}"`)
  if (expected.title) parts.push(`named "${expected.title}"`)
  parts.push(`from session ${sessionId}, but found ${found}.`)
  return parts.join(' ')
}

function runningAgentMessage(order: ScheduledWorkOrder): string {
  const sessionId = currentSessionId(order)
  if (sessionId) {
    return `Agent task ${order.id} was already running in session ${sessionId} when the runner resumed. Manual review is required before any retry.`
  }
  return `Agent task ${order.id} was left running without a recoverable session id. Manual review is required before any retry.`
}

function summarizeWorkflowFailure(run: WorkflowRunSnapshot): string {
  const failedStep = run.steps.find((step) => step.state === 'failed') ?? [...run.steps].reverse().find((step) => step.error)
  if (failedStep?.error?.message) {
    return `Workflow ${run.workflowSlug} failed at step ${failedStep.id}: ${failedStep.error.message}`
  }
  return `Workflow ${run.workflowSlug} ended in state ${run.state}.`
}

function uniqueOutputIds(run: WorkflowRunSnapshot): string[] {
  const ids = new Set<string>()
  for (const outputId of run.outputIds ?? []) {
    const cleaned = clean(outputId)
    if (cleaned) ids.add(cleaned)
  }
  const finalOutputId = clean(run.finalOutputId)
  if (finalOutputId) ids.add(finalOutputId)
  return [...ids]
}

function clean(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
