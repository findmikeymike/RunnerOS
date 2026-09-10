import { expect, test } from 'bun:test'
import type { WorkflowRunDTO, DurableWorkflowCommandDTO, DurableWorkflowControlResultDTO } from '../../shared/types'
import { controlDurableRun, mergeWorkflowRuns, preferWorkflowRun, visibleWorkflowRun } from './durable-workflow-run'

const run = (version = 4): WorkflowRunDTO => ({ id: 'run', workspaceId: 'w', workflowSlug: 'read', state: 'paused',
  createdAt: '2026-01-01', updatedAt: '2026-01-01', steps: [], trigger: { type: 'manual', inputs: {}, firedAt: '2026-01-01' },
  workflowSnapshot: { metadata: { name: 'Read', description: '', steps: [], trigger: { type: 'manual' } }, body: '' },
  durable: { engine: 'sqlite-v2-readonly-1', version, status: 'paused', controlRevision: 1, continuationRevision: 0 } })
const result = {} as DurableWorkflowControlResultDTO

test('lost response retries exact command even after polling advances the displayed version', async () => {
  const commands = new Map<string, DurableWorkflowCommandDTO>(), requests: DurableWorkflowCommandDTO[] = []
  const api = { async controlDurableWorkflowRun(_w: string, _r: string, command: DurableWorkflowCommandDTO) {
    requests.push({ ...command }); if (requests.length === 1) throw new Error('lost response'); return result
  }, async getWorkflowRun() { return run(8) } }
  await expect(controlDurableRun({ workspaceId: 'w', run: run(), action: 'resume', commands, api })).rejects.toThrow('lost response')
  expect(await controlDurableRun({ workspaceId: 'w', run: run(8), action: 'resume', commands, api })).toEqual(run(8))
  expect(requests[1]).toEqual(requests[0]); expect(commands.size).toBe(0)
})

test('conflict requires another click and a fresh version; no automatic resubmission', async () => {
  const commands = new Map<string, DurableWorkflowCommandDTO>(), requests: DurableWorkflowCommandDTO[] = []
  const api = { async controlDurableWorkflowRun(_w: string, _r: string, command: DurableWorkflowCommandDTO) {
    requests.push({ ...command }); if (requests.length === 1) throw new Error('durable-control-version-conflict'); return result
  }, async getWorkflowRun() { return run(8) } }
  await expect(controlDurableRun({ workspaceId: 'w', run: run(), action: 'pause', commands, api })).rejects.toThrow('conflict')
  expect(requests).toHaveLength(1)
  await controlDurableRun({ workspaceId: 'w', run: run(8), action: 'pause', commands, api })
  expect(requests[1]!.expectedVersion).toBe(8); expect(requests[1]!.commandId).not.toBe(requests[0]!.commandId)
})

test('failed read after committed command retains identity; foreign and legacy runs cannot dispatch', async () => {
  const commands = new Map<string, DurableWorkflowCommandDTO>(); let calls = 0
  const api = { async controlDurableWorkflowRun() { calls++; return result }, async getWorkflowRun() { return null } }
  await expect(controlDurableRun({ workspaceId: 'w', run: run(), action: 'cancel', commands, api })).rejects.toThrow('unavailable')
  expect(commands.size).toBe(1)
  await expect(controlDurableRun({ workspaceId: 'other', run: run(), action: 'cancel', commands, api })).rejects.toThrow('Invalid')
  expect(calls).toBe(1)
})

test('saved versions defeat stale broadcasts, while same-version worker presence may change', () => {
  expect(preferWorkflowRun(run(8), run(4)).durable!.version).toBe(8)
  expect(preferWorkflowRun(run(8), { ...run(8), state: 'interrupted' }).state).toBe('interrupted')
  expect(mergeWorkflowRuns([run(4)], [run(8)])[0]!.durable!.version).toBe(8)
})

test('successful list removes hidden durable rows and mount hydration cannot resurrect them', () => {
  const saved = run(); const { durable: _durable, ...legacy } = { ...saved, id: 'legacy' }
  const merged = mergeWorkflowRuns([], [saved, legacy])
  expect(merged).toEqual([legacy])
  expect(visibleWorkflowRun(merged, saved.id, saved, true)).toBeNull()
  expect(visibleWorkflowRun([], saved.id, saved, false)).toBe(saved)
  expect(visibleWorkflowRun([run(8)], saved.id, saved, true)).toEqual(run(8))
})

test('a completed visibility decision stays authoritative through later loading and failures', () => {
  const hydrated = run()
  const successful = { runs: mergeWorkflowRuns([], [hydrated]), hasLoaded: true, loading: false, error: null as string | null }
  for (const state of [successful, { ...successful, loading: true }, { ...successful, error: 'offline' }]) {
    expect(visibleWorkflowRun(state.runs, hydrated.id, hydrated, state.hasLoaded)).toBeNull()
  }
})
