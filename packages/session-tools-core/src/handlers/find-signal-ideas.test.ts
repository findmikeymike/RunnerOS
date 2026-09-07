import { expect, test, mock } from 'bun:test';
import type { SessionToolContext } from '../context.ts';
import { handleFindSignalIdeas } from './find-signal-ideas.ts';
const context = (overrides: Partial<SessionToolContext> = {}) => overrides as SessionToolContext;
test('read-only handler invokes host and keeps serialized envelope compact', async () => {
  const callback = mock(async () => ({ ok: true, mode: 'browse' as const, entries: [] }));
  const result = await handleFindSignalIdeas(context({ findSignalIdeas: callback }), {});
  expect(callback).toHaveBeenCalledTimes(1);
  expect(result.isError).not.toBe(true);
  expect(result.content[0]).toEqual({ type: 'text', text: '{"ok":true,"mode":"browse","entries":[]}' });
});
test('rejects invalid input before callback and redacts callback failures', async () => {
  const callback = mock(async () => { throw new Error('secret provider/path'); });
  const ctx = context({ findSignalIdeas: callback });
  expect((await handleFindSignalIdeas(ctx, { query: 'x'.repeat(501) })).isError).toBe(true);
  expect(callback).not.toHaveBeenCalled();
  const result = await handleFindSignalIdeas(ctx, {});
  expect(result.isError).toBe(true); expect(JSON.stringify(result)).not.toContain('secret');
  expect((await handleFindSignalIdeas(context(), {})).isError).toBe(true);
});
test('defense in depth rejects oversized callback envelopes', async () => {
  const result = await handleFindSignalIdeas(context({ findSignalIdeas: async () => ({ ok: true, mode: 'search', entries: [], error: 'x'.repeat(4001) }) }), {});
  expect(result.isError).toBe(true); expect(JSON.stringify(result).length).toBeLessThan(4000);
});
