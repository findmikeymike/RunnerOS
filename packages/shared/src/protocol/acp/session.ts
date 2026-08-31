/**
 * ACP session bridge with SQLite persistence.
 *
 * Ported from Hermes hermes_acp/session.py (MIT).
 *   - SessionManager + SessionDB    → SessionManager
 *   - create_session / get_session  → createSession / getSession
 *   - fork_session                   → forkSession
 *   - remove_session                 → removeSession
 *   - save_session                   → saveSession
 *   - _translate_acp_cwd            → translateAcpCwd (WSL paths)
 *
 * Persists to a bun:sqlite DB so sessions survive server restart.
 *
 * See THIRD_PARTY_NOTICES.md for license attribution.
 */

import { Database } from 'bun:sqlite';
import { chmodSync } from 'node:fs';

export interface AcpSessionState {
  id: string;
  cwd: string;
  history: Array<{ role: string; content: string }>;
  modelConfig: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  /** AbortController for in-flight prompt cancellation. */
  abort?: AbortController;
}

interface DbRow {
  id: string;
  cwd: string;
  history_json: string;
  model_config_json: string;
  created_at: number;
  updated_at: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS acp_sessions (
  id TEXT PRIMARY KEY,
  cwd TEXT NOT NULL,
  history_json TEXT NOT NULL,
  model_config_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

let _sessionIdCounter = 0;
function makeSessionId(): string {
  _sessionIdCounter += 1;
  return `acp-${Date.now().toString(36)}-${_sessionIdCounter}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

/**
 * WSL path translation: Windows drive paths (`E:\\Projects`) → `/mnt/e/projects`.
 * Hermes ref: hermes_acp/session.py:29-70. Only applied when explicit platform
 * detection says we're on linux + WSL OR caller passes `forceWsl=true`.
 */
export function translateAcpCwd(cwd: string, opts?: { forceWsl?: boolean; isWsl?: boolean }): string {
  const isWsl = opts?.forceWsl ?? opts?.isWsl ?? detectWsl();
  if (!isWsl) return cwd;
  // Match `C:\path` or `C:/path`
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(cwd);
  if (!m) return cwd;
  const drive = (m[1] ?? '').toLowerCase();
  const rest = (m[2] ?? '').replace(/\\/g, '/');
  return `/mnt/${drive}/${rest}`;
}

function detectWsl(): boolean {
  if (process.platform !== 'linux') return false;
  return Boolean(process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP);
}

export class SessionManager {
  private readonly db: Database;
  private readonly mem = new Map<string, AcpSessionState>();
  private readonly locks = new Map<string, Promise<void>>();

  constructor(dbPath: string | ':memory:' = ':memory:') {
    this.db = new Database(dbPath);
    this.db.exec(SCHEMA);
    // H3: lock the ACP session DB to user-only read/write. Session rows
    // include prompt history which routinely contains secrets and PII.
    if (dbPath !== ':memory:') {
      try {
        chmodSync(dbPath, 0o600);
      } catch {
        // Non-fatal — file may not exist yet on first open in some bun
        // versions; the DB itself is functional regardless.
      }
    }
  }

  close(): void {
    this.db.close();
  }

  /** Run `fn` with a per-session mutex. */
  async withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(id) ?? Promise.resolve();
    let resolveLock!: () => void;
    const next = new Promise<void>((r) => {
      resolveLock = r;
    });
    this.locks.set(id, prev.then(() => next));
    try {
      await prev;
      return await fn();
    } finally {
      resolveLock();
      // Clean up if no further waiters.
      if (this.locks.get(id) === prev.then(() => next)) {
        this.locks.delete(id);
      }
    }
  }

  createSession(cwd: string, modelConfig: Record<string, unknown> = {}): AcpSessionState {
    const id = makeSessionId();
    const now = Date.now();
    const state: AcpSessionState = {
      id,
      cwd: translateAcpCwd(cwd),
      history: [],
      modelConfig,
      createdAt: now,
      updatedAt: now,
    };
    this.mem.set(id, state);
    this.saveSession(state);
    return state;
  }

  getSession(id: string): AcpSessionState | null {
    const cached = this.mem.get(id);
    if (cached) return cached;

    const row = this.db
      .query<DbRow, [string]>('SELECT * FROM acp_sessions WHERE id = ?')
      .get(id);
    if (!row) return null;

    let history: AcpSessionState['history'] = [];
    let modelConfig: Record<string, unknown> = {};
    try {
      history = JSON.parse(row.history_json) as AcpSessionState['history'];
    } catch {
      /* ignore */
    }
    try {
      modelConfig = JSON.parse(row.model_config_json) as Record<string, unknown>;
    } catch {
      /* ignore */
    }
    const state: AcpSessionState = {
      id: row.id,
      cwd: row.cwd,
      history,
      modelConfig,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
    this.mem.set(id, state);
    return state;
  }

  forkSession(id: string): AcpSessionState | null {
    const src = this.getSession(id);
    if (!src) return null;
    const newId = makeSessionId();
    const now = Date.now();
    const forked: AcpSessionState = {
      id: newId,
      cwd: src.cwd,
      history: src.history.map((h) => ({ ...h })),
      modelConfig: { ...src.modelConfig },
      createdAt: now,
      updatedAt: now,
    };
    this.mem.set(newId, forked);
    this.saveSession(forked);
    return forked;
  }

  removeSession(id: string): void {
    this.mem.delete(id);
    this.db.query('DELETE FROM acp_sessions WHERE id = ?').run(id);
  }

  saveSession(state: AcpSessionState): void {
    state.updatedAt = Date.now();
    this.db
      .query(
        `INSERT INTO acp_sessions (id, cwd, history_json, model_config_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           cwd = excluded.cwd,
           history_json = excluded.history_json,
           model_config_json = excluded.model_config_json,
           updated_at = excluded.updated_at`,
      )
      .run(
        state.id,
        state.cwd,
        JSON.stringify(state.history),
        JSON.stringify(state.modelConfig),
        state.createdAt,
        state.updatedAt,
      );
  }

  /** Append a history entry and persist. */
  appendHistory(id: string, entry: { role: string; content: string }): void {
    const state = this.getSession(id);
    if (!state) return;
    state.history.push(entry);
    this.saveSession(state);
  }

  /** Cancel any in-flight prompt for this session. */
  cancel(id: string): boolean {
    const state = this.mem.get(id);
    if (!state?.abort) return false;
    state.abort.abort();
    return true;
  }

  listIds(): string[] {
    const rows = this.db.query<{ id: string }, []>('SELECT id FROM acp_sessions').all();
    return rows.map((r) => r.id);
  }
}
