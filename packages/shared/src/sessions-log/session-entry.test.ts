import { describe, expect, test } from 'bun:test';
import { buildSessionLogEntry, type SessionLogSourceMessage } from './session-entry.ts';
import { serializeSessionsLog, parseSessionsLog } from './storage.ts';
import { SESSIONS_LOG_SCHEMA_VERSION } from './types.ts';

const T0 = Date.parse('2026-09-05T10:00:00.000Z');
const MIN = 60_000;

function msg(
  role: string,
  content: string,
  minutes = 0,
  extra: Partial<SessionLogSourceMessage> = {},
): SessionLogSourceMessage {
  return { role, content, timestamp: T0 + minutes * MIN, ...extra };
}

const NOW = new Date('2026-09-05T12:00:00.000Z');

describe('buildSessionLogEntry', () => {
  test('prefers the session title, which the app already paid a model call for', () => {
    const entry = buildSessionLogEntry({
      sessionId: 's1',
      title: 'Settling the Neon Nights release date',
      messages: [msg('user', 'when should we drop the single?'), msg('assistant', 'Let us look at the calendar.', 5)],
      now: NOW,
    });

    expect(entry?.summary).toBe('Settling the Neon Nights release date');
  });

  test('falls back to the opening ask before a title exists', () => {
    const entry = buildSessionLogEntry({
      sessionId: 's1',
      messages: [msg('user', 'when should we drop the single?'), msg('assistant', 'Let us look.', 3)],
      now: NOW,
    });

    expect(entry?.summary).toBe('when should we drop the single?');
  });

  test('records nothing for a session with no real exchange', () => {
    expect(buildSessionLogEntry({ sessionId: 's1', messages: [], now: NOW })).toBeNull();
    expect(buildSessionLogEntry({
      sessionId: 's1',
      messages: [msg('assistant', 'Ready when you are.')],
      now: NOW,
    })).toBeNull();
    expect(buildSessionLogEntry({
      sessionId: 's1',
      messages: [msg('user', '   ')],
      now: NOW,
    })).toBeNull();
  });

  test('counts assistant replies as turns and ignores tool commentary', () => {
    const entry = buildSessionLogEntry({
      sessionId: 's1',
      title: 'Work',
      messages: [
        msg('user', 'do the thing'),
        msg('assistant', 'checking...', 1, { isIntermediate: true }),
        msg('assistant', 'done', 2),
        msg('user', 'and again'),
        msg('assistant', 'done again', 3),
      ],
      now: NOW,
    });

    expect(entry?.turnCount).toBe(2);
  });

  test('derives duration from the exchange, omitting it when the session was instant', () => {
    const long = buildSessionLogEntry({
      sessionId: 's1',
      title: 'Work',
      messages: [msg('user', 'a'), msg('assistant', 'b', 107)],
      now: NOW,
    });
    expect(long?.durationMinutes).toBe(107);

    const instant = buildSessionLogEntry({
      sessionId: 's2',
      title: 'Work',
      messages: [msg('user', 'a'), msg('assistant', 'b')],
      now: NOW,
    });
    expect(instant?.durationMinutes).toBeUndefined();
  });

  test('dates the entry by the last exchange, not by the clock', () => {
    const entry = buildSessionLogEntry({
      sessionId: 's1',
      title: 'Work',
      messages: [msg('user', 'a'), msg('assistant', 'b')],
      now: new Date('2027-01-01T00:00:00.000Z'),
    });
    expect(entry?.date).toBe('2026-09-05');
  });

  test('carries workspace provenance so a campaign session is not read as career-wide', () => {
    const entry = buildSessionLogEntry({
      sessionId: 's1',
      title: 'Work',
      messages: [msg('user', 'a'), msg('assistant', 'b')],
      workspaceId: 'ws-1',
      workspaceLabel: 'Neon Nights',
      workspaceScope: 'campaign',
      now: NOW,
    });

    expect(entry?.workspaceId).toBe('ws-1');
    expect(entry?.workspaceLabel).toBe('Neon Nights');
    expect(entry?.workspaceScope).toBe('campaign');
  });

  /**
   * The log's parser reads a `---` line as structure and its serializer refuses
   * any summary that would read back as an entry. Collapsing to one line makes
   * that unreachable from our own writes — this pins it, because the fallback
   * summary is raw user text we do not control.
   */
  test('a summary is always one line, so a generated entry can never corrupt the log', () => {
    const hostile = 'para\n---\nsessionId: evil\ndate: 2020-01-01\n---\nhijacked';
    const entry = buildSessionLogEntry({ sessionId: 's1', messages: [msg('user', hostile)], now: NOW })!;

    expect(entry.summary).not.toContain('\n');

    const text = serializeSessionsLog({ version: SESSIONS_LOG_SCHEMA_VERSION, agent: 'concierge' }, [entry]);
    const parsed = parseSessionsLog(text, 'concierge');
    expect(parsed.warnings).toEqual([]);
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0]!.sessionId).toBe('s1');
  });

  test('elides a runaway opening message instead of storing a transcript', () => {
    const entry = buildSessionLogEntry({
      sessionId: 's1',
      messages: [msg('user', 'x'.repeat(5_000))],
      now: NOW,
    })!;

    expect(entry.summary.length).toBeLessThanOrEqual(400);
    expect(entry.summary.endsWith('…')).toBe(true);
  });
});
