import {
  appendFileSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { CONFIG_DIR, loadWorkspaceConfig } from '../workspaces/storage.ts';
import type {
  SharedRecord,
  SharedRecordBaseline,
  SharedRecordClobberIssue,
  SharedRecordConflict,
  SharedRecordDeleteOptions,
  SharedRecordOplogEntry,
  SharedRecordOpV2,
  SharedRecordWriteResult,
  SharedRecordWriteSuccess,
} from './types.ts';

export const RECORDS_DIR = 'records';
export const TEAM_CONFLICTS_DIR = 'team/conflicts';
export const TEAM_OPLOG_DIR = 'team/oplog';
export const TEAM_RECORD_OPS_DIR = 'team/record-ops';
export const TEAM_RECORD_PAYLOADS_DIR = 'team/record-payloads';
export const CLOBBER_DETECTION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const RECORD_CONFLICT_SCAN_IGNORE_PATTERNS = [
  /^~\$/,
  /\.tmp$/i,
  /\.part$/i,
  /\.crdownload$/i,
  /^\.DS_Store$/,
  /^\._/,
  /^Icon\r$/,
  /\.icloud$/i,
];

const oplogNextSeqCache = new Map<string, number>();

export interface SharedRecordWriteOptions {
  machineId: string;
  schemaVersion?: number;
  baseline?: { revision: number; sha256: string; entity: unknown };
  now?: string;
}

export interface SharedRecordDeleteInput extends SharedRecordDeleteOptions {
  machineId: string;
  baseline: { revision: number; sha256: string; entity: unknown };
  now?: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function sha256Text(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value, null, 2) + '\n';
}

function sha256Json(value: unknown): string {
  return sha256Text(stringifyJson(value));
}

function entityKey(entityPath: string): string {
  return sha256Text(entityPath).slice(0, 24);
}

function getRecordOpDir(workspaceRootPath: string, entityPath: string): string {
  return join(workspaceRootPath, TEAM_RECORD_OPS_DIR, entityKey(entityPath));
}

function getRecordOpFile(workspaceRootPath: string, entityPath: string, opId: string): string {
  assertSafeSegment(opId, 'record op id');
  return join(getRecordOpDir(workspaceRootPath, entityPath), `${opId}.json`);
}

function getRecordPayloadFile(workspaceRootPath: string, opId: string): string {
  assertSafeSegment(opId, 'record payload id');
  return join(workspaceRootPath, TEAM_RECORD_PAYLOADS_DIR, `${opId}.json`);
}

function atomicWriteFile(file: string, data: string): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tmp, data, 'utf-8');
    const fd = openSync(tmp, 'r');
    try { fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(tmp, file);
    try {
      const dirFd = openSync(dirname(file), 'r');
      try { fsyncSync(dirFd); } finally { closeSync(dirFd); }
    } catch {
      // Directory fsync is not portable on every platform; the file fsync above is the durable baseline.
    }
  } catch (error) {
    try { rmSync(tmp, { force: true }); } catch { /* ignore */ }
    throw error;
  }
}

function atomicWriteJson(file: string, value: unknown): void {
  atomicWriteFile(file, stringifyJson(value));
}

function writeImmutableJson(file: string, value: unknown): void {
  const serialized = stringifyJson(value);
  if (existsSync(file)) {
    if (readFileSync(file, 'utf-8') !== serialized) throw new Error(`Immutable record operation changed: ${file}`);
    return;
  }
  atomicWriteFile(file, serialized);
}

function isContainedPath(parentPath: string, candidatePath: string): boolean {
  const parent = resolve(parentPath);
  const candidate = resolve(candidatePath);
  const between = relative(parent, candidate);
  return between === '' || (!between.startsWith('..') && !between.includes('..'));
}

function assertSafeSegment(value: string, label: string): void {
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(value)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
}

function assertSafeCollection(collection: string): void {
  const parts = collection.split('/');
  if (!parts.length || parts.some((part) => !part)) throw new Error(`Invalid record collection: ${collection}`);
  for (const part of parts) assertSafeSegment(part, 'record collection segment');
}

function workspaceIdFor(workspaceRootPath: string): string {
  return loadWorkspaceConfig(workspaceRootPath)?.id ?? basename(resolve(workspaceRootPath));
}

export function getRecordsDir(workspaceRootPath: string): string {
  return join(workspaceRootPath, RECORDS_DIR);
}

export function getRecordCollectionDir(workspaceRootPath: string, collection: string): string {
  assertSafeCollection(collection);
  return join(getRecordsDir(workspaceRootPath), collection);
}

export function getRecordFile(workspaceRootPath: string, collection: string, entityId: string): string {
  assertSafeCollection(collection);
  assertSafeSegment(entityId, 'record id');
  const recordsRoot = getRecordsDir(workspaceRootPath);
  const file = resolve(recordsRoot, collection, `${entityId}.json`);
  if (!isContainedPath(recordsRoot, file)) throw new Error(`Record path escaped workspace: ${collection}/${entityId}`);
  return file;
}

export function recordEntityPath(collection: string, entityId: string): string {
  assertSafeCollection(collection);
  assertSafeSegment(entityId, 'record id');
  return `${RECORDS_DIR}/${collection}/${entityId}.json`;
}

export function getTeamConflictsDir(workspaceRootPath: string): string {
  return join(workspaceRootPath, TEAM_CONFLICTS_DIR);
}

export function getTeamOplogFile(workspaceRootPath: string, machineId: string): string {
  assertSafeSegment(machineId, 'machine id');
  return join(workspaceRootPath, TEAM_OPLOG_DIR, `${machineId}.jsonl`);
}

export function getPrivateUndoDir(workspaceRootPath: string, entityId: string): string {
  assertSafeSegment(entityId, 'record id');
  return join(process.env.CRAFT_CONFIG_DIR || CONFIG_DIR, 'team', workspaceIdFor(workspaceRootPath), 'undo', entityId);
}

export function readSharedRecord<T extends SharedRecord = SharedRecord>(
  workspaceRootPath: string,
  collection: string,
  entityId: string,
): T | null {
  const file = getRecordFile(workspaceRootPath, collection, entityId);
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as T;
    if (!parsed || typeof parsed !== 'object' || parsed.id !== entityId || typeof parsed.revision !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function baselineForRecord<T extends SharedRecord>(entity: T): SharedRecordBaseline<T> {
  return {
    revision: entity.revision,
    sha256: sha256Json(entity),
    entity,
  };
}

export function readSharedRecordBaseline<T extends SharedRecord = SharedRecord>(
  workspaceRootPath: string,
  collection: string,
  entityId: string,
): SharedRecordBaseline<T> | null {
  const entity = readSharedRecord<T>(workspaceRootPath, collection, entityId);
  return entity ? baselineForRecord(entity) : null;
}

function nextOplogSeq(workspaceRootPath: string, machineId: string): number {
  const file = getTeamOplogFile(workspaceRootPath, machineId);
  const cached = oplogNextSeqCache.get(file);
  if (cached && existsSync(file)) return cached;
  if (!existsSync(file)) {
    oplogNextSeqCache.delete(file);
    return 1;
  }
  const lines = readFileSync(file, 'utf-8').trim().split('\n').filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      const parsed = JSON.parse(lines[i]!) as Partial<SharedRecordOplogEntry>;
      if (typeof parsed.seq === 'number') {
        const next = parsed.seq + 1;
        oplogNextSeqCache.set(file, next);
        return next;
      }
    } catch {
      continue;
    }
  }
  return 1;
}

function appendOplog(workspaceRootPath: string, entry: Omit<SharedRecordOplogEntry, 'version' | 'seq' | 'at'> & { at?: string }): void {
  const full: SharedRecordOplogEntry = {
    version: 1,
    seq: nextOplogSeq(workspaceRootPath, entry.machineId),
    at: entry.at ?? nowIso(),
    ...entry,
  };
  const file = getTeamOplogFile(workspaceRootPath, entry.machineId);
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify(full) + '\n', 'utf-8');
  oplogNextSeqCache.set(file, full.seq + 1);
}

function saveUndo(workspaceRootPath: string, entity: SharedRecord): void {
  const dir = getPrivateUndoDir(workspaceRootPath, entity.id);
  atomicWriteJson(join(dir, `${entity.revision}.json`), entity);
  pruneUndoDir(dir);
}

function pruneUndoDir(dir: string, olderThanMs = 30 * 24 * 60 * 60 * 1000): void {
  if (!existsSync(dir)) return;
  const cutoff = Date.now() - olderThanMs;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const file = join(dir, entry.name);
    try {
      if (statSync(file).mtimeMs < cutoff) unlinkSync(file);
    } catch {
      continue;
    }
  }
}

function readUndo(workspaceRootPath: string, entityId: string, revision: number): SharedRecord | null {
  const file = join(getPrivateUndoDir(workspaceRootPath, entityId), `${revision}.json`);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as SharedRecord;
  } catch {
    return null;
  }
}

function purgeUndo(workspaceRootPath: string, entityId: string): void {
  rmSync(getPrivateUndoDir(workspaceRootPath, entityId), { recursive: true, force: true });
}

function purgeConflictArtifacts(workspaceRootPath: string, entityPath: string): void {
  const conflictsDir = getTeamConflictsDir(workspaceRootPath);
  if (existsSync(conflictsDir)) {
    for (const name of readdirSync(conflictsDir).filter((entry) => entry.endsWith('.json'))) {
      const file = join(conflictsDir, name);
      try {
        const conflict = JSON.parse(readFileSync(file, 'utf-8')) as SharedRecordConflict;
        if (conflict?.entityPath !== entityPath) continue;
        if (conflict.providerConflictPath) {
          const providerFile = resolve(workspaceRootPath, conflict.providerConflictPath);
          if (isContainedPath(getRecordsDir(workspaceRootPath), providerFile) && isProviderConflictFilename(basename(providerFile))) {
            rmSync(providerFile, { force: true });
          }
        }
        rmSync(file, { force: true });
      } catch {
        // Malformed conflict artifacts are unusable and cannot be proven free
        // of the purged subject's PII, so privacy wins over retention.
        rmSync(file, { force: true });
      }
    }
  }
  for (const file of walkFiles(getRecordsDir(workspaceRootPath))) {
    if (!isProviderConflictFilename(basename(file))) continue;
    if (canonicalEntityPathForProviderConflict(workspaceRootPath, file) === entityPath) rmSync(file, { force: true });
  }
}

function existingOpenConflict(
  workspaceRootPath: string,
  input: Pick<SharedRecordConflict, 'entityPath' | 'reason'> & {
    conflictId?: string;
    baseRevision?: number;
    providerConflictPath?: string;
    sourceMachineId?: string;
  },
): SharedRecordConflict | null {
  if (input.reason !== 'clobbered-write' && input.reason !== 'provider-conflicted-copy') return null;
  return listConflictRecords(workspaceRootPath).find((conflict) => (
    conflict.reason === input.reason
    && conflict.entityPath === input.entityPath
    && (!input.conflictId || conflict.conflictId === input.conflictId)
    && (input.reason !== 'clobbered-write' || conflict.baseRevision === input.baseRevision)
    && (input.reason !== 'clobbered-write' || conflict.sourceMachineId === input.sourceMachineId)
    && conflict.providerConflictPath === input.providerConflictPath
  )) ?? null;
}

function createConflictRecordWithState(
  workspaceRootPath: string,
  input: Omit<SharedRecordConflict, 'version' | 'conflictId' | 'detectedAt' | 'status'> & {
    conflictId?: string;
    detectedAt?: string;
    status?: SharedRecordConflict['status'];
  },
): { conflict: SharedRecordConflict; created: boolean } {
  const existing = existingOpenConflict(workspaceRootPath, input);
  if (existing) return { conflict: existing, created: false };

  const conflict: SharedRecordConflict = {
    version: 1,
    conflictId: input.conflictId ?? `conflict_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
    detectedAt: input.detectedAt ?? nowIso(),
    status: input.status ?? 'open',
    ...input,
  };
  atomicWriteJson(join(getTeamConflictsDir(workspaceRootPath), `${conflict.conflictId}.json`), conflict);
  return { conflict, created: true };
}

export function createConflictRecord(
  workspaceRootPath: string,
  input: Omit<SharedRecordConflict, 'version' | 'conflictId' | 'detectedAt' | 'status'> & {
    conflictId?: string;
    detectedAt?: string;
    status?: SharedRecordConflict['status'];
  },
): SharedRecordConflict {
  return createConflictRecordWithState(workspaceRootPath, input).conflict;
}

function currentFileSha(file: string): string | null {
  if (!existsSync(file)) return null;
  return sha256Text(readFileSync(file, 'utf-8'));
}

function persistRecordOp(
  workspaceRootPath: string,
  input: Omit<SharedRecordOpV2, 'version' | 'opId' | 'nonce' | 'contentSha256' | 'payloadSha256'>,
  entity: SharedRecord,
): SharedRecordOpV2 {
  const nonce = randomUUID().replace(/-/g, '');
  const identity = { version: 2 as const, ...input, nonce };
  const opId = `op_${sha256Json(identity)}`;
  const materialized = { ...entity, headOpId: opId } as SharedRecord;
  const payloadSha256 = sha256Json(materialized);
  const op: SharedRecordOpV2 = {
    version: 2,
    opId,
    ...input,
    nonce,
    contentSha256: payloadSha256,
    payloadSha256,
  };
  // Payload first, then the immutable claim. An op is never visible without its recovery payload.
  writeImmutableJson(getRecordPayloadFile(workspaceRootPath, opId), materialized);
  writeImmutableJson(getRecordOpFile(workspaceRootPath, input.entityPath, opId), op);
  return op;
}

interface ValidRecordOp {
  op: SharedRecordOpV2;
  entity: SharedRecord;
}

function readValidRecordOps(workspaceRootPath: string): ValidRecordOp[] {
  const root = join(workspaceRootPath, TEAM_RECORD_OPS_DIR);
  return walkFiles(root).flatMap((file) => {
    try {
      const op = JSON.parse(readFileSync(file, 'utf-8')) as SharedRecordOpV2;
      if (op?.version !== 2 || typeof op.opId !== 'string' || basename(file, '.json') !== op.opId) return [];
      if (!Array.isArray(op.parentOpIds) || typeof op.entityPath !== 'string') return [];
      const expectedOpId = `op_${sha256Json({
        version: 2,
        at: op.at,
        machineId: op.machineId,
        entityPath: op.entityPath,
        kind: op.kind,
        parentOpIds: op.parentOpIds,
        baseSha256: op.baseSha256,
        nonce: op.nonce,
      })}`;
      if (op.opId !== expectedOpId) return [];
      const payloadFile = getRecordPayloadFile(workspaceRootPath, op.opId);
      if (!existsSync(payloadFile)) return [];
      const raw = readFileSync(payloadFile, 'utf-8');
      if (sha256Text(raw) !== op.payloadSha256) return [];
      const entity = JSON.parse(raw) as SharedRecord;
      if (!entity || entity.headOpId !== op.opId || sha256Json(entity) !== op.contentSha256) return [];
      return [{ op, entity }];
    } catch {
      return [];
    }
  });
}

function purgeRecordPayloads(workspaceRootPath: string, entityPath: string, keepOpId: string): void {
  for (const { op } of readValidRecordOps(workspaceRootPath)) {
    if (op.entityPath !== entityPath || op.opId === keepOpId) continue;
    rmSync(getRecordPayloadFile(workspaceRootPath, op.opId), { force: true });
  }
}

export function writeSharedRecord<T extends Record<string, unknown>>(
  workspaceRootPath: string,
  collection: string,
  entityId: string,
  data: T,
  options: SharedRecordWriteOptions,
): SharedRecordWriteResult<SharedRecord<T>> {
  const timestamp = options.now ?? nowIso();
  const file = getRecordFile(workspaceRootPath, collection, entityId);
  const current = readSharedRecord(workspaceRootPath, collection, entityId);
  const currentSha = currentFileSha(file);
  const baseline = options.baseline;

  if (current && (!baseline || baseline.revision !== current.revision || baseline.sha256 !== currentSha)) {
    return {
      status: 'conflict',
      conflict: createConflictRecord(workspaceRootPath, {
        entityPath: recordEntityPath(collection, entityId),
        detectedByMachineId: options.machineId,
        baseRevision: baseline?.revision,
        currentRevision: current.revision,
        base: baseline?.entity,
        current,
        incoming: data,
        reason: 'stale-baseline',
      }),
    };
  }
  if (!current && baseline) {
    return {
      status: 'conflict',
      conflict: createConflictRecord(workspaceRootPath, {
        entityPath: recordEntityPath(collection, entityId),
        detectedByMachineId: options.machineId,
        baseRevision: baseline.revision,
        base: baseline.entity,
        incoming: data,
        reason: 'stale-baseline',
      }),
    };
  }

  let entity = {
    ...data,
    id: entityId,
    schemaVersion: current?.schemaVersion ?? options.schemaVersion ?? 1,
    createdAt: current?.createdAt ?? timestamp,
    createdByMachineId: current?.createdByMachineId ?? options.machineId,
    updatedAt: timestamp,
    updatedByMachineId: options.machineId,
    revision: (current?.revision ?? 0) + 1,
    lastWriteSha256: currentSha ?? undefined,
  } as SharedRecord<T>;

  const entityPath = recordEntityPath(collection, entityId);
  const op = persistRecordOp(workspaceRootPath, {
    at: timestamp,
    machineId: options.machineId,
    entityPath,
    kind: 'put',
    parentOpIds: current?.headOpId ? [current.headOpId] : [],
    baseSha256: currentSha ?? undefined,
  }, entity);
  entity = { ...entity, headOpId: op.opId };
  const writtenSha = sha256Json(entity);
  saveUndo(workspaceRootPath, entity);
  if (current) saveUndo(workspaceRootPath, current);
  appendOplog(workspaceRootPath, {
    machineId: options.machineId,
    at: timestamp,
    entityPath,
    revision: entity.revision,
    contentSha256: writtenSha,
    prevSha256: currentSha ?? undefined,
  });
  atomicWriteJson(file, entity);

  return { status: 'written', entity, baseline: baselineForRecord(entity) };
}

export function deleteSharedRecord(
  workspaceRootPath: string,
  collection: string,
  entityId: string,
  input: SharedRecordDeleteInput,
): SharedRecordWriteResult<SharedRecord> {
  const current = readSharedRecord(workspaceRootPath, collection, entityId);
  const currentSha = currentFileSha(getRecordFile(workspaceRootPath, collection, entityId));
  if (!current || input.baseline.revision !== current.revision || input.baseline.sha256 !== currentSha) {
    return {
      status: 'conflict',
      conflict: createConflictRecord(workspaceRootPath, {
        entityPath: recordEntityPath(collection, entityId),
        detectedByMachineId: input.machineId,
        baseRevision: input.baseline.revision,
        currentRevision: current?.revision,
        base: input.baseline.entity,
        current,
        incoming: { deletedAt: input.now ?? nowIso() },
        reason: 'stale-baseline',
      }),
    };
  }
  const timestamp = input.now ?? nowIso();
  let tombstone: SharedRecord = input.piiScrub
    ? {
        id: entityId,
        schemaVersion: current.schemaVersion,
        revision: current.revision + 1,
        createdAt: current.createdAt,
        createdByMachineId: current.createdByMachineId,
        updatedAt: timestamp,
        updatedByMachineId: input.machineId,
        deletedAt: timestamp,
        deletedByMachineId: input.machineId,
        emailHash: input.emailHash ?? (typeof current.emailHash === 'string' ? current.emailHash : undefined),
        purgeUndoFor: input.eraseUndo ? [entityId] : undefined,
        lastWriteSha256: currentSha ?? undefined,
      }
    : {
        ...current,
        updatedAt: timestamp,
        updatedByMachineId: input.machineId,
        revision: current.revision + 1,
        deletedAt: timestamp,
        deletedByMachineId: input.machineId,
        lastWriteSha256: currentSha ?? undefined,
      };
  const entityPath = recordEntityPath(collection, entityId);
  const op = persistRecordOp(workspaceRootPath, {
    at: timestamp,
    machineId: input.machineId,
    entityPath,
    kind: 'delete',
    parentOpIds: current.headOpId ? [current.headOpId] : [],
    baseSha256: currentSha ?? undefined,
  }, tombstone);
  tombstone = { ...tombstone, headOpId: op.opId };
  const writtenSha = sha256Json(tombstone);
  if (input.eraseUndo) {
    purgeUndo(workspaceRootPath, entityId);
    purgeRecordPayloads(workspaceRootPath, entityPath, op.opId);
    purgeOplogPayloads(workspaceRootPath, recordEntityPath(collection, entityId));
    if (input.piiScrub) purgeConflictArtifacts(workspaceRootPath, entityPath);
  } else {
    saveUndo(workspaceRootPath, current);
    saveUndo(workspaceRootPath, tombstone);
  }
  appendOplog(workspaceRootPath, {
    machineId: input.machineId,
    at: timestamp,
    entityPath,
    revision: tombstone.revision,
    contentSha256: writtenSha,
    prevSha256: currentSha ?? undefined,
  });
  atomicWriteJson(getRecordFile(workspaceRootPath, collection, entityId), tombstone);
  return { status: 'written', entity: tombstone, baseline: baselineForRecord(tombstone) } satisfies SharedRecordWriteSuccess;
}

function readOplogFile(file: string): SharedRecordOplogEntry[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const parsed = JSON.parse(line) as SharedRecordOplogEntry;
        return parsed?.version === 1 && typeof parsed.entityPath === 'string' ? [parsed] : [];
      } catch {
        return [];
      }
    });
}

export function readMachineOplog(workspaceRootPath: string, machineId: string): SharedRecordOplogEntry[] {
  return readOplogFile(getTeamOplogFile(workspaceRootPath, machineId));
}

export function readAllOplogs(workspaceRootPath: string): SharedRecordOplogEntry[] {
  const dir = join(workspaceRootPath, TEAM_OPLOG_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.jsonl'))
    .flatMap((name) => readOplogFile(join(dir, name)));
}

function purgeOplogPayloads(workspaceRootPath: string, entityPath: string): void {
  const dir = join(workspaceRootPath, TEAM_OPLOG_DIR);
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir).filter((entry) => entry.endsWith('.jsonl'))) {
    const file = join(dir, name);
    let changed = false;
    const scrubbed = readOplogFile(file).map((entry) => {
      if (entry.entityPath !== entityPath || entry.entity === undefined) return entry;
      changed = true;
      const { entity: _entity, ...withoutPayload } = entry;
      return withoutPayload;
    });
    if (changed) atomicWriteFile(file, scrubbed.map((entry) => JSON.stringify(entry)).join('\n') + '\n');
  }
}

function readEntityPath(workspaceRootPath: string, entityPath: string): SharedRecord | null {
  const file = resolve(workspaceRootPath, entityPath);
  if (!isContainedPath(workspaceRootPath, file) || !existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as SharedRecord;
  } catch {
    return null;
  }
}

function lineageReaches(targetSha: string, current: SharedRecord | null, oplogs: SharedRecordOplogEntry[]): boolean {
  if (!current?.lastWriteSha256) return false;
  const prevByContent = new Map(oplogs.map((entry) => [entry.contentSha256, entry.prevSha256]));
  const seen = new Set<string>();
  let cursor: string | undefined = current.lastWriteSha256;
  while (cursor && !seen.has(cursor) && seen.size < 100) {
    if (cursor === targetSha) return true;
    seen.add(cursor);
    cursor = prevByContent.get(cursor);
  }
  return false;
}

function deterministicConflictId(entityPath: string, headIds: string[]): string {
  return `conflict_${sha256Text(`${entityPath}\n${[...headIds].sort().join('\n')}`).slice(0, 20)}`;
}

function reconcileV2RecordOps(
  workspaceRootPath: string,
  machineId: string,
  now?: string,
): { issues: SharedRecordClobberIssue[]; managedPaths: Set<string> } {
  const byPath = new Map<string, ValidRecordOp[]>();
  for (const valid of readValidRecordOps(workspaceRootPath)) {
    const entries = byPath.get(valid.op.entityPath) ?? [];
    entries.push(valid);
    byPath.set(valid.op.entityPath, entries);
  }
  const issues: SharedRecordClobberIssue[] = [];
  for (const [entityPath, entries] of byPath) {
    const referenced = new Set(entries.flatMap(({ op }) => op.parentOpIds));
    const heads = entries
      .filter(({ op }) => !referenced.has(op.opId))
      .sort((a, b) => a.op.machineId.localeCompare(b.op.machineId) || a.op.opId.localeCompare(b.op.opId));
    if (!heads.length) continue;
    const canonicalFile = resolve(workspaceRootPath, entityPath);
    if (!isContainedPath(getRecordsDir(workspaceRootPath), canonicalFile)) continue;
    const current = readEntityPath(workspaceRootPath, entityPath);
    const purgeHead = heads.find(({ op, entity }) => op.kind === 'delete' && entity.purgeUndoFor?.includes(entity.id));
    if (purgeHead) {
      purgeRecordPayloads(workspaceRootPath, entityPath, purgeHead.op.opId);
      purgeOplogPayloads(workspaceRootPath, entityPath);
      purgeConflictArtifacts(workspaceRootPath, entityPath);
      if (current?.headOpId !== purgeHead.op.opId) atomicWriteJson(canonicalFile, purgeHead.entity);
      continue;
    }

    if (heads.length === 1) {
      const head = heads[0]!;
      if (current?.headOpId === head.op.opId) continue;
      const currentSha = existsSync(canonicalFile) ? sha256Text(readFileSync(canonicalFile, 'utf-8')) : null;
      const currentIsKnownAncestor = Boolean(current?.headOpId && entries.some(({ op }) => op.opId === current.headOpId));
      const legacyMatchesBase = !current?.headOpId && currentSha === (head.op.baseSha256 ?? null);
      if (!current || currentIsKnownAncestor || legacyMatchesBase) {
        atomicWriteJson(canonicalFile, head.entity);
        continue;
      }
      const unknownHead = current.headOpId ?? `legacy_${currentSha ?? 'missing'}`;
      const { conflict, created } = createConflictRecordWithState(workspaceRootPath, {
        conflictId: deterministicConflictId(entityPath, [head.op.opId, unknownHead]),
        entityPath,
        detectedAt: now,
        detectedByMachineId: machineId,
        sourceMachineId: head.op.machineId,
        baseRevision: head.entity.revision - 1,
        currentRevision: current.revision,
        mine: head.entity,
        current,
        incoming: [{ op: head.op, entity: head.entity }],
        reason: 'clobbered-write',
      });
      if (created) issues.push({ entry: head.op, conflict });
      continue;
    }

    const headIds = heads.map(({ op }) => op.opId);
    const { conflict, created } = createConflictRecordWithState(workspaceRootPath, {
      conflictId: deterministicConflictId(entityPath, headIds),
      entityPath,
      detectedAt: now,
      detectedByMachineId: machineId,
      baseRevision: Math.min(...heads.map(({ entity }) => entity.revision)) - 1,
      currentRevision: current?.revision,
      mine: heads[0]!.entity,
      current: heads[1]!.entity,
      incoming: heads.map(({ op, entity }) => ({ op, entity })),
      reason: 'clobbered-write',
    });
    if (created) issues.push({ entry: heads[0]!.op, conflict });
  }
  return { issues, managedPaths: new Set(byPath.keys()) };
}

export function detectClobberedWrites(
  workspaceRootPath: string,
  machineId: string,
  options: { now?: string } = {},
): SharedRecordClobberIssue[] {
  const v2 = reconcileV2RecordOps(workspaceRootPath, machineId, options.now);
  const all = readAllOplogs(workspaceRootPath);
  const issues: SharedRecordClobberIssue[] = [];
  const cutoff = Date.parse(options.now ?? nowIso()) - CLOBBER_DETECTION_WINDOW_MS;
  for (const entry of all) {
    if (v2.managedPaths.has(entry.entityPath)) continue;
    const entryAt = Date.parse(entry.at);
    if (Number.isFinite(entryAt) && entryAt < cutoff) continue;
    const file = resolve(workspaceRootPath, entry.entityPath);
    if (!isContainedPath(workspaceRootPath, file)) continue;
    const fileSha = existsSync(file) ? sha256Text(readFileSync(file, 'utf-8')) : null;
    if (fileSha === entry.contentSha256) continue;
    const current = readEntityPath(workspaceRootPath, entry.entityPath);
    if (lineageReaches(entry.contentSha256, current, all)) continue;
    const mine = entry.entity ?? readUndo(workspaceRootPath, basename(entry.entityPath, '.json'), entry.revision);
    const { conflict, created } = createConflictRecordWithState(workspaceRootPath, {
      entityPath: entry.entityPath,
      detectedAt: options.now,
      detectedByMachineId: machineId,
      sourceMachineId: entry.machineId,
      baseRevision: entry.revision - 1,
      currentRevision: current?.revision,
      mine,
      current,
      reason: 'clobbered-write',
    });
    if (created) issues.push({ entry, conflict });
  }
  return [...v2.issues, ...issues];
}

function canonicalEntityPathForProviderConflict(workspaceRootPath: string, file: string): string {
  const rel = relative(workspaceRootPath, file).split('\\').join('/');
  const dir = dirname(rel).split('\\').join('/');
  const name = basename(rel);
  const canonicalName = name
    .replace(/\s+\([^)]+(?:conflicted copy|case conflict)[^)]*\)(?=\.json$)/i, '')
    .replace(/\s+(?:conflicted copy|case conflict)(?=\.json$)/i, '');
  return dir === '.' ? canonicalName : `${dir}/${canonicalName}`;
}

export function isProviderConflictFilename(name: string): boolean {
  if (RECORD_CONFLICT_SCAN_IGNORE_PATTERNS.some((pattern) => pattern.test(name))) return false;
  return /\.json$/i.test(name) && (
    /\bconflicted copy\b/i.test(name)
    || /\bcase conflict\b/i.test(name)
    || /\([^)]+conflicted copy[^)]*\)/i.test(name)
    || /\([^)]+case conflict[^)]*\)/i.test(name)
  );
}

function walkFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(path));
    else if (entry.isFile()) out.push(path);
  }
  return out;
}

export function scanProviderConflictedCopies(
  workspaceRootPath: string,
  options: { machineId: string; now?: string },
): SharedRecordConflict[] {
  const recordsRoot = getRecordsDir(workspaceRootPath);
  const conflicts: SharedRecordConflict[] = [];
  for (const file of walkFiles(recordsRoot)) {
    if (!isProviderConflictFilename(basename(file))) continue;
    let incoming: unknown = undefined;
    try { incoming = JSON.parse(readFileSync(file, 'utf-8')); } catch { /* keep undefined */ }
    const providerConflictPath = relative(workspaceRootPath, file).split('\\').join('/');
    const { conflict, created } = createConflictRecordWithState(workspaceRootPath, {
      entityPath: canonicalEntityPathForProviderConflict(workspaceRootPath, file),
      detectedAt: options.now,
      detectedByMachineId: options.machineId,
      incoming,
      providerConflictPath,
      reason: 'provider-conflicted-copy',
    });
    if (created) conflicts.push(conflict);
  }
  return conflicts;
}

export function listConflictRecords(workspaceRootPath: string): SharedRecordConflict[] {
  return inspectConflictRecords(workspaceRootPath).conflicts;
}

export function inspectConflictRecords(workspaceRootPath: string): { conflicts: SharedRecordConflict[]; errors: string[] } {
  const dir = getTeamConflictsDir(workspaceRootPath);
  if (!existsSync(dir)) return { conflicts: [], errors: [] };
  const conflicts: SharedRecordConflict[] = [];
  const errors: string[] = [];
  let names: string[];
  try {
    names = readdirSync(dir).filter((name) => name.endsWith('.json'));
  } catch (error) {
    return { conflicts: [], errors: [error instanceof Error ? error.message : String(error)] };
  }
  for (const name of names) {
    try {
      const parsed = JSON.parse(readFileSync(join(dir, name), 'utf-8')) as SharedRecordConflict;
      if (parsed?.version === 1) conflicts.push(parsed);
      else errors.push(`${name}: unsupported conflict record`);
    } catch (error) {
      errors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return {
    conflicts: conflicts.sort((a, b) => b.detectedAt.localeCompare(a.detectedAt)),
    errors,
  };
}

export function statRecordFile(workspaceRootPath: string, collection: string, entityId: string): { size: number; mtimeMs: number } | null {
  try {
    const stat = statSync(getRecordFile(workspaceRootPath, collection, entityId));
    return { size: stat.size, mtimeMs: stat.mtimeMs };
  } catch {
    return null;
  }
}
