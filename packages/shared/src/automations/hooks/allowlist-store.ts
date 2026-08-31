/**
 * Allowlist storage for polyglot shell hooks.
 *
 * Ported from NousResearch/hermes-agent (MIT) `agent/shell_hooks.py`
 * (`load_allowlist` / `save_allowlist` / `_locked_update_approvals`). See
 * THIRD_PARTY_NOTICES.md for the full attribution row.
 *
 * Storage path: ~/.runneros/shell-hooks-allowlist.json
 * Cross-process safety: a sibling `.lock` file is acquired via proper-lockfile
 * before every read-modify-write. The file is rewritten atomically (tmp + rename).
 *
 * Allowlist key = (event, absolute resolved scriptPath, sha256 of scriptPath
 * file content). Any of the three changing forces re-consent — including a
 * post-approval edit to the script body.
 */

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { parse as shellParse } from 'shell-quote';
// proper-lockfile is CommonJS; the default import surfaces the namespace.
import lockfile from 'proper-lockfile';

import { createLogger } from '../../utils/debug.ts';
import type { AllowlistEntry } from './types.ts';

const log = createLogger('shell-hook-allowlist');

export const ALLOWLIST_FILENAME = 'shell-hooks-allowlist.json';

/** Default allowlist path. ~/.runneros/shell-hooks-allowlist.json. */
export function getDefaultAllowlistPath(): string {
  return path.join(homedir(), '.runneros', ALLOWLIST_FILENAME);
}

interface AllowlistFile {
  approvals: AllowlistEntry[];
}

async function ensureParentDir(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function readFileOrEmpty(filePath: string): Promise<AllowlistFile> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      Array.isArray((parsed as AllowlistFile).approvals)
    ) {
      return parsed as AllowlistFile;
    }
    return { approvals: [] };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { approvals: [] };
    log.warn(`[allowlist] read failed (${filePath}): ${(err as Error).message}; treating as empty`);
    return { approvals: [] };
  }
}

async function atomicWrite(filePath: string, contents: string): Promise<void> {
  const tmp = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`
  );
  await fs.writeFile(tmp, contents, { mode: 0o600 });
  try {
    await fs.rename(tmp, filePath);
  } catch (err) {
    await fs.unlink(tmp).catch(() => undefined);
    throw err;
  }
}

/** Run `fn` under a cross-process exclusive lock on `filePath`. */
async function withFileLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  await ensureParentDir(filePath);
  // proper-lockfile requires the target to exist when locking. Touch it first.
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, JSON.stringify({ approvals: [] }, null, 2), { mode: 0o600 });
  }
  const release = await lockfile.lock(filePath, {
    retries: { retries: 8, factor: 1.5, minTimeout: 25, maxTimeout: 250 },
    stale: 10_000,
    lockfilePath: `${filePath}.lock`,
  });
  try {
    return await fn();
  } finally {
    try {
      await release();
    } catch (err) {
      log.debug(`[allowlist] release lock failed: ${(err as Error).message}`);
    }
  }
}

export async function readAllowlist(filePath = getDefaultAllowlistPath()): Promise<AllowlistEntry[]> {
  await ensureParentDir(filePath);
  const data = await readFileOrEmpty(filePath);
  return data.approvals;
}

export async function addAllowlistEntry(
  entry: AllowlistEntry,
  filePath = getDefaultAllowlistPath()
): Promise<void> {
  await withFileLock(filePath, async () => {
    const data = await readFileOrEmpty(filePath);
    // Drop any prior entry for the same (event, scriptPath) — re-approval
    // refreshes the recorded contentHash for that pair.
    const filtered = data.approvals.filter(
      (e) => !(e.event === entry.event && e.scriptPath === entry.scriptPath)
    );
    filtered.push(entry);
    const next: AllowlistFile = { approvals: filtered };
    await atomicWrite(filePath, JSON.stringify(next, null, 2));
  });
}

export async function findEntry(
  event: string,
  scriptPath: string,
  contentHash: string,
  filePath = getDefaultAllowlistPath()
): Promise<AllowlistEntry | null> {
  const all = await readAllowlist(filePath);
  for (const e of all) {
    if (e.event === event && e.scriptPath === scriptPath && e.scriptContentHash === contentHash) {
      return e;
    }
  }
  return null;
}

/** Parse a command string with shlex-equivalent semantics and return argv.
 * Rejects shell metacharacters (operators) that `shell-quote` surfaces as
 * non-string tokens — those would only ever be meaningful under shell:true,
 * which we never use. */
export function parseCommand(command: string): string[] {
  const expanded = expandTilde(command);
  const tokens = shellParse(expanded);
  const argv: string[] = [];
  for (const t of tokens) {
    if (typeof t !== 'string') {
      throw new Error(
        `shell hook command contains a shell operator or substitution token ` +
          `(${JSON.stringify(t)}); wrap pipes/redirection in a script.`
      );
    }
    argv.push(t);
  }
  if (argv.length === 0) throw new Error('shell hook command is empty');
  return argv;
}

function expandTilde(input: string): string {
  if (!input.startsWith('~')) return input;
  if (input === '~' || input.startsWith('~/')) {
    return path.join(homedir(), input.slice(1));
  }
  return input;
}

const SCRIPT_EXTENSIONS = new Set([
  '.sh', '.bash', '.zsh', '.fish',
  '.py', '.pyw',
  '.rb', '.pl', '.lua',
  '.js', '.mjs', '.cjs', '.ts', '.mts', '.cts',
]);

/** Return the script path from a parsed argv (matches Hermes `_command_script_path`). */
export function pickScriptPath(argv: string[]): string {
  for (const part of argv) {
    if (SCRIPT_EXTENSIONS.has(path.extname(part).toLowerCase())) return part;
  }
  for (const part of argv) {
    if (part.includes('/') || part.startsWith('~')) return part;
  }
  return argv[0]!;
}

/** Resolve argv[0] (or the picked script path) to an absolute path.
 *
 * Returns the lexical absolute path only. Callers that need to defend against
 * symlink swaps (allowlist key, hash input, spawn argv[0]) MUST canonicalise
 * via `resolveRealScriptPath` instead — that calls `fs.realpath` so a swapped
 * symlink yields a different resolved path (and therefore a different
 * allowlist key + a hash mismatch on re-execution). */
export function resolveScriptPath(command: string): { argv: string[]; scriptPath: string } {
  const argv = parseCommand(command);
  const picked = expandTilde(pickScriptPath(argv));
  const abs = path.isAbsolute(picked) ? picked : path.resolve(picked);
  return { argv, scriptPath: abs };
}

/** Same as `resolveScriptPath` but additionally canonicalises the script path
 * via `fs.realpath`, and rewrites argv[0] (or whichever argv slot was the
 * "picked" script) so `spawn` runs the real file rather than a possibly
 * swapped symlink. Throws ENOENT if the script does not exist. */
export async function resolveRealScriptPath(
  command: string
): Promise<{ argv: string[]; scriptPath: string }> {
  const argv = parseCommand(command);
  const picked = expandTilde(pickScriptPath(argv));
  const abs = path.isAbsolute(picked) ? picked : path.resolve(picked);
  const real = await fs.realpath(abs);
  // Rewrite the matching argv slot so spawn is invoked on the canonical path.
  const realArgv = argv.map((slot) => {
    const slotExpanded = expandTilde(slot);
    const slotAbs = path.isAbsolute(slotExpanded) ? slotExpanded : path.resolve(slotExpanded);
    return slotAbs === abs ? real : slot;
  });
  return { argv: realArgv, scriptPath: real };
}

/** sha256 of the resolved script's file contents. */
export async function computeScriptContentHash(scriptPath: string): Promise<string> {
  const buf = await fs.readFile(scriptPath);
  return createHash('sha256').update(buf).digest('hex');
}

/** Test-only helper. */
export function _testOnly_tempAllowlistPath(): string {
  return path.join(tmpdir(), `runneros-shell-hooks-allowlist-${process.pid}-${Date.now()}.json`);
}
