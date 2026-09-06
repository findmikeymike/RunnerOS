import { describe, expect, it } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Guards against a mocking mistake that hangs an entire test process with no
 * error message.
 *
 * The tempting way to write a partial module mock is to fall back to the real
 * implementation for inputs the test does not care about:
 *
 *     import * as actualConfig from '@craft-agent/shared/config'
 *
 *     mock.module('@craft-agent/shared/config', () => ({
 *       ...actualConfig,
 *       getWorkspaceByNameOrId: (id) => id === mine
 *         ? myWorkspace
 *         : actualConfig.getWorkspaceByNameOrId(id),   // <-- infinite recursion
 *     }))
 *
 * Under Bun, `import * as actualConfig` is a *live* binding. `mock.module`
 * re-points it at the mock, so `actualConfig.getWorkspaceByNameOrId` inside the
 * fallback is the mock itself. It calls itself forever. Because it is a
 * strict-mode tail call, JavaScriptCore eliminates the stack frame: there is no
 * RangeError, no stack overflow, no memory growth and no open handles — just a
 * process pinned at 100% CPU that never exits.
 *
 * It does not fire in the offending file's own tests, which only ever hit the
 * branch above the fallback. It fires when a *later* test file in the same
 * process reaches the leaked mock with an argument the fallback does not
 * recognise. That made the original instance of this bug (six files, found
 * 2026-09) look like an unrelated hang in whichever file happened to run next.
 *
 * The fix is to capture the real function in a `const` *before* calling
 * `mock.module`, and to route the fallback through that captured reference.
 * Captured references are snapshots and keep pointing at the real
 * implementation.
 */

const repoRoot = join(import.meta.dir, '..', '..', '..', '..');

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  '.git',
  'release-artist-os',
  'vendor',
  'coverage',
]);

function collectTestFiles(dir: string, found: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry) || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    let stats;
    try {
      stats = statSync(full);
    } catch {
      continue;
    }
    if (stats.isDirectory()) {
      collectTestFiles(full, found);
    } else if (/\.test\.tsx?$/.test(entry)) {
      found.push(full);
    }
  }
  return found;
}

/** Names bound by `import * as NAME from '...'` in this source. */
function namespaceImports(source: string): string[] {
  const names: string[] = [];
  const pattern = /import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    if (match[1]) names.push(match[1]);
  }
  return names;
}

/**
 * Extracts the text of every `mock.module(...)` call by matching parentheses
 * from the opening paren, so nested calls and object literals stay intact.
 */
function mockModuleCalls(source: string): string[] {
  const calls: string[] = [];
  const opener = /\bmock\s*\.\s*module\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = opener.exec(source)) !== null) {
    let depth = 0;
    let index = match.index + match[0].length - 1;
    const start = index;
    for (; index < source.length; index += 1) {
      const char = source[index];
      if (char === '(') depth += 1;
      else if (char === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    calls.push(source.slice(start, index + 1));
  }
  return calls;
}

interface Offence {
  file: string;
  namespace: string;
  snippet: string;
}

function findOffences(): Offence[] {
  const offences: Offence[] = [];
  for (const file of collectTestFiles(repoRoot)) {
    // This file documents and fixtures the very pattern it bans.
    if (file === import.meta.path) continue;
    const source = readFileSync(file, 'utf-8');
    if (!source.includes('mock.module')) continue;
    const namespaces = namespaceImports(source);
    if (namespaces.length === 0) continue;

    for (const call of mockModuleCalls(source)) {
      for (const name of namespaces) {
        // A *call* through the live namespace, e.g. `actualConfig.thing(`.
        // Spreading it (`...actualConfig`) is fine: that copies values once,
        // at factory time, and never routes back through the binding.
        const invocation = new RegExp(`\\b${name}\\s*\\.\\s*[A-Za-z_$][\\w$]*\\s*\\(`);
        const hit = invocation.exec(call);
        if (!hit) continue;
        offences.push({
          file: relative(repoRoot, file),
          namespace: name,
          snippet: call.slice(Math.max(0, hit.index - 60), hit.index + 60).replace(/\s+/g, ' ').trim(),
        });
      }
    }
  }
  return offences;
}

describe('mock.module hygiene', () => {
  it('no mock factory calls back through a live namespace import', () => {
    const offences = findOffences();

    const detail = offences
      .map((o) => `  ${o.file}: fallback calls through '${o.namespace}'\n    ...${o.snippet}...`)
      .join('\n');

    expect(
      offences.length === 0
        ? ''
        : `Found ${offences.length} mock.module factory fallback(s) that call through a live namespace import.\n`
          + `Under Bun this recurses forever and hangs the test process at 100% CPU with no error.\n`
          + `Capture the real function in a const BEFORE mock.module, then call the captured reference:\n\n`
          + `  const realFn = actualX.fn\n`
          + `  mock.module('x', () => ({ ...actualX, fn: (a) => mine(a) ?? realFn(a) }))\n\n`
          + detail,
    ).toBe('');
  });

  it('detects the recursive pattern it is meant to catch', () => {
    // Proves the matcher is live rather than vacuously passing.
    const bad = `
      import * as actualThing from './thing'
      mock.module('./thing', () => ({
        ...actualThing,
        load: (id) => id === mine ? stub : actualThing.load(id),
      }))
    `;
    const names = namespaceImports(bad);
    expect(names).toEqual(['actualThing']);
    const calls = mockModuleCalls(bad);
    expect(calls).toHaveLength(1);
    expect(new RegExp(`\\b${names[0]}\\s*\\.\\s*[A-Za-z_$][\\w$]*\\s*\\(`).test(calls[0]!)).toBe(true);
  });

  it('accepts a spread of the namespace and a captured fallback', () => {
    const good = `
      import * as actualThing from './thing'
      const realLoad = actualThing.load
      mock.module('./thing', () => ({
        ...actualThing,
        load: (id) => id === mine ? stub : realLoad(id),
      }))
    `;
    const names = namespaceImports(good);
    const calls = mockModuleCalls(good);
    expect(calls).toHaveLength(1);
    expect(new RegExp(`\\b${names[0]}\\s*\\.\\s*[A-Za-z_$][\\w$]*\\s*\\(`).test(calls[0]!)).toBe(false);
  });
});
