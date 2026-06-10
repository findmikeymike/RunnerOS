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
  TeamTask,
  TeamTaskPriority,
  TeamTaskStatus,
  UpdateTeamTaskInput,
} from './run-types.ts';

const RUN_FILE = 'run.json';
const TASKS_FILE = 'tasks.jsonl';
const MESSAGES_FILE = 'messages.jsonl';
const EVENTS_FILE = 'events.jsonl';
const RUNS_DIR = join('.runneros', 'teams', 'runs');
const TEAM_RUN_ID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const RUN_STATES: ReadonlySet<TeamRunState> = new Set(['created', 'running', 'blocked', 'review', 'done', 'failed', 'cancelled']);
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
]);
const REVIEW_STATUSES: ReadonlySet<string> = new Set(['requested', 'passed', 'failed']);
const APPROVAL_STATUSES: ReadonlySet<string> = new Set(['requested', 'approved', 'rejected']);

export function isValidTeamRunId(runId: string): boolean {
  return TEAM_RUN_ID_REGEX.test(runId);
}

export function assertValidTeamRunId(runId: string): void {
  if (!isValidTeamRunId(runId)) throw new Error(`Invalid team run id: ${runId}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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
  tasks[index] = next;
  writeJsonl(join(getTeamRunDir(workspaceRootPath, runId), TASKS_FILE), tasks);
  appendTeamRunEvent(workspaceRootPath, runId, { kind: 'task.updated', taskId: next.id, actorAgentSlug: 'system', body: next.status });
  const run = readTeamRun(workspaceRootPath, runId);
  if (run) touchTeamRun(workspaceRootPath, deriveRunState(run, tasks));
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
  if (run.state === 'cancelled' || run.state === 'failed') return run;
  if (tasks.length === 0) return run;
  if (tasks.some((task) => task.status === 'blocked')) return { ...run, state: 'blocked' };
  if (tasks.some((task) => task.status === 'review')) return { ...run, state: 'review' };
  if (tasks.every((task) => task.status === 'done')) return { ...run, state: 'done' };
  return { ...run, state: 'running' };
}
