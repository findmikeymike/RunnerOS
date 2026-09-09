import { expect, test } from 'bun:test';
import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { startProcess } from './process-support.ts';

for (const scenario of ['pending', 'approved', 'late'] as const) {
  const approveFirst = scenario === 'approved', late = scenario === 'late';
  test(`ordered steering survives process deaths ${late ? 'between boundary and dispatch' : approveFirst ? 'after saved approval' : 'while waiting'}`, async () => {
    const root = mkdtempSync(join(tmpdir(), 'artist-approval-'));
    let requests = 0, requestsWithSkippedCall = 0;
    const server = createServer(async (req, res) => {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw); requests++;
      const done = body.messages.some((message: any) => message.role === 'tool');
      if (done) {
        requestsWithSkippedCall++;
        if (late) expect(raw).toContain('APPROVED_NATIVE_READ');
        else expect(raw).not.toContain('APPROVED_NATIVE_READ');
        const users = body.messages.filter((message: any) => message.role === 'user');
        expect(users.slice(-2).map((message: any) => typeof message.content === 'string' ? message.content : message.content.map((part: any) => part.text ?? '').join(''))).toEqual(['Focus on radio first.', 'Only local stations.']);
      }
      const delta = done ? { role: 'assistant', content: 'Local radio plan' } : { role: 'assistant', tool_calls: [{ index: 0, id: 'approval-read', type: 'function', function: { name: 'read', arguments: JSON.stringify({ path: join(root, 'fixture.txt') }) } }] };
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
    const run = (stage: string) => startProcess([join(import.meta.dir, 'steering-host-worker.ts'), root, endpoint, stage], env, process.execPath, 25000);
    try {
      if (!late) {
      const waiting = run('start');
      try {
        const line = JSON.parse(await waiting.line(line => line.startsWith('{"barrier":"waiting"')));
        expect(line.state.status).toBe('waiting-approval'); expect(requests).toBe(1); expect(requestsWithSkippedCall).toBe(0);
      } finally { waiting.child.kill('SIGKILL'); await waiting.done; }
      const unchanged = await run('resume').done;
      expect(unchanged.code).toBe(0); expect(unchanged.stdout).toContain('"result":"waiting-approval"'); expect(requests).toBe(1);
      if (approveFirst) {
        const approving = run('approve-stop');
        try { await approving.line(line => line.startsWith('{"barrier":"approved"')); }
        finally { approving.child.kill('SIGKILL'); await approving.done; }
      }
      const steering = run('steer-stop');
      try {
        const saved = JSON.parse(await steering.line(line => line.startsWith('{"barrier":"steering-saved"')));
        expect(saved.receipts.map((receipt: any) => receipt.sequence)).toEqual([1, 2]);
      } finally { steering.child.kill('SIGKILL'); await steering.done; }
      const applying = run('resume-boundary-stop');
      try {
        const applied = JSON.parse(await applying.line(line => line.startsWith('{"barrier":"steering-applied"')));
        expect(applied.steering.map((entry: any) => entry.text)).toEqual(['Focus on radio first.', 'Only local stations.']);
        expect(requests).toBe(1);
      } finally { applying.child.kill('SIGKILL'); await applying.done; }
      }
      const resumed = await run(late ? 'start-late-boundary' : 'resume').done;
      expect({ code: resumed.code, error: resumed.code ? resumed.stderr : '' }).toEqual({ code: 0, error: '' });
      expect(resumed.stdout).toContain('"result":"succeeded"');
      if (!late) expect(resumed.stdout).toContain('"status":"superseded"');
      const final = JSON.parse(resumed.stdout.split('\n').find(line => line.startsWith('{"result":'))!).state;
      expect(final.turns[0].calls[0].attempts).toBe(late ? 1 : 0);
      expect(Boolean(final.turns[0].calls[0].skipped)).toBe(!late);
      expect(final.modelAttempts).toBe(2);
      expect(requests).toBe(2); expect(requestsWithSkippedCall).toBe(1);
    } finally { server.closeAllConnections(); await new Promise<void>(yes => server.close(() => yes())); rmSync(root, { recursive: true, force: true }); }
  }, 60000);
}
