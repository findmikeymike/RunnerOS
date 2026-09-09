import { randomUUID } from 'node:crypto';
import { canonical, digest, type DurableClaim, type DurableJournal } from '../../../shared/src/durable-execution/index.ts';
import type { DurableOperationIntent, DurableOperationOutcome, DurableOperationValidator, DurableOperation } from '../../../shared/src/durable-execution/operation-types.ts';

export interface DurableEffectAdapter {
  id: string;
  version: string;
  credentialIdentity: string;
  effectClass: DurableOperationIntent['effectClass'];
  outputSchema: DurableOperationValidator;
  /** This check runs again after awaited work, immediately before an invocation. */
  authorize(intent: Readonly<DurableOperationIntent>): Promise<void> | void;
  invoke(intent: Readonly<DurableOperationIntent>): Promise<DurableOperationOutcome>;
  /** Must be an authoritative lookup; inability to determine the outcome means unknown. */
  reconcile(intent: Readonly<DurableOperationIntent>): Promise<DurableOperationOutcome>;
}

function freeze<T>(value: T): T { if (value && typeof value === 'object') { for (const item of Object.values(value)) freeze(item); Object.freeze(value); } return value; }

/** Internal host boundary. It does not expand the certified Pi read tool manifest. */
export class DurableEffectRunner {
  private readonly adapters = new Map<string, DurableEffectAdapter>();
  constructor(private readonly journal: DurableJournal, adapters: DurableEffectAdapter[]) {
    for (const adapter of adapters) {
      const key = `${adapter.id}@${adapter.version}`;
      if (this.adapters.has(key)) throw new Error('durable-adapter-duplicate');
      this.adapters.set(key, adapter);
    }
  }
  private adapter(intent: DurableOperationIntent): DurableEffectAdapter {
    const adapter = this.adapters.get(`${intent.adapterId}@${intent.adapterVersion}`);
    if (!adapter || adapter.id !== intent.adapterId || adapter.version !== intent.adapterVersion || adapter.credentialIdentity !== intent.credentialIdentity || adapter.effectClass !== intent.effectClass ||
      adapter.outputSchema.id !== intent.outputSchema.id || adapter.outputSchema.version !== intent.outputSchema.version) throw new Error('durable-adapter-binding-changed');
    return adapter;
  }
  async execute(claim: DurableClaim, intent: DurableOperationIntent, commandId: string = randomUUID()): Promise<DurableOperation> {
    claim = Object.freeze({ ...claim });
    // Keep caller mutation across awaits from changing the authorized effect.
    const pinned = freeze(JSON.parse(canonical(intent)) as DurableOperationIntent);
    const adapter = this.adapter(pinned);
    let operation = this.journal.reserveOperation(claim, pinned);
    if (operation.status === 'succeeded' || operation.status === 'failed') return operation;
    await adapter.authorize(pinned);
    this.adapter(pinned);
    if (operation.status === 'inflight' || operation.status === 'unknown') {
      const attempt = operation.attempts.at(-1)!;
      // A same-owner invocation could still be running. Never infer absence while it can land.
      if (operation.status === 'inflight' && attempt.ownerId === claim.ownerId && attempt.epoch === claim.epoch) return operation;
      let outcome: DurableOperationOutcome;
      try { outcome = await adapter.reconcile(pinned); }
      catch { outcome = { kind: 'unknown', reason: 'adapter-reconciliation-unavailable' }; }
      await adapter.authorize(pinned);
      this.adapter(pinned);
      operation = this.journal.reconcileOperation(claim, { operationId: attempt.operationId, slotId: attempt.slotId, commandId: attempt.commandId, attempt: attempt.attempt, ownerId: attempt.ownerId, epoch: attempt.epoch }, outcome, adapter.outputSchema);
      // Reconciliation never silently issues another effect. A separate command may retry proven absence.
      return operation;
    }
    await adapter.authorize(pinned);
    this.adapter(pinned);
    const start = this.journal.startOperation(claim, pinned.slotId, commandId);
    if (!start.dispatch) return start.operation;
    let outcome: DurableOperationOutcome;
    try { outcome = await adapter.invoke(pinned); }
    catch { outcome = { kind: 'unknown', reason: 'adapter-invocation-outcome-unknown' }; }
    return this.journal.settleOperation(claim, start.attempt!, outcome, adapter.outputSchema);
  }
}

export const durableLocalArtifactCredential = (root: string, identity: { dev: number; ino: number }): string => digest({ adapter: 'local-immutable-artifact', root, dev: identity.dev, ino: identity.ino });
