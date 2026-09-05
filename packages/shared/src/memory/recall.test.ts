import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveMemoryEntry } from './storage.ts';
import { rankMemoryEntries, recallMemoryEntries } from './recall.ts';
import type { MemoryStorageOptions } from './types.ts';

let root: string;
let options: MemoryStorageOptions;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'craft-memory-recall-test-'));
  options = { globalAgentsDir: root };
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('rankMemoryEntries', () => {
  test('prioritizes name matches over body-only matches', () => {
    const results = rankMemoryEntries('short answers', [
      {
        scope: 'user',
        entry: {
          name: 'prefers short answers',
          type: 'feedback',
          created: '2026-05-01',
          body: 'Use direct language.',
        },
      },
      {
        scope: 'user',
        entry: {
          name: 'formatting',
          type: 'feedback',
          created: '2026-05-01',
          body: 'Short answers are useful when the user asks for speed.',
        },
      },
    ]);

    expect(results.map((result) => result.entry.name)).toEqual([
      'prefers short answers',
      'formatting',
    ]);
    expect(results[0]!.score).toBeGreaterThan(results[1]!.score);
  });

  test('boosts exact phrase matches above scattered token matches', () => {
    const results = rankMemoryEntries('browser follow up', [
      {
        scope: 'user',
        entry: {
          name: 'research method',
          type: 'feedback',
          created: '2026-05-01',
          body: 'Prefer browser follow up before synthesis.',
        },
      },
      {
        scope: 'user',
        entry: {
          name: 'browser notes',
          type: 'feedback',
          created: '2026-05-01',
          body: 'Use browser searches. Follow leads. Summarize up front.',
        },
      },
    ]);

    expect(results.map((result) => result.entry.name)).toEqual([
      'research method',
      'browser notes',
    ]);
  });

  test('gives recent memories a small tie-break boost', () => {
    const results = rankMemoryEntries('launch receipt', [
      {
        scope: 'user',
        entry: {
          name: 'old receipt note',
          type: 'reference',
          created: '2024-01-01',
          body: 'Launch receipt should list injected context.',
        },
      },
      {
        scope: 'user',
        entry: {
          name: 'new receipt note',
          type: 'reference',
          created: new Date().toISOString().slice(0, 10),
          body: 'Launch receipt should list injected context.',
        },
      },
    ]);

    expect(results[0]!.entry.name).toBe('new receipt note');
  });

  test('does not return unrelated recent memories', () => {
    const results = rankMemoryEntries('browser follow up', [
      {
        scope: 'user',
        entry: {
          name: 'new unrelated note',
          type: 'reference',
          created: new Date().toISOString().slice(0, 10),
          body: 'Launch receipts include injected memory.',
        },
      },
    ]);

    expect(results).toEqual([]);
  });
});

describe('recallMemoryEntries', () => {
  test('recalls across USER.md and selected agent memory', async () => {
    await saveMemoryEntry({
      scope: 'user',
      name: 'prefers concise replies',
      type: 'feedback',
      body: 'User prefers concise, punchy answers.',
    }, options);
    await saveMemoryEntry({
      scope: 'agent',
      agentSlug: 'researcher',
      name: 'browser loop',
      type: 'feedback',
      body: 'Deep research should use follow-up browser searches before synthesis.',
    }, options);

    const results = recallMemoryEntries({
      query: 'research browser follow up',
      agentSlug: 'researcher',
    }, options);

    expect(results.map((result) => result.entry.name)).toContain('browser loop');
    expect(results.find((result) => result.entry.name === 'browser loop')?.scope).toBe('agent');
  });

  test('requires agentSlug when agent scope is requested', () => {
    expect(() => recallMemoryEntries({
      query: 'browser',
      scopes: ['agent'],
    }, options)).toThrow(/agentSlug is required/);
  });

  test('does not recall expired memory entries', async () => {
    await saveMemoryEntry({
      scope: 'user',
      name: 'expired launch note',
      type: 'reference',
      body: 'Launch receipts used to omit memory.',
      expires: '2000-01-01',
    }, options);
    await saveMemoryEntry({
      scope: 'user',
      name: 'active launch note',
      type: 'reference',
      body: 'Launch receipts include memory.',
    }, options);

    const results = recallMemoryEntries({ query: 'launch receipts' }, options);

    expect(results.map((result) => result.entry.name)).toEqual(['active launch note']);
  });
});

describe('recall survives the way people actually phrase questions', () => {
  const now = new Date().toISOString();
  const scoped = (name: string, body: string) => ({
    scope: 'agent' as const,
    agentSlug: 'artist-manager',
    entry: { name, type: 'project' as const, created: now, updated: now, body },
  });

  const store = [
    scoped('playlist-strategy', 'Mikey targets indie editorial playlist placements.'),
    scoped('press-bio', 'Third person, no hype adjectives, mentions the Detroit scene.'),
    scoped('release-cadence', 'Ships a single every six weeks, album once a year.'),
  ];

  /**
   * Every one of these returned zero results before stemming — not a worse
   * ranking, nothing at all, because an entry with no token or phrase hit is
   * dropped outright. An artist does not phrase a question the way they
   * phrased the note.
   */
  test.each([
    ['playlists', 'playlist-strategy'],
    ['releases', 'release-cadence'],
    ['shipping', 'release-cadence'],
    ['placements', 'playlist-strategy'],
  ])('%p finds %p', (query, expected) => {
    const results = rankMemoryEntries(query, store, 3);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.entry.name).toBe(expected);
  });

  test('an exact match still outranks an inflected one', () => {
    const exact = rankMemoryEntries('playlist', store, 3)[0]!;
    const inflected = rankMemoryEntries('playlists', store, 3)[0]!;
    expect(exact.entry.name).toBe(inflected.entry.name);
    expect(exact.score).toBeGreaterThan(inflected.score);
  });

  test('still returns nothing for a genuinely unrelated query', () => {
    expect(rankMemoryEntries('quarterly tax filing', store, 3)).toEqual([]);
  });

  test('excerpt centres on an inflected hit rather than the start of the body', () => {
    const long = scoped('notes', `${'padding. '.repeat(40)}The playlist placements matter here.${' tail.'.repeat(40)}`);
    const [result] = rankMemoryEntries('placements', [long], 1);
    expect(result!.excerpt).toContain('placements');
  });
});
