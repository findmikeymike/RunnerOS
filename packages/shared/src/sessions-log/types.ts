/**
 * Cross-session summary log — `SESSIONS.md`.
 *
 * The sibling of `MEMORY.md`. Memory holds durable facts ("the artist prefers
 * concise captions"); this holds a chronological record of what happened
 * ("Tuesday was spent arguing about the release date"). Mixing them would force
 * a bad trade: inject session history into every prompt and bloat it, or stop
 * injecting durable facts and lose the recall that makes memory worth having.
 *
 * Spec: docs/memory/05-sessions-log.md
 */

/** `SESSIONS.md`, beside the agent's `MEMORY.md`. */
export const SESSIONS_LOG_FILE = 'SESSIONS.md';

/** Directory holding rolled-off years, e.g. `SESSIONS-archive/2026.md`. */
export const SESSIONS_ARCHIVE_DIR = 'SESSIONS-archive';

export const SESSIONS_LOG_SCHEMA_VERSION = 1;

/**
 * Entries kept in the live log before the oldest roll off into the archive.
 *
 * One entry per session means this grows for the life of an install. Rolling
 * off by year keeps the live file readable by hand — the point of markdown —
 * without deleting anything.
 */
export const SESSIONS_LOG_MAX_ENTRIES = 500;

/**
 * Where a session happened.
 *
 * Sessions are logged per agent, so an entry written while working a campaign
 * would otherwise be indistinguishable from career-wide work. This mirrors the
 * provenance decision for memory: keep everything visible, and record enough
 * for the agent to judge whether it still applies.
 */
export type SessionLogWorkspaceScope = 'hq' | 'campaign' | 'lab' | 'general';

export interface SessionLogEntry {
  /** Maps back to the stored session, so the UI can link through. */
  sessionId: string;
  /** ISO date (YYYY-MM-DD) the session was logged. */
  date: string;
  /** One to three sentences on what happened. */
  summary: string;
  /** Wall-clock minutes, when known. */
  durationMinutes?: number;
  /** User/assistant exchanges, when known. */
  turnCount?: number;
  /** Short free-form tag: shipped, blocked, decided, abandoned… */
  outcome?: string;
  /** Lowercase tags, same style as agent capability tags. */
  topics?: string[];
  /** One sentence on what to do next, drawn from how the session ended. */
  nextAction?: string;
  /** Workspace the session ran in. */
  workspaceId?: string;
  workspaceScope?: SessionLogWorkspaceScope;
  /** Human-readable workspace name, for the rendered provenance hint. */
  workspaceLabel?: string;
}

export interface SessionsLogEnvelope {
  version: number;
  agent: string;
}

export interface LoadedSessionsLog {
  agentSlug: string;
  envelope: SessionsLogEnvelope;
  /** Newest first. */
  entries: SessionLogEntry[];
  filePath: string;
  parseWarnings: SessionsLogParseWarning[];
}

export type SessionsLogParseWarningCode =
  | 'invalid-envelope'
  | 'invalid-entry-frontmatter'
  | 'missing-session-id'
  | 'missing-date'
  | 'invalid-date'
  | 'missing-summary';

export interface SessionsLogParseWarning {
  code: SessionsLogParseWarningCode;
  message: string;
  sessionId?: string;
}

export interface SessionsLogStorageOptions {
  /** Override the global agents root. Tests only. */
  globalAgentsDir?: string;
}
