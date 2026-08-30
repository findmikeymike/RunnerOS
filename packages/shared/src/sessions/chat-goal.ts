import { randomUUID } from 'node:crypto';

export const CHAT_GOAL_SCHEMA_VERSION = 1 as const;
export const CHAT_GOAL_DEFAULT_MAX_ROUNDS = 6;
export const CHAT_GOAL_MIN_ROUNDS = 2;
export const CHAT_GOAL_MAX_ROUNDS = 12;
export const CHAT_GOAL_MAX_OBJECTIVE_CHARS = 4_000;
export const CHAT_GOAL_MAX_DONE_WHEN_CHARS = 2_000;

export type ChatGoalStatus =
  | 'active'
  | 'paused'
  | 'blocked'
  | 'budget-limited'
  | 'complete'
  | 'cancelled';

export type ChatGoalStopCode =
  | 'user-paused'
  | 'user-cancelled'
  | 'needs-approval'
  | 'needs-auth'
  | 'needs-decision'
  | 'waiting-external'
  | 'restart-disarmed'
  | 'ownership-changed'
  | 'session-archived'
  | 'provider-error'
  | 'persistence-failed'
  | 'no-progress'
  | 'round-limit'
  | 'token-limit'
  | 'repeated-blocker'
  | 'stale-revision';

export interface ChatGoalCompletion {
  summary: string;
  evidence?: string[];
  completedAt: number;
}

export interface ChatGoalStop {
  code: ChatGoalStopCode;
  message: string;
  at: number;
}

export interface ChatGoalBlockerAudit {
  fingerprint: string;
  consecutiveGoalTurns: number;
}

export interface ChatGoalState {
  schemaVersion: typeof CHAT_GOAL_SCHEMA_VERSION;
  id: string;
  objective: string;
  doneWhen?: string;
  status: ChatGoalStatus;
  revision: number;
  round: number;
  maxRounds: number;
  createdAt: number;
  updatedAt: number;
  tokenBaseline?: number;
  tokenBudget?: number;
  completion?: ChatGoalCompletion;
  stop?: ChatGoalStop;
  blockerAudit?: ChatGoalBlockerAudit;
}

export type ChatGoalEventType =
  | 'created'
  | 'edited'
  | 'paused'
  | 'resumed'
  | 'completed'
  | 'blocked'
  | 'budget-limited'
  | 'cancelled';

export interface ChatGoalEvent {
  type: ChatGoalEventType;
  goalId: string;
  revision: number;
  timestamp: number;
  round: number;
  status: ChatGoalStatus;
  summary: string;
}

export interface CreateChatGoalInput {
  objective: string;
  doneWhen?: string;
  maxRounds?: number;
  tokenBudget?: number;
}

export interface EditChatGoalInput {
  objective?: string;
  doneWhen?: string | null;
  maxRounds?: number;
  tokenBudget?: number | null;
}

export class ChatGoalValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChatGoalValidationError';
  }
}

export class ChatGoalConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChatGoalConflictError';
  }
}

const STATUSES = new Set<ChatGoalStatus>([
  'active',
  'paused',
  'blocked',
  'budget-limited',
  'complete',
  'cancelled',
]);

const STOP_CODES = new Set<ChatGoalStopCode>([
  'user-paused',
  'user-cancelled',
  'needs-approval',
  'needs-auth',
  'needs-decision',
  'waiting-external',
  'restart-disarmed',
  'ownership-changed',
  'session-archived',
  'provider-error',
  'persistence-failed',
  'no-progress',
  'round-limit',
  'token-limit',
  'repeated-blocker',
  'stale-revision',
]);

function cleanRequired(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ChatGoalValidationError(`${field} is required`);
  }
  const cleaned = value.trim();
  if (cleaned.length > maxLength) {
    throw new ChatGoalValidationError(`${field} must be ${maxLength} characters or fewer`);
  }
  return cleaned;
}

function cleanOptional(value: unknown, field: string, maxLength: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new ChatGoalValidationError(`${field} must be a string`);
  }
  const cleaned = value.trim();
  if (!cleaned) return undefined;
  if (cleaned.length > maxLength) {
    throw new ChatGoalValidationError(`${field} must be ${maxLength} characters or fewer`);
  }
  return cleaned;
}

function validateMaxRounds(value: unknown, currentRound = 0): number {
  if (!Number.isInteger(value)) {
    throw new ChatGoalValidationError('maxRounds must be an integer');
  }
  const maxRounds = value as number;
  if (maxRounds < CHAT_GOAL_MIN_ROUNDS || maxRounds > CHAT_GOAL_MAX_ROUNDS) {
    throw new ChatGoalValidationError(
      `maxRounds must be between ${CHAT_GOAL_MIN_ROUNDS} and ${CHAT_GOAL_MAX_ROUNDS}`,
    );
  }
  if (maxRounds < currentRound) {
    throw new ChatGoalValidationError('maxRounds cannot be lower than rounds already used');
  }
  return maxRounds;
}

function validateTokenBudget(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new ChatGoalValidationError('tokenBudget must be a positive integer');
  }
  return value as number;
}

function validateTokenBaseline(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new ChatGoalValidationError('tokenBaseline must be a non-negative integer');
  }
  return value as number;
}

export function isChatGoalTerminal(status: ChatGoalStatus): boolean {
  return status === 'complete' || status === 'cancelled';
}

export function createChatGoalState(
  input: CreateChatGoalInput,
  options: { now?: number; id?: string; tokenBaseline?: number } = {},
): ChatGoalState {
  const now = options.now ?? Date.now();
  return {
    schemaVersion: CHAT_GOAL_SCHEMA_VERSION,
    id: options.id ?? randomUUID(),
    objective: cleanRequired(input.objective, 'objective', CHAT_GOAL_MAX_OBJECTIVE_CHARS),
    doneWhen: cleanOptional(input.doneWhen, 'doneWhen', CHAT_GOAL_MAX_DONE_WHEN_CHARS),
    status: 'active',
    revision: 1,
    round: 0,
    maxRounds: validateMaxRounds(input.maxRounds ?? CHAT_GOAL_DEFAULT_MAX_ROUNDS),
    createdAt: now,
    updatedAt: now,
    tokenBaseline: validateTokenBaseline(options.tokenBaseline),
    tokenBudget: validateTokenBudget(input.tokenBudget),
  };
}

export function parseChatGoalState(value: unknown): ChatGoalState | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const candidate = value as Partial<ChatGoalState>;
  try {
    if (candidate.schemaVersion !== CHAT_GOAL_SCHEMA_VERSION) return undefined;
    if (typeof candidate.id !== 'string' || !candidate.id.trim()) return undefined;
    if (!STATUSES.has(candidate.status as ChatGoalStatus)) return undefined;
    if (!Number.isInteger(candidate.revision) || (candidate.revision ?? 0) < 1) return undefined;
    if (!Number.isInteger(candidate.round) || (candidate.round ?? -1) < 0) return undefined;
    const maxRounds = validateMaxRounds(candidate.maxRounds, candidate.round);
    if (!Number.isFinite(candidate.createdAt) || !Number.isFinite(candidate.updatedAt)) return undefined;
    const parsed: ChatGoalState = {
      ...candidate,
      schemaVersion: CHAT_GOAL_SCHEMA_VERSION,
      id: candidate.id,
      objective: cleanRequired(candidate.objective, 'objective', CHAT_GOAL_MAX_OBJECTIVE_CHARS),
      doneWhen: cleanOptional(candidate.doneWhen, 'doneWhen', CHAT_GOAL_MAX_DONE_WHEN_CHARS),
      status: candidate.status as ChatGoalStatus,
      revision: candidate.revision as number,
      round: candidate.round as number,
      maxRounds,
      createdAt: candidate.createdAt as number,
      updatedAt: candidate.updatedAt as number,
      tokenBaseline: validateTokenBaseline(candidate.tokenBaseline),
      tokenBudget: validateTokenBudget(candidate.tokenBudget),
    };
    if (candidate.stop) {
      if (!STOP_CODES.has(candidate.stop.code) || typeof candidate.stop.message !== 'string' || !Number.isFinite(candidate.stop.at)) {
        return undefined;
      }
      parsed.stop = { ...candidate.stop };
    }
    if (candidate.completion) {
      if (typeof candidate.completion.summary !== 'string' || !Number.isFinite(candidate.completion.completedAt)) return undefined;
      parsed.completion = {
        summary: candidate.completion.summary,
        evidence: Array.isArray(candidate.completion.evidence)
          ? candidate.completion.evidence.filter((item): item is string => typeof item === 'string')
          : undefined,
        completedAt: candidate.completion.completedAt,
      };
    }
    if (candidate.blockerAudit) {
      if (
        typeof candidate.blockerAudit.fingerprint !== 'string'
        || !Number.isInteger(candidate.blockerAudit.consecutiveGoalTurns)
        || candidate.blockerAudit.consecutiveGoalTurns < 1
      ) return undefined;
      parsed.blockerAudit = { ...candidate.blockerAudit };
    }
    if (parsed.status === 'complete' && !parsed.completion) return undefined;
    if (parsed.status !== 'complete' && parsed.completion) return undefined;
    if (parsed.status === 'active' && parsed.stop) return undefined;
    if (
      (parsed.status === 'paused' || parsed.status === 'blocked' || parsed.status === 'budget-limited' || parsed.status === 'cancelled')
      && !parsed.stop
    ) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

export function assertChatGoalRevision(
  goal: ChatGoalState | undefined,
  expectedGoalId: string,
  expectedRevision: number,
): ChatGoalState {
  if (!goal) throw new ChatGoalConflictError('No Goal exists in this chat');
  if (goal.id !== expectedGoalId || goal.revision !== expectedRevision) {
    throw new ChatGoalConflictError('Goal changed; refresh and try again');
  }
  return goal;
}

export function editChatGoalState(
  goal: ChatGoalState,
  input: EditChatGoalInput,
  now = Date.now(),
): ChatGoalState {
  if (isChatGoalTerminal(goal.status)) {
    throw new ChatGoalConflictError('A completed or cancelled Goal cannot be edited');
  }
  const objective = input.objective === undefined
    ? goal.objective
    : cleanRequired(input.objective, 'objective', CHAT_GOAL_MAX_OBJECTIVE_CHARS);
  const doneWhen = input.doneWhen === undefined
    ? goal.doneWhen
    : cleanOptional(input.doneWhen, 'doneWhen', CHAT_GOAL_MAX_DONE_WHEN_CHARS);
  const maxRounds = input.maxRounds === undefined
    ? goal.maxRounds
    : validateMaxRounds(input.maxRounds, goal.round);
  const tokenBudget = input.tokenBudget === undefined
    ? goal.tokenBudget
    : validateTokenBudget(input.tokenBudget);
  return {
    ...goal,
    objective,
    doneWhen,
    maxRounds,
    tokenBudget,
    revision: goal.revision + 1,
    updatedAt: now,
    completion: undefined,
    blockerAudit: undefined,
  };
}

export function pauseChatGoalState(
  goal: ChatGoalState,
  stop: Omit<ChatGoalStop, 'at'> & { at?: number },
): ChatGoalState {
  if (isChatGoalTerminal(goal.status)) {
    throw new ChatGoalConflictError('A completed or cancelled Goal cannot be paused');
  }
  const now = stop.at ?? Date.now();
  return {
    ...goal,
    status: 'paused',
    updatedAt: now,
    stop: { ...stop, at: now },
  };
}

export function resumeChatGoalState(goal: ChatGoalState, now = Date.now()): ChatGoalState {
  if (goal.status === 'active') return goal;
  if (isChatGoalTerminal(goal.status)) {
    throw new ChatGoalConflictError('A completed or cancelled Goal cannot be resumed');
  }
  if (goal.round >= goal.maxRounds) {
    throw new ChatGoalConflictError('Increase the round cap before resuming this Goal');
  }
  return {
    ...goal,
    status: 'active',
    revision: goal.revision + 1,
    updatedAt: now,
    stop: undefined,
    blockerAudit: undefined,
  };
}

export function admitChatGoalRound(goal: ChatGoalState, now = Date.now()): ChatGoalState {
  if (goal.status !== 'active') {
    throw new ChatGoalConflictError('Only an active Goal can start another round');
  }
  if (goal.round >= goal.maxRounds) {
    throw new ChatGoalConflictError('Goal round limit reached');
  }
  return { ...goal, round: goal.round + 1, updatedAt: now };
}

export function completeChatGoalState(
  goal: ChatGoalState,
  completion: Omit<ChatGoalCompletion, 'completedAt'> & { completedAt?: number },
): ChatGoalState {
  if (goal.status !== 'active') {
    throw new ChatGoalConflictError('Only an active Goal can be completed');
  }
  const now = completion.completedAt ?? Date.now();
  const summary = cleanRequired(completion.summary, 'summary', CHAT_GOAL_MAX_OBJECTIVE_CHARS);
  const evidence = completion.evidence
    ?.map(item => cleanOptional(item, 'evidence', CHAT_GOAL_MAX_OBJECTIVE_CHARS))
    .filter((item): item is string => !!item);
  return {
    ...goal,
    status: 'complete',
    revision: goal.revision + 1,
    updatedAt: now,
    completion: { summary, evidence: evidence?.length ? evidence : undefined, completedAt: now },
    stop: undefined,
    blockerAudit: undefined,
  };
}

export function limitChatGoalByBudget(
  goal: ChatGoalState,
  kind: 'round' | 'token',
  now = Date.now(),
): ChatGoalState {
  if (goal.status !== 'active') {
    throw new ChatGoalConflictError('Only an active Goal can be budget-limited');
  }
  const code: ChatGoalStopCode = kind === 'round' ? 'round-limit' : 'token-limit';
  const message = kind === 'round'
    ? `Goal reached its ${goal.maxRounds}-round limit.`
    : 'Goal reached its token budget.';
  return {
    ...goal,
    status: 'budget-limited',
    updatedAt: now,
    stop: { code, message, at: now },
  };
}

export function recordChatGoalBlocker(
  goal: ChatGoalState,
  input: { fingerprint: string; message: string },
  now = Date.now(),
): ChatGoalState {
  if (goal.status !== 'active') {
    throw new ChatGoalConflictError('Only an active Goal can record a blocker');
  }
  const fingerprint = cleanRequired(input.fingerprint, 'fingerprint', 500);
  const message = cleanRequired(input.message, 'message', CHAT_GOAL_MAX_OBJECTIVE_CHARS);
  const consecutiveGoalTurns = goal.blockerAudit?.fingerprint === fingerprint
    ? goal.blockerAudit.consecutiveGoalTurns + 1
    : 1;
  const blockerAudit = { fingerprint, consecutiveGoalTurns };
  if (consecutiveGoalTurns < 3) {
    return { ...goal, blockerAudit, updatedAt: now };
  }
  return {
    ...goal,
    status: 'blocked',
    updatedAt: now,
    blockerAudit,
    stop: { code: 'repeated-blocker', message, at: now },
  };
}

export function disarmChatGoalAfterRestart(goal: ChatGoalState, now = Date.now()): ChatGoalState {
  if (goal.status !== 'active') return goal;
  return pauseChatGoalState(goal, {
    code: 'restart-disarmed',
    message: 'App restarted. Review the Goal and resume it explicitly.',
    at: now,
  });
}

export function cancelChatGoalState(
  goal: ChatGoalState,
  message = 'Goal stopped by the user.',
  now = Date.now(),
): ChatGoalState {
  if (goal.status === 'complete') {
    throw new ChatGoalConflictError('A completed Goal cannot be cancelled');
  }
  if (goal.status === 'cancelled') return goal;
  return {
    ...goal,
    status: 'cancelled',
    revision: goal.revision + 1,
    updatedAt: now,
    stop: { code: 'user-cancelled', message, at: now },
    blockerAudit: undefined,
  };
}

export function makeChatGoalEvent(
  goal: ChatGoalState,
  type: ChatGoalEventType,
  summary: string,
  timestamp = Date.now(),
): ChatGoalEvent {
  return {
    type,
    goalId: goal.id,
    revision: goal.revision,
    timestamp,
    round: goal.round,
    status: goal.status,
    summary: cleanRequired(summary, 'summary', CHAT_GOAL_MAX_OBJECTIVE_CHARS),
  };
}
