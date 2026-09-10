import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { DurableJournal } from '../../../../shared/src/durable-execution/index.ts';
import { DurableReadRunner, type DurableReadBinding, type DurableReadInput, type DurableReadRunnerOptions } from '../durable-read-runner.ts';
import { resolveDurableLocalSources } from '../durable-workflow-sources.ts';

const cleanup: Array<() => void> = [];
afterEach(() => { for (const fn of cleanup.splice(0).reverse()) fn(); });
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'artist-source-runner-')));
  const folder = join(root, 'sources', 'notes'), content = join(root, 'notes');
  mkdirSync(folder, { recursive: true }); mkdirSync(content);
  const config = { id: 'notes-id', slug: 'notes', name: 'Notes', enabled: true, type: 'local', provider: 'filesystem', local: { path: content, format: 'filesystem' } };
  const save = () => writeFileSync(join(folder, 'config.json'), JSON.stringify(config));
  save(); writeFileSync(join(folder, 'guide.md'), '# Notes\nRead release notes.');
  const journal = new DurableJournal({ configRoot: root, key: randomBytes(32) });
  cleanup.push(() => rmSync(root, { recursive: true, force: true }), () => journal.close());
  const binding: DurableReadBinding = { credentialIdentity: 'a'.repeat(64), workspace: { id: 'workspace', name: 'test', slug: 'test', rootPath: root, createdAt: 1 },
    context: { provider: 'pi', resolvedModel: 'test-model', authType: 'api_key', capabilities: { needsHttpPoolServer: false }, connection: { slug: 'test-local', name: 'test', providerType: 'pi', authType: 'api_key', piAuthProvider: 'openai', createdAt: 1 } } };
  const input: DurableReadInput = { runId: randomUUID(), commandId: randomUUID(), workspaceId: 'workspace', connectionSlug: 'test-local', model: 'test-model',
    prompt: 'Read notes', systemPrompt: 'Read only', allowedTools: ['read'], maxOutputTokens: 128, deadlineAt: Date.now() + 60000, maxModelAttempts: 3,
    localSources: resolveDurableLocalSources(root, ['notes'], ['notes']), approvalPrincipalId: 'principal',
    costPolicy: { unit: 'verified-free', maxTotalUnits: 0, maxUnitsPerAttempt: 0 } };
  const options: DurableReadRunnerOptions = { journal, hostRuntime: { appRootPath: root, isPackaged: false }, resolveBinding: () => binding,
    authorizeRun() {}, authorizeTool: async () => ({ principalId: 'principal', credentialIdentity: binding.credentialIdentity, policyRevision: 'fixture', allowed: true, requiresApproval: false, approvalExpiresAt: input.deadlineAt }) };
  const mutate = (kind: string) => {
    if (kind === 'disabled') { config.enabled = false; save(); }
    else if (kind === 'guide') writeFileSync(join(folder, 'guide.md'), '# Changed instructions');
    else { rmSync(content, { recursive: true }); mkdirSync(join(root, 'replacement')); symlinkSync(join(root, 'replacement'), content); }
  };
  return { root, content, journal, input, options, mutate };
}

for (const change of ['disabled', 'guide', 'symlink']) {
  for (const boundary of ['model', 'tool']) {
    test(`${change} source blocks new ${boundary} dispatch and pauses saved run`, async () => {
      const f = fixture(); let models = 0, tools = 0;
      const runner = new DurableReadRunner({ ...f.options, createBackend: args => ({ async *chat() {
        expect(args.coreConfig.session?.enabledSourceSlugs).toEqual([]);
        const bridge = args.coreConfig.durableExecution!;
        if (boundary === 'model') f.mutate(change);
        await bridge.checkpoint({ kind: 'model-start', turn: 0, context: {} }); models++;
        await bridge.checkpoint({ kind: 'model-result', turn: 0, message: { role: 'assistant', stopReason: 'toolUse', content: [{ type: 'toolCall', id: 'read-notes', name: 'read', arguments: { path: f.content } }] } });
        f.mutate(change);
        await bridge.checkpoint({ kind: 'tool-start', turn: 0, callId: 'read-notes', tool: 'read', input: { path: f.content } }); tools++;
      }, async abort() {}, destroy() {} }) });
      try { await runner.start(f.input); } catch { /* Saved paused status is the durable contract. */ }
      expect(f.journal.get(f.input.runId, f.input.workspaceId).status).toBe('paused');
      expect(models).toBe(boundary === 'model' ? 0 : 1); expect(tools).toBe(0);
    });
  }
}

test('unchanged filesystem source resumes saved result without another model result', async () => {
  const f = fixture(); let models = 0, first = true;
  const runner = new DurableReadRunner({ ...f.options, createBackend: args => ({ async *chat() {
    expect(args.coreConfig.session?.enabledSourceSlugs).toEqual([]);
    const bridge = args.coreConfig.durableExecution!;
    const reply = await bridge.checkpoint({ kind: 'model-start', turn: 0, context: {} });
    if (reply.cached === undefined) {
      models++;
      await bridge.checkpoint({ kind: 'model-result', turn: 0, message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'Saved source result' }] } });
    }
    if (first) {
      first = false;
      const current = f.journal.get(f.input.runId, f.input.workspaceId);
      f.journal.command({ runId: f.input.runId, workspaceId: f.input.workspaceId, commandId: randomUUID(), expectedVersion: current.version, action: 'pause' });
    }
    await bridge.checkpoint({ kind: 'complete' });
  }, async abort() {}, destroy() {} }) });
  expect((await runner.start(f.input)).status).toBe('paused');
  const state = f.journal.get(f.input.runId, f.input.workspaceId);
  const continued = await runner.control({ runId: f.input.runId, workspaceId: f.input.workspaceId, commandId: randomUUID(), expectedVersion: state.version, action: 'resume' });
  expect((await continued.execution!).status).toBe('succeeded'); expect(models).toBe(1);
});

test('source revocation during awaited tool authorization prevents dispatch and pauses', async () => {
  const f = fixture();
  let entered!: () => void, release!: () => void, tools = 0;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const runner = new DurableReadRunner({ ...f.options, authorizeTool: async (...args) => {
    entered(); await gate;
    return f.options.authorizeTool!(...args);
  }, createBackend: args => ({ async *chat() {
    const bridge = args.coreConfig.durableExecution!;
    await bridge.checkpoint({ kind: 'model-start', turn: 0, context: {} });
    await bridge.checkpoint({ kind: 'model-result', turn: 0, message: { role: 'assistant', stopReason: 'toolUse', content: [{ type: 'toolCall', id: 'read-notes', name: 'read', arguments: { path: f.content } }] } });
    await bridge.checkpoint({ kind: 'tool-start', turn: 0, callId: 'read-notes', tool: 'read', input: { path: f.content } }); tools++;
  }, async abort() {}, destroy() {} }) });
  const execution = runner.start(f.input);
  await waiting;
  f.mutate('disabled'); release();
  try { await execution; } catch { /* Verify persisted status, regardless of surfaced authorization error. */ }
  expect(tools).toBe(0);
  expect(f.journal.get(f.input.runId, f.input.workspaceId).status).toBe('paused');
  expect(f.journal.get(f.input.runId, f.input.workspaceId).turns[0]!.calls[0]!.result).toBeUndefined();
});
