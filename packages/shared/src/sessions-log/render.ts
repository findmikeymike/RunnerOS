/**
 * Rendering and search over `SESSIONS.md`.
 *
 * Kept separate from storage so the prompt shape and the search rule can be
 * tested without touching disk.
 */

import type { SessionLogEntry } from './types.ts';

export const RECENT_SESSIONS_HEADER = 'Recent sessions — what this agent worked on lately:';

/**
 * Sessions summarized into the system prompt.
 *
 * Three is enough to answer "where did we leave off" and small enough that it
 * never competes with the work at hand. Everything older stays searchable
 * through `recall_session` rather than being injected.
 */
export const DEFAULT_RECENT_SESSIONS = 3;

/** Characters allowed per rendered summary line before it is elided. */
export const RECENT_SESSION_SUMMARY_MAX_CHARS = 240;

function elide(value: string, max: number): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

function formatDuration(minutes: number | undefined): string | undefined {
  if (minutes == null || minutes <= 0) return undefined;
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/**
 * One line per session: when, where, how long, and what happened.
 *
 * The workspace label is included because sessions are logged per agent, so an
 * entry from one campaign would otherwise read as if it were current
 * career-wide work.
 */
export function formatSessionLogLine(entry: SessionLogEntry): string {
  const facts = [
    formatDuration(entry.durationMinutes),
    entry.turnCount != null ? `${entry.turnCount} turns` : undefined,
    entry.workspaceLabel,
    entry.outcome,
  ].filter(Boolean);
  const suffix = facts.length > 0 ? ` (${facts.join(', ')})` : '';
  return `- ${entry.date}${suffix}: ${elide(entry.summary, RECENT_SESSION_SUMMARY_MAX_CHARS)}`;
}

/**
 * Build the prompt section. Returns '' when there is nothing to say, so the
 * caller can drop the section entirely rather than injecting an empty heading.
 */
export function buildRecentSessionsSection(
  entries: readonly SessionLogEntry[],
  limit = DEFAULT_RECENT_SESSIONS,
): string {
  const shown = entries.slice(0, Math.max(0, limit));
  if (shown.length === 0) return '';

  const lines = shown.map(formatSessionLogLine);
  const older = entries.length - shown.length;
  // Same contract as the memory section: say what is missing and how to get it,
  // so an agent never mistakes a bounded view for the whole history.
  const note = older > 0
    ? `\n\n[${older} older ${older === 1 ? 'session is' : 'sessions are'} not shown. Search them with recall_session.]`
    : '';

  const nextAction = shown[0]?.nextAction;
  const carry = nextAction ? `\n\nIntended next step from the most recent session: ${elide(nextAction, 240)}` : '';

  return `${RECENT_SESSIONS_HEADER}\n${lines.join('\n')}${carry}${note}`;
}

export interface SessionLogSearchResult {
  entry: SessionLogEntry;
  score: number;
}

/**
 * Substring search over summary, topics, outcome, and next action.
 *
 * Deliberately lexical, matching `memory/recall.ts` — semantic search is a
 * Tier-2 decision for both stores together, not one this store makes alone.
 * An empty query returns the most recent entries, which is what "what have we
 * been doing" should give you.
 */
export function searchSessionLogEntries(
  entries: readonly SessionLogEntry[],
  query: string,
  limit = 10,
): SessionLogSearchResult[] {
  const cappedLimit = Math.max(1, Math.floor(limit));
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return entries.slice(0, cappedLimit).map((entry) => ({ entry, score: 0 }));
  }

  const tokens = normalized.split(/[^a-z0-9]+/g).filter((t) => t.length >= 2);
  if (tokens.length === 0) return [];

  const scored: SessionLogSearchResult[] = [];
  for (const entry of entries) {
    const topics = (entry.topics ?? []).join(' ').toLowerCase();
    const summary = entry.summary.toLowerCase();
    const haystack = `${summary} ${topics} ${(entry.outcome ?? '').toLowerCase()} ${(entry.nextAction ?? '').toLowerCase()}`;

    let score = 0;
    for (const token of tokens) {
      if (topics.includes(token)) score += 3;
      if (summary.includes(token)) score += 2;
      else if (haystack.includes(token)) score += 1;
    }
    if (normalized.length > 2 && haystack.includes(normalized)) score += 5;
    if (score > 0) scored.push({ entry, score });
  }

  // Ties break toward the more recent session — entries are already newest
  // first, so a stable sort preserves that.
  return scored.sort((a, b) => b.score - a.score).slice(0, cappedLimit);
}
