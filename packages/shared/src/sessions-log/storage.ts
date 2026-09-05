/**
 * Sessions-log storage.
 *
 * Read/write over per-agent `SESSIONS.md`. Markdown is canonical and the file
 * is meant to survive hand-editing, so parsing reports warnings rather than
 * silently treating a malformed entry as absent.
 *
 * Deliberately mirrors `../memory/storage.ts`: same envelope-plus-entries
 * idiom, same atomic write, same agents root. Two stores that look alike are
 * two stores a reader only has to learn once.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import matter from 'gray-matter';
import { AGENT_SLUG_REGEX } from '../agent-definitions/types.ts';
import { RUNTIME_IDENTITY } from '../config/runtime-identity.ts';
import {
  SESSIONS_ARCHIVE_DIR,
  SESSIONS_LOG_FILE,
  SESSIONS_LOG_MAX_ENTRIES,
  SESSIONS_LOG_SCHEMA_VERSION,
  type LoadedSessionsLog,
  type SessionLogEntry,
  type SessionLogWorkspaceScope,
  type SessionsLogEnvelope,
  type SessionsLogParseWarning,
  type SessionsLogParseWarningCode,
  type SessionsLogStorageOptions,
} from './types.ts';

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const WORKSPACE_SCOPES: readonly SessionLogWorkspaceScope[] = ['hq', 'campaign', 'lab', 'general'];

// ============================================================================
// Paths
// ============================================================================

function getGlobalAgentsRoot(options?: SessionsLogStorageOptions): string {
  return options?.globalAgentsDir ?? RUNTIME_IDENTITY.agentsRoot;
}

export function getSessionsLogFile(agentSlug: string, options?: SessionsLogStorageOptions): string {
  assertValidAgentSlug(agentSlug);
  return join(getGlobalAgentsRoot(options), 'agents', agentSlug, SESSIONS_LOG_FILE);
}

export function getSessionsArchiveFile(
  agentSlug: string,
  year: string,
  options?: SessionsLogStorageOptions,
): string {
  assertValidAgentSlug(agentSlug);
  if (!/^\d{4}$/.test(year)) throw new Error(`Invalid archive year: ${year}`);
  return join(getGlobalAgentsRoot(options), 'agents', agentSlug, SESSIONS_ARCHIVE_DIR, `${year}.md`);
}

function assertValidAgentSlug(slug: string | undefined): asserts slug is string {
  if (!slug || !AGENT_SLUG_REGEX.test(slug)) {
    throw new Error(`Invalid agent slug: "${slug ?? ''}" (lowercase letters, digits, hyphens; 1-64 chars)`);
  }
}

export function isValidSessionLogDate(value: string): boolean {
  if (!ISO_DATE_REGEX.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

// ============================================================================
// Serialize
// ============================================================================

function quoteYamlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/** Collapses newlines: every scalar here is a single-line YAML value. */
function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function serializeSessionsLog(
  envelope: SessionsLogEnvelope,
  entries: readonly SessionLogEntry[],
): string {
  const body = entries
    .map((entry) => {
      const lines = [
        '---',
        `sessionId: ${quoteYamlString(entry.sessionId)}`,
        `date: ${quoteYamlString(entry.date)}`,
      ];
      if (entry.durationMinutes != null) lines.push(`durationMinutes: ${entry.durationMinutes}`);
      if (entry.turnCount != null) lines.push(`turnCount: ${entry.turnCount}`);
      if (entry.outcome) lines.push(`outcome: ${quoteYamlString(oneLine(entry.outcome))}`);
      if (entry.topics?.length) {
        lines.push(`topics: [${entry.topics.map((t) => quoteYamlString(oneLine(t))).join(', ')}]`);
      }
      if (entry.nextAction) lines.push(`nextAction: ${quoteYamlString(oneLine(entry.nextAction))}`);
      if (entry.workspaceId) lines.push(`workspaceId: ${quoteYamlString(entry.workspaceId)}`);
      if (entry.workspaceScope) lines.push(`workspaceScope: ${entry.workspaceScope}`);
      if (entry.workspaceLabel) lines.push(`workspaceLabel: ${quoteYamlString(oneLine(entry.workspaceLabel))}`);
      lines.push('---', '', entry.summary.trim());
      return lines.join('\n').trimEnd();
    })
    .join('\n\n');

  const envelopeText = ['---', `agent: ${envelope.agent}`, `version: ${envelope.version}`, '---'].join('\n');
  return body ? `${envelopeText}\n\n${body}\n` : `${envelopeText}\n`;
}

// ============================================================================
// Parse
// ============================================================================

function warn(
  code: SessionsLogParseWarningCode,
  message: string,
  sessionId?: string,
): SessionsLogParseWarning {
  return { code, message, sessionId };
}

function coerceStringArray(value: unknown): string[] | undefined {
  const raw = typeof value === 'string' ? [value] : value;
  if (!Array.isArray(raw)) return undefined;
  const out = raw.map((v) => (typeof v === 'string' ? oneLine(v) : '')).filter(Boolean);
  return out.length > 0 ? out : undefined;
}

function coerceCount(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
}

/**
 * `gray-matter` parses one leading frontmatter block, so entries are split by
 * hand — exactly as `memory/storage.ts` does — then each is parsed as a
 * standalone document.
 */
export function parseSessionsLog(
  content: string,
  expectedAgentSlug: string,
): { envelope: SessionsLogEnvelope; entries: SessionLogEntry[]; warnings: SessionsLogParseWarning[] } {
  const warnings: SessionsLogParseWarning[] = [];
  const fallback: SessionsLogEnvelope = { version: SESSIONS_LOG_SCHEMA_VERSION, agent: expectedAgentSlug };

  let head: matter.GrayMatterFile<string>;
  try {
    head = matter(content);
  } catch {
    return { envelope: fallback, entries: [], warnings: [warn('invalid-envelope', 'Envelope frontmatter is malformed.')] };
  }

  const data = head.data as Record<string, unknown>;
  if (data.version !== SESSIONS_LOG_SCHEMA_VERSION || typeof data.agent !== 'string' || data.agent.trim() !== expectedAgentSlug) {
    warnings.push(warn('invalid-envelope', `Envelope must declare version ${SESSIONS_LOG_SCHEMA_VERSION} and agent "${expectedAgentSlug}".`));
  }

  const entries: SessionLogEntry[] = [];
  const { blocks, unclosed } = splitEntryBlocks(head.content);
  if (unclosed) {
    warnings.push(warn('invalid-entry-frontmatter', 'Session entry is missing a closing frontmatter delimiter.'));
  }

  for (const block of blocks) {
    let parsed: matter.GrayMatterFile<string>;
    try {
      parsed = matter(`---\n${block.frontmatter.trim()}\n---\n${block.body.trim()}`);
    } catch {
      warnings.push(warn('invalid-entry-frontmatter', 'Session entry frontmatter is malformed.'));
      continue;
    }

    const entryData = parsed.data as Record<string, unknown>;
    const sessionId = typeof entryData.sessionId === 'string' ? entryData.sessionId.trim() : '';
    if (!sessionId) {
      warnings.push(warn('missing-session-id', 'Session entry is missing sessionId.'));
      continue;
    }

    const date = coerceYamlDate(entryData.date);
    if (!date) {
      warnings.push(warn('missing-date', 'Session entry is missing a date.', sessionId));
      continue;
    }
    if (!isValidSessionLogDate(date)) {
      warnings.push(warn('invalid-date', 'Session entry date must be YYYY-MM-DD.', sessionId));
      continue;
    }

    const summary = parsed.content.trim();
    if (!summary) {
      warnings.push(warn('missing-summary', 'Session entry has no summary body.', sessionId));
      continue;
    }

    const scope = typeof entryData.workspaceScope === 'string' ? entryData.workspaceScope.trim() : '';
    entries.push({
      sessionId,
      date,
      summary,
      durationMinutes: coerceCount(entryData.durationMinutes),
      turnCount: coerceCount(entryData.turnCount),
      outcome: typeof entryData.outcome === 'string' ? oneLine(entryData.outcome) || undefined : undefined,
      topics: coerceStringArray(entryData.topics),
      nextAction: typeof entryData.nextAction === 'string' ? oneLine(entryData.nextAction) || undefined : undefined,
      workspaceId: typeof entryData.workspaceId === 'string' ? entryData.workspaceId.trim() || undefined : undefined,
      workspaceScope: (WORKSPACE_SCOPES as readonly string[]).includes(scope)
        ? (scope as SessionLogWorkspaceScope)
        : undefined,
      workspaceLabel: typeof entryData.workspaceLabel === 'string' ? oneLine(entryData.workspaceLabel) || undefined : undefined,
    });
  }

  return { envelope: fallback, entries, warnings };
}

/**
 * Pair up `---` delimiter lines into entry blocks.
 *
 * Splitting on a regex does not work here: the line that closes one entry's
 * frontmatter looks exactly like the line that opens the next, so a naive split
 * cuts every entry in half. Delimiters are paired instead — open, close, then
 * body running to the next open — which is how `memory/storage.ts` reads the
 * same idiom.
 */
function splitEntryBlocks(content: string): {
  blocks: Array<{ frontmatter: string; body: string }>;
  unclosed: boolean;
} {
  const lines = content.split(/\r?\n/);
  const delimiters: number[] = [];
  lines.forEach((line, index) => {
    if (line.trim() === '---') delimiters.push(index);
  });

  const blocks: Array<{ frontmatter: string; body: string }> = [];
  let index = 0;
  for (; index + 1 < delimiters.length; index += 2) {
    const open = delimiters[index]!;
    const close = delimiters[index + 1]!;
    const nextOpen = delimiters[index + 2] ?? lines.length;
    blocks.push({
      frontmatter: lines.slice(open + 1, close).join('\n'),
      body: lines.slice(close + 1, nextOpen).join('\n'),
    });
  }

  return { blocks, unclosed: index < delimiters.length };
}

/** `gray-matter` turns unquoted YAML dates into `Date`; normalize both shapes. */
function coerceYamlDate(value: unknown): string | undefined {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string') return value.trim() || undefined;
  return undefined;
}

// ============================================================================
// Load / write
// ============================================================================

export function loadSessionsLog(
  agentSlug: string,
  options?: SessionsLogStorageOptions,
): LoadedSessionsLog {
  const filePath = getSessionsLogFile(agentSlug, options);
  if (!existsSync(filePath)) {
    return {
      agentSlug,
      envelope: { version: SESSIONS_LOG_SCHEMA_VERSION, agent: agentSlug },
      entries: [],
      filePath,
      parseWarnings: [],
    };
  }
  const parsed = parseSessionsLog(readFileSync(filePath, 'utf-8'), agentSlug);
  return {
    agentSlug,
    envelope: parsed.envelope,
    entries: parsed.entries,
    filePath,
    parseWarnings: parsed.warnings,
  };
}

/** Newest first, so "the last three sessions" is a slice off the front. */
export function listSessionLogEntries(
  agentSlug: string,
  options?: SessionsLogStorageOptions,
): SessionLogEntry[] {
  return loadSessionsLog(agentSlug, options).entries;
}

function writeFileAtomic(file: string, contents: string): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tmp, contents, 'utf-8');
    renameSync(tmp, file);
  } catch (error) {
    try { rmSync(tmp, { force: true }); } catch { /* ignore */ }
    throw error;
  }
}

/**
 * Move the oldest entries into per-year archive files.
 *
 * Lazy, on write, per spec — no cron. Archived entries are appended to their
 * year's file rather than replacing it, so a year that rolls off in two batches
 * keeps both.
 */
function archiveOverflow(
  agentSlug: string,
  entries: SessionLogEntry[],
  options?: SessionsLogStorageOptions,
): SessionLogEntry[] {
  if (entries.length <= SESSIONS_LOG_MAX_ENTRIES) return entries;

  const kept = entries.slice(0, SESSIONS_LOG_MAX_ENTRIES);
  const overflow = entries.slice(SESSIONS_LOG_MAX_ENTRIES);

  const byYear = new Map<string, SessionLogEntry[]>();
  for (const entry of overflow) {
    const year = entry.date.slice(0, 4);
    const bucket = byYear.get(year);
    if (bucket) bucket.push(entry);
    else byYear.set(year, [entry]);
  }

  for (const [year, yearEntries] of byYear) {
    const file = getSessionsArchiveFile(agentSlug, year, options);
    const existing = existsSync(file)
      ? parseSessionsLog(readFileSync(file, 'utf-8'), agentSlug).entries
      : [];
    const merged = sortNewestFirst([...existing, ...yearEntries]);
    writeFileAtomic(file, serializeSessionsLog({ version: SESSIONS_LOG_SCHEMA_VERSION, agent: agentSlug }, merged));
  }

  return kept;
}

function sortNewestFirst(entries: SessionLogEntry[]): SessionLogEntry[] {
  return [...entries].sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1));
}

/**
 * Record one session. Re-recording the same `sessionId` replaces the previous
 * entry rather than adding a second — a session that is summarized twice is
 * still one session.
 */
export function appendSessionLogEntry(
  agentSlug: string,
  entry: SessionLogEntry,
  options?: SessionsLogStorageOptions,
): LoadedSessionsLog {
  assertValidAgentSlug(agentSlug);
  if (!entry.sessionId.trim()) throw new Error('Session log entry requires a sessionId');
  if (!isValidSessionLogDate(entry.date)) throw new Error('Session log entry date must be YYYY-MM-DD');
  if (!entry.summary.trim()) throw new Error('Session log entry requires a summary');

  const current = loadSessionsLog(agentSlug, options);
  const withoutDuplicate = current.entries.filter((e) => e.sessionId !== entry.sessionId);
  const next = archiveOverflow(agentSlug, sortNewestFirst([entry, ...withoutDuplicate]), options);

  writeFileAtomic(
    current.filePath,
    serializeSessionsLog({ version: SESSIONS_LOG_SCHEMA_VERSION, agent: agentSlug }, next),
  );

  return { ...current, entries: next, parseWarnings: current.parseWarnings };
}

/** Archived years present on disk, newest first. */
export function listSessionsArchiveYears(
  agentSlug: string,
  options?: SessionsLogStorageOptions,
): string[] {
  assertValidAgentSlug(agentSlug);
  const dir = join(getGlobalAgentsRoot(options), 'agents', agentSlug, SESSIONS_ARCHIVE_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => /^\d{4}\.md$/.test(name))
    .map((name) => name.slice(0, 4))
    .sort((a, b) => b.localeCompare(a));
}
