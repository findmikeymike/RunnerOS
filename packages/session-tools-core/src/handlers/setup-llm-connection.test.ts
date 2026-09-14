import { describe, expect, test } from 'bun:test';
import type { SessionToolContext } from '../context.ts';
import { handleSetupLlmConnection, setupLlmConnectionSchema, type SetupLlmConnectionInput } from './setup-llm-connection.ts';

describe('setup_llm_connection', () => {
  test('rejects credentials and arbitrary operations before invoking host', async () => {
    let called = false;
    const ctx = { setupLlmConnection: async () => { called = true; } } as unknown as SessionToolContext;
    for (const input of [{ action: 'open', apiKey: 'not-a-real-key' }, { action: 'delete', slug: 'my-model' }, { action: 'set-default', slug: 'my-model' }, { action: 'test' }]) {
      const result = await handleSetupLlmConnection(ctx, input as SetupLlmConnectionInput);
      expect(result.isError).toBe(true);
    }
    expect(called).toBe(false);
  });
  test('open reports user input pending rather than saved', async () => {
    let captured: unknown;
    const result = await handleSetupLlmConnection({ setupLlmConnection: async (input: unknown) => {
      captured = input;
      return { status: 'needs_user_input' };
    } } as unknown as SessionToolContext, { action: 'open', provider: 'chatgpt' });
    expect(captured).toEqual({ action: 'open', provider: 'chatgpt' });
    expect(result.isError).toBe(false);
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining('needs_user_input') });
  });
  test('requires explicit default scope and existing slug', () => {
    expect(setupLlmConnectionSchema.safeParse({ action: 'set-default', slug: 'saved', scope: 'workspace' }).success).toBe(true);
    expect(setupLlmConnectionSchema.safeParse({ action: 'set-default', scope: 'app', credential: 'secret' }).success).toBe(false);
  });
  test('unavailable host is an error', async () => {
    expect((await handleSetupLlmConnection({} as SessionToolContext, { action: 'list' })).isError).toBe(true);
  });
});
