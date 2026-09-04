import { beforeEach, describe, expect, test } from 'bun:test';
import type { AgentEvent } from '@craft-agent/core/types';
import type { AgentBackend } from '../types.ts';
import { createModelFallbackBackend } from '../model-fallback-backend.ts';
import { modelCooldownRegistry } from '../../model-fallback.ts';

interface FakeBackend extends AgentBackend {
  prompts: string[];
  postInitCalls: number;
  destroyCalls: number;
  queryLlm: (request: { prompt: string; model?: string }) => Promise<{ text: string; model?: string }>;
}

function fakeBackend(events: AgentEvent[] | (() => AgentEvent[])): FakeBackend {
  const backend = {
    prompts: [] as string[],
    postInitCalls: 0,
    destroyCalls: 0,
    async *chat(message: string) {
      backend.prompts.push(message);
      for (const event of typeof events === 'function' ? events() : events) yield event;
    },
    async postInit() { backend.postInitCalls += 1; return { authInjected: true }; },
    async runMiniCompletion() { return 'ok'; },
    async queryLlm(request: { prompt: string; model?: string }) { return { text: request.prompt, model: request.model }; },
    destroy() { backend.destroyCalls += 1; },
    dispose() { backend.destroy(); },
    abort: async () => {},
    forceAbort: () => {},
    interruptForHandoff: () => {},
    redirect: () => false,
    isProcessing: () => false,
    getModel: () => 'model',
    setModel: () => {},
    getThinkingLevel: () => 'off' as const,
    setThinkingLevel: () => {},
    getPermissionMode: () => 'safe' as const,
    setPermissionMode: () => {},
    cyclePermissionMode: () => 'safe' as const,
    getSessionId: () => null,
    supportsBranching: false,
    setSourceServers: () => {},
    getActiveSourceSlugs: () => [],
    getCurrentTurnUserMessage: () => null,
    setPendingSourceActivationRestart: () => {},
    getAllSources: () => [],
    setAllSources: () => {},
    markSourceUnseen: () => {},
    getSummarizeCallback: () => async () => null,
    updateWorkingDirectory: () => {},
    updateSdkCwd: () => {},
    setWorkspace: () => {},
    setSessionId: () => {},
    getSourceManager: () => ({}) as never,
    generateTitle: async () => null,
    regenerateTitle: async () => null,
    respondToPermission: () => {},
    onPermissionRequest: null,
    onPlanSubmitted: null,
    onAuthRequest: null,
    onSourceChange: null,
    onPermissionModeChange: null,
    onDebug: null,
    onSourceActivationRequest: null,
    onBackendAuthRequired: null,
    onSpawnSession: null,
    onOutputsUpdated: null,
    applyBridgeUpdates: async () => {},
    ensureBranchReady: async () => {},
  } as FakeBackend;
  return backend;
}

async function collect(backend: AgentBackend, message = 'hello'): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of backend.chat(message)) events.push(event);
  return events;
}

describe('model fallback backend', () => {
  beforeEach(() => modelCooldownRegistry.clearAll());

  test('passes through primary streaming unchanged when no usable fallback exists', async () => {
    const primary = fakeBackend([
      { type: 'text_delta', text: 'live' },
      { type: 'text_complete', text: 'live' },
      { type: 'complete' },
    ]);
    const backend = createModelFallbackBackend({
      primary,
      primaryConnectionSlug: 'primary',
      primaryModel: 'model-a',
      resolveCandidates: async () => [],
    });

    expect(await collect(backend)).toEqual([
      { type: 'text_delta', text: 'live' },
      { type: 'text_complete', text: 'live' },
      { type: 'complete' },
    ]);
  });

  test('discards a failed partial response and yields only the successful fallback', async () => {
    const primary = fakeBackend([
      { type: 'text_delta', text: 'partial' },
      { type: 'typed_error', error: { code: 'rate_limited', title: 'Rate', message: 'wait', actions: [], canRetry: true } },
      { type: 'complete' },
    ]);
    const fallback = fakeBackend([
      { type: 'text_delta', text: 'answer' },
      { type: 'text_complete', text: 'answer' },
      { type: 'complete' },
    ]);
    const switches: string[] = [];
    const backend = createModelFallbackBackend({
      primary,
      primaryConnectionSlug: 'primary',
      primaryModel: 'model-a',
      resolveCandidates: async () => [{ connectionSlug: 'fallback', model: 'model-b', chainIndex: 1, create: () => fallback }],
      onSwitch: ({ to }) => switches.push(to.connectionSlug),
    });

    expect(await collect(backend)).toEqual([
      { type: 'text_delta', text: 'answer' },
      { type: 'text_complete', text: 'answer' },
      { type: 'complete' },
    ]);
    expect(switches).toEqual(['fallback']);
    expect(fallback.postInitCalls).toBe(1);
    expect(fallback.destroyCalls).toBe(1);
  });

  test('retains completed write receipts and tells the fallback not to replay them', async () => {
    const primary = fakeBackend([
      { type: 'text_delta', text: 'discard me' },
      { type: 'tool_start', toolName: 'Edit', toolUseId: 'write-1', input: { file_path: '/tmp/a' } },
      { type: 'tool_result', toolName: 'Edit', toolUseId: 'write-1', result: 'updated', isError: false },
      { type: 'typed_error', error: { code: 'service_error', title: 'Down', message: 'down', actions: [], canRetry: true } },
      { type: 'complete' },
    ]);
    const fallback = fakeBackend([{ type: 'text_complete', text: 'continued' }, { type: 'complete' }]);
    const backend = createModelFallbackBackend({
      primary,
      primaryConnectionSlug: 'primary',
      primaryModel: 'model-a',
      resolveCandidates: async () => [{ connectionSlug: 'fallback', model: 'model-b', chainIndex: 1, create: () => fallback }],
    });

    const events = await collect(backend, 'do it');
    expect(events.map(event => event.type)).toEqual(['tool_start', 'tool_result', 'text_complete', 'complete']);
    expect(fallback.prompts[0]).toContain('Do not repeat, retry, or recreate these operations');
    expect(fallback.prompts[0]).toContain('Edit: updated');
    expect(fallback.prompts[0]).not.toContain('discard me');
  });

  test('seeds a fresh fallback with recent conversation context', async () => {
    const primary = fakeBackend([
      { type: 'typed_error', error: { code: 'service_error', title: 'Down', message: 'down', actions: [], canRetry: true } },
      { type: 'complete' },
    ]);
    const fallback = fakeBackend([{ type: 'text_complete', text: 'continued' }, { type: 'complete' }]);
    const backend = createModelFallbackBackend({
      primary,
      primaryConnectionSlug: 'primary',
      primaryModel: 'model-a',
      getRecoveryMessages: () => [
        { type: 'user', content: 'Remember the red release plan.' },
        { type: 'assistant', content: 'I will keep it red.' },
        { type: 'user', content: 'continue' },
      ],
      resolveCandidates: async () => [{ connectionSlug: 'fallback', model: 'model-b', chainIndex: 1, create: () => fallback }],
    });

    await collect(backend, 'continue');
    expect(fallback.prompts[0]).toContain('Remember the red release plan.');
    expect(fallback.prompts[0]).toContain('I will keep it red.');
    expect(fallback.prompts[0]?.match(/"content":"continue"/g)).toBeNull();
  });

  test('propagates user aborts without invoking fallback', async () => {
    const primary = fakeBackend([]);
    primary.chat = async function* () {
      const error = new Error('Request was aborted.');
      error.name = 'AbortError';
      throw error;
    };
    let created = 0;
    const backend = createModelFallbackBackend({
      primary,
      primaryConnectionSlug: 'primary',
      primaryModel: 'model-a',
      resolveCandidates: async () => [{ connectionSlug: 'fallback', model: 'model-b', chainIndex: 1, create: () => { created += 1; return fakeBackend([]); } }],
    });

    expect(collect(backend)).rejects.toThrow('aborted');
    expect(created).toBe(0);
  });

  test('falls through candidate construction failures and empty responses', async () => {
    const primary = fakeBackend([{ type: 'complete' }]);
    const final = fakeBackend([{ type: 'text_complete', text: 'third works' }, { type: 'complete' }]);
    const backend = createModelFallbackBackend({
      primary,
      primaryConnectionSlug: 'primary',
      primaryModel: 'model-a',
      resolveCandidates: async () => [
        { connectionSlug: 'fallback-1', model: 'model-b', chainIndex: 1, create: () => { throw new Error('503 service unavailable'); } },
        { connectionSlug: 'fallback-2', model: 'model-c', chainIndex: 2, create: () => final },
      ],
    });

    expect((await collect(backend))[0]).toEqual({ type: 'text_complete', text: 'third works' });
  });

  test('skips a known image-incompatible fallback and records the reason', async () => {
    const primary = fakeBackend([
      { type: 'typed_error', error: { code: 'service_error', title: 'Down', message: 'down', actions: [], canRetry: true } },
    ]);
    let incompatibleCreated = 0;
    const compatible = fakeBackend([{ type: 'text_complete', text: 'vision answer' }]);
    const attempts: Array<{ connectionSlug: string; errorCode?: string }> = [];
    const backend = createModelFallbackBackend({
      primary,
      primaryConnectionSlug: 'primary',
      primaryModel: 'model-a',
      resolveCandidates: async () => [
        { connectionSlug: 'text-only', model: 'model-b', chainIndex: 1, supportsImages: false, create: () => { incompatibleCreated += 1; return fakeBackend([]); } },
        { connectionSlug: 'vision', model: 'model-c', chainIndex: 2, supportsImages: true, create: () => compatible },
      ],
      onAttempt: attempt => attempts.push(attempt),
    });

    const events: AgentEvent[] = [];
    for await (const event of backend.chat('inspect', [{ type: 'image', path: '/tmp/a.png', name: 'a.png', mimeType: 'image/png', size: 1 }])) events.push(event);
    expect(events[0]).toEqual({ type: 'text_complete', text: 'vision answer' });
    expect(incompatibleCreated).toBe(0);
    expect(attempts).toContainEqual(expect.objectContaining({ connectionSlug: 'text-only', errorCode: 'unsupported_input' }));
  });

  test('stops immediately for a non-fallback error', async () => {
    const primary = fakeBackend([
      { type: 'typed_error', error: { code: 'invalid_request', title: 'Bad', message: 'bad', actions: [], canRetry: false } },
      { type: 'complete' },
    ]);
    let created = 0;
    const backend = createModelFallbackBackend({
      primary,
      primaryConnectionSlug: 'primary',
      primaryModel: 'model-a',
      resolveCandidates: async () => [{ connectionSlug: 'fallback', model: 'model-b', chainIndex: 1, create: () => { created += 1; return fakeBackend([]); } }],
    });

    expect((await collect(backend))[0]?.type).toBe('typed_error');
    expect(created).toBe(0);
  });

  test('uses only one fallback for an unknown error', async () => {
    const primary = fakeBackend([{ type: 'error', message: 'mystery one' }, { type: 'complete' }]);
    const fallbackOne = fakeBackend([{ type: 'error', message: 'mystery two' }, { type: 'complete' }]);
    let fallbackTwoCreated = 0;
    const backend = createModelFallbackBackend({
      primary,
      primaryConnectionSlug: 'primary',
      primaryModel: 'model-a',
      resolveCandidates: async () => [
        { connectionSlug: 'fallback-1', model: 'model-b', chainIndex: 1, create: () => fallbackOne },
        { connectionSlug: 'fallback-2', model: 'model-c', chainIndex: 2, create: () => { fallbackTwoCreated += 1; return fakeBackend([]); } },
      ],
    });

    const events = await collect(backend);
    expect(events).toContainEqual(expect.objectContaining({
      type: 'typed_error',
      error: expect.objectContaining({ message: expect.stringContaining('Could not reach a working model') }),
    }));
    expect(fallbackTwoCreated).toBe(0);
  });

  test('exhaustion names every attempted model and reason', async () => {
    const primary = fakeBackend([
      { type: 'typed_error', error: { code: 'rate_limited', title: 'Rate', message: 'wait', actions: [], canRetry: true } },
    ]);
    const fallback = fakeBackend([
      { type: 'typed_error', error: { code: 'service_unavailable', title: 'Down', message: 'down', actions: [], canRetry: true } },
    ]);
    const backend = createModelFallbackBackend({
      primary,
      primaryConnectionSlug: 'primary',
      primaryModel: 'model-a',
      resolveCandidates: async () => [{ connectionSlug: 'fallback', model: 'model-b', chainIndex: 1, create: () => fallback }],
    });

    const event = (await collect(backend))[0];
    expect(event).toEqual(expect.objectContaining({
      type: 'typed_error',
      error: expect.objectContaining({
        message: expect.stringContaining('primary · model-a — rate limited'),
      }),
    }));
    if (event?.type === 'typed_error') expect(event.error.message).toContain('fallback · model-b — service unavailable');
    expect(modelCooldownRegistry.isCoolingDown('fallback', 'model-b')).toBe(true);
    expect(primary.prompts).toHaveLength(1);
    expect(fallback.prompts).toHaveLength(1);
    expect((await collect(backend))[0]).toEqual(expect.objectContaining({
      type: 'typed_error',
      error: expect.objectContaining({ title: 'Models temporarily unavailable' }),
    }));
    expect(primary.prompts).toHaveLength(1);
    expect(fallback.prompts).toHaveLength(1);
  });

  test('does not use a denied mini fallback candidate', async () => {
    const primary = fakeBackend([]);
    primary.runMiniCompletion = async () => { throw new Error('503 service unavailable'); };
    let deniedCreated = 0;
    const allowed = fakeBackend([]);
    allowed.runMiniCompletion = async () => 'allowed';
    const backend = createModelFallbackBackend({
      primary,
      primaryConnectionSlug: 'primary',
      primaryModel: 'model-a',
      resolveCandidates: async () => [
        { connectionSlug: 'denied', model: 'codex-mini-latest', chainIndex: 1, miniAllowed: false, create: () => { deniedCreated += 1; return fakeBackend([]); } },
        { connectionSlug: 'allowed', model: 'model-c', chainIndex: 2, miniAllowed: true, create: () => allowed },
      ],
    });

    expect(await backend.runMiniCompletion('title')).toBe('allowed');
    expect(deniedCreated).toBe(0);
  });

  test('skips a cooling primary and manual retry clears its cooldown', async () => {
    let primaryCalls = 0;
    const primary = fakeBackend(() => {
      primaryCalls += 1;
      return [{ type: 'text_complete', text: 'primary' }, { type: 'complete' }];
    });
    const fallback = fakeBackend([{ type: 'text_complete', text: 'fallback' }, { type: 'complete' }]);
    modelCooldownRegistry.markFailure({ connectionSlug: 'primary', model: 'model-a', reason: 'service_error' });
    const backend = createModelFallbackBackend({
      primary,
      primaryConnectionSlug: 'primary',
      primaryModel: 'model-a',
      resolveCandidates: async () => [{ connectionSlug: 'fallback', model: 'model-b', chainIndex: 1, create: () => fallback }],
    });

    expect((await collect(backend))[0]).toEqual({ type: 'text_complete', text: 'fallback' });
    expect(primaryCalls).toBe(0);
    const retried: AgentEvent[] = [];
    for await (const event of backend.chat('again', undefined, { isRetry: true })) retried.push(event);
    expect(retried[0]).toEqual({ type: 'text_complete', text: 'primary' });
    expect(primaryCalls).toBe(1);
  });

  test('falls back queryLlm through the same ordered chain', async () => {
    const primary = fakeBackend([]);
    primary.queryLlm = async () => { throw new Error('429 rate limit'); };
    const fallback = fakeBackend([]);
    fallback.queryLlm = async (request) => ({ text: `fallback:${request.prompt}`, model: request.model });
    const attempts: string[] = [];
    const backend = createModelFallbackBackend({
      primary,
      primaryConnectionSlug: 'primary',
      primaryModel: 'model-a',
      resolveCandidates: async () => [{ connectionSlug: 'fallback', model: 'model-b', chainIndex: 1, create: () => fallback }],
      onAttempt: (attempt, operation) => attempts.push(`${operation}:${attempt.connectionSlug}:${attempt.outcome}`),
    });

    const result = await (backend as AgentBackend & { queryLlm: FakeBackend['queryLlm'] }).queryLlm({ prompt: 'summarize' });
    expect(result).toEqual({ text: 'fallback:summarize', model: 'model-b' });
    expect(attempts).toEqual(['query:primary:failed', 'query:fallback:succeeded']);
  });
});
