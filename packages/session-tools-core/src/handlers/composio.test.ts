import { describe, expect, test } from 'bun:test';
import type { SessionToolContext } from '../context.ts';
import { ComposioEmailSchema, ComposioSearchSchema, getSessionToolRegistry, getSessionSafeAllowedToolNames } from '../tool-defs.ts';
const registry = getSessionToolRegistry({ includeComposioTools: true });
const email = { accountId: 'ca-selected', accountEmail: 'sender@example.com', to: 'artist@example.com', subject: 'Listen', body: 'Private draft' };

describe('named Composio Gmail tools', () => {
  test('default hidden; reads alone are Explore-safe; absent callback fails closed', async () => {
    const reads = getSessionSafeAllowedToolNames({ includeComposioTools: true });
    for (const name of ['composio_status', 'composio_gmail_search', 'composio_gmail_read', 'composio_gmail_draft', 'composio_gmail_send']) {
      expect(getSessionToolRegistry().has(name)).toBe(false);
      expect(registry.has(name)).toBe(true);
      expect((await registry.get(name)!.handler!({} as SessionToolContext, {})).isError).toBe(true);
      expect(reads.has(name)).toBe(!name.endsWith('_draft') && !name.endsWith('_send'));
    }
    expect(registry.get('composio_gmail_send')!.workerTrust).toBe('exact-approval');
  });
  test('rejects absent selected account, header injection, extra remote/tool controls and unbounded searches', () => {
    expect(ComposioEmailSchema.safeParse(email).success).toBe(true);
    for (const input of [{ ...email, accountId: '' }, { ...email, subject: 'x\r\nBcc: intruder@example.com' }, { ...email, tool: 'DELETE_ALL' }]) {
      expect(ComposioEmailSchema.safeParse(input).success).toBe(false);
    }
    for (const maxResults of [0, 51, 1.5]) expect(ComposioSearchSchema.safeParse({ query: 'from:friend', maxResults }).success).toBe(false);
  });
  test('forwards exact content once and preserves uncertain send results without retry', async () => {
    const calls: unknown[] = [];
    const ctx = { composioGmailSend: async (input: unknown) => { calls.push(input); return { ok: false, uncertain: true, error: 'Delivery unknown; do not retry.' }; } } as unknown as SessionToolContext;
    const result = await registry.get('composio_gmail_send')!.handler!(ctx, email);
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain('uncertain');
    expect(calls).toEqual([email]);
  });
  test('does not expose provider exception details', async () => {
    const ctx = { composioStatus: async () => { throw new Error('Authorization: secret-value'); } } as unknown as SessionToolContext;
    const result = await registry.get('composio_status')!.handler!(ctx, {});
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain('secret-value');
  });
});
