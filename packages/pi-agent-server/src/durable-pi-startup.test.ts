import { expect, test } from 'bun:test';
import { PiAgent } from '../../shared/src/agent/pi-agent.ts';

// Exercise the production JSONL error handler without opening credentials or spawning an app.
test('durable startup error rejects both readiness waits immediately', async () => {
  let failReason = '';
  let queueClosed = false;
  let rejectReady!: (error: Error) => void;
  let rejectStartup!: (error: Error) => void;
  const ready = new Promise<void>((_, reject) => { rejectReady = reject; });
  const startup = new Promise<void>((_, reject) => { rejectStartup = reject; });
  const settled = Promise.allSettled([ready, startup]);
  const agent = Object.create(PiAgent.prototype) as any;
  agent.config = { durableExecution: { fail: async (reason: string) => { failReason = reason; } } };
  agent.subprocessReadyReject = rejectReady;
  agent.subprocessStartupReject = rejectStartup;
  agent.eventQueue = { enqueue() {}, complete() { queueClosed = true; } };
  agent.handleLine(JSON.stringify({ type: 'error', message: 'init credential mismatch' }));
  const results = await settled;
  expect(results.map(result => result.status)).toEqual(['rejected', 'rejected']);
  expect(failReason).toBe('init credential mismatch');
  expect(queueClosed).toBe(true);
});


test('durable chat retains startup error when journal failure marking also fails', async () => {
  const primary = new Error('original startup failure');
  const agent = Object.create(PiAgent.prototype) as any;
  agent.config = { workspace: { id: 'ws' }, durableExecution: { descriptor: { workspaceId: 'ws', model: 'fixture' }, fail: async () => { throw new Error('secondary journal failure'); } } };
  agent._model = 'fixture';
  agent._isProcessing = false;
  agent.eventQueue = { reset() {} };
  agent.adapter = { startTurn() {} };
  agent.ensureSubprocess = async () => { throw primary; };
  const iterator = agent.chat('frozen');
  await expect(iterator.next()).rejects.toBe(primary);
  expect(agent._isProcessing).toBe(false);
});
