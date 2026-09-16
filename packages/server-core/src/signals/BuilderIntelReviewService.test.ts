import { afterEach, beforeEach, expect, test, mock } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Workspace } from '@craft-agent/core/types';
import type { SignalRetrievedEntry } from '@craft-agent/shared/shared-intel';
import type { ScheduledWorkOrder } from '@craft-agent/shared/scheduled-work';
import { resolveAutomationsConfigPath } from '@craft-agent/shared/automations/resolve-config-path';
import { BuilderIntelReviewService } from './BuilderIntelReviewService';
import { hash, readSignals, writeSignals, type SignalRequest } from './storage';
let root: string, workspace: Workspace, service: BuilderIntelReviewService, now: number;
let entries: Map<string, SignalRetrievedEntry[]>; let orders: ScheduledWorkOrder[];
let queue: ReturnType<typeof mock>; let fail: boolean; let beforeAdmit: (() => void) | undefined;
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'builder-intel-')); now = Date.parse('2026-09-16T12:00:00Z');
  workspace = { id: 'hq', rootPath: root, artistWorkspaceScope: 'hq' } as Workspace;
  entries = new Map(); orders = []; fail = false; beforeAdmit = undefined;
  queue = mock(async (_id, _root, _pending, deps) => { beforeAdmit?.(); if (deps?.canAdmit?.() === false) return { orderIds: [], calendarItemIds: [] }; if (fail) throw new Error('admission failed'); const id = `order-${orders.length}`; orders.push({ id, status: 'scheduled' } as ScheduledWorkOrder); return { orderIds: [id], calendarItemIds: [] }; });
  service = new BuilderIntelReviewService({ workspaces: () => [workspace], permission: () => {}, withAutomationLock: async (_path, fn) => fn(), now: () => now,
    entries: (_workspace, id) => entries.get(id) ?? [], orders: () => orders, queue });
  await service.ensureControl('hq');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
function report(id: string, age = 0, sourceAge: number | null = age, status = 'report') {
  const date = new Date(now - age * 86400_000).toISOString(); const contentHash = hash(id);
  const state = readSignals(root, 'hq');
  state.requests.push({ runId: id, outputId: id, outputHash: contentHash, status, createdAt: date, packets: [], websites: [] } as unknown as SignalRequest);
  writeSignals(root, state);
  entries.set(id, [{ createdAt: date, sources: [{ sourcePublishedAt: sourceAge === null ? undefined : new Date(now - sourceAge * 86400_000).toISOString() }],
    reference: { hqWorkspaceId: 'hq', outputId: id, contentHash, entryId: 'finding' }, title: id, excerpt: 'Verified evidence' } as SignalRetrievedEntry]);
}
test('aggregates eligible catchup into one safe hidden tracked task, blocks next batch until terminal', async () => {
  for (let i = 0; i < 7; i++) report(`report-${i}`, 45);
  expect((await service.reconcile('hq')).queued).toBe(5); expect(queue).toHaveBeenCalledTimes(1);
  const pending = queue.mock.calls[0]![2];
  expect(pending.action.calendarVisibility).toBe('hidden');
  expect(pending.action.execution).toMatchObject({ agentSlug: 'builder', taskModeId: 'intel-review', permissionMode: 'safe', expectedOutput: { requirement: 'none' } });
  expect(pending.action.execution.brief).toContain('NO_USEFUL_CAPABILITY');
  expect((await service.reconcile('hq')).queued).toBe(0);
  orders[0]!.status = 'needs-attention'; expect((await service.reconcile('hq')).queued).toBe(0);
  orders[0]!.status = 'done'; expect((await service.reconcile('hq')).queued).toBe(2);
  orders[1]!.status = 'done'; expect((await service.reconcile('hq')).queued).toBe(0);
});
test('ignores old reports, old or unknown sources, future reports, and source packets', async () => {
  report('old-report', 61); report('old-source', 0, 61); report('unknown', 0, null); report('future', -1); report('packet', 0, 0, 'running');
  expect((await service.reconcile('hq')).queued).toBe(0); expect(queue).not.toHaveBeenCalled();
  report('boundary', 60); expect((await service.reconcile('hq')).queued).toBe(1);
});
test('keeps pause across ensure, excludes unrelated pending actions, resumes catchup', async () => {
  report('new'); const path = resolveAutomationsConfigPath(root); const config = JSON.parse(readFileSync(path, 'utf8'));
  config.automations.SchedulerTick[0].enabled = false; writeFileSync(path, JSON.stringify(config));
  await service.ensureControl('hq'); expect((await service.reconcile('hq')).queued).toBe(0);
  expect(await service.queueScheduled('hq', { matcherId: 'other' } as never)).toEqual({ handled: false, orderIds: [] });
  config.automations.SchedulerTick[0].enabled = true; writeFileSync(path, JSON.stringify(config));
  expect(await service.queueScheduled('hq', { matcherId: config.automations.SchedulerTick[0].id } as never)).toEqual({ handled: true, orderIds: ['order-0'] });
});
test('admission failure retries identical durable batch despite new reports', async () => {
  report('first'); fail = true; await expect(service.reconcile('hq')).rejects.toThrow('admission failed');
  const pending = queue.mock.calls[0]![2]; report('second'); fail = false;
  expect((await service.reconcile('hq')).queued).toBe(1); expect(queue.mock.calls[1]![2]).toEqual(pending);
  expect(readSignals(root, 'hq').requests[0]!.builderReview!.orderIds).toEqual(['order-0']);
});
test('a crashed pending batch cannot revive aged-out evidence', async () => {
  report('old', 59); fail = true; await expect(service.reconcile('hq')).rejects.toThrow();
  now += 2 * 86400_000; fail = false;
  expect((await service.reconcile('hq')).queued).toBe(0); expect(queue).toHaveBeenCalledTimes(1);
});
test('concurrent wakeups and identical content do not create duplicate work', async () => {
  report('first'); report('duplicate'); const state = readSignals(root, 'hq'); state.requests[1]!.outputHash = state.requests[0]!.outputHash; writeSignals(root, state);
  const results = await Promise.all([service.reconcile('hq'), service.reconcile('hq')]);
  expect(results.reduce((sum, item) => sum + item.queued, 0)).toBe(1); expect(queue).toHaveBeenCalledTimes(1);
});

test('retry revalidates every included entry, not merely one still-fresh entry', async () => {
  report('mixed'); const first = entries.get('mixed')![0]!;
  entries.get('mixed')!.push({ ...first, reference: { ...first.reference, entryId: 'old' }, sources: [{ ...first.sources[0]!, sourcePublishedAt: new Date(now - 59 * 86400_000).toISOString() }] });
  fail = true; await expect(service.reconcile('hq')).rejects.toThrow();
  now += 2 * 86400_000; fail = false;
  expect((await service.reconcile('hq')).queued).toBe(0); expect(queue).toHaveBeenCalledTimes(1);
});


test('pause racing admission is rechecked before any tracked order is written', async () => {
  report('new');
  beforeAdmit = () => {
    const path = resolveAutomationsConfigPath(root); const config = JSON.parse(readFileSync(path, 'utf8'));
    config.automations.SchedulerTick[0].enabled = false; writeFileSync(path, JSON.stringify(config));
  };
  expect((await service.reconcile('hq')).queued).toBe(0); expect(orders).toHaveLength(0);
});
test('modified native action fails explicitly and generic workspaces pass through', async () => {
  report('new');
  const path = resolveAutomationsConfigPath(root); const config = JSON.parse(readFileSync(path, 'utf8'));
  config.automations.SchedulerTick[0].actions[0].execution.brief = 'Create something'; writeFileSync(path, JSON.stringify(config));
  await expect(service.reconcile('hq')).rejects.toThrow('original safe review action');
  expect(queue).not.toHaveBeenCalled();
  expect(await service.queueScheduled('generic', { matcherId: 'b17de1' } as never)).toEqual({ handled: false, orderIds: [] });
});

test('unchanged safe action with reordered JSON keys still permits schedule edits', async () => {
  report('new'); const path = resolveAutomationsConfigPath(root); const config = JSON.parse(readFileSync(path, 'utf8'));
  const control = config.automations.SchedulerTick[0];
  control.actions[0] = Object.fromEntries(Object.entries(control.actions[0]).reverse()); control.cron = '0 8 * * *';
  writeFileSync(path, JSON.stringify(config));
  expect((await service.reconcile('hq')).queued).toBe(1);
});

test('deleting the seeded control remains respected on restart', async () => {
  const path = resolveAutomationsConfigPath(root); const config = JSON.parse(readFileSync(path, 'utf8'));
  config.automations.SchedulerTick = []; writeFileSync(path, JSON.stringify(config));
  const restarted = new BuilderIntelReviewService({ workspaces: () => [workspace], permission: () => {}, withAutomationLock: async (_path, fn) => fn() });
  await restarted.ensureControl('hq');
  expect(JSON.parse(readFileSync(path, 'utf8')).automations.SchedulerTick).toEqual([]);
  expect(readSignals(root, 'hq').builderReviewControlInitialized).toBe(true);
});
