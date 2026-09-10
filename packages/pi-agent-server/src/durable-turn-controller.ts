import piAgentCorePackage from '../../../node_modules/@earendil-works/pi-agent-core/package.json';
import piAiPackage from '../../../node_modules/@earendil-works/pi-ai/package.json';
import piCodingAgentPackage from '../../../node_modules/@earendil-works/pi-coding-agent/package.json';
import { DURABLE_RUNTIME_MANIFEST, isDurableWebReadUrls } from '../../shared/src/protocol/durable-execution.ts';
import type { Agent } from '@earendil-works/pi-agent-core';
import { createAssistantMessageEventStream, type AssistantMessage, type UserMessage } from '@earendil-works/pi-ai';
import type { DurableCheckpoint, DurableCheckpointReply, DurableExecutionDescriptor, DurableJson } from '../../shared/src/protocol/durable-execution.ts';

/** JSON round-trip deliberately excludes executable SDK tool callbacks. */
function json(value: unknown): DurableJson {
  return JSON.parse(JSON.stringify(value)) as DurableJson;
}
class DurableSkippedToolError extends Error {
  constructor() { super('Operation skipped because newer user instructions superseded it.'); }
}

export class DurableTurnController {
  private turn = -1;
  private failure: Error | undefined;
  private started = false;
  private calls = new Map<string, string>();
  private skippedCalls = new Set<string>();
  constructor(
    readonly descriptor: DurableExecutionDescriptor,
    private readonly checkpoint: (request: DurableCheckpoint) => Promise<DurableCheckpointReply>,
  ) {
    const actual = { piAgentCore: piAgentCorePackage.version, piAi: piAiPackage.version, piCodingAgent: piCodingAgentPackage.version, adapterRevision: DURABLE_RUNTIME_MANIFEST.adapterRevision };
    if (!descriptor.runtimeManifest || Object.entries(actual).some(([key, value]) => descriptor.runtimeManifest[key as keyof typeof actual] !== value)) throw new Error('durable-runtime-manifest-mismatch');
    if (!/^[a-f0-9]{64}$/.test(descriptor.credentialIdentity)) throw new Error('durable-credential-identity-required');
    if (descriptor.engine !== 'sqlite-v2-readonly-1' || !Number.isSafeInteger(descriptor.createdAt)
      || !Number.isSafeInteger(descriptor.maxOutputTokens) || descriptor.maxOutputTokens < 1
      || descriptor.allowedTools.some(name => !['read', 'grep', 'find', 'ls', 'web_fetch'].includes(name))
      || (descriptor.webReadRedirects !== undefined && (typeof descriptor.webReadRedirects !== 'boolean' || descriptor.webReadUrls === undefined))
      || (descriptor.allowedTools.includes('web_fetch') ? !isDurableWebReadUrls(descriptor.webReadUrls) : descriptor.webReadUrls !== undefined)) {
      throw new Error('Invalid durable execution descriptor');
    }
  }
  fail(error: unknown): never {
    this.failure ??= error instanceof Error ? error : new Error(String(error));
    throw this.failure;
  }
  assertHealthy(): void { if (this.failure) throw this.failure; }
  private async record(request: DurableCheckpoint): Promise<DurableCheckpointReply> {
    this.assertHealthy();
    try { return await this.checkpoint(request); } catch (error) { return this.fail(error); }
  }
  /** Non-authorizing check before permission work. Actual normalized dispatch still needs tool-start. */
  async disposition(callId: string, name: string): Promise<void> {
    this.assertHealthy();
    if (!this.descriptor.allowedTools.includes(name as 'read') || this.calls.get(callId) !== name) this.fail(new Error(`Uncertified durable tool: ${name}`));
    const reply = await this.record({ kind: 'tool-disposition', turn: this.turn, callId, tool: name });
    if (reply.skipped) { this.skippedCalls.add(callId); throw new DurableSkippedToolError(); }
  }
  async tool<T>(callId: string, name: string, input: unknown, execute: () => Promise<T>): Promise<T> {
    this.assertHealthy();
    if (!this.descriptor.allowedTools.includes(name as 'read') || this.calls.get(callId) !== name) {
      return this.fail(new Error(`Uncertified durable tool: ${name}`));
    }
    try {
      const reply = await this.record({ kind: 'tool-start', turn: this.turn, callId, tool: name, input: json(input) });
      if (reply.skipped) { this.skippedCalls.add(callId); throw new DurableSkippedToolError(); }
      const result = reply.cached !== undefined ? reply.cached as T : await execute();
      const value = result as { content?: unknown; details?: { isError?: boolean }; isError?: boolean };
      if (!value || !Array.isArray(value.content) || value.isError || value.details?.isError) {
        throw new Error(`Durable tool failed: ${name}`);
      }
      if (reply.cached === undefined) await this.record({ kind: 'tool-result', turn: this.turn, callId, result: json(result) });
      return result;
    } catch (error) { if (error instanceof DurableSkippedToolError) throw error; return this.fail(error); }
  }
  private async boundary(turn: number): Promise<UserMessage[]> {
    const reply = await this.record({ kind: 'turn-boundary', turn });
    let last = 0;
    return (reply.steering ?? []).map(entry => {
      if (!Number.isSafeInteger(entry.sequence) || entry.sequence <= last || typeof entry.text !== 'string' || !Number.isSafeInteger(this.descriptor.createdAt + entry.sequence)) return this.fail(new Error('Invalid durable steering batch'));
      last = entry.sequence;
      return { role: 'user', content: [{ type: 'text', text: entry.text }], timestamp: this.descriptor.createdAt + entry.sequence };
    });
  }
  async run(agent: Agent, message: string, systemPrompt: string): Promise<void> {
    if (this.started) throw new Error('Durable execution accepts exactly one frozen prompt');
    this.started = true;
    this.assertHealthy();
    const originalStream = agent.streamFunction;
    const originalSteeringMode = agent.steeringMode;
    agent.clearAllQueues();
    agent.steeringMode = 'all';
    agent.toolExecution = 'sequential';
    agent.state.messages = [];
    agent.state.systemPrompt = systemPrompt;
    agent.streamFunction = async (model, context, options) => {
      this.assertHealthy();
      this.turn++;
      const messages = context.messages.map(item => {
        if (item.role !== 'toolResult') return item;
        const { timestamp: _timestamp, ...stable } = item;
        return stable;
      });
      const reply = await this.record({ kind: 'model-start', turn: this.turn,
        context: json({ runtimeManifest: this.descriptor.runtimeManifest, credentialIdentity: this.descriptor.credentialIdentity, model, systemPrompt: context.systemPrompt, messages, tools: context.tools,
          maxOutputTokens: this.descriptor.maxOutputTokens, thinkingLevel: agent.state.thinkingLevel }) });
      if (reply.cached !== undefined) {
        const cached = reply.cached as unknown as AssistantMessage;
        if (cached.role !== 'assistant' || !Array.isArray(cached.content)) return this.fail(new Error('Invalid cached model response'));
        const stream = createAssistantMessageEventStream();
        stream.push({ type: 'done', reason: cached.stopReason as 'stop' | 'length' | 'toolUse', message: cached });
        return stream;
      }
      return originalStream(model, context, { ...options, maxRetries: 0, maxTokens: this.descriptor.maxOutputTokens });
    };
    const unsubscribe = agent.subscribe(async event => {
      this.assertHealthy();
      if (event.type === 'message_end' && event.message.role === 'assistant') {
        const message = event.message;
        if (!['stop', 'toolUse'].includes(message.stopReason)) return this.fail(new Error(message.errorMessage || `Durable model stopped: ${message.stopReason}`));
        this.calls.clear();
        this.skippedCalls.clear();
        for (const item of message.content) {
          if (item.type !== 'toolCall') continue;
          if (!this.descriptor.allowedTools.includes(item.name as 'read') || this.calls.has(item.id)) {
            return this.fail(new Error(`Unsupported or duplicate durable tool call: ${item.name}`));
          }
          this.calls.set(item.id, item.name);
        }
        await this.record({ kind: 'model-result', turn: this.turn, message: json(message) });
      }
      if (event.type === 'tool_execution_end' && event.isError && !this.skippedCalls.has(event.toolCallId)) this.fail(new Error(`SDK tool failed: ${event.toolName}`));
      if (event.type === 'turn_end') for (const update of await this.boundary(this.turn)) agent.steer(update);
    });
    try {
      const initialUpdates = await this.boundary(-1);
      await agent.prompt([{ role: 'user', content: [{ type: 'text', text: message }], timestamp: this.descriptor.createdAt }, ...initialUpdates]);
      this.assertHealthy();
      const final = agent.state.messages.at(-1);
      if (!final || final.role !== 'assistant' || final.stopReason !== 'stop') this.fail(new Error('Durable execution did not reach a successful final response'));
      await this.record({ kind: 'complete' });
    } catch (error) { this.fail(error); }
    finally { unsubscribe(); agent.streamFunction = originalStream; agent.clearAllQueues(); agent.steeringMode = originalSteeringMode; }
  }
}
