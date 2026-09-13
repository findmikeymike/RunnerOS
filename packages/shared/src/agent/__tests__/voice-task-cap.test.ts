import { describe, expect, test, afterAll } from 'bun:test';
import { mkdtempSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPreToolUseChecks, type PreToolUseInput } from '../core/pre-tool-use.ts';
import { assertVoiceTaskBackend, bindImmutableVoiceTaskScope, type VoiceTaskScope } from '../core/voice-task-cap.ts';
import { setPermissionMode } from '../mode-manager.ts';
const root = mkdtempSync(join(tmpdir(), 'voice-cap-'));
const outside = mkdtempSync(join(tmpdir(), 'voice-cap-outside-'));
writeFileSync(join(root, 'draft.txt'), 'draft');
writeFileSync(join(root, '.env'), 'secret');
writeFileSync(join(outside, 'foreign.txt'), 'foreign');
symlinkSync(join(outside, 'foreign.txt'), join(root, 'linked.txt'));
afterAll(() => { rmSync(root, { recursive: true }); rmSync(outside, { recursive: true }); });
const scope: VoiceTaskScope = { schemaVersion: 1, taskId: 'task', attemptId: 'attempt', workspaceId: 'ws' };
const draft = { title: 'Draft', summary: 'Saved draft', kind: 'document', content: 'Draft body', contentMimeType: 'text/markdown' };
function check(toolName: string, input: Record<string, unknown>, mode: 'safe' | 'ask' | 'allow-all' = 'allow-all', extra: Partial<PreToolUseInput> = {}) {
  const sessionId = `voice-cap-${mode}`;
  setPermissionMode(sessionId, mode);
  return runPreToolUseChecks({ toolName, input, sessionId, permissionMode: mode, workspaceRootPath: root, workspaceId: 'ws', voiceTaskScope: scope,
    activeSourceSlugs: [], allSourceSlugs: [], hasSourceActivation: false,
    trustedWorkerTools: [toolName, 'create_output', 'send_agent_message'],
    permissionManager: { isCommandWhitelisted: () => true, isDangerousCommand: () => false, getBaseCommand: x => x, extractDomainFromNetworkCommand: () => 'example.com', isDomainWhitelisted: () => true }, ...extra });
}
describe('immutable voice-origin cap before standing grants', () => {
  for (const mode of ['safe', 'ask', 'allow-all'] as const) {
    test(`blocks sensitive and unknown actions despite ${mode}, trusted and remembered grants`, () => {
      for (const tool of ['Bash', 'Write', 'Edit', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Task', 'mcp__session__send_agent_message', 'mcp__session__media_provider_request', 'mcp__session__promote_output_to_final', 'mcp__evil__create_output', 'create_output', 'unknown']) expect(check(tool, { command: 'cat draft.txt', ...draft }, mode).type).toBe('block');
    });
  }
  test('allows only contained existing visible regular Read files', () => {
    expect(check('Read', { file_path: join(root, 'draft.txt') }).type).toBe('allow');
    for (const path of [join(outside, 'foreign.txt'), join(root, 'linked.txt'), join(root, '.env'), root, 'draft.txt', join(root, 'missing')]) expect(check('Read', { file_path: path }).type).toBe('block');
  });
  test('rejects a host path remap that leaves the allowed workspace', () => {
    expect(check('Read', { file_path: join(root, 'draft.txt') }, 'allow-all', { remapSkillInput: () => ({ file_path: join(outside, 'foreign.txt') }) }).type).toBe('block');
  });
  test('rejects cross-workspace or malformed origin before any permission access', () => {
    const bomb = new Proxy({}, { get() { throw new Error('permission shortcut reached'); } });
    expect(check('Read', { file_path: join(root, 'draft.txt') }, 'allow-all', { workspaceId: 'foreign', permissionManager: bomb as any }).type).toBe('block');
    expect(check('Read', { file_path: join(root, 'draft.txt') }, 'allow-all', { voiceTaskScope: { ...scope, schemaVersion: 2 } as any }).type).toBe('block');
  });
  test('allows inline drafts, rejects imports/approvals/remote side effects and unknown fields', () => {
    expect(check('mcp__session__create_output', draft).type).toBe('allow');
    for (const input of [{ files: [{ path: join(outside, 'foreign.txt') }] }, { links: [] }, { approval: { state: 'approved' } }, { receipts: [] }, { context: { scope: 'campaign', campaignId: 'foreign' } }, { kind: 'external-action' }, { contentMimeType: 'text/html' }, { destination: '/tmp/exfil' }]) expect(check('mcp__session__create_output', { ...draft, ...input }).type).toBe('block');
  });
  test('origin survives caller mutation, reassignment and deletion', () => {
    const original = { ...scope };
    const target: { voiceTaskScope?: VoiceTaskScope } = {};
    bindImmutableVoiceTaskScope(target, original);
    original.workspaceId = 'foreign';
    expect(target.voiceTaskScope?.workspaceId).toBe('ws');
    expect(Reflect.set(target, 'voiceTaskScope', undefined)).toBe(false);
    expect(Reflect.deleteProperty(target, 'voiceTaskScope')).toBe(false);
    expect(Reflect.set(target.voiceTaskScope!, 'workspaceId', 'foreign')).toBe(false);
    expect(() => Object.defineProperty(target, 'voiceTaskScope', { value: undefined })).toThrow();
  });
  test('does not constrain ordinary tasks, rejects unsupported backend switches', () => {
    expect(check('Bash', { command: 'echo ok' }, 'allow-all', { voiceTaskScope: undefined }).type).toBe('allow');
    expect(() => assertVoiceTaskBackend(scope, 'anthropic')).not.toThrow();
    for (const provider of ['pi', 'codex', 'copilot', 'unknown']) expect(() => assertVoiceTaskBackend(scope, provider)).toThrow();
  });
});
