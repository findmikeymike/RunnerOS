import { describe, expect, test } from 'bun:test';
import type { SessionToolContext } from '@craft-agent/session-tools-core';
import { createComposioSessionCallbacks } from './composio-session-callbacks.ts';
import { attachSessionSelfManagementBindings } from './session-self-management-bindings.ts';
import { mergeSessionScopedToolCallbacks, unregisterSessionScopedToolCallbacks } from './session-scoped-tool-callback-registry.ts';

describe('Composio host callbacks', () => {
  test('checks current role, scope, variant and global authority before any network operation', async () => {
    let actor = { agentSlug: 'concierge', scope: 'hq', variant: 'artist-os' };
    let allowed = true;
    const calls: unknown[] = [];
    const callbacks = createComposioSessionCallbacks({ actor: () => actor,
      authorize: () => { if (!allowed) throw new Error('Denied global access'); },
      service: { refresh: async () => { calls.push('refresh'); return { configured: true }; },
        execute: async (op, input) => { calls.push({ op, input }); return { ok: true }; } },
    });
    await callbacks.composioStatusFn!({});
    expect(calls).toEqual(['refresh']);
    for (const invalid of [
      { agentSlug: 'builder', scope: 'hq', variant: 'artist-os' },
      { agentSlug: 'concierge', scope: 'lab', variant: 'artist-os' },
      { agentSlug: 'concierge', scope: 'hq', variant: 'runneros' },
    ]) {
      actor = invalid;
      await expect(callbacks.composioGmailReadFn!({ messageId: 'a123' })).rejects.toThrow('unavailable');
    }
    actor = { agentSlug: 'outreach-agent', scope: 'campaign', variant: 'artist-os' };
    allowed = false;
    await expect(callbacks.composioStatusFn!({})).rejects.toThrow('Denied global');
    expect(calls).toEqual(['refresh']);
    allowed = true;
    const email = { accountId: 'ca-1', accountEmail: 'sender@example.com', to: 'friend@example.com', subject: 'Hello', body: 'Approved body' };
    await callbacks.composioGmailSendFn!(email);
    expect(calls[1]).toEqual({ op: 'send', input: email });
  });
  test('lazy bindings follow callback replacement and removal without resurrecting authorization', async () => {
    const sessionId = 'composio-bindings-test';
    const context = {} as SessionToolContext;
    attachSessionSelfManagementBindings(context, sessionId);
    expect(context.composioStatus).toBeUndefined();
    try {
      mergeSessionScopedToolCallbacks(sessionId, { composioStatusFn: async () => ({ state: 'connected' }) });
      expect(await context.composioStatus!({})).toEqual({ state: 'connected' });
      mergeSessionScopedToolCallbacks(sessionId, { composioStatusFn: async () => ({ state: 'expired' }) });
      expect(await context.composioStatus!({})).toEqual({ state: 'expired' });
    } finally { unregisterSessionScopedToolCallbacks(sessionId); }
    expect(context.composioStatus).toBeUndefined();
  });
});
