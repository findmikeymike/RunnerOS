import { createCampaignJobRun, type CampaignExternalExecutionReceipt, type CampaignJobRun } from '@craft-agent/shared/campaign-calendar'
import { randomUUID } from 'node:crypto'
import type { OutputManifest } from '@craft-agent/shared/outputs'
import {
  SCHEDULED_WORK_CONTEXT_SLUG,
  parseScheduledWorkDocResult,
  scheduledWorkMetadata,
  serializeScheduledWorkBody,
  scheduledWorkDefinitionDigest,
  type ExpectedOutputContract,
  type ScheduledWorkAttention,
  type ScheduledWorkDocument,
  type ScheduledWorkInputRef,
  type ScheduledWorkOrder,
  type ScheduledWorkContinuation,
  type ScheduledSocialActionPreview,
  type ScheduledSocialApproval,
  type ManageGoalRunInput,
  type ManageGoalRunResult,
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
const SOCIAL_PREP_WINDOW_MS = 30 * 60 * 1000

export interface ScheduledWorkRunnerDeps {
  canRunBackgroundWork(workspaceRootPath: string): boolean
  getBackgroundFenceToken?(workspaceRootPath: string): string | null
  canExecuteSocialAutomatically?(workspaceRootPath: string): boolean
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
    continuation?: ScheduledWorkContinuation
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
  postProcessAgentTask?(input: {
    workspaceId: string
    workspaceRootPath: string
    order: ScheduledWorkOrder
    sessionId: string
    outputs: OutputManifest[]
  }): Promise<{ sharedIntelContextSlugs?: string[] }>
  readAgentSession?(sessionId: string): Promise<'running' | 'completed' | 'interrupted' | 'missing'>
  awaitAgentCompletionBarrier?(sessionId: string): Promise<boolean>
  abortAgentSession?(sessionId: string): Promise<void>
  prepareSocial?(input: { workspaceId: string; workspaceRootPath: string; order: ScheduledWorkOrder }): Promise<ScheduledSocialActionPreview>
  executeSocial?(input: { workspaceId: string; workspaceRootPath: string; order: ScheduledWorkOrder; preview: ScheduledSocialActionPreview; approval: ScheduledSocialApproval }): Promise<{ receiptId: string; externalUrl?: string; summary: string }>
  emitContextChanged?(workspaceId: string, docs: LoadedContextDoc[]): void
  now?(): Date
  log?: Pick<Console, 'info' | 'warn' | 'error'>
}

export type ScheduledSocialPreparer = NonNullable<ScheduledWorkRunnerDeps['prepareSocial']>
export type ScheduledSocialExecutor = NonNullable<ScheduledWorkRunnerDeps['executeSocial']>

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

/**
 * Ceiling on agent sessions this runner starts at once.
 *
 * Waking from sleep can make a whole night of work due in a single scan.
 * Launching every order together spawns competing agent sessions that exhaust
 * memory and provider rate limits, and the artist just sees a wall of
 * failures. Orders over the cap stay `scheduled` for the next scan.
 */
const MAX_CONCURRENT_AGENT_TASKS = 3

export class ScheduledWorkRunner {
  readonly runtimeId = randomUUID()
  private readonly inFlight = new Set<string>()
  private readonly activeAgentRuns = new Set<string>()
  private readonly activeSocialProfiles = new Set<string>()
  private readonly deps: ScheduledWorkRunnerDeps
  private readonly log: Pick<Console, 'info' | 'warn' | 'error'>

  constructor(deps: ScheduledWorkRunnerDeps) {
    this.deps = deps
    this.log = deps.log ?? console
  }

  private canContinue(workspaceRootPath: string, capturedFence: string | null): boolean {
    if (!this.deps.canRunBackgroundWork(workspaceRootPath)) return false
    return !this.deps.getBackgroundFenceToken || this.deps.getBackgroundFenceToken(workspaceRootPath) === capturedFence
  }

  async manageGoalRun(
    workspaceId: string,
    workspaceRootPath: string,
    input: ManageGoalRunInput,
  ): Promise<ManageGoalRunResult> {
    if (input.requiresUserConfirmation) throw new Error('Goal run changes require explicit user confirmation.')
    if (!input.explanation.trim()) throw new Error('Explain why the Goal run is changing.')
    return this.deps.withLock(workspaceRootPath, async () => {
      const parsed = this.readWork(workspaceRootPath, workspaceId)
      if (!parsed.ok) throw new Error(parsed.error)
      const coordinator = parsed.work.items.find((candidate) => candidate.continuation?.role === 'coordinator'
        && candidate.continuation.runId === input.runId && !candidate.deletedAt)
      if (!coordinator?.continuation || coordinator.updatedAt !== input.expectedUpdatedAt) {
        throw new Error('Goal run changed before this operation. Refresh and review it again.')
      }
      const rounds = parsed.work.items
        .filter((candidate) => candidate.continuation?.role === 'round' && candidate.continuation.runId === input.runId && !candidate.deletedAt)
        .sort((left, right) => (left.continuation?.round ?? 0) - (right.continuation?.round ?? 0))
      const latest = rounds.at(-1)
      if (!latest?.continuation) throw new Error('Goal run has no recoverable round history.')
      if (latest.status === 'running') {
        if (input.operation === 'rearm') throw new Error('The Goal run is still active and cannot be resumed again.')
        const sessionId = currentSessionId(latest)
        if (!sessionId || !this.deps.abortAgentSession) throw new Error('The active round could not be stopped safely. Open its session and stop it first.')
        await this.deps.abortAgentSession(sessionId)
      }
      const nowIso = (this.deps.now?.() ?? new Date()).toISOString()

      if (input.operation === 'pause' || input.operation === 'cancel') {
        const attention = this.buildAttention('continuation-disarmed', input.operation === 'pause'
          ? `Continuation paused: ${input.explanation.trim()}`
          : `Continuation canceled: ${input.explanation.trim()}`)
        const nextLatest: ScheduledWorkOrder = (latest.status === 'scheduled' || latest.status === 'running')
          ? {
              ...latest,
              status: input.operation === 'cancel' ? 'canceled' : 'needs-attention',
              attention: input.operation === 'cancel' ? undefined : attention,
              updatedAt: nowIso,
              runs: latest.status === 'running'
                ? updateLatestRun(latest.runs, latest.id, { status: 'failed', endedAt: nowIso, error: attention.message })
                : latest.runs,
            }
          : latest
        const nextCoordinator: ScheduledWorkOrder = {
          ...coordinator,
          status: input.operation === 'cancel' ? 'canceled' : 'needs-attention',
          attention: input.operation === 'cancel' ? undefined : attention,
          runs: mergeCoordinatorRun(coordinator.runs, nextLatest.runs.at(-1)),
          updatedAt: nowIso,
        }
        const items = parsed.work.items.map((candidate) => {
          if (candidate.id === coordinator.id) return nextCoordinator
          if (candidate.id === latest.id) return nextLatest
          return candidate
        })
        const persisted = this.writeContinuationWork(workspaceId, workspaceRootPath, parsed.work, items, nextCoordinator, nowIso)
        return { work: persisted.work, coordinator: nextCoordinator }
      }

      if (coordinator.status !== 'needs-attention') throw new Error('Only a stopped Goal run can be resumed.')
      const goal = loadContextDoc(workspaceRootPath, coordinator.continuation.goalSlug)
      if (!goal || !goal.metadata.enabled || goal.metadata.status !== 'active') throw new Error('Goal must exist, be enabled, and be active before resuming.')
      const goalRevision = scheduledWorkDefinitionDigest({ metadata: goal.metadata, body: goal.body })
      const runnerFence = this.deps.getBackgroundFenceToken?.(workspaceRootPath)
      if (!runnerFence) throw new Error('Runner ownership could not be verified before resuming.')
      const maxRounds = input.maxRounds ?? coordinator.continuation.maxRounds
      if (!Number.isInteger(maxRounds) || maxRounds < 2 || maxRounds > 8) throw new Error('maxRounds must be an integer from 2 through 8.')
      const canReuseUnstartedRound = latest.runs.length === 0 && latest.result === undefined
      const nextRound = canReuseUnstartedRound ? latest.continuation.round : latest.continuation.round + 1
      if (nextRound > maxRounds) throw new Error('Increase maxRounds before resuming this exhausted Goal run.')
      const objective = input.objective?.trim() || coordinator.continuation.objective
      if (!objective) throw new Error('A Goal objective is required before resuming.')
      const nextId = canReuseUnstartedRound ? latest.id : `${coordinator.id}-round-${nextRound}`
      if (!canReuseUnstartedRound && parsed.work.items.some((candidate) => candidate.id === nextId)) throw new Error('The next continuation round already exists. Refresh before resuming.')
      const continuation = {
        ...latest.continuation,
        goalRevision,
        objective,
        round: nextRound,
        maxRounds,
        runtimeId: this.runtimeId,
        runnerFence,
        parentOrderId: canReuseUnstartedRound ? latest.continuation.parentOrderId : latest.id,
        priorRoundSessionId: canReuseUnstartedRound ? latest.continuation.priorRoundSessionId : currentSessionId(latest),
        priorRoundOutputIds: canReuseUnstartedRound
          ? latest.continuation.priorRoundOutputIds
          : latest.result?.type === 'agent-task' ? latest.result.outputIds : undefined,
      }
      const successor: ScheduledWorkOrder = {
        ...latest,
        id: nextId,
        calendarLink: { ...latest.calendarLink, itemId: `${coordinator.calendarLink.itemId}-round-${nextRound}` },
        title: `${coordinator.title} — round ${nextRound}`,
        status: 'scheduled',
        startAt: nowIso,
        result: undefined,
        attention: undefined,
        runs: [],
        continuation,
        executionKey: {
          payloadDigest: scheduledWorkDefinitionDigest({ runId: continuation.runId, goalRevision, objective, round: nextRound, maxRounds, execution: latest.execution, inputRefs: latest.inputRefs }),
          idempotencyKey: `${continuation.runId}:round:${nextRound}:${goalRevision}`,
        },
        createdAt: canReuseUnstartedRound ? latest.createdAt : nowIso,
        updatedAt: nowIso,
      }
      const nextCoordinator: ScheduledWorkOrder = {
        ...coordinator,
        status: 'waiting',
        attention: undefined,
        continuation: { ...coordinator.continuation, goalRevision, objective, maxRounds, runtimeId: this.runtimeId, runnerFence },
        executionKey: {
          ...coordinator.executionKey,
          payloadDigest: scheduledWorkDefinitionDigest({ execution: coordinator.execution, goalRevision, objective, maxRounds }),
        },
        updatedAt: nowIso,
      }
      const items = canReuseUnstartedRound
        ? parsed.work.items.map((candidate) => candidate.id === coordinator.id ? nextCoordinator : candidate.id === latest.id ? successor : candidate)
        : [...parsed.work.items.map((candidate) => candidate.id === coordinator.id ? nextCoordinator : candidate), successor]
      const persisted = this.writeContinuationWork(workspaceId, workspaceRootPath, parsed.work, items, nextCoordinator, nowIso)
      return { work: persisted.work, coordinator: nextCoordinator }
    })
  }

  async scanWorkspace(
    workspaceId: string,
    workspaceRootPath: string,
    now = this.deps.now?.() ?? new Date(),
  ): Promise<ScheduledWorkRunnerResult> {
    if (!this.deps.canRunBackgroundWork(workspaceRootPath)) {
      return { scanned: 0, started: 0, blocked: 0, completed: 0, failed: 0 }
    }
    const capturedFence = this.deps.getBackgroundFenceToken?.(workspaceRootPath) ?? null
    if (this.deps.getBackgroundFenceToken && !capturedFence) {
      return { scanned: 0, started: 0, blocked: 0, completed: 0, failed: 0 }
    }
    if (this.inFlight.has(workspaceRootPath)) {
      return { scanned: 0, started: 0, blocked: 0, completed: 0, failed: 0 }
    }
    this.inFlight.add(workspaceRootPath)
    try {
      const parsed = this.readWork(workspaceRootPath, workspaceId)
      if (!parsed.ok) {
        this.log.warn(`[ScheduledWork] ${parsed.error}`)
        return { scanned: 0, started: 0, blocked: 0, completed: 0, failed: 0 }
      }
      const candidates = parsed.work.items
        .filter((order) => this.shouldScanOrder(order, now)
          && !this.activeAgentRuns.has(activeAgentRunKey(workspaceRootPath, order.id)))
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
        const currentContinuationIssue = this.continuationFenceIssue(workspaceRootPath, current)
        if (current.continuation?.role === 'round' && currentContinuationIssue) {
          const persisted = await this.stopContinuation(workspaceId, workspaceRootPath, current.id, currentContinuationIssue)
          if (persisted.updated) result.blocked += 1
          continue
        }
        if (current.status === 'needs-approval' && current.execution.type === 'social-publish') {
          if (!current.socialAction) {
            if (!this.deps.prepareSocial) continue
            try {
              if (!this.canContinue(workspaceRootPath, capturedFence)) continue
              const preview = await this.deps.prepareSocial({ workspaceId, workspaceRootPath, order: current })
              const persisted = await this.updateOrder(workspaceId, workspaceRootPath, current.id, (order, nowIso) => order.status === 'needs-approval' && order.execution.type === 'social-publish'
                ? { ...order, socialAction: preview, socialApproval: undefined, attention: undefined, updatedAt: nowIso }
                : null)
              if (persisted.updated) result.blocked += 1
            } catch (error) {
              const persisted = await this.updateOrder(workspaceId, workspaceRootPath, current.id, (order, nowIso) => order.status === 'needs-approval'
                ? { ...order, status: 'needs-attention', attention: this.buildAttention('execution-failed', `Social dry-run failed: ${errorMessage(error)}`), updatedAt: nowIso }
                : null)
              if (persisted.updated) result.failed += 1
            }
            continue
          }
          if (current.socialApproval && Date.parse(current.socialApproval.expiresAt) <= now.getTime()) {
            const persisted = await this.updateOrder(workspaceId, workspaceRootPath, current.id, (order, nowIso) => ({
              ...order,
              status: 'needs-attention',
              socialApproval: undefined,
              attention: this.buildAttention('approval-expired', 'Exact social approval expired. Prepare and approve the post again.'),
              updatedAt: nowIso,
            }))
            if (persisted.updated) result.blocked += 1
            continue
          }
          if (!current.socialApproval || Date.parse(current.startAt) > now.getTime()) continue
          if (!socialApprovalMatches(current)) {
            const persisted = await this.updateOrder(workspaceId, workspaceRootPath, current.id, (order, nowIso) => ({ ...order, status: 'needs-attention', attention: this.buildAttention('approval-invalidated', 'Social action changed after approval. Prepare and approve it again.'), updatedAt: nowIso }))
            if (persisted.updated) result.failed += 1
            continue
          }
          const profileKey = `${current.execution.platform}/${current.execution.profileId}`
          if (this.activeSocialProfiles.has(profileKey) || !this.deps.executeSocial) continue
          if (this.deps.canExecuteSocialAutomatically && !this.deps.canExecuteSocialAutomatically(workspaceRootPath)) {
            const persisted = await this.updateOrder(workspaceId, workspaceRootPath, current.id, (order, nowIso) => ({
              ...order,
              status: 'needs-attention',
              attention: this.buildAttention('idempotency-unavailable', 'Automatic browser publishing is disabled in Shared Folder Team Mode because the destination cannot enforce an idempotency key. Publish manually or use an idempotent provider adapter.'),
              updatedAt: nowIso,
            }))
            if (persisted.updated) result.blocked += 1
            continue
          }
          const claimed = await this.claimSocialRunning(workspaceId, workspaceRootPath, current.id)
          if (!claimed.order || claimed.order.execution.type !== 'social-publish' || !claimed.order.socialAction || !claimed.order.socialApproval) continue
          this.activeSocialProfiles.add(profileKey)
          void this.runSocial(workspaceId, workspaceRootPath, claimed.order, capturedFence)
            .catch((error) => this.log.error(`[ScheduledWork] ${errorMessage(error)}`))
            .finally(() => this.activeSocialProfiles.delete(profileKey))
          result.started += 1
          continue
        }
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

          // Check the cap BEFORE claiming: a claimed order is already `running`,
          // so skipping after the claim would strand it with nothing executing.
          if (current.execution.type === 'agent-task'
            && this.activeAgentRuns.size >= MAX_CONCURRENT_AGENT_TASKS) {
            this.log.info(
              `[ScheduledWork] Deferring "${current.title}" — ${this.activeAgentRuns.size} agent tasks already running.`,
            )
            continue
          }

          const claimed = await this.claimRunning(workspaceId, workspaceRootPath, orderId)
          if (!claimed.order) continue
          if (claimed.order.execution.type === 'workflow-run') {
            const started = await this.startWorkflow(workspaceId, workspaceRootPath, claimed.order, capturedFence)
            if (started === 'started') result.started += 1
            if (started === 'failed') result.failed += 1
            continue
          }
          if (claimed.order.execution.type === 'agent-task') {
            const activeKey = activeAgentRunKey(workspaceRootPath, claimed.order.id)
            this.activeAgentRuns.add(activeKey)
            void this.runAgentTask(workspaceId, workspaceRootPath, claimed.order, capturedFence)
              .catch((error) => this.log.error(`[ScheduledWork] ${errorMessage(error)}`))
              .finally(() => this.activeAgentRuns.delete(activeKey))
            result.started += 1
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
          const outcome = await this.pollAgentSession(workspaceId, workspaceRootPath, current)
          if (outcome === 'done') result.completed += 1
          if (outcome === 'failed') result.failed += 1
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
          (order, nowIso) => ({
            ...order,
            status: 'needs-attention',
            socialApproval: undefined,
            attention: this.buildAttention(
              'execution-uncertain',
              'Runner restarted during social submission. The post may already be live. Verify the social account before creating any replacement.',
            ),
            updatedAt: nowIso,
            runs: updateLatestRun(order.runs, order.id, {
              status: 'failed',
              endedAt: nowIso,
              error: 'Execution outcome is uncertain after restart; automatic retry is blocked.',
            }),
          }),
        )
        if (persisted.updated) result.failed += 1
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
    capturedFence: string | null,
  ): Promise<'done' | 'failed'> {
    let sessionId = currentSessionId(order)
    try {
      const execution = order.execution
      if (execution.type !== 'agent-task') return 'failed'
      if (!this.canContinue(workspaceRootPath, capturedFence)) throw new Error('Team runner fence changed before scheduled agent execution.')
      const continuationIssue = this.continuationFenceIssue(workspaceRootPath, order)
      if (continuationIssue) {
        await this.stopContinuation(workspaceId, workspaceRootPath, order.id, continuationIssue)
        return 'failed'
      }
      const started = await this.deps.executeAgentTask({
        workOrderId: order.id,
        workspace: { id: workspaceId, rootPath: workspaceRootPath },
        agentSlug: execution.agentSlug,
        brief: execution.brief,
        permissionMode: execution.permissionMode,
        expectedOutput: execution.expectedOutput,
        inputRefs: order.inputRefs,
        continuation: order.continuation,
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
      if (order.continuation && !(await this.deps.awaitAgentCompletionBarrier?.(sessionId))) {
        await this.stopContinuation(
          workspaceId,
          workspaceRootPath,
          order.id,
          this.buildAttention('continuation-disarmed', 'Continuation stopped because session persistence could not be proven. Review the completed session before resuming.'),
        )
        return 'failed'
      }
      const outputs = this.matchExpectedOutputs(
        execution.expectedOutput,
        sessionId,
        this.deps.listOutputManifests(workspaceRootPath),
      )
      if (!outputs.satisfied) {
        if (order.continuation?.role === 'round') {
          await this.settleContinuationRound(workspaceId, workspaceRootPath, order.id, sessionId, [], undefined)
          return 'done'
        }
        await this.finishWithAttention(
          workspaceId,
          workspaceRootPath,
          order.id,
          this.buildAttention('required-output-missing', outputs.message ?? 'Required output was not produced.'),
        )
        return 'failed'
      }
      const processed = await this.postProcessAgentTask(workspaceId, workspaceRootPath, order, sessionId, outputs.matched)
      if (order.continuation?.role === 'round') {
        await this.settleContinuationRound(workspaceId, workspaceRootPath, order.id, sessionId, outputs.matched.map((output) => output.id), processed.sharedIntelContextSlugs)
      } else {
        await this.finishAgentDone(workspaceId, workspaceRootPath, order.id, sessionId, outputs.matched.map((output) => output.id), processed.sharedIntelContextSlugs)
      }
      return 'done'
    } catch (error) {
      const attention = this.buildAttention('execution-failed', errorMessage(error))
      if (order.continuation?.role === 'round') {
        await this.stopContinuation(workspaceId, workspaceRootPath, order.id, attention)
      } else {
        await this.finishWithAttention(workspaceId, workspaceRootPath, order.id, attention)
      }
      return 'failed'
    }
  }

  private async pollAgentSession(
    workspaceId: string,
    workspaceRootPath: string,
    order: ScheduledWorkOrder,
  ): Promise<'running' | 'done' | 'failed'> {
    const sessionId = currentSessionId(order)
    if (!sessionId || !this.deps.readAgentSession) {
      const attention = this.buildAttention('execution-failed', runningAgentMessage(order))
      const persisted = order.continuation?.role === 'round'
        ? await this.stopContinuation(workspaceId, workspaceRootPath, order.id, attention)
        : await this.finishWithAttention(workspaceId, workspaceRootPath, order.id, attention)
      return persisted.updated ? 'failed' : 'running'
    }
    const state = await this.deps.readAgentSession(sessionId)
    if (state === 'running') return 'running'
    if (state !== 'completed') {
      const attention = this.buildAttention(
          'execution-failed',
          state === 'missing'
            ? `Scheduled agent session ${sessionId} no longer exists.`
            : `Scheduled agent session ${sessionId} stopped before producing a final response.`,
        )
      const persisted = order.continuation?.role === 'round'
        ? await this.stopContinuation(workspaceId, workspaceRootPath, order.id, attention)
        : await this.finishWithAttention(workspaceId, workspaceRootPath, order.id, attention)
      return persisted.updated ? 'failed' : 'running'
    }
    if (order.continuation && !(await this.deps.awaitAgentCompletionBarrier?.(sessionId))) {
      const persisted = await this.stopContinuation(
        workspaceId,
        workspaceRootPath,
        order.id,
        this.buildAttention('continuation-disarmed', 'Continuation stopped because session persistence could not be proven after restart. Review the session before resuming.'),
      )
      return persisted.updated ? 'failed' : 'running'
    }
    if (order.execution.type !== 'agent-task') return 'failed'
    const outputs = this.matchExpectedOutputs(
      order.execution.expectedOutput,
      sessionId,
      this.deps.listOutputManifests(workspaceRootPath),
    )
    if (!outputs.satisfied) {
      if (order.continuation?.role === 'round') {
        const persisted = await this.settleContinuationRound(workspaceId, workspaceRootPath, order.id, sessionId, [], undefined)
        return persisted.updated ? 'done' : 'running'
      }
      const persisted = await this.finishWithAttention(
        workspaceId,
        workspaceRootPath,
        order.id,
        this.buildAttention('required-output-missing', outputs.message ?? 'Required output was not produced.'),
      )
      return persisted.updated ? 'failed' : 'running'
    }
    let processed: { sharedIntelContextSlugs?: string[] }
    try {
      processed = await this.postProcessAgentTask(workspaceId, workspaceRootPath, order, sessionId, outputs.matched)
    } catch (error) {
      const attention = this.buildAttention('execution-failed', errorMessage(error))
      const persisted = order.continuation?.role === 'round'
        ? await this.stopContinuation(workspaceId, workspaceRootPath, order.id, attention)
        : await this.finishWithAttention(workspaceId, workspaceRootPath, order.id, attention)
      return persisted.updated ? 'failed' : 'running'
    }
    const persisted = order.continuation?.role === 'round'
      ? await this.settleContinuationRound(workspaceId, workspaceRootPath, order.id, sessionId, outputs.matched.map((output) => output.id), processed.sharedIntelContextSlugs)
      : await this.finishAgentDone(
          workspaceId,
          workspaceRootPath,
          order.id,
          sessionId,
          outputs.matched.map((output) => output.id),
          processed.sharedIntelContextSlugs,
        )
    return persisted.updated ? 'done' : 'running'
  }

  private async runSocial(workspaceId: string, workspaceRootPath: string, order: ScheduledWorkOrder, capturedFence: string | null): Promise<void> {
    try {
      if (!this.deps.executeSocial || order.execution.type !== 'social-publish' || !order.socialAction || !order.socialApproval) return
      if (!this.canContinue(workspaceRootPath, capturedFence)) throw new Error('Team runner fence changed before social execution.')
      const result = await this.deps.executeSocial({ workspaceId, workspaceRootPath, order, preview: order.socialAction, approval: order.socialApproval })
      const nowIso = (this.deps.now?.() ?? new Date()).toISOString()
      const receipt: CampaignExternalExecutionReceipt = {
        id: result.receiptId,
        actionType: 'post-asset',
        platform: order.execution.platform,
        profileId: order.execution.profileId,
        accountSetId: order.execution.accountSetId,
        externalUrl: result.externalUrl,
        completedAt: nowIso,
        payloadDigest: order.executionKey.payloadDigest,
        approvalId: order.socialApproval.id,
        summary: result.summary,
      }
      await this.updateOrder(workspaceId, workspaceRootPath, order.id, (current, completedAt) => current.status === 'running'
        ? {
            ...current,
            status: 'done',
            result: { type: 'social-publish', receipt },
            attention: undefined,
            updatedAt: completedAt,
            runs: updateLatestRun(current.runs, current.id, { status: 'done', endedAt: completedAt, resultSummary: result.summary, externalReceipt: receipt }),
          }
        : null)
    } catch (error) {
      await this.finishWithAttention(workspaceId, workspaceRootPath, order.id, this.buildAttention('execution-failed', errorMessage(error)))
    }
  }

  private async startWorkflow(
    workspaceId: string,
    workspaceRootPath: string,
    order: ScheduledWorkOrder,
    capturedFence: string | null,
  ): Promise<'started' | 'failed'> {
    try {
      const execution = order.execution
      if (execution.type !== 'workflow-run') return 'failed'
      if (!this.canContinue(workspaceRootPath, capturedFence)) throw new Error('Team runner fence changed before workflow execution.')
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

  private async claimSocialRunning(workspaceId: string, workspaceRootPath: string, orderId: string): Promise<PersistResult> {
    return this.updateOrder(workspaceId, workspaceRootPath, orderId, (order, nowIso) => {
      if (order.status !== 'needs-approval' || order.execution.type !== 'social-publish' || !order.socialAction || !order.socialApproval) return null
      return { ...order, status: 'running', attention: undefined, updatedAt: nowIso, runs: [...order.runs, createCampaignJobRun({ jobId: order.id, status: 'running', startedAt: nowIso })] }
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
    sharedIntelContextSlugs?: string[],
  ): Promise<PersistResult> {
    return this.updateOrder(workspaceId, workspaceRootPath, orderId, (order, nowIso) => {
      if (order.status !== 'running' || order.execution.type !== 'agent-task') return null
      return {
        ...order,
        status: order.execution.expectedOutput.reviewRequired ? 'awaiting-review' : 'done',
        attention: undefined,
        updatedAt: nowIso,
        result: { type: 'agent-task', sessionId, outputIds, ...(sharedIntelContextSlugs?.length ? { sharedIntelContextSlugs } : {}) },
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

  private async postProcessAgentTask(
    workspaceId: string,
    workspaceRootPath: string,
    order: ScheduledWorkOrder,
    sessionId: string,
    outputs: OutputManifest[],
  ): Promise<{ sharedIntelContextSlugs?: string[] }> {
    if (order.execution.type !== 'agent-task' || !order.execution.postProcess) return {}
    if (!this.deps.postProcessAgentTask) {
      throw new Error(`Scheduled work postprocessor is unavailable: ${order.execution.postProcess}`)
    }
    return this.deps.postProcessAgentTask({ workspaceId, workspaceRootPath, order, sessionId, outputs })
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

  private continuationFenceIssue(
    workspaceRootPath: string,
    order: ScheduledWorkOrder,
  ): ScheduledWorkAttention | undefined {
    const continuation = order.continuation
    if (!continuation) return undefined
    if (continuation.runtimeId !== this.runtimeId) {
      return this.buildAttention('continuation-disarmed', 'Continuation was disarmed by an app restart or runner ownership change. Review the latest round before resuming.')
    }
    if (this.deps.getBackgroundFenceToken
      && this.deps.getBackgroundFenceToken(workspaceRootPath) !== continuation.runnerFence) {
      return this.buildAttention('continuation-disarmed', 'Continuation was disarmed because runner ownership changed. Review the latest round before resuming.')
    }
    const goal = loadContextDoc(workspaceRootPath, continuation.goalSlug)
    if (!goal || !goal.metadata.enabled || goal.metadata.status !== 'active') {
      return this.buildAttention('goal-not-active', `Continuation stopped because Goal @${continuation.goalSlug} is missing, disabled, or no longer active.`)
    }
    const revision = scheduledWorkDefinitionDigest({ metadata: goal.metadata, body: goal.body })
    if (revision !== continuation.goalRevision) {
      return this.buildAttention('goal-revision-changed', `Continuation stopped because Goal @${continuation.goalSlug} changed. Review the new objective before resuming.`)
    }
    return undefined
  }

  private async stopContinuation(
    workspaceId: string,
    workspaceRootPath: string,
    orderId: string,
    attention: ScheduledWorkAttention,
  ): Promise<PersistResult> {
    return this.deps.withLock(workspaceRootPath, async () => {
      const parsed = this.readWork(workspaceRootPath, workspaceId)
      if (!parsed.ok) throw new Error(parsed.error)
      const child = parsed.work.items.find((candidate) => candidate.id === orderId && !candidate.deletedAt)
      const continuation = child?.continuation
      if (!child || child.status === 'canceled' || continuation?.role !== 'round') return { updated: false, work: parsed.work, order: child }
      const coordinator = parsed.work.items.find((candidate) => candidate.id === continuation.coordinatorOrderId && !candidate.deletedAt)
      if (coordinator?.status === 'canceled') return { updated: false, work: parsed.work, order: child }
      if (!coordinator || coordinator.continuation?.role !== 'coordinator') {
        attention = this.buildAttention('continuation-state-invalid', 'Continuation coordinator is missing or invalid. No further round was started.')
      }
      const nowIso = (this.deps.now?.() ?? new Date()).toISOString()
      const stoppedChild: ScheduledWorkOrder = {
        ...child,
        status: 'needs-attention',
        attention,
        updatedAt: nowIso,
        runs: child.status === 'running'
          ? updateLatestRun(child.runs, child.id, { status: 'failed', endedAt: nowIso, error: attention.message })
          : child.runs,
      }
      const items = parsed.work.items.map((candidate) => {
        if (candidate.id === stoppedChild.id) return stoppedChild
        if (candidate.id === coordinator?.id) return { ...coordinator, status: 'needs-attention' as const, attention, runs: mergeCoordinatorRun(coordinator.runs, stoppedChild.runs.at(-1)), updatedAt: nowIso }
        return candidate
      })
      const work = { ...parsed.work, items, updatedAt: nowIso }
      this.writeWork(workspaceRootPath, work)
      this.deps.emitContextChanged?.(workspaceId, loadAllContextDocs(workspaceRootPath))
      return { updated: true, work, order: stoppedChild }
    })
  }

  private async settleContinuationRound(
    workspaceId: string,
    workspaceRootPath: string,
    orderId: string,
    sessionId: string,
    outputIds: string[],
    sharedIntelContextSlugs?: string[],
  ): Promise<PersistResult> {
    return this.deps.withLock(workspaceRootPath, async () => {
      const parsed = this.readWork(workspaceRootPath, workspaceId)
      if (!parsed.ok) throw new Error(parsed.error)
      const child = parsed.work.items.find((candidate) => candidate.id === orderId && !candidate.deletedAt)
      const continuation = child?.continuation
      if (!child || child.status !== 'running' || child.execution.type !== 'agent-task' || continuation?.role !== 'round') {
        return { updated: false, work: parsed.work, order: child }
      }
      const coordinator = parsed.work.items.find((candidate) => candidate.id === continuation.coordinatorOrderId && !candidate.deletedAt)
      if (!coordinator || coordinator.continuation?.role !== 'coordinator') {
        return this.stopContinuationUnlocked(parsed.work, child, undefined, this.buildAttention('continuation-state-invalid', 'Continuation coordinator is missing or invalid. No further round was started.'), workspaceId, workspaceRootPath)
      }
      const fenceIssue = this.continuationFenceIssue(workspaceRootPath, child)
      if (fenceIssue) return this.stopContinuationUnlocked(parsed.work, child, coordinator, fenceIssue, workspaceId, workspaceRootPath)

      const nowIso = (this.deps.now?.() ?? new Date()).toISOString()
      const result = { type: 'agent-task' as const, sessionId, outputIds, ...(sharedIntelContextSlugs?.length ? { sharedIntelContextSlugs } : {}) }
      const completedChild: ScheduledWorkOrder = {
        ...child,
        status: 'done',
        attention: undefined,
        result,
        updatedAt: nowIso,
        runs: updateLatestRun(child.runs, child.id, {
          status: 'done',
          sessionId,
          endedAt: nowIso,
          resultSummary: outputIds.length > 0 ? `Completed with ${outputIds.length} output${outputIds.length === 1 ? '' : 's'}.` : 'Round completed without the required Output.',
        }),
      }

      if (outputIds.length > 0) {
        const completedCoordinator: ScheduledWorkOrder = { ...coordinator, status: 'done', attention: undefined, result, runs: mergeCoordinatorRun(coordinator.runs, completedChild.runs.at(-1)), updatedAt: nowIso }
        const items = parsed.work.items.map((candidate) => candidate.id === child.id ? completedChild : candidate.id === coordinator.id ? completedCoordinator : candidate)
        return this.writeContinuationWork(workspaceId, workspaceRootPath, parsed.work, items, completedChild, nowIso)
      }

      if (continuation.round >= continuation.maxRounds) {
        const attention = this.buildAttention('continuation-round-limit', `Continuation reached its ${continuation.maxRounds}-round limit without the required Output. Review the round history before resuming.`)
        const limitedChild = { ...completedChild, status: 'needs-attention' as const, attention }
        const limitedCoordinator: ScheduledWorkOrder = { ...coordinator, status: 'needs-attention', attention, runs: mergeCoordinatorRun(coordinator.runs, limitedChild.runs.at(-1)), updatedAt: nowIso }
        const items = parsed.work.items.map((candidate) => candidate.id === child.id ? limitedChild : candidate.id === coordinator.id ? limitedCoordinator : candidate)
        return this.writeContinuationWork(workspaceId, workspaceRootPath, parsed.work, items, limitedChild, nowIso)
      }

      const nextRound = continuation.round + 1
      const nextId = `${continuation.coordinatorOrderId}-round-${nextRound}`
      const existingNext = parsed.work.items.find((candidate) => candidate.id === nextId)
      const successor: ScheduledWorkOrder = existingNext ?? {
        ...child,
        id: nextId,
        calendarLink: { ...child.calendarLink, itemId: `${coordinator.calendarLink.itemId}-round-${nextRound}` },
        title: `${coordinator.title} — round ${nextRound}`,
        status: 'scheduled',
        startAt: nowIso,
        result: undefined,
        attention: undefined,
        runs: [],
        continuation: {
          ...continuation,
          round: nextRound,
          parentOrderId: child.id,
          priorRoundSessionId: sessionId,
          priorRoundOutputIds: outputIds,
        },
        executionKey: {
          payloadDigest: scheduledWorkDefinitionDigest({ runId: continuation.runId, goalRevision: continuation.goalRevision, round: nextRound, execution: child.execution, inputRefs: child.inputRefs }),
          idempotencyKey: `${continuation.runId}:round:${nextRound}:${continuation.goalRevision}`,
        },
        createdAt: nowIso,
        updatedAt: nowIso,
      }
      const waitingCoordinator: ScheduledWorkOrder = { ...coordinator, status: 'waiting', attention: undefined, runs: mergeCoordinatorRun(coordinator.runs, completedChild.runs.at(-1)), updatedAt: nowIso }
      let items = parsed.work.items.map((candidate) => candidate.id === child.id ? completedChild : candidate.id === coordinator.id ? waitingCoordinator : candidate)
      if (!existingNext) items = [...items, successor]
      return this.writeContinuationWork(workspaceId, workspaceRootPath, parsed.work, items, completedChild, nowIso)
    })
  }

  private stopContinuationUnlocked(
    base: ScheduledWorkDocument,
    child: ScheduledWorkOrder,
    coordinator: ScheduledWorkOrder | undefined,
    attention: ScheduledWorkAttention,
    workspaceId: string,
    workspaceRootPath: string,
  ): PersistResult {
    const nowIso = (this.deps.now?.() ?? new Date()).toISOString()
    const stoppedChild: ScheduledWorkOrder = {
      ...child,
      status: 'needs-attention',
      attention,
      updatedAt: nowIso,
      runs: updateLatestRun(child.runs, child.id, { status: 'failed', endedAt: nowIso, error: attention.message }),
    }
    const items = base.items.map((candidate) => candidate.id === child.id
      ? stoppedChild
      : candidate.id === coordinator?.id
        ? { ...coordinator, status: 'needs-attention' as const, attention, runs: mergeCoordinatorRun(coordinator.runs, stoppedChild.runs.at(-1)), updatedAt: nowIso }
        : candidate)
    return this.writeContinuationWork(workspaceId, workspaceRootPath, base, items, stoppedChild, nowIso)
  }

  private writeContinuationWork(
    workspaceId: string,
    workspaceRootPath: string,
    base: ScheduledWorkDocument,
    items: ScheduledWorkOrder[],
    order: ScheduledWorkOrder,
    nowIso: string,
  ): PersistResult {
    const work = { ...base, items, updatedAt: nowIso }
    this.writeWork(workspaceRootPath, work)
    this.deps.emitContextChanged?.(workspaceId, loadAllContextDocs(workspaceRootPath))
    return { updated: true, work, order }
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
      let items = parsed.work.items.map((candidate, candidateIndex) => candidateIndex === index ? nextOrder : candidate)
      if (nextOrder.status === 'done') {
        items = this.releaseSuccessor(items, nextOrder, nowIso, workspaceRootPath)
      }
      const nextWork: ScheduledWorkDocument = {
        ...parsed.work,
        items,
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
    if (order.status === 'needs-approval' && order.execution.type === 'social-publish') {
      const profileKey = `${order.execution.platform}/${order.execution.profileId}`
      const startAt = Date.parse(order.startAt)
      const insidePreparationWindow = !Number.isNaN(startAt) && startAt - now.getTime() <= SOCIAL_PREP_WINDOW_MS
      return insidePreparationWindow
        && !this.activeSocialProfiles.has(profileKey)
        && (!order.socialAction || Boolean(order.socialApproval))
    }
    if (order.status !== 'scheduled') return false
    const startedAt = Date.parse(order.startAt)
    return !Number.isNaN(startedAt) && startedAt <= now.getTime()
  }

  private releaseSuccessor(
    items: ScheduledWorkOrder[],
    parent: ScheduledWorkOrder,
    nowIso: string,
    workspaceRootPath: string,
  ): ScheduledWorkOrder[] {
    const childIndex = items.findIndex((candidate) => candidate.status === 'waiting'
      && candidate.chain?.predecessor?.orderId === parent.id
      && candidate.chain.predecessor.releaseOn === 'success')
    if (childIndex < 0) return items
    const child = items[childIndex]!
    const outputIds = parent.result && 'outputIds' in parent.result ? parent.result.outputIds : []
    const manifests = this.deps.listOutputManifests(workspaceRootPath)
    const parentResultDigest = scheduledWorkDefinitionDigest(parent.result)
    let issue: ScheduledWorkAttention | undefined
    const inputRefs = child.inputRefs.map((ref) => {
      if (ref.kind !== 'produced-output') return ref
      const candidates = manifests.filter((manifest) => outputIds.includes(manifest.id)
        && (!ref.selector?.kind || manifest.kind === ref.selector.kind))
      if (candidates.length === 0) {
        issue = this.buildAttention('produced-output-missing', `No Output from ${parent.title} matched the follow-up selector.`)
        return ref
      }
      if (candidates.length > 1) {
        issue = this.buildAttention('produced-output-ambiguous', `${candidates.length} Outputs from ${parent.title} matched. Choose the exact Output before continuing.`)
        return ref
      }
      return {
        ...ref,
        resolution: {
          outputId: candidates[0]!.id,
          parentResultDigest,
          source: 'automatic' as const,
          resolvedAt: nowIso,
        },
      }
    })
    let execution = child.execution
    if (!issue && execution.type === 'workflow-run') {
      const workflowRef = inputRefs.find((ref) => ref.kind === 'produced-output' && ref.bindTo.kind === 'workflow-trigger')
      if (workflowRef?.kind === 'produced-output' && workflowRef.resolution && workflowRef.bindTo.kind === 'workflow-trigger') {
        execution = {
          ...execution,
          triggerInputs: { ...execution.triggerInputs, [workflowRef.bindTo.input]: workflowRef.resolution.outputId },
        }
      }
    }
    const nextChild: ScheduledWorkOrder = issue ? {
      ...child,
      status: 'needs-attention',
      attention: issue,
      updatedAt: nowIso,
    } : {
      ...child,
      status: child.type === 'review' ? 'awaiting-review' : 'scheduled',
      attention: undefined,
      inputRefs,
      execution,
      updatedAt: nowIso,
    }
    return items.map((candidate, candidateIndex) => candidateIndex === childIndex ? nextChild : candidate)
  }

  private buildAttention(reason: ScheduledWorkAttention['reason'], message: string): ScheduledWorkAttention {
    return { reason, message }
  }
}

function socialApprovalMatches(order: ScheduledWorkOrder): boolean {
  if (order.execution.type !== 'social-publish' || !order.socialAction || !order.socialApproval) return false
  return order.socialApproval.actionId === order.socialAction.actionId
    && order.socialApproval.actionDigest === order.socialAction.actionDigest
    && order.socialApproval.mediaDigest === order.socialAction.mediaDigest
    && order.socialApproval.payloadDigest === order.executionKey.payloadDigest
    && order.socialApproval.platform === order.execution.platform
    && order.socialApproval.profileId === order.execution.profileId
}

function activeAgentRunKey(workspaceRootPath: string, orderId: string): string {
  return `${workspaceRootPath}:${orderId}`
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

function mergeCoordinatorRun(runs: CampaignJobRun[], roundRun: CampaignJobRun | undefined): CampaignJobRun[] {
  if (!roundRun) return runs
  const existing = runs.findIndex((candidate) => candidate.id === roundRun.id)
  return existing >= 0
    ? runs.map((candidate, index) => index === existing ? roundRun : candidate)
    : [...runs, roundRun]
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
