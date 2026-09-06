import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_RECENT_SESSIONS,
  buildRecentSessionsSection,
  formatSessionLogLine,
  searchSessionLogEntries,
} from './render.ts';
import type { SessionLogEntry } from './types.ts';

function entry(overrides: Partial<SessionLogEntry> & Pick<SessionLogEntry, 'sessionId' | 'date'>): SessionLogEntry {
  return { summary: `Worked on ${overrides.sessionId}.`, ...overrides };
}

/** Newest first, as the store returns them. */
const recent: SessionLogEntry[] = [
  entry({
    sessionId: 's3',
    date: '2026-09-05',
    summary: 'Settled the release date and drafted the announce post.',
    durationMinutes: 107,
    turnCount: 18,
    outcome: 'decided',
    topics: ['release', 'announce'],
    nextAction: 'Send the announce draft for approval.',
    workspaceLabel: 'Neon Nights',
  }),
  entry({ sessionId: 's2', date: '2026-09-03', summary: 'Reviewed playlist pitches.', durationMinutes: 45 }),
  entry({ sessionId: 's1', date: '2026-09-01', summary: 'Imported the fan list.' }),
];

describe('recent sessions prompt section', () => {
  test('is empty when there is no history, so the section can be dropped entirely', () => {
    expect(buildRecentSessionsSection([])).toBe('');
  });

  test('renders one line per session with when, where, and how long', () => {
    const section = buildRecentSessionsSection(recent);

    expect(section).toContain('2026-09-05');
    expect(section).toContain('1h 47m');
    expect(section).toContain('18 turns');
    expect(section).toContain('Neon Nights');
    expect(section).toContain('Settled the release date');
  });

  test('carries the most recent next step so the agent knows where to pick up', () => {
    expect(buildRecentSessionsSection(recent)).toContain('Send the announce draft for approval.');
  });

  test('shows at most the default number of sessions and says how many are hidden', () => {
    const many = Array.from({ length: DEFAULT_RECENT_SESSIONS + 4 }, (_, i) =>
      entry({ sessionId: `s${i}`, date: '2026-09-01' }),
    );
    const section = buildRecentSessionsSection(many);

    expect(section.split('\n').filter((l) => l.startsWith('- '))).toHaveLength(DEFAULT_RECENT_SESSIONS);
    expect(section).toContain('4 older sessions are not shown');
    expect(section).toContain('recall_session');
  });

  test('says nothing about older sessions when everything is shown', () => {
    expect(buildRecentSessionsSection(recent)).not.toContain('not shown');
  });

  test('elides a runaway summary instead of pasting a whole transcript into the prompt', () => {
    const line = formatSessionLogLine(entry({ sessionId: 'x', date: '2026-09-05', summary: 'y'.repeat(5_000) }));
    expect(line.length).toBeLessThan(400);
    expect(line).toContain('…');
  });

  test('formats sub-hour and whole-hour durations readably', () => {
    expect(formatSessionLogLine(entry({ sessionId: 'a', date: '2026-09-05', durationMinutes: 45 }))).toContain('45m');
    expect(formatSessionLogLine(entry({ sessionId: 'b', date: '2026-09-05', durationMinutes: 120 }))).toContain('2h');
    expect(formatSessionLogLine(entry({ sessionId: 'c', date: '2026-09-05', durationMinutes: 0 }))).not.toContain('0m');
  });
});

describe('session search', () => {
  test('an empty query returns the most recent sessions', () => {
    const results = searchSessionLogEntries(recent, '   ', 2);
    expect(results.map((r) => r.entry.sessionId)).toEqual(['s3', 's2']);
  });

  test('matches on summary text', () => {
    const results = searchSessionLogEntries(recent, 'playlist');
    expect(results.map((r) => r.entry.sessionId)).toEqual(['s2']);
  });

  test('ranks a topic hit above a body-only hit', () => {
    const results = searchSessionLogEntries(recent, 'release');
    expect(results[0]!.entry.sessionId).toBe('s3');
  });

  test('returns nothing rather than everything when there is no match', () => {
    expect(searchSessionLogEntries(recent, 'zzzz-nothing-here')).toEqual([]);
  });

  test('searches next action and outcome too', () => {
    expect(searchSessionLogEntries(recent, 'approval').map((r) => r.entry.sessionId)).toEqual(['s3']);
    expect(searchSessionLogEntries(recent, 'decided').map((r) => r.entry.sessionId)).toEqual(['s3']);
  });

  test('respects the limit', () => {
    // "the" appears in two of the three summaries.
    expect(searchSessionLogEntries(recent, 'the')).toHaveLength(2);
    expect(searchSessionLogEntries(recent, 'the', 1)).toHaveLength(1);
  });
});
