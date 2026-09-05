/**
 * Deriving a `SESSIONS.md` entry from a live session.
 *
 * [`05-sessions-log.md`](../../../../docs/memory/05-sessions-log.md) assumed the
 * summary would come from the compaction summary, "captured too". It cannot:
 * `compact_boundary` emits an info event with no summary text. Paying for a
 * second model call per session to replace it would be a real cost on every
 * conversation, for a log most turns never change meaningfully.
 *
 * The app already generates a session title with a model call it makes anyway.
 * That title is a one-line description of the conversation — exactly what a log
 * line needs — so the entry is assembled from the title plus facts already on
 * the session. Zero additional model cost.
 *
 * Pure and side-effect free: the caller owns persistence, so this is testable
 * without a session, a workspace, or a disk.
 */

import type { SessionLogEntry, SessionLogWorkspaceScope } from './types.ts';

/** Minimal shape needed from a message; keeps this module free of session types. */
export interface SessionLogSourceMessage {
  role: string;
  content: string;
  timestamp?: number;
  /** Commentary between tool calls, not a real exchange. */
  isIntermediate?: boolean;
}

export interface SessionLogSource {
  sessionId: string;
  /** Model-generated session title, when one exists yet. */
  title?: string;
  messages: ReadonlyArray<SessionLogSourceMessage>;
  workspaceId?: string;
  workspaceLabel?: string;
  workspaceScope?: SessionLogWorkspaceScope;
  /** Override for tests. */
  now?: Date;
}

const SUMMARY_MAX_CHARS = 400;

/**
 * Collapse to a single line.
 *
 * This is a correctness guarantee, not cosmetics. The log's parser reads a line
 * of `---` as structure, and its serializer refuses any summary that would read
 * back as an entry. A single-line summary cannot contain such a line, so an
 * entry built here can never be rejected at write time or corrupt the file.
 */
function toSingleLine(value: string): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length <= SUMMARY_MAX_CHARS ? flat : `${flat.slice(0, SUMMARY_MAX_CHARS - 1).trimEnd()}…`;
}

function isRealExchange(message: SessionLogSourceMessage): boolean {
  return (message.role === 'user' || message.role === 'assistant')
    && message.isIntermediate !== true
    && message.content.trim().length > 0;
}

function dateKey(timestamp: number | undefined, fallback: Date): string {
  const date = timestamp ? new Date(timestamp) : fallback;
  return Number.isNaN(date.getTime()) ? fallback.toISOString().slice(0, 10) : date.toISOString().slice(0, 10);
}

/**
 * Build the entry for a session, or null when there is nothing worth logging.
 *
 * Returns null rather than an empty entry for a session with no real exchange —
 * an opened-and-abandoned window should not appear in the artist's history.
 */
export function buildSessionLogEntry(source: SessionLogSource): SessionLogEntry | null {
  const now = source.now ?? new Date();
  const exchanges = source.messages.filter(isRealExchange);
  const firstUser = exchanges.find((message) => message.role === 'user');
  if (!firstUser) return null;

  // A title is the model's own one-line description of the conversation. Before
  // one exists, the opening ask is the most honest stand-in.
  const summary = toSingleLine(source.title?.trim() || firstUser.content);
  if (!summary) return null;

  const timestamps = exchanges
    .map((message) => message.timestamp)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const first = timestamps.length > 0 ? Math.min(...timestamps) : undefined;
  const last = timestamps.length > 0 ? Math.max(...timestamps) : undefined;
  const durationMinutes = first != null && last != null ? Math.round((last - first) / 60_000) : undefined;

  return {
    sessionId: source.sessionId,
    date: dateKey(last, now),
    summary,
    // One exchange is one assistant reply; counting both sides would double it.
    turnCount: exchanges.filter((message) => message.role === 'assistant').length,
    ...(durationMinutes != null && durationMinutes > 0 ? { durationMinutes } : {}),
    ...(source.workspaceId ? { workspaceId: source.workspaceId } : {}),
    ...(source.workspaceScope ? { workspaceScope: source.workspaceScope } : {}),
    ...(source.workspaceLabel ? { workspaceLabel: toSingleLine(source.workspaceLabel) } : {}),
  };
}
