/**
 * File-based memory types.
 *
 * Phase 1 keeps markdown as the canonical store:
 *   ~/.agents/USER.md
 *   ~/.agents/agents/<slug>/MEMORY.md
 */

export const MEMORY_FILE = 'MEMORY.md';
export const USER_MEMORY_FILE = 'USER.md';
export const DELETED_MEMORIES_FILE = '.deleted-memories.json';
export const MEMORY_EVENTS_FILE = '.memory-events.jsonl';

/**
 * Previous generation of the event log, kept so rotation bounds the file
 * without throwing away the audit trail.
 */
export const MEMORY_EVENTS_ROTATED_FILE = '.memory-events.1.jsonl';

/**
 * Size at which the active event log is rotated.
 *
 * This log is the busiest writer in the memory system: one line per recalled
 * entry per recall call, plus one per injected entry per session launch. It was
 * append-only with no pruning, so it grew without limit for the lifetime of an
 * install. Rotating at 1 MB and keeping a single previous generation bounds it
 * at roughly 2 MB per scope while preserving recent history.
 */
export const MEMORY_EVENTS_MAX_BYTES = 1_000_000;
export const MEMORY_REVIEW_QUEUE_FILE = '.memory-review-queue.json';
export const MEMORY_SCHEMA_VERSION = 1;

export type MemoryScope = 'user' | 'agent';

export type MemoryEntryType = 'user' | 'feedback' | 'project' | 'reference';

export const MEMORY_ENTRY_TYPES: readonly MemoryEntryType[] = [
  'user',
  'feedback',
  'project',
  'reference',
] as const;

export interface MemoryFileEnvelope {
  version: 1;
  agent?: string;
}

/**
 * Which kind of workspace a memory was written in.
 *
 * Memory is global per agent, so without this a fact learned inside one
 * campaign reads in every other campaign — and in HQ — as though it were a
 * standing truth about the artist. "We lead this rollout with the B-side" is
 * not "this is how we release records".
 */
export type MemoryWorkspaceScope = 'hq' | 'campaign' | 'lab' | 'general';

export interface MemoryEntry {
  name: string;
  type: MemoryEntryType;
  created: string;
  updated?: string;
  expires?: string;
  /**
   * Where this was learned. Absent on entries written before provenance
   * existed, which are treated as HQ — what they effectively were.
   *
   * Deliberately not a nested object: the file is meant to be hand-edited, and
   * every other field in this frontmatter is a flat scalar.
   */
  workspaceScope?: MemoryWorkspaceScope;
  workspaceId?: string;
  /** Human-readable workspace name, for the rendered provenance hint. */
  workspaceLabel?: string;
  body: string;
}

export interface LoadedMemoryFile {
  scope: MemoryScope;
  agentSlug?: string;
  envelope: MemoryFileEnvelope;
  entries: MemoryEntry[];
  filePath: string;
  parseWarnings?: MemoryParseWarning[];
}

export interface MemoryStorageOptions {
  /**
   * Test-only escape hatch; production callers should use ~/.agents.
   *
   * This is the agents root, not the global agent library directory:
   *   <globalAgentsDir>/USER.md
   *   <globalAgentsDir>/agents/<slug>/MEMORY.md
   */
  globalAgentsDir?: string;
}

export interface SaveMemoryInput {
  scope: MemoryScope;
  agentSlug?: string;
  name: string;
  type: MemoryEntryType;
  body: string;
  expires?: string;
  /** Where this is being learned. Stamped by the caller that owns the session. */
  workspaceScope?: MemoryWorkspaceScope;
  workspaceId?: string;
  workspaceLabel?: string;
  /**
   * Bypass the tombstone block. Defaults to false. Set true ONLY for
   * user-initiated saves (UI manual add); agent tool calls must leave it
   * false so an agent can't immediately re-save what the user just forgot.
   * On a successful forced save, the matching tombstone is cleared so
   * subsequent saves of the same name behave normally.
   */
  force?: boolean;
  event?: MemoryMutationEventMetadata;
}

/**
 * Thrown when saveMemoryEntry is called with a name that's currently
 * tombstoned (via prior `forget_memory`). The caller can recover by
 * either explicitly passing `force: true` or calling `forgetDeletedMemoryName`
 * first.
 */
export class MemoryTombstonedError extends Error {
  readonly code = 'memory-tombstoned';
  constructor(public readonly entryName: string) {
    super(`"${entryName}" was previously forgotten. Pass force: true to overwrite the tombstone, or call forgetDeletedMemoryName(...) first.`);
    this.name = 'MemoryTombstonedError';
  }
}

export interface UpdateMemoryInput {
  scope: MemoryScope;
  agentSlug?: string;
  name: string;
  body?: string;
  expires?: string | null;
  event?: MemoryMutationEventMetadata;
}

export interface DeleteMemoryInput {
  scope: MemoryScope;
  agentSlug?: string;
  name: string;
  event?: MemoryMutationEventMetadata;
}

export type MemoryEventAction = 'save' | 'update' | 'forget' | 'inject' | 'recall' | 'consolidate';

export type MemoryEventSource =
  | 'user'
  | 'agent_tool'
  | 'sidecar'
  | 'import'
  | 'consolidation'
  | 'rpc'
  | 'system';

export interface MemoryMutationEventMetadata {
  source?: MemoryEventSource;
  runId?: string;
  evidence?: string;
  actor?: string;
}

export interface MemoryEvent {
  id: string;
  action: MemoryEventAction;
  scope: MemoryScope;
  agentSlug?: string;
  entryName?: string;
  source: MemoryEventSource;
  runId?: string;
  evidence?: string;
  actor?: string;
  createdAt: string;
}

export interface RecallMemoryInput {
  query: string;
  /**
   * Defaults to USER.md plus the selected agent MEMORY.md when agentSlug is
   * provided. Pass a narrowed list when the caller needs strict scope control.
   */
  scopes?: MemoryScope[];
  agentSlug?: string;
  limit?: number;
}

export interface MemoryRecallResult {
  scope: MemoryScope;
  agentSlug?: string;
  entry: MemoryEntry;
  score: number;
  reason: string;
  excerpt: string;
}

export type MemoryReviewAction = 'save' | 'update' | 'forget';

export type MemoryReviewStatus = 'pending' | 'approved' | 'rejected' | 'applied';

export interface MemoryReviewItem {
  id: string;
  status: MemoryReviewStatus;
  action: MemoryReviewAction;
  scope: MemoryScope;
  agentSlug?: string;
  name: string;
  type?: MemoryEntryType;
  body?: string;
  expires?: string | null;
  confidence: number;
  evidence?: string;
  sourceRunId?: string;
  source: MemoryEventSource;
  createdAt: string;
  decidedAt?: string;
  decisionReason?: string;
}

export interface EnqueueMemoryReviewInput {
  action: MemoryReviewAction;
  scope: MemoryScope;
  agentSlug?: string;
  name: string;
  type?: MemoryEntryType;
  body?: string;
  expires?: string | null;
  confidence: number;
  evidence?: string;
  sourceRunId?: string;
  source?: MemoryEventSource;
}

export interface ResolveMemoryReviewInput {
  id: string;
  status: Exclude<MemoryReviewStatus, 'pending'>;
  decisionReason?: string;
}

export interface ApplyMemoryReviewInput {
  id: string;
  decisionReason?: string;
}

export type MemoryParseWarningCode =
  | 'missing-entry-frontmatter'
  | 'invalid-entry-frontmatter'
  | 'missing-name'
  | 'invalid-type'
  | 'missing-created'
  | 'invalid-date'
  | 'duplicate-name';

export interface MemoryParseWarning {
  entryName?: string;
  field?: keyof MemoryEntry | 'entry';
  code: MemoryParseWarningCode;
  message: string;
}

export interface DeletedMemoryTombstones {
  version: 1;
  deleted: string[];
  updatedAt: string;
}
