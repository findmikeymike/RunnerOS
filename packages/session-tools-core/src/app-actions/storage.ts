import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { AppActionReceipt, AppActionRuntimeContext, AppActionSurface } from './types.ts';

export function getWorkspaceId(ctx: AppActionRuntimeContext): string {
  return ctx.workspaceId?.trim() || basename(ctx.workspacePath);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`).join(',')}}`;
}

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function appActionsRoot(ctx: AppActionRuntimeContext): string {
  return join(ctx.workspacePath, '.runneros', 'app-actions');
}

function receiptDir(ctx: AppActionRuntimeContext, createdAt: string): string {
  const date = new Date(createdAt);
  const yyyy = String(date.getUTCFullYear());
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  return join(appActionsRoot(ctx), 'receipts', yyyy, mm);
}

function receiptIndexDir(ctx: AppActionRuntimeContext): string {
  return join(appActionsRoot(ctx), 'receipt-index');
}

function idempotencyDir(ctx: AppActionRuntimeContext): string {
  return join(appActionsRoot(ctx), 'idempotency');
}

export function buildIdempotencyKey(input: {
  workspaceId: string;
  actionId: string;
  actorStableId: string;
  requestId: string;
  normalizedInput: unknown;
}): string {
  return sha256(stableStringify(input));
}

export function writeReceipt(ctx: AppActionRuntimeContext, receipt: AppActionReceipt): AppActionReceipt {
  const dir = receiptDir(ctx, receipt.createdAt);
  const indexDir = receiptIndexDir(ctx);
  mkdirSync(dir, { recursive: true });
  mkdirSync(indexDir, { recursive: true });
  const file = join(dir, `${receipt.id}.json`);
  writeFileSync(file, JSON.stringify(receipt, null, 2) + '\n', 'utf-8');
  writeFileSync(join(indexDir, `${receipt.id}.json`), JSON.stringify({ file }, null, 2) + '\n', 'utf-8');
  return receipt;
}

export function readReceipt(ctx: AppActionRuntimeContext, receiptId: string): AppActionReceipt | null {
  const indexFile = join(receiptIndexDir(ctx), `${receiptId}.json`);
  if (!existsSync(indexFile)) return null;
  try {
    const pointer = JSON.parse(readFileSync(indexFile, 'utf-8')) as { file?: unknown };
    if (typeof pointer.file !== 'string' || !existsSync(pointer.file)) return null;
    return JSON.parse(readFileSync(pointer.file, 'utf-8')) as AppActionReceipt;
  } catch {
    return null;
  }
}

export function readIdempotencyReceipt(ctx: AppActionRuntimeContext, idempotencyKey: string): AppActionReceipt | null {
  return readIdempotencyEntry(ctx, idempotencyKey)?.receipt ?? null;
}

export function readIdempotencyEntry(
  ctx: AppActionRuntimeContext,
  idempotencyKey: string,
): { receipt: AppActionReceipt; receiptId: string; updatedAt?: string } | null {
  const file = join(idempotencyDir(ctx), `${idempotencyKey}.json`);
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as { receiptId?: unknown; updatedAt?: unknown };
    if (typeof parsed.receiptId !== 'string') return null;
    const receipt = readReceipt(ctx, parsed.receiptId);
    if (!receipt) return null;
    return {
      receipt,
      receiptId: parsed.receiptId,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : undefined,
    };
  } catch {
    return null;
  }
}

export function writeIdempotency(ctx: AppActionRuntimeContext, idempotencyKey: string, receiptId: string): void {
  const dir = idempotencyDir(ctx);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${idempotencyKey}.json`),
    JSON.stringify({ receiptId, updatedAt: nowIso() }, null, 2) + '\n',
    'utf-8',
  );
}

function writeJsonAtomic(file: string, value: unknown): void {
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf-8');
  renameSync(tmp, file);
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function withFileLock<T>(file: string, fn: () => T): T {
  const lockFile = `${file}.lock`;
  const startedAt = Date.now();
  let fd: number | null = null;
  while (fd === null) {
    try {
      fd = openSync(lockFile, 'wx');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') throw error;
      try {
        const ageMs = Date.now() - statSync(lockFile).mtimeMs;
        if (ageMs > 30000) {
          rmSync(lockFile, { force: true });
          continue;
        }
      } catch {
        rmSync(lockFile, { force: true });
        continue;
      }
      if (Date.now() - startedAt > 5000) {
        throw new Error(`Timed out waiting for app action storage lock: ${lockFile}`);
      }
      sleepSync(10);
    }
  }
  try {
    return fn();
  } finally {
    closeSync(fd);
    rmSync(lockFile, { force: true });
  }
}

export function appendSurfaceRecord<T extends Record<string, unknown>>(
  ctx: AppActionRuntimeContext,
  surface: AppActionSurface,
  recordType: string,
  record: T,
): T & { id: string; createdAt: string; updatedAt: string } {
  const dir = join(appActionsRoot(ctx), 'surfaces', surface);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${recordType}.json`);
  return withFileLock(file, () => {
    let existing: Array<Record<string, unknown>> = [];
    if (existsSync(file)) {
      try {
        const parsed = JSON.parse(readFileSync(file, 'utf-8'));
        if (Array.isArray(parsed)) existing = parsed as Array<Record<string, unknown>>;
      } catch {
        existing = [];
      }
    }
    const now = nowIso();
    const next = {
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      ...record,
    };
    existing.push(next);
    writeJsonAtomic(file, existing);
    return next;
  });
}

function normalizedComparable(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim().toLowerCase() : null;
}

export function upsertSurfaceRecord<T extends Record<string, unknown>>(
  ctx: AppActionRuntimeContext,
  surface: AppActionSurface,
  recordType: string,
  record: T,
  matchFields: string[],
): T & { id: string; createdAt: string; updatedAt: string } {
  const dir = join(appActionsRoot(ctx), 'surfaces', surface);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${recordType}.json`);
  return withFileLock(file, () => {
    let existing: Array<Record<string, unknown>> = [];
    if (existsSync(file)) {
      try {
        const parsed = JSON.parse(readFileSync(file, 'utf-8'));
        if (Array.isArray(parsed)) existing = parsed as Array<Record<string, unknown>>;
      } catch {
        existing = [];
      }
    }

    const now = nowIso();
    const matchIndex = existing.findIndex((entry) => matchFields.some((field) => {
      const nextValue = normalizedComparable(record[field]);
      if (!nextValue) return false;
      return normalizedComparable(entry[field]) === nextValue;
    }));

    let next: Record<string, unknown>;
    if (matchIndex >= 0) {
      const current = existing[matchIndex] ?? {};
      next = {
        ...current,
        ...record,
        id: typeof current.id === 'string' ? current.id : randomUUID(),
        createdAt: typeof current.createdAt === 'string' ? current.createdAt : now,
        updatedAt: now,
      };
      existing[matchIndex] = next;
    } else {
      next = {
        id: randomUUID(),
        createdAt: now,
        updatedAt: now,
        ...record,
      };
      existing.push(next);
    }
    writeJsonAtomic(file, existing);
    return next as T & { id: string; createdAt: string; updatedAt: string };
  });
}
