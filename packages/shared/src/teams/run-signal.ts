import { EventEmitter } from 'node:events';

/**
 * In-process reactive wake signal (U1b).
 *
 * The 15s scheduled tick loop is the slow-path safety net. This emitter is the
 * fast path: every persisted run mutation publishes a signal so the runtime can
 * tick the affected run immediately (debounced) instead of waiting up to a full
 * interval. Decoupled from SessionManager via pub/sub so the shared storage
 * layer has no dependency on the server runtime.
 */
export interface TeamRunSignal {
  workspaceRootPath: string;
  runId: string;
  reason: string;
}

const CHANNEL = 'team-run-signal';
const emitter = new EventEmitter();
// One emitter shared process-wide; the server attaches a single listener.
emitter.setMaxListeners(0);

export function emitTeamRunSignal(signal: TeamRunSignal): void {
  emitter.emit(CHANNEL, signal);
}

/** Subscribe to run mutation signals. Returns an unsubscribe function. */
export function onTeamRunSignal(listener: (signal: TeamRunSignal) => void): () => void {
  emitter.on(CHANNEL, listener);
  return () => {
    emitter.off(CHANNEL, listener);
  };
}

/** Test/diagnostic helper. */
export function teamRunSignalListenerCount(): number {
  return emitter.listenerCount(CHANNEL);
}
