/**
 * Escalation Store — SQLite-backed queue of pending write approvals.
 *
 * Concept-only re-implementation from OpenHuman (GPL-3.0) — NO source code
 * copied. Behavior derived from the prose specification in
 * `.planning/research/04-openhuman-concepts.md` §Upgrade 5 ("Subconscious
 * Mode — Unapproved Write Detection") and SPEC §R7 in
 * `.planning/phases/01-orchestration-backbone/01-SPEC.md`.
 *
 * Backing store: the runtime's built-in synchronous SQLite implementation
 * (`bun:sqlite` in Bun, `node:sqlite` in Electron/Node). DB file lives at
 * `${CONFIG_DIR}/escalations.db`, sibling to other RunnerOS on-disk artifacts.
 * A factory function `getEscalationStore(path?)` is provided so tests can
 * inject an in-memory or temp-file DB for isolation.
 *
 * Pause/resume contract:
 *   The store knows nothing about the agent runtime. It only persists rows
 *   and exposes CRUD. The runtime layer (prompt-handler / subconscious mode)
 *   maintains an in-memory map of `escalationId -> deferred` and uses
 *   `subscribe()` to learn when a row flips status, then resolves the
 *   matching deferred. This keeps the store side-effect-free and safe to
 *   instantiate in tests.
 */

import { existsSync, mkdirSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CONFIG_DIR } from '../config/paths.ts';
import { createLogger } from '../utils/debug.ts';

const log = createLogger('escalation-store');

interface SqliteStatement {
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
  run(...params: unknown[]): unknown;
}

interface SqliteDatabase {
  exec(sql: string): unknown;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

type SqliteDatabaseConstructor = new (path: string) => SqliteDatabase;

function resolveSqliteDatabaseConstructor(): SqliteDatabaseConstructor {
  if (process.versions.bun) {
    const moduleId = ['bun', 'sqlite'].join(':');
    const sqlite = require(moduleId) as { Database: SqliteDatabaseConstructor };
    return sqlite.Database;
  }

  const moduleId = ['node', 'sqlite'].join(':');
  const sqlite = require(moduleId) as { DatabaseSync: SqliteDatabaseConstructor };
  return sqlite.DatabaseSync;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type EscalationStatus = 'pending' | 'approved' | 'rejected';

export interface EscalationToolCall {
  /** Tool name (e.g. "Bash", "Write", "api_github") */
  name: string;
  /** Tool arguments as the agent proposed them */
  args: unknown;
}

export interface Escalation {
  id: string;
  workflowRunId: string;
  taskId?: string;
  recommendation: string;
  status: EscalationStatus;
  createdAt: number;
  resolvedAt?: number;
  durationMs?: number;
  toolCall: EscalationToolCall;
  /** JSON-serializable result attached when the escalation resolves. */
  result?: unknown;
  resolvedBy?: EscalationResolver;
}

export interface EscalationResolver {
  type: 'user';
  clientId: string;
}

export interface CreateEscalationInput {
  workflowRunId: string;
  taskId?: string;
  recommendation: string;
  toolCall: EscalationToolCall;
  /**
   * Duration (ms) of the analysis-only phase before the escalation was raised.
   * Reported back through the `UnapprovedWrite` outcome shape.
   */
  durationMs?: number;
}

export interface ListPendingOptions {
  workflowRunId?: string;
  limit?: number;
}

export type EscalationListener = (escalation: Escalation) => void;

export interface EscalationStore {
  create(input: CreateEscalationInput): Escalation;
  listPending(opts?: ListPendingOptions): Escalation[];
  get(id: string): Escalation | null;
  approve(id: string, resolvedBy: EscalationResolver, result?: unknown): Escalation;
  reject(id: string, resolvedBy: EscalationResolver, result?: unknown): Escalation;
  subscribe(listener: EscalationListener): () => void;
  close(): void;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const SCHEMA = `
CREATE TABLE IF NOT EXISTS escalations (
  id              TEXT PRIMARY KEY,
  workflow_run_id TEXT NOT NULL,
  task_id         TEXT,
  recommendation  TEXT NOT NULL,
  status          TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),
  created_at      INTEGER NOT NULL,
  resolved_at     INTEGER,
  duration_ms     INTEGER,
  tool_call_json  TEXT NOT NULL,
  result_json     TEXT,
  resolved_by_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_escalations_status_created
  ON escalations(status, created_at);
CREATE INDEX IF NOT EXISTS idx_escalations_workflow_run
  ON escalations(workflow_run_id);
`;

// ---------------------------------------------------------------------------
// Row marshalling
// ---------------------------------------------------------------------------

interface Row {
  id: string;
  workflow_run_id: string;
  task_id: string | null;
  recommendation: string;
  status: EscalationStatus;
  created_at: number;
  resolved_at: number | null;
  duration_ms: number | null;
  tool_call_json: string;
  result_json: string | null;
  resolved_by_json: string | null;
}

function rowToEscalation(r: Row): Escalation {
  let toolCall: EscalationToolCall;
  try {
    toolCall = JSON.parse(r.tool_call_json) as EscalationToolCall;
  } catch {
    // Defensive: an unreadable tool_call_json should not crash listing.
    toolCall = { name: '<corrupted>', args: null };
  }
  let result: unknown = undefined;
  if (r.result_json) {
    try {
      result = JSON.parse(r.result_json);
    } catch {
      result = undefined;
    }
  }
  let resolvedBy: EscalationResolver | undefined;
  if (r.resolved_by_json) {
    try {
      resolvedBy = JSON.parse(r.resolved_by_json) as EscalationResolver;
    } catch {
      resolvedBy = undefined;
    }
  }
  return {
    id: r.id,
    workflowRunId: r.workflow_run_id,
    taskId: r.task_id ?? undefined,
    recommendation: r.recommendation,
    status: r.status,
    createdAt: r.created_at,
    resolvedAt: r.resolved_at ?? undefined,
    durationMs: r.duration_ms ?? undefined,
    toolCall,
    result,
    resolvedBy,
  };
}

// ---------------------------------------------------------------------------
// Store implementation
// ---------------------------------------------------------------------------

class SqliteEscalationStore implements EscalationStore {
  private readonly db: SqliteDatabase;
  private readonly listeners = new Set<EscalationListener>();

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') {
      const parent = dirname(dbPath);
      if (!existsSync(parent)) {
        mkdirSync(parent, { recursive: true });
      }
    }
    const Database = resolveSqliteDatabaseConstructor();
    this.db = new Database(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec(SCHEMA);
    const columns = this.db.prepare('PRAGMA table_info(escalations)').all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === 'resolved_by_json')) {
      this.db.exec('ALTER TABLE escalations ADD COLUMN resolved_by_json TEXT;');
    }
    // H3: lock the on-disk DB to user-only read/write. Pending escalation
    // rows can carry tool-call recommendation strings that include secrets
    // (PR bodies, paths to `.env`, etc.); the default umask leaves them
    // world-readable on shared systems.
    if (dbPath !== ':memory:') {
      try {
        chmodSync(dbPath, 0o600);
      } catch (err) {
        log.warn(`[escalation-store] chmod 0o600 failed for ${dbPath}: ${(err as Error).message}`);
      }
    }
  }

  create(input: CreateEscalationInput): Escalation {
    const id = crypto.randomUUID();
    const createdAt = Date.now();
    const toolCallJson = JSON.stringify(input.toolCall);
    this.db
      .prepare(
        `INSERT INTO escalations (
           id, workflow_run_id, task_id, recommendation,
           status, created_at, resolved_at, duration_ms, tool_call_json, result_json
         ) VALUES (?, ?, ?, ?, 'pending', ?, NULL, ?, ?, NULL)`,
      )
      .run(
        id,
        input.workflowRunId,
        input.taskId ?? null,
        input.recommendation,
        createdAt,
        input.durationMs ?? null,
        toolCallJson,
      );

    const escalation: Escalation = {
      id,
      workflowRunId: input.workflowRunId,
      taskId: input.taskId,
      recommendation: input.recommendation,
      status: 'pending',
      createdAt,
      durationMs: input.durationMs,
      toolCall: input.toolCall,
    };
    this.notify(escalation);
    return escalation;
  }

  listPending(opts: ListPendingOptions = {}): Escalation[] {
    const limit = opts.limit ?? 1000;
    const rows = opts.workflowRunId
      ? (this.db
          .prepare(
            `SELECT * FROM escalations
             WHERE status = 'pending' AND workflow_run_id = ?
             ORDER BY created_at ASC LIMIT ?`,
          )
          .all(opts.workflowRunId, limit) as Row[])
      : (this.db
          .prepare(
            `SELECT * FROM escalations
             WHERE status = 'pending'
             ORDER BY created_at ASC LIMIT ?`,
          )
          .all(limit) as Row[]);
    return rows.map(rowToEscalation);
  }

  get(id: string): Escalation | null {
    const row = this.db
      .prepare(`SELECT * FROM escalations WHERE id = ?`)
      .get(id) as Row | null;
    return row ? rowToEscalation(row) : null;
  }

  approve(id: string, resolvedBy: EscalationResolver, result?: unknown): Escalation {
    return this.resolve(id, 'approved', resolvedBy, result);
  }

  reject(id: string, resolvedBy: EscalationResolver, result?: unknown): Escalation {
    return this.resolve(id, 'rejected', resolvedBy, result);
  }

  private resolve(
    id: string,
    next: 'approved' | 'rejected',
    resolvedBy: EscalationResolver,
    result: unknown,
  ): Escalation {
    const current = this.get(id);
    if (!current) {
      throw new Error(`Escalation not found: ${id}`);
    }
    if (current.status !== 'pending') {
      throw new Error(
        `Cannot ${next} escalation ${id}: current status is "${current.status}".`,
      );
    }
    const resolvedAt = Date.now();
    const resultJson = result === undefined ? null : JSON.stringify(result);
    const resolvedByJson = JSON.stringify(resolvedBy);
    this.db
      .prepare(
        `UPDATE escalations
         SET status = ?, resolved_at = ?, result_json = ?, resolved_by_json = ?
         WHERE id = ?`,
      )
      .run(next, resolvedAt, resultJson, resolvedByJson, id);

    const updated: Escalation = {
      ...current,
      status: next,
      resolvedAt,
      result,
      resolvedBy,
    };
    this.notify(updated);
    return updated;
  }

  subscribe(listener: EscalationListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(e: Escalation): void {
    for (const l of this.listeners) {
      try {
        l(e);
      } catch (err) {
        log.warn(
          `[EscalationStore] listener threw: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  close(): void {
    this.listeners.clear();
    this.db.close();
  }
}

// ---------------------------------------------------------------------------
// Factory + singleton
// ---------------------------------------------------------------------------

let defaultStore: EscalationStore | null = null;

/**
 * Default on-disk path. Honors `CRAFT_CONFIG_DIR` via the shared `CONFIG_DIR`
 * resolver — same parent directory as other RunnerOS data files.
 */
export function getDefaultEscalationStorePath(): string {
  return join(CONFIG_DIR, 'escalations.db');
}

/**
 * Get a store instance. Default: process-wide singleton at the disk path
 * above. Pass an explicit path (e.g. `:memory:` or a temp file) for tests.
 *
 * Each explicit path returns a fresh instance — tests should `.close()` to
 * release the file lock.
 */
export function getEscalationStore(path?: string): EscalationStore {
  if (path !== undefined) {
    return new SqliteEscalationStore(path);
  }
  if (!defaultStore) {
    defaultStore = new SqliteEscalationStore(getDefaultEscalationStorePath());
  }
  return defaultStore;
}

/** Test-only: reset the cached singleton (e.g. after CRAFT_CONFIG_DIR override). */
export function _resetDefaultEscalationStore(): void {
  if (defaultStore) {
    defaultStore.close();
    defaultStore = null;
  }
}

// ---------------------------------------------------------------------------
// Module-level convenience API (matches the SPEC R7 interface)
// ---------------------------------------------------------------------------

export function createEscalation(input: CreateEscalationInput): Escalation {
  return getEscalationStore().create(input);
}

export function listPendingEscalations(opts?: ListPendingOptions): Escalation[] {
  return getEscalationStore().listPending(opts);
}

export function getEscalation(id: string): Escalation | null {
  return getEscalationStore().get(id);
}

export function approveEscalation(id: string, resolvedBy: EscalationResolver, result?: unknown): Escalation {
  return getEscalationStore().approve(id, resolvedBy, result);
}

export function rejectEscalation(id: string, resolvedBy: EscalationResolver, result?: unknown): Escalation {
  return getEscalationStore().reject(id, resolvedBy, result);
}
