import type { DurableJson } from '../../../shared/src/protocol/durable-execution';
import type { DurableOperationIntent, DurableOperationValidator } from '../../../shared/src/durable-execution/operation-types';
import type { DurableEffectAdapter } from './durable-effect-runner';

export interface DurableSingleAttemptWriteOptions {
  id: string;
  version: string;
  workspaceId: string;
  credentialIdentity: string;
  outputSchema: DurableOperationValidator;
  /** Reuse the calling action's existing authorization; this does not request approval. */
  authorize(intent: Readonly<DurableOperationIntent>): Promise<void> | void;
  /** Current synchronous access fence, checked at the transport’s final dispatch boundary. */
  assertAuthorized(intent: Readonly<DurableOperationIntent>): void;
  /** Trusted host transport. Call assertDispatch immediately before I/O after any awaits. */
  invoke(input: Readonly<DurableJson>, assertDispatch: () => void): Promise<DurableJson>;
}

/**
 * Common contract for writes without provider idempotency or authoritative lookup.
 * The journal records the attempt first and the receipt before the caller continues.
 * The logical idempotency key is local identity, not a provider deduplication promise.
 * A lost receipt cannot be recovered by calling the transport again.
 */
export function createDurableSingleAttemptWriteAdapter(options: DurableSingleAttemptWriteOptions): DurableEffectAdapter {
  const { id, version, workspaceId, credentialIdentity, authorize, assertAuthorized, invoke } = options;
  const outputSchema = Object.freeze({ ...options.outputSchema });
  if (![id, version, workspaceId].every(value => typeof value === 'string' && value.trim())
    || !/^[a-f0-9]{64}$/.test(credentialIdentity)) throw new Error('invalid-durable-write-adapter');
  return Object.freeze({
    id, version, workspaceId, credentialIdentity, outputSchema,
    effectClass: 'single-attempt-write' as const,
    authorize,
    async invoke(intent: Readonly<DurableOperationIntent>, assertDispatch?: () => void) {
      if (!assertDispatch || intent.effectClass !== 'single-attempt-write' || intent.maxAttempts !== 1) throw new Error('durable-write-dispatch-required');
      const guard = () => { assertAuthorized(intent); assertDispatch(); };
      guard();
      try {
        const output = await invoke(intent.input, guard);
        // A malformed receipt cannot establish that a write failed or was not applied.
        if (outputSchema.validate(output) !== true) return { kind: 'unknown' as const, reason: 'write-receipt-unverified' };
        return { kind: 'succeeded' as const, output };
      } catch {
        return { kind: 'unknown' as const, reason: 'write-outcome-unconfirmed' };
      }
    },
    async reconcile() { return { kind: 'unknown' as const, reason: 'write-has-no-authoritative-lookup' }; },
  });
}
