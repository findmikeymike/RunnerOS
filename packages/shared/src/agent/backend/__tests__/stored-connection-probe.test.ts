import { expect, test } from 'bun:test';
import { probeStoredConnection } from '../internal/stored-connection-probe';

test('only an actual nonempty model response succeeds and backend is destroyed', async () => {
  let calls = 0, destroyed = 0;
  expect(await probeStoredConnection({ runMiniCompletion: async () => { calls++; return 'OK'; }, destroy: () => { destroyed++; } })).toEqual({ success: true });
  expect(calls).toBe(1); expect(destroyed).toBe(1);
  expect((await probeStoredConnection({ runMiniCompletion: async () => ' ', destroy: () => {} })).success).toBe(false);
});

test('403 and unknown provider errors fail without leaking raw provider output', async () => {
  for (const message of ['403 private-provider-output', 'private-provider-output']) {
    const result = await probeStoredConnection({ runMiniCompletion: async () => { throw new Error(message); }, destroy: () => {} });
    expect(result.success).toBe(false);
    expect(result.error).not.toContain('private-provider-output');
  }
});

test('a stuck provider is bounded and its backend is destroyed', async () => {
  let destroyed = false;
  const result = await probeStoredConnection({ runMiniCompletion: () => new Promise(() => {}), destroy: () => { destroyed = true; } }, 10);
  expect(result.success).toBe(false); expect(result.error).toContain('timed out'); expect(destroyed).toBe(true);
});

test('cleanup failure cannot leak raw SDK output or replace the validation result', async () => {
  expect(await probeStoredConnection({ runMiniCompletion: async () => 'OK', destroy: () => { throw new Error('private-cleanup-output'); } })).toEqual({ success: true });
  const result = await probeStoredConnection({ runMiniCompletion: async () => { throw new Error('403'); }, destroy: () => { throw new Error('private-cleanup-output'); } });
  expect(result.success).toBe(false);
  expect(result.error).not.toContain('private-cleanup-output');
});
