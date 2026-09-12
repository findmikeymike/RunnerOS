/** Serialize a connection's config/credential setup, without changing approval policy. */
const writes = new Map<string, Promise<unknown>>();
const revisions = new Map<string, number>();

export async function withLlmConnectionMutation<T>(slug: string, write: () => Promise<T>): Promise<T> {
  const previous = writes.get(slug);
  revisions.set(slug, (revisions.get(slug) ?? 0) + 1);
  const pending = (async () => {
    if (previous) await previous.catch(() => undefined);
    return write();
  })();
  writes.set(slug, pending);
  try { return await pending; }
  finally {
    revisions.set(slug, (revisions.get(slug) ?? 0) + 1);
    if (writes.get(slug) === pending) writes.delete(slug);
  }
}

/** Retry credential/config resolution, never a model or tool invocation. */
export async function readStableLlmConnection<T>(slug: string, read: () => Promise<T>): Promise<T> {
  for (;;) {
    const pending = writes.get(slug);
    if (pending) { await pending.catch(() => undefined); continue; }
    const revision = revisions.get(slug) ?? 0;
    let result: T;
    try { result = await read(); }
    catch (error) {
      if (writes.has(slug) || revision !== (revisions.get(slug) ?? 0)) continue;
      throw error;
    }
    if (!writes.has(slug) && revision === (revisions.get(slug) ?? 0)) return result;
  }
}
