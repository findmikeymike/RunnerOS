import { randomUUID } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { AGENT_SLUG_REGEX } from '../agent-definitions/types.ts';
import { TEAM_SLUG_REGEX } from './types.ts';
import type {
  CreateTeamTaskInput,
  ClaimTeamTaskInput,
  CompleteTeamRunInput,
  HeartbeatTeamTaskInput,
  RunTeamRunTickInput,
  SendTeamMessageInput,
  TeamMessage,
  TeamMessageActor,
  TeamMessageKind,
  TeamMessageTarget,
  TeamRunDetail,
  TeamRunEvent,
  TeamRunEventKind,
  TeamRunSnapshot,
  TeamRunState,
  TeamRunSwarmPolicy,
  TeamRunTick,
  TeamRunTickAction,
  TeamRunTickActionType,
  TeamRunTickReason,
  TeamTask,
  TeamTaskPriority,
  TeamTaskStatus,
  UpdateTeamTaskInput,
} from './run-types.ts';

const RUN_FILE = 'run.json';
const TASKS_FILE = 'tasks.jsonl';
const MESSAGES_FILE = 'messages.jsonl';
const EVENTS_FILE = 'events.jsonl';
const TICKS_FILE = 'ticks.jsonl';
const RUNS_DIR = join('.runneros', 'teams', 'runs');
const TEAM_RUN_ID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const RUN_STATES: ReadonlySet<TeamRunState> = new Set(['created', 'running', 'paused', 'blocked', 'review', 'done', 'failed', 'cancelled']);
const TASK_STATUSES: ReadonlySet<TeamTaskStatus> = new Set(['todo', 'in_progress', 'blocked', 'review', 'done', 'failed']);
const TASK_PRIORITIES: ReadonlySet<TeamTaskPriority> = new Set(['low', 'normal', 'high']);
const MESSAGE_KINDS: ReadonlySet<TeamMessageKind> = new Set(['assignment', 'question', 'result', 'review', 'note']);
const EVENT_KINDS: ReadonlySet<TeamRunEventKind> = new Set([
  'run.created',
  'run.updated',
  'task.created',
  'task.updated',
  'message.sent',
  'session.linked',
  'review.requested',
  'approval.requested',
  'task.leased',
  'task.heartbeat',
  'task.lease_expired',
  'run.completed',
  'run.tick',
  'run.paused',
  'run.resumed',
  'run.cancelled',
]);
const REVIEW_STATUSES: ReadonlySet<string> = new Set(['requested', 'passed', 'failed']);
const APPROVAL_STATUSES: ReadonlySet<string> = new Set(['requested', 'approved', 'rejected']);
const TICK_REASONS: ReadonlySet<TeamRunTickReason> = new Set(['scheduled', 'manual', 'startup-recovery']);
const TICK_ACTION_TYPES: ReadonlySet<TeamRunTickActionType> = new Set(['expired-lease', 'wake-lead', 'wake-member', 'no-op', 'finalization-needed', 'error']);
const DEFAULT_SWARM_POLICY: TeamRunSwarmPolicy = {
  maxConcurrentTasks: 3,
  taskLeaseMs: 5 * 60 * 1000,
  heartbeatIntervalMs: 60 * 1000,
  staleAfterMs: 10 * 60 * 1000,
  retryLimit: 2,
  retryBackoffMs: 2 * 60 * 1000,
  autoRun: true,
  tickIntervalMs: 30 * 1000,
  leadWakeCooldownMs: 2 * 60 * 1000,
  memberWakeCooldownMs: 60 * 1000,
};

export function isValidTeamRunId(runId: string): boolean {
  return TEAM_RUN_ID_REGEX.test(runId);
}

export function assertValidTeamRunId(runId: string): void {
  if (!isValidTeamRunId(runId)) throw new Error(`Invalid team run id: ${runId}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

export function normalizeTeamRunSwarmPolicy(input?: Partial<TeamRunSwarmPolicy>): TeamRunSwarmPolicy {
  return {
    maxConcurrentTasks: isPositiveInteger(input?.maxConcurrentTasks) ? input.maxConcurrentTasks : DEFAULT_SWARM_POLICY.maxConcurrentTasks,
    taskLeaseMs: isPositiveInteger(input?.taskLeaseMs) ? input.taskLeaseMs : DEFAULT_SWARM_POLICY.taskLeaseMs,
    heartbeatIntervalMs: isPositiveInteger(input?.heartbeatIntervalMs) ? input.heartbeatIntervalMs : DEFAULT_SWARM_POLICY.heartbeatIntervalMs,
    staleAfterMs: isPositiveInteger(input?.staleAfterMs) ? input.staleAfterMs : DEFAULT_SWARM_POLICY.staleAfterMs,
    retryLimit: isPositiveInteger(input?.retryLimit) ? input.retryLimit : DEFAULT_SWARM_POLICY.retryLimit,
    retryBackoffMs: isPositiveInteger(input?.retryBackoffMs) ? input.retryBackoffMs : DEFAULT_SWARM_POLICY.retryBackoffMs,
    autoRun: input?.autoRun === false ? false : DEFAULT_SWARM_POLICY.autoRun,
    tickIntervalMs: isPositiveInteger(input?.tickIntervalMs) ? input.tickIntervalMs : DEFAULT_SWARM_POLICY.tickIntervalMs,
    leadWakeCooldownMs: isPositiveInteger(input?.leadWakeCooldownMs) ? input.leadWakeCooldownMs : DEFAULT_SWARM_POLICY.leadWakeCooldownMs,
    memberWakeCooldownMs: isPositiveInteger(input?.memberWakeCooldownMs) ? input.memberWakeCooldownMs : DEFAULT_SWARM_POLICY.memberWakeCooldownMs,
    operatorPausedAt: typeof input?.operatorPausedAt === 'string' ? input.operatorPausedAt : undefined,
    operatorPausedReason: typeof input?.operatorPausedReason === 'string' ? input.operatorPausedReason : undefined,
  };
}

function isContainedPath(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function resolveRunDir(workspaceRootPath: string, runId: string): string | null {
  if (!isValidTeamRunId(runId)) return null;
  const runsRoot = resolve(workspaceRootPath, RUNS_DIR);
  const runDir = resolve(runsRoot, runId);
  return isContainedPath(runsRoot, runDir) ? runDir : null;
}

function getRequiredRunDir(workspaceRootPath: string, runId: string): string {
  const dir = resolveRunDir(workspaceRootPath, runId);
  if (!dir) throw new Error(`Invalid team run id: ${runId}`);
  return dir;
}

function readJsonl<T>(file: string, guard: (value: unknown) => value is T): T[] {
  if (!existsSync(file)) return [];
  const out: T[] = [];
  for (const line of readFileSync(file, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (guard(parsed)) out.push(parsed);
    } catch {
      // Ignore malformed append records.
    }
  }
  return out;
}

function appendJsonl(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(value)}\n`, 'utf-8');
}

function writeJsonl(file: string, values: unknown[]): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(tmp, values.map((value) => JSON.stringify(value)).join('\n') + (values.length ? '\n' : ''), 'utf-8');
  renameSync(tmp, file);
}

function isActor(value: unknown): value is TeamMessageActor {
  return value === 'user' || value === 'system' || (typeof value === 'string' && AGENT_SLUG_REGEX.test(value));
}

function isTarget(value: unknown): value is TeamMessageTarget {
  return value === 'lead' || value === 'all' || (typeof value === 'string' && AGENT_SLUG_REGEX.test(value));
}

function isTeamRunSnapshot(value: unknown, expectedRunId: string): value is TeamRunSnapshot {
  if (!isRecord(value)) return false;
  if (value.id !== expectedRunId || !isValidTeamRunId(expectedRunId)) return false;
  if (typeof value.workspaceId !== 'string' || !value.workspaceId) return false;
  if (typeof value.teamSlug !== 'string' || !TEAM_SLUG_REGEX.test(value.teamSlug)) return false;
  if (typeof value.state !== 'string' || !RUN_STATES.has(value.state as TeamRunState)) return false;
  if (typeof value.userRequest !== 'string' || !value.userRequest.trim()) return false;
  if (typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string') return false;
  if (value.leadSessionId !== undefined && typeof value.leadSessionId !== 'string') return false;
  if (value.memberSessionIds !== undefined) {
    if (!isRecord(value.memberSessionIds)) return false;
    if (!Object.entries(value.memberSessionIds).every(([agentSlug, sessionId]) => AGENT_SLUG_REGEX.test(agentSlug) && typeof sessionId === 'string' && sessionId)) return false;
  }
  if (value.permissionMode !== undefined && !['safe', 'ask', 'allow-all'].includes(String(value.permissionMode))) return false;
  if (value.completedAt !== undefined && typeof value.completedAt !== 'string') return false;
  if (value.finalSummary !== undefined && typeof value.finalSummary !== 'string') return false;
  if (value.finalEvidence !== undefined && !Array.isArray(value.finalEvidence)) return false;
  if (value.swarm !== undefined) {
    if (!isRecord(value.swarm)) return false;
    const swarm = normalizeTeamRunSwarmPolicy(value.swarm);
    if (swarm.maxConcurrentTasks <= 0 || swarm.taskLeaseMs <= 0 || swarm.staleAfterMs <= 0 || swarm.retryLimit <= 0) return false;
  }
  if (!isRecord(value.teamSnapshot) || !isRecord(value.teamSnapshot.metadata) || typeof value.teamSnapshot.body !== 'string') return false;
  return true;
}

function isTeamTask(value: unknown): value is TeamTask {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string' || !value.id) return false;
  if (typeof value.runId !== 'string' || !isValidTeamRunId(value.runId)) return false;
  if (typeof value.title !== 'string' || !value.title.trim()) return false;
  if (typeof value.description !== 'string') return false;
  if (typeof value.ownerAgentSlug !== 'string' || !AGENT_SLUG_REGEX.test(value.ownerAgentSlug)) return false;
  if (typeof value.status !== 'string' || !TASK_STATUSES.has(value.status as TeamTaskStatus)) return false;
  if (typeof value.priority !== 'string' || !TASK_PRIORITIES.has(value.priority as TeamTaskPriority)) return false;
  if (!isRecord(value.inputs)) return false;
  if (typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string') return false;
  if (value.reviewRequired !== undefined && typeof value.reviewRequired !== 'boolean') return false;
  if (value.attemptCount !== undefined && (!isPositiveInteger(value.attemptCount) && value.attemptCount !== 0)) return false;
  if (value.maxAttempts !== undefined && !isPositiveInteger(value.maxAttempts)) return false;
  if (value.lastError !== undefined && typeof value.lastError !== 'string') return false;
  if (value.nextAttemptAt !== undefined && typeof value.nextAttemptAt !== 'string') return false;
  if (value.lastWakeAt !== undefined && typeof value.lastWakeAt !== 'string') return false;
  if (value.lastWakeReason !== undefined && typeof value.lastWakeReason !== 'string') return false;
  if (value.lease !== undefined) {
    if (!isRecord(value.lease)) return false;
    if (typeof value.lease.id !== 'string' || !value.lease.id) return false;
    if (typeof value.lease.ownerAgentSlug !== 'string' || !AGENT_SLUG_REGEX.test(value.lease.ownerAgentSlug)) return false;
    if (typeof value.lease.claimedAt !== 'string') return false;
    if (typeof value.lease.heartbeatAt !== 'string') return false;
    if (typeof value.lease.expiresAt !== 'string') return false;
  }
  if (value.reviewerAgentSlug !== undefined && (typeof value.reviewerAgentSlug !== 'string' || !AGENT_SLUG_REGEX.test(value.reviewerAgentSlug))) return false;
  if (value.review !== undefined) {
    if (!isRecord(value.review)) return false;
    if (typeof value.review.requestedAt !== 'string') return false;
    if (typeof value.review.reviewerAgentSlug !== 'string' || !AGENT_SLUG_REGEX.test(value.review.reviewerAgentSlug)) return false;
    if (typeof value.review.status !== 'string' || !REVIEW_STATUSES.has(value.review.status)) return false;
    if (value.review.findings !== undefined && typeof value.review.findings !== 'string') return false;
    if (value.review.reviewedAt !== undefined && typeof value.review.reviewedAt !== 'string') return false;
  }
  if (value.approvalRequired !== undefined && typeof value.approvalRequired !== 'boolean') return false;
  if (value.approval !== undefined) {
    if (!isRecord(value.approval)) return false;
    if (typeof value.approval.requestedAt !== 'string') return false;
    if (!isActor(value.approval.requestedByAgentSlug)) return false;
    if (typeof value.approval.reason !== 'string' || !value.approval.reason.trim()) return false;
    if (typeof value.approval.status !== 'string' || !APPROVAL_STATUSES.has(value.approval.status)) return false;
    if (value.approval.decidedAt !== undefined && typeof value.approval.decidedAt !== 'string') return false;
    if (value.approval.decisionNote !== undefined && typeof value.approval.decisionNote !== 'string') return false;
  }
  return true;
}

function isTeamMessage(value: unknown): value is TeamMessage {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string' || !value.id) return false;
  if (typeof value.runId !== 'string' || !isValidTeamRunId(value.runId)) return false;
  if (!isActor(value.fromAgentSlug) || !isTarget(value.toAgentSlug)) return false;
  if (value.taskId !== undefined && typeof value.taskId !== 'string') return false;
  if (typeof value.kind !== 'string' || !MESSAGE_KINDS.has(value.kind as TeamMessageKind)) return false;
  if (typeof value.body !== 'string' || !value.body.trim()) return false;
  if (typeof value.createdAt !== 'string') return false;
  if (value.readAt !== undefined && typeof value.readAt !== 'string') return false;
  return true;
}

function isTeamRunEvent(value: unknown): value is TeamRunEvent {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string' || !value.id) return false;
  if (typeof value.runId !== 'string' || !isValidTeamRunId(value.runId)) return false;
  if (typeof value.kind !== 'string' || !EVENT_KINDS.has(value.kind as TeamRunEventKind)) return false;
  if (value.actorAgentSlug !== undefined && !isActor(value.actorAgentSlug)) return false;
  if (value.taskId !== undefined && typeof value.taskId !== 'string') return false;
  if (value.messageId !== undefined && typeof value.messageId !== 'string') return false;
  if (value.body !== undefined && typeof value.body !== 'string') return false;
  if (typeof value.createdAt !== 'string') return false;
  return true;
}

function isTeamRunTickAction(value: unknown): value is TeamRunTickAction {
  if (!isRecord(value)) return false;
  if (typeof value.type !== 'string' || !TICK_ACTION_TYPES.has(value.type as TeamRunTickActionType)) return false;
  if (value.taskId !== undefined && typeof value.taskId !== 'string') return false;
  if (value.agentSlug !== undefined && (typeof value.agentSlug !== 'string' || !AGENT_SLUG_REGEX.test(value.agentSlug))) return false;
  if (value.sessionId !== undefined && typeof value.sessionId !== 'string') return false;
  if (value.message !== undefined && typeof value.message !== 'string') return false;
  return true;
}

function isTeamRunTick(value: unknown): value is TeamRunTick {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string' || !value.id) return false;
  if (typeof value.runId !== 'string' || !isValidTeamRunId(value.runId)) return false;
  if (typeof value.reason !== 'string' || !TICK_REASONS.has(value.reason as TeamRunTickReason)) return false;
  if (typeof value.startedAt !== 'string' || typeof value.completedAt !== 'string') return false;
  if (!Array.isArray(value.actions) || !value.actions.every(isTeamRunTickAction)) return false;
  if (value.error !== undefined && typeof value.error !== 'string') return false;
  return true;
}

export function getTeamRunsDir(workspaceRootPath: string): string {
  return join(workspaceRootPath, RUNS_DIR);
}

export function getTeamRunDir(workspaceRootPath: string, runId: string): string {
  return getRequiredRunDir(workspaceRootPath, runId);
}

export function getTeamRunFile(workspaceRootPath: string, runId: string): string {
  return join(getTeamRunDir(workspaceRootPath, runId), RUN_FILE);
}

export function writeTeamRun(workspaceRootPath: string, run: TeamRunSnapshot): void {
  const runId = run.id;
  if (!isTeamRunSnapshot(run, runId)) throw new Error(`Invalid team run snapshot: ${runId}`);
  const dir = getTeamRunDir(workspaceRootPath, runId);
  mkdirSync(dir, { recursive: true });
  const finalPath = join(dir, RUN_FILE);
  const tmpPath = `${finalPath}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(run, null, 2) + '\n', 'utf-8');
  renameSync(tmpPath, finalPath);
}

export function readTeamRun(workspaceRootPath: string, runId: string): TeamRunSnapshot | null {
  const dir = resolveRunDir(workspaceRootPath, runId);
  if (!dir) return null;
  const file = join(dir, RUN_FILE);
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as unknown;
    if (!isTeamRunSnapshot(parsed, runId)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function readTeamRunDetail(workspaceRootPath: string, runId: string): TeamRunDetail | null {
  const run = readTeamRun(workspaceRootPath, runId);
  if (!run) return null;
  return {
    ...run,
    tasks: listTeamTasks(workspaceRootPath, runId),
    messages: listTeamMessages(workspaceRootPath, runId),
    events: listTeamRunEvents(workspaceRootPath, runId),
  };
}

export function listTeamRunTicks(workspaceRootPath: string, runId: string): TeamRunTick[] {
  const dir = resolveRunDir(workspaceRootPath, runId);
  if (!dir) return [];
  return readJsonl(join(dir, TICKS_FILE), isTeamRunTick);
}

export function appendTeamRunTick(workspaceRootPath: string, runId: string, tick: Omit<TeamRunTick, 'id' | 'runId'>): TeamRunTick {
  const next: TeamRunTick = {
    id: `tick_${randomUUID().slice(0, 10)}`,
    runId,
    ...tick,
  };
  if (!isTeamRunTick(next)) throw new Error(`Invalid team run tick: ${runId}`);
  appendJsonl(join(getTeamRunDir(workspaceRootPath, runId), TICKS_FILE), next);
  appendTeamRunEvent(workspaceRootPath, runId, { kind: 'run.tick', actorAgentSlug: 'system', body: next.actions.map((action) => action.type).join(',') || 'no-op' });
  return next;
}

export function listTeamRuns(workspaceRootPath: string): TeamRunSnapshot[] {
  const root = getTeamRunsDir(workspaceRootPath);
  if (!existsSync(root)) return [];
  let entries: import('node:fs').Dirent[];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: TeamRunSnapshot[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const run = readTeamRun(workspaceRootPath, entry.name);
    if (run) out.push(run);
  }
  out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return out;
}

export function deleteTeamRun(workspaceRootPath: string, runId: string): boolean {
  const dir = resolveRunDir(workspaceRootPath, runId);
  if (!dir || !existsSync(dir)) return false;
  rmSync(dir, { recursive: true, force: true });
  return true;
}

export function listTeamTasks(workspaceRootPath: string, runId: string): TeamTask[] {
  const dir = resolveRunDir(workspaceRootPath, runId);
  if (!dir) return [];
  return readJsonl(join(dir, TASKS_FILE), isTeamTask);
}

export function createTeamTask(workspaceRootPath: string, runId: string, input: CreateTeamTaskInput): TeamTask {
  const run = readTeamRun(workspaceRootPath, runId);
  if (!run) throw new Error(`Team run not found: ${runId}`);
  if (run.state === 'paused') throw new Error(`Cannot create team task while run "${runId}" is paused.`);
  if (['done', 'failed', 'cancelled'].includes(run.state)) throw new Error(`Cannot create team task while run "${runId}" is ${run.state}.`);
  if (!input.title.trim()) throw new Error('Task title is required.');
  if (!AGENT_SLUG_REGEX.test(input.ownerAgentSlug)) throw new Error(`Invalid task owner: ${input.ownerAgentSlug}`);
  if (input.reviewerAgentSlug !== undefined && !AGENT_SLUG_REGEX.test(input.reviewerAgentSlug)) throw new Error(`Invalid task reviewer: ${input.reviewerAgentSlug}`);
  const priority = input.priority ?? 'normal';
  if (!TASK_PRIORITIES.has(priority)) throw new Error(`Invalid task priority: ${priority}`);
  const now = new Date().toISOString();
  const task: TeamTask = {
    id: `task_${randomUUID().slice(0, 8)}`,
    runId,
    title: input.title.trim(),
    description: input.description.trim(),
    ownerAgentSlug: input.ownerAgentSlug,
    status: 'todo',
    priority,
    inputs: input.inputs ?? {},
    approvalRequired: input.approvalRequired,
    reviewRequired: input.reviewRequired,
    reviewerAgentSlug: input.reviewerAgentSlug,
    attemptCount: 0,
    maxAttempts: input.maxAttempts,
    createdAt: now,
    updatedAt: now,
  };
  appendJsonl(join(getTeamRunDir(workspaceRootPath, runId), TASKS_FILE), task);
  appendTeamRunEvent(workspaceRootPath, runId, { kind: 'task.created', taskId: task.id, actorAgentSlug: 'system', body: task.title });
  touchTeamRun(workspaceRootPath, { ...run, state: run.state === 'created' ? 'running' : run.state });
  return task;
}

export function updateTeamTask(workspaceRootPath: string, runId: string, taskId: string, patch: UpdateTeamTaskInput): TeamTask {
  const tasks = listTeamTasks(workspaceRootPath, runId);
  const index = tasks.findIndex((task) => task.id === taskId);
  if (index < 0) throw new Error(`Team task not found: ${taskId}`);
  const current = tasks[index]!;
  const status = patch.status ?? current.status;
  const priority = patch.priority ?? current.priority;
  if (!TASK_STATUSES.has(status)) throw new Error(`Invalid task status: ${status}`);
  if (!TASK_PRIORITIES.has(priority)) throw new Error(`Invalid task priority: ${priority}`);
  if (patch.ownerAgentSlug !== undefined && !AGENT_SLUG_REGEX.test(patch.ownerAgentSlug)) throw new Error(`Invalid task owner: ${patch.ownerAgentSlug}`);
  if (patch.reviewerAgentSlug !== undefined && !AGENT_SLUG_REGEX.test(patch.reviewerAgentSlug)) throw new Error(`Invalid task reviewer: ${patch.reviewerAgentSlug}`);
  if (patch.approvalRequired === false && (current.approvalRequired || current.approval)) {
    throw new Error(`Task "${taskId}" approval requirement cannot be cleared once set.`);
  }
  if (patch.reviewRequired === false && (current.reviewRequired || current.review)) {
    throw new Error(`Task "${taskId}" review requirement cannot be cleared once set.`);
  }
  const next: TeamTask = {
    ...current,
    ...patch,
    title: patch.title !== undefined ? patch.title.trim() : current.title,
    description: patch.description !== undefined ? patch.description.trim() : current.description,
    status,
    priority,
    updatedAt: new Date().toISOString(),
  };
  if (!next.title) throw new Error('Task title is required.');
  if (next.status === 'done' && next.approvalRequired && next.approval?.status !== 'approved') {
    throw new Error(`Task "${taskId}" requires user approval before it can be marked done.`);
  }
  if (next.status === 'done' && next.reviewRequired && next.review?.status !== 'passed') {
    throw new Error(`Task "${taskId}" requires a passed review before it can be marked done.`);
  }
  if (['todo', 'blocked', 'review', 'done', 'failed'].includes(next.status)) {
    next.lease = undefined;
  }
  tasks[index] = next;
  writeJsonl(join(getTeamRunDir(workspaceRootPath, runId), TASKS_FILE), tasks);
  appendTeamRunEvent(workspaceRootPath, runId, { kind: 'task.updated', taskId: next.id, actorAgentSlug: 'system', body: next.status });
  const run = readTeamRun(workspaceRootPath, runId);
  if (run) touchTeamRun(workspaceRootPath, deriveRunState(run, tasks));
  return next;
}

function hasRecentTickAction(ticks: TeamRunTick[], action: TeamRunTickAction, sinceMs: number): boolean {
  return ticks.some((tick) => {
    if (parseTime(tick.completedAt) < sinceMs) return false;
    return tick.actions.some((candidate) => (
      candidate.type === action.type
      && candidate.taskId === action.taskId
      && candidate.agentSlug === action.agentSlug
    ));
  });
}

function parseTime(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isTerminalRunState(state: TeamRunState): boolean {
  return state === 'done' || state === 'failed' || state === 'cancelled';
}

function isTaskClaimable(task: TeamTask, nowMs: number): boolean {
  if (task.status === 'todo') {
    return !task.nextAttemptAt || parseTime(task.nextAttemptAt) <= nowMs;
  }
  if (task.status !== 'in_progress' || !task.lease) return false;
  return parseTime(task.lease.expiresAt) <= nowMs;
}

export function claimTeamTask(
  workspaceRootPath: string,
  runId: string,
  input: ClaimTeamTaskInput,
  now: Date = new Date(),
): TeamTask | null {
  if (!AGENT_SLUG_REGEX.test(input.agentSlug)) throw new Error(`Invalid task claimant: ${input.agentSlug}`);
  const run = readTeamRun(workspaceRootPath, runId);
  if (!run) throw new Error(`Team run not found: ${runId}`);
  if (run.state === 'paused') throw new Error(`Team run "${runId}" is paused.`);
  if (isTerminalRunState(run.state)) throw new Error(`Team run "${runId}" is ${run.state}.`);

  const tasks = listTeamTasks(workspaceRootPath, runId);
  const nowMs = now.getTime();
  const policy = normalizeTeamRunSwarmPolicy(run.swarm);
  const activeLeaseCount = tasks.filter((task) => (
    task.status === 'in_progress'
    && task.lease
    && parseTime(task.lease.expiresAt) > nowMs
  )).length;
  if (activeLeaseCount >= policy.maxConcurrentTasks) return null;

  const index = tasks.findIndex((task) => (
    task.ownerAgentSlug === input.agentSlug
    && (!input.taskId || task.id === input.taskId)
    && isTaskClaimable(task, nowMs)
  ));
  if (index < 0) return null;

  const current = tasks[index]!;
  const ttlMs = input.leaseTtlMs && input.leaseTtlMs > 0 ? input.leaseTtlMs : policy.taskLeaseMs;
  const stale = current.status === 'in_progress' && current.lease && parseTime(current.lease.expiresAt) <= nowMs;
  const attemptCount = (current.attemptCount ?? 0) + 1;
  const maxAttempts = current.maxAttempts ?? policy.retryLimit + 1;
  if (attemptCount > maxAttempts) {
    const failed: TeamTask = {
      ...current,
      status: 'failed',
      lease: undefined,
      lastError: current.lastError ?? 'Task exceeded retry limit.',
      updatedAt: now.toISOString(),
    };
    tasks[index] = failed;
    writeJsonl(join(getTeamRunDir(workspaceRootPath, runId), TASKS_FILE), tasks);
    appendTeamRunEvent(workspaceRootPath, runId, { kind: 'task.updated', taskId: failed.id, actorAgentSlug: 'system', body: 'failed' });
    touchTeamRun(workspaceRootPath, deriveRunState(run, tasks));
    return null;
  }

  const lease = {
    id: `lease_${randomUUID().slice(0, 10)}`,
    ownerAgentSlug: input.agentSlug,
    claimedAt: now.toISOString(),
    heartbeatAt: now.toISOString(),
    expiresAt: new Date(nowMs + ttlMs).toISOString(),
  };
  const next: TeamTask = {
    ...current,
    status: 'in_progress',
    attemptCount,
    lease,
    nextAttemptAt: undefined,
    updatedAt: now.toISOString(),
  };
  tasks[index] = next;
  writeJsonl(join(getTeamRunDir(workspaceRootPath, runId), TASKS_FILE), tasks);
  appendTeamRunEvent(workspaceRootPath, runId, { kind: stale ? 'task.lease_expired' : 'task.leased', taskId: next.id, actorAgentSlug: input.agentSlug, body: lease.id });
  touchTeamRun(workspaceRootPath, deriveRunState(run, tasks));
  return next;
}

export function heartbeatTeamTask(
  workspaceRootPath: string,
  runId: string,
  input: HeartbeatTeamTaskInput,
  now: Date = new Date(),
): TeamTask {
  if (!AGENT_SLUG_REGEX.test(input.agentSlug)) throw new Error(`Invalid task heartbeat owner: ${input.agentSlug}`);
  const run = readTeamRun(workspaceRootPath, runId);
  if (!run) throw new Error(`Team run not found: ${runId}`);
  if (isTerminalRunState(run.state)) throw new Error(`Team run "${runId}" is ${run.state}.`);
  const tasks = listTeamTasks(workspaceRootPath, runId);
  const index = tasks.findIndex((task) => task.id === input.taskId);
  if (index < 0) throw new Error(`Team task not found: ${input.taskId}`);
  const current = tasks[index]!;
  if (!current.lease || current.lease.id !== input.leaseId || current.lease.ownerAgentSlug !== input.agentSlug) {
    throw new Error(`Task "${input.taskId}" is not leased to ${input.agentSlug}.`);
  }
  const policy = normalizeTeamRunSwarmPolicy(run.swarm);
  const ttlMs = input.leaseTtlMs && input.leaseTtlMs > 0 ? input.leaseTtlMs : policy.taskLeaseMs;
  const lease = {
    ...current.lease,
    heartbeatAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
  };
  const next: TeamTask = {
    ...current,
    lease,
    updatedAt: now.toISOString(),
  };
  tasks[index] = next;
  writeJsonl(join(getTeamRunDir(workspaceRootPath, runId), TASKS_FILE), tasks);
  appendTeamRunEvent(workspaceRootPath, runId, { kind: 'task.heartbeat', taskId: next.id, actorAgentSlug: input.agentSlug, body: lease.id });
  touchTeamRun(workspaceRootPath, run);
  return next;
}

export function expireStaleTeamTaskLeases(
  workspaceRootPath: string,
  runId: string,
  now: Date = new Date(),
): TeamTask[] {
  const run = readTeamRun(workspaceRootPath, runId);
  if (!run) throw new Error(`Team run not found: ${runId}`);
  if (isTerminalRunState(run.state)) return [];
  const tasks = listTeamTasks(workspaceRootPath, runId);
  const policy = normalizeTeamRunSwarmPolicy(run.swarm);
  const nowMs = now.getTime();
  const expired: TeamTask[] = [];
  const next = tasks.map((task) => {
    if (task.status !== 'in_progress' || !task.lease || parseTime(task.lease.expiresAt) > nowMs) return task;
    const maxAttempts = task.maxAttempts ?? policy.retryLimit + 1;
    const attempts = task.attemptCount ?? 0;
    const failed = attempts >= maxAttempts;
    const updated: TeamTask = {
      ...task,
      status: failed ? 'failed' : 'todo',
      lease: undefined,
      lastError: failed ? (task.lastError ?? 'Task lease expired too many times.') : 'Task lease expired before completion.',
      nextAttemptAt: failed ? undefined : new Date(nowMs + policy.retryBackoffMs).toISOString(),
      updatedAt: now.toISOString(),
    };
    expired.push(updated);
    return updated;
  });
  if (expired.length === 0) return [];
  writeJsonl(join(getTeamRunDir(workspaceRootPath, runId), TASKS_FILE), next);
  for (const task of expired) {
    appendTeamRunEvent(workspaceRootPath, runId, { kind: 'task.lease_expired', taskId: task.id, actorAgentSlug: 'system', body: task.status });
  }
  touchTeamRun(workspaceRootPath, deriveRunState(run, next));
  return expired;
}

function isRunTickable(run: TeamRunSnapshot): boolean {
  return run.state === 'created' || run.state === 'running' || run.state === 'blocked' || run.state === 'review';
}

function isTaskWakeEligible(task: TeamTask, nowMs: number): boolean {
  if (task.status !== 'todo') return false;
  if (task.nextAttemptAt && parseTime(task.nextAttemptAt) > nowMs) return false;
  if (task.lease && parseTime(task.lease.expiresAt) > nowMs) return false;
  return true;
}

export function runTeamRunTick(workspaceRootPath: string, runId: string, input: RunTeamRunTickInput = {}): TeamRunTick {
  const startedAt = (input.now ?? new Date()).toISOString();
  const now = input.now ?? new Date(startedAt);
  const nowMs = now.getTime();
  const reason = input.reason ?? 'scheduled';
  const run = readTeamRun(workspaceRootPath, runId);
  if (!run) throw new Error(`Team run not found: ${runId}`);
  const policy = normalizeTeamRunSwarmPolicy(run.swarm);
  const actions: TeamRunTickAction[] = [];

  if (!isRunTickable(run) || policy.autoRun === false) {
    actions.push({ type: 'no-op', message: `Run is ${run.state}.` });
    return appendTeamRunTick(workspaceRootPath, runId, { reason, startedAt, completedAt: now.toISOString(), actions });
  }

  const beforeTasks = listTeamTasks(workspaceRootPath, runId);
  const beforeLeased = new Map(beforeTasks.filter((task) => task.lease).map((task) => [task.id, task]));
  const expired = expireStaleTeamTaskLeases(workspaceRootPath, runId, now);
  for (const task of expired) {
    actions.push({ type: 'expired-lease', taskId: task.id, agentSlug: task.ownerAgentSlug, message: task.status === 'failed' ? 'Task exceeded retry limit.' : 'Lease expired and task is retryable.' });
  }

  const detail = readTeamRunDetail(workspaceRootPath, runId);
  const tasks = detail?.tasks ?? beforeTasks;
  const ticks = listTeamRunTicks(workspaceRootPath, runId);
  const leadCooldownSince = nowMs - (policy.leadWakeCooldownMs ?? DEFAULT_SWARM_POLICY.leadWakeCooldownMs ?? 0);
  const memberCooldownSince = nowMs - (policy.memberWakeCooldownMs ?? DEFAULT_SWARM_POLICY.memberWakeCooldownMs ?? 0);

  const leadWakeTasks = tasks.filter((task) => (
    task.status === 'blocked'
    || task.status === 'review'
    || task.status === 'failed'
  ));
  const allDone = tasks.length > 0 && tasks.every((task) => task.status === 'done');
  if (allDone && run.state !== 'done') {
    const action: TeamRunTickAction = { type: 'finalization-needed', message: 'All tasks are done; lead must complete the team run.' };
    if (!hasRecentTickAction(ticks, action, leadCooldownSince)) actions.push(action);
  }
  for (const task of leadWakeTasks) {
    const action: TeamRunTickAction = { type: 'wake-lead', taskId: task.id, agentSlug: run.teamSnapshot.metadata.lead, message: `${task.title} is ${task.status}.` };
    if (!hasRecentTickAction(ticks, action, leadCooldownSince)) actions.push(action);
  }
  if (expired.length > 0) {
    const action: TeamRunTickAction = { type: 'wake-lead', agentSlug: run.teamSnapshot.metadata.lead, message: 'One or more task leases expired.' };
    if (!hasRecentTickAction(ticks, action, leadCooldownSince)) actions.push(action);
  }

  let activeLeaseCount = tasks.filter((task) => task.status === 'in_progress' && task.lease && parseTime(task.lease.expiresAt) > nowMs).length;
  for (const task of tasks) {
    if (activeLeaseCount >= policy.maxConcurrentTasks) break;
    if (!isTaskWakeEligible(task, nowMs)) continue;
    const action: TeamRunTickAction = { type: 'wake-member', taskId: task.id, agentSlug: task.ownerAgentSlug, message: `Task ${task.id} is ready to claim.` };
    if (hasRecentTickAction(ticks, action, memberCooldownSince)) continue;
    if (beforeLeased.has(task.id) && expired.some((candidate) => candidate.id === task.id)) continue;
    actions.push(action);
    activeLeaseCount += 1;
  }

  if (actions.length === 0) actions.push({ type: 'no-op', message: 'No team run action needed.' });
  return appendTeamRunTick(workspaceRootPath, runId, { reason, startedAt, completedAt: new Date().toISOString(), actions });
}

export function completeTeamRun(workspaceRootPath: string, runId: string, input: CompleteTeamRunInput): TeamRunSnapshot {
  const run = readTeamRun(workspaceRootPath, runId);
  if (!run) throw new Error(`Team run not found: ${runId}`);
  if (run.state === 'paused') throw new Error(`Team run "${runId}" is paused.`);
  if (isTerminalRunState(run.state)) throw new Error(`Team run "${runId}" is ${run.state}.`);
  const summary = input.summary.trim();
  if (!summary) throw new Error('Team run completion summary is required.');
  const tasks = listTeamTasks(workspaceRootPath, runId);
  if (tasks.length === 0) throw new Error(`Team run "${runId}" has no tasks to complete.`);
  const unfinished = tasks.find((task) => task.status !== 'done');
  if (unfinished) throw new Error(`Task "${unfinished.id}" is ${unfinished.status}. Complete all tasks before completing the run.`);
  const unresolvedApproval = tasks.find((task) => task.approvalRequired && task.approval?.status !== 'approved');
  if (unresolvedApproval) throw new Error(`Task "${unresolvedApproval.id}" still needs user approval.`);
  const unresolvedReview = tasks.find((task) => task.reviewRequired && task.review?.status !== 'passed');
  if (unresolvedReview) throw new Error(`Task "${unresolvedReview.id}" still needs passed review.`);
  const next = touchTeamRun(workspaceRootPath, {
    ...run,
    state: 'done',
    finalSummary: summary,
    finalEvidence: input.evidence,
    completedAt: new Date().toISOString(),
  });
  appendTeamRunEvent(workspaceRootPath, runId, { kind: 'run.completed', actorAgentSlug: run.teamSnapshot.metadata.lead, body: summary });
  return next;
}

export function controlTeamRun(
  workspaceRootPath: string,
  runId: string,
  action: 'pause' | 'resume' | 'cancel',
  reason?: string,
): TeamRunSnapshot {
  const run = readTeamRun(workspaceRootPath, runId);
  if (!run) throw new Error(`Team run not found: ${runId}`);
  if (isTerminalRunState(run.state)) throw new Error(`Team run "${runId}" is ${run.state}.`);
  const now = new Date().toISOString();
  if (action === 'pause') {
    const next = touchTeamRun(workspaceRootPath, {
      ...run,
      state: 'paused',
      swarm: {
        ...normalizeTeamRunSwarmPolicy(run.swarm),
        operatorPausedAt: now,
        operatorPausedReason: reason?.trim() || undefined,
      },
    });
    appendTeamRunEvent(workspaceRootPath, runId, { kind: 'run.paused', actorAgentSlug: 'user', body: reason?.trim() });
    return next;
  }
  if (action === 'resume') {
    if (run.state !== 'paused') throw new Error(`Team run "${runId}" is not paused.`);
    const policy = normalizeTeamRunSwarmPolicy(run.swarm);
    const tasks = listTeamTasks(workspaceRootPath, runId);
    const next = touchTeamRun(workspaceRootPath, deriveRunState({
      ...run,
      state: 'running',
      swarm: {
        ...policy,
        operatorPausedAt: undefined,
        operatorPausedReason: undefined,
      },
    }, tasks));
    appendTeamRunEvent(workspaceRootPath, runId, { kind: 'run.resumed', actorAgentSlug: 'user', body: reason?.trim() });
    return next;
  }
  const next = touchTeamRun(workspaceRootPath, { ...run, state: 'cancelled' });
  appendTeamRunEvent(workspaceRootPath, runId, { kind: 'run.cancelled', actorAgentSlug: 'user', body: reason?.trim() });
  return next;
}

export function linkTeamRunMemberSession(
  workspaceRootPath: string,
  runId: string,
  agentSlug: string,
  sessionId: string,
): TeamRunSnapshot {
  if (!AGENT_SLUG_REGEX.test(agentSlug)) throw new Error(`Invalid team member agent: ${agentSlug}`);
  if (!sessionId.trim()) throw new Error('Member session id is required.');
  const run = readTeamRun(workspaceRootPath, runId);
  if (!run) throw new Error(`Team run not found: ${runId}`);
  const next = touchTeamRun(workspaceRootPath, {
    ...run,
    memberSessionIds: {
      ...(run.memberSessionIds ?? {}),
      [agentSlug]: sessionId,
    },
  });
  appendTeamRunEvent(workspaceRootPath, runId, { kind: 'session.linked', actorAgentSlug: agentSlug, body: sessionId });
  return next;
}

export function listTeamMessages(workspaceRootPath: string, runId: string): TeamMessage[] {
  const dir = resolveRunDir(workspaceRootPath, runId);
  if (!dir) return [];
  return readJsonl(join(dir, MESSAGES_FILE), isTeamMessage);
}

export function sendTeamMessage(workspaceRootPath: string, runId: string, input: SendTeamMessageInput): TeamMessage {
  if (!readTeamRun(workspaceRootPath, runId)) throw new Error(`Team run not found: ${runId}`);
  if (!isActor(input.fromAgentSlug)) throw new Error(`Invalid sender: ${input.fromAgentSlug}`);
  if (!isTarget(input.toAgentSlug)) throw new Error(`Invalid recipient: ${input.toAgentSlug}`);
  const kind = input.kind ?? 'note';
  if (!MESSAGE_KINDS.has(kind)) throw new Error(`Invalid message kind: ${kind}`);
  if (!input.body.trim()) throw new Error('Message body is required.');
  const message: TeamMessage = {
    id: `msg_${randomUUID().slice(0, 10)}`,
    runId,
    fromAgentSlug: input.fromAgentSlug,
    toAgentSlug: input.toAgentSlug,
    taskId: input.taskId,
    kind,
    body: input.body.trim(),
    createdAt: new Date().toISOString(),
  };
  appendJsonl(join(getTeamRunDir(workspaceRootPath, runId), MESSAGES_FILE), message);
  appendTeamRunEvent(workspaceRootPath, runId, { kind: 'message.sent', messageId: message.id, actorAgentSlug: input.fromAgentSlug, taskId: input.taskId, body: kind });
  const run = readTeamRun(workspaceRootPath, runId);
  if (run) touchTeamRun(workspaceRootPath, run);
  return message;
}

export function markTeamMessagesRead(
  workspaceRootPath: string,
  runId: string,
  readerAgentSlug: TeamMessageTarget,
): TeamMessage[] {
  if (!readTeamRun(workspaceRootPath, runId)) throw new Error(`Team run not found: ${runId}`);
  if (!isTarget(readerAgentSlug)) throw new Error(`Invalid message reader: ${readerAgentSlug}`);
  const messages = listTeamMessages(workspaceRootPath, runId);
  const now = new Date().toISOString();
  let changed = false;
  const next = messages.map((message) => {
    if (message.readAt) return message;
    const addressedToReader = message.toAgentSlug === readerAgentSlug || message.toAgentSlug === 'all';
    if (!addressedToReader) return message;
    changed = true;
    return { ...message, readAt: now };
  });
  if (!changed) return messages;
  writeJsonl(join(getTeamRunDir(workspaceRootPath, runId), MESSAGES_FILE), next);
  const run = readTeamRun(workspaceRootPath, runId);
  if (run) touchTeamRun(workspaceRootPath, run);
  return next;
}

export function listTeamRunEvents(workspaceRootPath: string, runId: string): TeamRunEvent[] {
  const dir = resolveRunDir(workspaceRootPath, runId);
  if (!dir) return [];
  return readJsonl(join(dir, EVENTS_FILE), isTeamRunEvent);
}

export function appendTeamRunEvent(
  workspaceRootPath: string,
  runId: string,
  input: Omit<TeamRunEvent, 'id' | 'runId' | 'createdAt'>,
): TeamRunEvent {
  const event: TeamRunEvent = {
    id: `event_${randomUUID().slice(0, 10)}`,
    runId,
    createdAt: new Date().toISOString(),
    ...input,
  };
  if (!isTeamRunEvent(event)) throw new Error(`Invalid team run event: ${input.kind}`);
  appendJsonl(join(getTeamRunDir(workspaceRootPath, runId), EVENTS_FILE), event);
  return event;
}

export function touchTeamRun(workspaceRootPath: string, run: TeamRunSnapshot): TeamRunSnapshot {
  const terminal = run.state === 'done' || run.state === 'failed' || run.state === 'cancelled';
  const now = new Date().toISOString();
  const next: TeamRunSnapshot = {
    ...run,
    updatedAt: now,
    completedAt: terminal ? (run.completedAt ?? now) : run.completedAt,
  };
  writeTeamRun(workspaceRootPath, next);
  return next;
}

function deriveRunState(run: TeamRunSnapshot, tasks: TeamTask[]): TeamRunSnapshot {
  if (isTerminalRunState(run.state) || run.state === 'paused') return run;
  if (tasks.length === 0) return run;
  if (tasks.some((task) => task.status === 'failed')) return { ...run, state: 'failed' };
  if (tasks.some((task) => task.status === 'blocked')) return { ...run, state: 'blocked' };
  if (tasks.some((task) => task.status === 'review')) return { ...run, state: 'review' };
  if (tasks.every((task) => task.status === 'done')) return { ...run, state: 'review' };
  return { ...run, state: 'running' };
}
