import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

const pending = new Map<string, Promise<void>>();

/** Shared by asynchronous vault imports and campaign preservation. */
export async function withArtistVaultMutex<T>(rootPath: string, action: () => Promise<T>): Promise<T> {
  const key = realpathSync(resolve(rootPath));
  const previous = pending.get(key) ?? Promise.resolve();
  const next = previous.then(action, action);
  const settled = next.then(() => {}, () => {});
  pending.set(key, settled);
  try { return await next; } finally {
    if (pending.get(key) === settled) pending.delete(key);
  }
}
