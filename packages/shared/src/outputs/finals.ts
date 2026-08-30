import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  OutputFinalPointer,
  OutputFinalScope,
  OutputFinalsRegistry,
  OutputManifest,
  PromoteOutputToFinalInput,
  RemoveOutputFromFinalInput,
} from './types.ts';
import {
  loadContextDoc,
  upsertContextDoc,
} from '../workspace-context/storage.ts';

export const OUTPUT_FINALS_CONTEXT_SLUG = 'finals';

const EMPTY_REGISTRY: OutputFinalsRegistry = {
  schemaVersion: 1,
  updatedAt: '1970-01-01T00:00:00.000Z',
  finals: [],
};
const FINAL_LOCK_TIMEOUT_MS = 5_000;
const FINAL_LOCK_STALE_MS = 30_000;

export interface ReadOutputFinalsRegistryOptions {
  strict?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function finalsLockDir(workspaceRootPath: string): string {
  return join(workspaceRootPath, 'context', '.locks', 'output-finals.lock');
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

export function withOutputFinalsRegistryLock<T>(
  workspaceRootPath: string,
  fn: () => T,
  options: { timeoutMs?: number } = {},
): T {
  const lockDir = finalsLockDir(workspaceRootPath);
  const deadline = Date.now() + (options.timeoutMs ?? FINAL_LOCK_TIMEOUT_MS);
  mkdirSync(dirname(lockDir), { recursive: true });
  while (true) {
    try {
      mkdirSync(lockDir, { recursive: false });
      break;
    } catch (err) {
      if (!isNodeError(err) || err.code !== 'EEXIST') throw err;
      try {
        const stat = statSync(lockDir);
        if (Date.now() - stat.mtimeMs > FINAL_LOCK_STALE_MS) {
          rmSync(lockDir, { recursive: true, force: true });
          continue;
        }
      } catch {
        if (Date.now() >= deadline) {
          throw new Error('Timed out waiting for Finals registry lock.');
        }
        sleepSync(25);
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error('Timed out waiting for Finals registry lock.');
      }
      sleepSync(25);
    }
  }

  try {
    return fn();
  } finally {
    rmSync(lockDir, { recursive: true, force: true });
  }
}

function normalizeSlot(slot: string): string {
  return slot
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function displayFinalSlot(slot: string): string {
  return slot
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function finalIdentity(input: {
  scope: OutputFinalScope;
  campaignId?: string;
  slot: string;
  outputId: string;
  assetId?: string;
}): string {
  return createHash('sha256')
    .update([
      input.scope,
      input.campaignId ?? '',
      input.slot,
      input.outputId,
      input.assetId ?? '',
    ].join('\0'))
    .digest('hex')
    .slice(0, 24);
}

function isFinalPointer(value: unknown): value is OutputFinalPointer {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string' || !value.id) return false;
  if (value.scope !== 'hq' && value.scope !== 'campaign') return false;
  if (value.campaignId !== undefined && typeof value.campaignId !== 'string') return false;
  if (typeof value.slot !== 'string' || !value.slot) return false;
  if (typeof value.outputId !== 'string' || !value.outputId) return false;
  if (value.assetId !== undefined && typeof value.assetId !== 'string') return false;
  if (typeof value.isPrimary !== 'boolean') return false;
  if (typeof value.promotedAt !== 'string' || Number.isNaN(Date.parse(value.promotedAt))) return false;
  if (value.promotedBy !== 'user' && value.promotedBy !== 'agent') return false;
  if (value.note !== undefined && typeof value.note !== 'string') return false;
  return true;
}

function invalidFinalsRegistryError(reason: string): Error {
  return new Error(`Finals registry is invalid; repair context/finals/CONTEXT.md before updating Finals. ${reason}`);
}

export function readOutputFinalsRegistry(
  workspaceRootPath: string,
  options: ReadOutputFinalsRegistryOptions = {},
): OutputFinalsRegistry {
  const doc = loadContextDoc(workspaceRootPath, OUTPUT_FINALS_CONTEXT_SLUG);
  if (!doc) return { ...EMPTY_REGISTRY, finals: [] };
  try {
    const parsed = JSON.parse(doc.body) as unknown;
    if (!isRecord(parsed) || parsed.schemaVersion !== 1 || !Array.isArray(parsed.finals)) {
      if (options.strict) throw invalidFinalsRegistryError('Expected schemaVersion 1 with a finals array.');
      return { ...EMPTY_REGISTRY, finals: [] };
    }
    if (options.strict && !parsed.finals.every(isFinalPointer)) {
      throw invalidFinalsRegistryError('One or more final pointers are malformed.');
    }
    return {
      schemaVersion: 1,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : EMPTY_REGISTRY.updatedAt,
      finals: parsed.finals.filter(isFinalPointer),
    };
  } catch (err) {
    if (options.strict) {
      if (err instanceof Error && err.message.startsWith('Finals registry is invalid;')) throw err;
      throw invalidFinalsRegistryError(err instanceof Error ? err.message : String(err));
    }
    return { ...EMPTY_REGISTRY, finals: [] };
  }
}

export function writeOutputFinalsRegistry(workspaceRootPath: string, registry: OutputFinalsRegistry): OutputFinalsRegistry {
  const normalized: OutputFinalsRegistry = {
    schemaVersion: 1,
    updatedAt: registry.updatedAt,
    finals: registry.finals,
  };
  upsertContextDoc(workspaceRootPath, {
    slug: OUTPUT_FINALS_CONTEXT_SLUG,
    metadata: {
      name: 'Legacy Finals Pointers',
      description: 'Compatibility pointers retained for migration into campaign Release Kits.',
      routing: { mode: 'broadcast' },
      delivery: 'on-demand',
      enabled: true,
    },
    body: JSON.stringify(normalized, null, 2),
  });
  return normalized;
}

export function promoteOutputToFinal(
  workspaceRootPath: string,
  output: OutputManifest,
  input: PromoteOutputToFinalInput,
): OutputFinalPointer {
  return withOutputFinalsRegistryLock(workspaceRootPath, () => promoteOutputToFinalInsideLock(workspaceRootPath, output, input));
}

export function removeOutputFromFinal(workspaceRootPath: string, input: RemoveOutputFromFinalInput): number {
  return withOutputFinalsRegistryLock(workspaceRootPath, () => removeOutputFromFinalInsideLock(workspaceRootPath, input));
}

export function promoteOutputToFinalInsideLock(
  workspaceRootPath: string,
  output: OutputManifest,
  input: PromoteOutputToFinalInput,
): OutputFinalPointer {
  if (input.scope !== 'hq' && input.scope !== 'campaign') throw new Error('scope must be hq or campaign.');
  if (input.scope === 'campaign' && !input.campaignId?.trim()) throw new Error('campaignId is required for campaign finals.');
  const slot = normalizeSlot(input.slot);
  if (!slot) throw new Error('slot is required.');
  const assetId = input.assetId?.trim() || output.primary?.id || output.assets[0]?.id;
  if (assetId && !output.assets.some((asset) => asset.id === assetId)) {
    throw new Error(`Output "${output.id}" has no asset "${assetId}".`);
  }

  const registry = readOutputFinalsRegistry(workspaceRootPath, { strict: true });
  const now = new Date().toISOString();
  const identity = finalIdentity({
    scope: input.scope,
    campaignId: input.scope === 'campaign' ? input.campaignId?.trim() : undefined,
    slot,
    outputId: output.id,
    assetId,
  });
  const pointer: OutputFinalPointer = {
    id: `final_${identity}`,
    scope: input.scope,
    ...(input.scope === 'campaign' ? { campaignId: input.campaignId!.trim() } : {}),
    slot,
    outputId: output.id,
    ...(assetId ? { assetId } : {}),
    isPrimary: Boolean(input.makePrimary),
    promotedAt: now,
    promotedBy: input.promotedBy ?? 'user',
    ...(input.note?.trim() ? { note: input.note.trim() } : {}),
  };

  const nextFinals = registry.finals
    .filter((entry) => entry.id !== pointer.id)
    .map((entry) => {
      const sameSlot = entry.scope === pointer.scope
        && (entry.campaignId ?? '') === (pointer.campaignId ?? '')
        && entry.slot === pointer.slot;
      return pointer.isPrimary && sameSlot ? { ...entry, isPrimary: false } : entry;
    });
  nextFinals.push(pointer);
  writeOutputFinalsRegistry(workspaceRootPath, {
    schemaVersion: 1,
    updatedAt: now,
    finals: nextFinals,
  });
  return pointer;
}

export function removeOutputFromFinalInsideLock(workspaceRootPath: string, input: RemoveOutputFromFinalInput): number {
  const registry = readOutputFinalsRegistry(workspaceRootPath, { strict: true });
  const before = registry.finals.length;
  const next = registry.finals.filter((entry) => {
    if (entry.outputId !== input.outputId) return true;
    if (input.scope && entry.scope !== input.scope) return true;
    if (input.campaignId !== undefined && (entry.campaignId ?? '') !== input.campaignId) return true;
    if (input.slot !== undefined && entry.slot !== normalizeSlot(input.slot)) return true;
    if (input.assetId !== undefined && (entry.assetId ?? '') !== input.assetId) return true;
    return false;
  });
  const removed = before - next.length;
  if (removed > 0) {
    writeOutputFinalsRegistry(workspaceRootPath, {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      finals: next,
    });
  }
  return removed;
}

export function attachFinalsToOutputs<T extends { id: string }>(
  outputs: T[],
  finals: OutputFinalPointer[],
): Array<T & { finals?: OutputFinalPointer[] }> {
  const byOutput = new Map<string, OutputFinalPointer[]>();
  for (const entry of finals) {
    const list = byOutput.get(entry.outputId) ?? [];
    list.push(entry);
    byOutput.set(entry.outputId, list);
  }
  return outputs.map((output) => {
    const outputFinals = byOutput.get(output.id);
    return outputFinals?.length ? { ...output, finals: outputFinals } : output;
  });
}

export function makeManualOutputId(): string {
  return randomUUID();
}
