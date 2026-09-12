/**
 * Workflow Outputs - workspace-local manifest persistence.
 *
 * Layout:
 *   <workspaceRoot>/outputs/<outputId>/output.json
 */

import {
  existsSync,
  closeSync,
  fsyncSync,
  linkSync,
  lstatSync,
  openSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { readProcessIdentity, processIdentityProvesReplacement } from '../durable-execution/process-identity';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import type { CreateOutputBundleInput, OutputAsset, OutputManifest, OutputSummary } from './types.ts';
import { previewModeForMimeType, summarizeOutputContent, toOutputSummary } from './preview.ts';
import {
  assertOutputManifest,
  assertValidOutputId,
  isContainedPath,
  isOutputManifest,
  isSafeRelativeAssetPath,
  isValidOutputId,
} from './validation.ts';

export const OUTPUTS_DIR = 'outputs';
export const OUTPUT_MANIFEST_FILE = 'output.json';
const OUTPUT_LOCK_TIMEOUT_MS = 10_000;
const outputLockContext = new AsyncLocalStorage<Map<string, string>>();

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'output';
}

function resolveOutputDir(workspaceRootPath: string, outputId: string): string | null {
  if (!isValidOutputId(outputId)) return null;
  const outputsRoot = resolve(workspaceRootPath, OUTPUTS_DIR);
  const outputDir = resolve(outputsRoot, outputId);
  return isContainedPath(outputsRoot, outputDir) ? outputDir : null;
}

/** `<workspaceRoot>/outputs/` */
export function getOutputsDir(workspaceRootPath: string): string {
  return join(workspaceRootPath, OUTPUTS_DIR);
}

/** `<workspaceRoot>/outputs/<outputId>/` */
export function getOutputDir(workspaceRootPath: string, outputId: string): string {
  const dir = resolveOutputDir(workspaceRootPath, outputId);
  if (!dir) throw new Error(`Invalid output id: ${outputId}`);
  return dir;
}

/** Back-compat alias for the phase-1 bundle directory. */
export function getOutputBundleDir(workspaceRootPath: string, outputId: string): string | null {
  return resolveOutputDir(workspaceRootPath, outputId);
}

/** `<workspaceRoot>/outputs/<outputId>/output.json` */
export function getOutputManifestFile(workspaceRootPath: string, outputId: string): string {
  return join(getOutputDir(workspaceRootPath, outputId), OUTPUT_MANIFEST_FILE);
}

/**
 * Resolve an asset path for preview/open operations. Relative paths must stay
 * inside the output bundle. Absolute paths are allowed only inside the
 * workspace root, which keeps file actions scoped to the current workspace.
 */
export function resolveOutputAssetPath(
  workspaceRootPath: string,
  outputId: string,
  assetPath: string,
): string | null {
  const outputDir = resolveOutputDir(workspaceRootPath, outputId);
  if (!outputDir || !assetPath || assetPath.includes('\0')) return null;

  if (isAbsolute(assetPath)) {
    const workspaceRoot = resolve(workspaceRootPath);
    const resolvedAssetPath = resolve(assetPath);
    return isContainedPath(workspaceRoot, resolvedAssetPath) ? resolvedAssetPath : null;
  }

  if (!isSafeRelativeAssetPath(assetPath)) return null;
  const resolvedAssetPath = resolve(outputDir, assetPath);
  return isContainedPath(outputDir, resolvedAssetPath) ? resolvedAssetPath : null;
}

export function assertOutputAssetPath(workspaceRootPath: string, outputId: string, assetPath: string): string {
  const resolvedPath = resolveOutputAssetPath(workspaceRootPath, outputId, assetPath);
  if (!resolvedPath) {
    throw new Error(`Invalid output asset path: ${assetPath}`);
  }
  return resolvedPath;
}

/**
 * Atomic JSON write. The pid + UUID suffix on the tmp filename prevents two
 * concurrent writers from clobbering each other's tmp file before rename.
 * Same shape as `writeFileAtomic` in `packages/shared/src/memory/storage.ts`.
 */
function atomicWriteJson(file: string, value: unknown): void {
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf-8');
    renameSync(tmp, file);
  } catch (err) {
    try { rmSync(tmp, { force: true }); } catch { /* ignore */ }
    throw err;
  }
}

function contentFilename(mimeType: string): string {
  if (mimeType === 'application/json') return 'content.json';
  if (mimeType === 'text/plain') return 'content.txt';
  return 'content.md';
}

function sizeAndHash(path: string): { sizeBytes: number; sha256: string } {
  const data = readFileSync(path);
  return {
    sizeBytes: statSync(path).size,
    sha256: createHash('sha256').update(data).digest('hex'),
  };
}

function assertSafeManifestAssetPaths(workspaceRootPath: string, manifest: OutputManifest): void {
  for (const asset of manifest.assets) {
    assertOutputAssetPath(workspaceRootPath, manifest.id, asset.path);
  }
  if (manifest.primary) {
    assertOutputAssetPath(workspaceRootPath, manifest.id, manifest.primary.path);
  }
}

function isManifestAssetPathsSafe(workspaceRootPath: string, manifest: OutputManifest): boolean {
  try {
    assertSafeManifestAssetPaths(workspaceRootPath, manifest);
    return true;
  } catch {
    return false;
  }
}

export function createOutputManifest(workspaceRootPath: string, manifest: OutputManifest): void {
  withOutputBundleLock(workspaceRootPath, manifest.id, () => {
    assertOutputManifest(manifest, manifest.id);
    assertSafeManifestAssetPaths(workspaceRootPath, manifest);
    const file = getOutputManifestFile(workspaceRootPath, manifest.id);
    if (existsSync(file)) throw new Error(`Output manifest already exists: ${manifest.id}`);
    writeOutputManifestUnlocked(workspaceRootPath, manifest);
  });
}

/**
 * Atomically write an output manifest. Creates the output directory if needed,
 * writes to a sibling `.tmp`, then renames within the same filesystem.
 */
export function writeOutputManifest(workspaceRootPath: string, manifest: OutputManifest): void {
  withOutputBundleLock(workspaceRootPath, manifest.id, () => writeOutputManifestUnlocked(workspaceRootPath, manifest));
}

function writeOutputManifestUnlocked(workspaceRootPath: string, manifest: OutputManifest): void {
  assertOutputManifest(manifest, manifest.id);
  assertSafeManifestAssetPaths(workspaceRootPath, manifest);
  const dir = getOutputDir(workspaceRootPath, manifest.id);
  mkdirSync(dir, { recursive: true });
  atomicWriteJson(join(dir, OUTPUT_MANIFEST_FILE), manifest);
}

/** Read an output manifest. Returns null when missing, unparsable, or invalid. */
export function readOutputManifest(workspaceRootPath: string, outputId: string): OutputManifest | null {
  const dir = resolveOutputDir(workspaceRootPath, outputId);
  if (!dir) return null;
  const file = join(dir, OUTPUT_MANIFEST_FILE);
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as unknown;
    if (!isOutputManifest(parsed, outputId)) return null;
    if (!isManifestAssetPathsSafe(workspaceRootPath, parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** List all output manifests for a workspace, sorted newest-first by `createdAt`. */
export function listOutputManifests(workspaceRootPath: string): OutputManifest[] {
  const root = getOutputsDir(workspaceRootPath);
  if (!existsSync(root)) return [];
  let entries: import('node:fs').Dirent[];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: OutputManifest[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifest = readOutputManifest(workspaceRootPath, entry.name);
    if (manifest) out.push(manifest);
  }
  out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return out;
}

function uniqueOutputSlug(workspaceRootPath: string, desired: string, ownId: string): string {
  const existing = new Set(
    listOutputManifests(workspaceRootPath)
      .filter((m) => m.id !== ownId)
      .map((m) => m.slug),
  );
  if (!existing.has(desired)) return desired;
  // Match the `-vN` convention used by the agent slug suggester so users
  // see one consistent collision shape across the app.
  let suffix = 2;
  while (existing.has(`${desired}-v${suffix}`)) suffix += 1;
  return `${desired}-v${suffix}`;
}

export function createOutputBundle(workspaceRootPath: string, input: CreateOutputBundleInput): OutputManifest {
  const id = input.id ?? randomUUID();
  assertValidOutputId(id);
  return withOutputBundleLock(workspaceRootPath, id, () => createOutputBundleUnlocked(workspaceRootPath, { ...input, id }));
}

function createOutputBundleUnlocked(workspaceRootPath: string, input: CreateOutputBundleInput & { id: string }): OutputManifest {
  const id = input.id;
  const createdAt = input.createdAt ?? new Date().toISOString();
  const updatedAt = createdAt;
  const outputDir = getOutputDir(workspaceRootPath, id);
  for (const asset of input.assets ?? []) {
    assertOutputAssetPath(workspaceRootPath, id, asset.path);
  }
  mkdirSync(outputDir, { recursive: true });

  const assets: OutputAsset[] = [...(input.assets ?? [])];
  let primary: OutputAsset | undefined = assets.find((asset) => asset.role === 'primary');
  let preview = undefined as OutputManifest['preview'];
  let summary = input.summary?.trim() ?? '';

  // The manifest is the publication commit marker. Content must exist first.
  // Existing bundles use a fresh content path so readers of the prior manifest
  // keep their original bytes until the manifest replacement commits.
  let contentTmpPath: string | null = null;
  let contentFinalPath: string | null = null;

  if (input.content !== undefined) {
    const mimeType = input.contentMimeType ?? 'text/markdown';
    const canonicalFilename = contentFilename(mimeType);
    const filename = existsSync(join(outputDir, OUTPUT_MANIFEST_FILE)) || existsSync(join(outputDir, canonicalFilename))
      ? `${basename(canonicalFilename, extname(canonicalFilename))}-${randomUUID()}${extname(canonicalFilename)}`
      : canonicalFilename;
    contentFinalPath = join(outputDir, filename);
    contentTmpPath = `${contentFinalPath}.${process.pid}.${randomUUID()}.staging`;
    let meta: { sizeBytes: number; sha256: string };
    try {
      writeFileSync(contentTmpPath, input.content, 'utf-8');
      meta = sizeAndHash(contentTmpPath);
    } catch (error) {
      try { rmSync(contentTmpPath, { force: true }); } catch { /* Preserve the staging error. */ }
      throw error;
    }
    primary = {
      id: 'primary',
      label: basename(canonicalFilename, extname(canonicalFilename)) || 'Content',
      role: 'primary',
      path: filename,
      mimeType,
      ...meta,
    };
    assets.unshift(primary);
    preview = {
      mode: previewModeForMimeType(mimeType),
      assetId: primary.id,
      inlineText: summarizeOutputContent(input.content, 800),
    };
    if (!summary) summary = summarizeOutputContent(input.content);
  }

  const desiredSlug = slugify(input.title);
  const manifest: OutputManifest = {
    schemaVersion: 1,
    id,
    workspaceId: input.workspaceId,
    title: input.title,
    slug: uniqueOutputSlug(workspaceRootPath, desiredSlug, id),
    kind: input.kind,
    status: input.status ?? 'published',
    summary,
    createdAt,
    updatedAt,
    completedAt: input.completedAt,
    origin: input.origin,
    primary,
    assets,
    receipts: input.receipts ?? [],
    links: input.links ?? [],
    preview,
    context: input.context,
    approval: input.approval,
    tags: input.tags,
    socialVariantSet: input.socialVariantSet,
  };

  let contentPublished = false;
  try {
    // Validate before either file becomes visible. The final manifest write
    // repeats validation under the same reentrant bundle lock.
    assertOutputManifest(manifest, id);
    assertSafeManifestAssetPaths(workspaceRootPath, manifest);
    if (contentTmpPath && contentFinalPath) {
      renameSync(contentTmpPath, contentFinalPath);
      contentPublished = true;
    }
    writeOutputManifest(workspaceRootPath, manifest);
  } catch (err) {
    if (contentTmpPath) {
      try { rmSync(contentTmpPath, { force: true }); } catch { /* ignore */ }
    }
    if (contentPublished && contentFinalPath) {
      try { unlinkSync(contentFinalPath); } catch { /* Keep the original publication error. */ }
    }
    throw err;
  }

  return manifest;
}

export function readOutput(workspaceRootPath: string, outputId: string): OutputManifest | null {
  return readOutputManifest(workspaceRootPath, outputId);
}

export function listOutputs(workspaceRootPath: string): OutputSummary[] {
  return listOutputManifests(workspaceRootPath).map(toOutputSummary);
}

/** Delete an output bundle. Returns true when something was removed. */
export function deleteOutput(workspaceRootPath: string, outputId: string): boolean {
  const dir = resolveOutputDir(workspaceRootPath, outputId);
  if (!dir) return false;
  return withOutputBundleLock(workspaceRootPath, outputId, () => {
    if (!existsSync(dir)) return false;
    rmSync(dir, { recursive: true, force: true });
    return true;
  });
}

function outputLockDir(workspaceRootPath: string, outputId: string): string {
  assertValidOutputId(outputId);
  return join(workspaceRootPath, 'context', '.locks', 'outputs', `${outputId}.lock`);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

interface OutputLockOwner { token: string; pid: number; hostname: string; createdAt: string; processIdentity?: string }
function readLockOwner(path: string): Partial<OutputLockOwner> {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw new Error('Output lock must not be a symbolic link.');
  return JSON.parse(readFileSync(stat.isDirectory() ? join(path, 'owner.json') : path, 'utf8')) as Partial<OutputLockOwner>;
}
function lockOwnerIsAbandoned(path: string): boolean {
  try {
    const owner = readLockOwner(path);
    if (owner.hostname !== hostname() || !Number.isInteger(owner.pid) || (owner.pid ?? 0) <= 0) return false;
    try {
      process.kill(owner.pid!, 0);
      return processIdentityProvesReplacement(typeof owner.processIdentity === 'string' ? owner.processIdentity : null, readProcessIdentity(owner.pid!));
    }
    catch (error) { return isNodeError(error) && error.code === 'ESRCH'; }
  } catch {
    // An unreadable/ownerless legacy lock may belong to a suspended writer.
    // Age cannot prove abandonment. Such artifacts require manual cleanup only
    // after independently proving the old writer is gone; new atomic locks avoid this gap.
    return false;
  }
}
function liveLockOwner(path: string): { pid: number; hostname: string } | undefined {
  try {
    const owner = readLockOwner(path);
    if (owner.hostname !== hostname() || !Number.isInteger(owner.pid) || (owner.pid ?? 0) <= 0) return undefined;
    process.kill(owner.pid!, 0);
    if (processIdentityProvesReplacement(typeof owner.processIdentity === 'string' ? owner.processIdentity : null, readProcessIdentity(owner.pid!))) return undefined;
    return { pid: owner.pid!, hostname: owner.hostname };
  } catch { return undefined; }
}
function newLockOwner(): OutputLockOwner {
  return { token: randomUUID(), pid: process.pid, hostname: hostname(), createdAt: new Date().toISOString(), processIdentity: readProcessIdentity(process.pid) ?? undefined };
}
/** Publish complete ownership atomically; a crash can never expose an empty new lock. */
function acquireOutputLock(path: string, owner: OutputLockOwner): void {
  const prepared = join(dirname(path), `.owner-${owner.token}.tmp`);
  const fd = openSync(prepared, 'wx', 0o600);
  try {
    try {
      writeFileSync(fd, JSON.stringify(owner), 'utf8');
      fsyncSync(fd);
    } finally { closeSync(fd); }
    linkSync(prepared, path);
  } finally {
    try { unlinkSync(prepared); } catch { /* An orphan preparation file never owns the lock; cleanup cannot invalidate successful acquisition. */ }
  }
}
function lockIdentity(path: string): string {
  const stat = lstatSync(path);
  let token: string | undefined;
  try { token = readLockOwner(path).token; } catch { /* Legacy ownerless directory. */ }
  return JSON.stringify([stat.dev, stat.ino, stat.birthtimeMs, token ?? null]);
}
function releaseOutputLock(path: string, token: string): void {
  try {
    if (readLockOwner(path).token === token) rmSync(path, { recursive: true, force: true });
  } catch { /* Never remove a lock whose ownership cannot be proven. */ }
}
/**
 * Serialize dead-owner removal for the observed identity, then recheck it under
 * ownership. Recovery of a crashed reclaimer uses the same rule one level down;
 * bounded recursion fails closed rather than ever stealing a live writer.
 */
function removeAbandonedOutputLock(path: string, depth = 0): boolean {
  if (depth >= 16 || !lockOwnerIsAbandoned(path)) return false;
  let identity: string;
  try { identity = lockIdentity(path); } catch { return false; }
  const guard = join(dirname(path), `.reclaim-${createHash('sha256').update(path + identity).digest('hex')}.lock`);
  const owner = newLockOwner();
  try {
    try { acquireOutputLock(guard, owner); }
    catch (error) {
      if (!isNodeError(error) || error.code !== 'EEXIST') throw error;
      if (!removeAbandonedOutputLock(guard, depth + 1)) return false;
      try { acquireOutputLock(guard, owner); }
      catch (retryError) { if (isNodeError(retryError) && retryError.code === 'EEXIST') return false; throw retryError; }
    }
    try {
      if (lockIdentity(path) !== identity || !lockOwnerIsAbandoned(path)) return false;
      rmSync(path, { recursive: true, force: true });
      return true;
    } catch (error) { if (isNodeError(error) && error.code === 'ENOENT') return true; throw error; }
  } finally { releaseOutputLock(guard, owner.token); }
}

export function withOutputBundleLock<T>(workspaceRootPath: string, outputId: string, fn: () => T): T {
  const path = outputLockDir(workspaceRootPath, outputId);
  if (outputLockContext.getStore()?.has(path)) return fn();
  const owner = newLockOwner();
  mkdirSync(dirname(path), { recursive: true });
  const deadline = Date.now() + OUTPUT_LOCK_TIMEOUT_MS;
  while (true) {
    try {
      acquireOutputLock(path, owner);
      break;
    } catch (error) {
      if (!isNodeError(error) || error.code !== 'EEXIST') throw error;
      if (removeAbandonedOutputLock(path)) continue;
      const liveOwner = liveLockOwner(path);
      if (liveOwner?.pid === process.pid) throw new Error(`Output "${outputId}" is busy with another operation in this process.`);
      if (Date.now() >= deadline) throw new Error(`Timed out waiting for Output lock: ${outputId}`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
  const context = new Map(outputLockContext.getStore());
  context.set(path, owner.token);
  try {
    return outputLockContext.run(context, fn);
  } finally {
    releaseOutputLock(path, owner.token);
  }
}

export async function withOutputBundleLockAsync<T>(workspaceRootPath: string, outputId: string, fn: () => Promise<T>): Promise<T> {
  const path = outputLockDir(workspaceRootPath, outputId);
  if (outputLockContext.getStore()?.has(path)) return fn();
  const owner = newLockOwner();
  mkdirSync(dirname(path), { recursive: true });
  const deadline = Date.now() + OUTPUT_LOCK_TIMEOUT_MS;
  while (true) {
    try {
      acquireOutputLock(path, owner);
      break;
    } catch (error) {
      if (!isNodeError(error) || error.code !== 'EEXIST') throw error;
      if (removeAbandonedOutputLock(path)) continue;
      if (Date.now() >= deadline) throw new Error(`Timed out waiting for Output lock: ${outputId}`);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
    }
  }
  const context = new Map(outputLockContext.getStore());
  context.set(path, owner.token);
  try {
    return await outputLockContext.run(context, fn);
  } finally {
    releaseOutputLock(path, owner.token);
  }
}

export {
  assertOutputManifest,
  assertValidOutputId,
  isOutputManifest,
  isValidOutputId,
};
