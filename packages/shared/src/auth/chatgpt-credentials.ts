import { getCredentialManager } from '../credentials/manager.ts';
import { refreshChatGptTokens } from './chatgpt-oauth.ts';

type Tokens = NonNullable<Awaited<ReturnType<ReturnType<typeof getCredentialManager>['getLlmOAuth']>>>;
export type ChatGptCredentialDependencies = {
  read(slug: string): Promise<Tokens | null>;
  save(slug: string, expected: Tokens, replacement: Tokens): Promise<boolean>;
  refresh(token: string, signal: AbortSignal): Promise<Tokens>;
  timeoutMs?: number;
};

function waitFor<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

/** One refresh per connection across voice and Command; cancellation only detaches that caller. */
export function createChatGptCredentialAccessor(deps: ChatGptCredentialDependencies) {
  const pending = new Map<string, Promise<string>>();
  return async (slug: string, signal?: AbortSignal, force = false): Promise<string> => {
    const waitSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(deps.timeoutMs ?? 30_000)])
      : AbortSignal.timeout(deps.timeoutMs ?? 30_000);
    waitSignal.throwIfAborted();
    // Snapshot before joining the refresh so a concurrent force request does not rotate twice.
    const initial = await waitFor(deps.read(slug), waitSignal);
    if (!initial?.accessToken) throw new Error('Sign in to ChatGPT again in Models');
    const existing = pending.get(slug);
    if (existing) return waitFor(existing, waitSignal);
    if (!force && initial.expiresAt && initial.expiresAt > Date.now() + 5 * 60_000) return initial.accessToken;
    if (!initial.refreshToken) {
      if (!force && (!initial.expiresAt || initial.expiresAt > Date.now())) return initial.accessToken;
      throw new Error('Your ChatGPT sign-in expired; sign in again in Models');
    }
    const operation = (async () => {
      const refreshSignal = AbortSignal.timeout(deps.timeoutMs ?? 30_000);
      const current = await waitFor(deps.read(slug), refreshSignal);
      if (!current?.accessToken) throw new Error('Sign in to ChatGPT again in Models');
      if (current.refreshToken !== initial.refreshToken || current.accessToken !== initial.accessToken) return current.accessToken;
      const refreshed = await waitFor(deps.refresh(current.refreshToken!, refreshSignal), refreshSignal);
      if (!refreshed.accessToken) throw new Error('ChatGPT refresh returned no access token; sign in again in Models');
      const replacement = { ...refreshed, idToken: refreshed.idToken ?? current.idToken, refreshToken: refreshed.refreshToken ?? current.refreshToken };
      if (!await deps.save(slug, current, replacement)) throw new Error('Your ChatGPT sign-in changed; retry using the current account');
      return replacement.accessToken;
    })();
    pending.set(slug, operation);
    void operation.finally(() => { if (pending.get(slug) === operation) pending.delete(slug); }).catch(() => {});
    return waitFor(operation, waitSignal);
  };
}

export const getChatGptAccessToken = createChatGptCredentialAccessor({
  read: slug => getCredentialManager().getLlmOAuth(slug),
  save: (slug, expected, replacement) => getCredentialManager().compareAndSetLlmOAuth(slug, expected, replacement),
  refresh: (token, signal) => refreshChatGptTokens(token, undefined, signal),
});
