import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { matter, stringifyFrontmatter } from '../frontmatter';

/**
 * These cover the swap described in `../frontmatter.ts`: gray-matter's bundled
 * js-yaml 3 replaced with the js-yaml 4 we already depend on. The risk of that
 * swap is not that it fails loudly — it is that it quietly parses a user's
 * existing memory or skill file differently, so most of what follows pins
 * behaviour rather than checking for errors.
 */

const doc = (frontmatter: string, body = 'body text') => `---\n${frontmatter}\n---\n${body}`;

describe('frontmatter parsing', () => {
  test('separates data from content', () => {
    const parsed = matter(doc('title: Midnight\ncount: 3'));
    expect(parsed.data).toEqual({ title: 'Midnight', count: 3 });
    expect(parsed.content.trim()).toBe('body text');
  });

  test('an unquoted date is a Date, and a quoted one stays a string', () => {
    // sessions-log and memory storage both normalise these two shapes. If the
    // engine stopped producing Date here, that normalisation would silently
    // start seeing strings it does not expect.
    const parsed = matter(doc('created: 2026-09-06\nlabel: "2026-09-06"'));
    expect(parsed.data['created']).toBeInstanceOf(Date);
    expect((parsed.data['created'] as Date).toISOString()).toBe('2026-09-06T00:00:00.000Z');
    expect(parsed.data['label']).toBe('2026-09-06');
  });

  test('keeps full timestamps', () => {
    const parsed = matter(doc('ts: 2026-09-06T10:11:12Z'));
    expect((parsed.data['ts'] as Date).toISOString()).toBe('2026-09-06T10:11:12.000Z');
  });

  test('preserves nested structures and lists', () => {
    const parsed = matter(doc('a:\n  b: [1, 2, 3]\n  c:\n    - x\n    - y'));
    expect(parsed.data['a']).toEqual({ b: [1, 2, 3], c: ['x', 'y'] });
  });

  test('reads null and boolean spellings exactly as the old engine did', () => {
    // Worth pinning because it is the one place the two engines could plausibly
    // disagree. They do not: both resolve only `true`/`false` as booleans and
    // leave the YAML 1.1 spellings as strings, so a skill file with `enabled:
    // yes` means the same thing before and after this change.
    const parsed = matter(doc('p: ~\nq: null\nr:\ns: yes\nt: no\nu: on\nv: true\nw: False'));
    expect(parsed.data).toEqual({
      p: null, q: null, r: null,
      s: 'yes', t: 'no', u: 'on',
      v: true, w: false,
    });
  });

  test('resolves anchors, aliases and merge keys', () => {
    const parsed = matter(doc('base: &b {k: 1}\nchild:\n  <<: *b\n  j: 2'));
    expect(parsed.data['child']).toEqual({ k: 1, j: 2 });
  });

  test('rejects duplicate keys rather than silently picking one', () => {
    expect(() => matter(doc('a: 1\na: 2'))).toThrow();
  });

  test('throws on malformed YAML so callers can report it', () => {
    // Every call site wraps this in a try/catch and turns it into a message for
    // the user, so throwing is the contract, not a bug.
    expect(() => matter(doc('a: [1, 2\nb: }{'))).toThrow();
  });

  test('handles a document with no frontmatter', () => {
    const parsed = matter('just a body, no delimiters\n');
    expect(parsed.data).toEqual({});
    expect(parsed.content).toContain('just a body');
  });

  test('handles empty frontmatter', () => {
    expect(matter(doc('')).data).toEqual({});
  });
});

describe('frontmatter serialising', () => {
  test('round-trips the shapes we write', () => {
    const data = { title: 'Has: a colon', tags: ['a', 'b'], nested: { k: 1 }, flag: true };
    const parsed = matter(stringifyFrontmatter('body\n', data));
    expect(parsed.data).toEqual(data);
    expect(parsed.content.trim()).toBe('body');
  });

  test('round-trips a Date back to the same instant', () => {
    const when = new Date('2026-09-06T10:11:12.000Z');
    const parsed = matter(stringifyFrontmatter('body\n', { when }));
    expect((parsed.data['when'] as Date).toISOString()).toBe(when.toISOString());
  });

  test('quotes multiline strings so they survive the trip', () => {
    const parsed = matter(stringifyFrontmatter('body\n', { note: 'line one\nline two' }));
    expect(parsed.data['note']).toBe('line one\nline two');
  });
});

describe('the vulnerable engine stays unreachable', () => {
  test('no source file imports gray-matter directly', () => {
    // The whole point of ../frontmatter.ts is that gray-matter's own js-yaml 3
    // never runs. A stray `import matter from 'gray-matter'` anywhere else
    // quietly undoes that, and nothing else would catch it.
    const roots = [
      join(import.meta.dir, '..', '..'),
      join(import.meta.dir, '..', '..', '..', '..', 'session-tools-core', 'src'),
    ];
    // The two wrappers are the only legitimate importers. This file names the
    // package in its own guard regex, so it has to exempt itself too.
    const allowed = new Set(['frontmatter.ts', 'frontmatter.test.ts']);
    const offenders: string[] = [];

    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry === 'dist') continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) { walk(full); continue; }
        if (!entry.endsWith('.ts') && !entry.endsWith('.tsx')) continue;
        if (allowed.has(entry)) continue;
        if (/from ['"]gray-matter['"]/.test(readFileSync(full, 'utf-8'))) offenders.push(full);
      }
    };
    for (const root of roots) walk(root);

    expect(offenders).toEqual([]);
  });
});
