import { randomUUID } from 'node:crypto';

export const SESSION_TASK_LIST_SCHEMA_VERSION = 1 as const;
export const SESSION_TASK_LIST_MAX_ITEMS = 50;
export const SESSION_TASK_MAX_CONTENT_CHARS = 200;
export const SESSION_TASK_MAX_ACTIVE_FORM_CHARS = 200;
export const SESSION_TASK_MAX_SUMMARY_CHARS = 1_000;

export type SessionTaskStatus =
  | 'pending'
  | 'in_progress'
  | 'delegated'
  | 'completed'
  | 'abandoned';

export type SessionTaskListSource = 'native-tool' | 'todowrite-adapter';
export type SessionTaskDelegationOutcome = 'succeeded' | 'failed' | 'timeout' | 'abandoned';

export interface SessionTaskDelegation {
  receiptId: string;
  childSessionId?: string;
  targetAgentSlug: string;
  dispatchedAt: string;
  settledAt?: string;
  outcome?: SessionTaskDelegationOutcome;
  summary?: string;
}

export interface SessionTask {
  id: string;
  content: string;
  activeForm?: string;
  status: SessionTaskStatus;
  delegation?: SessionTaskDelegation;
  createdAt: string;
  updatedAt: string;
}

export interface SessionTaskList {
  schemaVersion: typeof SESSION_TASK_LIST_SCHEMA_VERSION;
  id: string;
  revision: number;
  items: SessionTask[];
  createdAt: string;
  updatedAt: string;
  source: SessionTaskListSource;
}

export interface CreateSessionTaskInput {
  content: string;
  activeForm?: string;
  status?: SessionTaskStatus;
  delegation?: SessionTaskDelegation;
}

export type SessionTaskStateErrorCode =
  | 'invalid-list'
  | 'invalid-task'
  | 'empty-content'
  | 'content-too-long'
  | 'active-form-too-long'
  | 'duplicate-content'
  | 'duplicate-task-id'
  | 'too-many-items'
  | 'multiple-in-progress'
  | 'missing-delegation'
  | 'invalid-delegation'
  | 'task-not-found'
  | 'terminal-task'
  | 'invalid-transition'
  | 'stale-revision';

export class SessionTaskStateError extends Error {
  constructor(
    public readonly code: SessionTaskStateErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SessionTaskStateError';
  }
}

const TASK_STATUSES = new Set<SessionTaskStatus>([
  'pending',
  'in_progress',
  'delegated',
  'completed',
  'abandoned',
]);
const LIST_SOURCES = new Set<SessionTaskListSource>(['native-tool', 'todowrite-adapter']);
const DELEGATION_OUTCOMES = new Set<SessionTaskDelegationOutcome>([
  'succeeded',
  'failed',
  'timeout',
  'abandoned',
]);

function fail(code: SessionTaskStateErrorCode, message: string): never {
  throw new SessionTaskStateError(code, message);
}

function cleanContent(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail('empty-content', 'Task content is required');
  }
  const content = value.trim();
  if (content.length > SESSION_TASK_MAX_CONTENT_CHARS) {
    fail('content-too-long', `Task content must be ${SESSION_TASK_MAX_CONTENT_CHARS} characters or fewer`);
  }
  return content;
}

function cleanActiveForm(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') fail('invalid-task', 'Task activeForm must be a string');
  const activeForm = value.trim();
  if (!activeForm) return undefined;
  if (activeForm.length > SESSION_TASK_MAX_ACTIVE_FORM_CHARS) {
    fail('active-form-too-long', `Task activeForm must be ${SESSION_TASK_MAX_ACTIVE_FORM_CHARS} characters or fewer`);
  }
  return activeForm;
}

function cleanBoundedString(
  value: unknown,
  field: string,
  maxLength: number,
  required: boolean,
): string | undefined {
  if (value === undefined || value === null) {
    if (required) fail('invalid-delegation', `${field} is required`);
    return undefined;
  }
  if (typeof value !== 'string') fail('invalid-delegation', `${field} must be a string`);
  const cleaned = value.trim();
  if (!cleaned && required) fail('invalid-delegation', `${field} is required`);
  if (!cleaned) return undefined;
  if (cleaned.length > maxLength) fail('invalid-delegation', `${field} is too long`);
  return cleaned;
}

function cleanTimestamp(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim() || !Number.isFinite(Date.parse(value))) {
    fail('invalid-task', `${field} must be a valid timestamp`);
  }
  return new Date(value).toISOString();
}

function parseDelegation(value: unknown): SessionTaskDelegation | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) {
    fail('invalid-delegation', 'Task delegation must be an object');
  }
  const candidate = value as Partial<SessionTaskDelegation>;
  const receiptId = cleanBoundedString(candidate.receiptId, 'delegation.receiptId', 200, true)!;
  const childSessionId = cleanBoundedString(candidate.childSessionId, 'delegation.childSessionId', 200, false);
  const targetAgentSlug = cleanBoundedString(candidate.targetAgentSlug, 'delegation.targetAgentSlug', 200, true)!;
  const dispatchedAt = cleanTimestamp(candidate.dispatchedAt, 'delegation.dispatchedAt');
  const settledAt = candidate.settledAt === undefined
    ? undefined
    : cleanTimestamp(candidate.settledAt, 'delegation.settledAt');
  const outcome = candidate.outcome;
  if (outcome !== undefined && !DELEGATION_OUTCOMES.has(outcome)) {
    fail('invalid-delegation', 'delegation.outcome is invalid');
  }
  if (Boolean(settledAt) !== Boolean(outcome)) {
    fail('invalid-delegation', 'delegation.settledAt and outcome must be recorded together');
  }
  if (settledAt && Date.parse(settledAt) < Date.parse(dispatchedAt)) {
    fail('invalid-delegation', 'delegation.settledAt cannot precede dispatchedAt');
  }
  const summary = cleanBoundedString(
    candidate.summary,
    'delegation.summary',
    SESSION_TASK_MAX_SUMMARY_CHARS,
    false,
  );
  return { receiptId, childSessionId, targetAgentSlug, dispatchedAt, settledAt, outcome, summary };
}

function parseTask(value: unknown): SessionTask {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('invalid-task', 'Task must be an object');
  }
  const candidate = value as Partial<SessionTask>;
  if (typeof candidate.id !== 'string' || !candidate.id.startsWith('task_')) {
    fail('invalid-task', 'Task id is invalid');
  }
  if (!TASK_STATUSES.has(candidate.status as SessionTaskStatus)) {
    fail('invalid-task', 'Task status is invalid');
  }
  const createdAt = cleanTimestamp(candidate.createdAt, 'task.createdAt');
  const updatedAt = cleanTimestamp(candidate.updatedAt, 'task.updatedAt');
  if (Date.parse(updatedAt) < Date.parse(createdAt)) {
    fail('invalid-task', 'Task updatedAt cannot precede createdAt');
  }
  const delegation = parseDelegation(candidate.delegation);
  if (candidate.status === 'delegated' && !delegation?.receiptId) {
    fail('missing-delegation', 'A delegated task requires a receipt');
  }
  if (candidate.status === 'delegated' && delegation?.outcome) {
    fail('invalid-delegation', 'A delegated task cannot already have a terminal outcome');
  }
  return {
    id: candidate.id,
    content: cleanContent(candidate.content),
    activeForm: cleanActiveForm(candidate.activeForm),
    status: candidate.status as SessionTaskStatus,
    delegation,
    createdAt,
    updatedAt,
  };
}

function validateItems(items: SessionTask[], source?: SessionTaskListSource): void {
  if (items.length > SESSION_TASK_LIST_MAX_ITEMS) {
    fail('too-many-items', `A task list cannot contain more than ${SESSION_TASK_LIST_MAX_ITEMS} items`);
  }
  const ids = new Set<string>();
  const contents = new Set<string>();
  let inProgress = 0;
  for (const item of items) {
    if (ids.has(item.id)) fail('duplicate-task-id', `Duplicate task id: ${item.id}`);
    ids.add(item.id);
    const contentKey = item.content.trim().toLocaleLowerCase('en-US');
    if (contents.has(contentKey)) fail('duplicate-content', `Duplicate task content: ${item.content}`);
    contents.add(contentKey);
    if (item.status === 'in_progress') inProgress += 1;
  }
  if (inProgress > 1) fail('multiple-in-progress', 'Only one task can be in progress');
  if (source === 'todowrite-adapter' && items.some(item => item.status === 'delegated')) {
    fail('invalid-list', 'TodoWrite adapter lists cannot own delegated tasks');
  }
}

function nowIso(now?: string): string {
  return now === undefined ? new Date().toISOString() : cleanTimestamp(now, 'now');
}

function createTask(
  input: CreateSessionTaskInput,
  options: { id?: string; now: string },
): SessionTask {
  const id = options.id ?? `task_${randomUUID()}`;
  if (!id.startsWith('task_')) fail('invalid-task', 'Task id is invalid');
  const task = parseTask({
    id,
    content: input.content,
    activeForm: input.activeForm,
    status: input.status ?? 'pending',
    delegation: input.delegation,
    createdAt: options.now,
    updatedAt: options.now,
  });
  return task;
}

function mutateTaskList(
  list: SessionTaskList,
  mutate: (items: SessionTask[]) => SessionTask[],
  now?: string,
  nextSource?: SessionTaskListSource,
): SessionTaskList {
  const parsed = parseSessionTaskList(list);
  if (!parsed) fail('invalid-list', 'Task list is invalid');
  const updatedAt = nowIso(now);
  if (Date.parse(updatedAt) < Date.parse(parsed.updatedAt)) {
    fail('invalid-list', 'Task list updatedAt cannot move backward');
  }
  const source = nextSource ?? parsed.source;
  const items = mutate(parsed.items.map(item => ({
    ...item,
    delegation: item.delegation ? { ...item.delegation } : undefined,
  })));
  validateItems(items, source);
  return { ...parsed, items, revision: parsed.revision + 1, updatedAt, source };
}

function findTaskIndex(items: SessionTask[], taskId: string): number {
  const index = items.findIndex(item => item.id === taskId);
  if (index < 0) fail('task-not-found', `Task not found: ${taskId}`);
  return index;
}

function assertNotTerminal(task: SessionTask): void {
  if (task.status === 'completed' || task.status === 'abandoned') {
    fail('terminal-task', 'Completed or abandoned tasks must be reopened before mutation');
  }
}

export function createSessionTaskList(
  inputs: CreateSessionTaskInput[],
  source: SessionTaskListSource = 'native-tool',
  options: { id?: string; taskIds?: string[]; now?: string } = {},
): SessionTaskList {
  if (!Array.isArray(inputs)) fail('invalid-list', 'Task inputs must be an array');
  if (!LIST_SOURCES.has(source)) fail('invalid-list', 'Task list source is invalid');
  const now = nowIso(options.now);
  const id = options.id ?? `tasks_${randomUUID()}`;
  if (!id.startsWith('tasks_')) fail('invalid-list', 'Task list id is invalid');
  if (options.taskIds && options.taskIds.length !== inputs.length) {
    fail('invalid-list', 'taskIds must match the number of task inputs');
  }
  const items = inputs.map((input, index) => createTask(input, {
    id: options.taskIds?.[index],
    now,
  }));
  validateItems(items, source);
  return {
    schemaVersion: SESSION_TASK_LIST_SCHEMA_VERSION,
    id,
    revision: 1,
    items,
    createdAt: now,
    updatedAt: now,
    source,
  };
}

export function parseSessionTaskList(value: unknown): SessionTaskList | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const candidate = value as Partial<SessionTaskList>;
  try {
    if (candidate.schemaVersion !== SESSION_TASK_LIST_SCHEMA_VERSION) return undefined;
    if (typeof candidate.id !== 'string' || !candidate.id.startsWith('tasks_')) return undefined;
    if (!Number.isInteger(candidate.revision) || (candidate.revision ?? 0) < 1) return undefined;
    if (!LIST_SOURCES.has(candidate.source as SessionTaskListSource)) return undefined;
    if (!Array.isArray(candidate.items)) return undefined;
    const createdAt = cleanTimestamp(candidate.createdAt, 'list.createdAt');
    const updatedAt = cleanTimestamp(candidate.updatedAt, 'list.updatedAt');
    if (Date.parse(updatedAt) < Date.parse(createdAt)) return undefined;
    const items = candidate.items.map(parseTask);
    validateItems(items, candidate.source as SessionTaskListSource);
    return {
      schemaVersion: SESSION_TASK_LIST_SCHEMA_VERSION,
      id: candidate.id,
      revision: candidate.revision as number,
      items,
      createdAt,
      updatedAt,
      source: candidate.source as SessionTaskListSource,
    };
  } catch {
    return undefined;
  }
}

export function assertSessionTaskListRevision(
  list: SessionTaskList | undefined,
  expectedListId: string,
  expectedRevision: number,
): SessionTaskList {
  if (!list) fail('stale-revision', 'No task list exists in this session');
  if (list.id !== expectedListId || list.revision !== expectedRevision) {
    fail('stale-revision', 'Task list changed; refresh and try again');
  }
  return list;
}

export function appendSessionTasks(
  list: SessionTaskList,
  inputs: CreateSessionTaskInput[],
  options: { taskIds?: string[]; now?: string } = {},
): SessionTaskList {
  if (!Array.isArray(inputs) || inputs.length === 0) fail('invalid-task', 'At least one task is required');
  if (options.taskIds && options.taskIds.length !== inputs.length) {
    fail('invalid-list', 'taskIds must match the number of task inputs');
  }
  const now = nowIso(options.now);
  return mutateTaskList(list, items => [
    ...items,
    ...inputs.map((input, index) => createTask(input, { id: options.taskIds?.[index], now })),
  ], now);
}

export function startSessionTask(list: SessionTaskList, taskId: string, now?: string): SessionTaskList {
  return mutateTaskList(list, items => {
    const index = findTaskIndex(items, taskId);
    const task = items[index]!;
    assertNotTerminal(task);
    if (task.status !== 'pending') fail('invalid-transition', 'Only a pending task can be started');
    items[index] = { ...task, status: 'in_progress', updatedAt: nowIso(now) };
    return items;
  }, now);
}

export function completeSessionTask(list: SessionTaskList, taskId: string, now?: string): SessionTaskList {
  return mutateTaskList(list, items => {
    const index = findTaskIndex(items, taskId);
    const task = items[index]!;
    assertNotTerminal(task);
    if (task.status !== 'in_progress') fail('invalid-transition', 'Only an in-progress task can be completed');
    items[index] = { ...task, status: 'completed', updatedAt: nowIso(now) };
    return items;
  }, now);
}

export function abandonSessionTask(list: SessionTaskList, taskId: string, now?: string): SessionTaskList {
  return mutateTaskList(list, items => {
    const index = findTaskIndex(items, taskId);
    const task = items[index]!;
    assertNotTerminal(task);
    if (task.status === 'delegated') fail('invalid-transition', 'A delegated task must be settled by the host');
    items[index] = { ...task, status: 'abandoned', updatedAt: nowIso(now) };
    return items;
  }, now);
}

export function reopenSessionTask(list: SessionTaskList, taskId: string, now?: string): SessionTaskList {
  return mutateTaskList(list, items => {
    const index = findTaskIndex(items, taskId);
    const task = items[index]!;
    if (task.status !== 'completed' && task.status !== 'abandoned') {
      fail('invalid-transition', 'Only a completed or abandoned task can be reopened');
    }
    items[index] = {
      ...task,
      status: 'pending',
      delegation: undefined,
      updatedAt: nowIso(now),
    };
    return items;
  }, now);
}

export function delegateSessionTask(
  list: SessionTaskList,
  taskId: string,
  delegation: SessionTaskDelegation,
  now?: string,
): SessionTaskList {
  return mutateTaskList(list, items => {
    const index = findTaskIndex(items, taskId);
    const task = items[index]!;
    assertNotTerminal(task);
    if (task.status !== 'pending' && task.status !== 'in_progress') {
      fail('invalid-transition', 'Only a pending or in-progress task can be delegated');
    }
    const parsedDelegation = parseDelegation(delegation);
    if (!parsedDelegation || parsedDelegation.outcome) {
      fail('invalid-delegation', 'A new delegation cannot have a terminal outcome');
    }
    items[index] = {
      ...task,
      status: 'delegated',
      delegation: parsedDelegation,
      updatedAt: nowIso(now),
    };
    return items;
  }, now, 'native-tool');
}

export function settleSessionTaskDelegation(
  list: SessionTaskList,
  taskId: string,
  outcome: SessionTaskDelegationOutcome,
  options: { summary?: string; now?: string } = {},
): SessionTaskList {
  return mutateTaskList(list, items => {
    const index = findTaskIndex(items, taskId);
    const task = items[index]!;
    assertNotTerminal(task);
    if (task.status !== 'delegated' || !task.delegation) {
      fail('invalid-transition', 'Only a delegated task can be settled');
    }
    if (!DELEGATION_OUTCOMES.has(outcome)) fail('invalid-delegation', 'Delegation outcome is invalid');
    const settledAt = nowIso(options.now);
    const delegation = parseDelegation({
      ...task.delegation,
      settledAt,
      outcome,
      summary: options.summary,
    })!;
    const status: SessionTaskStatus = outcome === 'succeeded'
      ? 'completed'
      : outcome === 'abandoned'
        ? 'abandoned'
        : 'pending';
    items[index] = { ...task, status, delegation, updatedAt: settledAt };
    return items;
  }, options.now);
}

/**
 * Restore advisory task state after a process restart. Work that was only
 * claimed by the interrupted process becomes pending again; delegated work is
 * resolved separately once receipt state is available.
 */
export function recoverSessionTaskListAfterRestart(
  list: SessionTaskList,
  now?: string,
): SessionTaskList {
  const parsed = parseSessionTaskList(list);
  if (!parsed) fail('invalid-list', 'Task list is invalid');
  if (!parsed.items.some(item => item.status === 'in_progress')) return parsed;
  const requestedNow = nowIso(now);
  const recoveryNow = Date.parse(requestedNow) < Date.parse(parsed.updatedAt)
    ? parsed.updatedAt
    : requestedNow;
  return mutateTaskList(parsed, items => items.map(item => (
    item.status === 'in_progress'
      ? { ...item, status: 'pending' as const, updatedAt: recoveryNow }
      : item
  )), recoveryNow);
}
