import { describe, expect, test } from 'bun:test';
import { Agent, type AgentTool } from '@earendil-works/pi-agent-core';
import { createAssistantMessageEventStream, type AssistantMessage, type Model } from '@earendil-works/pi-ai';
import { Type } from '@sinclair/typebox';
import { DurableTurnController } from './durable-turn-controller.ts';
import { DURABLE_RUNTIME_MANIFEST } from '../../shared/src/protocol/durable-execution.ts';
import type { DurableCheckpoint, DurableCheckpointReply, DurableExecutionDescriptor } from '../../shared/src/protocol/durable-execution.ts';

const model: Model<'openai-completions'> = { id: 'fixture', name: 'Fixture', api: 'openai-completions', provider: 'fixture', baseUrl: 'https://invalid.invalid', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 4096, maxTokens: 128 };
const descriptor: DurableExecutionDescriptor = { credentialIdentity: 'a'.repeat(64), runtimeManifest: { ...DURABLE_RUNTIME_MANIFEST }, engine: 'sqlite-v2-readonly-1', runId: 'run', workspaceId: 'ws', createdAt: 100, allowedTools: ['read'], model: 'fixture', maxOutputTokens: 128 };
function message(tool = true): AssistantMessage {
  return { role: 'assistant', content: tool ? [{ type: 'toolCall', id: 'read-1', name: 'read', arguments: { path: '/fixture' } }] : [{ type: 'text', text: 'finished' }], api: model.api, provider: model.provider, model: model.id, stopReason: tool ? 'toolUse' : 'stop', timestamp: 200, usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
}
function fixture(checkpoint: (request: DurableCheckpoint) => Promise<DurableCheckpointReply>, execute = async () => ({ content: [{ type: 'text' as const, text: 'read-result' }], details: {} }), response = message(true)) {
  const controller = new DurableTurnController(descriptor, checkpoint);
  let requests = 0;
  const read: AgentTool = { name: 'read', label: 'Read', description: 'fixture read', parameters: Type.Object({ path: Type.String() }), execute: (id, input) => controller.tool(id, 'read', input, execute) };
  const agent = new Agent({ initialState: { model, tools: [read] }, streamFn: (_model, _context, options) => {
    expect(options?.maxRetries).toBe(0);
    expect(options?.maxTokens).toBe(128);
    const stream = createAssistantMessageEventStream();
    const msg = requests++ === 0 ? response : message(false);
    stream.push({ type: 'done', reason: msg.stopReason as 'stop', message: msg });
    return stream;
  } });
  return { controller, agent, requests: () => requests };
}

describe('durable Pi core SDK boundary', () => {
  test('rejects mismatched installed SDK or adapter manifest before invoking provider', () => {
    for (const key of Object.keys(DURABLE_RUNTIME_MANIFEST)) {
      expect(() => new DurableTurnController({ ...descriptor, runtimeManifest: { ...DURABLE_RUNTIME_MANIFEST, [key]: 'changed' } }, async () => ({}))).toThrow('durable-runtime-manifest-mismatch');
    }
  });
  test('awaits model and result acknowledgement before tools and next request', async () => {
    const order: string[] = [];
    const run = fixture(async event => { order.push(event.kind); await Promise.resolve(); return {}; }, async () => { order.push('effect'); return { content: [{ type: 'text', text: 'ok' }], details: {} }; });
    await run.controller.run(run.agent, 'frozen prompt', 'frozen system');
    expect(order).toEqual(['model-start', 'model-result', 'tool-start', 'effect', 'tool-result', 'model-start', 'model-result', 'complete']);
    expect(run.agent.state.messages[0]?.timestamp).toBe(100);
  });
  test('replays committed responses and reads through real SDK without provider or tool calls', async () => {
    const recorded = new Map<string, unknown>();
    const contexts: unknown[] = [];
    const bridge = async (event: DurableCheckpoint): Promise<DurableCheckpointReply> => {
      if (event.kind === 'model-start') { contexts.push(event.context); return { cached: recorded.get(`model-${event.turn}`) as never }; }
      if (event.kind === 'model-result') recorded.set(`model-${event.turn}`, event.message);
      if (event.kind === 'tool-start') return { cached: recorded.get(event.callId) as never };
      if (event.kind === 'tool-result') recorded.set(event.callId, event.result);
      return {};
    };
    const first = fixture(bridge);
    await first.controller.run(first.agent, 'frozen', 'system');
    let effects = 0;
    const second = fixture(bridge, async () => { effects++; throw new Error('must reuse'); });
    await second.controller.run(second.agent, 'frozen', 'system');
    expect(first.requests()).toBe(2);
    expect(second.requests()).toBe(0);
    expect(effects).toBe(0);
    expect(contexts.slice(0, 2)).toEqual(contexts.slice(2));
  });
  test('failed model commit blocks all reads and completion', async () => {
    let effects = 0;
    const kinds: string[] = [];
    const run = fixture(async event => { kinds.push(event.kind); if (event.kind === 'model-result') throw new Error('disk unavailable'); return {}; }, async () => { effects++; throw new Error('unexpected'); });
    await expect(run.controller.run(run.agent, 'frozen', 'system')).rejects.toThrow('disk unavailable');
    expect(effects).toBe(0);
    expect(kinds).not.toContain('complete');
  });
  test('failed result commit cannot be swallowed by SDK and trigger another request', async () => {
    const run = fixture(async event => { if (event.kind === 'tool-result') throw new Error('result commit failed'); return {}; });
    await expect(run.controller.run(run.agent, 'frozen', 'system')).rejects.toThrow('result commit failed');
    expect(run.requests()).toBe(1);
  });
  test('rejects unsupported calls before execution', async () => {
    const bad = message(true); (bad.content[0] as { name: string }).name = 'bash';
    const run = fixture(async () => ({}), undefined, bad);
    await expect(run.controller.run(run.agent, 'frozen', 'system')).rejects.toThrow('Unsupported');
    expect(run.requests()).toBe(1);
  });
});
