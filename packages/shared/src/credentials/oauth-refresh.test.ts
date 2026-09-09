import { describe, expect, test } from 'bun:test';
import { CredentialManager } from './manager.ts';
import type { StoredCredential } from './types.ts';

function memoryManager() {
  const manager = new CredentialManager();
  let value: StoredCredential | null = { value: 'original', refreshToken: 'refresh-original' };
  let release!: () => void;
  let entered!: () => void;
  const writing = new Promise<void>(r => { entered = r; });
  const gate = new Promise<void>(r => { release = r; });
  const backend = {
    name: 'test', get: async () => value,
    set: async (_: unknown, next: StoredCredential) => { entered(); await gate; value = next; },
    delete: async () => { value = null; return true; },
  };
  Object.assign(manager, { initialized: true, backends: [backend], writeBackend: backend });
  return { manager, writing, release: () => release(), value: () => value };
}

describe('OAuth refresh persistence', () => {
  test('signout queued during refresh write remains signed out', async () => {
    const s = memoryManager();
    const refresh = s.manager.compareAndSetLlmOAuth('account', { accessToken: 'original', refreshToken: 'refresh-original' }, { accessToken: 'new', refreshToken: 'refresh-new' });
    await s.writing;
    const signout = s.manager.delete({ type: 'llm_oauth', connectionSlug: 'account' });
    s.release(); expect(await refresh).toBe(true); await signout;
    expect(s.value()).toBeNull();
  });
  test('signout completed before refresh save cannot be resurrected', async () => {
    const s = memoryManager();
    await s.manager.delete({ type: 'llm_oauth', connectionSlug: 'account' });
    expect(await s.manager.compareAndSetLlmOAuth('account', { accessToken: 'original', refreshToken: 'refresh-original' }, { accessToken: 'new' })).toBe(false);
    expect(s.value()).toBeNull();
  });
});
