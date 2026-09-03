import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { OutputManifest } from '@craft-agent/shared/outputs'
import {
  CAMPAIGN_CALENDAR_CONTEXT_SLUG,
  campaignCalendarMetadata,
  createCampaignCalendarItem,
  createCampaignScheduledJob,
  parseCampaignCalendarDocResult,
  serializeCampaignCalendarBody,
} from '@craft-agent/shared/campaign-calendar'
import { materializeReleaseKitItem, updateReleaseKitItemUsage } from '@craft-agent/shared/release-kit'
import {
  SCHEDULED_WORK_CONTEXT_SLUG,
  parseScheduledWorkDocResult,
  scheduledWorkMetadata,
  serializeScheduledWorkBody,
  scheduledWorkDefinitionDigest,
  type ScheduledWorkDocument,
  type ScheduledWorkOrder,
} from '@craft-agent/shared/scheduled-work'
import { loadContextDoc, upsertContextDoc } from '@craft-agent/shared/workspace-context'
import type { WorkflowRunSnapshot } from '@craft-agent/shared/workflows'
import { ScheduledWorkRunner } from './ScheduledWorkRunner'

const workspaceId = 'campaign-1'

let roots: string[] = []

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
  roots = []
})

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'scheduled-work-runner-'))
  roots.push(root)
  return root
}

function writeWork(root: string, items: ScheduledWorkOrder[], targetWorkspaceId = workspaceId): void {
  const work: ScheduledWorkDocument = {
    version: 1,
    workspaceId: targetWorkspaceId,
    items,
    updatedAt: '2026-07-09T00:00:00.000Z',
  }
  upsertContextDoc(root, {
    slug: SCHEDULED_WORK_CONTEXT_SLUG,
    metadata: scheduledWorkMetadata(),
    body: serializeScheduledWorkBody(work),
  })
}

function writeGoal(root: string, body = 'Finish the launch plan.'): string {
  const metadata = {
    name: 'Launch Goal',
    routing: { mode: 'broadcast' as const },
    enabled: true,
    status: 'active' as const,
  }
  upsertContextDoc(root, { slug: 'launch-goal', metadata, body })
  const loaded = loadContextDoc(root, 'launch-goal')!
  return scheduledWorkDefinitionDigest({ metadata: loaded.metadata, body: loaded.body })
}

function continuationOrders(runtimeId: string, goalRevision: string, round = 1, maxRounds = 3): ScheduledWorkOrder[] {
  const execution = {
    type: 'agent-task' as const,
    agentSlug: 'content-genius',
    brief: 'Finish the launch plan.',
    permissionMode: 'safe' as const,
    expectedOutput: { requirement: 'required' as const, kind: 'report' as const },
  }
  const coordinator = buildOrder({
    id: 'goal-coordinator',
    status: 'waiting',
    execution,
    continuation: {
      role: 'coordinator', runId: 'goal-run-1', coordinatorOrderId: 'goal-coordinator',
      goalSlug: 'launch-goal', goalRevision, objective: 'Finish the launch plan.',
      round: 0, maxRounds, runtimeId, permissionCeiling: 'safe',
      runnerFence: 'solo',
    },
  })
  const child = buildOrder({
    id: `goal-coordinator-round-${round}`,
    title: `Launch plan — round ${round}`,
    status: 'scheduled',
    calendarVisibility: 'hidden',
    calendarLink: { calendar: 'campaign', itemId: `calendar-round-${round}` },
    execution,
    continuation: {
      role: 'round', runId: 'goal-run-1', coordinatorOrderId: 'goal-coordinator',
      goalSlug: 'launch-goal', goalRevision, objective: 'Finish the launch plan.',
      round, maxRounds, runtimeId, permissionCeiling: 'safe', parentOrderId: round === 1 ? 'goal-coordinator' : `goal-coordinator-round-${round - 1}`,
      runnerFence: 'solo',
    },
  })
  return [coordinator, child]
}

function readWork(root: string, targetWorkspaceId = workspaceId): ScheduledWorkDocument {
  const parsed = parseScheduledWorkDocResult(loadContextDoc(root, SCHEDULED_WORK_CONTEXT_SLUG) ?? undefined, targetWorkspaceId)
  if (!parsed.ok) throw new Error(parsed.error)
  return parsed.work
}

function buildOrder(overrides: Partial<ScheduledWorkOrder> = {}): ScheduledWorkOrder {
  const execution = overrides.execution ?? {
    type: 'agent-task' as const,
    agentSlug: 'content-genius',
    brief: 'Write launch copy.',
    permissionMode: 'safe' as const,
    expectedOutput: { requirement: 'none' as const },
  }
  const type = overrides.type ?? execution.type
  return {
    version: 1,
    id: overrides.id ?? 'order-1',
    owner: overrides.owner ?? { scope: 'campaign', workspaceId, campaignId: workspaceId },
    calendarLink: overrides.calendarLink ?? { calendar: 'campaign', itemId: 'calendar-1' },
    calendarVisibility: overrides.calendarVisibility,
    title: overrides.title ?? 'Launch copy',
    type,
    status: overrides.status ?? 'scheduled',
    startAt: overrides.startAt ?? '2026-07-10T14:00:00.000Z',
    timezone: overrides.timezone ?? 'America/Chicago',
    execution,
    inputRefs: overrides.inputRefs ?? [],
    approvals: overrides.approvals ?? [],
    runs: overrides.runs ?? [],
    result: overrides.result,
    reviewDecision: overrides.reviewDecision,
    socialAction: overrides.socialAction,
    socialApproval: overrides.socialApproval,
    authorization: overrides.authorization,
    authorizationPolicy: overrides.authorizationPolicy,
    attention: overrides.attention,
    inputRequest: overrides.inputRequest,
    inputSupplyReceipt: overrides.inputSupplyReceipt,
    automationRef: overrides.automationRef,
    executionKey: overrides.executionKey ?? { payloadDigest: 'digest-1', idempotencyKey: 'idem-1' },
    chain: overrides.chain,
    continuation: overrides.continuation,
    legacyRef: overrides.legacyRef,
    createdAt: overrides.createdAt ?? '2026-07-09T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-07-09T00:00:00.000Z',
    deletedAt: overrides.deletedAt,
  }
}

function buildManifest(id: string, sessionId: string, kind: OutputManifest['kind'] = 'report'): OutputManifest {
  return {
    schemaVersion: 1,
    id,
    workspaceId,
    title: `Output ${id}`,
    slug: `output-${id}`,
    kind,
    status: 'published',
    summary: 'Scheduled output.',
    createdAt: '2026-07-10T14:00:00.000Z',
    updatedAt: '2026-07-10T14:00:00.000Z',
    origin: { source: 'session', sessionId },
    assets: [],
    receipts: [],
    links: [],
  }
}

function stableAuthorizationJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableAuthorizationJson).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${stableAuthorizationJson(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function createLock() {
  const queue = new Map<string, Promise<void>>()
  return async function withLock<T>(root: string, fn: () => Promise<T> | T): Promise<T> {
    const previous = queue.get(root) ?? Promise.resolve()
    const next = previous.then(fn, fn)
    queue.set(root, next.then(() => {}, () => {}))
    return next
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

async function waitFor(predicate: () => boolean, attempts = 100): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (predicate()) return
    await Promise.resolve()
  }
  throw new Error('Condition was not met in time.')
}

describe('ScheduledWorkRunner', () => {
  test('ignores needs-setup work without blocking a due background order', async () => {
    const root = makeRoot()
    const started: string[] = []
    const runner = new ScheduledWorkRunner({
      canRunBackgroundWork: () => true,
      withLock: createLock(),
      executeAgentTask: async ({ workOrderId, onStarted }) => {
        started.push(workOrderId)
        await onStarted(`session-${workOrderId}`)
        return { sessionId: `session-${workOrderId}` }
      },
      startWorkflow: async () => ({ runId: 'unused' }),
      readWorkflowRun: () => null,
      listOutputManifests: () => [],
      awaitAgentCompletionBarrier: async () => true,
    })
    const waiting = buildOrder({
      id: 'waiting-input',
      type: 'workflow-run',
      status: 'needs-setup',
      execution: { type: 'workflow-run', workflowSlug: 'merch-run', workflowDigest: 'workflow-v1', triggerInputs: {} },
      attention: { reason: 'input-required', message: 'Waiting for: design_file' },
      inputRequest: {
        id: 'waiting-input:input', inputs: ['design_file'],
        requestedAt: '2026-07-09T00:00:00.000Z', lastTriggeredAt: '2026-07-09T00:00:00.000Z',
        coalescedFireCount: 1, fireDefinitionDigests: ['fire-1'],
      },
    })
    const due = buildOrder({ id: 'due-agent', createdAt: '2026-07-09T00:01:00.000Z' })
    writeWork(root, [waiting, due])

    const result = await runner.scanWorkspace(workspaceId, root, new Date('2026-07-10T14:01:00.000Z'))
    await waitFor(() => started.length === 1)
    expect(result.scanned).toBe(1)
    expect(started).toEqual(['due-agent'])
  })

  test('advances a completed continuation round without Output by creating one hidden successor', async () => {
    const root = makeRoot()
    const runner = new ScheduledWorkRunner({
      canRunBackgroundWork: () => true,
      withLock: createLock(),
      executeAgentTask: async ({ onStarted }) => { await onStarted('goal-session-1'); return { sessionId: 'goal-session-1' } },
      startWorkflow: async () => ({ runId: 'unused' }),
      readWorkflowRun: () => null,
      listOutputManifests: () => [],
      awaitAgentCompletionBarrier: async () => true,
    })
    const revision = writeGoal(root)
    writeWork(root, continuationOrders(runner.runtimeId, revision))

    await runner.scanWorkspace(workspaceId, root, new Date('2026-07-10T14:01:00.000Z'))
    await waitFor(() => readWork(root).items.some((item) => item.id === 'goal-coordinator-round-2'))

    const work = readWork(root)
    expect(work.items.find((item) => item.id === 'goal-coordinator')?.status).toBe('waiting')
    expect(work.items.find((item) => item.id === 'goal-coordinator-round-1')?.status).toBe('done')
    const successors = work.items.filter((item) => item.id === 'goal-coordinator-round-2')
    expect(successors).toHaveLength(1)
    expect(successors[0]?.calendarVisibility).toBe('hidden')
    expect(successors[0]?.status).toBe('scheduled')
    expect(successors[0]?.continuation?.priorRoundSessionId).toBe('goal-session-1')
  })

  test('does not advance when the completed-session persistence barrier cannot be proven', async () => {
    const root = makeRoot()
    const runner = new ScheduledWorkRunner({
      canRunBackgroundWork: () => true,
      withLock: createLock(),
      executeAgentTask: async ({ onStarted }) => { await onStarted('goal-session-unflushed'); return { sessionId: 'goal-session-unflushed' } },
      startWorkflow: async () => ({ runId: 'unused' }),
      readWorkflowRun: () => null,
      listOutputManifests: () => [],
      awaitAgentCompletionBarrier: async () => false,
    })
    const revision = writeGoal(root)
    writeWork(root, continuationOrders(runner.runtimeId, revision))

    await runner.scanWorkspace(workspaceId, root, new Date('2026-07-10T14:01:00.000Z'))
    await waitFor(() => readWork(root).items.find((item) => item.id === 'goal-coordinator')?.status === 'needs-attention')

    const work = readWork(root)
    expect(work.items.find((item) => item.id === 'goal-coordinator')?.attention?.reason).toBe('continuation-disarmed')
    expect(work.items.some((item) => item.id === 'goal-coordinator-round-2')).toBe(false)
  })

  test('completes the coordinator when a continuation round produces the required Output', async () => {
    const root = makeRoot()
    const manifest = buildManifest('goal-output', 'goal-session-2')
    const runner = new ScheduledWorkRunner({
      canRunBackgroundWork: () => true,
      withLock: createLock(),
      executeAgentTask: async ({ onStarted }) => { await onStarted('goal-session-2'); return { sessionId: 'goal-session-2' } },
      startWorkflow: async () => ({ runId: 'unused' }),
      readWorkflowRun: () => null,
      listOutputManifests: () => [manifest],
      awaitAgentCompletionBarrier: async () => true,
    })
    const revision = writeGoal(root)
    writeWork(root, continuationOrders(runner.runtimeId, revision))

    await runner.scanWorkspace(workspaceId, root, new Date('2026-07-10T14:01:00.000Z'))
    await waitFor(() => readWork(root).items.find((item) => item.id === 'goal-coordinator')?.status === 'done')

    const coordinator = readWork(root).items.find((item) => item.id === 'goal-coordinator')
    expect(coordinator?.result).toEqual({ type: 'agent-task', sessionId: 'goal-session-2', outputIds: ['goal-output'] })
    expect(readWork(root).items.some((item) => item.id === 'goal-coordinator-round-2')).toBe(false)
  })

  test('disarms persisted continuation work before execution after a runner restart', async () => {
    const root = makeRoot()
    const revision = writeGoal(root)
    writeWork(root, continuationOrders('previous-runtime', revision))
    let executions = 0
    const runner = new ScheduledWorkRunner({
      canRunBackgroundWork: () => true,
      withLock: createLock(),
      executeAgentTask: async () => { executions += 1; return { sessionId: 'should-not-run' } },
      startWorkflow: async () => ({ runId: 'unused' }),
      readWorkflowRun: () => null,
      listOutputManifests: () => [],
      awaitAgentCompletionBarrier: async () => true,
    })

    await runner.scanWorkspace(workspaceId, root, new Date('2026-07-10T14:01:00.000Z'))

    expect(executions).toBe(0)
    expect(readWork(root).items.find((item) => item.id === 'goal-coordinator')?.attention?.reason).toBe('continuation-disarmed')
    expect(readWork(root).items.find((item) => item.id === 'goal-coordinator-round-1')?.status).toBe('needs-attention')
  })

  test('stops continuation when the Goal revision changes', async () => {
    const root = makeRoot()
    const runner = new ScheduledWorkRunner({
      canRunBackgroundWork: () => true,
      withLock: createLock(),
      executeAgentTask: async () => ({ sessionId: 'should-not-run' }),
      startWorkflow: async () => ({ runId: 'unused' }),
      readWorkflowRun: () => null,
      listOutputManifests: () => [],
      awaitAgentCompletionBarrier: async () => true,
    })
    const revision = writeGoal(root)
    writeWork(root, continuationOrders(runner.runtimeId, revision))
    writeGoal(root, 'A changed launch objective.')

    await runner.scanWorkspace(workspaceId, root, new Date('2026-07-10T14:01:00.000Z'))

    expect(readWork(root).items.find((item) => item.id === 'goal-coordinator')?.attention?.reason).toBe('goal-revision-changed')
  })

  test('disarms continuation when Team Mode runner ownership changes', async () => {
    const root = makeRoot()
    let fence = 'owner-a'
    const runner = new ScheduledWorkRunner({
      canRunBackgroundWork: () => true,
      getBackgroundFenceToken: () => fence,
      withLock: createLock(),
      executeAgentTask: async () => ({ sessionId: 'should-not-run' }),
      startWorkflow: async () => ({ runId: 'unused' }),
      readWorkflowRun: () => null,
      listOutputManifests: () => [],
      awaitAgentCompletionBarrier: async () => true,
    })
    const revision = writeGoal(root)
    const items = continuationOrders(runner.runtimeId, revision).map((item) => ({
      ...item,
      continuation: item.continuation ? { ...item.continuation, runnerFence: 'owner-a' } : undefined,
    }))
    writeWork(root, items)
    fence = 'owner-b'

    await runner.scanWorkspace(workspaceId, root, new Date('2026-07-10T14:01:00.000Z'))

    expect(readWork(root).items.find((item) => item.id === 'goal-coordinator')?.attention?.reason).toBe('continuation-disarmed')
  })

  test('stops visibly at the continuation round limit', async () => {
    const root = makeRoot()
    const runner = new ScheduledWorkRunner({
      canRunBackgroundWork: () => true,
      getBackgroundFenceToken: () => 'solo',
      withLock: createLock(),
      executeAgentTask: async ({ onStarted }) => { await onStarted('goal-session-limit'); return { sessionId: 'goal-session-limit' } },
      startWorkflow: async () => ({ runId: 'unused' }),
      readWorkflowRun: () => null,
      listOutputManifests: () => [],
      awaitAgentCompletionBarrier: async () => true,
    })
    const revision = writeGoal(root)
    writeWork(root, continuationOrders(runner.runtimeId, revision, 2, 2))

    await runner.scanWorkspace(workspaceId, root, new Date('2026-07-10T14:01:00.000Z'))
    await waitFor(() => readWork(root).items.find((item) => item.id === 'goal-coordinator')?.status === 'needs-attention')

    expect(readWork(root).items.find((item) => item.id === 'goal-coordinator')?.attention?.reason).toBe('continuation-round-limit')
    expect(readWork(root).items.some((item) => item.id === 'goal-coordinator-round-3')).toBe(false)
  })

  test('re-arms an unstarted stopped round in place without spending round budget', async () => {
    const root = makeRoot()
    const revision = writeGoal(root)
    writeWork(root, continuationOrders('previous-runtime', revision))
    const runner = new ScheduledWorkRunner({
      canRunBackgroundWork: () => true,
      getBackgroundFenceToken: () => 'solo',
      withLock: createLock(),
      executeAgentTask: async () => ({ sessionId: 'unused' }),
      startWorkflow: async () => ({ runId: 'unused' }),
      readWorkflowRun: () => null,
      listOutputManifests: () => [],
      awaitAgentCompletionBarrier: async () => true,
    })
    await runner.scanWorkspace(workspaceId, root, new Date('2026-07-10T14:01:00.000Z'))
    const stopped = readWork(root).items.find((item) => item.id === 'goal-coordinator')!

    const result = await runner.manageGoalRun(workspaceId, root, {
      runId: 'goal-run-1', operation: 'rearm', expectedUpdatedAt: stopped.updatedAt,
      explanation: 'User reviewed the stopped round.', objective: 'Finish the launch plan.',
    })

    expect(result.coordinator.status).toBe('waiting')
    const successor = result.work.items.find((item) => item.id === 'goal-coordinator-round-1')
    expect(successor?.status).toBe('scheduled')
    expect(successor?.continuation?.runtimeId).toBe(runner.runtimeId)
    expect(successor?.continuation?.round).toBe(1)
    expect(result.work.items.some((item) => item.id === 'goal-coordinator-round-2')).toBe(false)
  })

  test('pauses a waiting continuation without starting another round', async () => {
    const root = makeRoot()
    const runner = new ScheduledWorkRunner({
      canRunBackgroundWork: () => true,
      withLock: createLock(),
      executeAgentTask: async () => ({ sessionId: 'unused' }),
      startWorkflow: async () => ({ runId: 'unused' }),
      readWorkflowRun: () => null,
      listOutputManifests: () => [],
      awaitAgentCompletionBarrier: async () => true,
    })
    const revision = writeGoal(root)
    writeWork(root, continuationOrders(runner.runtimeId, revision))
    const coordinator = readWork(root).items.find((item) => item.id === 'goal-coordinator')!

    const result = await runner.manageGoalRun(workspaceId, root, {
      runId: 'goal-run-1', operation: 'pause', expectedUpdatedAt: coordinator.updatedAt,
      explanation: 'User paused the run.',
    })

    expect(result.coordinator.status).toBe('needs-attention')
    expect(result.coordinator.attention?.reason).toBe('continuation-disarmed')
    expect(result.work.items.find((item) => item.id === 'goal-coordinator-round-1')?.status).toBe('needs-attention')
  })
  test('falls back to console logging when no logger is injected', async () => {
    const root = makeRoot()
    upsertContextDoc(root, {
      slug: SCHEDULED_WORK_CONTEXT_SLUG,
      metadata: scheduledWorkMetadata(),
      body: 'malformed scheduled work',
    })
    const warning = spyOn(console, 'warn').mockImplementation(() => {})
    const runner = new ScheduledWorkRunner({
      canRunBackgroundWork: () => true,
      withLock: createLock(),
      executeAgentTask: async () => ({ sessionId: 'unused' }),
      startWorkflow: async () => ({ runId: 'unused' }),
      readWorkflowRun: () => null,
      listOutputManifests: () => [],
    })

    try {
      await runner.scanWorkspace(workspaceId, root)
      expect(warning).toHaveBeenCalled()
    } finally {
      warning.mockRestore()
    }
  })

  test('skips scheduled work when this machine is not the background runner', async () => {
    const root = makeRoot()
    writeWork(root, [buildOrder()])
    let executions = 0
    const runner = new ScheduledWorkRunner({
      canRunBackgroundWork: () => false,
      withLock: createLock(),
      executeAgentTask: async () => {
        executions += 1
        return { sessionId: 'should-not-start' }
      },
      startWorkflow: async () => ({ runId: 'should-not-start' }),
      readWorkflowRun: () => null,
      listOutputManifests: () => [],
    })

    const result = await runner.scanWorkspace(workspaceId, root, new Date('2026-07-10T14:01:00.000Z'))

    expect(result).toEqual({ scanned: 0, started: 0, blocked: 0, completed: 0, failed: 0 })
    expect(executions).toBe(0)
    expect(readWork(root).items[0]?.status).toBe('scheduled')
  })

  test('keeps an agent task running after launch, persists the session id immediately, and blocks duplicate scans', async () => {
    const root = makeRoot()
    writeWork(root, [buildOrder()])

    const execution = deferred<void>()
    const executeCalls: string[] = []
    const runner = new ScheduledWorkRunner({
      canRunBackgroundWork: () => true,
      withLock: createLock(),
      executeAgentTask: async ({ workOrderId, onStarted }) => {
        executeCalls.push(workOrderId)
        await onStarted('session-1')
        await execution.promise
        return { sessionId: 'session-1' }
      },
      startWorkflow: async () => ({ runId: 'wf-unused' }),
      readWorkflowRun: () => null,
      listOutputManifests: () => [],
    })

    const firstScan = runner.scanWorkspace(workspaceId, root, new Date('2026-07-10T14:01:00.000Z'))
    await waitFor(() => readWork(root).items[0]?.runs.at(-1)?.sessionId === 'session-1')

    const running = readWork(root).items[0]!
    expect(running.status).toBe('running')
    expect(running.runs.at(-1)?.sessionId).toBe('session-1')

    const duplicate = await runner.scanWorkspace(workspaceId, root, new Date('2026-07-10T14:02:00.000Z'))
    expect(duplicate).toEqual({ scanned: 0, started: 0, blocked: 0, completed: 0, failed: 0 })
    expect(executeCalls).toEqual(['order-1'])

    execution.resolve()
    await firstScan
    await waitFor(() => readWork(root).items[0]?.status === 'done')

    const saved = readWork(root).items[0]!
    expect(saved.status).toBe('done')
    expect(saved.result).toEqual({ type: 'agent-task', sessionId: 'session-1', outputIds: [] })
    expect(saved.runs.at(-1)?.status).toBe('done')
  })

  test('starts only the oldest due background job and leaves the rest scheduled', async () => {
    const root = makeRoot()
    writeWork(root, [
      buildOrder({ id: 'older', title: 'Older work', createdAt: '2026-07-09T08:00:00.000Z' }),
      buildOrder({ id: 'newer', title: 'Newer work', createdAt: '2026-07-09T09:00:00.000Z' }),
    ])
    const firstExecution = deferred<void>()
    const executeCalls: string[] = []
    const runner = new ScheduledWorkRunner({
      canRunBackgroundWork: () => true,
      withLock: createLock(),
      executeAgentTask: async ({ workOrderId, onStarted }) => {
        executeCalls.push(workOrderId)
        await onStarted(`session-${workOrderId}`)
        if (workOrderId === 'older') await firstExecution.promise
        return { sessionId: `session-${workOrderId}` }
      },
      startWorkflow: async () => ({ runId: 'unused' }),
      readWorkflowRun: () => null,
      listOutputManifests: () => [],
    })

    const first = await runner.scanWorkspace(workspaceId, root, new Date('2026-07-10T14:01:00.000Z'))
    await waitFor(() => readWork(root).items.find((order) => order.id === 'older')?.status === 'running')

    expect(first.started).toBe(1)
    expect(executeCalls).toEqual(['older'])
    expect(readWork(root).items.find((order) => order.id === 'newer')?.status).toBe('scheduled')

    firstExecution.resolve()
    await waitFor(() => readWork(root).items.find((order) => order.id === 'older')?.status === 'done')
    const second = await runner.scanWorkspace(workspaceId, root, new Date('2026-07-10T14:02:00.000Z'))
    await waitFor(() => executeCalls.length === 2)

    expect(second.started).toBe(1)
    expect(executeCalls).toEqual(['older', 'newer'])
  })

  test('admits only one due background job when separate workspaces scan concurrently', async () => {
    const secondWorkspaceId = 'campaign-2'
    const firstRoot = makeRoot()
    const secondRoot = makeRoot()
    writeWork(firstRoot, [buildOrder({
      id: 'first-workspace-job',
      startAt: '2026-07-10T14:00:00.000Z',
    })])
    writeWork(secondRoot, [buildOrder({
      id: 'second-workspace-job',
      startAt: '2026-07-10T13:59:00.000Z',
      owner: { scope: 'campaign', workspaceId: secondWorkspaceId, campaignId: secondWorkspaceId },
      calendarLink: { calendar: 'campaign', itemId: 'calendar-second-workspace' },
    })], secondWorkspaceId)
    const execution = deferred<void>()
    const starts: string[] = []
    const runner = new ScheduledWorkRunner({
      canRunBackgroundWork: () => true,
      listWorkspaceRoots: () => [
        { id: workspaceId, rootPath: firstRoot },
        { id: secondWorkspaceId, rootPath: secondRoot },
      ],
      withLock: createLock(),
      executeAgentTask: async ({ workOrderId, onStarted }) => {
        starts.push(workOrderId)
        await onStarted(`session-${workOrderId}`)
        await execution.promise
        return { sessionId: `session-${workOrderId}` }
      },
      startWorkflow: async () => ({ runId: 'unused' }),
      readWorkflowRun: () => null,
      listOutputManifests: () => [],
    })

    const scans = await Promise.all([
      runner.scanWorkspace(workspaceId, firstRoot, new Date('2026-07-10T14:01:00.000Z')),
      runner.scanWorkspace(secondWorkspaceId, secondRoot, new Date('2026-07-10T14:01:00.000Z')),
    ])
    await waitFor(() => starts.length === 1)

    expect(scans.reduce((total, result) => total + result.started, 0)).toBe(1)
    expect(starts).toEqual(['second-workspace-job'])
    expect(readWork(firstRoot).items[0]?.status).toBe('scheduled')

    execution.resolve()
    await waitFor(() => (
      readWork(firstRoot).items[0]?.status === 'done'
      || readWork(secondRoot, secondWorkspaceId).items[0]?.status === 'done'
    ))
  })

  test('reserves one admission when the same workspace is scanned concurrently', async () => {
    const root = makeRoot()
    writeWork(root, [buildOrder({ id: 'single-concurrent-job' })])
    const execution = deferred<void>()
    let starts = 0
    const runner = new ScheduledWorkRunner({
      canRunBackgroundWork: () => true,
      withLock: createLock(),
      executeAgentTask: async ({ onStarted }) => {
        starts += 1
        await onStarted('single-concurrent-session')
        await execution.promise
        return { sessionId: 'single-concurrent-session' }
      },
      startWorkflow: async () => ({ runId: 'unused' }),
      readWorkflowRun: () => null,
      listOutputManifests: () => [],
    })

    const scans = await Promise.all([
      runner.scanWorkspace(workspaceId, root, new Date('2026-07-10T14:01:00.000Z')),
      runner.scanWorkspace(workspaceId, root, new Date('2026-07-10T14:01:00.000Z')),
    ])
    await waitFor(() => starts === 1)

    expect(scans.reduce((total, result) => total + result.started, 0)).toBe(1)
    expect(starts).toBe(1)
    execution.resolve()
    await waitFor(() => readWork(root).items[0]?.status === 'done')
  })

  test('does not let disabled workspace state occupy the global background lane', async () => {
    const disabledWorkspaceId = 'campaign-disabled'
    const disabledRoot = makeRoot()
    const activeRoot = makeRoot()
    writeWork(disabledRoot, [buildOrder({
      id: 'disabled-running-job',
      status: 'running',
      owner: { scope: 'campaign', workspaceId: disabledWorkspaceId, campaignId: disabledWorkspaceId },
      calendarLink: { calendar: 'campaign', itemId: 'calendar-disabled-running' },
      runs: [{
        id: 'disabled-run',
        jobId: 'disabled-running-job',
        status: 'running',
        startedAt: '2026-07-10T13:00:00.000Z',
        sessionId: 'disabled-session',
      }],
    })], disabledWorkspaceId)
    writeWork(activeRoot, [buildOrder({ id: 'active-scheduled-job' })])
    const starts: string[] = []
    const runner = new ScheduledWorkRunner({
      canRunBackgroundWork: (rootPath) => rootPath !== disabledRoot,
      listWorkspaceRoots: () => [
        { id: disabledWorkspaceId, rootPath: disabledRoot },
        { id: workspaceId, rootPath: activeRoot },
      ],
      withLock: createLock(),
      executeAgentTask: async ({ workOrderId, onStarted }) => {
        starts.push(workOrderId)
        await onStarted('active-session')
        return { sessionId: 'active-session' }
      },
      startWorkflow: async () => ({ runId: 'unused' }),
      readWorkflowRun: () => null,
      listOutputManifests: () => [],
    })

    const result = await runner.scanWorkspace(workspaceId, activeRoot, new Date('2026-07-10T14:01:00.000Z'))
    await waitFor(() => starts.length === 1)

    expect(result.started).toBe(1)
    expect(starts).toEqual(['active-scheduled-job'])
  })

  test('does not let a confirmed missing session in another workspace hold the global lane', async () => {
    const staleWorkspaceId = 'campaign-stale'
    const staleRoot = makeRoot()
    const activeRoot = makeRoot()
    writeWork(staleRoot, [buildOrder({
      id: 'stale-running-job',
      status: 'running',
      owner: { scope: 'campaign', workspaceId: staleWorkspaceId, campaignId: staleWorkspaceId },
      calendarLink: { calendar: 'campaign', itemId: 'calendar-stale-running' },
      runs: [{
        id: 'stale-run',
        jobId: 'stale-running-job',
        status: 'running',
        startedAt: '2026-07-10T13:00:00.000Z',
        sessionId: 'missing-session',
      }],
    })], staleWorkspaceId)
    writeWork(activeRoot, [buildOrder({ id: 'active-after-stale-session' })])
    const starts: string[] = []
    const runner = new ScheduledWorkRunner({
      canRunBackgroundWork: () => true,
      listWorkspaceRoots: () => [
        { id: staleWorkspaceId, rootPath: staleRoot },
        { id: workspaceId, rootPath: activeRoot },
      ],
      withLock: createLock(),
      readAgentSession: async (sessionId) => sessionId === 'missing-session' ? 'missing' : 'running',
      executeAgentTask: async ({ workOrderId, onStarted }) => {
        starts.push(workOrderId)
        await onStarted('active-session')
        return { sessionId: 'active-session' }
      },
      startWorkflow: async () => ({ runId: 'unused' }),
      readWorkflowRun: () => null,
      listOutputManifests: () => [],
    })

    const result = await runner.scanWorkspace(workspaceId, activeRoot, new Date('2026-07-10T14:01:00.000Z'))
    await waitFor(() => starts.length === 1)

    expect(result.started).toBe(1)
    expect(starts).toEqual(['active-after-stale-session'])
  })

  test('keeps the global lane occupied when another session state cannot be verified', async () => {
    const unknownWorkspaceId = 'campaign-unknown'
    const unknownRoot = makeRoot()
    const activeRoot = makeRoot()
    writeWork(unknownRoot, [buildOrder({
      id: 'unknown-running-job',
      status: 'running',
      owner: { scope: 'campaign', workspaceId: unknownWorkspaceId, campaignId: unknownWorkspaceId },
      calendarLink: { calendar: 'campaign', itemId: 'calendar-unknown-running' },
      runs: [{
        id: 'unknown-run',
        jobId: 'unknown-running-job',
        status: 'running',
        startedAt: '2026-07-10T13:00:00.000Z',
        sessionId: 'unknown-session',
      }],
    })], unknownWorkspaceId)
    writeWork(activeRoot, [buildOrder({ id: 'blocked-by-unknown-session' })])
    let starts = 0
    const runner = new ScheduledWorkRunner({
      canRunBackgroundWork: () => true,
      listWorkspaceRoots: () => [
        { id: unknownWorkspaceId, rootPath: unknownRoot },
        { id: workspaceId, rootPath: activeRoot },
      ],
      withLock: createLock(),
      readAgentSession: async () => { throw new Error('session store unavailable') },
      executeAgentTask: async ({ onStarted }) => {
        starts += 1
        await onStarted('should-not-start')
        return { sessionId: 'should-not-start' }
      },
      startWorkflow: async () => ({ runId: 'unused' }),
      readWorkflowRun: () => null,
      listOutputManifests: () => [],
    })

    const result = await runner.scanWorkspace(workspaceId, activeRoot, new Date('2026-07-10T14:01:00.000Z'))

    expect(result.started).toBe(0)
    expect(starts).toBe(0)
    expect(readWork(activeRoot).items[0]?.status).toBe('scheduled')
  })

  test('uses running work across workspace roots as the lane source of truth and releases paused workflows', async () => {
    const secondWorkspaceId = 'campaign-2'
    const workflowRoot = makeRoot()
    const agentRoot = makeRoot()
    writeWork(workflowRoot, [buildOrder({
      id: 'running-workflow',
      type: 'workflow-run',
      status: 'running',
      execution: {
        type: 'workflow-run',
        workflowSlug: 'weekly-content',
        workflowDigest: 'digest-weekly',
        triggerInputs: {},
      },
      runs: [{
        id: 'run-entry-global',
        jobId: 'running-workflow',
        status: 'running',
        startedAt: '2026-07-10T14:00:00.000Z',
        workflowRunId: 'run-global',
      }],
    })])
    writeWork(agentRoot, [buildOrder({
      id: 'waiting-agent',
      owner: { scope: 'campaign', workspaceId: secondWorkspaceId, campaignId: secondWorkspaceId },
      calendarLink: { calendar: 'campaign', itemId: 'calendar-waiting-agent' },
    })], secondWorkspaceId)
    let workflowState: WorkflowRunSnapshot['state'] = 'running'
    let agentStarts = 0
    const runner = new ScheduledWorkRunner({
      canRunBackgroundWork: () => true,
      listWorkspaceRoots: () => [
        { id: workspaceId, rootPath: workflowRoot },
        { id: secondWorkspaceId, rootPath: agentRoot },
      ],
      withLock: createLock(),
      executeAgentTask: async ({ onStarted }) => {
        agentStarts += 1
        await onStarted('session-after-global-workflow')
        return { sessionId: 'session-after-global-workflow' }
      },
      startWorkflow: async () => ({ runId: 'unused' }),
      readWorkflowRun: () => ({
        id: 'run-global',
        workflowSlug: 'weekly-content',
        workspaceId,
        state: workflowState,
        trigger: { type: 'automation', inputs: {}, firedAt: '2026-07-10T14:00:00.000Z' },
        workflowSnapshot: { metadata: { name: 'Weekly content', steps: [] }, body: '# body' } as unknown as WorkflowRunSnapshot['workflowSnapshot'],
        steps: [],
        createdAt: '2026-07-10T14:00:00.000Z',
        updatedAt: '2026-07-10T14:00:10.000Z',
        outputIds: [],
      }),
      listOutputManifests: () => [],
    })

    const blocked = await runner.scanWorkspace(secondWorkspaceId, agentRoot, new Date('2026-07-10T14:01:00.000Z'))
    expect(blocked.started).toBe(0)
    expect(agentStarts).toBe(0)
    expect(readWork(agentRoot, secondWorkspaceId).items[0]?.status).toBe('scheduled')

    workflowState = 'paused'
    const released = await runner.scanWorkspace(secondWorkspaceId, agentRoot, new Date('2026-07-10T14:02:00.000Z'))
    await waitFor(() => agentStarts === 1)
    expect(released.started).toBe(1)
  })

  test('moves agent tasks to needs-attention when required outputs are missing', async () => {
    const root = makeRoot()
    writeWork(root, [buildOrder({
      execution: {
        type: 'agent-task',
        agentSlug: 'content-genius',
        brief: 'Write the launch doc.',
        permissionMode: 'safe',
        expectedOutput: { requirement: 'required', kind: 'document', minimumCount: 1 },
      },
    })])

    const runner = new ScheduledWorkRunner({
      canRunBackgroundWork: () => true,
      withLock: createLock(),
      executeAgentTask: async ({ onStarted }) => {
        await onStarted('session-2')
        return { sessionId: 'session-2' }
      },
      startWorkflow: async () => ({ runId: 'wf-unused' }),
      readWorkflowRun: () => null,
      listOutputManifests: () => [],
    })

    await runner.scanWorkspace(workspaceId, root, new Date('2026-07-10T14:01:00.000Z'))
    await waitFor(() => readWork(root).items[0]?.status === 'needs-attention')

    const saved = readWork(root).items[0]!
    expect(saved.status).toBe('needs-attention')
    expect(saved.attention?.reason).toBe('required-output-missing')
    expect(saved.attention?.message).toContain('Expected at least 1 output')
    expect(saved.runs.at(-1)?.status).toBe('failed')
  })

  test('postprocesses a required intelligence report before marking the work done', async () => {
    const root = makeRoot()
    const manifest = buildManifest('intel-report', 'session-intel')
    writeWork(root, [buildOrder({
      execution: {
        type: 'agent-task',
        agentSlug: 'youtube-intelligence-agent',
        brief: 'Scan configured channels.',
        permissionMode: 'safe',
        expectedOutput: { requirement: 'required', kind: 'report' },
        postProcess: 'youtube-intelligence',
      },
    })])
    const processed: string[] = []
    const runner = new ScheduledWorkRunner({
      canRunBackgroundWork: () => true,
      withLock: createLock(),
      executeAgentTask: async ({ onStarted }) => { await onStarted('session-intel'); return { sessionId: 'session-intel' } },
      startWorkflow: async () => ({ runId: 'unused' }),
      readWorkflowRun: () => null,
      listOutputManifests: () => [manifest],
      postProcessAgentTask: async ({ outputs }) => {
        processed.push(...outputs.map((output) => output.id))
        return { sharedIntelContextSlugs: ['shared-intel-content'] }
      },
    })

    await runner.scanWorkspace(workspaceId, root, new Date('2026-07-10T14:01:00.000Z'))
    await waitFor(() => readWork(root).items[0]?.status === 'done')
    expect(processed).toEqual(['intel-report'])
    expect(readWork(root).items[0]?.result).toEqual({
      type: 'agent-task', sessionId: 'session-intel', outputIds: ['intel-report'], sharedIntelContextSlugs: ['shared-intel-content'],
    })
  })

  test('does not mark intelligence work done when report postprocessing fails', async () => {
    const root = makeRoot()
    writeWork(root, [buildOrder({ execution: {
      type: 'agent-task', agentSlug: 'youtube-intelligence-agent', brief: 'Scan channels.', permissionMode: 'safe',
      expectedOutput: { requirement: 'required', kind: 'report' }, postProcess: 'youtube-intelligence',
    } })])
    const runner = new ScheduledWorkRunner({
      canRunBackgroundWork: () => true,
      withLock: createLock(),
      executeAgentTask: async ({ onStarted }) => { await onStarted('session-bad-intel'); return { sessionId: 'session-bad-intel' } },
      startWorkflow: async () => ({ runId: 'unused' }),
      readWorkflowRun: () => null,
      listOutputManifests: () => [buildManifest('bad-intel-report', 'session-bad-intel')],
      postProcessAgentTask: async () => { throw new Error('Structured nuggets are missing.') },
    })

    await runner.scanWorkspace(workspaceId, root, new Date('2026-07-10T14:01:00.000Z'))
    await waitFor(() => readWork(root).items[0]?.status === 'needs-attention')
    expect(readWork(root).items[0]?.attention).toMatchObject({ reason: 'execution-failed', message: 'Structured nuggets are missing.' })
  })

  test('holds the lane while an ask-mode agent thinks, then releases it while waiting for the user', async () => {
    const root = makeRoot()
    const ask = buildOrder({ id: 'ask-1', calendarLink: { calendar: 'campaign', itemId: 'calendar-ask' }, execution: {
      type: 'agent-task', agentSlug: 'content-genius', brief: 'Wait for permission.', permissionMode: 'ask', expectedOutput: { requirement: 'none' },
    } })
    const automatic = buildOrder({ id: 'auto-2', calendarLink: { calendar: 'campaign', itemId: 'calendar-auto' } })
    writeWork(root, [ask, automatic])
    const permission = deferred<void>()
    let waitingForUser = false
    const runner = new ScheduledWorkRunner({
      canRunBackgroundWork: () => true,
      withLock: createLock(),
      executeAgentTask: async ({ workOrderId, onStarted }) => {
        await onStarted(`session-${workOrderId}`)
        if (workOrderId === 'ask-1') await permission.promise
        return { sessionId: `session-${workOrderId}` }
      },
      isAgentSessionWaitingForUser: () => waitingForUser,
      readAgentSession: async () => 'running',
      startWorkflow: async () => ({ runId: 'unused' }),
      readWorkflowRun: () => null,
      listOutputManifests: () => [],
    })

    const activeScan = await runner.scanWorkspace(workspaceId, root, new Date('2026-07-10T14:01:00.000Z'))
    await waitFor(() => readWork(root).items.find((order) => order.id === 'ask-1')?.status === 'running')
    expect(activeScan.started).toBe(1)
    expect(readWork(root).items.find((order) => order.id === 'auto-2')?.status).toBe('scheduled')

    waitingForUser = true
    const waitingScan = await runner.scanWorkspace(workspaceId, root, new Date('2026-07-10T14:02:00.000Z'))
    await waitFor(() => readWork(root).items.find((order) => order.id === 'auto-2')?.status === 'done')
    expect(waitingScan.started).toBe(1)
    expect(readWork(root).items.find((order) => order.id === 'ask-1')?.status).toBe('running')
    permission.resolve()
    await waitFor(() => readWork(root).items.find((order) => order.id === 'ask-1')?.status === 'done')
  })

  test('releases a review child only after one exact produced Output resolves', async () => {
    const root = makeRoot()
    const parent = buildOrder({ id: 'chain-parent', chain: { chainId: 'chain-1', stepId: 'step-0', ordinal: 0 } })
    const child = buildOrder({
      id: 'chain-child',
      type: 'review',
      status: 'waiting',
      calendarLink: { calendar: 'campaign', itemId: 'calendar-child' },
      execution: { type: 'review', reviewerType: 'user' },
      inputRefs: [{ kind: 'produced-output', stepId: 'step-0', selector: { kind: 'report' }, bindTo: { kind: 'review-target' } }],
      chain: { chainId: 'chain-1', stepId: 'step-1', ordinal: 1, predecessor: { orderId: 'chain-parent', stepId: 'step-0', releaseOn: 'success' } },
    })
    writeWork(root, [parent, child])
    const manifest = buildManifest('output-chain-1', 'session-chain-parent')
    const runner = new ScheduledWorkRunner({
      canRunBackgroundWork: () => true,
      withLock: createLock(),
      executeAgentTask: async ({ onStarted }) => { await onStarted('session-chain-parent'); return { sessionId: 'session-chain-parent' } },
      startWorkflow: async () => ({ runId: 'unused' }),
      readWorkflowRun: () => null,
      listOutputManifests: () => [manifest],
    })

    await runner.scanWorkspace(workspaceId, root, new Date('2026-07-10T14:01:00.000Z'))
    await waitFor(() => readWork(root).items.find((order) => order.id === 'chain-parent')?.status === 'done')
    expect(readWork(root).items.find((order) => order.id === 'chain-child')?.status).toBe('awaiting-review')
    await waitFor(() => readWork(root).items.find((order) => order.id === 'chain-child')?.status === 'awaiting-review')
    const savedChild = readWork(root).items.find((order) => order.id === 'chain-child')!
    expect(savedChild.inputRefs[0]).toMatchObject({ kind: 'produced-output', resolution: { outputId: 'output-chain-1', source: 'automatic' } })
  })

  test('stops an ambiguous produced-output follow-up for exact user selection', async () => {
    const root = makeRoot()
    const parent = buildOrder({ id: 'ambiguous-parent', chain: { chainId: 'chain-2', stepId: 'step-0', ordinal: 0 } })
    const child = buildOrder({
      id: 'ambiguous-child', type: 'review', status: 'waiting', calendarLink: { calendar: 'campaign', itemId: 'calendar-ambiguous' },
      execution: { type: 'review', reviewerType: 'user' },
      inputRefs: [{ kind: 'produced-output', stepId: 'step-0', selector: { kind: 'report' }, bindTo: { kind: 'review-target' } }],
      chain: { chainId: 'chain-2', stepId: 'step-1', ordinal: 1, predecessor: { orderId: 'ambiguous-parent', stepId: 'step-0', releaseOn: 'success' } },
    })
    writeWork(root, [parent, child])
    const manifests = [buildManifest('output-a', 'session-ambiguous'), buildManifest('output-b', 'session-ambiguous')]
    const runner = new ScheduledWorkRunner({
      canRunBackgroundWork: () => true,
      withLock: createLock(),
      executeAgentTask: async ({ onStarted }) => { await onStarted('session-ambiguous'); return { sessionId: 'session-ambiguous' } },
      startWorkflow: async () => ({ runId: 'unused' }),
      readWorkflowRun: () => null,
      listOutputManifests: () => manifests,
    })

    await runner.scanWorkspace(workspaceId, root, new Date('2026-07-10T14:01:00.000Z'))
    await waitFor(() => readWork(root).items.find((order) => order.id === 'ambiguous-parent')?.status === 'done')
    expect(readWork(root).items.find((order) => order.id === 'ambiguous-child')?.status).toBe('needs-attention')
    await waitFor(() => readWork(root).items.find((order) => order.id === 'ambiguous-child')?.status === 'needs-attention')
    const savedChild = readWork(root).items.find((order) => order.id === 'ambiguous-child')!
    expect(savedChild.attention?.reason).toBe('produced-output-ambiguous')
    expect(savedChild.inputRefs[0]).not.toHaveProperty('resolution')
  })

  test('starts workflow jobs without marking them done, then completes them on a later poll', async () => {
    const root = makeRoot()
    writeWork(root, [buildOrder({
      id: 'workflow-1',
      type: 'workflow-run',
      title: 'Weekly workflow',
      execution: {
        type: 'workflow-run',
        workflowSlug: 'weekly-content',
        workflowDigest: 'digest-weekly',
        triggerInputs: { topic: 'launch' },
      },
    })])

    let workflowState: WorkflowRunSnapshot['state'] = 'running'
    const workflowManifest: OutputManifest = {
      ...buildManifest('out-1', 'session-youtube'),
      origin: {
        source: 'workflow',
        workflowRunId: 'run-1',
        workflowSlug: 'weekly-content',
        workflowName: 'Weekly content',
        stepId: 'youtube-intel',
        sessionId: 'session-youtube',
        agentSlug: 'youtube-intelligence-agent',
        agentName: 'YouTube Intelligence Agent',
      },
    }
    const runner = new ScheduledWorkRunner({
      canRunBackgroundWork: () => true,
      withLock: createLock(),
      executeAgentTask: async () => ({ sessionId: 'unused' }),
      startWorkflow: async () => ({ runId: 'run-1' }),
      readWorkflowRun: () => ({
        id: 'run-1',
        workflowSlug: 'weekly-content',
        workspaceId,
        state: workflowState,
        trigger: { type: 'manual', inputs: {}, firedAt: '2026-07-10T14:01:00.000Z' },
        workflowSnapshot: { metadata: { name: 'Weekly content', steps: [] }, body: '# body' } as unknown as WorkflowRunSnapshot['workflowSnapshot'],
        steps: [],
        createdAt: '2026-07-10T14:01:00.000Z',
        updatedAt: '2026-07-10T14:01:10.000Z',
        outputIds: workflowState === 'succeeded' ? ['out-1'] : [],
        finalOutputId: workflowState === 'succeeded' ? 'out-final' : undefined,
        completedAt: workflowState === 'succeeded' ? '2026-07-10T14:02:00.000Z' : undefined,
      }),
      listOutputManifests: () => [workflowManifest],
    })

    await runner.scanWorkspace(workspaceId, root, new Date('2026-07-10T14:01:00.000Z'))
    let saved = readWork(root).items[0]!
    expect(saved.status).toBe('running')
    expect(saved.runs.at(-1)?.workflowRunId).toBe('run-1')
    expect(saved.result).toBeUndefined()

    workflowState = 'succeeded'
    await runner.scanWorkspace(workspaceId, root, new Date('2026-07-10T14:02:10.000Z'))
    saved = readWork(root).items[0]!
    expect(saved.status).toBe('done')
    expect(saved.result).toEqual({ type: 'workflow-run', workflowRunId: 'run-1', outputIds: ['out-1', 'out-final'] })
    expect(saved.runs.at(-1)?.status).toBe('done')
  })

  test('holds due agent work behind a running workflow and releases it when the workflow finishes', async () => {
    const root = makeRoot()
    writeWork(root, [
      buildOrder({
        id: 'workflow-first',
        type: 'workflow-run',
        title: 'Weekly workflow',
        createdAt: '2026-07-09T08:00:00.000Z',
        execution: {
          type: 'workflow-run',
          workflowSlug: 'weekly-content',
          workflowDigest: 'digest-weekly',
          triggerInputs: {},
        },
      }),
      buildOrder({ id: 'agent-second', createdAt: '2026-07-09T09:00:00.000Z' }),
    ])

    let workflowState: WorkflowRunSnapshot['state'] = 'running'
    let agentStarts = 0
    const runner = new ScheduledWorkRunner({
      canRunBackgroundWork: () => true,
      withLock: createLock(),
      executeAgentTask: async ({ onStarted }) => {
        agentStarts += 1
        await onStarted('session-after-workflow')
        return { sessionId: 'session-after-workflow' }
      },
      startWorkflow: async () => ({ runId: 'run-lane' }),
      readWorkflowRun: () => ({
        id: 'run-lane',
        workflowSlug: 'weekly-content',
        workspaceId,
        state: workflowState,
        trigger: { type: 'manual', inputs: {}, firedAt: '2026-07-10T14:01:00.000Z' },
        workflowSnapshot: { metadata: { name: 'Weekly content', steps: [] }, body: '# body' } as unknown as WorkflowRunSnapshot['workflowSnapshot'],
        steps: [],
        createdAt: '2026-07-10T14:01:00.000Z',
        updatedAt: '2026-07-10T14:01:10.000Z',
        outputIds: [],
        completedAt: workflowState === 'succeeded' ? '2026-07-10T14:02:00.000Z' : undefined,
      }),
      listOutputManifests: () => [],
    })

    const first = await runner.scanWorkspace(workspaceId, root, new Date('2026-07-10T14:01:00.000Z'))
    expect(first.started).toBe(1)
    expect(agentStarts).toBe(0)
    expect(readWork(root).items.find((order) => order.id === 'workflow-first')?.status).toBe('running')
    expect(readWork(root).items.find((order) => order.id === 'agent-second')?.status).toBe('scheduled')

    const whileRunning = await runner.scanWorkspace(workspaceId, root, new Date('2026-07-10T14:02:00.000Z'))
    expect(whileRunning.started).toBe(0)
    expect(agentStarts).toBe(0)

    workflowState = 'succeeded'
    const released = await runner.scanWorkspace(workspaceId, root, new Date('2026-07-10T14:03:00.000Z'))
    await waitFor(() => agentStarts === 1)

    expect(released.completed).toBe(1)
    expect(released.started).toBe(1)
    expect(readWork(root).items.find((order) => order.id === 'workflow-first')?.status).toBe('done')
  })

  test('does not mark a workflow done when workflow finalization records an error', async () => {
    const root = makeRoot()
    writeWork(root, [buildOrder({
      id: 'workflow-postprocess-failure',
      type: 'workflow-run',
      status: 'running',
      execution: {
        type: 'workflow-run',
        workflowSlug: 'weekly-signal-scan',
        workflowDigest: 'digest-signals',
        triggerInputs: {},
      },
      runs: [{
        id: 'run-entry-signals',
        jobId: 'workflow-postprocess-failure',
        status: 'running',
        startedAt: '2026-07-10T14:01:00.000Z',
        workflowRunId: 'run-signals',
      }],
    })])

    const runner = new ScheduledWorkRunner({
      canRunBackgroundWork: () => true,
      withLock: createLock(),
      executeAgentTask: async () => ({ sessionId: 'unused' }),
      startWorkflow: async () => ({ runId: 'unused' }),
      readWorkflowRun: () => ({
        id: 'run-signals',
        workflowSlug: 'weekly-signal-scan',
        workspaceId,
        state: 'succeeded',
        trigger: { type: 'manual', inputs: {}, firedAt: '2026-07-10T14:01:00.000Z' },
        workflowSnapshot: { metadata: { name: 'Weekly Signal Scan', steps: [] }, body: '# body' } as unknown as WorkflowRunSnapshot['workflowSnapshot'],
        steps: [],
        createdAt: '2026-07-10T14:01:00.000Z',
        updatedAt: '2026-07-10T14:02:00.000Z',
        completedAt: '2026-07-10T14:02:00.000Z',
        outputIds: ['out-intel'],
        outputError: 'Signal routing failed.',
      }),
      listOutputManifests: () => [buildManifest('out-intel', 'session-intel')],
    })

    await runner.scanWorkspace(workspaceId, root, new Date('2026-07-10T14:02:10.000Z'))
    const saved = readWork(root).items[0]!
    expect(saved.status).toBe('needs-attention')
    expect(saved.attention).toMatchObject({ reason: 'execution-failed', message: 'Signal routing failed.' })
  })

  test('moves failed workflow polls to needs-attention and names the failed step', async () => {
    const root = makeRoot()
    writeWork(root, [buildOrder({
      id: 'workflow-2',
      type: 'workflow-run',
      status: 'running',
      execution: {
        type: 'workflow-run',
        workflowSlug: 'weekly-content',
        workflowDigest: 'digest-weekly',
        triggerInputs: {},
      },
      runs: [{
        id: 'run-entry-1',
        jobId: 'workflow-2',
        startedAt: '2026-07-10T14:00:00.000Z',
        status: 'running',
        workflowRunId: 'run-2',
      }],
    })])

    const runner = new ScheduledWorkRunner({
      canRunBackgroundWork: () => true,
      withLock: createLock(),
      executeAgentTask: async () => ({ sessionId: 'unused' }),
      startWorkflow: async () => ({ runId: 'unused' }),
      readWorkflowRun: () => ({
        id: 'run-2',
        workflowSlug: 'weekly-content',
        workspaceId,
        state: 'failed',
        trigger: { type: 'manual', inputs: {}, firedAt: '2026-07-10T14:00:00.000Z' },
        workflowSnapshot: { metadata: { name: 'Weekly content', steps: [] }, body: '# body' } as unknown as WorkflowRunSnapshot['workflowSnapshot'],
        steps: [{
          id: 'draft-post',
          state: 'failed',
          attempts: 1,
          error: { code: 'tool_error', message: 'Model timeout' },
        }],
        createdAt: '2026-07-10T14:00:00.000Z',
        updatedAt: '2026-07-10T14:02:00.000Z',
        completedAt: '2026-07-10T14:02:00.000Z',
      }),
      listOutputManifests: () => [],
    })

    await runner.scanWorkspace(workspaceId, root, new Date('2026-07-10T14:02:10.000Z'))

    const saved = readWork(root).items[0]!
    expect(saved.status).toBe('needs-attention')
    expect(saved.attention).toEqual({
      reason: 'execution-failed',
      message: 'Workflow weekly-content failed at step draft-post: Model timeout',
    })
    expect(saved.runs.at(-1)?.status).toBe('failed')
  })

  test('moves due review work to awaiting-review', async () => {
    const root = makeRoot()
    writeWork(root, [buildOrder({
      id: 'review-1',
      type: 'review',
      title: 'Review final',
      execution: { type: 'review', reviewerType: 'user' },
    })])

    const runner = new ScheduledWorkRunner({
      canRunBackgroundWork: () => true,
      withLock: createLock(),
      executeAgentTask: async () => ({ sessionId: 'unused' }),
      startWorkflow: async () => ({ runId: 'unused' }),
      readWorkflowRun: () => null,
      listOutputManifests: () => [],
    })

    await runner.scanWorkspace(workspaceId, root, new Date('2026-07-10T14:01:00.000Z'))

    expect(readWork(root).items[0]?.status).toBe('awaiting-review')
  })

  test('keeps due social work blocked in needs-approval', async () => {
    const root = makeRoot()
    writeWork(root, [buildOrder({
      id: 'social-1',
      type: 'social-publish',
      title: 'Post teaser',
      execution: {
        type: 'social-publish',
        platform: 'instagram',
        profileId: 'ig-main',
        caption: 'Launch teaser',
      },
    })])

    const runner = new ScheduledWorkRunner({
      canRunBackgroundWork: () => true,
      withLock: createLock(),
      executeAgentTask: async () => ({ sessionId: 'unused' }),
      startWorkflow: async () => ({ runId: 'unused' }),
      readWorkflowRun: () => null,
      listOutputManifests: () => [],
    })

    await runner.scanWorkspace(workspaceId, root, new Date('2026-07-10T14:01:00.000Z'))

    const saved = readWork(root).items[0]!
    expect(saved.status).toBe('needs-approval')
    expect(saved.runs).toEqual([])
  })

  test('prepares, exact-approves, and publishes social work once with a receipt', async () => {
    const root = makeRoot()
    const order = buildOrder({
      id: 'social-live-1',
      type: 'social-publish',
      status: 'needs-approval',
      execution: { type: 'social-publish', platform: 'x', profileId: 'artist-main', caption: 'Out Friday.' },
      executionKey: { payloadDigest: 'payload-social-1', idempotencyKey: 'idem-social-1' },
    })
    writeWork(root, [order])
    let executeCalls = 0
    const runner = new ScheduledWorkRunner({
      canRunBackgroundWork: () => true,
      withLock: createLock(),
      executeAgentTask: async () => ({ sessionId: 'unused' }),
      startWorkflow: async () => ({ runId: 'unused' }),
      readWorkflowRun: () => null,
      listOutputManifests: () => [],
      prepareSocial: async () => ({
        actionId: 'act_social-live-1', actionDigest: 'sha256:action', platform: 'x', profileId: 'artist-main',
        preparedAt: '2026-07-10T14:00:00.000Z', payloadDigest: 'payload-social-1', dryRun: { ok: true },
      }),
      executeSocial: async () => {
        executeCalls += 1
        return { receiptId: 'receipt-social-1', externalUrl: 'https://x.com/example/status/1', summary: 'Published.' }
      },
    })

    await runner.scanWorkspace(workspaceId, root, new Date('2026-07-10T14:01:00.000Z'))
    let saved = readWork(root).items[0]!
    expect(saved.socialAction?.actionId).toBe('act_social-live-1')
    saved = {
      ...saved,
      socialApproval: {
        id: 'approval-social-1', approvedAt: '2026-07-10T14:01:00.000Z', expiresAt: '2026-07-10T14:31:00.000Z',
        actionId: 'act_social-live-1', actionDigest: 'sha256:action', payloadDigest: 'payload-social-1', platform: 'x', profileId: 'artist-main',
        approvedBy: { type: 'user', clientId: 'test-client' },
      },
      updatedAt: '2026-07-10T14:01:00.000Z',
    }
    writeWork(root, [saved])

    await runner.scanWorkspace(workspaceId, root, new Date('2026-07-10T14:02:00.000Z'))
    await waitFor(() => readWork(root).items[0]?.status === 'done')
    const completed = readWork(root).items[0]!
    expect(executeCalls).toBe(1)
    expect(completed.result).toMatchObject({ type: 'social-publish', receipt: { id: 'receipt-social-1', approvalId: 'approval-social-1' } })
    await runner.scanWorkspace(workspaceId, root, new Date('2026-07-10T14:03:00.000Z'))
    expect(executeCalls).toBe(1)
  })

  test('derives execution attestation from durable schedule authorization without a second click', async () => {
    const root = makeRoot()
    const source = join(root, 'release-cover.png')
    writeFileSync(source, 'release-cover')
    const released = materializeReleaseKitItem(root, {
      workspaceId, campaignId: workspaceId,
      source: { type: 'upload', originalFileName: 'release-cover.png' }, sourcePath: source,
      category: 'artwork', subtype: 'cover-art', promotedBy: 'user',
    })
    const releaseKitRef = { itemId: released.item.id, sha256: released.item.sha256, label: 'Release cover' }
    const definition = {
      title: 'Post Release cover', releaseKitRef, platform: 'x', profileId: 'artist-main',
      caption: 'Out Friday.', startAt: '2026-07-10T14:00:00.000Z', timezone: 'America/Chicago',
    }
    const payloadDigest = `sha256:${createHash('sha256').update(stableAuthorizationJson(definition)).digest('hex')}`
    writeWork(root, [buildOrder({
      id: 'social-authorized-1', title: definition.title, type: 'social-publish', status: 'needs-approval',
      startAt: definition.startAt, timezone: definition.timezone,
      execution: { type: 'social-publish', platform: 'x', profileId: 'artist-main', caption: definition.caption },
      inputRefs: [{ kind: 'release-kit', ...releaseKitRef }],
      executionKey: { payloadDigest, idempotencyKey: 'idem-authorized-1' },
      authorizationPolicy: 'durable-v1',
      authorization: {
        id: 'auth-1', authorizedAt: '2026-07-10T13:00:00.000Z', expiresAt: '2026-07-10T14:30:00.000Z',
        payloadDigest, authorizedBy: { type: 'user', clientId: 'client-1', source: 'release-kit-ui' }, definition,
      },
    })])
    let executeCalls = 0
    const runner = new ScheduledWorkRunner({
      canRunBackgroundWork: () => true,
      now: () => new Date('2026-07-10T14:01:00.000Z'),
      withLock: createLock(),
      executeAgentTask: async () => ({ sessionId: 'unused' }),
      startWorkflow: async () => ({ runId: 'unused' }),
      readWorkflowRun: () => null,
      listOutputManifests: () => [],
      prepareSocial: async () => ({
        actionId: 'act_social-authorized-1', actionDigest: 'sha256:action', mediaDigest: `sha256:${releaseKitRef.sha256}`,
        platform: 'x', profileId: 'artist-main', preparedAt: '2026-07-10T13:59:00.000Z', payloadDigest, dryRun: { ok: true },
      }),
      executeSocial: async () => {
        executeCalls += 1
        return { receiptId: 'receipt-authorized-1', summary: 'Published.' }
      },
    })

    await runner.scanWorkspace(workspaceId, root, new Date('2026-07-10T14:01:00.000Z'))
    expect(readWork(root).items[0]?.socialApproval).toMatchObject({ approvedBy: { clientId: 'client-1' }, payloadDigest })
    await runner.scanWorkspace(workspaceId, root, new Date('2026-07-10T14:02:00.000Z'))
    await waitFor(() => readWork(root).items[0]?.status === 'done')
    expect(executeCalls).toBe(1)
  })

  test('executes an exactly authorized text-only X Editorial post without inventing media', async () => {
    const root = makeRoot()
    const definition = {
      kind: 'x-editorial' as const,
      title: 'X worldview post',
      xEditorialRef: {
        outputId: '11111111-2222-4333-8444-555555555555',
        slateId: 'xslate_test_1',
        candidateId: 'post_1',
        revision: 1,
      },
      platform: 'x' as const,
      profileId: 'artist-main',
      caption: 'Art should leave a bruise, not a brochure.',
      startAt: '2026-07-10T14:00:00.000Z',
      timezone: 'America/Chicago',
    }
    const payloadDigest = `sha256:${createHash('sha256').update(stableAuthorizationJson(definition)).digest('hex')}`
    writeWork(root, [buildOrder({
      id: 'social-x-editorial-text-1',
      owner: { scope: 'hq', workspaceId },
      calendarLink: { calendar: 'hq', itemId: 'artist-calendar-x-1' },
      title: definition.title,
      type: 'social-publish',
      status: 'needs-approval',
      startAt: definition.startAt,
      timezone: definition.timezone,
      execution: { type: 'social-publish', platform: 'x', profileId: definition.profileId, caption: definition.caption },
      inputRefs: [],
      executionKey: { payloadDigest, idempotencyKey: 'idem-x-editorial-text-1' },
      authorizationPolicy: 'durable-v1',
      authorization: {
        id: 'auth-x-editorial-text-1',
        authorizedAt: '2026-07-10T13:00:00.000Z',
        expiresAt: '2026-07-10T14:30:00.000Z',
        payloadDigest,
        authorizedBy: { type: 'user', clientId: 'client-1', source: 'x-editorial-ui' },
        definition,
      },
    })])
    let executeCalls = 0
    const runner = new ScheduledWorkRunner({
      canRunBackgroundWork: () => true,
      now: () => new Date('2026-07-10T14:01:00.000Z'),
      withLock: createLock(),
      executeAgentTask: async () => ({ sessionId: 'unused' }),
      startWorkflow: async () => ({ runId: 'unused' }),
      readWorkflowRun: () => null,
      listOutputManifests: () => [],
      prepareSocial: async () => ({
        actionId: 'act-x-editorial-text-1',
        actionDigest: 'sha256:action',
        platform: 'x',
        profileId: 'artist-main',
        preparedAt: '2026-07-10T13:59:00.000Z',
        payloadDigest,
        dryRun: { ok: true },
      }),
      executeSocial: async ({ preview }) => {
        executeCalls += 1
        expect(preview.mediaDigest).toBeUndefined()
        return { receiptId: 'receipt-x-editorial-text-1', summary: 'Published text post.' }
      },
    })

    await runner.scanWorkspace(workspaceId, root, new Date('2026-07-10T14:01:00.000Z'))
    expect(readWork(root).items[0]?.socialApproval).toMatchObject({
      approvedBy: { clientId: 'client-1' },
      payloadDigest,
    })
    expect(readWork(root).items[0]?.socialApproval?.mediaDigest).toBeUndefined()
    await runner.scanWorkspace(workspaceId, root, new Date('2026-07-10T14:02:00.000Z'))
    await waitFor(() => readWork(root).items[0]?.status === 'done')
    expect(executeCalls).toBe(1)
  })

  test('rechecks signed cross-workspace X Editorial media restrictions before execution', async () => {
    const root = makeRoot()
    const campaignRoot = makeRoot()
    const campaignId = 'campaign-x-media'
    const source = join(campaignRoot, 'lyric-clip.mp4')
    writeFileSync(source, 'approved-lyric-clip')
    const released = materializeReleaseKitItem(campaignRoot, {
      workspaceId: campaignId, campaignId,
      source: { type: 'upload', originalFileName: 'lyric-clip.mp4' }, sourcePath: source,
      category: 'video', subtype: 'lyric-clip', promotedBy: 'user',
    })
    const releaseKitRef = {
      itemId: released.item.id,
      sha256: released.item.sha256,
      label: released.item.title,
      campaignId,
    }
    const definition = {
      kind: 'x-editorial' as const,
      title: 'X lyric clip',
      xEditorialRef: { outputId: 'output-x', slateId: 'slate-x', candidateId: 'post-x', revision: 1 },
      releaseKitRef,
      platform: 'x' as const,
      profileId: 'artist-main',
      caption: 'A line worth keeping.',
      startAt: '2026-07-10T14:00:00.000Z',
      timezone: 'America/Chicago',
    }
    const payloadDigest = `sha256:${createHash('sha256').update(stableAuthorizationJson(definition)).digest('hex')}`
    writeWork(root, [buildOrder({
      id: 'social-x-editorial-media-1',
      owner: { scope: 'hq', workspaceId },
      calendarLink: { calendar: 'hq', itemId: 'artist-calendar-x-media-1' },
      title: definition.title,
      type: 'social-publish',
      status: 'needs-approval',
      startAt: definition.startAt,
      timezone: definition.timezone,
      execution: { type: 'social-publish', platform: 'x', profileId: definition.profileId, caption: definition.caption },
      inputRefs: [{ kind: 'release-kit', itemId: releaseKitRef.itemId, sha256: releaseKitRef.sha256, label: releaseKitRef.label }],
      executionKey: { payloadDigest, idempotencyKey: 'idem-x-editorial-media-1' },
      authorizationPolicy: 'durable-v1',
      authorization: {
        id: 'auth-x-editorial-media-1', authorizedAt: '2026-07-10T13:00:00.000Z', expiresAt: '2026-07-10T14:30:00.000Z',
        payloadDigest, authorizedBy: { type: 'user', clientId: 'client-1', source: 'x-editorial-ui' }, definition,
      },
    })])
    let executeCalls = 0
    const runner = new ScheduledWorkRunner({
      canRunBackgroundWork: () => true,
      now: () => new Date('2026-07-10T14:01:00.000Z'),
      withLock: createLock(),
      resolveWorkspace: (id) => id === campaignId
        ? { id: campaignId, rootPath: campaignRoot, artistWorkspaceScope: 'campaign' }
        : null,
      executeAgentTask: async () => ({ sessionId: 'unused' }),
      startWorkflow: async () => ({ runId: 'unused' }),
      readWorkflowRun: () => null,
      listOutputManifests: () => [],
      prepareSocial: async () => ({
        actionId: 'act-x-editorial-media-1', actionDigest: 'sha256:action', mediaDigest: `sha256:${releaseKitRef.sha256}`,
        platform: 'x', profileId: 'artist-main', preparedAt: '2026-07-10T13:59:00.000Z', payloadDigest, dryRun: { ok: true },
      }),
      executeSocial: async () => { executeCalls += 1; return { receiptId: 'must-not-run', summary: 'Must not run.' } },
    })

    await runner.scanWorkspace(workspaceId, root, new Date('2026-07-10T14:01:00.000Z'))
    expect(readWork(root).items[0]?.socialApproval?.mediaDigest).toBe(`sha256:${releaseKitRef.sha256}`)
    updateReleaseKitItemUsage(campaignRoot, campaignId, campaignId, released.item.id, {
      restrictions: { blockedFromUse: true },
    })
    await runner.scanWorkspace(workspaceId, root, new Date('2026-07-10T14:02:00.000Z'))
    await waitFor(() => readWork(root).items[0]?.status === 'needs-attention')
    expect(executeCalls).toBe(0)
    expect(readWork(root).items[0]?.attention?.message).toMatch(/blocked from use/i)
  })

  test('rechecks Release Kit restrictions in the runner before calling a social adapter', async () => {
    const root = makeRoot()
    const source = join(root, 'restricted-cover.png')
    writeFileSync(source, 'restricted-cover')
    const released = materializeReleaseKitItem(root, {
      workspaceId, campaignId: workspaceId,
      source: { type: 'upload', originalFileName: 'restricted-cover.png' }, sourcePath: source,
      category: 'artwork', subtype: 'cover-art', promotedBy: 'user',
    })
    const payloadDigest = 'payload-restricted'
    const action = {
      actionId: 'act_social-restricted', actionDigest: 'sha256:restricted-action',
      mediaDigest: `sha256:${released.item.sha256}`, platform: 'x', profileId: 'artist-main',
      preparedAt: '2026-07-10T14:00:00.000Z', payloadDigest, dryRun: { ok: true },
    }
    writeWork(root, [buildOrder({
      id: 'social-restricted', type: 'social-publish', status: 'needs-approval',
      execution: { type: 'social-publish', platform: 'x', profileId: 'artist-main', caption: 'Do not post.' },
      inputRefs: [{ kind: 'release-kit', itemId: released.item.id, sha256: released.item.sha256 }],
      executionKey: { payloadDigest, idempotencyKey: 'idem-restricted' },
      socialAction: action,
      socialApproval: {
        id: 'approval-restricted', approvedAt: '2026-07-10T13:59:00.000Z', expiresAt: '2026-07-10T14:30:00.000Z',
        actionId: action.actionId, actionDigest: action.actionDigest, mediaDigest: action.mediaDigest,
        payloadDigest, platform: 'x', profileId: 'artist-main', approvedBy: { type: 'user', clientId: 'test-client' },
      },
    })])
    updateReleaseKitItemUsage(root, workspaceId, workspaceId, released.item.id, {
      restrictions: { artistLikenessRestricted: true },
    })
    let executeCalls = 0
    const runner = new ScheduledWorkRunner({
      canRunBackgroundWork: () => true, withLock: createLock(),
      executeAgentTask: async () => ({ sessionId: 'unused' }), startWorkflow: async () => ({ runId: 'unused' }),
      readWorkflowRun: () => null, listOutputManifests: () => [],
      executeSocial: async () => { executeCalls += 1; return { receiptId: 'must-not-run', summary: 'Must not run.' } },
    })

    await runner.scanWorkspace(workspaceId, root, new Date('2026-07-10T14:01:00.000Z'))
    await waitFor(() => readWork(root).items[0]?.status === 'needs-attention')
    expect(executeCalls).toBe(0)
    expect(readWork(root).items[0]?.attention?.message).toMatch(/artist-likeness restriction/i)
  })

  test('moves expired durable authorization to attention before preparation', async () => {
    const root = makeRoot()
    const releaseKitRef = { itemId: 'kit-expired', sha256: 'b'.repeat(64) }
    const definition = {
      title: 'Expired authorization', releaseKitRef, platform: 'x', profileId: 'artist-main',
      caption: 'Do not post.', startAt: '2026-07-10T14:00:00.000Z', timezone: 'UTC',
    }
    const payloadDigest = `sha256:${createHash('sha256').update(stableAuthorizationJson(definition)).digest('hex')}`
    writeWork(root, [buildOrder({
      id: 'social-authorization-expired', title: definition.title, type: 'social-publish', status: 'needs-approval',
      startAt: definition.startAt, timezone: definition.timezone,
      execution: { type: 'social-publish', platform: 'x', profileId: 'artist-main', caption: definition.caption },
      inputRefs: [{ kind: 'release-kit', ...releaseKitRef }],
      executionKey: { payloadDigest, idempotencyKey: 'idem-authorization-expired' },
      authorizationPolicy: 'durable-v1',
      authorization: {
        id: 'auth-expired', authorizedAt: '2026-07-10T12:00:00.000Z', expiresAt: '2026-07-10T13:59:00.000Z',
        payloadDigest, authorizedBy: { type: 'user', clientId: 'client-1', source: 'release-kit-ui' }, definition,
      },
    })])
    let prepareCalls = 0
    const runner = new ScheduledWorkRunner({
      canRunBackgroundWork: () => true, withLock: createLock(),
      executeAgentTask: async () => ({ sessionId: 'unused' }), startWorkflow: async () => ({ runId: 'unused' }),
      readWorkflowRun: () => null, listOutputManifests: () => [],
      prepareSocial: async () => { prepareCalls += 1; throw new Error('must not prepare') },
    })

    await runner.scanWorkspace(workspaceId, root, new Date('2026-07-10T14:01:00.000Z'))
    const saved = readWork(root).items[0]!
    expect(prepareCalls).toBe(0)
    expect(saved.status).toBe('needs-attention')
    expect(saved.attention?.reason).toBe('approval-invalidated')
  })

  test('rechecks the runner fence immediately before social execution', async () => {
    const root = makeRoot()
    const order = buildOrder({
      id: 'social-fence-change',
      type: 'social-publish',
      status: 'needs-approval',
      execution: { type: 'social-publish', platform: 'x', profileId: 'artist-main', caption: 'Guarded.' },
      executionKey: { payloadDigest: 'payload-fence', idempotencyKey: 'idem-fence' },
      socialAction: {
        actionId: 'act-fence', actionDigest: 'sha256:fence', platform: 'x', profileId: 'artist-main',
        preparedAt: '2026-07-10T14:00:00.000Z', payloadDigest: 'payload-fence', dryRun: { ok: true },
      },
      socialApproval: {
        id: 'approval-fence', approvedAt: '2026-07-10T14:00:00.000Z', expiresAt: '2026-07-10T14:30:00.000Z',
        actionId: 'act-fence', actionDigest: 'sha256:fence', payloadDigest: 'payload-fence', platform: 'x', profileId: 'artist-main',
        approvedBy: { type: 'user', clientId: 'test-client' },
      },
    })
    writeWork(root, [order])
    let fenceReads = 0
    let executeCalls = 0
    const runner = new ScheduledWorkRunner({
      canRunBackgroundWork: () => true,
      getBackgroundFenceToken: () => ++fenceReads === 1 ? 'epoch-1' : 'epoch-2',
      withLock: createLock(),
      executeAgentTask: async () => ({ sessionId: 'unused' }),
      startWorkflow: async () => ({ runId: 'unused' }),
      readWorkflowRun: () => null,
      listOutputManifests: () => [],
      executeSocial: async () => {
        executeCalls += 1
        return { receiptId: 'must-not-run', summary: 'unexpected' }
      },
    })

    await runner.scanWorkspace(workspaceId, root, new Date('2026-07-10T14:01:00.000Z'))
    await waitFor(() => readWork(root).items[0]?.status === 'needs-attention')

    expect(executeCalls).toBe(0)
    expect(readWork(root).items[0]?.attention?.message).toContain('runner fence changed')
  })

  test('blocks automatic browser publishing when shared mode has no enforced idempotency', async () => {
    const root = makeRoot()
    writeWork(root, [buildOrder({
      id: 'social-no-dedupe', type: 'social-publish', status: 'needs-approval',
      execution: { type: 'social-publish', platform: 'x', profileId: 'artist-main', caption: 'Manual only.' },
      executionKey: { payloadDigest: 'payload-no-dedupe', idempotencyKey: 'idem-no-dedupe' },
      socialAction: {
        actionId: 'act-no-dedupe', actionDigest: 'sha256:no-dedupe', platform: 'x', profileId: 'artist-main',
        preparedAt: '2026-07-10T14:00:00.000Z', payloadDigest: 'payload-no-dedupe', dryRun: { ok: true },
      },
      socialApproval: {
        id: 'approval-no-dedupe', approvedAt: '2026-07-10T14:00:00.000Z', expiresAt: '2026-07-10T14:30:00.000Z',
        actionId: 'act-no-dedupe', actionDigest: 'sha256:no-dedupe', payloadDigest: 'payload-no-dedupe', platform: 'x', profileId: 'artist-main',
        approvedBy: { type: 'user', clientId: 'test-client' },
      },
    })])
    let executeCalls = 0
    const runner = new ScheduledWorkRunner({
      canRunBackgroundWork: () => true,
      canExecuteSocialAutomatically: () => false,
      withLock: createLock(), executeAgentTask: async () => ({ sessionId: 'unused' }), startWorkflow: async () => ({ runId: 'unused' }),
      readWorkflowRun: () => null, listOutputManifests: () => [],
      executeSocial: async () => {
        executeCalls += 1
        return { receiptId: 'must-not-run', summary: 'unexpected' }
      },
    })

    const result = await runner.scanWorkspace(workspaceId, root, new Date('2026-07-10T14:01:00.000Z'))

    expect(executeCalls).toBe(0)
    expect(result.blocked).toBe(1)
    expect(readWork(root).items[0]?.attention?.reason).toBe('idempotency-unavailable')
  })

  test('does not prepare social approval more than 30 minutes before publish time', async () => {
    const root = makeRoot()
    writeWork(root, [buildOrder({
      id: 'social-future', type: 'social-publish', status: 'needs-approval', startAt: '2026-07-11T14:00:00.000Z',
      execution: { type: 'social-publish', platform: 'x', profileId: 'artist-main', caption: 'Tomorrow.' },
    })])
    let prepareCalls = 0
    const runner = new ScheduledWorkRunner({
      canRunBackgroundWork: () => true,
      withLock: createLock(), executeAgentTask: async () => ({ sessionId: 'unused' }), startWorkflow: async () => ({ runId: 'unused' }),
      readWorkflowRun: () => null, listOutputManifests: () => [],
      prepareSocial: async () => { prepareCalls += 1; throw new Error('must not prepare') },
    })
    const result = await runner.scanWorkspace(workspaceId, root, new Date('2026-07-10T14:00:00.000Z'))
    expect(result.scanned).toBe(0)
    expect(prepareCalls).toBe(0)
  })

  test('moves expired social approval to actionable attention', async () => {
    const root = makeRoot()
    writeWork(root, [buildOrder({
      id: 'social-expired', type: 'social-publish', status: 'needs-approval',
      execution: { type: 'social-publish', platform: 'x', profileId: 'artist-main', caption: 'Late.' },
      socialAction: { actionId: 'act_expired', actionDigest: 'sha256:expired', platform: 'x', profileId: 'artist-main', preparedAt: '2026-07-10T13:30:00.000Z', payloadDigest: 'digest-1', dryRun: {} },
      socialApproval: { id: 'approval-expired', approvedAt: '2026-07-10T13:35:00.000Z', expiresAt: '2026-07-10T13:59:00.000Z', actionId: 'act_expired', actionDigest: 'sha256:expired', payloadDigest: 'digest-1', platform: 'x', profileId: 'artist-main', approvedBy: { type: 'user', clientId: 'test-client' } },
    })])
    const runner = new ScheduledWorkRunner({
      canRunBackgroundWork: () => true,
      withLock: createLock(), executeAgentTask: async () => ({ sessionId: 'unused' }), startWorkflow: async () => ({ runId: 'unused' }),
      readWorkflowRun: () => null, listOutputManifests: () => [],
    })
    await runner.scanWorkspace(workspaceId, root, new Date('2026-07-10T14:01:00.000Z'))
    const saved = readWork(root).items[0]!
    expect(saved.status).toBe('needs-attention')
    expect(saved.attention?.reason).toBe('approval-expired')
    expect(saved.socialApproval).toBeUndefined()
  })

  test('marks stale running agent tasks with a persisted session id as needs-attention instead of rerunning them', async () => {
    const root = makeRoot()
    writeWork(root, [buildOrder({
      id: 'agent-stale',
      status: 'running',
      runs: [{
        id: 'run-entry-2',
        jobId: 'agent-stale',
        startedAt: '2026-07-10T14:00:00.000Z',
        status: 'running',
        sessionId: 'session-stale',
      }],
    })])

    let executeCalls = 0
    const runner = new ScheduledWorkRunner({
      canRunBackgroundWork: () => true,
      withLock: createLock(),
      executeAgentTask: async () => {
        executeCalls += 1
        return { sessionId: 'should-not-run' }
      },
      startWorkflow: async () => ({ runId: 'unused' }),
      readWorkflowRun: () => null,
      listOutputManifests: () => [],
    })

    await runner.scanWorkspace(workspaceId, root, new Date('2026-07-10T14:10:00.000Z'))

    const saved = readWork(root).items[0]!
    expect(executeCalls).toBe(0)
    expect(saved.status).toBe('needs-attention')
    expect(saved.attention?.reason).toBe('execution-failed')
    expect(saved.attention?.message).toContain('session session-stale')
  })

  test('reconciles a completed persisted agent session after restart', async () => {
    const root = makeRoot()
    writeWork(root, [buildOrder({
      id: 'agent-recovered',
      status: 'running',
      runs: [{
        id: 'run-entry-recovered',
        jobId: 'agent-recovered',
        startedAt: '2026-07-10T14:00:00.000Z',
        status: 'running',
        sessionId: 'session-recovered',
      }],
    })])

    const runner = new ScheduledWorkRunner({
      canRunBackgroundWork: () => true,
      withLock: createLock(),
      executeAgentTask: async () => { throw new Error('must not relaunch') },
      startWorkflow: async () => ({ runId: 'unused' }),
      readWorkflowRun: () => null,
      readAgentSession: async () => 'completed',
      listOutputManifests: () => [],
    })

    await runner.scanWorkspace(workspaceId, root, new Date('2026-07-10T14:10:00.000Z'))
    const saved = readWork(root).items[0]!
    expect(saved.status).toBe('done')
    expect(saved.result).toEqual({ type: 'agent-task', sessionId: 'session-recovered', outputIds: [] })
    expect(saved.runs[0]?.status).toBe('done')
  })

  test('keeps a recoverable queued agent session running until its final response exists', async () => {
    const root = makeRoot()
    writeWork(root, [buildOrder({
      id: 'agent-queued-recovery',
      status: 'running',
      runs: [{
        id: 'run-entry-queued',
        jobId: 'agent-queued-recovery',
        startedAt: '2026-07-10T14:00:00.000Z',
        status: 'running',
        sessionId: 'session-queued',
      }],
    })])
    let state: 'running' | 'completed' = 'running'
    const runner = new ScheduledWorkRunner({
      canRunBackgroundWork: () => true,
      withLock: createLock(),
      executeAgentTask: async () => { throw new Error('must not relaunch') },
      startWorkflow: async () => ({ runId: 'unused' }),
      readWorkflowRun: () => null,
      readAgentSession: async () => state,
      listOutputManifests: () => [],
    })

    await runner.scanWorkspace(workspaceId, root, new Date('2026-07-10T14:10:00.000Z'))
    expect(readWork(root).items[0]?.status).toBe('running')

    state = 'completed'
    await runner.scanWorkspace(workspaceId, root, new Date('2026-07-10T14:11:00.000Z'))
    expect(readWork(root).items[0]?.status).toBe('done')
  })

  test('blocks uncertain social execution after restart instead of posting again', async () => {
    const root = makeRoot()
    writeWork(root, [buildOrder({
      id: 'social-uncertain',
      type: 'social-publish',
      status: 'running',
      execution: { type: 'social-publish', platform: 'x', profileId: 'artist-main', caption: 'Out Friday.' },
      socialAction: {
        actionId: 'act_social-uncertain',
        actionDigest: 'sha256:uncertain',
        platform: 'x',
        profileId: 'artist-main',
        preparedAt: '2026-07-10T13:30:00.000Z',
        payloadDigest: 'digest-1',
        dryRun: {},
      },
      socialApproval: {
        id: 'approval-uncertain',
        approvedAt: '2026-07-10T13:35:00.000Z',
        expiresAt: '2026-07-10T15:00:00.000Z',
        actionId: 'act_social-uncertain',
        actionDigest: 'sha256:uncertain',
        payloadDigest: 'digest-1',
        platform: 'x',
        profileId: 'artist-main',
        approvedBy: { type: 'user', clientId: 'test-client' },
      },
      runs: [{
        id: 'run-social-uncertain',
        jobId: 'social-uncertain',
        startedAt: '2026-07-10T14:00:00.000Z',
        status: 'running',
      }],
    })])
    let executeCalls = 0
    const runner = new ScheduledWorkRunner({
      canRunBackgroundWork: () => true,
      withLock: createLock(),
      executeAgentTask: async () => ({ sessionId: 'unused' }),
      startWorkflow: async () => ({ runId: 'unused' }),
      readWorkflowRun: () => null,
      listOutputManifests: () => [],
      executeSocial: async () => {
        executeCalls += 1
        return { receiptId: 'must-not-post', summary: 'must not post' }
      },
    })

    await runner.scanWorkspace(workspaceId, root, new Date('2026-07-10T14:10:00.000Z'))
    const saved = readWork(root).items[0]!
    expect(executeCalls).toBe(0)
    expect(saved.status).toBe('needs-attention')
    expect(saved.attention?.reason).toBe('execution-uncertain')
    expect(saved.socialApproval).toBeUndefined()

    await runner.scanWorkspace(workspaceId, root, new Date('2026-07-10T14:11:00.000Z'))
    expect(executeCalls).toBe(0)
  })

  test('keeps canceled work terminal when an in-flight agent later fails', async () => {
    const root = makeRoot()
    writeWork(root, [buildOrder()])
    const execution = deferred<void>()
    const runner = new ScheduledWorkRunner({
      canRunBackgroundWork: () => true,
      withLock: createLock(),
      executeAgentTask: async ({ onStarted }) => {
        await onStarted('session-canceled')
        await execution.promise
        throw new Error('late session failure')
      },
      startWorkflow: async () => ({ runId: 'unused' }),
      readWorkflowRun: () => null,
      listOutputManifests: () => [],
    })

    const scan = runner.scanWorkspace(workspaceId, root, new Date('2026-07-10T14:01:00.000Z'))
    await waitFor(() => readWork(root).items[0]?.runs.at(-1)?.sessionId === 'session-canceled')
    const running = readWork(root).items[0]!
    writeWork(root, [{ ...running, status: 'canceled', updatedAt: '2026-07-10T14:01:30.000Z' }])
    execution.resolve()
    await scan

    const saved = readWork(root).items[0]!
    expect(saved.status).toBe('canceled')
    expect(saved.attention).toBeUndefined()
    expect(saved.runs.at(-1)?.status).toBe('running')
  })

  test('moves work beyond the 24-hour catch-up window to visible attention', async () => {
    const root = makeRoot()
    writeWork(root, [buildOrder({ startAt: '2026-07-08T14:00:00.000Z' })])
    let executeCalls = 0
    const runner = new ScheduledWorkRunner({
      canRunBackgroundWork: () => true,
      withLock: createLock(),
      executeAgentTask: async () => {
        executeCalls += 1
        return { sessionId: 'unused' }
      },
      startWorkflow: async () => ({ runId: 'unused' }),
      readWorkflowRun: () => null,
      listOutputManifests: () => [],
    })

    await runner.scanWorkspace(workspaceId, root, new Date('2026-07-10T14:01:00.000Z'))

    const saved = readWork(root).items[0]!
    expect(executeCalls).toBe(0)
    expect(saved.status).toBe('needs-attention')
    expect(saved.attention?.reason).toBe('missed-start-window')
  })

  test('migrates a due legacy calendar job and runs it through Scheduled Work', async () => {
    const root = makeRoot()
    const calendarItem = createCampaignCalendarItem({
      campaignId: workspaceId,
      date: '2026-07-10',
      time: '09:00',
      timezone: 'America/Chicago',
      title: 'Legacy launch copy',
      kind: 'scheduled-job',
      status: 'scheduled',
      job: createCampaignScheduledJob({
        runAt: '2026-07-10T14:00:00.000Z',
        timezone: 'America/Chicago',
        actionType: 'ask-agent',
        payload: { prompt: 'Write launch copy.', agentSlug: 'content-genius' },
      }),
    })
    upsertContextDoc(root, {
      slug: CAMPAIGN_CALENDAR_CONTEXT_SLUG,
      metadata: campaignCalendarMetadata(),
      body: serializeCampaignCalendarBody({
        version: 1,
        campaignId: workspaceId,
        items: [calendarItem],
        updatedAt: '2026-07-10T13:00:00.000Z',
      }),
    })
    let executeCalls = 0

    const runner = new ScheduledWorkRunner({
      canRunBackgroundWork: () => true,
      withLock: createLock(),
      executeAgentTask: async () => {
        executeCalls += 1
        return { sessionId: 'legacy-session' }
      },
      startWorkflow: async () => ({ runId: 'unused' }),
      readWorkflowRun: () => null,
      listOutputManifests: () => [],
    })

    const result = await runner.scanWorkspace(workspaceId, root, new Date('2026-07-10T14:01:00.000Z'))
    expect(result.scanned).toBe(1)
    expect(result.started).toBe(1)
    expect(executeCalls).toBe(1)
    await waitFor(() => readWork(root).items[0]?.status === 'done')
    expect(readWork(root).items[0]).toMatchObject({ status: 'done', result: { sessionId: 'legacy-session' } })
    expect(readWork(root).items[0]?.legacyRef).toBeUndefined()
    const parsedCalendar = parseCampaignCalendarDocResult(
      loadContextDoc(root, CAMPAIGN_CALENDAR_CONTEXT_SLUG)!,
      workspaceId,
    )
    expect(parsedCalendar.ok).toBe(true)
    expect(parsedCalendar.calendar.items[0]?.job).toBeUndefined()
    expect(parsedCalendar.calendar.items[0]?.scheduledWorkId).toBe(readWork(root).items[0]?.id)
  })
})
