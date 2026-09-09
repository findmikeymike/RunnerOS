import { test, expect } from 'bun:test';
import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DurableJournal, type DurableRunSpec } from '../../../../../shared/src/durable-execution/index.ts';
import { DURABLE_RUNTIME_MANIFEST } from '../../../../../shared/src/protocol/durable-execution.ts';
import { startProcess } from './process-support.ts';

for (const barrier of ['before-model-commit', 'after-model-commit', 'after-tool-commit', 'after-complete']) {
  test(`production journal resumes real Pi SDK after SIGKILL ${barrier}`, async () => {
    const root = mkdtempSync(join(tmpdir(), 'artist-os-pi-recovery-'));
    const key = randomBytes(32);
    let modelCalls = 0, readCalls = 0;
    const server = createServer(async (request, response) => {
      let raw = ''; for await (const chunk of request) raw += chunk;
      const input = JSON.parse(raw);
      response.setHeader('content-type', 'application/json');
      if (request.url === '/read') { readCalls++; response.end('{}'); return; }
      modelCalls++;
      const done = input.messages.some((message: any) => message.role === 'toolResult');
      response.end(JSON.stringify({ role: 'assistant', api: 'anthropic-messages', provider: 'anthropic', model: 'claude-sonnet-4-20250514',
        content: done ? [{ type: 'text', text: 'RECOVERED_NATIVE_READ' }] : [1, 2].map(slot => ({ type: 'toolCall', id: `read-call-${slot}`, name: 'read', arguments: { path: 'input.txt' } })),
        stopReason: done ? 'stop' : 'toolUse', timestamp: Date.now(), usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } }));
    });
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const spec: DurableRunSpec = { engine: 'sqlite-v2-readonly-1', credentialIdentity: 'a'.repeat(64), runtimeManifest: { ...DURABLE_RUNTIME_MANIFEST }, runId: randomUUID(), workspaceId: 'test-workspace', commandId: randomUUID(), createdAt: Date.now(), allowedTools: ['read'], model: 'claude-sonnet-4-20250514', maxOutputTokens: 256, authority: { scope: 'test-local-read' }, context: {}, deadlineAt: Date.now() + 60000, maxModelAttempts: 5, costPolicy: { unit: 'verified-free', maxTotalUnits: 0, maxUnitsPerAttempt: 0 } };
    writeFileSync(join(root, 'spec.json'), JSON.stringify(spec));
    writeFileSync(join(root, 'input.txt'), 'ORIGINAL_READ_CONTENT');
    const args = [join(import.meta.dir, 'pi-recovery-worker.ts'), root, endpoint];
    try {
      const first = startProcess([...args, barrier], { DURABLE_TEST_KEY: key.toString('hex') });
      await first.line(line => line.includes(`"barrier":"${barrier}"`));
      first.child.kill('SIGKILL');
      expect((await first.done).signal).toBe('SIGKILL');
      writeFileSync(join(root, 'input.txt'), 'CHANGED_AFTER_CRASH');
      if (barrier === 'after-complete') {
        const journal = new DurableJournal({ configRoot: root, key });
        try { expect(journal.get(spec.runId, spec.workspaceId).status).toBe('succeeded'); expect(() => journal.claim(spec.runId, spec.workspaceId)).toThrow('terminal'); }
        finally { journal.close(); }
      } else {
        const second = await startProcess(args, { DURABLE_TEST_KEY: key.toString('hex') }).done;
        expect(second.stderr + second.stdout).not.toContain('error:');
        expect(second.code).toBe(0);
        const state = JSON.parse(readFileSync(join(root, 'completed.jsonl'), 'utf8').trim());
        expect(state.status).toBe('succeeded');
        if (barrier === 'after-tool-commit') {
          expect(JSON.stringify(state.turns[0].calls[0].result)).toContain('ORIGINAL_READ_CONTENT');
          expect(JSON.stringify(state.turns[0].calls[1].result)).toContain('CHANGED_AFTER_CRASH');
        }
      }
      expect(readCalls).toBe(2);
      expect(modelCalls).toBe(barrier === 'before-model-commit' ? 3 : 2);
    } finally {
      server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
      rmSync(root, { recursive: true, force: true });
    }
  }, 30000);
}
