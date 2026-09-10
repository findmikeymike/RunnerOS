import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ScheduledWorkRunner } from '../../../scheduled-work/ScheduledWorkRunner';
import { DurableWorkflowHost } from '../../durable-workflow-host';
import { createDurableWorkflowStart } from '../../durable-workflow-start';
import { WorkflowRunner } from '../../runner';
import { DurableJournal, loadDurableKey } from '../../../../../shared/src/durable-execution';
import { SCHEDULED_WORK_CONTEXT_SLUG, parseScheduledWorkDocResult, scheduledWorkMetadata, serializeScheduledWorkBody, scheduledWorkDefinitionDigest, type ScheduledWorkOrder } from '@craft-agent/shared/scheduled-work';
import { loadContextDoc, upsertContextDoc } from '@craft-agent/shared/workspace-context';

// Supervisor-owned synthetic profile only. No live credentials or provider calls.
const [root, mode] = process.argv.slice(2) as [string, string];
if (readFileSync(join(root, 'synthetic-only'), 'utf8') !== 'scheduled-crash-fixture' || process.env.CRAFT_CONFIG_DIR !== join(root, 'config')) throw new Error('isolated-scheduled-fixture-required');
const workspaceId = 'scheduled-fixture';
const workspace = { id: workspaceId, name: 'Fixture', slug: 'fixture', rootPath: root, createdAt: 1 };
const protection = { isEncryptionAvailable: () => true, encryptString: (value: string) => Buffer.from(value), decryptString: (value: Buffer) => value.toString() };
const workflow = { slug: 'scheduled-read', source: 'global' as const, path: root, body: '', metadata: { execution: 'durable-local-read' as const, name: 'Read', description: '', trigger: { type: 'manual' as const }, outputs: { mode: 'none' as const }, steps: [{ id: 'read', agent: 'reader', input: 'Read notes.' }] } };
const now = new Date();
function readOrder() {
  const parsed = parseScheduledWorkDocResult(loadContextDoc(root, SCHEDULED_WORK_CONTEXT_SLUG) ?? undefined, workspaceId);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.work.items[0]!;
}
if (mode === 'start') {
  const order: ScheduledWorkOrder = { version: 1, id: 'scheduled-order', owner: { scope: 'campaign', workspaceId, campaignId: workspaceId }, calendarLink: { calendar: 'campaign', itemId: 'fixture-calendar' }, title: 'Scheduled read', type: 'workflow-run', status: 'scheduled', startAt: now.toISOString(), timezone: 'UTC',
    execution: { type: 'workflow-run', workflowSlug: workflow.slug, workflowDigest: scheduledWorkDefinitionDigest({ metadata: workflow.metadata, body: workflow.body }), triggerInputs: {} }, inputRefs: [], approvals: [], runs: [], executionKey: { payloadDigest: 'fixture', idempotencyKey: 'fixture' }, createdAt: now.toISOString(), updatedAt: now.toISOString() };
  upsertContextDoc(root, { slug: SCHEDULED_WORK_CONTEXT_SLUG, metadata: scheduledWorkMetadata(), body: serializeScheduledWorkBody({ version: 1, workspaceId, items: [order], updatedAt: now.toISOString() }) });
}
let modelEntered!: () => void;
const modelReady = new Promise<void>(resolve => modelEntered = resolve);
const host = DurableWorkflowHost.open({ configRoot: join(root, 'config'), protection, resolvePrincipal: () => 'fixture-principal', resolveScheduledPrincipal: () => 'fixture-principal', runnerOptions: {
  hostRuntime: { appRootPath: root, isPackaged: false },
  resolveBinding: () => ({ workspace, credentialIdentity: 'a'.repeat(64), context: { provider: 'pi', authType: 'api_key', resolvedModel: 'fixture', capabilities: { needsHttpPoolServer: false }, connection: { slug: 'fixture', name: 'fixture', providerType: 'pi', authType: 'api_key', piAuthProvider: 'openai', createdAt: 1 } } }),
  createBackend: args => ({ async *chat() {
    const checkpoint = await args.coreConfig.durableExecution!.checkpoint({ kind: 'model-start', turn: 0, context: {} });
    if (checkpoint.cached !== undefined) throw new Error('unexpected-cached-result');
    appendFileSync(join(root, 'model-dispatches'), 'dispatch\n'); modelEntered();
    await new Promise<void>(() => {});
  }, async abort() {}, destroy() {} }),
} });
const runner = new WorkflowRunner({ durableStart: createDurableWorkflowStart({ host, getWorkspaceRootPath: () => root, resolveBundle: async () => ({ connectionSlug: 'fixture', model: 'fixture', systemPrompt: 'Read only.' }) }), getWorkspaceRootPath: () => root,
  createSession: async () => { throw new Error('legacy-dispatch-forbidden'); }, sendMessage: async () => {}, getLastAssistantText: () => '', abortSession: async () => {},
});
let starts = 0, recoveries = 0;
const scheduled = new ScheduledWorkRunner({ canRunBackgroundWork: () => true, withLock: async (_root, fn) => fn(), executeAgentTask: async () => { throw new Error('agent-dispatch-forbidden'); }, listOutputManifests: () => [],
  startWorkflow: async input => {
    starts++; appendFileSync(join(root, 'start-dispatches'), 'start\n');
    const order = readOrder();
    if (order.status !== 'running' || order.runs.at(-1)?.id !== input.attemptId || order.runs.at(-1)?.workflowRunId) throw new Error('claim-not-persisted-before-admission');
    const state = await runner.start({ workspaceId, workflow, triggerInputs: {}, invocation: 'scheduled-work', occurrence: { workOrderId: input.workOrderId, attemptId: input.attemptId, workflowSlug: input.workflowSlug, workflowDigest: input.workflowDigest } });
    await modelReady;
    const key = loadDurableKey(join(root, 'config'), protection);
    const journal = new DurableJournal({ configRoot: join(root, 'config'), key }); key.fill(0);
    try {
      console.log(JSON.stringify({ barrier: 'admitted-before-reply', runId: state.id, attemptId: input.attemptId, order: readOrder(), journal: journal.get(state.id, workspaceId) }));
    } finally { journal.close(); }
    // Kill precisely between journal admission and Scheduled Work recording the returned id.
    await new Promise<void>(() => {});
    return { runId: state.id };
  },
  recoverWorkflow: async input => { recoveries++; const state = await host.getScheduledRun(workspaceId, input); return state ? { runId: state.id } : null; },
  readWorkflowRun: async (_root, runId) => host.getRunForScheduler(workspaceId, runId),
});
if (mode === 'start') {
  // Pending promises alone do not keep a child alive while the supervisor selects its barrier.
  setInterval(() => {}, 1000);
  await scheduled.scanWorkspace(workspaceId, root, now);
} else {
  const before = readOrder();
  for (let i = 0; i < 3; i++) await scheduled.scanWorkspace(workspaceId, root, new Date());
  const after = readOrder();
  const key = loadDurableKey(join(root, 'config'), protection);
  const journal = new DurableJournal({ configRoot: join(root, 'config'), key }); key.fill(0);
  try {
    const states = journal.listInternal(workspaceId);
    console.log(JSON.stringify({ result: 'recovered', starts, recoveries, before, after, journalCount: states.length, journal: states[0], projected: await host.getRunForScheduler(workspaceId, after.runs.at(-1)!.workflowRunId!) }));
  } finally { journal.close(); await host.close(); }
}
