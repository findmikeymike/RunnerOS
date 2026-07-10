import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { OutputManifest } from '@craft-agent/shared/outputs'
import {
  SCHEDULED_WORK_CONTEXT_SLUG,
  parseScheduledWorkDocResult,
  scheduledWorkMetadata,
  serializeScheduledWorkBody,
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

function writeWork(root: string, items: ScheduledWorkOrder[]): void {
  const work: ScheduledWorkDocument = {
    version: 1,
    workspaceId,
    items,
    updatedAt: '2026-07-09T00:00:00.000Z',
  }
  upsertContextDoc(root, {
    slug: SCHEDULED_WORK_CONTEXT_SLUG,
    metadata: scheduledWorkMetadata(),
    body: serializeScheduledWorkBody(work),
  })
}

function readWork(root: string): ScheduledWorkDocument {
  const parsed = parseScheduledWorkDocResult(loadContextDoc(root, SCHEDULED_WORK_CONTEXT_SLUG) ?? undefined, workspaceId)
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
    attention: overrides.attention,
    executionKey: overrides.executionKey ?? { payloadDigest: 'digest-1', idempotencyKey: 'idem-1' },
    chain: overrides.chain,
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
  test('keeps an agent task running after launch, persists the session id immediately, and blocks duplicate scans', async () => {
    const root = makeRoot()
    writeWork(root, [buildOrder()])

    const execution = deferred<void>()
    const executeCalls: string[] = []
    const runner = new ScheduledWorkRunner({
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

  test('does not let an ask-mode agent block later due work in the workspace', async () => {
    const root = makeRoot()
    const ask = buildOrder({ id: 'ask-1', calendarLink: { calendar: 'campaign', itemId: 'calendar-ask' }, execution: {
      type: 'agent-task', agentSlug: 'content-genius', brief: 'Wait for permission.', permissionMode: 'ask', expectedOutput: { requirement: 'none' },
    } })
    const automatic = buildOrder({ id: 'auto-2', calendarLink: { calendar: 'campaign', itemId: 'calendar-auto' } })
    writeWork(root, [ask, automatic])
    const permission = deferred<void>()
    const runner = new ScheduledWorkRunner({
      withLock: createLock(),
      executeAgentTask: async ({ workOrderId, onStarted }) => {
        await onStarted(`session-${workOrderId}`)
        if (workOrderId === 'ask-1') await permission.promise
        return { sessionId: `session-${workOrderId}` }
      },
      startWorkflow: async () => ({ runId: 'unused' }),
      readWorkflowRun: () => null,
      listOutputManifests: () => [],
    })

    await runner.scanWorkspace(workspaceId, root, new Date('2026-07-10T14:01:00.000Z'))
    await waitFor(() => readWork(root).items.find((order) => order.id === 'auto-2')?.status === 'done')
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
    const runner = new ScheduledWorkRunner({
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
      listOutputManifests: () => [],
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

  test('does not prepare social approval more than 30 minutes before publish time', async () => {
    const root = makeRoot()
    writeWork(root, [buildOrder({
      id: 'social-future', type: 'social-publish', status: 'needs-approval', startAt: '2026-07-11T14:00:00.000Z',
      execution: { type: 'social-publish', platform: 'x', profileId: 'artist-main', caption: 'Tomorrow.' },
    })])
    let prepareCalls = 0
    const runner = new ScheduledWorkRunner({
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

  test('never touches embedded legacy campaign jobs', async () => {
    const root = makeRoot()
    writeWork(root, [buildOrder({
      id: 'legacy-1',
      legacyRef: { campaignItemId: 'campaign-item-1', campaignJobId: 'campaign-job-1' },
    })])

    const runner = new ScheduledWorkRunner({
      withLock: createLock(),
      executeAgentTask: async () => ({ sessionId: 'unused' }),
      startWorkflow: async () => ({ runId: 'unused' }),
      readWorkflowRun: () => null,
      listOutputManifests: () => [],
    })

    const result = await runner.scanWorkspace(workspaceId, root, new Date('2026-07-10T14:01:00.000Z'))
    expect(result.scanned).toBe(0)
    expect(readWork(root).items[0]?.status).toBe('scheduled')
  })
})
