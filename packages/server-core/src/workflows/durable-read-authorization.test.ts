import { afterEach, expect, test } from 'bun:test';
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
test('deadline and sensitive path deny reads; normal read requires bounded approval', async () => {
  const f = fixture();
  const authorize = createDurableReadAuthorization({ configRoot: f.configRoot, resolveBinding: () => f.binding, assertRunPrincipal() {}, now: () => 1000 });
  expect((await authorize(f.request, { ...f.context, deadlineAt: 1000 })).allowed).toBe(false);
  expect((await authorize({ ...f.request, input: { path: join(f.workspaceRoot, '.env') } }, f.context)).allowed).toBe(false);
  const normal = await authorize(f.request, { ...f.context, deadlineAt: 2000 });
  expect(normal.allowed).toBe(true); expect(normal.requiresApproval).toBe(true); expect(normal.approvalExpiresAt).toBe(2000);
});
test('real runner and journal execute the exact native read only after current-policy approval', async () => {
  const f = fixture(); writeFileSync(f.request.input.path, 'approved native read');
  const journal = new DurableJournal({ configRoot: f.configRoot, key: randomBytes(32) }); cleanup.push(() => journal.close());
  const input: DurableReadInput = { runId: randomUUID(), commandId: 'admit', workspaceId: 'workspace', connectionSlug: 'fixture', model: 'model', prompt: 'Read notes', systemPrompt: 'Read only', allowedTools: ['read'], maxOutputTokens: 100, maxModelAttempts: 4, deadlineAt: f.context.deadlineAt, approvalPrincipalId: 'alice', costPolicy: { unit: 'verified-free', maxTotalUnits: 0, maxUnitsPerAttempt: 0 } };
  let nativeReads = 0, mutateAfterAuthorization = false, authorizationReturned = false;
  const options: DurableReadRunnerOptions = { journal, hostRuntime: { appRootPath: f.root, isPackaged: false }, readPolicyRevision: root => readDurablePolicyRevision(f.configRoot, root), resolveBinding: async () => {
      if (mutateAfterAuthorization && authorizationReturned) { mutateAfterAuthorization = false; writeFileSync(f.policy, JSON.stringify({ allowedWritePaths: ['changed-during-final-binding/**'] })); }
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
  const waiting = await runner.start(input); expect(waiting.status).toBe('waiting-approval'); expect(nativeReads).toBe(0);
  const approve = () => { const state = journal.get(input.runId, input.workspaceId), a = state.approvals!.at(-1)!; return runner.decide({ runId: input.runId, workspaceId: input.workspaceId, commandId: randomUUID(), expectedVersion: state.version, action: 'approve', approvalId: a.id, inputDigest: a.inputDigest, principalId: a.principalId, policyRevision: a.policyRevision, credentialIdentity: a.credentialIdentity }); };
  writeFileSync(f.policy, JSON.stringify({ allowedWritePaths: ['scratch/**'] }));
  const obsolete = await approve(); expect((await obsolete.execution!)!.status).toBe('waiting-approval'); expect(nativeReads).toBe(0);
  const current = journal.get(input.runId, input.workspaceId); expect(current.approvals!.at(-1)!.input).toEqual(f.request.input);
  authorizationReturned = false; mutateAfterAuthorization = true;
  const raced = await approve(); expect((await raced.execution!)!.status).toBe('paused'); expect(nativeReads).toBe(0);
  const resumed = await runner.control({ runId: input.runId, workspaceId: input.workspaceId, commandId: randomUUID(), expectedVersion: journal.get(input.runId, input.workspaceId).version, action: 'resume' });
  expect((await resumed.execution!)!.status).toBe('waiting-approval'); expect(nativeReads).toBe(0);
  const approved = await approve(); expect((await approved.execution!)!.status).toBe('succeeded'); expect(nativeReads).toBe(1);
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

test('certified web reads use current owner and bounded WebFetch approval', async () => {
  const f = fixture(); let current = true;
  const authorize = createDurableReadAuthorization({ configRoot: f.configRoot, resolveBinding: () => f.binding, assertRunPrincipal() { if (!current) throw new Error('principal-revoked'); }, now: () => 1000 });
  const request = { ...f.request, tool: 'web_fetch', input: { url: 'https://example.com/article' } };
  const approval = await authorize(request, { ...f.context, deadlineAt: 2000 });
  expect(approval.allowed).toBe(true); expect(approval.requiresApproval).toBe(true); expect(approval.approvalExpiresAt).toBe(2000);
  current = false; await expect(authorize(request, f.context)).rejects.toThrow('principal-revoked');
});
