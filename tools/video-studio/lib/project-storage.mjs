import { validateColorProjectBudget } from './color-pipeline.mjs';
import { existsSync, realpathSync, statSync, lstatSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync, fsyncSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, join, basename, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export class VideoProjectStorageError extends Error {
  constructor(code, message) { super(message); this.name = 'VideoProjectStorageError'; this.code = code; }
}

function canonicalProjectPath(path) {
  const absolute = resolve(path);
  mkdirSync(dirname(absolute), { recursive: true });
  if (existsSync(absolute)) {
    const canonical = realpathSync(absolute);
    const stat = statSync(canonical);
    if (!stat.isFile() || stat.nlink > 1) throw new VideoProjectStorageError('VIDEO_PROJECT_UNSAFE_PATH', 'Video project must be a regular file with one hard link. Use a separate project copy instead of a hardlink.');
    return canonical;
  }
  try {
    if (lstatSync(absolute).isSymbolicLink()) throw new VideoProjectStorageError('VIDEO_PROJECT_UNSAFE_PATH', 'Video project symlink target does not exist. Repair the link before saving.');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return join(realpathSync(dirname(absolute)), basename(absolute));
}

function durableReplace(path, content) {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let fd;
  try {
    fd = openSync(temporary, 'wx', 0o600);
    writeFileSync(fd, content, 'utf8');
    fsyncSync(fd);
    closeSync(fd); fd = undefined;
    renameSync(temporary, path);
  } finally {
    if (fd !== undefined) closeSync(fd);
    try { unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

/**
 * Compare and commit under one short, process-independent exclusive lock.
 * A crashed owner leaves the lock in place: fail closed rather than stealing it
 * by age or PID (which can be reused). Recovery requires verifying the recorded
 * owner has stopped, then removing only that project's .write-lock file.
 */
export function commitVideoProjectContent(path, content, options) {
  if (typeof content !== 'string') throw new TypeError('Video project content must be a string.');
  if (!options || (options.expectedContent !== null && typeof options.expectedContent !== 'string')) throw new VideoProjectStorageError('VIDEO_PROJECT_EXPECTED_CONTENT_REQUIRED', 'Saving a video project requires the exact content it was read from, or null for a new project.');
  validateColorProjectBudget(JSON.parse(content));
  const canonical = canonicalProjectPath(path);
  const lockPath = `${canonical}.write-lock`;
  let lockFd;
  try { lockFd = openSync(lockPath, 'wx', 0o600); }
  catch (error) {
    if (error.code === 'EEXIST') throw new VideoProjectStorageError('VIDEO_PROJECT_BUSY', `Video project is being saved by another process. Retry shortly. If its owner crashed, verify it has stopped before removing ${lockPath}.`);
    throw error;
  }
  try {
    writeFileSync(lockFd, JSON.stringify({ pid: process.pid, token: randomUUID(), createdAt: new Date().toISOString() }), 'utf8');
    fsyncSync(lockFd);
    // Recheck after acquiring the lock: never follow a newly substituted alias.
    if (canonicalProjectPath(path) !== canonical) throw new VideoProjectStorageError('VIDEO_PROJECT_CONFLICT', 'Video project location changed while saving. Reload before retrying.');
    const existing = existsSync(canonical) ? readFileSync(canonical, 'utf8') : null;
    if (existing !== options.expectedContent) throw new VideoProjectStorageError('VIDEO_PROJECT_CONFLICT', 'Video project changed since it was read. Your newer edits were preserved. Reload before saving again.');
    if (existing !== null && options.backupExisting !== false) {
      let validJson = true;
      try { JSON.parse(existing); } catch { validJson = false; }
      // A corrupt live file must never replace the last good backup.
      durableReplace(validJson ? `${canonical}.bak` : `${canonical}.${Date.now()}.${randomUUID()}.corrupt.bak`, existing);
    }
    durableReplace(canonical, content);
  } finally {
    closeSync(lockFd);
    unlinkSync(lockPath);
  }
}
