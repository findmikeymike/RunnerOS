export interface SharedEntityMeta {
  id: string;
  schemaVersion: number;
  createdAt: string;
  createdByMachineId?: string;
  updatedAt: string;
  updatedByMachineId?: string;
  revision: number;
  deletedAt?: string;
  deletedByMachineId?: string;
  lastWriteSha256?: string;
  /** Immutable V2 operation that materialized this canonical record. */
  headOpId?: string;
  emailHash?: string;
  purgeUndoFor?: string[];
}

export type SharedRecord<T extends Record<string, unknown> = Record<string, unknown>> = SharedEntityMeta & T;

export interface SharedRecordBaseline<T extends SharedRecord = SharedRecord> {
  revision: number;
  sha256: string;
  entity: T;
}

export interface SharedRecordWriteSuccess<T extends SharedRecord = SharedRecord> {
  status: 'written';
  entity: T;
  baseline: SharedRecordBaseline<T>;
}

export interface SharedRecordWriteConflict {
  status: 'conflict';
  conflict: SharedRecordConflict;
}

export type SharedRecordWriteResult<T extends SharedRecord = SharedRecord> =
  | SharedRecordWriteSuccess<T>
  | SharedRecordWriteConflict;

export interface SharedRecordConflict {
  version: 1;
  conflictId: string;
  entityPath: string;
  detectedAt: string;
  detectedByMachineId: string;
  sourceMachineId?: string;
  baseRevision?: number;
  currentRevision?: number;
  incoming?: unknown;
  current?: unknown;
  base?: unknown;
  mine?: unknown;
  providerConflictPath?: string;
  reason: 'stale-baseline' | 'clobbered-write' | 'provider-conflicted-copy';
  status: 'open' | 'resolved' | 'archived';
}

export interface SharedRecordOplogEntry {
  version: 1;
  seq: number;
  at: string;
  machineId: string;
  entityPath: string;
  revision: number;
  contentSha256: string;
  prevSha256?: string;
  /** Recoverable branch payload; privacy-erasure tombstones scrub earlier payloads. */
  entity?: SharedRecord;
}

export interface SharedRecordOpV2 {
  version: 2;
  opId: string;
  at: string;
  machineId: string;
  entityPath: string;
  kind: 'put' | 'delete' | 'resolve';
  parentOpIds: string[];
  baseSha256?: string;
  nonce: string;
  contentSha256: string;
  payloadSha256: string;
}

export interface SharedRecordDeleteOptions {
  emailHash?: string;
  piiScrub?: boolean;
  eraseUndo?: boolean;
}

export interface SharedRecordClobberIssue {
  entry: SharedRecordOplogEntry | SharedRecordOpV2;
  conflict: SharedRecordConflict;
}
