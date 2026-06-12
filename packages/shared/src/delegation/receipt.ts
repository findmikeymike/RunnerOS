import { randomUUID } from 'node:crypto';
import { PERMISSION_MODE_ORDER, type PermissionMode } from '../agent/mode-types.ts';
import type {
  CreateDelegationReceiptInput,
  DelegationError,
  DelegationOutcome,
  DelegationReceipt,
  DelegationStatus,
  PermissionInheritance,
} from './types.ts';

const STATUSES: ReadonlySet<DelegationStatus> = new Set(['running', 'succeeded', 'failed', 'cancelled', 'timed-out']);

/** Privilege rank — higher index = more permissive. */
function permissionRank(mode: PermissionMode): number {
  const idx = PERMISSION_MODE_ORDER.indexOf(mode);
  return idx < 0 ? 0 : idx;
}

/** True when `requested` grants more privilege than `parent` allows. */
export function isPermissionEscalation(parent: PermissionMode, requested: PermissionMode): boolean {
  return permissionRank(requested) > permissionRank(parent);
}

/**
 * Canonical permission-inheritance rule: a child delegation may never exceed
 * its parent's permission mode. Returns the more restrictive of the two.
 */
export function clampPermissionMode(parent: PermissionMode, requested: PermissionMode): PermissionMode {
  return permissionRank(requested) > permissionRank(parent) ? parent : requested;
}

/** Build a {@link PermissionInheritance} record applying the clamp rule. */
export function derivePermissionInheritance(parent: PermissionMode, requested: PermissionMode): PermissionInheritance {
  const effectiveMode = clampPermissionMode(parent, requested);
  return {
    parentMode: parent,
    requestedMode: requested,
    effectiveMode,
    clamped: effectiveMode !== requested,
  };
}

export function isDelegationReceipt(value: unknown): value is DelegationReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  if (r.schemaVersion !== 1) return false;
  if (typeof r.id !== 'string' || !r.id) return false;
  if (typeof r.workspaceId !== 'string' || !r.workspaceId) return false;
  if (typeof r.targetAgentSlug !== 'string' || !r.targetAgentSlug) return false;
  if (typeof r.task !== 'string') return false;
  if (typeof r.status !== 'string' || !STATUSES.has(r.status as DelegationStatus)) return false;
  if (!r.policy || typeof r.policy !== 'object') return false;
  if (!r.permissionInheritance || typeof r.permissionInheritance !== 'object') return false;
  if (!r.constraints || typeof r.constraints !== 'object') return false;
  if (typeof r.createdAt !== 'string' || typeof r.updatedAt !== 'string') return false;
  return true;
}

export function createDelegationReceipt(
  input: CreateDelegationReceiptInput,
  now: Date = new Date(),
): DelegationReceipt {
  const iso = now.toISOString();
  const receipt: DelegationReceipt = {
    schemaVersion: 1,
    id: `dlg_${randomUUID()}`,
    workspaceId: input.workspaceId,
    parentSessionId: input.parentSessionId,
    parentRunId: input.parentRunId,
    parentStepId: input.parentStepId,
    teamRunId: input.teamRunId,
    teamTaskId: input.teamTaskId,
    childSessionId: input.childSessionId,
    callerAgentSlug: input.callerAgentSlug,
    targetAgentSlug: input.targetAgentSlug,
    task: input.task,
    status: 'running',
    policy: input.policy,
    permissionInheritance: input.permissionInheritance,
    constraints: {
      sourceSlugs: input.constraints?.sourceSlugs ?? [],
      skillSlugs: input.constraints?.skillSlugs ?? [],
      outputSchema: input.constraints?.outputSchema,
    },
    createdAt: iso,
    updatedAt: iso,
  };
  if (!isDelegationReceipt(receipt)) throw new Error('Constructed an invalid delegation receipt.');
  return receipt;
}

/** Transition a receipt to a terminal success state with its result. */
export function succeedDelegationReceipt(
  receipt: DelegationReceipt,
  result: DelegationOutcome,
  childSessionId?: string,
  now: Date = new Date(),
): DelegationReceipt {
  const iso = now.toISOString();
  return {
    ...receipt,
    status: 'succeeded',
    childSessionId: childSessionId ?? receipt.childSessionId,
    result,
    updatedAt: iso,
    completedAt: iso,
  };
}

/** Transition a receipt to a terminal failure/cancel/timeout state. */
export function failDelegationReceipt(
  receipt: DelegationReceipt,
  status: Extract<DelegationStatus, 'failed' | 'cancelled' | 'timed-out'>,
  error: DelegationError,
  now: Date = new Date(),
): DelegationReceipt {
  const iso = now.toISOString();
  return {
    ...receipt,
    status,
    error,
    updatedAt: iso,
    completedAt: iso,
  };
}

/** Project a receipt into the compact caller-facing {@link DelegationResult}. */
export function toDelegationResult(receipt: DelegationReceipt): import('./types.ts').DelegationResult {
  const durationMs = receipt.completedAt
    ? Math.max(0, Date.parse(receipt.completedAt) - Date.parse(receipt.createdAt))
    : 0;
  return {
    ok: receipt.status === 'succeeded',
    receiptId: receipt.id,
    childSessionId: receipt.childSessionId,
    agentSlug: receipt.targetAgentSlug,
    output: receipt.result?.output,
    summary: receipt.result?.summary,
    toolUseCount: receipt.result?.toolUseCount ?? 0,
    toolNames: receipt.result?.toolNames ?? [],
    durationMs,
    error: receipt.error,
  };
}
