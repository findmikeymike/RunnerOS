import { describe, it, expect } from 'bun:test';
import type { SessionToolContext } from '../context.ts';
import {
  handleForgetMemory,
  handleRecallMemory,
  handleRecallSession,
  handleSaveMemory,
  handleUpdateMemory,
  type ForgetMemoryToolInput,
  type MemoryMutationResult,
  type RecallMemoryResult,
  type RecallMemoryToolInput,
  type RecallSessionResult,
  type RecallSessionToolInput,
  type SaveMemoryToolInput,
  type UpdateMemoryToolInput,
} from './memory.ts';

function makeCtx(opts?: {
  saveMemory?: (input: SaveMemoryToolInput) => Promise<MemoryMutationResult>;
  updateMemory?: (input: UpdateMemoryToolInput) => Promise<MemoryMutationResult>;
  forgetMemory?: (input: ForgetMemoryToolInput) => Promise<MemoryMutationResult>;
  recallMemory?: (input: RecallMemoryToolInput) => Promise<RecallMemoryResult>;
  recallSession?: (input: RecallSessionToolInput) => Promise<RecallSessionResult>;
}): SessionToolContext {
  const ctx: Partial<SessionToolContext> = {
    sessionId: 't',
    workspacePath: '/tmp',
    plansFolderPath: '/tmp/plans',
    callbacks: { onPlanSubmitted: () => {}, onAuthRequest: () => {} },
    fs: {
      exists: () => false,
      readFile: () => '',
      readFileBuffer: () => Buffer.from(''),
      writeFile: () => {},
      isDirectory: () => false,
      readdir: () => [],
      stat: () => ({ size: 0, isDirectory: () => false }),
    },
    loadSourceConfig: () => null,
    get sourcesPath() { return '/tmp/sources'; },
    get skillsPath() { return '/tmp/skills'; },
  };
  if (opts?.saveMemory) ctx.saveMemory = opts.saveMemory;
  if (opts?.updateMemory) ctx.updateMemory = opts.updateMemory;
  if (opts?.forgetMemory) ctx.forgetMemory = opts.forgetMemory;
  if (opts?.recallMemory) ctx.recallMemory = opts.recallMemory;
  if (opts?.recallSession) ctx.recallSession = opts.recallSession;
  return ctx as SessionToolContext;
}

describe('memory handlers', () => {
  it('save_memory errors when context capability is missing', async () => {
    const result = await handleSaveMemory(makeCtx(), {
      name: 'prefers-focused-updates',
      type: 'user',
      content: 'The user prefers concise implementation updates.',
    });
    expect(result.isError).toBe(true);
    expect((result.content[0] as any).text).toContain('not available in this context');
  });

  it('save_memory validates name, type, content, and expires before calling capability', async () => {
    let called = false;
    const ctx = makeCtx({
      saveMemory: async () => {
        called = true;
        return { ok: true };
      },
    });

    const badName = await handleSaveMemory(ctx, {
      name: '   ',
      type: 'user',
      content: 'x',
    });
    const badType = await handleSaveMemory(ctx, {
      name: 'valid-name',
      type: 'invalid' as never,
      content: 'x',
    });
    const emptyContent = await handleSaveMemory(ctx, {
      name: 'valid-name',
      type: 'user',
      content: '   ',
    });
    const badExpires = await handleSaveMemory(ctx, {
      name: 'valid-name',
      type: 'user',
      content: 'x',
      expires: 'tomorrow',
    });

    expect(badName.isError).toBe(true);
    expect(badType.isError).toBe(true);
    expect(emptyContent.isError).toBe(true);
    expect(badExpires.isError).toBe(true);
    expect(called).toBe(false);
  });

  it('save_memory defaults scope to agent and returns structured success payload', async () => {
    let captured: SaveMemoryToolInput | undefined;
    const ctx = makeCtx({
      saveMemory: async (input) => {
        captured = input;
        return { ok: true, scope: input.scope, name: `${input.name}-2`, file: '/agents/helper/MEMORY.md' };
      },
    });

    const result = await handleSaveMemory(ctx, {
      name: 'prefers-focused-updates',
      type: 'feedback',
      content: 'The user prefers concise implementation updates.',
    });

    expect(result.isError).toBe(false);
    expect(captured?.scope).toBe('agent');
    expect(result.structuredContent).toEqual({
      ok: true,
      scope: 'agent',
      name: 'prefers-focused-updates-2',
      file: '/agents/helper/MEMORY.md',
    });
    expect((result.content[0] as any).text).toContain('Saved agent memory');
  });

  it('save_memory accepts UI-created free-form names without adding force', async () => {
    let captured: SaveMemoryToolInput | undefined;
    const ctx = makeCtx({
      saveMemory: async (input) => {
        captured = input;
        return { ok: true, scope: input.scope, name: input.name };
      },
    });

    const result = await handleSaveMemory(ctx, {
      scope: 'user',
      name: 'Preferred writing style',
      type: 'user',
      content: 'Use direct language.',
    });

    expect(result.isError).toBe(false);
    expect(captured).toEqual({
      scope: 'user',
      name: 'Preferred writing style',
      type: 'user',
      content: 'Use direct language.',
    });
    expect(captured).not.toHaveProperty('force');
  });

  it('update_memory requires at least content or expires', async () => {
    let called = false;
    const ctx = makeCtx({
      updateMemory: async () => {
        called = true;
        return { ok: true };
      },
    });

    const result = await handleUpdateMemory(ctx, { name: 'prefers-focused-updates' });

    expect(result.isError).toBe(true);
    expect((result.content[0] as any).text).toContain('Provide content');
    expect(called).toBe(false);
  });

  it('update_memory forwards expires null to clear expiration', async () => {
    let captured: UpdateMemoryToolInput | undefined;
    const ctx = makeCtx({
      updateMemory: async (input) => {
        captured = input;
        return { ok: true, scope: input.scope, name: input.name };
      },
    });

    const result = await handleUpdateMemory(ctx, {
      scope: 'user',
      name: 'timezone',
      expires: null,
    });

    expect(result.isError).toBe(false);
    expect(captured).toEqual({ scope: 'user', name: 'timezone', expires: null });
    expect(result.structuredContent).toEqual({
      ok: true,
      scope: 'user',
      name: 'timezone',
    });
  });

  it('update_memory and forget_memory accept exact UI-created free-form names', async () => {
    const calls: Array<UpdateMemoryToolInput | ForgetMemoryToolInput> = [];
    const ctx = makeCtx({
      updateMemory: async (input) => {
        calls.push(input);
        return { ok: true, scope: input.scope, name: input.name };
      },
      forgetMemory: async (input) => {
        calls.push(input);
        return { ok: true, scope: input.scope, name: input.name };
      },
    });

    const updated = await handleUpdateMemory(ctx, {
      name: 'Preferred writing style',
      content: 'Use terse implementation notes.',
    });
    const forgotten = await handleForgetMemory(ctx, {
      name: 'Preferred writing style',
    });

    expect(updated.isError).toBe(false);
    expect(forgotten.isError).toBe(false);
    expect(calls).toEqual([
      { scope: 'agent', name: 'Preferred writing style', content: 'Use terse implementation notes.' },
      { scope: 'agent', name: 'Preferred writing style' },
    ]);
  });

  it('forget_memory calls capability and surfaces backend errors', async () => {
    const ctx = makeCtx({
      forgetMemory: async (input) => ({
        ok: false,
        scope: input.scope,
        name: input.name,
        error: 'Memory entry "missing" was not found.',
      }),
    });

    const result = await handleForgetMemory(ctx, {
      scope: 'agent',
      name: 'missing',
    });

    expect(result.isError).toBe(true);
    expect((result.content[0] as any).text).toContain('not found');
  });

  it('forget_memory returns structured success payload', async () => {
    let captured: ForgetMemoryToolInput | undefined;
    const ctx = makeCtx({
      forgetMemory: async (input) => {
        captured = input;
        return { ok: true, scope: input.scope, name: input.name, file: '/USER.md' };
      },
    });

    const result = await handleForgetMemory(ctx, {
      scope: 'user',
      name: 'old-preference',
    });

    expect(result.isError).toBe(false);
    expect(captured).toEqual({ scope: 'user', name: 'old-preference' });
    expect(result.structuredContent).toEqual({
      ok: true,
      scope: 'user',
      name: 'old-preference',
      file: '/USER.md',
    });
  });

  it('recall_memory validates input before calling capability', async () => {
    let called = false;
    const ctx = makeCtx({
      recallMemory: async () => {
        called = true;
        return { ok: true, results: [] };
      },
    });

    const emptyQuery = await handleRecallMemory(ctx, { query: '   ' });
    const badScopes = await handleRecallMemory(ctx, { query: 'style', scopes: ['workspace' as never] });
    const badLimit = await handleRecallMemory(ctx, { query: 'style', limit: 99 });

    expect(emptyQuery.isError).toBe(true);
    expect(badScopes.isError).toBe(true);
    expect(badLimit.isError).toBe(true);
    expect(called).toBe(false);
  });

  it('recall_memory returns matched memories as structured content', async () => {
    let captured: RecallMemoryToolInput | undefined;
    const ctx = makeCtx({
      recallMemory: async (input) => {
        captured = input;
        return {
          ok: true,
          query: input.query,
          results: [{
            scope: 'user',
            name: 'Preferred writing style',
            type: 'feedback',
            content: 'Use direct language.',
            score: 7,
            reason: 'Matched writing',
            excerpt: 'Use direct language.',
          }],
        };
      },
    });

    const result = await handleRecallMemory(ctx, {
      query: ' writing style ',
      scopes: ['user'],
      limit: 5,
    });

    expect(result.isError).toBe(false);
    expect(captured).toEqual({ query: 'writing style', scopes: ['user'], limit: 5, full: false });
    // Excerpt only by default — the whole body is withheld so a recall cannot
    // cost more prompt than the memory section it is meant to replace.
    expect(result.structuredContent).toEqual({
      ok: true,
      query: 'writing style',
      results: [{
        scope: 'user',
        name: 'Preferred writing style',
        type: 'feedback',
        score: 7,
        reason: 'Matched writing',
        excerpt: 'Use direct language.',
      }],
    });
    expect((result.content[0] as any).text).toContain('as excerpts');
    expect((result.content[0] as any).text).toContain('full: true');
  });

  it('recall_memory returns whole bodies only when full is requested', async () => {
    let captured: RecallMemoryToolInput | undefined;
    const ctx = makeCtx({
      recallMemory: async (input) => {
        captured = input;
        return {
          ok: true,
          query: input.query,
          results: [{
            scope: 'user',
            name: 'Preferred writing style',
            type: 'feedback',
            content: 'Use direct language, and never pad a sentence.',
            score: 7,
            reason: 'Matched writing',
            excerpt: 'Use direct language...',
          }],
        };
      },
    });

    const result = await handleRecallMemory(ctx, { query: 'writing style', full: true });

    expect(captured?.full).toBe(true);
    const entry = (result.structuredContent as any).results[0];
    expect(entry.content).toBe('Use direct language, and never pad a sentence.');
    expect(entry.excerpt).toBe('Use direct language...');
    expect((result.content[0] as any).text).not.toContain('as excerpts');
  });
});

describe('recall_session', () => {
  it('reports plainly when an agent has no history yet, rather than looking broken', async () => {
    const ctx = makeCtx({ recallSession: async () => ({ ok: true, results: [] }) });
    const result = await handleRecallSession(ctx, {});

    expect(result.isError).toBe(false);
    expect((result.content[0] as any).text).toContain('No past sessions recorded yet');
  });

  it('passes an empty query through so the agent gets its most recent sessions', async () => {
    let captured: RecallSessionToolInput | undefined;
    const ctx = makeCtx({
      recallSession: async (input) => {
        captured = input;
        return { ok: true, results: [{ sessionId: 's1', date: '2026-09-05', summary: 'Settled the release date.' }] };
      },
    });

    const result = await handleRecallSession(ctx, {});

    expect(captured).toEqual({ query: '', limit: undefined });
    expect((result.content[0] as any).text).toContain('most recent');
    expect((result.structuredContent as any).results[0].summary).toBe('Settled the release date.');
  });

  it('trims a query and reports it back', async () => {
    const ctx = makeCtx({
      recallSession: async (input) => ({
        ok: true,
        query: input.query,
        results: [{ sessionId: 's1', date: '2026-09-05', summary: 'Merch drop planning.' }],
      }),
    });

    const result = await handleRecallSession(ctx, { query: '  merch  ' });

    expect((result.structuredContent as any).query).toBe('merch');
    expect((result.content[0] as any).text).toContain('matching "merch"');
  });

  it('rejects a limit outside the supported range', async () => {
    const ctx = makeCtx({ recallSession: async () => ({ ok: true, results: [] }) });
    expect((await handleRecallSession(ctx, { limit: 0 })).isError).toBe(true);
    expect((await handleRecallSession(ctx, { limit: 99 })).isError).toBe(true);
  });

  it('surfaces a backend refusal instead of pretending there is no history', async () => {
    const ctx = makeCtx({
      recallSession: async () => ({ ok: false, error: 'Refusing to write: file could not be read.' }),
    });
    const result = await handleRecallSession(ctx, {});

    expect(result.isError).toBe(true);
    expect((result.content[0] as any).text).toContain('could not be read');
  });

  it('is unavailable rather than silently empty when the context does not provide it', async () => {
    const result = await handleRecallSession(makeCtx({}), {});
    expect(result.isError).toBe(true);
    expect((result.content[0] as any).text).toContain('not available');
  });
});
