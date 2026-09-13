import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AdmissionProof, voiceActionAllowed, type Cut, type Deps, type Scope } from './admission-proof.ts';
import { listAgentMessageReceipts } from '../../../shared/src/agent-messaging/storage.ts';
let root: string;
const scope: Scope = { workspaceId: 'workspace-a', parentSessionId: 'real-manager-parent' };
const request = { agentSlug: 'scriptwriter', task: 'Draft a teaser' };
let children: number, sends: string[];
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'voice-admission-')); children = 0; sends = []; });
afterEach(() => rmSync(root, { recursive: true, force: true }));
function deps(overrides: Partial<Deps> = {}): Deps {
  return { root, scope, authorize: s => { if (s.workspaceId !== scope.workspaceId) throw new Error('forbidden'); }, capSupported: true,
    createChild: async receipt => {
      const id = `child-${++children}`; mkdirSync(join(root, 'children'), { recursive: true });
      writeFileSync(join(root, 'children', `${id}.json`), JSON.stringify({ id, ...receipt.voiceTask })); return id;
    },
    findChild: (intentId, attemptId) => {
      try { return readdirSync(join(root, 'children')).map(f => JSON.parse(readFileSync(join(root, 'children', f), 'utf8'))).find(c => c.intentId === intentId && c.attemptId === attemptId)?.id; } catch { return undefined; }
    },
    execute: async (child, execution) => { sends.push(`${child}:${execution}`); }, ...overrides };
}

test('simultaneous reservations and launches return one real persisted receipt/child', async () => {
  const a = new AdmissionProof(deps()), b = new AdmissionProof(deps());
  const [x, y] = await Promise.all([a.reserve(scope, 'client-1', request), b.reserve(scope, 'client-1', request)]);
  expect(x.id).toBe(y.id);
  const [first, second] = await Promise.all([a.launch(scope, x.id), b.launch(scope, y.id)]);
  expect(first).toEqual(second); expect(children).toBe(1); expect(sends).toHaveLength(1);
  expect(listAgentMessageReceipts(root)).toHaveLength(1);
});
test('lost accepted response and new call attachment reuse stable intent without another send', async () => {
  const a = new AdmissionProof(deps()); const x = await a.reserve(scope, 'persisted-client-id', request); await a.launch(scope, x.id);
  const reconnect = new AdmissionProof(deps()); const recovered = await reconnect.reserve(scope, 'persisted-client-id', request);
  expect(recovered.id).toBe(x.id); expect((await reconnect.launch(scope, x.id)).childSessionId).toBe('child-1'); expect(sends).toHaveLength(1);
});
test('digest conflict, foreign workspace and fake voice parent are rejected', async () => {
  const a = new AdmissionProof(deps()); const x = await a.reserve(scope, 'same', request);
  await expect(a.reserve(scope, 'same', { ...request, task: 'Publish instead' })).rejects.toThrow('duplicate_conflict');
  await expect(a.launch({ ...scope, workspaceId: 'foreign' }, x.id)).rejects.toThrow('forbidden');
  await expect(a.launch({ ...scope, parentSessionId: 'voice-focus-id' }, x.id)).rejects.toThrow('forbidden'); expect(children).toBe(0);
});
test('reservation persistence failure cannot create a job', async () => {
  writeFileSync(join(root, 'voice-tasks'), 'not a directory');
  await expect(new AdmissionProof(deps()).reserve(scope, '1', request)).rejects.toThrow(); expect(children).toBe(0); expect(sends).toHaveLength(0);
});
test('receipt persistence failure cannot create a child or blindly retry', async () => {
  const a = new AdmissionProof(deps()); const x = await a.reserve(scope, '1', request); writeFileSync(join(root, 'agent-messages'), 'not a directory');
  await expect(a.launch(scope, x.id)).rejects.toThrow(); expect(children).toBe(0);
  expect((await a.launch(scope, x.id)).state).toBe('admitting'); expect(sends).toHaveLength(0);
});
for (const cut of ['reservation', 'launch-intent', 'receipt', 'child', 'execution', 'bridge'] as Cut[]) {
  test(`crash cut ${cut}: durable identity recovered, uncertain execution never relaunched`, async () => {
    const a = new AdmissionProof(deps({ cut: point => { if (point === cut) throw new Error('process lost'); } }));
    let id: string;
    if (cut === 'reservation') {
      await expect(a.reserve(scope, '1', request)).rejects.toThrow('process lost');
      id = (await new AdmissionProof(deps()).reserve(scope, '1', request)).id;
    } else {
      id = (await a.reserve(scope, '1', request)).id; await expect(a.launch(scope, id)).rejects.toThrow('process lost');
    }
    const recovered = new AdmissionProof(deps()); const snapshot = await recovered.recover(scope, id);
    expect(snapshot.state).toBe(cut === 'reservation' ? 'reserved' : 'interrupted');
    if (['receipt', 'child', 'execution', 'bridge'].includes(cut)) expect(snapshot.receiptId).toBeTruthy();
    if (['child', 'execution', 'bridge'].includes(cut)) expect(snapshot.childSessionId).toBe('child-1');
    await recovered.launch(scope, id); expect(children).toBeLessThanOrEqual(1); expect(sends.length).toBeLessThanOrEqual(1);
    if (cut !== 'reservation') expect(sends.length).toBe(['execution', 'bridge'].includes(cut) ? 1 : 0);
  });
}
test('unavailable cap rejects even with standing allow-all; exact UI grant only', async () => {
  const a = new AdmissionProof(deps({ capSupported: false })); const x = await a.reserve(scope, '1', request);
  await expect(a.launch(scope, x.id)).rejects.toThrow('unsupported_capability'); expect(children).toBe(0);
  const action = { taskId: x.id, attemptId: x.attemptId, digest: 'specific-action', kind: 'external' as const };
  const grant = { ...action, via: 'ui' as const, alwaysAllow: false };
  expect(voiceActionAllowed(action)).toBe(false); expect(voiceActionAllowed(action, { ...grant, via: 'voice' })).toBe(false);
  expect(voiceActionAllowed(action, { ...grant, alwaysAllow: true })).toBe(false);
  expect(voiceActionAllowed(action, { ...grant, attemptId: 'old' })).toBe(false);
  expect(voiceActionAllowed(action, { ...grant, digest: 'other-action' })).toBe(false); expect(voiceActionAllowed(action, grant)).toBe(true);
});
test('workspace capacity is shared across bridge instances', async () => {
  const a = new AdmissionProof(deps()), b = new AdmissionProof(deps());
  for (const key of ['1', '2']) await a.launch(scope, (await a.reserve(scope, key, request)).id);
  const third = await b.reserve(scope, '3', request); await expect(b.launch(scope, third.id)).rejects.toThrow('capacity'); expect(children).toBe(2);
});
test('question waits for exact answer, duplicate reply uses same child once, old turn cannot finish continuation', async () => {
  const a = new AdmissionProof(deps()); const x = await a.launch(scope, (await a.reserve(scope, '1', request)).id);
  const q = await a.outcome(scope, x.id, x.attemptId, 'question');
  expect((await a.outcome(scope, x.id, x.attemptId, 'promise-resolved')).state).toBe('waiting_for_user');
  await expect(a.reply(scope, x.id, x.attemptId, 'wrong', q.revision, 'r1', 'Use the single')).rejects.toThrow('stale_revision');
  const reply = await a.reply(scope, x.id, x.attemptId, q.questionId!, q.revision, 'r1', 'Use the single');
  await a.reply(scope, x.id, x.attemptId, q.questionId!, q.revision, 'r1', 'Use the single'); expect(children).toBe(1); expect(sends).toHaveLength(2);
  await expect(a.reply(scope, x.id, x.attemptId, q.questionId!, q.revision, 'r1', 'Use another track')).rejects.toThrow('duplicate_conflict');
  expect((await a.outcome(scope, x.id, x.attemptId, 'committed')).state).toBe('running');
  expect((await a.outcome(scope, x.id, reply.executionId!, 'committed')).state).toBe('succeeded');
});
test('cancellation waits for explicit abort; resolving send is never success; late commit ignored', async () => {
  const a = new AdmissionProof(deps()); const x = await a.launch(scope, (await a.reserve(scope, '1', request)).id);
  expect((await a.outcome(scope, x.id, x.attemptId, 'cancel-requested')).state).toBe('cancelling');
  expect((await a.outcome(scope, x.id, x.attemptId, 'promise-resolved')).state).toBe('cancelling');
  expect((await a.outcome(scope, x.id, x.attemptId, 'aborted')).state).toBe('cancelled');
  expect((await a.outcome(scope, x.id, x.attemptId, 'committed')).state).toBe('cancelled');
});
test('committed output winning cancellation race stays succeeded', async () => {
  const a = new AdmissionProof(deps()); const x = await a.launch(scope, (await a.reserve(scope, '1', request)).id);
  await a.outcome(scope, x.id, x.attemptId, 'cancel-requested');
  expect((await a.outcome(scope, x.id, x.attemptId, 'committed')).state).toBe('succeeded');
  expect((await a.outcome(scope, x.id, x.attemptId, 'aborted')).state).toBe('succeeded');
});

for (const replyFirst of [true, false]) {
  test(`cancel and reply race, reply first=${replyFirst}`, async () => {
    const a = new AdmissionProof(deps()); const x = await a.launch(scope, (await a.reserve(scope, '1', request)).id);
    const q = await a.outcome(scope, x.id, x.attemptId, 'question');
    if (replyFirst) await a.reply(scope, x.id, x.attemptId, q.questionId!, q.revision, 'r1', 'Use the single');
    const cancelling = await a.outcome(scope, x.id, x.attemptId, 'cancel-requested');
    expect(cancelling.state).toBe('cancelling');
    expect((await a.outcome(scope, x.id, cancelling.executionId!, 'question')).state).toBe('cancelling');
    if (!replyFirst) await expect(a.reply(scope, x.id, x.attemptId, q.questionId!, q.revision, 'r1', 'Use the single')).rejects.toThrow('stale_revision');
    expect(sends).toHaveLength(replyFirst ? 2 : 1);
    expect((await a.outcome(scope, x.id, cancelling.executionId!, 'aborted')).state).toBe('cancelled');
  });
}
