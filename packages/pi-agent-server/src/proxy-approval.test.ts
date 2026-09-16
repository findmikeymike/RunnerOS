import { expect, test } from 'bun:test';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

for (const mode of ['allow', 'block', 'modify'] as const) {
  test(`registered proxy authorizes once: ${mode}`, async () => {
    const root = mkdtempSync(join(tmpdir(), 'artist-proxy-approval-'));
    const toolName = 'mcp__session__create_agent';
    const server = createServer(async (request, response) => {
      let raw = ''; for await (const chunk of request) raw += chunk;
      const input = JSON.parse(raw);
      const finished = input.messages.some((message: any) => message.role === 'tool');
      const delta = finished ? { role: 'assistant', content: 'Done' }
        : { role: 'assistant', content: null, tool_calls: [{ index: 0, id: 'proxy-call', type: 'function', function: { name: toolName, arguments: JSON.stringify({ slug: 'original', _intent: 'Create fixture' }) } }] };
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      const chunk = (change: object, finish: string | null) => ({ id: 'local', object: 'chat.completion.chunk', created: 1, model: 'proxy-fixture', choices: [{ index: 0, delta: change, finish_reason: finish }] });
      response.write(`data: ${JSON.stringify(chunk(delta, null))}\n\n`);
      response.write(`data: ${JSON.stringify(chunk({}, finished ? 'stop' : 'tool_calls'))}\n\n`);
      response.end('data: [DONE]\n\n');
    });
    let child: ReturnType<typeof sidecar> | undefined;
    try {
      await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
      const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
      child = sidecar(root);
      child.send({ type: 'init', apiKey: 'local-fixture', model: 'proxy-fixture', cwd: root, thinkingLevel: 'off', workspaceRootPath: root, workspaceId: 'fixture', sessionId: 'proxy-session', sessionPath: join(root, 'session'), workingDirectory: root, plansFolderPath: join(root, 'plans'), baseUrl, customEndpoint: { api: 'openai-completions' }, customModels: ['proxy-fixture'] });
      await child.wait(message => message.type === 'ready');
      child.send({ type: 'register_tools', tools: [{ name: toolName, description: 'Create an agent', inputSchema: { type: 'object', properties: { slug: { type: 'string' } }, required: ['slug'] } }] });
      child.send({ type: 'prompt', id: 'prompt', message: 'Create fixture', systemPrompt: 'Use the requested tool once.' });
      const handled = new Set<string>();
      while (true) {
        const item = await child.wait(message => message.type === 'error' || (message.type === 'event' && message.event.type === 'agent_settled') || ((message.type === 'pre_tool_use_request' || message.type === 'tool_execute_request') && !handled.has(message.requestId)));
        if (item.type === 'error') throw new Error(item.message);
        if (item.type === 'event') break;
        handled.add(item.requestId);
        if (item.type === 'pre_tool_use_request') {
          expect(item.toolName).toBe(toolName);
          child.send({ type: 'pre_tool_use_response', requestId: item.requestId, action: mode, ...(mode === 'modify' ? { input: { slug: 'transformed', _intent: 'Must be stripped' } } : {}), reason: 'Denied fixture' });
        } else {
          expect(mode).not.toBe('block');
          expect(item.args).toEqual({ slug: mode === 'modify' ? 'transformed' : 'original' });
          child.send({ type: 'tool_execute_response', requestId: item.requestId, result: { content: 'Saved fixture', isError: false } });
        }
      }
      expect(child.messages.filter(message => message.type === 'pre_tool_use_request')).toHaveLength(1);
      expect(child.messages.filter(message => message.type === 'tool_execute_request')).toHaveLength(mode === 'block' ? 0 : 1);
    } finally {
      if (child) { child.child.kill('SIGKILL'); await child.exit; }
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
      rmSync(root, { recursive: true, force: true });
    }
  }, 30000);
}
