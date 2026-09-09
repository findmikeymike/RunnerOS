import { expect, test } from 'bun:test';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DurableJournal, type DurableRunSpec } from '../../shared/src/durable-execution/index.ts';
import { durableCredentialIdentity, DURABLE_RUNTIME_MANIFEST } from '../../shared/src/protocol/durable-execution.ts';
import type { DurableCheckpoint } from '../../shared/src/protocol/durable-execution.ts';

type Wire = { type: string; [key: string]: any };
function sidecar(root: string) {
  const child = spawn(process.execPath, [join(import.meta.dir, 'index.ts')], {
    cwd: root, env: { ...process.env, CRAFT_CONFIG_DIR: join(root, 'config'), CRAFT_PRODUCT_VARIANT: 'artist-os' }, stdio: ['pipe', 'pipe', 'pipe'],
  }) as ChildProcessWithoutNullStreams;
  const messages: Wire[] = [];
  let stderr = '';
  const listeners = new Set<() => void>();
  child.stderr.on('data', chunk => { stderr += chunk; });
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => { try { messages.push(JSON.parse(line)); for (const listener of listeners) listener(); } catch { /* unrelated startup log */ } });
  const exit = new Promise<void>(resolve => child.once('exit', () => resolve()));
  return {
    child, messages, exit,
    send(message: Wire) { child.stdin.write(JSON.stringify(message) + '\n'); },
    async wait(predicate: (message: Wire) => boolean): Promise<Wire> {
      const current = messages.find(predicate); if (current) return current;
      return new Promise((resolve, reject) => {
        const check = () => { const found = messages.find(predicate); if (found) { clearTimeout(timer); listeners.delete(check); resolve(found); } };
        const timer = setTimeout(() => { listeners.delete(check); reject(new Error(`IPC wait timed out: ${JSON.stringify(messages)} ${stderr}`)); }, 15000);
        listeners.add(check);
      });
    },
  };
}

for (const mode of ['success', 'reject-model', 'credential-mismatch', 'runtime-mismatch']) {
  const rejectModelCommit = mode === 'reject-model';
  test(`real Pi subprocess IPC ${mode}`, async () => {
    const root = mkdtempSync(join(tmpdir(), 'artist-pi-ipc-'));
    const inputPath = join(root, 'fixture.txt');
    writeFileSync(inputPath, 'NATIVE_IPC_READ_CONTENT');
    const requests: any[] = [];
    const authorizations: string[] = [];
    const server = createServer(async (request, response) => {
      let raw = ''; for await (const chunk of request) raw += chunk;
      authorizations.push(request.headers.authorization ?? '');
      const input = JSON.parse(raw); requests.push(input);
      const finished = input.messages.some((message: any) => message.role === 'tool');
      const delta = finished
        ? { role: 'assistant', content: 'IPC_READ_FINISHED' }
        : { role: 'assistant', content: null, tool_calls: [{ index: 0, id: 'ipc-read', type: 'function', function: { name: 'read', arguments: JSON.stringify({ path: inputPath }) } }] };
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      const chunk = (change: object, finish: string | null) => ({ id: 'chatcmpl-local', object: 'chat.completion.chunk', created: 1, model: 'durable-ipc-fixture', choices: [{ index: 0, delta: change, finish_reason: finish }] });
      response.write(`data: ${JSON.stringify(chunk(delta, null))}\n\n`);
      response.write(`data: ${JSON.stringify(chunk({}, finished ? 'stop' : 'tool_calls'))}\n\n`);
      response.end('data: [DONE]\n\n');
    });
    let child: ReturnType<typeof sidecar> | undefined;
    let journal: DurableJournal | undefined;
    try {
      await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
      const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
      const spec: DurableRunSpec = { credentialIdentity: await durableCredentialIdentity({provider:'custom-endpoint',credential:{type:'api_key',key:'local-only-fixture'}}), runtimeManifest: {...DURABLE_RUNTIME_MANIFEST}, engine: 'sqlite-v2-readonly-1', runId: randomUUID(), workspaceId: 'ipc-workspace', createdAt: Date.now(), allowedTools: ['read'], model: 'durable-ipc-fixture', maxOutputTokens: 256, commandId: randomUUID(), authority: { scope: 'authorized-local-fixture-read' }, context: { prompt: 'Read the fixture.' }, deadlineAt: Date.now() + 60000, maxModelAttempts: 3, costPolicy: { unit: 'verified-free', maxTotalUnits: 0, maxUnitsPerAttempt: 0 } };
      journal = new DurableJournal({ configRoot: root, key: randomBytes(32) });
      journal.admit(spec);
      const bridge = journal.bridge(journal.claim(spec.runId, spec.workspaceId));
      child = sidecar(root);
      child.send({ type: 'init', apiKey: mode === 'credential-mismatch' ? 'replacement-key' : 'local-only-fixture', model: spec.model, cwd: root, thinkingLevel: 'off', workspaceRootPath: root, workspaceId: spec.workspaceId, sessionId: 'ipc-session', sessionPath: join(root, 'session'), workingDirectory: root, plansFolderPath: join(root, 'plans'), baseUrl, customEndpoint: { api: 'openai-completions' }, customModels: [spec.model], durableExecution: mode === 'runtime-mismatch' ? { ...spec, runtimeManifest: { ...spec.runtimeManifest, piAi: 'changed' } } : spec });
      if (mode.endsWith('mismatch')) {
        const error = await child.wait(message => message.type === 'error');
        expect(error.message).toContain(mode === 'credential-mismatch' ? 'credential identity mismatch' : 'runtime-manifest-mismatch');
        expect(requests).toHaveLength(0);
        expect(child.messages.some(message => message.type === 'ready')).toBe(false);
        return;
      }
      await child.wait(message => message.type === 'ready');
      child.send({ type: 'prompt', id: 'prompt', message: 'Read the fixture.', systemPrompt: 'Read the supplied local fixture with the read tool, then report completion.' });
      const initialBoundary = await child.wait(message => message.type === 'durable_checkpoint_request' && message.checkpoint.kind === 'turn-boundary');
      expect(initialBoundary.checkpoint.turn).toBe(-1);
      child.send({ type: 'durable_checkpoint_response', requestId: initialBoundary.requestId, reply: await bridge.checkpoint(initialBoundary.checkpoint) });
      const first = await child.wait(message => message.type === 'durable_checkpoint_request' && message.checkpoint.kind === 'model-start');
      expect(first.checkpoint.kind).toBe('model-start');
      await new Promise(resolve => setTimeout(resolve, 40));
      expect(requests).toHaveLength(0);
      child.send({ type: 'durable_checkpoint_response', requestId: first.requestId, reply: await bridge.checkpoint(first.checkpoint) });
      const modelResult = await child.wait(message => message.type === 'durable_checkpoint_request' && message.checkpoint.kind === 'model-result');
      expect(requests).toHaveLength(1);
      expect(authorizations).toEqual(['Bearer local-only-fixture']);
      await new Promise(resolve => setTimeout(resolve, 40));
      expect(child.messages.filter(message => message.type === 'pre_tool_use_request')).toHaveLength(0);
      if (rejectModelCommit) {
        child.send({ type: 'durable_checkpoint_response', requestId: modelResult.requestId, error: 'injected journal rejection' });
        const failure = await child.wait(message => message.type === 'error');
        expect(failure.message).toContain('injected journal rejection');
        await child.wait(message => message.type === 'event' && message.event.type === 'agent_settled');
        expect(requests).toHaveLength(1);
        expect(child.messages.filter(message => message.type === 'pre_tool_use_request')).toHaveLength(0);
        expect(child.messages.filter(message => message.type === 'durable_checkpoint_request' && message.checkpoint.kind === 'complete')).toHaveLength(0);
        await bridge.fail('injected journal rejection');
        expect(journal.get(spec.runId, spec.workspaceId).status).toBe('failed');
      } else {
        child.send({ type: 'durable_checkpoint_response', requestId: modelResult.requestId, reply: await bridge.checkpoint(modelResult.checkpoint) });
        const handled = new Set([initialBoundary.requestId, first.requestId, modelResult.requestId]);
        let complete = false;
        while (!complete) {
          const item = await child.wait(message => (message.type === 'durable_checkpoint_request' || message.type === 'pre_tool_use_request' || message.type === 'error') && !handled.has(message.requestId));
          if (item.type === 'error') throw new Error(item.message);
          handled.add(item.requestId);
          if (item.type === 'pre_tool_use_request') {
            expect(item.toolName).toBe('Read');
            expect(item.input.path).toBe(inputPath);
            child.send({ type: 'pre_tool_use_response', requestId: item.requestId, action: 'allow' });
          } else {
            const checkpoint = item.checkpoint as DurableCheckpoint;
            if (checkpoint.kind === 'tool-result') expect(JSON.stringify(checkpoint.result)).toContain('NATIVE_IPC_READ_CONTENT');
            const reply = await bridge.checkpoint(checkpoint);
            child.send({ type: 'durable_checkpoint_response', requestId: item.requestId, reply });
            complete = checkpoint.kind === 'complete';
          }
        }
        await child.wait(message => message.type === 'event' && message.event.type === 'agent_settled');
        expect(journal.get(spec.runId, spec.workspaceId).status).toBe('succeeded');
        expect(requests).toHaveLength(2);
        expect(JSON.stringify(requests[1])).toContain('NATIVE_IPC_READ_CONTENT');
        expect(child.messages.filter(message => message.type === 'tool_execute_request')).toHaveLength(0);
        expect(existsSync(join(root, 'session', '.pi-sessions'))).toBe(false);
      }
    } finally {
      if (child) { child.child.kill('SIGKILL'); await child.exit; }
      journal?.close(); server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
      rmSync(root, { recursive: true, force: true });
    }
  }, 30000);
}
