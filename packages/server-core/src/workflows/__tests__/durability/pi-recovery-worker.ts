/** Real Pi SDK + production journal, disposable test data only. */
import { Agent } from '@earendil-works/pi-agent-core';
import { createAssistantMessageEventStream, type AssistantMessage, type Model } from '@earendil-works/pi-ai';
import { createReadTool } from '@earendil-works/pi-coding-agent';
import { DurableJournal } from '../../../../../shared/src/durable-execution/index.ts';
import { DurableTurnController } from '../../../../../pi-agent-server/src/durable-turn-controller.ts';
import { appendFileSync, readFileSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';

const [root, endpoint, barrier = ''] = process.argv.slice(2) as [string, string, string];
const journal = new DurableJournal({ configRoot: root, key: Buffer.from(process.env.DURABLE_TEST_KEY!, 'hex') });
const spec = JSON.parse(readFileSync(join(root, 'spec.json'), 'utf8'));
journal.admit(spec);
const claim = journal.claim(spec.runId, spec.workspaceId);
const bridge = journal.bridge(claim);
async function post(path: string, body: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = request(endpoint + path, { method: 'POST', headers: { 'content-type': 'application/json' } }, response => {
      let text = ''; response.on('data', chunk => text += chunk); response.on('end', () => {
        try { if (response.statusCode !== 200) throw new Error(text); resolve(JSON.parse(text)); } catch (error) { reject(error); }
      });
    });
    req.on('error', reject); req.end(JSON.stringify(body));
  });
}
async function stopAt(name: string): Promise<void> {
  if (barrier !== name) return;
  console.log(JSON.stringify({ barrier: name }));
  await new Promise(() => setInterval(() => {}, 1000));
}
const controller = new DurableTurnController(bridge.descriptor, async checkpoint => {
  if (checkpoint.kind === 'model-result') await stopAt('before-model-commit');
  const reply = await bridge.checkpoint(checkpoint);
  if (checkpoint.kind === 'model-result') await stopAt('after-model-commit');
  if (checkpoint.kind === 'tool-result') await stopAt('after-tool-commit');
  if (checkpoint.kind === 'complete') await stopAt('after-complete');
  return reply;
});
const nativeRead = createReadTool(root);
const tool = { ...nativeRead, execute: (id: string, args: any, signal?: AbortSignal, update?: any) =>
  controller.tool(id, 'read', args, async () => {
    await post('/read', { id });
    return nativeRead.execute(id, args, signal, update);
  }) };
const model: Model<'anthropic-messages'> = { id: spec.model, name: 'Local simulator', api: 'anthropic-messages', provider: 'anthropic', baseUrl: endpoint, reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 4096, maxTokens: 256 };
const agent = new Agent({ initialState: { model, tools: [tool] }, streamFn: async (_model, context, options) => {
  if (options?.maxRetries !== 0 || options?.maxTokens !== spec.maxOutputTokens) throw new Error('Missing durable provider bounds');
  const message = await post('/model', { messages: context.messages }) as AssistantMessage;
  const stream = createAssistantMessageEventStream();
  stream.push({ type: 'done', reason: message.stopReason as 'stop' | 'toolUse', message });
  return stream;
} });
try {
  await controller.run(agent, 'Read input.txt and return its text.', 'Only use the read tool.');
  appendFileSync(join(root, 'completed.jsonl'), JSON.stringify(journal.get(spec.runId, spec.workspaceId)) + '\n');
  journal.release(claim);
} finally { journal.close(); }
