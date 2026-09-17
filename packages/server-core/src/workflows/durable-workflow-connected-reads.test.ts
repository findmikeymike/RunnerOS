import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { DurableJournal } from '../../../shared/src/durable-execution';
import { loadSource } from '../../../shared/src/sources/storage';
import { DurableReadRunner, type DurableReadRunnerOptions } from './durable-read-runner';
import { createDurableConnectedReadBindingResolver } from './durable-connected-read-binding';

const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });
const connections = [
  { provider: 'spotify', baseUrl: 'https://api.spotify.com/v1/', url: 'https://api.spotify.com/v1/artists/0123456789ABCDEFGHIJKL' },
  { provider: 'github', baseUrl: 'https://api.github.com/repos/', url: 'https://api.github.com/repos/artist-os/demo' },
  { provider: 'custom-analytics', baseUrl: 'https://analytics.example.com/v2/', url: 'https://analytics.example.com/v2/reports/latest' },
];
function fixture(connection = connections[0]!) {
  const root = mkdtempSync(join(tmpdir(), 'normal-connected-unit-'));
  const configRoot = join(root, 'config'), directory = join(root, 'sources/account');
  mkdirSync(directory, { recursive: true });
  const previous = process.env.CRAFT_CONFIG_DIR; process.env.CRAFT_CONFIG_DIR = configRoot;
  cleanups.push(() => { if (previous === undefined) delete process.env.CRAFT_CONFIG_DIR; else process.env.CRAFT_CONFIG_DIR = previous; rmSync(root, { recursive: true, force: true }); });
  writeFileSync(join(directory, 'config.json'), JSON.stringify({ id: 'account', slug: 'account', name: 'Account', provider: connection.provider, type: 'api', enabled: true, isAuthenticated: true, api: { baseUrl: connection.baseUrl, authType: 'bearer' } }));
  const workspace = { id: 'workspace', name: 'Fixture', slug: 'fixture', rootPath: root, createdAt: 1 };
  let token = 'synthetic-account-secret', reads = 0;
  const bindingResolver = createDurableConnectedReadBindingResolver({ getWorkspaces: () => [workspace], loadSource, loadCredential: async () => ({ value: token }), now: Date.now });
  const journal = new DurableJournal({ configRoot, key: randomBytes(32) }); cleanups.push(() => journal.close());
  const options: DurableReadRunnerOptions = { journal, hostRuntime: { appRootPath: root, isPackaged: false }, authorizeRun: () => {},
    resolveBinding: () => ({ workspace, credentialIdentity: 'a'.repeat(64), context: { provider: 'pi', resolvedModel: 'fixture', authType: 'api_key', capabilities: { needsHttpPoolServer: false }, connection: { slug: 'fixture', name: 'Fixture', providerType: 'pi', authType: 'api_key', piAuthProvider: 'openai', createdAt: 1 } } }),
    connectedReads: { bindingResolver, transport: async (_binding, _url, allowed) => { if (!allowed()) return { ok: false, reason: 'not-authorized' }; reads++; return { ok: true, data: { name: 'Saved Artist' } }; } },
  };
  const input = { runId: randomUUID(), commandId: 'start', workspaceId: workspace.id, connectionSlug: 'fixture', model: 'fixture', resolvedAgentSlug: 'reader', systemPrompt: 'Summarize observations.', allowedTools: ['read'] as Array<'read'>, maxOutputTokens: 128, maxModelAttempts: 3, deadlineAt: Date.now() + 60000, approvalPrincipalId: 'principal', costPolicy: { unit: 'model-requests' as const, maxTotalUnits: 3, maxUnitsPerAttempt: 1 } };
  const workflow = { slug: 'connected', source: 'global' as const, path: root, body: '', metadata: { execution: 'durable-local-read' as const, name: 'Artist read', description: '', trigger: { type: 'manual' as const }, outputs: { mode: 'none' as const }, connectedReads: [{ sourceSlug: 'account', url: connection.url }], steps: [{ id: 'read', agent: 'reader', input: 'Summarize this artist.' }] } };
  return { root, directory, journal, options, input, workflow, getReads: () => reads, rotate: () => { token = 'replacement-secret'; } };
}

test.each(connections)('normal runner supports $provider account reads without provider code or new approvals', async connection => {
  const f = fixture(connection); let prompt = '';
  const runner = new DurableReadRunner({ ...f.options, createBackend: args => ({ async *chat(value) {
    prompt = value; const bridge = args.coreConfig.durableExecution!;
    await bridge.checkpoint({ kind: 'model-start', turn: 0, context: { prompt: value } });
    await bridge.checkpoint({ kind: 'model-result', turn: 0, message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'done' }] } });
    await bridge.checkpoint({ kind: 'complete' });
  }, async abort() {}, destroy() {} }) });
  const state = await (await runner.admitWorkflow(f.workflow, f.input)).execution;
  expect(state.status).toBe('succeeded'); expect(f.getReads()).toBe(1);
  expect(prompt).toContain('Saved Artist'); expect(prompt).toContain('untrusted'); expect(prompt).not.toContain('synthetic-account-secret');
  expect(state.approvals ?? []).toHaveLength(0); expect(state.spec.allowedTools).toEqual(['read']);
  expect(state.spec.readOperationBudget).toEqual({ maxOperations: 1, maxAttempts: 2 });
  expect(state.modelAttempts).toBe(1); expect(state.operations?.[0]?.status).toBe('succeeded');
});

test('account revocation between model calls pauses before another model starts', async () => {
  const f = fixture(); let nextModel = false;
  const runner = new DurableReadRunner({ ...f.options, createBackend: args => ({ async *chat(value) {
    const bridge = args.coreConfig.durableExecution!;
    await bridge.checkpoint({ kind: 'model-start', turn: 0, context: { prompt: value } });
    await bridge.checkpoint({ kind: 'model-result', turn: 0, message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'first' }] } });
    f.rotate();
    await bridge.checkpoint({ kind: 'model-start', turn: 1, context: { prompt: value } });
    nextModel = true;
  }, async abort() {}, destroy() {} }) });
  const state = await (await runner.admitWorkflow(f.workflow, f.input)).execution;
  expect(state.status).toBe('paused'); expect(nextModel).toBe(false); expect(f.getReads()).toBe(1); expect(state.approvals ?? []).toHaveLength(0);
});

test.each(['{broken', '{"allowedApiEndpoints":42}'])('malformed source policy rejects before admission or account dispatch: %s', async raw => {
  const f = fixture(); writeFileSync(join(f.directory, 'permissions.json'), raw);
  const runner = new DurableReadRunner(f.options);
  await expect(runner.admitWorkflow(f.workflow, f.input)).rejects.toThrow();
  expect(f.getReads()).toBe(0); expect(f.journal.listInternal('workspace')).toHaveLength(0);
});

test('an HTTP error stays an honest error observation, not a fabricated successful account read', async () => {
  const f = fixture(); let prompt = '';
  f.options.connectedReads!.transport = async () => ({ ok: false, reason: 'http', status: 403 });
  const runner = new DurableReadRunner({ ...f.options, createBackend: args => ({ async *chat(value) {
    prompt = value; const bridge = args.coreConfig.durableExecution!;
    await bridge.checkpoint({ kind: 'model-start', turn: 0, context: { prompt: value } });
    await bridge.checkpoint({ kind: 'model-result', turn: 0, message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'Account read was denied.' }] } });
    await bridge.checkpoint({ kind: 'complete' });
  }, async abort() {}, destroy() {} }) });
  expect((await (await runner.admitWorkflow(f.workflow, f.input)).execution).status).toBe('succeeded');
  expect(prompt).toContain('"ok":false'); expect(prompt).toContain('403');
});

test('revocation while resolving output workspace blocks publication of account-derived content', async () => {
  const f = fixture(); let publications = 0;
  const runner = new DurableReadRunner({ ...f.options,
    authorizePublication: () => {}, resolvePublicationWorkspace: async () => { f.rotate(); return { id: 'workspace', rootPath: f.root }; },
    publishOutput: () => { publications++; throw new Error('revoked-account-must-not-publish'); },
    createBackend: args => ({ async *chat(value) {
      const bridge = args.coreConfig.durableExecution!;
      await bridge.checkpoint({ kind: 'model-start', turn: 0, context: { prompt: value } });
      await bridge.checkpoint({ kind: 'model-result', turn: 0, message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'Account-derived report.' }] } });
      await bridge.checkpoint({ kind: 'complete' });
    }, async abort() {}, destroy() {} }),
  });
  const workflow = { ...f.workflow, metadata: { ...f.workflow.metadata, outputs: { mode: 'final-step' as const, kind: 'report' as const } } };
  const state = await (await runner.admitWorkflow(workflow, f.input)).execution;
  expect(publications).toBe(0); expect(state.status).toBe('paused'); expect(state.publication?.status).toBe('pending');
});


test.each([
  'https://unrelated.example.com/v1/artists/0123456789ABCDEFGHIJKL',
  'https://api.spotify.com/v2/artists/0123456789ABCDEFGHIJKL',
])('source binding rejects a declared URL outside its origin or base path before any read: %s', async url => {
  const f = fixture(); f.workflow.metadata.connectedReads[0]!.url = url;
  const runner = new DurableReadRunner(f.options);
  await expect(runner.admitWorkflow(f.workflow, f.input)).rejects.toThrow('durable-connected-read-binding-unavailable');
  expect(f.getReads()).toBe(0);
  expect(f.journal.listInternal('workspace')).toHaveLength(0);
});
