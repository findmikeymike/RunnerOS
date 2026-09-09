/** Real SDK/native read control fixture; no app, user accounts, or paid requests. */
import { Agent } from '@earendil-works/pi-agent-core';
import { createAssistantMessageEventStream, type AssistantMessage, type Model } from '@earendil-works/pi-ai';
import { createReadTool } from '@earendil-works/pi-coding-agent';
import { DurableJournal } from '../../../../../shared/src/durable-execution/index.ts';
import { DurableTurnController } from '../../../../../pi-agent-server/src/durable-turn-controller.ts';
import { readFileSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';

const [root, endpoint, barrier = '', holdError = ''] = process.argv.slice(2) as [string, string, string, string];
const journal = new DurableJournal({ configRoot: root, key: Buffer.from(process.env.DURABLE_TEST_KEY!, 'hex') });
const spec = JSON.parse(readFileSync(join(root, 'spec.json'), 'utf8'));
async function post(path: string, body: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = request(endpoint + path, { method: 'POST', headers: { 'content-type': 'application/json' } }, response => {
      let raw = ''; response.on('data', chunk => { raw += chunk; });
      response.on('end', () => { try { if (response.statusCode !== 200) throw new Error(raw); resolve(JSON.parse(raw)); } catch (error) { reject(error); } });
    });
    req.on('error', reject); req.end(JSON.stringify(body));
  });
}
let barrierUsed = false;
async function stopAt(name: string): Promise<void> {
  if (barrier !== name || barrierUsed) return;
  barrierUsed = true;
  console.log(JSON.stringify({ barrier: name }));
  await new Promise<void>(resolve => { process.stdin.once('data', () => { process.stdin.pause(); resolve(); }); process.stdin.resume(); });
}
async function run(): Promise<void> {
  journal.admit(spec);
  let claim;
  try { claim = journal.claim(spec.runId, spec.workspaceId); }
  catch (error) { console.log(JSON.stringify({ claimBlocked: String(error) })); return; }
  const bridge = journal.bridge(claim);
  const controller = new DurableTurnController(bridge.descriptor, async checkpoint => {
    if (checkpoint.kind === 'model-result' && checkpoint.turn === 0) await stopAt('before-model-result');
    if (checkpoint.kind === 'tool-result' && checkpoint.callId === 'read-first') await stopAt('before-tool-result');
    const reply = await bridge.checkpoint(checkpoint);
    if (checkpoint.kind === 'tool-result' && checkpoint.callId === 'read-first') await stopAt('after-tool-result');
    return reply;
  });
  const nativeRead = createReadTool(root);
  const tool = { ...nativeRead, execute: (id: string, args: any, signal?: AbortSignal, update?: any) => controller.tool(id, 'read', args, async () => {
    await post('/read', { id });
    return nativeRead.execute(id, args, signal, update);
  }) };
  const model: Model<'anthropic-messages'> = { id: spec.model, name: 'Control fixture', api: 'anthropic-messages', provider: 'anthropic', baseUrl: endpoint, reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 4096, maxTokens: 256 };
  const agent = new Agent({ initialState: { model, tools: [tool] }, streamFn: async (_model, context, options) => {
    if (options?.maxRetries !== 0 || options?.maxTokens !== spec.maxOutputTokens) throw new Error('Missing provider bounds');
    const message = await post('/model', { messages: context.messages }) as AssistantMessage;
    const stream = createAssistantMessageEventStream(); stream.push({ type: 'done', reason: message.stopReason as 'stop' | 'toolUse', message }); return stream;
  } });
  try {
    await controller.run(agent, 'Read first.txt and second.txt, then finish.', 'Use only the read tool.');
    console.log(JSON.stringify({ completed: journal.get(spec.runId, spec.workspaceId) }));
  } catch (error) {
    // Mirrors host best-effort failure marking; control state must win.
    try { await bridge.fail(String(error)); } catch { /* preserve control evidence */ }
    console.log(JSON.stringify({ blocked: String(error), state: journal.get(spec.runId, spec.workspaceId).status }));
    if (holdError) await new Promise<void>(() => { process.stdin.resume(); });
  } finally { journal.release(claim); }
}
try { await run(); } finally { journal.close(); }
