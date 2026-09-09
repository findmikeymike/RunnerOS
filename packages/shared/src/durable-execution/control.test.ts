import { afterEach, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DurableJournal, digest, type DurableRunSpec } from './index.ts';
import { DURABLE_RUNTIME_MANIFEST, type DurableControlCommand } from '../protocol/durable-execution.ts';

const cleanup: Array<() => void> = [];
afterEach(() => { for (const run of cleanup.splice(0).reverse()) run(); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'artist-control-'));
  const key = randomBytes(32);
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const open = () => { const journal = new DurableJournal({ configRoot: root, key }); return journal; };
  const journal = open(); cleanup.push(() => journal.close());
  const spec: DurableRunSpec = { engine: 'sqlite-v2-readonly-1', credentialIdentity: 'a'.repeat(64), runtimeManifest: { ...DURABLE_RUNTIME_MANIFEST }, runId: 'run', commandId: 'admit', workspaceId: 'workspace', model: 'test', createdAt: Date.now(), allowedTools: ['read'], maxOutputTokens: 100, maxModelAttempts: 3, costPolicy: { unit: 'verified-free', maxUnitsPerAttempt: 0, maxTotalUnits: 0 }, context: {}, authority: {}, deadlineAt: Date.now() + 60000 };
  journal.admit(spec);
  const command = (action: DurableControlCommand['action'], id: string = action) => journal.command({ runId: spec.runId, workspaceId: spec.workspaceId, commandId: id, action, expectedVersion: journal.get('run', 'workspace').version });
  return { journal, spec, command, open };
}
const context = { messages: [] };
const model = { role: 'assistant', content: [{ type: 'toolCall', id: 'read', name: 'read', arguments: { path: 'x' } }], stopReason: 'toolUse' };
const final = { role: 'assistant', content: [{ type: 'text', text: 'done' }], stopReason: 'stop' };

test('pause survives reopen and cached model resumes under a fresh control revision', async () => {
  const { journal, command, open } = fixture();
  const claim = journal.claim('run', 'workspace'), bridge = journal.bridge(claim);
  await bridge.checkpoint({ kind: 'model-start', turn: 0, context });
  await bridge.checkpoint({ kind: 'model-result', turn: 0, message: model });
  const receipt = command('pause');
  await expect(bridge.checkpoint({ kind: 'tool-start', turn: 0, callId: 'read', tool: 'read', input: { path: 'x' } })).rejects.toThrow('paused');
  journal.release(claim);
  const reopened = open();
  try {
    expect(reopened.get('run', 'workspace').status).toBe('paused');
    expect(() => reopened.claim('run', 'workspace')).toThrow('paused');
    reopened.command({ runId: 'run', workspaceId: 'workspace', commandId: 'resume', expectedVersion: receipt.version, action: 'resume' });
    const next = reopened.claim('run', 'workspace');
    expect(next.controlRevision).toBe(2);
    expect((await reopened.bridge(next).checkpoint({ kind: 'model-start', turn: 0, context })).cached).toEqual(model);
    reopened.release(next);
  } finally { reopened.close(); }
});

test('duplicate resume returns its old receipt without reversing a later pause', () => {
  const { journal, command } = fixture();
  command('pause');
  const input: DurableControlCommand = { runId: 'run', workspaceId: 'workspace', commandId: 'resume', expectedVersion: journal.get('run', 'workspace').version, action: 'resume' };
  const receipt = journal.command(input);
  command('pause', 'pause-again');
  expect(journal.command(input)).toEqual(receipt);
  expect(journal.get('run', 'workspace').status).toBe('paused');
  expect(() => journal.command({ ...input, commandId: 'fresh-resume' })).toThrow('version-conflict');
  expect(() => journal.command({ ...input, action: 'cancel' })).toThrow('command-conflict');
});

test('rapid pause/resume fences the old owner without converting new intent into failure', async () => {
  const { journal, command } = fixture();
  const claim = journal.claim('run', 'workspace'), bridge = journal.bridge(claim);
  await bridge.checkpoint({ kind: 'model-start', turn: 0, context });
  command('pause'); command('resume');
  await bridge.checkpoint({ kind: 'model-result', turn: 0, message: model });
  await expect(bridge.checkpoint({ kind: 'tool-start', turn: 0, callId: 'read', tool: 'read', input: {} })).rejects.toThrow('control-changed');
  await bridge.fail('late old owner error');
  await expect(bridge.cancel()).rejects.toThrow('control-changed');
  expect(journal.get('run', 'workspace').status).toBe('running');
  expect(() => journal.claim('run', 'workspace')).toThrow('owned');
  journal.release(claim);
});

test('a dispatched result is retained after cancel without allowing its successor', async () => {
  const { journal, command } = fixture();
  const claim = journal.claim('run', 'workspace'), bridge = journal.bridge(claim);
  await bridge.checkpoint({ kind: 'model-start', turn: 0, context });
  await bridge.checkpoint({ kind: 'model-result', turn: 0, message: model });
  await bridge.checkpoint({ kind: 'tool-start', turn: 0, callId: 'read', tool: 'read', input: { path: 'x' } });
  command('cancel');
  await bridge.checkpoint({ kind: 'tool-result', turn: 0, callId: 'read', result: { content: 'late saved result' } });
  await bridge.cancel(); await bridge.fail('late error');
  expect(journal.get('run', 'workspace').turns[0]!.calls[0]!.result).toEqual({ content: 'late saved result' });
  expect(journal.get('run', 'workspace').status).toBe('cancelled');
  await expect(bridge.checkpoint({ kind: 'model-start', turn: 1, context })).rejects.toThrow('blocked');
  expect(() => command('resume')).toThrow('terminal');
  journal.release(claim);
});

test('paused final model result cannot mark success until an explicit resume', async () => {
  const { journal, command } = fixture();
  const claim = journal.claim('run', 'workspace'), bridge = journal.bridge(claim);
  await bridge.checkpoint({ kind: 'model-start', turn: 0, context }); command('pause');
  await bridge.checkpoint({ kind: 'model-result', turn: 0, message: final });
  await expect(bridge.checkpoint({ kind: 'complete' })).rejects.toThrow('paused');
  expect(journal.get('run', 'workspace').status).toBe('paused'); journal.release(claim);
  command('resume');
  const next = journal.claim('run', 'workspace');
  await journal.bridge(next).checkpoint({ kind: 'complete' });
  expect(journal.get('run', 'workspace').status).toBe('succeeded'); journal.release(next);
});

test('command receipt and transition roll back together if receipt persistence fails', () => {
  const { journal, command } = fixture();
  const db = (journal as any).db;
  db.exec("CREATE TRIGGER reject_control BEFORE INSERT ON control_commands BEGIN SELECT RAISE(ABORT, 'injected receipt failure'); END;");
  expect(() => command('pause')).toThrow('injected receipt failure');
  expect(journal.get('run', 'workspace').status).toBe('running');
  expect(journal.events('run', 'workspace').map(event => event.kind)).toEqual(['admitted']);
  expect(db.prepare('SELECT count(*) count FROM control_commands').get().count).toBe(0);
});

test('workspace isolation and expiry apply to new resume commands', () => {
  const { journal, command } = fixture(); command('pause');
  expect(() => journal.command({ runId: 'run', workspaceId: 'other', commandId: 'pause', expectedVersion: 1, action: 'pause' })).toThrow('not-found');
  const original = Date.now;
  try { Date.now = () => original() + 120000; expect(() => command('resume')).toThrow('blocked'); }
  finally { Date.now = original; }
  expect(journal.get('run', 'workspace').status).toBe('paused');
});

test('schema-one history remains readable but its older adapter cannot dispatch or resume', async () => {
  const { journal, open } = fixture();
  // Reconstruct the previous committed layout in disposable storage: no command table/control revision.
  const legacy = journal.get('run', 'workspace') as any;
  delete legacy.controlRevision;
  legacy.spec.runtimeManifest.adapterRevision = 'pi-readonly-1';
  const db = (journal as any).db;
  db.prepare('UPDATE runs SET payload=?,spec_digest=? WHERE id=?').run((journal as any).encrypt(legacy, 'run'), digest(legacy.spec), 'run');
  db.exec('DROP TABLE control_commands; PRAGMA user_version=1');
  const upgraded = open();
  try {
    expect((upgraded as any).db.prepare('PRAGMA user_version').get().user_version).toBe(2);
    expect(upgraded.get('run', 'workspace').controlRevision).toBe(0);
    const claim = upgraded.claim('run', 'workspace');
    await expect(upgraded.bridge(claim).checkpoint({ kind: 'model-start', turn: 0, context })).rejects.toThrow('manifest-changed');
    upgraded.release(claim);
    const paused = upgraded.command({ runId: 'run', workspaceId: 'workspace', commandId: 'pause', action: 'pause', expectedVersion: 1 });
    expect(() => upgraded.command({ runId: 'run', workspaceId: 'workspace', commandId: 'resume', action: 'resume', expectedVersion: paused.version })).toThrow('manifest-changed');
    expect(upgraded.get('run', 'workspace').status).toBe('paused');
  } finally { upgraded.close(); }
});
