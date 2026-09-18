import type { DurableJson } from '../protocol/durable-execution.ts';

export interface DurableOperationIntent {
  slotId: string;
  adapterId: string;
  adapterVersion: string;
  credentialIdentity: string;
  effectClass: 'read' | 'idempotent-write' | 'reconcilable-write' | 'single-attempt-write';
  idempotencyKey: string;
  input: DurableJson;
  outputSchema: { id: string; version: string };
  maxAttempts: number;
  maxUnitsPerAttempt: number;
}

export type DurableOperationOutcome =
  | { kind: 'succeeded'; output: DurableJson }
  | { kind: 'not-applied'; reason: string }
  | { kind: 'unknown'; reason: string }
  | { kind: 'failed'; reason: string };

/** Trusted synchronous validator for exactly the schema pinned in the intent. */
export interface DurableOperationValidator {
  id: string;
  version: string;
  validate(output: DurableJson): boolean;
}

export interface DurableOperationAttemptToken {
  operationId: string;
  slotId: string;
  commandId: string;
  attempt: number;
  ownerId: string;
  epoch: number;
}
export interface DurableOperationAttempt extends DurableOperationAttemptToken {
  reservedUnits: number;
  outcome?: DurableOperationOutcome;
  /** Authoritative observation after an uncertain invocation; original outcome remains intact. */
  reconciliation?: DurableOperationOutcome;
}
export interface DurableOperation {
  operationId: string;
  intent: DurableOperationIntent;
  inputDigest: string;
  status: 'intent' | 'inflight' | 'unknown' | 'succeeded' | 'failed';
  attempts: DurableOperationAttempt[];
}
export interface DurableOperationStart {
  operation: DurableOperation;
  /** Only a fresh committed attempt authorizes one invocation. A duplicate is acknowledgement only. */
  dispatch: boolean;
  attempt?: DurableOperationAttemptToken;
}

/** Changing provider context must never repeat a write from the abandoned step. */
export function hasDispatchedWriteSince(operations: readonly DurableOperation[] | undefined, startTurn: number): boolean {
  return operations?.some(operation => {
    if (operation.intent.effectClass === 'read' || operation.attempts.length === 0) return false;
    const match = /^source-write:(\d+):.+$/.exec(operation.intent.slotId);
    if (!match) return true; // Generic effects have no reliable model-turn scope.
    const turn = Number(match[1]);
    return !Number.isSafeInteger(turn) || !Number.isSafeInteger(startTurn) || turn >= startTurn;
  }) ?? false;
}
