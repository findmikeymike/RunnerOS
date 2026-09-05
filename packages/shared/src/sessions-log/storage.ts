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
      assertSummaryIsPlainProse(entry.summary);
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
  const split = splitEntryBlocks(head.content);
  warnings.push(...split.warnings);

  for (const block of split.blocks) {
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
 * Line numbers of `---` delimiters, ignoring any inside a fenced code block.
 *
 * A summary is prose written by a model, and prose contains horizontal rules
 * and code fences. Treating every bare `---` as structure made the serializer
 * write files its own parser truncated on re-read — and, with the write guard,
 * wedged the log for good. Mirrors `collectEntryDelimiterLines` in
 * `memory/storage.ts`.
 */
function collectDelimiterLines(lines: readonly string[]): number[] {
  const delimiters: number[] = [];
  let fence: string | null = null;
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    const fenceMatch = trimmed.match(/^(```+|~~~+)/);
    if (fence) {
      if (trimmed.startsWith(fence)) fence = null;
    } else if (fenceMatch) {
      fence = fenceMatch[1]!.startsWith('`') ? '```' : '~~~';
    } else if (trimmed === '---') {
      delimiters.push(index);
    }
  });
  return delimiters;
}

/**
 * What a `---` … `---` block is.
 *
 * - `entry`: carries a `sessionId`, so it opens a real entry.
 * - `broken`: parses as YAML that names session fields but has no `sessionId`
 *   — almost certainly an entry someone damaged by hand. It must NOT be
 *   silently absorbed into the previous entry's body and written back that
 *   way; it is reported so the write guard refuses.
 * - `prose`: anything else, e.g. a horizontal rule in a summary. Body text.
 */
function classifyBlock(rawFrontmatter: string): 'entry' | 'broken' | 'prose' {
  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(`---\n${rawFrontmatter.trim()}\n---\n`);
  } catch {
    return 'prose';
  }
  const data = parsed.data as Record<string, unknown>;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return 'prose';
  if (data.sessionId !== undefined && data.sessionId !== null) return 'entry';
  const sessionKeys = ['date', 'summary', 'outcome', 'topics', 'nextAction', 'turnCount', 'durationMinutes', 'workspaceId'];
  return sessionKeys.some((key) => key in data) ? 'broken' : 'prose';
}

interface EntryBlock {
  frontmatter: string;
  body: string;
}

/**
 * Pair delimiters into entry blocks.
 *
 * A `---` opens an entry only when the text up to the next delimiter reads as
 * session frontmatter; otherwise it is part of a body. Splitting on a regex
 * cannot work here: the line closing one entry's frontmatter is identical to
 * the line opening the next, and a rule inside a summary is identical to both.
 */
function splitEntryBlocks(content: string): {
  blocks: EntryBlock[];
  warnings: SessionsLogParseWarning[];
} {
  const lines = content.split(/\r?\n/);
  const delimiters = collectDelimiterLines(lines);
  const blocks: EntryBlock[] = [];
  const warnings: SessionsLogParseWarning[] = [];

  const kindAt = (i: number): 'entry' | 'broken' | 'prose' =>
    i + 1 < delimiters.length
      ? classifyBlock(lines.slice(delimiters[i]! + 1, delimiters[i + 1]!).join('\n'))
      : 'prose';

  const nextOpen = (from: number): number => {
    for (let i = from; i + 1 < delimiters.length; i += 1) {
      const kind = kindAt(i);
      if (kind === 'entry') return i;
      if (kind === 'broken') {
        warnings.push(warn('missing-session-id', 'Session entry is missing sessionId.'));
        // Skip the whole damaged block so its body is not glued onto a neighbour.
        i += 1;
      }
    }
    return -1;
  };

  let open = nextOpen(0);
  const firstStart = open === -1 ? lines.length : delimiters[open]!;
  if (lines.slice(0, firstStart).join('\n').trim()) {
    warnings.push(warn('invalid-entry-frontmatter', 'Text before the first session entry would be lost on the next write.'));
  }

  while (open !== -1) {
    const close = open + 1;
    const following = nextOpen(close + 1);
    const bodyEnd = following === -1 ? lines.length : delimiters[following]!;
    blocks.push({
      frontmatter: lines.slice(delimiters[open]! + 1, delimiters[close]!).join('\n'),
      body: lines.slice(delimiters[close]! + 1, bodyEnd).join('\n'),
    });
    open = following;
  }

  return { blocks, warnings };
}

/**
 * A summary that the parser would read as structure cannot be stored as
 * written. Refusing here, at the single write path, is what makes the parser's
 * "a `---` in prose is just prose" rule safe: nothing can be serialized that
 * later reads back as a phantom entry or truncates its neighbour.
 */
function assertSummaryIsPlainProse(summary: string): void {
  const probe = splitEntryBlocks(summary);
  if (probe.blocks.length > 0 || probe.warnings.some((w) => w.code === 'missing-session-id')) {
    throw new Error('Session summary contains text that would be read as a session entry; it cannot be stored as written.');
  }
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
    let existing: SessionLogEntry[] = [];
    if (existsSync(file)) {
      const parsed = parseSessionsLog(readFileSync(file, 'utf-8'), agentSlug);
      // The archive is the "nothing is deleted" tier. Writing it back after a
      // partial parse would delete exactly what the live-file guard protects.
      if (parsed.warnings.length > 0) {
        throw new Error(
          `Refusing to write ${file}: ${parsed.warnings.length} part${parsed.warnings.length === 1 ? '' : 's'} of the archive could not be read and would be lost. Fix the file by hand first.`,
        );
      }
      existing = parsed.entries;
    }
    // The archive is written before the live file is trimmed, so a failure
    // between the two leaves an entry in both places rather than neither. That
    // makes the retry path re-archive the same tail; dedupe by sessionId so it
    // converges instead of duplicating.
    const merged = new Map<string, SessionLogEntry>();
    for (const entry of existing) merged.set(entry.sessionId, entry);
    for (const entry of yearEntries) merged.set(entry.sessionId, entry);
    writeFileAtomic(
      file,
      serializeSessionsLog({ version: SESSIONS_LOG_SCHEMA_VERSION, agent: agentSlug }, sortNewestFirst([...merged.values()])),
    );
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
  // `entries` holds only what parsed. Writing it back over a file that also
  // held a malformed entry would delete that entry silently. Refuse instead,
  // naming what needs fixing — the file is meant to be hand-editable, and a
  // refused write is recoverable where a vanished entry is not.
  if (current.parseWarnings.length > 0) {
    const details = current.parseWarnings
      .slice(0, 5)
      .map((w) => (w.sessionId ? `${w.sessionId}: ${w.message}` : w.message))
      .join('; ');
    throw new Error(
      `Refusing to write ${current.filePath}: ${current.parseWarnings.length} part${current.parseWarnings.length === 1 ? '' : 's'} of the file could not be read `
      + `and would be lost. Fix the file by hand first. ${details}`,
    );
  }
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
