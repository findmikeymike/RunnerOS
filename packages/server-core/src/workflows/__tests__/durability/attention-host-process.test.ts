import { expect, test } from 'bun:test';
import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { startProcess } from './process-support.ts';

for (const changedPolicy of [false, true]) {
  test(`attention bridge approval survives process deaths ${changedPolicy ? 'and revalidates changed policy' : 'without repeating model work'}`, async () => {
    const root = mkdtempSync(join(tmpdir(), 'artist-approval-'));
    let requests = 0, requestsWithRead = 0;
    const server = createServer(async (req, res) => {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw); requests++;
      const done = body.messages.some((message: any) => message.role === 'tool');
      if (done) { requestsWithRead++; expect(raw).toContain('APPROVED_NATIVE_READ'); }
      const delta = done ? { role: 'assistant', content: 'Read completed' } : { role: 'assistant', tool_calls: [{ index: 0, id: 'approval-read', type: 'function', function: { name: 'read', arguments: JSON.stringify({ path: join(root, 'fixture.txt') }) } }] };
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const [value, finish] of [[delta, null], [{}, done ? 'stop' : 'tool_calls']]) {
        res.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'approval-fixture', choices: [{ index: 0, delta: value, finish_reason: finish }] })}\n\n`);
      }
      res.end('data: [DONE]\n\n');
    });
    await new Promise<void>((yes, no) => { server.once('error', no); server.listen(0, '127.0.0.1', yes); });
    const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const policy = { revision: 'policy-1', allowed: true, expiresAt: Date.now() + 60000 };
    writeFileSync(join(root, 'synthetic-only'), 'approval-fixture');
    writeFileSync(join(root, 'fixture.txt'), 'APPROVED_NATIVE_READ');
    writeFileSync(join(root, 'policy.json'), JSON.stringify(policy));
    writeFileSync(join(root, 'input.json'), JSON.stringify({ runId: randomUUID(), commandId: 'admit', workspaceId: 'approval-workspace', connectionSlug: 'approval-fixture', model: 'approval-fixture', resolvedAgentSlug: 'reader', approvalPrincipalId: 'fixture-principal', systemPrompt: 'Use the native read tool to read fixture.txt, then summarize.', allowedTools: ['read'], maxOutputTokens: 256, maxModelAttempts: 3, deadlineAt: Date.now() + 60000, costPolicy: { unit: 'verified-free', maxTotalUnits: 0, maxUnitsPerAttempt: 0 } }));
    const env = { APPROVAL_TEST_KEY: randomBytes(32).toString('hex'), CRAFT_CONFIG_DIR: join(root, 'config'), CRAFT_PRODUCT_VARIANT: 'artist-os', CRAFT_BUNDLED_ASSETS_ROOT: resolve(import.meta.dir, '../../../../../../apps/electron/resources') };
    const run = (stage: string) => startProcess([join(import.meta.dir, 'attention-host-worker.ts'), root, endpoint, stage], env, process.execPath, 25000);
    try {
      const waiting = run('start');
      try {
        const line = JSON.parse(await waiting.line(line => line.startsWith('{"barrier":"waiting"')));
        expect(line.state.status).toBe('waiting-approval'); expect(requests).toBe(1); expect(requestsWithRead).toBe(0);
      } finally { waiting.child.kill('SIGKILL'); await waiting.done; }
      const unchanged = await run('resume').done;
      expect(unchanged.code).toBe(0); expect(unchanged.stdout).toContain('"result":"waiting-approval"'); expect(requests).toBe(1);
      const approving = run('approve-stop');
      try { await approving.line(line => line.startsWith('{"barrier":"approved"')); }
      finally { approving.child.kill('SIGKILL'); await approving.done; }
      if (changedPolicy) writeFileSync(join(root, 'policy.json'), JSON.stringify({ ...policy, revision: 'policy-2' }));
      const resumed = await run('resume').done;
      expect({ code: resumed.code, error: resumed.code ? resumed.stderr : '' }).toEqual({ code: 0, error: '' });
      expect(resumed.stdout).toContain(`"result":"${changedPolicy ? 'waiting-approval' : 'succeeded'}"`);
      expect(requests).toBe(changedPolicy ? 1 : 2); expect(requestsWithRead).toBe(changedPolicy ? 0 : 1);
    } finally { server.closeAllConnections(); await new Promise<void>(yes => server.close(() => yes())); rmSync(root, { recursive: true, force: true }); }
  }, 60000);
}
