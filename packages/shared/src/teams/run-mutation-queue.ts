/**
 * Per-run in-process mutation serialization.
 *
 * Team run storage mutations are individually synchronous (read → mutate →
 * atomic-rename), so within a single Node thread they cannot interleave. But
 * the runtime layers an async surface on top (SessionManager callbacks, RPC
 * handlers) and the standalone-server + Electron deployment can host more than
 * one process touching the same run directory. This module gives every async
 * caller a single serialization point per run, so a read-modify-write sequence
 * that spans `await` boundaries cannot be clobbered by a concurrent caller in
 * the same process. Cross-process safety is layered on top via
 * {@link writeTeamRunGuarded}'s optimistic `rev` check in run-storage.
 *
 * The queue is keyed by `${workspaceRootPath}::${runId}` so unrelated runs
 * still run fully concurrently. Chains are dropped from the map once drained to
 * avoid unbounded growth across a long-lived server process.
 */

type Chain = Promise<unknown>;

const chains = new Map<string, Chain>();

function keyFor(workspaceRootPath: string, runId: string): string {
  return `${workspaceRootPath}::${runId}`;
}

/**
 * Run `fn` after any previously-queued mutation for the same run resolves.
 * Mutations for a given run execute strictly in call order; a rejected mutation
 * does not poison the chain for subsequent callers.
 */
export function withRunMutationLock<T>(
  workspaceRootPath: string,
  runId: string,
  fn: () => T | Promise<T>,
): Promise<T> {
  const key = keyFor(workspaceRootPath, runId);
  const prior = chains.get(key) ?? Promise.resolve();

  // Swallow the prior result/rejection for sequencing purposes only; the actual
  // result/rejection is surfaced to the prior caller, not this one.
  const run = prior.then(() => fn(), () => fn());

  // Keep the chain alive even if `run` rejects, but only retain the tail.
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  chains.set(key, tail);

  // Once this is the last queued entry, drop the key so the map stays bounded.
  void tail.then(() => {
    if (chains.get(key) === tail) chains.delete(key);
  });

  return run;
}

/** Test/diagnostic helper: number of runs with an in-flight or queued chain. */
export function pendingRunMutationChains(): number {
  return chains.size;
}
