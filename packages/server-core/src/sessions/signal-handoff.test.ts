import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getSessionPath, loadSession } from '@craft-agent/shared/sessions';
import { saveWorkspaceConfig } from '@craft-agent/shared/workspaces';
import type { SignalLookupResult } from '@craft-agent/shared/shared-intel';
import { acceptSignalHandoff, readSignalHandoff, readSignalHandoffState, writeSignalHandoff } from '../signals/handoff-store';
import { SessionManager, createManagedSession } from './SessionManager';

let root: string;
let manager: SessionManager;
const reference = { hqWorkspaceId: 'hq', outputId: 'report', contentHash: 'a'.repeat(64), entryId: 'idea-1' };
const resolved = { ok: true, mode: 'reference', entries: [{ reference, kind: 'idea' }] } as SignalLookupResult;
let resolveReference: ReturnType<typeof mock>;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'signal-send-'));
  saveWorkspaceConfig(root, { id: 'campaign', name: 'Campaign', slug: 'campaign', createdAt: 1, updatedAt: 1 });
  manager = new SessionManager();
  manager.setPaidExecutionAuthorizer(() => true);
  resolveReference = mock(async () => resolved);
  // Reader scope/provenance/activation have their own integration tests. Here
  // a controllable reader exercises the real send admission and disk receipt.
  manager.getSignalReader = () => ({ resolveReference }) as never;
  (manager as unknown as { assertSignalHandoffWorker: () => void }).assertSignalHandoffWorker = () => {};
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function draft(id: string) {
  const managed = createManagedSession({ id, name: 'Signals draft' }, { id: 'campaign', name: 'Campaign', rootPath: root, createdAt: 1 } as never,
    { messagesLoaded: true, spawnedFromAgent: { agentSlug: 'content-genius', agentName: 'Content Genius' } });
  (manager as unknown as { sessions: Map<string, unknown> }).sessions.set(id, managed);
  mkdirSync(getSessionPath(root, id), { recursive: true });
  return managed;
}

test('changed source rejects actual Send before acknowledgement, persistence or provider work', async () => {
  const session = draft('changed');
  session.permissionMode = 'allow-all';
  writeSignalHandoff(getSessionPath(root, session.id), reference);
  resolveReference.mockImplementation(async () => ({ ok: false, mode: 'reference', entries: [] }));
  const ack = mock(() => {});
  await expect(manager.sendMessage(session.id, 'Develop this idea', undefined, undefined, { inputOrigin: 'human' }, undefined, undefined, ack)).rejects.toThrow('Signals source changed');
  expect(ack).not.toHaveBeenCalled();
  expect(session.messages).toHaveLength(0);
  expect(session.isProcessing).toBe(false);
  expect(readSignalHandoff(getSessionPath(root, session.id))).toEqual(reference);
});

test('internal sends cannot start an unsent research draft', async () => {
  const session = draft('internal');
  writeSignalHandoff(getSessionPath(root, session.id), reference);
  for (const options of [undefined, { inputOrigin: 'agent' as const }, { inputOrigin: 'human' as const, hidden: true }]) {
    await expect(manager.sendMessage(session.id, 'Start now', undefined, undefined, options)).rejects.toThrow('artist to press Send');
  }
  expect(session.messages).toHaveLength(0);
  expect(resolveReference).not.toHaveBeenCalled();
});

test('accepted first Send consumes binding durably, without depending on sidecar cleanup', async () => {
  const session = draft('accepted');
  writeSignalHandoff(getSessionPath(root, session.id), reference);
  let accepted = false;
  await expect(manager.sendMessage(session.id, 'Develop this', undefined, undefined, { inputOrigin: 'human' }, undefined, undefined, () => {
    accepted = true;
    throw new Error('test-stop-after-ack');
  })).rejects.toThrow('test-stop-after-ack');
  expect(accepted).toBe(true);
  expect(loadSession(root, session.id)?.messages.some(message => message.type === 'user')).toBe(true);
  expect(readSignalHandoff(getSessionPath(root, session.id))).toEqual(reference);
  expect(readSignalHandoffState(getSessionPath(root, session.id))?.acceptedMessageId).toBeDefined();
  expect(await manager.getSignalHandoff(session.id)).toBeNull();
  // Recreate manager/session as after restart: disk, not renderer state, is the receipt.
  manager = new SessionManager();
  draft('accepted');
  expect(await manager.getSignalHandoff('accepted')).toBeNull();
});

test('failed persistence followed by rename never consumes the source guard or leaves a phantom user turn', async () => {
  const session = draft('disk-failure');
  writeSignalHandoff(getSessionPath(root, session.id), reference);
  const originalFlush = manager.flushSession.bind(manager);
  manager.flushSession = mock(async (id: string) => originalFlush(id));
  (manager.flushSession as ReturnType<typeof mock>).mockImplementationOnce(async () => { throw new Error('test disk failure'); });
  const ack = mock(() => {});
  await expect(manager.sendMessage(session.id, 'Develop this idea', undefined, undefined, { inputOrigin: 'human' }, undefined, undefined, ack)).rejects.toThrow('test disk failure');
  expect(ack).not.toHaveBeenCalled();
  expect(session.messages.filter(message => message.role === 'user')).toHaveLength(0);
  await manager.renameSession(session.id, 'Renamed after rejected send');
  await originalFlush(session.id);
  expect(await manager.getSignalHandoff(session.id)).toEqual(reference);
  expect(readSignalHandoffState(getSessionPath(root, session.id))?.acceptedMessageId).toBeUndefined();
  resolveReference.mockImplementation(async () => ({ ok: false, mode: 'reference', entries: [] }));
  await expect(manager.sendMessage(session.id, 'Retry', undefined, undefined, { inputOrigin: 'human' })).rejects.toThrow('Signals source changed');
  resolveReference.mockImplementation(async () => resolved);
  expect(await manager.bindSignalHandoff(session.id, reference)).toBe(session.id);
});

test('concurrent bind calls return one persisted unsent draft and never overwrite it with a different session', async () => {
  draft('first');
  draft('second');
  const ids = await Promise.all([manager.bindSignalHandoff('first', reference), manager.bindSignalHandoff('second', reference)]);
  expect(ids).toEqual(['first', 'first']);
  expect(readSignalHandoff(getSessionPath(root, 'first'))).toEqual(reference);
  expect(readSignalHandoff(getSessionPath(root, 'second'))).toBeNull();
});

test('an acceptance receipt without its persisted user message cannot consume the binding', async () => {
  const session = draft('missing-receipt-message');
  writeSignalHandoff(getSessionPath(root, session.id), reference);
  acceptSignalHandoff(getSessionPath(root, session.id), reference, 'missing-message');
  expect(await manager.getSignalHandoff(session.id)).toEqual(reference);
});

test.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('receipt-write failure keeps the source guard even after the user message reached disk', async () => {
  const session = draft('receipt-write-failure');
  const directory = getSessionPath(root, session.id);
  writeSignalHandoff(directory, reference);
  const flush = manager.flushSession.bind(manager);
  manager.flushSession = async (id: string) => {
    await flush(id);
    chmodSync(directory, 0o500);
  };
  const ack = mock(() => {});
  try {
    await expect(manager.sendMessage(session.id, 'Develop this', undefined, undefined, { inputOrigin: 'human' }, undefined, undefined, ack)).rejects.toThrow();
    expect(ack).not.toHaveBeenCalled();
    expect(await manager.getSignalHandoff(session.id)).toEqual(reference);
    expect(readSignalHandoffState(directory)?.acceptedMessageId).toBeUndefined();
    expect(session.messages.some(message => message.role === 'user')).toBe(false);
  } finally {
    chmodSync(directory, 0o700);
    manager.flushSession = flush;
  }
  await manager.renameSession(session.id, 'Recovered draft');
  await flush(session.id);
  expect(await manager.getSignalHandoff(session.id)).toEqual(reference);
});

test('failed binding releases locks for a corrected attempt and discard leaves no pending reference', async () => {
  draft('retry');
  resolveReference.mockImplementationOnce(async () => ({ ok: false, mode: 'reference', entries: [] }));
  await expect(manager.bindSignalHandoff('retry', reference)).rejects.toThrow('changed or is unavailable');
  expect(await manager.bindSignalHandoff('retry', reference)).toBe('retry');
  await manager.clearSignalHandoff('retry');
  expect(await manager.getSignalHandoff('retry')).toBeNull();
});

test('running, queued, archived and already-used sessions cannot be rebound', async () => {
  const running = draft('running'); running.isProcessing = true;
  const queued = draft('queued'); queued.messageQueue.push({ message: 'queued' } as never);
  const archived = draft('archived'); archived.isArchived = true;
  const used = draft('used'); used.messages.push({ id: 'one', role: 'user', content: 'existing', timestamp: 1 });
  for (const session of [running, queued, archived, used]) await expect(manager.bindSignalHandoff(session.id, reference)).rejects.toThrow('unsent draft');
});

async function captureAuthRetry(session: ReturnType<typeof draft>) {
  session.lastSentMessage = 'Develop this';
  session.lastSentOptions = { inputOrigin: 'human' };
  const original = manager.sendMessage;
  let received!: (args: Parameters<SessionManager['sendMessage']>) => void;
  const next = new Promise<Parameters<SessionManager['sendMessage']>>(resolve => { received = resolve; });
  manager.sendMessage = mock(async (...args: Parameters<SessionManager['sendMessage']>) => { received(args); });
  try {
    const retry = manager as unknown as { attemptAuthRetry: (id: string, managed: typeof session, workspaceId: string) => boolean };
    expect(retry.attemptAuthRetry(session.id, session, 'campaign')).toBe(true);
    const args = await next;
    // This harness replays the captured payload after the retry callback has
    // finished. Its per-dispatch cancellation token has expired by then;
    // cancellation itself is covered by provider-recovery-cancellation tests.
    args[9] = undefined;
    return args;
  } finally { manager.sendMessage = original; }
}

test('actual auth-retry callback preserves the accepted Signals user ID and later source deletion cannot resurrect its guard', async () => {
  const session = draft('auth-retry');
  writeSignalHandoff(getSessionPath(root, session.id), reference);
  await expect(manager.sendMessage(session.id, 'Develop this', undefined, undefined, { inputOrigin: 'human' }, undefined, undefined,
    () => { throw new Error('stop-after-ack'); })).rejects.toThrow('stop-after-ack');
  const accepted = readSignalHandoffState(getSessionPath(root, session.id))!.acceptedMessageId;
  const args = await captureAuthRetry(session);
  expect(args[5]).toBe(accepted);
  expect(args[6]).toBe(true);
  const internals = manager as unknown as { getOrCreateAgent: () => Promise<never> };
  const originalAgent = internals.getOrCreateAgent;
  const providerBoundary = mock(async () => { throw new Error('stop-before-provider'); });
  internals.getOrCreateAgent = providerBoundary;
  resolveReference.mockImplementation(async () => ({ ok: false, mode: 'reference', entries: [] }));
  try {
    await expect(manager.sendMessage(...args)).rejects.toThrow('stop-before-provider');
    expect(providerBoundary).toHaveBeenCalledTimes(1);
  } finally {
    internals.getOrCreateAgent = originalAgent;
    session.isProcessing = false;
  }
  await manager.renameSession(session.id, 'After auth retry');
  await manager.flushSession(session.id);
  expect(session.messages.filter(message => message.role === 'user').map(message => message.id)).toEqual([accepted!]);
  expect(loadSession(root, session.id)!.messages.filter(message => message.type === 'user').map(message => message.id)).toEqual([accepted!]);
  expect(await manager.getSignalHandoff(session.id)).toBeNull();
  const ack = mock(() => { throw new Error('followup-accepted'); });
  await expect(manager.sendMessage(session.id, 'Shorten that concept', undefined, undefined, { inputOrigin: 'human' }, undefined, undefined, ack)).rejects.toThrow('followup-accepted');
  expect(ack).toHaveBeenCalledTimes(1);
  expect(await manager.getSignalHandoff(session.id)).toBeNull();
});

test('auth retry cannot treat an orphan receipt as an accepted user message', async () => {
  const session = draft('auth-orphan');
  writeSignalHandoff(getSessionPath(root, session.id), reference);
  acceptSignalHandoff(getSessionPath(root, session.id), reference, 'not-persisted');
  session.messages.push({ id: 'not-persisted', role: 'user', content: 'Develop this', timestamp: 1 });
  const args = await captureAuthRetry(session);
  expect(args[5]).toBeUndefined();
  expect(await manager.getSignalHandoff(session.id)).toEqual(reference);
  resolveReference.mockImplementation(async () => ({ ok: false, mode: 'reference', entries: [] }));
  await expect(manager.sendMessage(...args)).rejects.toThrow('Signals source changed');
});

test('ordinary auth retry retains its existing message-replacement behavior', async () => {
  const session = draft('ordinary-auth');
  session.messages.push({ id: 'ordinary', role: 'user', content: 'Develop this', timestamp: 1 });
  const args = await captureAuthRetry(session);
  expect(args[5]).toBeUndefined();
  expect(session.messages.some(message => message.id === 'ordinary')).toBe(false);
});
