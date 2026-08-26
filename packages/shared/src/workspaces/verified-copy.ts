import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  realpathSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import type { BigIntStats } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

function isPathInside(parentPath: string, candidatePath: string): boolean {
  const between = relative(resolve(parentPath), resolve(candidatePath));
  return between === '' || (!between.startsWith('..') && !isAbsolute(between));
}

/**
 * Validate both lexical and real-path containment while rejecting every
 * symbolic-link component below the trusted root. Missing leaf paths are
 * allowed so callers can validate destinations before creating them.
 */
export function assertPathWithinRealRoot(rootPath: string, candidatePath: string): string {
  const root = resolve(rootPath);
  const candidate = resolve(candidatePath);
  if (!isPathInside(root, candidate)) throw new Error('Path escapes its trusted root.');

  const realRoot = realpathSync(root);
  let existingAncestor = root;
  const relativePath = relative(root, candidate);
  for (const part of relativePath.split(sep).filter(Boolean)) {
    const next = join(existingAncestor, part);
    try {
      const stat = lstatSync(next);
      if (stat.isSymbolicLink()) {
        throw new Error(`Trusted paths cannot contain symbolic links: ${relativePath}`);
      }
      existingAncestor = next;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') break;
      throw error;
    }
  }

  if (!isPathInside(realRoot, realpathSync(existingAncestor))) {
    throw new Error('Path resolves outside its trusted root.');
  }
  return candidate;
}

type OpenedFileIdentity = BigIntStats;

function assertPathStillNamesOpenedFile(
  filePath: string,
  opened: OpenedFileIdentity,
  trustedRootPath?: string,
): void {
  if (trustedRootPath) assertPathWithinRealRoot(trustedRootPath, filePath);
  const current = lstatSync(filePath, { bigint: true });
  if (current.isSymbolicLink() || !current.isFile()) {
    throw new Error(`Verified copy refused a non-regular file: ${filePath}`);
  }
  if (current.dev !== opened.dev || current.ino !== opened.ino) {
    throw new Error(`File changed while preparing verified copy: ${filePath}`);
  }
}

function sameSourceSnapshot(before: OpenedFileIdentity, after: OpenedFileIdentity): boolean {
  return before.dev === after.dev
    && before.ino === after.ino
    && before.size === after.size
    && before.mtimeNs === after.mtimeNs
    && before.ctimeNs === after.ctimeNs;
}

export interface VerifiedCopyOptions {
  sourceRootPath?: string;
  destinationRootPath: string;
}

/**
 * Copy through already-open file descriptors so later path swaps cannot
 * redirect I/O. O_NOFOLLOW protects the final component where supported;
 * inode and real-root checks before and after open catch path replacement and
 * parent-directory symlink swaps. Destinations are created exclusively.
 */
export function verifiedCopyFileSync(
  sourcePath: string,
  destinationPath: string,
  options: VerifiedCopyOptions,
): void {
  const source = resolve(sourcePath);
  const destination = resolve(destinationPath);
  if (options.sourceRootPath) assertPathWithinRealRoot(options.sourceRootPath, source);
  assertPathWithinRealRoot(options.destinationRootPath, destination);

  const sourcePathStat = lstatSync(source, { bigint: true });
  if (sourcePathStat.isSymbolicLink() || !sourcePathStat.isFile()) {
    throw new Error(`Verified copy requires a regular source file: ${source}`);
  }

  mkdirSync(dirname(destination), { recursive: true });
  assertPathWithinRealRoot(options.destinationRootPath, destination);

  const noFollow = process.platform === 'win32' ? 0 : (constants.O_NOFOLLOW ?? 0);
  let sourceFd: number | undefined;
  let destinationFd: number | undefined;
  let destinationIdentity: OpenedFileIdentity | undefined;
  let failure: unknown;
  try {
    sourceFd = openSync(source, constants.O_RDONLY | noFollow);
    const sourceBefore = fstatSync(sourceFd, { bigint: true });
    if (!sourceBefore.isFile()) throw new Error(`Verified copy requires a regular source file: ${source}`);
    if (sourceBefore.dev !== sourcePathStat.dev || sourceBefore.ino !== sourcePathStat.ino) {
      throw new Error(`Source changed before verified copy opened it: ${source}`);
    }
    assertPathStillNamesOpenedFile(source, sourceBefore, options.sourceRootPath);

    destinationFd = openSync(
      destination,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow,
      0o600,
    );
    destinationIdentity = fstatSync(destinationFd, { bigint: true });
    assertPathStillNamesOpenedFile(destination, destinationIdentity, options.destinationRootPath);

    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let copiedBytes = 0n;
    while (true) {
      const bytesRead = readSync(sourceFd, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      let written = 0;
      while (written < bytesRead) {
        written += writeSync(destinationFd, buffer, written, bytesRead - written, null);
      }
      copiedBytes += BigInt(bytesRead);
    }

    const sourceAfter = fstatSync(sourceFd, { bigint: true });
    if (!sameSourceSnapshot(sourceBefore, sourceAfter) || copiedBytes !== sourceBefore.size) {
      throw new Error(`Source changed during verified copy: ${source}`);
    }
    assertPathStillNamesOpenedFile(source, sourceAfter, options.sourceRootPath);
    assertPathStillNamesOpenedFile(destination, destinationIdentity, options.destinationRootPath);
    try {
      fsyncSync(destinationFd);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!['EINVAL', 'ENOTSUP', 'ENOSYS', 'EPERM'].includes(code ?? '')) throw error;
    }
    try {
      fchmodSync(destinationFd, Number(sourceBefore.mode & 0o777n));
    } catch (error) {
      if (process.platform !== 'win32') throw error;
    }
  } catch (error) {
    failure = error;
  } finally {
    if (destinationFd !== undefined) closeSync(destinationFd);
    if (sourceFd !== undefined) closeSync(sourceFd);
  }
  if (failure !== undefined) {
    if (destinationIdentity) {
      try {
        const current = lstatSync(destination, { bigint: true });
        if (!current.isSymbolicLink() && current.dev === destinationIdentity.dev && current.ino === destinationIdentity.ino) {
          unlinkSync(destination);
        }
      } catch {
        // Preserve the original verified-copy error.
      }
    }
    throw failure;
  }
}
