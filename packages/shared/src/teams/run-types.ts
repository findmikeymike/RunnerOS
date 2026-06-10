import type { PermissionMode } from '../agent/mode-types.ts';
import type { TeamMetadata } from './types.ts';

export type TeamRunState = 'created' | 'running' | 'blocked' | 'review' | 'done' | 'failed' | 'cancelled';
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
  | 'approval.requested';

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
  evidence?: TeamTaskEvidence[];
  approvalRequired?: boolean;
  approval?: TeamTaskApproval;
  reviewRequired?: boolean;
  reviewerAgentSlug?: string;
  review?: TeamTaskReview;
  blockedReason?: string;
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
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface TeamRunDetail extends TeamRunSnapshot {
  tasks: TeamTask[];
  messages: TeamMessage[];
  events: TeamRunEvent[];
}

export interface StartTeamRunInput {
  teamSlug: string;
  userRequest: string;
}

export interface CreateTeamTaskInput {
  title: string;
  description: string;
  ownerAgentSlug: string;
  priority?: TeamTaskPriority;
  inputs?: Record<string, unknown>;
  approvalRequired?: boolean;
  reviewRequired?: boolean;
  reviewerAgentSlug?: string;
}

export interface UpdateTeamTaskInput {
  title?: string;
  description?: string;
  ownerAgentSlug?: string;
  status?: TeamTaskStatus;
  priority?: TeamTaskPriority;
  inputs?: Record<string, unknown>;
  output?: string;
  evidence?: TeamTaskEvidence[];
  approvalRequired?: boolean;
  approval?: TeamTaskApproval;
  reviewRequired?: boolean;
  reviewerAgentSlug?: string;
  review?: TeamTaskReview;
  blockedReason?: string;
}

export interface SendTeamMessageInput {
  fromAgentSlug: TeamMessageActor;
  toAgentSlug: TeamMessageTarget;
  taskId?: string;
  kind?: TeamMessageKind;
  body: string;
}
