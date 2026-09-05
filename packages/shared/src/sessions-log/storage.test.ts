import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  appendSessionLogEntry,
  getSessionsArchiveFile,
  getSessionsLogFile,
  listSessionLogEntries,
  listSessionsArchiveYears,
  loadSessionsLog,
  parseSessionsLog,
  serializeSessionsLog,
} from './storage.ts';
import { SESSIONS_LOG_MAX_ENTRIES, SESSIONS_LOG_SCHEMA_VERSION, type SessionLogEntry } from './types.ts';

let root: string;
let options: { globalAgentsDir: string };

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'craft-sessions-log-'));
  options = { globalAgentsDir: root };
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function entry(overrides: Partial<SessionLogEntry> & Pick<SessionLogEntry, 'sessionId' | 'date'>): SessionLogEntry {
  return {
    summary: `Worked on ${overrides.sessionId}.`,
    ...overrides,
  };
}

describe('sessions log storage', () => {
  test('an absent log reads as empty rather than throwing', () => {
    const loaded = loadSessionsLog('concierge', options);
    expect(loaded.entries).toEqual([]);
    expect(loaded.parseWarnings).toEqual([]);
    expect(loaded.filePath).toBe(getSessionsLogFile('concierge', options));
  });

  test('round-trips every field through serialize and parse', () => {
    const original: SessionLogEntry = {
      sessionId: 'abc123',
      date: '2026-09-05',
      summary: 'Settled the release date and drafted the announce post.',
      durationMinutes: 107,
      turnCount: 18,
      outcome: 'decided',
      topics: ['release', 'announce'],
      nextAction: 'Send the announce draft for approval.',
      workspaceId: 'ws-1',
      workspaceScope: 'campaign',
      workspaceLabel: 'Neon Nights',
    };

    const text = serializeSessionsLog({ version: SESSIONS_LOG_SCHEMA_VERSION, agent: 'concierge' }, [original]);
    const parsed = parseSessionsLog(text, 'concierge');

    expect(parsed.warnings).toEqual([]);
    expect(parsed.entries).toEqual([original]);
  });

  test('survives an apostrophe in prose, which naive YAML quoting breaks', () => {
    const original = entry({
      sessionId: 'quote-1',
      date: '2026-09-05',
      summary: "Reworked the artist's bio.",
      nextAction: "Ask about the label's timeline.",
      workspaceLabel: "Mikey's HQ",
    });

    const text = serializeSessionsLog({ version: SESSIONS_LOG_SCHEMA_VERSION, agent: 'concierge' }, [original]);
    const parsed = parseSessionsLog(text, 'concierge');

    expect(parsed.warnings).toEqual([]);
    expect(parsed.entries[0]).toEqual(original);
  });

  test('appends newest first and persists to disk', () => {
    appendSessionLogEntry('concierge', entry({ sessionId: 's1', date: '2026-09-01' }), options);
    appendSessionLogEntry('concierge', entry({ sessionId: 's2', date: '2026-09-03' }), options);

    expect(listSessionLogEntries('concierge', options).map((e) => e.sessionId)).toEqual(['s2', 's1']);
    expect(existsSync(getSessionsLogFile('concierge', options))).toBe(true);
  });

  test('re-recording a session replaces its entry instead of duplicating it', () => {
    appendSessionLogEntry('concierge', entry({ sessionId: 's1', date: '2026-09-01', summary: 'First pass.' }), options);
    appendSessionLogEntry('concierge', entry({ sessionId: 's1', date: '2026-09-01', summary: 'Revised.' }), options);

    const entries = listSessionLogEntries('concierge', options);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.summary).toBe('Revised.');
  });

  test('rejects an entry that could not be found again or read', () => {
    expect(() => appendSessionLogEntry('concierge', entry({ sessionId: ' ', date: '2026-09-01' }), options)).toThrow('sessionId');
    expect(() => appendSessionLogEntry('concierge', entry({ sessionId: 's', date: '05-09-2026' }), options)).toThrow('YYYY-MM-DD');
    expect(() => appendSessionLogEntry('concierge', { sessionId: 's', date: '2026-09-01', summary: '  ' }, options)).toThrow('summary');
  });

  test('reports a malformed entry without discarding the good ones around it', () => {
    const file = getSessionsLogFile('concierge', options);
    mkdirSync(join(root, 'agents', 'concierge'), { recursive: true });
    writeFileSync(file, [
      '---', 'agent: concierge', 'version: 1', '---', '',
      '---', "sessionId: 'good'", "date: '2026-09-02'", '---', '', 'Real work.', '',
      '---', "date: '2026-09-01'", '---', '', 'Entry with no session id.', '',
    ].join('\n'), 'utf-8');

    const loaded = loadSessionsLog('concierge', options);
    expect(loaded.entries.map((e) => e.sessionId)).toEqual(['good']);
    expect(loaded.parseWarnings.map((w) => w.code)).toContain('missing-session-id');
  });

  test('refuses to write over a file it could not fully read, so a hand-edit never causes silent loss', () => {
    const file = getSessionsLogFile('concierge', options);
    mkdirSync(join(root, 'agents', 'concierge'), { recursive: true });
    const original = [
      '---', 'agent: concierge', 'version: 1', '---', '',
      '---', "sessionId: 'good'", "date: '2026-09-02'", '---', '', 'Real work.', '',
      '---', "date: '2026-09-01'", '---', '', 'Entry with no session id — a typo the artist made by hand.', '',
    ].join('\n');
    writeFileSync(file, original, 'utf-8');

    expect(() => appendSessionLogEntry('concierge', entry({ sessionId: 'new', date: '2026-09-03' }), options))
      .toThrow(/could not be read/);

    // The malformed entry is still on disk, untouched, for the artist to fix.
    expect(readFileSync(file, 'utf-8')).toBe(original);
  });

  test('flags an envelope naming a different agent', () => {
    const text = serializeSessionsLog({ version: SESSIONS_LOG_SCHEMA_VERSION, agent: 'someone-else' }, []);
    expect(parseSessionsLog(text, 'concierge').warnings.map((w) => w.code)).toContain('invalid-envelope');
  });
});

describe('sessions log archival', () => {
  test('rolls the oldest entries into a per-year archive once past the cap', () => {
    for (let i = 0; i < SESSIONS_LOG_MAX_ENTRIES; i += 1) {
      const day = String((i % 28) + 1).padStart(2, '0');
      appendSessionLogEntry('concierge', entry({ sessionId: `s${i}`, date: `2026-01-${day}` }), options);
    }
    expect(listSessionLogEntries('concierge', options)).toHaveLength(SESSIONS_LOG_MAX_ENTRIES);
    expect(listSessionsArchiveYears('concierge', options)).toEqual([]);

    // One more crosses the cap and pushes the oldest out of the live file.
    appendSessionLogEntry('concierge', entry({ sessionId: 'newest', date: '2026-12-31' }), options);

    const live = listSessionLogEntries('concierge', options);
    expect(live).toHaveLength(SESSIONS_LOG_MAX_ENTRIES);
    expect(live[0]!.sessionId).toBe('newest');
    expect(listSessionsArchiveYears('concierge', options)).toEqual(['2026']);

    // Nothing is lost — the rolled-off entry is readable in the archive.
    const archived = parseSessionsLog(
      readFileSync(getSessionsArchiveFile('concierge', '2026', options), 'utf-8'),
      'concierge',
    );
    expect(archived.entries).toHaveLength(1);
    expect(live.some((e) => e.sessionId === archived.entries[0]!.sessionId)).toBe(false);
  });
});
