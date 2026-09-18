import { expect, test } from 'bun:test';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { startProcess } from './process-support';
import { getManagedSkillManifest } from '../../../../../shared/src/skills/managed.ts';

test.each(['start', 'multi', 'sources', 'inputs', 'structured', 'fallback', 'credits', 'skills', 'connected', 'source-tools', 'source-write', 'source-write-unknown', 'source-write-credits'])('normal runner %s reaches default Pi backend and performs native reads in isolated configuration', async (mode) => {
  const sourceWrite = mode.startsWith('source-write'), sourceMode = sourceWrite || mode === 'source-tools';
  const root = mkdtempSync(join(tmpdir(), 'artist-normal-pi-')); let requests = 0, nativeReads = 0, usedPriorOutput = false, backupRequests = 0;
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); requests++;
    if (body.model === 'backup-fixture') backupRequests++;
    if (mode === 'source-write-credits' && body.messages.some((message: { role: string }) => message.role === 'tool')) {
      res.writeHead(429, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'insufficient_quota', type: 'insufficient_quota' } })); return;
    }
    if (['fallback', 'credits'].includes(mode) && body.model === 'approval-fixture') {
      res.writeHead(429, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: mode === 'credits' ? 'insufficient_quota' : 'rate limit exceeded', type: mode === 'credits' ? 'insufficient_quota' : 'rate_limit_error' } }));
      return;
    }
 if (raw.includes('Use Read completed and read fixture.txt again.')) usedPriorOutput = true; const done = body.messages.some((message: { role: string }) => message.role === 'tool');
    if (mode === 'connected') { expect(raw).toContain('CONNECTED_READ_CONTEXT'); expect(raw).not.toContain('synthetic-account-token'); expect(body.tools.map((tool: { function: { name: string } }) => tool.function.name).sort()).toEqual(['find', 'grep', 'ls', 'read']); }
    if (mode === 'sources') expect(raw).toContain('SOURCE_CONTEXT_NATIVE_READ');
    if (mode === 'skills') {
      const skill = getManagedSkillManifest().get('artist-belief-system')!;
      const prompt = body.messages.map((message: { content: unknown }) => typeof message.content === 'string' ? message.content : JSON.stringify(message.content)).join('\n');
      // Booleans prevent a failing assertion from printing private prompt snapshots.
      expect(prompt.includes(JSON.stringify(skill.content))).toBe(true);
      expect(skill.files.filter(file => file.path !== 'SKILL.md').every(file => prompt.includes(JSON.stringify(file.content)))).toBe(true);
      expect(prompt.includes('SKILL_PERSONAL_NATIVE_READ')).toBe(true);
      expect(body.tools.map((tool: { function: { name: string } }) => tool.function.name).sort()).toEqual(['find', 'grep', 'ls', 'read']);
    }
    if (mode === 'inputs') { expect(raw).toContain('INPUT_FIXTURE Read fixture.txt.'); expect(raw).not.toContain('{{trigger.file}}'); }
    if (done) { nativeReads++; expect(raw).toContain(sourceMode ? 'SOURCE_PROXY_NATIVE_READ' : 'NORMAL_START_NATIVE_READ'); }
    if (sourceMode) {
      expect(raw).not.toContain('synthetic-source-token');
      expect(raw).not.toContain('synthetic-refreshed-source-token');
      expect(body.tools.map((tool: { function: { name: string } }) => tool.function.name)).toContain('mcp__account__api_account');
    }
    const delta = done ? { role: 'assistant', content: mode === 'structured' ? '{"summary":"Read completed"}' : 'Read completed' } : { role: 'assistant', tool_calls: [{ index: 0, id: 'read-1', type: 'function', function: { name: sourceMode ? 'mcp__account__api_account' : 'read', arguments: JSON.stringify(sourceMode ? { method: sourceWrite ? 'POST' : 'GET', path: '/items', ...(sourceWrite ? { params: { title: 'Fixture item' } } : {}) } : { path: join(root, 'fixture.txt') }) } }] };
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const [value, finish] of [[delta, null], [{}, done ? 'stop' : 'tool_calls']]) res.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'approval-fixture', choices: [{ index: 0, delta: value, finish_reason: finish }] })}\n\n`);
    res.end('data: [DONE]\n\n');
  });
  await new Promise<void>(yes => server.listen(0, '127.0.0.1', yes));
  writeFileSync(join(root, 'synthetic-only'), 'approval-fixture'); writeFileSync(join(root, 'fixture.txt'), 'NORMAL_START_NATIVE_READ');
  try {
    const child = startProcess([join(import.meta.dir, 'normal-start-worker.ts'), root, `http://127.0.0.1:${(server.address() as { port: number }).port}`, mode], { CRAFT_CONFIG_DIR: join(root, 'config'), CRAFT_PRODUCT_VARIANT: 'artist-os', CRAFT_BUNDLED_ASSETS_ROOT: resolve(import.meta.dir, '../../../../../../apps/electron/resources') }, process.execPath, 25000);
    const result = await child.done; expect({ code: result.code, error: result.code ? result.stderr : '' }).toEqual({ code: 0, error: '' });
    expect(result.stdout).toContain('"barrier":"admitted"'); expect(result.stdout).toContain(mode === 'source-write-unknown' ? '"result":"uncertain-write"' : mode === 'source-write-credits' ? '"result":"write-provider-paused"' : '"result":"succeeded"'); expect(requests).toBe(mode === 'source-write-unknown' ? 1 : mode === 'multi' || mode === 'fallback' ? 4 : mode === 'credits' ? 3 : 2); expect(nativeReads).toBe(['source-write-unknown', 'source-write-credits'].includes(mode) ? 0 : mode === 'multi' ? 2 : 1);
    if (['fallback', 'credits'].includes(mode)) { const complete = JSON.parse(result.stdout.split('\n').find(line => line.includes('\"result\":\"succeeded\"'))!); expect(complete.providerAttempts.map((attempt: { model: string }) => attempt.model)).toEqual(['approval-fixture', 'backup-fixture']); }
    if (mode === 'structured') { const complete = JSON.parse(result.stdout.split('\n').find(line => line.includes('\"result\":\"succeeded\"'))!); expect(complete.steps[0].output).toEqual({ summary: 'Read completed' }); }
    if (mode === 'skills') { expect(result.stdout.includes('SKILL_PERSONAL_NATIVE_READ')).toBe(false); expect(result.stdout.includes('private-durable-skill-guidance')).toBe(false); }
    if (sourceMode) expect(readFileSync(join(root, 'source-dispatches'), 'utf8')).toBe(sourceWrite ? 'POST\n' : 'GET\n');
    if (sourceWrite) expect(readFileSync(join(root, 'write-approved'), 'utf8')).toBe('once');
    if (mode === 'source-write-credits') expect(backupRequests).toBe(0);
    if (mode === 'connected') expect(readFileSync(join(root, 'connected-dispatches'), 'utf8')).toBe('read\n');
    if (mode === 'multi') { expect(usedPriorOutput).toBe(true); const complete = JSON.parse(result.stdout.split('\n').find(line => line.includes('\"result\":\"succeeded\"'))!); expect(complete.steps.map((step: { state: string }) => step.state)).toEqual(['succeeded', 'succeeded']); }
  } finally { server.closeAllConnections(); await new Promise<void>(yes => server.close(() => yes())); rmSync(root, { recursive: true, force: true }); }
}, 30000);

for (const write of [false, true]) test(`normal source proxy reuses saved ${write ? 'write receipt' : 'GET'} after process death without another fetch or approval`, async () => {
  const root = mkdtempSync(join(tmpdir(), 'artist-source-replay-'));
  writeFileSync(join(root, 'synthetic-only'), 'approval-fixture');
  let reached!: () => void;
  const saved = new Promise<void>(resolve => { reached = resolve; });
  let recovering = false, calls = 0;
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); calls++;
    const done = body.messages.some((message: { role: string }) => message.role === 'tool');
    if (done && !recovering) { reached(); return; }
    if (recovering) { expect(done).toBe(true); expect(raw).toContain('SOURCE_PROXY_NATIVE_READ'); }
    const delta = done ? { role: 'assistant', content: 'Source recovery complete' } : { role: 'assistant', tool_calls: [{ index: 0, id: 'read-1', type: 'function', function: { name: 'mcp__account__api_account', arguments: JSON.stringify({ method: write ? 'POST' : 'GET', path: '/items', ...(write ? { params: { title: 'Fixture item' } } : {}) }) } }] };
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const [value, finish] of [[delta, null], [{}, done ? 'stop' : 'tool_calls']]) res.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'approval-fixture', choices: [{ index: 0, delta: value, finish_reason: finish }] })}\n\n`);
    res.end('data: [DONE]\n\n');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const env = { CRAFT_CONFIG_DIR: join(root, 'config'), CRAFT_PRODUCT_VARIANT: 'artist-os', CRAFT_BUNDLED_ASSETS_ROOT: resolve(import.meta.dir, '../../../../../../apps/electron/resources') };
  let child = startProcess([join(import.meta.dir, 'normal-start-worker.ts'), root, endpoint, write ? 'source-write-gap' : 'source-tools'], env);
  try {
    await Promise.race([write ? child.line(line => line.includes('"barrier":"write-receipt-saved"')) : saved, child.done.then(result => { throw new Error('worker exited before saved result: ' + result.stderr); })]);
    expect(readFileSync(join(root, 'source-dispatches'), 'utf8')).toBe(write ? 'POST\n' : 'GET\n');
    child.child.kill('SIGKILL'); await child.done;
    recovering = true;
    child = startProcess([join(import.meta.dir, 'normal-start-worker.ts'), root, endpoint, write ? 'source-write-recover' : 'source-tools-recover'], env);
    const result = await child.done;
    expect({ code: result.code, error: result.code ? result.stderr : '' }).toEqual({ code: 0, error: '' });
    expect(result.stdout).toContain('"result":"succeeded"');
    expect(readFileSync(join(root, 'source-dispatches'), 'utf8')).toBe(write ? 'POST\n' : 'GET\n');
    expect(calls).toBe(write ? 2 : 3);
    if (write) expect(readFileSync(join(root, 'write-approved'), 'utf8')).toBe('once');
    else expect(readFileSync(join(root, 'source-policy-checks'), 'utf8')).toContain('recover\n');
  } finally {
    if (child.child.exitCode === null) { child.child.kill('SIGKILL'); await child.done; }
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  }
}, 45000);
