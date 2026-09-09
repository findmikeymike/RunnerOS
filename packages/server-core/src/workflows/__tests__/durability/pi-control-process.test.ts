import { expect, test } from 'bun:test';
import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DurableJournal, type DurableRunSpec } from '../../../../../shared/src/durable-execution/index.ts';
import { DURABLE_RUNTIME_MANIFEST } from '../../../../../shared/src/protocol/durable-execution.ts';
import { startProcess, type RunningProcess } from './process-support.ts';

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'artist-pi-control-'));
  const key = randomBytes(32), reads: string[] = [];
  let models = 0;
  const server = createServer(async (request, response) => {
    let raw = ''; for await (const chunk of request) raw += chunk;
    const input = JSON.parse(raw);
    response.setHeader('content-type', 'application/json');
    if (request.url === '/read') { reads.push(input.id); response.end('{}'); return; }
    models++;
    const done = input.messages.some((message: any) => message.role === 'toolResult');
    response.end(JSON.stringify({ role: 'assistant', api: 'anthropic-messages', provider: 'anthropic', model: 'control-fixture',
      content: done ? [{ type: 'text', text: 'CONTROL_COMPLETE' }] : [
        { type: 'toolCall', id: 'read-first', name: 'read', arguments: { path: 'first.txt' } },
        { type: 'toolCall', id: 'read-second', name: 'read', arguments: { path: 'second.txt' } }],
      stopReason: done ? 'stop' : 'toolUse', timestamp: Date.now(), usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } }));
  });
  try { await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); }); }
  catch (error) { rmSync(root, { recursive: true, force: true }); throw error; }
  const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const spec: DurableRunSpec = { engine: 'sqlite-v2-readonly-1', runId: randomUUID(), workspaceId: 'control-workspace', createdAt: Date.now(), allowedTools: ['read'], model: 'control-fixture', maxOutputTokens: 256, credentialIdentity: 'a'.repeat(64), runtimeManifest: { ...DURABLE_RUNTIME_MANIFEST }, commandId: randomUUID(), authority: { scope: 'local-test' }, context: {}, deadlineAt: Date.now() + 60000, maxModelAttempts: 4, costPolicy: { unit: 'verified-free', maxTotalUnits: 0, maxUnitsPerAttempt: 0 } };
  writeFileSync(join(root, 'spec.json'), JSON.stringify(spec));
  writeFileSync(join(root, 'first.txt'), 'FIRST_ORIGINAL'); writeFileSync(join(root, 'second.txt'), 'SECOND_ORIGINAL');
  const journal = new DurableJournal({ configRoot: root, key });
  journal.admit(spec);
  const workers: RunningProcess[] = [];
  return { root, spec, journal, reads, models: () => models,
    worker(barrier = '', hold = '') { const worker = startProcess([join(import.meta.dir, 'pi-control-worker.ts'), root, endpoint, barrier, hold], { DURABLE_TEST_KEY: key.toString('hex') }); workers.push(worker); return worker; },
    command(action: 'pause' | 'resume' | 'cancel') { return journal.command({ runId: spec.runId, workspaceId: spec.workspaceId, commandId: randomUUID(), expectedVersion: journal.get(spec.runId, spec.workspaceId).version, action }); },
    async close() { for (const worker of workers) { if (worker.child.exitCode === null) worker.child.kill('SIGKILL'); await worker.done; } journal.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(root, { recursive: true, force: true }); },
  };
}

test('pause fences actual SDK successor, survives SIGKILL, and explicit resume reuses committed native read', async () => {
  const f = await fixture();
  try {
    const first = f.worker('after-tool-result', 'hold');
    await first.line(line => line.includes('"barrier":"after-tool-result"'));
    f.command('pause');
    first.child.stdin.write('continue\n');
    await first.line(line => line.includes('"blocked":'));
    expect(f.reads).toEqual(['read-first']); expect(f.models()).toBe(1);
    expect(f.journal.get(f.spec.runId, f.spec.workspaceId).status).toBe('paused');
    first.child.kill('SIGKILL'); expect((await first.done).signal).toBe('SIGKILL');
    const blocked = await f.worker().done;
    expect(blocked.stdout).toContain('claimBlocked');
    expect(f.reads).toEqual(['read-first']); expect(f.models()).toBe(1);
    writeFileSync(join(f.root, 'first.txt'), 'FIRST_CHANGED_AFTER_PAUSE');
    f.command('resume');
    const resumed = await f.worker().done;
    expect(resumed.stderr).toBe(''); expect(resumed.code).toBe(0); expect(resumed.stdout).toContain('completed');
    const state = f.journal.get(f.spec.runId, f.spec.workspaceId);
    expect(state.status).toBe('succeeded'); expect(f.reads).toEqual(['read-first', 'read-second']); expect(f.models()).toBe(2);
    expect(JSON.stringify(state.turns[0]?.calls[0]?.result)).toContain('FIRST_ORIGINAL');
    expect(readFileSync(join(f.root, 'first.txt'), 'utf8')).toBe('FIRST_CHANGED_AFTER_PAUSE');
  } finally { await f.close(); }
}, 30000);

for (const barrier of ['before-model-result', 'before-tool-result']) {
  test(`cancel retains late ${barrier === 'before-model-result' ? 'model' : 'tool'} outcome under original ownership and starts no successors`, async () => {
    const f = await fixture();
    try {
      const worker = f.worker(barrier);
      await worker.line(line => line.includes(`"barrier":"${barrier}"`));
      f.command('cancel'); worker.child.stdin.write('continue\n');
      const ended = await worker.done;
      expect(ended.code).toBe(0); expect(ended.stdout).toContain('blocked');
      const state = f.journal.get(f.spec.runId, f.spec.workspaceId);
      expect(state.status).toBe('cancelled'); expect(f.models()).toBe(1);
      expect(f.reads).toEqual(barrier === 'before-model-result' ? [] : ['read-first']);
      if (barrier === 'before-model-result') expect(state.turns[0]?.message).toBeDefined();
      else expect(JSON.stringify(state.turns[0]?.calls[0]?.result)).toContain('FIRST_ORIGINAL');
      expect(state.turns).toHaveLength(1);
      const restart = await f.worker().done;
      expect(restart.stdout).toContain('claimBlocked'); expect(f.models()).toBe(1);
    } finally { await f.close(); }
  }, 30000);
}
