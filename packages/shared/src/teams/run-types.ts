import type { PermissionMode } from '../agent/mode-types.ts';
import type { JsonSchema } from '../workflows/types.ts';
import type { TeamMetadata } from './types.ts';

export type TeamRunState = 'created' | 'running' | 'paused' | 'blocked' | 'review' | 'done' | 'failed' | 'cancelled';
export type TeamTaskStatus = 'todo' | 'in_progress' | 'blocked' | 'review' | 'done' | 'failed';
export type TeamTaskPriority = 'low' | 'normal' | 'high';
export type TeamMessageActor = string | 'user' | 'system';
export type TeamMessageTarget = string | 'lead' | 'all';
export type TeamMessageKind = 'assignment' | 'question' | 'result' | 'review' | 'note';
export type TeamRunEventKind =
  | 'run.created'
  | 'run.updated'
  | 'task.created'
  | 'task.updated'
  | 'message.sent'
  | 'session.linked'
  | 'review.requested'
  | 'approval.requested'
  | 'task.leased'
  | 'task.heartbeat'
  | 'task.lease_expired'
  | 'run.completed'
  | 'run.tick'
  | 'run.paused'
  | 'run.resumed'
  | 'run.cancelled'
  | 'wake.enqueued'
  | 'wake.delivered'
  | 'wake.failed'
  | 'wake.acked';

/** Kind of durable wake queued in the run mailbox. */
export type TeamWakeKind = 'wake-member' | 'wake-lead' | 'finalization';

/**
 * Delivery lifecycle of a mailbox wake.
 * `pending` → `delivered` → `acked` on the happy path; `pending` → `failed`
 * once delivery attempts exhaust the budget. A failed redelivery returns a
 * `delivered` entry to `pending` for retry until the budget is spent.
 */
export type TeamWakeStatus = 'pending' | 'delivered' | 'acked' | 'failed';

export interface TeamWakeEntry {
  id: string;
  runId: string;
  /** Recipient agent slug (a team member, or the lead). */
  targetAgentSlug: string;
  taskId?: string;
  kind: TeamWakeKind;
  body: string;
  status: TeamWakeStatus;
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  updatedAt: string;
  deliveredAt?: string;
  ackedAt?: string;
  lastError?: string;
}

export interface EnqueueTeamWakeInput {
  targetAgentSlug: string;
  taskId?: string;
  kind: TeamWakeKind;
  body: string;
  maxAttempts?: number;
}

export interface TeamTaskEvidence {
  type: 'text' | 'file' | 'url' | 'output';
  label: string;
  value: string;
}

export interface TeamTaskReview {
  requestedAt: string;
  reviewerAgentSlug: string;
  status: 'requested' | 'passed' | 'failed';
  findings?: string;
  reviewedAt?: string;
}

export interface TeamTaskApproval {
  requestedAt: string;
  requestedByAgentSlug: TeamMessageActor;
  reason: string;
  status: 'requested' | 'approved' | 'rejected';
  decidedAt?: string;
  decisionNote?: string;
}

export interface TeamTask {
  id: string;
  runId: string;
  title: string;
  description: string;
  ownerAgentSlug: string;
  status: TeamTaskStatus;
  priority: TeamTaskPriority;
  inputs: Record<string, unknown>;
  output?: string;
  /**
   * Optional JSON Schema the task's `output` must satisfy before the task can
   * move to `review` or `done`. Enforced in {@link updateTeamTask}. Lets a lead
   * demand a machine-readable result shape from a specialist instead of prose.
   */
  outputSchema?: JsonSchema;
  evidence?: TeamTaskEvidence[];
  approvalRequired?: boolean;
  approval?: TeamTaskApproval;
  reviewRequired?: boolean;
  reviewerAgentSlug?: string;
  review?: TeamTaskReview;
  /** Number of times this task was reopened by a failed review (revise loop). */
  revisionCount?: number;
  /**
   * Max failed-review reopens before the task is failed instead of reopened.
   * Distinct from {@link maxAttempts} (claim/lease retry budget). Defaults to
   * `swarm.retryLimit + 1` when absent.
   */
  maxRevisions?: number;
  /** Findings from the most recent failed review, surfaced to the owner on reopen. */
  reviseFindings?: string;
  blockedReason?: string;
  attemptCount?: number;
  maxAttempts?: number;
  lease?: {
    id: string;
    ownerAgentSlug: string;
    claimedAt: string;
    heartbeatAt: string;
    expiresAt: string;
  };
  lastError?: string;
  nextAttemptAt?: string;
  lastWakeAt?: string;
  lastWakeReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TeamMessage {
  id: string;
  runId: string;
  fromAgentSlug: TeamMessageActor;
  toAgentSlug: TeamMessageTarget;
  taskId?: string;
  kind: TeamMessageKind;
  body: string;
  createdAt: string;
  readAt?: string;
}

export interface TeamRunEvent {
  id: string;
  runId: string;
  kind: TeamRunEventKind;
  actorAgentSlug?: TeamMessageActor;
  taskId?: string;
  messageId?: string;
  body?: string;
  createdAt: string;
}

export interface TeamRunSnapshot {
  id: string;
  /**
   * Monotonic revision counter, incremented on every persisted mutation of the
   * run snapshot. Used for optimistic-concurrency detection across processes
   * (standalone server + Electron) via {@link writeTeamRunGuarded}. Absent on
   * legacy runs written before versioning; treated as 0.
   */
  rev?: number;
  workspaceId: string;
  teamSlug: string;
  state: TeamRunState;
  userRequest: string;
  leadSessionId?: string;
  memberSessionIds?: Record<string, string>;
  teamSnapshot: {
    metadata: TeamMetadata;
    body: string;
  };
  permissionMode?: PermissionMode;
  swarm?: TeamRunSwarmPolicy;
  finalSummary?: string;
  finalEvidence?: TeamTaskEvidence[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface TeamRunSwarmPolicy {
  maxConcurrentTasks: number;
  taskLeaseMs: number;
  heartbeatIntervalMs: number;
  staleAfterMs: number;
  retryLimit: number;
  retryBackoffMs: number;
  autoRun?: boolean;
  tickIntervalMs?: number;
  leadWakeCooldownMs?: number;
  memberWakeCooldownMs?: number;
  operatorPausedAt?: string;
  operatorPausedReason?: string;
}

export interface TeamRunDetail extends TeamRunSnapshot {
  tasks: TeamTask[];
  messages: TeamMessage[];
  events: TeamRunEvent[];
}

export interface StartTeamRunInput {
  teamSlug: string;
  userRequest: string;
  swarm?: Partial<TeamRunSwarmPolicy>;
}

export interface CreateTeamTaskInput {
  title: string;
  description: string;
  ownerAgentSlug: string;
  priority?: TeamTaskPriority;
  inputs?: Record<string, unknown>;
  outputSchema?: JsonSchema;
  approvalRequired?: boolean;
  reviewRequired?: boolean;
  reviewerAgentSlug?: string;
  maxAttempts?: number;
  maxRevisions?: number;
}

export interface UpdateTeamTaskInput {
  title?: string;
  description?: string;
  ownerAgentSlug?: string;
  status?: TeamTaskStatus;
  priority?: TeamTaskPriority;
  inputs?: Record<string, unknown>;
  output?: string;
  outputSchema?: JsonSchema;
  evidence?: TeamTaskEvidence[];
  approvalRequired?: boolean;
  approval?: TeamTaskApproval;
  reviewRequired?: boolean;
  reviewerAgentSlug?: string;
  review?: TeamTaskReview;
  blockedReason?: string;
  lastError?: string;
  nextAttemptAt?: string;
}

export interface ClaimTeamTaskInput {
  agentSlug: string;
  taskId?: string;
  leaseTtlMs?: number;
}

export interface HeartbeatTeamTaskInput {
  agentSlug: string;
  taskId: string;
  leaseId: string;
  leaseTtlMs?: number;
}

export interface TeamRunControlInput {
  action: 'pause' | 'resume' | 'cancel';
  reason?: string;
}

export type TeamRunTickReason = 'scheduled' | 'manual' | 'startup-recovery';
export type TeamRunTickActionType =
  | 'expired-lease'
  | 'wake-lead'
  | 'wake-member'
  | 'no-op'
  | 'finalization-needed'
  | 'error';

export interface TeamRunTickAction {
  type: TeamRunTickActionType;
  taskId?: string;
  agentSlug?: string;
  sessionId?: string;
  message?: string;
}

export interface TeamRunTick {
  id: string;
  runId: string;
  reason: TeamRunTickReason;
  startedAt: string;
  completedAt: string;
  actions: TeamRunTickAction[];
  error?: string;
}

export interface RunTeamRunTickInput {
  reason?: TeamRunTickReason;
  now?: Date;
}

export interface CompleteTeamRunInput {
  summary: string;
  evidence?: TeamTaskEvidence[];
}

export interface SendTeamMessageInput {
  fromAgentSlug: TeamMessageActor;
  toAgentSlug: TeamMessageTarget;
  taskId?: string;
  kind?: TeamMessageKind;
  body: string;
}
