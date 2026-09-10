import { expect, test } from 'bun:test';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { startProcess } from './process-support';

test.each(['start', 'multi', 'sources', 'inputs'])('normal runner %s reaches default Pi backend and performs native reads in isolated configuration', async (mode) => {
  const root = mkdtempSync(join(tmpdir(), 'artist-normal-pi-')); let requests = 0, nativeReads = 0, usedPriorOutput = false;
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); requests++; if (raw.includes('Use Read completed and read fixture.txt again.')) usedPriorOutput = true; const done = body.messages.some((message: { role: string }) => message.role === 'tool');
    if (mode === 'sources') expect(raw).toContain('SOURCE_CONTEXT_NATIVE_READ');
    if (mode === 'inputs') { expect(raw).toContain('INPUT_FIXTURE Read fixture.txt.'); expect(raw).not.toContain('{{trigger.file}}'); }
    if (done) { nativeReads++; expect(raw).toContain('NORMAL_START_NATIVE_READ'); }
    const delta = done ? { role: 'assistant', content: 'Read completed' } : { role: 'assistant', tool_calls: [{ index: 0, id: 'read-1', type: 'function', function: { name: 'read', arguments: JSON.stringify({ path: join(root, 'fixture.txt') }) } }] };
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const [value, finish] of [[delta, null], [{}, done ? 'stop' : 'tool_calls']]) res.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'approval-fixture', choices: [{ index: 0, delta: value, finish_reason: finish }] })}\n\n`);
    res.end('data: [DONE]\n\n');
  });
  await new Promise<void>(yes => server.listen(0, '127.0.0.1', yes));
  writeFileSync(join(root, 'synthetic-only'), 'approval-fixture'); writeFileSync(join(root, 'fixture.txt'), 'NORMAL_START_NATIVE_READ');
  try {
    const child = startProcess([join(import.meta.dir, 'normal-start-worker.ts'), root, `http://127.0.0.1:${(server.address() as { port: number }).port}`, mode], { CRAFT_CONFIG_DIR: join(root, 'config'), CRAFT_PRODUCT_VARIANT: 'artist-os', CRAFT_BUNDLED_ASSETS_ROOT: resolve(import.meta.dir, '../../../../../../apps/electron/resources') }, process.execPath, 25000);
    const result = await child.done; expect({ code: result.code, error: result.code ? result.stderr : '' }).toEqual({ code: 0, error: '' });
    expect(result.stdout).toContain('"barrier":"admitted"'); expect(result.stdout).toContain('"result":"succeeded"'); expect(requests).toBe(mode === 'multi' ? 4 : 2); expect(nativeReads).toBe(mode === 'multi' ? 2 : 1);
    if (mode === 'multi') { expect(usedPriorOutput).toBe(true); const complete = JSON.parse(result.stdout.split('\n').find(line => line.includes('\"result\":\"succeeded\"'))!); expect(complete.steps.map((step: { state: string }) => step.state)).toEqual(['succeeded', 'succeeded']); }
  } finally { server.closeAllConnections(); await new Promise<void>(yes => server.close(() => yes())); rmSync(root, { recursive: true, force: true }); }
}, 30000);
