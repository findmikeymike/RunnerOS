import { describe, expect, test, spyOn } from 'bun:test'
import { RPC_CHANNELS, DURABLE_RUNTIME_MANIFEST, type WorkflowAttentionDTO } from '@craft-agent/shared/protocol'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import * as config from '@craft-agent/shared/config'
import * as agent from '@craft-agent/shared/agent'
import * as workflows from '@craft-agent/shared/workflows'
import { DurableJournal } from '../../../../shared/src/durable-execution/index.ts'
import { DurableWorkflowControls } from '../../workflows/durable-workflow-controls'
import { registerWorkflowRunsHandlers } from './workflow-runs'
import type { HandlerDeps } from '../handler-deps'
import type { HandlerFn, RpcServer } from '../../transport/types'

const context = { clientId: 'trusted-client', workspaceId: 'workspace', webContentsId: null }
const command = { commandId: 'decision-one', expectedVersion: 7 }
const attention: WorkflowAttentionDTO = {
  id: 'durable:run:approval', workflowRunId: 'run', status: 'approved',
  recommendation: 'Review this read', createdAt: 1, toolCall: { name: 'read', args: {} },
}
function harness(options: { unavailable?: boolean; failure?: string; pushFails?: boolean } = {}) {
  const handlers = new Map<string, HandlerFn>()
  const calls: unknown[][] = []
  const pushes: unknown[][] = []
  const delivered = new Map([['trusted-client', [] as unknown[]], ['other-client', [] as unknown[]]])
  const service = {
    listAttention: async () => [],
    resolveAttention: async (...args: unknown[]) => {
      calls.push(args)
      if (options.failure) throw new Error(options.failure)
      const actor = args[4] as typeof context
      if (actor.workspaceId !== args[0]) throw new Error('durable-workspace-denied')
      return attention
    },
  }
  registerWorkflowRunsHandlers({
    handle: (channel: string, handler: HandlerFn) => handlers.set(channel, handler),
    push: (...args: unknown[]) => { pushes.push(args)
      const target = args[1] as { to: string; clientId?: string }
      for (const [id, inbox] of delivered) if (target.to === 'workspace' || target.to === 'client' && target.clientId === id) inbox.push(args[3])
      if (options.pushFails) throw new Error('disconnected') },
  } as unknown as RpcServer, {
    ...(options.unavailable ? {} : { getDurableWorkflowControls: () => service }),
  } as unknown as HandlerDeps)
  const resolve = (...args: unknown[]) => handlers.get(RPC_CHANNELS.workflowRuns.RESOLVE_ATTENTION)!(context, ...args)
  return { resolve, calls, pushes, delivered }
}

describe('optional durable workflow attention RPC', () => {
  test('forwards only trusted transport actor and exact decision command, then publishes committed result', async () => {
    const h = harness()
    expect(await h.resolve('workspace', attention.id, 'approved', command)).toEqual(attention)
    expect(h.calls).toEqual([['workspace', attention.id, 'approved', command, { clientId: context.clientId, workspaceId: context.workspaceId }]])
    expect(h.pushes).toHaveLength(1)
    expect(h.pushes[0]![1]).toEqual({ to: 'client', clientId: context.clientId })
    expect(h.delivered.get('trusted-client')).toEqual([attention])
    expect(h.delivered.get('other-client')).toEqual([])
  })
  test('reserved IDs fail closed with rollout disabled, without consulting legacy storage', async () => {
    const h = harness({ unavailable: true })
    await expect(h.resolve('not-a-configured-workspace', attention.id, 'approved', command)).rejects.toThrow('not available')
  })
  test('service storage and stale-version errors propagate without legacy fallback or event', async () => {
    for (const failure of ['SQLITE_FULL', 'durable-version-conflict']) {
      const h = harness({ failure })
      await expect(h.resolve('workspace', attention.id, 'approved', command)).rejects.toThrow(failure)
      expect(h.pushes).toHaveLength(0)
    }
  })
  test('rejects unknown decisions before calling the service', async () => {
    const h = harness()
    await expect(h.resolve('workspace', attention.id, 'approve', command)).rejects.toThrow('Invalid attention decision')
    expect(h.calls).toHaveLength(0)
  })
  test('requires valid CAS metadata and rejects injected actor authority', async () => {
    const h = harness()
    for (const invalid of [undefined, null, [], {}, { ...command, expectedVersion: -1 }, { ...command, expectedVersion: 1.5 }, { ...command, commandId: '' }, { ...command, principalId: 'spoofed' }]) {
      await expect(h.resolve('workspace', attention.id, 'approved', invalid)).rejects.toThrow('requires commandId')
    }
    expect(h.calls).toHaveLength(0)
  })
  test('durable metadata cannot be sent to the legacy decision path', async () => {
    const h = harness()
    await expect(h.resolve('workspace', 'legacy-id', 'approved', command)).rejects.toThrow('cannot target legacy')
    expect(h.calls).toHaveLength(0)
  })
  test('passes transport workspace to the service so cross-workspace decisions are denied', async () => {
    const h = harness()
    await expect(h.resolve('other-workspace', attention.id, 'approved', command)).rejects.toThrow('durable-workspace-denied')
    expect(h.pushes).toHaveLength(0)
  })
  test('an event delivery error cannot turn a committed decision into an apparent failure', async () => {
    const h = harness({ pushFails: true })
    expect(await h.resolve('workspace', attention.id, 'rejected', command)).toEqual(attention)
    expect(h.calls).toHaveLength(1)
  })
})

test('mixed attention listing preserves a legacy filtered run with a real durable service', async () => {
  const root = mkdtempSync(join(tmpdir(), 'durable-rpc-mixed-'))
  const journal = new DurableJournal({ configRoot: root, key: randomBytes(32) })
  const legacy = { ...attention, id: 'legacy-attention', workflowRunId: 'legacy-run', status: 'pending' as const }
  const otherWorkspace = { ...legacy, id: 'other-workspace', workflowRunId: 'foreign-run' }
  const getWorkspace = spyOn(config, 'getWorkspaceByNameOrId').mockReturnValue({ id: 'workspace', rootPath: root } as ReturnType<typeof config.getWorkspaceByNameOrId>)
  const pending = spyOn(agent, 'listPendingEscalations').mockReturnValue([legacy, otherWorkspace] as ReturnType<typeof agent.listPendingEscalations>)
  const readRun = spyOn(workflows, 'readRun').mockImplementation((_root, runId) => ({ workspaceId: runId === 'legacy-run' ? 'workspace' : 'foreign' }) as ReturnType<typeof workflows.readRun>)
  try {
    const service = new DurableWorkflowControls({ journal, resolvePrincipal: () => 'alice', runner: { decide: async () => { throw new Error('unexpected decision') } } })
    const handlers = new Map<string, HandlerFn>()
    registerWorkflowRunsHandlers({ handle: (channel: string, fn: HandlerFn) => handlers.set(channel, fn) } as unknown as RpcServer,
      { getDurableWorkflowControls: () => service } as unknown as HandlerDeps)
    const result = await handlers.get(RPC_CHANNELS.workflowRuns.LIST_ATTENTION)!(context, 'workspace', 'legacy-run')
    expect(result).toEqual([legacy])
    expect(pending).toHaveBeenCalledWith({ workflowRunId: 'legacy-run' })
    expect(journal.listInternal('workspace')).toEqual([])
  } finally {
    readRun.mockRestore(); pending.mockRestore(); getWorkspace.mockRestore()
    journal.close(); rmSync(root, { recursive: true, force: true })
  }
})


test('explicit durable controls never use legacy controls or require service startup', async () => {
  const handlers = new Map<string, HandlerFn>()
  let legacyCalls = 0
  registerWorkflowRunsHandlers({ handle: (channel: string, fn: HandlerFn) => handlers.set(channel, fn) } as unknown as RpcServer,
    { getWorkflowRunner: () => { legacyCalls++; throw new Error('legacy fallback') } } as unknown as HandlerDeps)
  await expect(handlers.get(RPC_CHANNELS.workflowRuns.DURABLE_CONTROL)!(context, 'workspace', 'run', { action: 'resume', commandId: 'resume', expectedVersion: 1 })).rejects.toThrow('not available')
  expect(legacyCalls).toBe(0)
})

test('real control service returns committed receipt without waiting and preserves later state on duplicate', async () => {
  const root = mkdtempSync(join(tmpdir(), 'durable-rpc-control-'))
  const journal = new DurableJournal({ configRoot: root, key: randomBytes(32) })
  try {
    journal.admit({ engine: 'sqlite-v2-readonly-1', runId: 'control-run', workspaceId: 'workspace', commandId: 'admit',
      createdAt: Date.now(), credentialIdentity: 'a'.repeat(64), runtimeManifest: { ...DURABLE_RUNTIME_MANIFEST },
      allowedTools: ['read'], model: 'fake', maxOutputTokens: 100, maxModelAttempts: 10, authority: {}, context: {},
      deadlineAt: Date.now() + 60000, costPolicy: { unit: 'verified-free', maxTotalUnits: 0, maxUnitsPerAttempt: 0 }, approvalPrincipalId: 'alice' })
    const actors: unknown[] = []
    let dispatches = 0
    const service = new DurableWorkflowControls({ journal,
      resolvePrincipal: (_workspace, actor) => { actors.push(actor); return 'alice' },
      runner: { decide: async () => { throw new Error('unexpected approval') },
        control: async (request) => { dispatches++; return { receipt: journal.command(request), execution: new Promise(() => {}) } } },
    })
    const handlers = new Map<string, HandlerFn>()
    const deps = { getWorkflowRunner: () => { throw new Error('legacy fallback') } } as unknown as HandlerDeps
    registerWorkflowRunsHandlers({ handle: (channel: string, fn: HandlerFn) => handlers.set(channel, fn) } as unknown as RpcServer, deps)
    const control = handlers.get(RPC_CHANNELS.workflowRuns.DURABLE_CONTROL)!
    const invoke = (command: unknown, workspace = 'workspace') => control(context, workspace, 'control-run', command)
    // Bootstrap registers legacy handlers first, then attaches durable controls only after successful startup.
    await expect(invoke({ action: 'pause', commandId: 'early', expectedVersion: 1 })).rejects.toThrow('not available')
    expect(dispatches).toBe(0)
    deps.getDurableWorkflowControls = () => service
    const pause = { action: 'pause', commandId: 'pause', expectedVersion: journal.get('control-run', 'workspace').version }
    const first = await invoke(pause)
    expect(first.receipt.action).toBe('pause')
    expect(first.state.status).toBe('paused')
    expect(actors).toEqual([{ clientId: context.clientId, workspaceId: context.workspaceId }])
    const resumed = await invoke({ action: 'resume', commandId: 'resume', expectedVersion: first.state.version })
    const duplicate = await invoke(pause)
    expect(duplicate.receipt).toEqual(first.receipt)
    expect(duplicate.state).toEqual(resumed.state)
    expect(duplicate.state.status).toBe('running')
    expect(dispatches).toBe(2)
    await expect(invoke({ action: 'cancel', commandId: 'spoofed', expectedVersion: resumed.state.version, principalId: 'alice' })).rejects.toThrow('invalid-durable-control-command')
    await expect(invoke({ action: 'cancel', commandId: 'cross-workspace', expectedVersion: resumed.state.version }, 'other')).rejects.toThrow('workspace-mismatch')
    expect(journal.get('control-run', 'workspace').status).toBe('running')
  } finally { journal.close(); rmSync(root, { recursive: true, force: true }) }
})
