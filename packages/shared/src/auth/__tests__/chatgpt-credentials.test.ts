import { describe, expect, test } from 'bun:test';
import { createChatGptCredentialAccessor, type ChatGptCredentialDependencies } from '../chatgpt-credentials.ts';

const old = { accessToken: 'old', refreshToken: 'refresh-old', expiresAt: 1, idToken: 'identity' };
const fresh = { accessToken: 'fresh', refreshToken: 'refresh-new', expiresAt: Date.now() + 3_600_000 };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function setup(refresh: ChatGptCredentialDependencies['refresh'], timeoutMs?: number) {
  let stored: typeof old | null = { ...old };
  let saves = 0;
  const get = createChatGptCredentialAccessor({
    read: async () => stored,
    save: async (_, expected, replacement) => {
      if (!stored || stored.accessToken !== expected.accessToken || stored.refreshToken !== expected.refreshToken) return false;
      saves++; stored = replacement as typeof old; return true;
    }, refresh, timeoutMs,
  });
  return { get, replace: (value: typeof old | null) => { stored = value; }, stored: () => stored, saves: () => saves };
}

describe('shared ChatGPT credential refresh', () => {
  test('voice and forced Command refresh share one rotation and preserve identity', async () => {
    const gate = deferred<typeof fresh>(); let refreshes = 0;
    const s = setup(async () => { refreshes++; return gate.promise; });
    const voice = s.get('account'); const command = s.get('account', undefined, true);
    await new Promise(r => setTimeout(r, 1)); gate.resolve(fresh);
    expect(await Promise.all([voice, command])).toEqual(['fresh', 'fresh']);
    expect(refreshes).toBe(1); expect(s.saves()).toBe(1); expect(s.stored()?.idToken).toBe('identity');
    expect(await s.get('account')).toBe('fresh'); expect(refreshes).toBe(1);
  });
  test('cancelling one caller leaves shared refresh available to another', async () => {
    const gate = deferred<typeof fresh>(); const s = setup(async () => gate.promise);
    const stop = new AbortController();
    const cancelled = s.get('account', stop.signal); const active = s.get('account');
    await new Promise(r => setTimeout(r, 1)); stop.abort(new Error('stopped'));
    await expect(cancelled).rejects.toThrow('stopped'); gate.resolve(fresh);
    expect(await active).toBe('fresh');
  });
  test.each(['signout', 'replacement'])('does not overwrite %s during refresh', async kind => {
    const gate = deferred<typeof fresh>(); const s = setup(async () => gate.promise);
    const result = s.get('account'); await new Promise(r => setTimeout(r, 1));
    const replacement = kind === 'signout' ? null : { ...old, accessToken: 'new-account' };
    s.replace(replacement); gate.resolve(fresh);
    await expect(result).rejects.toThrow('sign-in changed'); expect(s.stored()).toEqual(replacement); expect(s.saves()).toBe(0);
  });
  test('timeout releases refresh lock and late completion cannot overwrite newer credentials', async () => {
    const gate = deferred<typeof fresh>(); let attempts = 0;
    const s = setup(async () => { attempts++; return attempts === 1 ? gate.promise : fresh; }, 15);
    await expect(s.get('account')).rejects.toThrow();
    await new Promise(r => setTimeout(r, 5));
    expect(await s.get('account')).toBe('fresh'); gate.resolve({ ...fresh, accessToken: 'late' });
    await new Promise(r => setTimeout(r, 1)); expect(s.stored()?.accessToken).toBe('fresh'); expect(s.saves()).toBe(1);
  });
  test('expired credential without refresh asks for sign-in', async () => {
    const get = createChatGptCredentialAccessor({ read: async () => ({ accessToken: 'expired', expiresAt: 1 }), save: async () => true, refresh: async () => fresh });
    await expect(get('account')).rejects.toThrow('sign-in expired');
  });
});
