import type { PermissionMode } from '../agent/mode-types.ts';
import type { JsonSchema } from '../workflows/types.ts';

/**
 * Canonical agent-to-agent delegation contract.
 *
 * One envelope for every "agent A asked agent B to do a bounded task and got a
 * structured result back" interaction, whether the caller is a team lead waking
 * a member, a workflow step, or a `message_agent` tool call. The field shape is
 * deliberately aligned with `agent-messaging`'s `AgentMessageReceipt` /
 * `MessageAgentResult` so that, when the agent-messaging branch merges, that
 * subsystem can adopt these types directly (or alias to them) with only a thin
 * adapter — no second integration project. Team-specific linkage
 * (`teamRunId` / `teamTaskId`) is optional and ignored by non-team callers.
 */
export type DelegationStatus = 'running' | 'succeeded' | 'failed' | 'cancelled' | 'timed-out';

export interface DelegationPolicy {
  permissionMode: PermissionMode;
  timeoutSeconds: number;
  maxTurns: number;
  maxDepth: number;
  depth: number;
}

export interface DelegationConstraints {
  sourceSlugs: string[];
  skillSlugs: string[];
  outputSchema?: JsonSchema;
}

export interface DelegationOutcome {
  output?: unknown;
  summary?: string;
  toolUseCount: number;
  toolNames: string[];
}

export interface DelegationError {
  code: string;
  message: string;
}

/**
 * Records how the child's permission mode was derived from the parent's. The
 * canonical inheritance rule is "child may never exceed parent" — see
 * {@link clampPermissionMode}. `clamped` is true when the requested mode was
 * more permissive than the parent and had to be narrowed.
 */
export interface PermissionInheritance {
  parentMode: PermissionMode;
  requestedMode: PermissionMode;
  effectiveMode: PermissionMode;
  clamped: boolean;
}

export interface DelegationReceipt {
  schemaVersion: 1;
  id: string;
  workspaceId: string;
  /** Trace linkage to the caller. */
  parentSessionId?: string;
  parentRunId?: string;
  parentStepId?: string;
  /** Team linkage (present when the delegation originated inside a team run). */
  teamRunId?: string;
  teamTaskId?: string;
  childSessionId?: string;
  callerAgentSlug?: string;
  targetAgentSlug: string;
  task: string;
  status: DelegationStatus;
  policy: DelegationPolicy;
  permissionInheritance: PermissionInheritance;
  constraints: DelegationConstraints;
  result?: DelegationOutcome;
  error?: DelegationError;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

/**
 * Compact result returned to the caller of a delegation. Mirrors
 * `MessageAgentResult` field-for-field so the two converge on merge.
 */
export interface DelegationResult {
  ok: boolean;
  receiptId?: string;
  childSessionId?: string;
  agentSlug: string;
  output?: unknown;
  summary?: string;
  toolUseCount: number;
  toolNames: string[];
  durationMs: number;
  error?: DelegationError;
}

export interface CreateDelegationReceiptInput {
  workspaceId: string;
  targetAgentSlug: string;
  task: string;
  callerAgentSlug?: string;
  parentSessionId?: string;
  parentRunId?: string;
  parentStepId?: string;
  teamRunId?: string;
  teamTaskId?: string;
  childSessionId?: string;
  policy: DelegationPolicy;
  permissionInheritance: PermissionInheritance;
  constraints?: Partial<DelegationConstraints>;
}
