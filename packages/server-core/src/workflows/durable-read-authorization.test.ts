import * as policy from '../../../shared/src/agent/mode-manager.ts';
import { afterEach, expect, spyOn, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { createDurableReadAuthorization, readDurablePolicyRevision } from './durable-read-authorization.ts';
import { DurableReadRunner, type DurableReadBinding, type DurableReadInput, type DurableReadRunnerOptions } from './durable-read-runner.ts';
import { DurableJournal } from '../../../shared/src/durable-execution/index.ts';
import { getWorkspacePermissionsPath, permissionsConfigCache } from '../../../shared/src/agent/permissions-config.ts';
const cleanup: Array<() => void> = [];
afterEach(() => { for (const fn of cleanup.splice(0).reverse()) fn(); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'durable-read-authorization-'));
  const configRoot = join(root, 'config'), workspaceRoot = join(root, 'workspace');
  mkdirSync(join(configRoot, 'permissions'), { recursive: true }); mkdirSync(workspaceRoot);
  const before = process.env.CRAFT_CONFIG_DIR; process.env.CRAFT_CONFIG_DIR = configRoot;
  cleanup.push(() => { if (before === undefined) delete process.env.CRAFT_CONFIG_DIR; else process.env.CRAFT_CONFIG_DIR = before; permissionsConfigCache.invalidateDefaults(); permissionsConfigCache.invalidateWorkspace(workspaceRoot); rmSync(root, { recursive: true, force: true }); });
  const binding: DurableReadBinding = { credentialIdentity: 'a'.repeat(64), workspace: { id: 'workspace', name: 'fixture', slug: 'fixture', rootPath: workspaceRoot, createdAt: 1 }, context: { provider: 'pi', resolvedModel: 'model', authType: 'api_key', capabilities: { needsHttpPoolServer: false }, connection: { slug: 'fixture', name: 'fixture', providerType: 'pi', authType: 'api_key', piAuthProvider: 'openai', createdAt: 1 } } };
  const context = { runId: 'run', workspaceId: 'workspace', approvalPrincipalId: 'alice', connectionSlug: 'fixture', model: 'model', credentialIdentity: binding.credentialIdentity, deadlineAt: Date.now() + 60000 };
  const request = { kind: 'tool-start' as const, turn: 0, callId: 'read', tool: 'read' as const, input: { path: join(workspaceRoot, 'notes.txt') } };
  const defaults = join(configRoot, 'permissions/default.json'), policy = getWorkspacePermissionsPath(workspaceRoot);
  return { root, configRoot, workspaceRoot, binding, context, request, defaults, policy };
}
test('actual policy source changes alter approval revision, invalid JSON/schema fail closed', async () => {
  const f = fixture();
  const initial = readDurablePolicyRevision(f.configRoot, f.workspaceRoot);
  writeFileSync(f.defaults, JSON.stringify({ allowedBashPatterns: ['^ls$'] }));
  const defaults = readDurablePolicyRevision(f.configRoot, f.workspaceRoot); expect(defaults).not.toBe(initial);
  writeFileSync(f.policy, JSON.stringify({ allowedWritePaths: ['scratch/**'] }));
  expect(readDurablePolicyRevision(f.configRoot, f.workspaceRoot)).not.toBe(defaults);
  for (const invalid of ['{broken', JSON.stringify({ allowedBashPatterns: 12 })]) {
    writeFileSync(f.policy, invalid);
    expect(() => readDurablePolicyRevision(f.configRoot, f.workspaceRoot)).toThrow('permission-policy-invalid');
  }
});
test('authorization rechecks principal after async binding and rejects changed account/workspace', async () => {
  const f = fixture(); let allowed = true, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const authorize = createDurableReadAuthorization({ configRoot: f.configRoot, assertRunPrincipal: () => { if (!allowed) throw new Error('principal-revoked'); }, resolveBinding: async () => { await gate; return f.binding; } });
  const pending = authorize(f.request, f.context); allowed = false; release();
  await expect(pending).rejects.toThrow('principal-revoked');
  for (const binding of [{ ...f.binding, credentialIdentity: 'b'.repeat(64) }, { ...f.binding, workspace: { ...f.binding.workspace, id: 'other' } }]) {
    const changed = createDurableReadAuthorization({ configRoot: f.configRoot, assertRunPrincipal() {}, resolveBinding: () => binding });
    await expect(changed(f.request, f.context)).rejects.toThrow('binding-changed');
  }
});
test('deadline and sensitive path deny reads; allowed read needs no additional approval', async () => {
  const f = fixture();
  const authorize = createDurableReadAuthorization({ configRoot: f.configRoot, resolveBinding: () => f.binding, assertRunPrincipal() {}, now: () => 1000 });
  expect((await authorize(f.request, { ...f.context, deadlineAt: 1000 })).allowed).toBe(false);
  expect((await authorize({ ...f.request, input: { path: join(f.workspaceRoot, '.env') } }, f.context)).allowed).toBe(false);
  const normal = await authorize(f.request, { ...f.context, deadlineAt: 2000 });
  expect(normal.allowed).toBe(true); expect(normal.requiresApproval).toBe(false); expect(normal.approvalExpiresAt).toBe(2000);
  for (const tool of ['grep', 'find', 'ls']) {
    const result = await authorize({ ...f.request, tool, input: { path: f.workspaceRoot, pattern: 'notes' } }, { ...f.context, deadlineAt: 2000 });
    expect(result.allowed).toBe(true); expect(result.requiresApproval).toBe(false);
  }
  const unknown = await authorize({ ...f.request, tool: 'bash' }, f.context);
  expect(unknown.allowed).toBe(false);
});
for (const block of ['none', 'policy', 'credential', 'sensitive-path'] as const) test(`real runner reads without approvals while ${block} authorization fences hold`, async () => {
  const f = fixture(); if (block === 'sensitive-path') f.request.input.path = join(f.workspaceRoot, '.env');
  writeFileSync(f.request.input.path, 'policy-allowed native read');
  const journal = new DurableJournal({ configRoot: f.configRoot, key: randomBytes(32) }); cleanup.push(() => journal.close());
  const input: DurableReadInput = { runId: randomUUID(), commandId: 'admit', workspaceId: 'workspace', connectionSlug: 'fixture', model: 'model', prompt: 'Read notes', systemPrompt: 'Read only', allowedTools: ['read'], maxOutputTokens: 100, maxModelAttempts: 4, deadlineAt: f.context.deadlineAt, approvalPrincipalId: 'alice', costPolicy: { unit: 'verified-free', maxTotalUnits: 0, maxUnitsPerAttempt: 0 } };
  let nativeReads = 0, mutateAfterAuthorization = block === 'policy' || block === 'credential', authorizationReturned = false;
  const options: DurableReadRunnerOptions = { journal, hostRuntime: { appRootPath: f.root, isPackaged: false }, readPolicyRevision: root => readDurablePolicyRevision(f.configRoot, root), resolveBinding: async () => {
      if (mutateAfterAuthorization && authorizationReturned) {
        mutateAfterAuthorization = false;
        if (block === 'credential') f.binding.credentialIdentity = 'b'.repeat(64);
        else writeFileSync(f.policy, JSON.stringify({ allowedWritePaths: ['changed-during-final-binding/**'] }));
      }
      return f.binding;
    },
    authorizeTool: createDurableReadAuthorization({ configRoot: f.configRoot, resolveBinding: () => f.binding, assertRunPrincipal: (_workspace, principal) => { expect(principal).toBe('alice'); } }),
    createBackend: args => ({ async *chat() {
      const bridge = args.coreConfig.durableExecution!;
      const model = await bridge.checkpoint({ kind: 'model-start', turn: 0, context: {} });
      if (!model.cached) await bridge.checkpoint({ kind: 'model-result', turn: 0, message: { role: 'assistant', stopReason: 'toolUse', content: [{ type: 'toolCall', id: 'read', name: 'read', arguments: f.request.input }] } });
      const tool = await bridge.checkpoint(f.request);
      if (!tool.cached) { nativeReads++; const text = readFileSync(f.request.input.path, 'utf8'); await bridge.checkpoint({ kind: 'tool-result', turn: 0, callId: 'read', result: { content: [{ type: 'text', text }] } }); }
      const final = await bridge.checkpoint({ kind: 'model-start', turn: 1, context: { complete: true } });
      if (!final.cached) await bridge.checkpoint({ kind: 'model-result', turn: 1, message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'done' }] } });
      await bridge.checkpoint({ kind: 'complete' });
    }, async abort() {}, destroy() {} }),
  };
  const authorize = options.authorizeTool!;
  options.authorizeTool = async (...args) => { const result = await authorize(...args); authorizationReturned = true; return result; };
  const runner = new DurableReadRunner(options);
  const first = await runner.start(input);
  expect(first.approvals).toEqual([]);
  if (block === 'none') { expect(first.status).toBe('succeeded'); expect(nativeReads).toBe(1); }
  else {
    expect(first.status).toBe('paused'); expect(nativeReads).toBe(0);
    expect(first.turns[0]!.calls[0]!.attempts).toBe(0);
    if (block === 'sensitive-path') { await runner.quiesce(); return; }
    f.binding.credentialIdentity = 'a'.repeat(64);
    const resumed = await runner.control({ runId: input.runId, workspaceId: input.workspaceId, commandId: randomUUID(), expectedVersion: journal.get(input.runId, input.workspaceId).version, action: 'resume' });
    const recovered = await resumed.execution!;
    expect(recovered!.status).toBe('succeeded'); expect(recovered!.approvals).toEqual([]); expect(nativeReads).toBe(1);
  }
  expect((await runner.start(input)).status).toBe('succeeded'); expect(nativeReads).toBe(1);
  await runner.quiesce();
});

test('policy revision refuses a different defaults source than the actual policy evaluator', async () => {
  const f = fixture();
  process.env.CRAFT_CONFIG_DIR = join(f.root, 'different-defaults');
  expect(() => readDurablePolicyRevision(f.configRoot, f.workspaceRoot)).toThrow('policy-source-mismatch');
  const authorize = createDurableReadAuthorization({ configRoot: f.configRoot, resolveBinding: () => f.binding, assertRunPrincipal() {} });
  await expect(authorize(f.request, f.context)).rejects.toThrow('policy-source-mismatch');
});

test('certified web reads use current owner and policy without extra approval', async () => {
  const f = fixture(); let current = true;
  const authorize = createDurableReadAuthorization({ configRoot: f.configRoot, resolveBinding: () => f.binding, assertRunPrincipal() { if (!current) throw new Error('principal-revoked'); }, now: () => 1000 });
  const request = { ...f.request, tool: 'web_fetch', input: { url: 'https://example.com/article' } };
  const approval = await authorize(request, { ...f.context, deadlineAt: 2000, webReadUrls: ['https://example.com/article'] });
  expect(approval.allowed).toBe(true); expect(approval.requiresApproval).toBe(false); expect(approval.approvalExpiresAt).toBe(2000);
  current = false; await expect(authorize(request, f.context)).rejects.toThrow('principal-revoked');
});

test('redirect authorization checks every pinned destination against current policy', async () => {
  const f = fixture(), first = 'https://example.com/article', destination = 'https://example.com/moved';
  const checked: unknown[] = [], original = policy.shouldAllowToolInMode;
  const spy = spyOn(policy, 'shouldAllowToolInMode').mockImplementation((tool, input, mode, options) => {
    checked.push(input); if (tool === 'WebFetch' && (input as { url?: string }).url === destination) return { allowed: false, reason: 'current-policy-denial' };
    return original(tool, input, mode, options);
  }); cleanup.push(() => spy.mockRestore());
  const authorize = createDurableReadAuthorization({ configRoot: f.configRoot, resolveBinding: () => f.binding, assertRunPrincipal() {} });
  const request = { ...f.request, tool: 'web_fetch', input: { url: first } }, context = { ...f.context, webReadUrls: [first, destination] };
  expect((await authorize(request, context)).allowed).toBe(true);
  expect((await authorize(request, { ...context, webReadRedirects: false })).allowed).toBe(true);
  checked.length = 0;
  expect((await authorize(request, { ...context, webReadRedirects: true })).allowed).toBe(false);
  expect(checked).toEqual([{ url: first }, { url: destination }]);
  expect((await authorize(request, { ...f.context, webReadRedirects: true })).allowed).toBe(false);
});

test('runner rechecks redirect destination policy after asynchronous authorization before dispatch', async () => {
  const f = fixture(), url = 'https://example.com/article', destination = 'https://example.com/moved';
  const journal = new DurableJournal({ configRoot: f.configRoot, key: randomBytes(32) }); cleanup.push(() => journal.close());
  let denyDestination = false, dispatches = 0;
  const original = policy.shouldAllowToolInMode;
  const spy = spyOn(policy, 'shouldAllowToolInMode').mockImplementation((tool, input, mode, options) => denyDestination && tool === 'WebFetch' && (input as { url?: string }).url === destination ? { allowed: false, reason: 'revoked-target' } : original(tool, input, mode, options));
  cleanup.push(() => spy.mockRestore());
  const runner = new DurableReadRunner({ journal, hostRuntime: { appRootPath: f.root, isPackaged: false }, resolveBinding: () => f.binding,
    authorizeTool: async (_request, context) => {
      expect(context.webReadRedirects).toBe(true); expect(context.webReadUrls).toEqual([url, destination]); expect(Object.isFrozen(context.webReadUrls)).toBe(true);
      denyDestination = true;
      return { principalId: 'alice', credentialIdentity: f.binding.credentialIdentity, policyRevision: 'p', allowed: true, requiresApproval: false, approvalExpiresAt: f.context.deadlineAt };
    },
    createBackend: args => ({ async *chat() { const bridge = args.coreConfig.durableExecution!;
      await bridge.checkpoint({ kind: 'model-start', turn: 0, context: {} });
      await bridge.checkpoint({ kind: 'model-result', turn: 0, message: { role: 'assistant', stopReason: 'toolUse', content: [{ type: 'toolCall', id: 'web', name: 'web_fetch', arguments: { url } }] } });
      await bridge.checkpoint({ kind: 'tool-start', turn: 0, callId: 'web', tool: 'web_fetch', input: { url } }); dispatches++;
    }, async abort() {}, destroy() {} }),
  });
  const input: DurableReadInput = { runId: randomUUID(), commandId: 'admit', workspaceId: 'workspace', connectionSlug: 'fixture', model: 'model', prompt: 'Read', systemPrompt: 'Read only', allowedTools: ['web_fetch'], webReadUrls: [url, destination], webReadRedirects: true, maxOutputTokens: 100, maxModelAttempts: 4, deadlineAt: f.context.deadlineAt, approvalPrincipalId: 'alice', costPolicy: { unit: 'verified-free', maxTotalUnits: 0, maxUnitsPerAttempt: 0 } };
  const workflow = { slug: 'web', source: 'global' as const, path: f.root, body: '', metadata: { execution: 'durable-local-read' as const, name: 'Web', description: '', trigger: { type: 'manual' as const }, outputs: { mode: 'none' as const }, webReadUrls: [url, destination], webReadRedirects: true, steps: [{ id: 'read', agent: 'reader', input: 'Read article' }] } };
  await expect(runner.admitWorkflow(workflow, { ...input, resolvedAgentSlug: 'reader', webReadRedirects: false })).rejects.toThrow('unsupported-durable-read-workflow');
  const saved = await runner.start(input); expect(saved.status).toBe('paused'); expect(dispatches).toBe(0); expect(saved.turns[0]!.calls[0]!.attempts).toBe(0); await runner.quiesce();
});
