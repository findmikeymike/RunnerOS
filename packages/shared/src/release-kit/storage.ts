import { createHash, randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { hostname } from 'node:os';
import {
  closeSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import {
  RELEASE_KIT_DIR,
  RELEASE_KIT_MANIFEST_FILE,
  type MaterializeReleaseKitItemInput,
  type ReleaseKitCategory,
  type ReleaseKitItem,
  type ReleaseKitManifest,
  type ReleaseKitSource,
  type ReleaseKitUsageMetadata,
  type ReleaseKitUseCase,
  type UpdateReleaseKitUsageInput,
  type ReleaseKitVerificationResult,
  type RemoveReleaseKitItemResult,
} from './types.ts';

const RELEASE_KIT_CATEGORIES = new Set<ReleaseKitCategory>([
  'audio',
  'artwork',
  'video',
  'images',
  'copy',
  'plans',
  'merch',
  'documents',
  'references',
]);
const RELEASE_KIT_USE_CASES = new Set<ReleaseKitUseCase>(['social', 'ads', 'store', 'press', 'delivery']);
const RELEASE_KIT_LOCK_TIMEOUT_MS = 10_000;
const RELEASE_KIT_ORPHAN_LOCK_STALE_MS = 24 * 60 * 60 * 1000;
const HASH_BUFFER_BYTES = 1024 * 1024;
const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const releaseKitLockContext = new AsyncLocalStorage<string>();

export function getReleaseKitRoot(workspaceRootPath: string): string {
  return join(workspaceRootPath, RELEASE_KIT_DIR);
}

export function getReleaseKitManifestPath(workspaceRootPath: string): string {
  return join(getReleaseKitRoot(workspaceRootPath), RELEASE_KIT_MANIFEST_FILE);
}

export function emptyReleaseKitManifest(workspaceId: string, campaignId: string): ReleaseKitManifest {
  return {
    schemaVersion: 3,
    workspaceId,
    campaignId,
    updatedAt: '1970-01-01T00:00:00.000Z',
    items: [],
  };
}

export function loadReleaseKitManifest(
  workspaceRootPath: string,
  workspaceId = 'workspace',
  campaignId = workspaceId,
): ReleaseKitManifest {
  const path = getReleaseKitManifestPath(workspaceRootPath);
  if (!existsSync(path)) return emptyReleaseKitManifest(workspaceId, campaignId);
  const parsed = parseManifest(readFileSync(path, 'utf8'));
  if (parsed) {
    if (parsed.workspaceId !== workspaceId || parsed.campaignId !== campaignId) {
      throw new Error('Release Kit manifest belongs to a different workspace or campaign.');
    }
    return parsed;
  }
  throw new Error('Release Kit manifest is invalid. Repair release-kit/manifest.json before updating the kit.');
}

export function materializeReleaseKitItem(
  workspaceRootPath: string,
  input: MaterializeReleaseKitItemInput,
): { manifest: ReleaseKitManifest; item: ReleaseKitItem } {
  return withReleaseKitLock(workspaceRootPath, () => {
    validateMaterializeInput(input);
    const sourcePath = resolve(input.sourcePath);
    const sourceInfo = statSync(sourcePath);
    if (!sourceInfo.isFile()) throw new Error('Release Kit promotion source must be a file.');

    const manifest = loadReleaseKitManifest(workspaceRootPath, input.workspaceId, input.campaignId);
    if (manifest.workspaceId !== input.workspaceId || manifest.campaignId !== input.campaignId) {
      throw new Error('Release Kit manifest belongs to a different workspace or campaign.');
    }

    const subtype = normalizeSubtype(input.subtype);
    const fileName = safeSnapshotFileName(basename(sourcePath));
    const destination = nextAvailableSnapshotPath(workspaceRootPath, input.category, subtype, fileName);
    assertSafeReleaseKitPath(workspaceRootPath, destination);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(sourcePath, destination);

    try {
      const relativePath = toManifestPath(relative(workspaceRootPath, destination));
      const snapshotInfo = statSync(destination);
      const snapshotSha256 = hashFileSha256(destination);
      const approvedSourceSha256 = input.trackIntelligence?.provenance.sourceSha256;
      if (input.trackIntelligence && !approvedSourceSha256) {
        throw new Error('Approved Track Intelligence is missing its source-audio hash. Re-run Track Intelligence before promoting it.');
      }
      if (approvedSourceSha256 && snapshotSha256 !== approvedSourceSha256) {
        throw new Error('The source audio changed after its lyrics were approved. Re-run Track Intelligence before promoting it.');
      }
      const now = new Date().toISOString();
      const item: ReleaseKitItem = {
        id: `kit_${randomUUID()}`,
        campaignId: input.campaignId,
        category: input.category,
        subtype,
        title: normalizeTitle(input.title, fileName),
        source: normalizeSource(input.source),
        relativePath,
        ...(input.mimeType?.trim() ? { mimeType: input.mimeType.trim() } : {}),
        sizeBytes: snapshotInfo.size,
        snapshotMtimeMs: snapshotInfo.mtimeMs,
        sha256: snapshotSha256,
        status: 'ready',
        isPrimary: Boolean(input.makePrimary),
        promotedAt: now,
        promotedBy: input.promotedBy,
        ...(input.note?.trim() ? { note: input.note.trim().slice(0, 1_000) } : {}),
        ...(input.trackIntelligence ? { trackIntelligence: input.trackIntelligence } : {}),
        usage: defaultReleaseKitUsage(now, input.promotedBy === 'migration' ? 'migration' : 'system'),
      };
      const nextItems = manifest.items.map((existing) => (
        item.isPrimary && existing.category === item.category && existing.subtype === item.subtype
          ? { ...existing, isPrimary: false }
          : existing
      ));
      nextItems.push(item);
      const nextManifest: ReleaseKitManifest = {
        ...manifest,
        schemaVersion: 3,
        updatedAt: now,
        items: nextItems,
      };
      saveReleaseKitManifest(workspaceRootPath, nextManifest);
      return { manifest: nextManifest, item };
    } catch (error) {
      rmSync(destination, { force: true });
      throw error;
    }
  });
}

export function defaultReleaseKitUsage(
  updatedAt: string,
  updatedBy: ReleaseKitUsageMetadata['updatedBy'] = 'migration',
): ReleaseKitUsageMetadata {
  return {
    bestFor: [],
    contentRating: 'unknown',
    restrictions: {
      blockedFromUse: false,
      needsRightsClearance: false,
      artistLikenessRestricted: false,
    },
    updatedAt,
    updatedBy,
  };
}

export function updateReleaseKitItemUsage(
  workspaceRootPath: string,
  workspaceId: string,
  campaignId: string,
  itemId: string,
  input: UpdateReleaseKitUsageInput,
): ReleaseKitManifest {
  return withReleaseKitLock(workspaceRootPath, () => updateReleaseKitItemUsageWhileLocked(
    workspaceRootPath, workspaceId, campaignId, itemId, input,
  ));
}

/** Caller must hold the Release Kit lock. Used to preserve cross-document lock order. */
export function updateReleaseKitItemUsageWhileLocked(
  workspaceRootPath: string,
  workspaceId: string,
  campaignId: string,
  itemId: string,
  input: UpdateReleaseKitUsageInput,
): ReleaseKitManifest {
  const manifest = loadReleaseKitManifest(workspaceRootPath, workspaceId, campaignId);
  const current = manifest.items.find((item) => item.id === itemId);
  if (!current) throw new Error(`Release Kit item not found: ${itemId}`);
  const now = new Date().toISOString();
  const usage = normalizeReleaseKitUsage({
    ...current.usage,
    ...(input.bestFor !== undefined ? { bestFor: input.bestFor } : {}),
    ...(input.contentRating !== undefined ? { contentRating: input.contentRating } : {}),
    ...(input.notes !== undefined ? { notes: input.notes ?? undefined } : {}),
    ...(input.restrictions !== undefined
      ? { restrictions: { ...current.usage.restrictions, ...input.restrictions } }
      : {}),
    updatedAt: now,
    updatedBy: 'user',
  });
  return saveReleaseKitManifest(workspaceRootPath, {
    ...manifest,
    schemaVersion: 3,
    updatedAt: now,
    items: manifest.items.map((item) => item.id === itemId ? { ...item, usage } : item),
  });
}

export function setReleaseKitPrimary(
  workspaceRootPath: string,
  workspaceId: string,
  campaignId: string,
  itemId: string,
): ReleaseKitManifest {
  return withReleaseKitLock(workspaceRootPath, () => {
    const manifest = loadReleaseKitManifest(workspaceRootPath, workspaceId, campaignId);
    const target = manifest.items.find((item) => item.id === itemId);
    if (!target) throw new Error(`Release Kit item not found: ${itemId}`);
    if (target.status !== 'ready') throw new Error('Only a ready Release Kit item can be Primary.');
    const next: ReleaseKitManifest = {
      ...manifest,
      updatedAt: new Date().toISOString(),
      items: manifest.items.map((item) => ({
        ...item,
        isPrimary: item.category === target.category && item.subtype === target.subtype
          ? item.id === target.id
          : item.isPrimary,
      })),
    };
    return saveReleaseKitManifest(workspaceRootPath, next);
  });
}

export function removeReleaseKitItem(
  workspaceRootPath: string,
  workspaceId: string,
  campaignId: string,
  itemId: string,
  beforeRemove?: (item: ReleaseKitItem) => void,
): RemoveReleaseKitItemResult {
  return withReleaseKitLock(workspaceRootPath, () => {
    const manifest = loadReleaseKitManifest(workspaceRootPath, workspaceId, campaignId);
    const removed = manifest.items.find((item) => item.id === itemId);
    if (!removed) throw new Error(`Release Kit item not found: ${itemId}`);
    beforeRemove?.(removed);
    const absolutePath = resolveReleaseKitItemPath(workspaceRootPath, removed.relativePath);
    const next = saveReleaseKitManifest(workspaceRootPath, {
      ...manifest,
      updatedAt: new Date().toISOString(),
      items: manifest.items.filter((item) => item.id !== itemId),
    });
    rmSync(absolutePath, { force: true });
    return { manifest: next, removed };
  });
}

export function verifyReleaseKit(
  workspaceRootPath: string,
  workspaceId: string,
  campaignId: string,
): ReleaseKitVerificationResult {
  return withReleaseKitLock(workspaceRootPath, () => {
    const manifest = loadReleaseKitManifest(workspaceRootPath, workspaceId, campaignId);
    const changed: ReleaseKitItem[] = [];
    const items = manifest.items.map((item) => {
      let status: ReleaseKitItem['status'] = 'ready';
      let sizeBytes = item.sizeBytes;
      let snapshotMtimeMs = item.snapshotMtimeMs;
      try {
        const path = resolveReleaseKitItemPath(workspaceRootPath, item.relativePath);
        if (!existsSync(path)) {
          status = 'missing';
        } else {
          const info = statSync(path);
          if (!info.isFile()) {
            status = 'missing';
          } else {
            status = hashFileSha256(path) === item.sha256 ? 'ready' : 'needs-review';
            sizeBytes = info.size;
            snapshotMtimeMs = info.mtimeMs;
          }
        }
      } catch {
        status = 'missing';
      }
      const next = {
        ...item,
        status,
        sizeBytes,
        snapshotMtimeMs,
        isPrimary: status === 'ready' && item.isPrimary,
      };
      if (
        next.status === item.status
        && next.sizeBytes === item.sizeBytes
        && next.snapshotMtimeMs === item.snapshotMtimeMs
        && next.isPrimary === item.isPrimary
      ) return item;
      changed.push(next);
      return next;
    });
    const next = changed.length > 0
      ? saveReleaseKitManifest(workspaceRootPath, { ...manifest, updatedAt: new Date().toISOString(), items })
      : manifest;
    return { manifest: next, checked: manifest.items.length, changed };
  });
}

export function verifyReleaseKitItem(
  workspaceRootPath: string,
  workspaceId: string,
  campaignId: string,
  itemId: string,
  options: { persist?: boolean } = {},
): { manifest: ReleaseKitManifest; item: ReleaseKitItem } {
  return withReleaseKitLock(workspaceRootPath, () => {
    const manifest = loadReleaseKitManifest(workspaceRootPath, workspaceId, campaignId);
    const current = manifest.items.find((item) => item.id === itemId);
    if (!current) throw new Error(`Release Kit item not found: ${itemId}`);

    let status: ReleaseKitItem['status'] = 'ready';
    let sizeBytes = current.sizeBytes;
    let snapshotMtimeMs = current.snapshotMtimeMs;
    try {
      const path = resolveReleaseKitItemPath(workspaceRootPath, current.relativePath);
      if (!existsSync(path)) {
        status = 'missing';
      } else {
        const info = statSync(path);
        if (!info.isFile()) {
          status = 'missing';
        } else {
          status = hashFileSha256(path) === current.sha256 ? 'ready' : 'needs-review';
          sizeBytes = info.size;
          snapshotMtimeMs = info.mtimeMs;
        }
      }
    } catch {
      status = 'missing';
    }

    const item: ReleaseKitItem = {
      ...current,
      status,
      sizeBytes,
      snapshotMtimeMs,
      isPrimary: status === 'ready' && current.isPrimary,
    };
    if (
      item.status === current.status
      && item.sizeBytes === current.sizeBytes
      && item.snapshotMtimeMs === current.snapshotMtimeMs
      && item.isPrimary === current.isPrimary
    ) return { manifest, item: current };

    const nextManifest = {
      ...manifest,
      updatedAt: new Date().toISOString(),
      items: manifest.items.map((candidate) => candidate.id === item.id ? item : candidate),
    };
    const next = options.persist ? saveReleaseKitManifest(workspaceRootPath, nextManifest) : nextManifest;
    return { manifest: next, item };
  });
}

export function resolveVerifiedReleaseKitItemPath(
  workspaceRootPath: string,
  workspaceId: string,
  campaignId: string,
  itemId: string,
  expectedSha256: string,
): string {
  const verified = verifyReleaseKitItem(workspaceRootPath, workspaceId, campaignId, itemId);
  if (verified.item.status !== 'ready') {
    throw new Error(`Release Kit item failed integrity verification: ${itemId} (${verified.item.status})`);
  }
  if (verified.item.sha256 !== expectedSha256.toLowerCase()) {
    throw new Error(`Release Kit item checksum does not match the scheduled reference: ${itemId}`);
  }
  return resolveReleaseKitItemPath(workspaceRootPath, verified.item.relativePath);
}

/** Caller must hold the Release Kit lock for the full validation-and-commit transaction. */
export function resolveVerifiedReleaseKitItemPathWhileLocked(
  workspaceRootPath: string,
  workspaceId: string,
  campaignId: string,
  itemId: string,
  expectedSha256: string,
): string {
  const manifest = loadReleaseKitManifest(workspaceRootPath, workspaceId, campaignId);
  const item = manifest.items.find((candidate) => candidate.id === itemId);
  if (!item) throw new Error(`Release Kit item not found: ${itemId}`);
  if (item.status !== 'ready') throw new Error(`Release Kit item is not ready: ${itemId} (${item.status})`);
  if (item.sha256 !== expectedSha256.toLowerCase()) {
    throw new Error(`Release Kit item checksum does not match the scheduled reference: ${itemId}`);
  }
  const path = resolveReleaseKitItemPath(workspaceRootPath, item.relativePath);
  if (!existsSync(path) || !statSync(path).isFile() || hashFileSha256(path) !== item.sha256) {
    throw new Error(`Release Kit item failed integrity verification: ${itemId}`);
  }
  return path;
}

export function resolveReleaseKitItemPath(workspaceRootPath: string, relativePath: string): string {
  const normalized = toManifestPath(relativePath);
  if (!normalized.startsWith(`${RELEASE_KIT_DIR}/`) || normalized.includes('\0')) {
    throw new Error('Release Kit item path is outside release-kit/.');
  }
  if (normalized.split('/').some((part) => part === '' || part === '.' || part === '..')) {
    throw new Error('Release Kit item path is invalid.');
  }
  const root = resolve(getReleaseKitRoot(workspaceRootPath));
  const absolute = resolve(workspaceRootPath, normalized);
  if (absolute !== root && !absolute.startsWith(`${root}${sep}`)) {
    throw new Error('Release Kit item path escapes release-kit/.');
  }
  assertSafeReleaseKitPath(workspaceRootPath, absolute);
  return absolute;
}

export function saveReleaseKitManifest(
  workspaceRootPath: string,
  manifest: ReleaseKitManifest,
): ReleaseKitManifest {
  const normalized: ReleaseKitManifest = { ...manifest, schemaVersion: 3 };
  if (!isReleaseKitManifest(normalized)) throw new Error('Refusing to save an invalid Release Kit manifest.');
  const path = getReleaseKitManifestPath(workspaceRootPath);
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp-${process.pid}-${randomUUID()}`;
  writeFileSync(tempPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  try {
    renameSync(tempPath, path);
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw error;
  }
  return normalized;
}

export function hashFileSha256(path: string): string {
  const hash = createHash('sha256');
  const descriptor = openSync(path, 'r');
  const buffer = Buffer.allocUnsafe(HASH_BUFFER_BYTES);
  try {
    while (true) {
      const bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    closeSync(descriptor);
  }
  return hash.digest('hex');
}

function validateMaterializeInput(input: MaterializeReleaseKitItemInput): void {
  if (!input.workspaceId.trim()) throw new Error('workspaceId is required.');
  if (!input.campaignId.trim()) throw new Error('campaignId is required.');
  if (!RELEASE_KIT_CATEGORIES.has(input.category)) throw new Error(`Unsupported Release Kit category: ${input.category}`);
  if (!input.subtype.trim()) throw new Error('subtype is required.');
  if (!input.sourcePath.trim()) throw new Error('sourcePath is required.');
  normalizeSource(input.source);
}

function normalizeSource(source: ReleaseKitSource): ReleaseKitSource {
  if (source.type === 'upload') {
    const originalFileName = safeSnapshotFileName(source.originalFileName);
    return { type: 'upload', originalFileName };
  }
  if (source.type === 'campaign-asset') {
    if (!source.assetId.trim()) throw new Error('Campaign Asset ID is required.');
    return { type: source.type, assetId: source.assetId.trim() };
  }
  if (source.type === 'vault-asset') {
    if (!source.assetId.trim() || !source.vaultWorkspaceId.trim()) throw new Error('Vault asset and workspace IDs are required.');
    return { type: source.type, assetId: source.assetId.trim(), vaultWorkspaceId: source.vaultWorkspaceId.trim() };
  }
  if (!source.outputId.trim()) throw new Error('Output ID is required.');
  return {
    type: source.type,
    outputId: source.outputId.trim(),
    ...(source.assetId?.trim() ? { assetId: source.assetId.trim() } : {}),
    ...(source.type === 'output' && source.sourceWorkspaceId?.trim() ? { sourceWorkspaceId: source.sourceWorkspaceId.trim() } : {}),
    ...(source.type === 'legacy-final' && source.legacyFinalId?.trim() ? { legacyFinalId: source.legacyFinalId.trim() } : {}),
  };
}

function parseManifest(body: string): ReleaseKitManifest | null {
  try {
    const parsed = JSON.parse(body) as unknown;
    if (!isReleaseKitManifest(parsed)) return null;
    return {
      ...parsed,
      schemaVersion: parsed.schemaVersion,
      items: parsed.items.map((item) => ({
        ...item,
        usage: item.usage ?? defaultReleaseKitUsage(item.promotedAt),
      })),
    };
  } catch {
    return null;
  }
}

function isReleaseKitManifest(value: unknown): value is ReleaseKitManifest {
  if (!isRecord(value) || (value.schemaVersion !== 1 && value.schemaVersion !== 2 && value.schemaVersion !== 3)) return false;
  const schemaVersion = value.schemaVersion;
  if (typeof value.workspaceId !== 'string' || !value.workspaceId) return false;
  if (typeof value.campaignId !== 'string' || !value.campaignId) return false;
  if (typeof value.updatedAt !== 'string' || Number.isNaN(Date.parse(value.updatedAt))) return false;
  return Array.isArray(value.items) && value.items.every((item) => isReleaseKitItem(item, schemaVersion));
}

function isReleaseKitItem(value: unknown, schemaVersion: 1 | 2 | 3): value is ReleaseKitItem {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string' || !value.id.startsWith('kit_')) return false;
  if (typeof value.campaignId !== 'string' || !value.campaignId) return false;
  if (typeof value.category !== 'string' || !RELEASE_KIT_CATEGORIES.has(value.category as ReleaseKitCategory)) return false;
  if (typeof value.subtype !== 'string' || !value.subtype) return false;
  if (typeof value.title !== 'string' || !value.title) return false;
  if (!isReleaseKitSource(value.source)) return false;
  if (typeof value.relativePath !== 'string' || !value.relativePath.startsWith(`${RELEASE_KIT_DIR}/`)) return false;
  if (value.mimeType !== undefined && typeof value.mimeType !== 'string') return false;
  if (value.sizeBytes !== undefined && (typeof value.sizeBytes !== 'number' || value.sizeBytes < 0)) return false;
  if (value.snapshotMtimeMs !== undefined && (typeof value.snapshotMtimeMs !== 'number' || value.snapshotMtimeMs < 0)) return false;
  if (typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256)) return false;
  if (value.status !== 'ready' && value.status !== 'needs-review' && value.status !== 'missing') return false;
  if (typeof value.isPrimary !== 'boolean') return false;
  if (typeof value.promotedAt !== 'string' || Number.isNaN(Date.parse(value.promotedAt))) return false;
  if (value.promotedBy !== 'user' && value.promotedBy !== 'agent' && value.promotedBy !== 'migration') return false;
  if (value.note !== undefined && typeof value.note !== 'string') return false;
  if (value.trackIntelligence !== undefined && !isReviewedTrackIntelligenceRevision(value.trackIntelligence)) return false;
  return schemaVersion === 1 ? value.usage === undefined : isReleaseKitUsage(value.usage);
}

function isReviewedTrackIntelligenceRevision(value: unknown): boolean {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id) return false;
  if (!isRecord(value.provenance)) return false;
  if (typeof value.reviewedAt !== 'string' || Number.isNaN(Date.parse(value.reviewedAt))) return false;
  if (!isRecord(value.reviewedBy) || value.reviewedBy.type !== 'user' || typeof value.reviewedBy.clientId !== 'string') return false;
  if (value.lyrics !== undefined) {
    if (!isRecord(value.lyrics) || !Array.isArray(value.lyrics.lines)) return false;
    if (value.lyrics.lines.some((line) => !isRecord(line) || typeof line.id !== 'string' || typeof line.text !== 'string')) return false;
  }
  return true;
}

function normalizeReleaseKitUsage(value: ReleaseKitUsageMetadata): ReleaseKitUsageMetadata {
  if (!isReleaseKitUsage(value)) throw new Error('Release Kit usage metadata is invalid.');
  const notes = value.notes?.trim();
  if (notes && notes.length > 1_000) throw new Error('Release Kit usage notes must be 1000 characters or fewer.');
  const { notes: _notes, ...rest } = value;
  return {
    ...rest,
    bestFor: [...new Set(value.bestFor)],
    ...(notes ? { notes } : {}),
  };
}

function isReleaseKitUsage(value: unknown): value is ReleaseKitUsageMetadata {
  if (!isRecord(value)) return false;
  if (!Array.isArray(value.bestFor) || value.bestFor.some((entry) => typeof entry !== 'string' || !RELEASE_KIT_USE_CASES.has(entry as ReleaseKitUseCase))) return false;
  if (value.contentRating !== 'clean' && value.contentRating !== 'explicit' && value.contentRating !== 'unknown') return false;
  if (value.notes !== undefined && (typeof value.notes !== 'string' || value.notes.length > 1_000)) return false;
  if (!isRecord(value.restrictions)
    || typeof value.restrictions.blockedFromUse !== 'boolean'
    || typeof value.restrictions.needsRightsClearance !== 'boolean'
    || typeof value.restrictions.artistLikenessRestricted !== 'boolean') return false;
  if (typeof value.updatedAt !== 'string' || Number.isNaN(Date.parse(value.updatedAt))) return false;
  if (value.updatedBy !== 'user' && value.updatedBy !== 'system' && value.updatedBy !== 'migration') return false;
  if (value.technical !== undefined && !isReleaseKitTechnical(value.technical)) return false;
  return true;
}

function isReleaseKitTechnical(value: unknown): boolean {
  if (!isRecord(value)) return false;
  for (const key of ['width', 'height', 'durationSeconds'] as const) {
    const entry = value[key];
    if (entry !== undefined && (typeof entry !== 'number' || !Number.isFinite(entry) || entry < 0)) return false;
  }
  if (value.aspectRatio !== undefined && (typeof value.aspectRatio !== 'string' || value.aspectRatio.length > 40)) return false;
  return value.orientation === undefined
    || value.orientation === 'portrait'
    || value.orientation === 'landscape'
    || value.orientation === 'square'
    || value.orientation === 'unknown';
}

function isReleaseKitSource(value: unknown): value is ReleaseKitSource {
  if (!isRecord(value) || typeof value.type !== 'string') return false;
  if (value.type === 'upload') return typeof value.originalFileName === 'string' && Boolean(value.originalFileName);
  if (value.type === 'campaign-asset') return typeof value.assetId === 'string' && Boolean(value.assetId);
  if (value.type === 'vault-asset') {
    return typeof value.assetId === 'string' && Boolean(value.assetId)
      && typeof value.vaultWorkspaceId === 'string' && Boolean(value.vaultWorkspaceId);
  }
  if (value.type === 'output' || value.type === 'legacy-final') {
    return typeof value.outputId === 'string' && Boolean(value.outputId)
      && (value.assetId === undefined || typeof value.assetId === 'string')
      && (value.type !== 'output' || value.sourceWorkspaceId === undefined || typeof value.sourceWorkspaceId === 'string')
      && (value.type !== 'legacy-final' || value.legacyFinalId === undefined || typeof value.legacyFinalId === 'string');
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeSubtype(value: string): string {
  const normalized = value.trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  if (!normalized) throw new Error('subtype must contain letters or numbers.');
  return normalized;
}

function normalizeTitle(value: string | undefined, fallbackFileName: string): string {
  return value?.trim().slice(0, 180) || fallbackFileName.slice(0, 180);
}

function safeSnapshotFileName(fileName: string): string {
  const extension = extname(fileName).slice(0, 24);
  const rawStem = basename(fileName, extension)
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/[. ]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);
  const stem = !rawStem || WINDOWS_RESERVED_NAMES.test(rawStem) ? `asset-${randomUUID().slice(0, 8)}` : rawStem;
  const safeExtension = extension.replace(/[^.a-zA-Z0-9]/g, '').slice(0, 24);
  return `${stem}${safeExtension}`;
}

function nextAvailableSnapshotPath(
  workspaceRootPath: string,
  category: ReleaseKitCategory,
  subtype: string,
  fileName: string,
): string {
  const directory = join(getReleaseKitRoot(workspaceRootPath), category, subtype);
  const extension = extname(fileName);
  const stem = basename(fileName, extension);
  let candidate = join(directory, fileName);
  let suffix = 2;
  const existingNames = existsSync(directory)
    ? new Set(readdirSync(directory).map((name) => name.normalize('NFKC').toLocaleLowerCase('en-US')))
    : new Set<string>();
  while (existsSync(candidate) || existingNames.has(basename(candidate).normalize('NFKC').toLocaleLowerCase('en-US'))) {
    candidate = join(directory, `${stem}-${suffix}${extension}`);
    suffix += 1;
  }
  return candidate;
}

function assertSafeReleaseKitPath(
  workspaceRootPath: string,
  candidatePath: string,
): void {
  const releaseRoot = resolve(getReleaseKitRoot(workspaceRootPath));
  if (existsSync(releaseRoot) && lstatSync(releaseRoot).isSymbolicLink()) {
    throw new Error('Release Kit root cannot be a symbolic link.');
  }
  mkdirSync(releaseRoot, { recursive: true });
  const realRoot = realpathSync(releaseRoot);
  const candidate = resolve(candidatePath);
  if (candidate !== releaseRoot && !candidate.startsWith(`${releaseRoot}${sep}`)) {
    throw new Error('Release Kit path escapes release-kit/.');
  }

  const pathParts = relative(releaseRoot, candidate).split(sep).filter(Boolean);
  let current = releaseRoot;
  for (let index = 0; index < pathParts.length; index += 1) {
    current = join(current, pathParts[index]!);
    if (!existsSync(current)) continue;
    if (lstatSync(current).isSymbolicLink()) {
      throw new Error('Release Kit paths cannot contain symbolic links.');
    }
    const realCurrent = realpathSync(current);
    if (realCurrent !== realRoot && !realCurrent.startsWith(`${realRoot}${sep}`)) {
      throw new Error('Release Kit path escapes release-kit/.');
    }
  }
}

function toManifestPath(path: string): string {
  return path.replace(/\\/g, '/');
}

function lockDir(workspaceRootPath: string): string {
  return join(workspaceRootPath, 'context', '.locks', 'release-kit.lock');
}

function withReleaseKitLock<T>(workspaceRootPath: string, fn: () => T): T {
  if (releaseKitLockContext.getStore()) throw new Error('Release Kit lock cannot be re-entered by its current owner.');
  const path = lockDir(workspaceRootPath);
  const ownerPath = join(path, 'owner.json');
  const owner = { token: randomUUID(), pid: process.pid, hostname: hostname(), createdAt: new Date().toISOString() };
  mkdirSync(dirname(path), { recursive: true });
  const deadline = Date.now() + RELEASE_KIT_LOCK_TIMEOUT_MS;
  while (true) {
    try {
      mkdirSync(path, { recursive: false });
      try {
        writeFileSync(ownerPath, JSON.stringify(owner), { encoding: 'utf8', flag: 'wx' });
      } catch (error) {
        rmSync(path, { recursive: true, force: true });
        throw error;
      }
      break;
    } catch (error) {
      if (!isNodeError(error) || error.code !== 'EEXIST') throw error;
      let liveOwner: { pid: number; hostname: string } | undefined;
      try {
        if (releaseKitLockIsAbandoned(path)) {
          rmSync(path, { recursive: true, force: true });
          continue;
        }
        liveOwner = releaseKitLiveOwner(path);
      } catch {
        // The lock changed while being inspected. Retry until the deadline.
      }
      if (liveOwner) {
        if (liveOwner.pid === process.pid) throw new Error('Release Kit is busy with another operation in this process.');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
        continue;
      }
      if (Date.now() >= deadline) throw new Error('Timed out waiting for Release Kit lock.');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
  try {
    return fn();
  } finally {
    try {
      const current = JSON.parse(readFileSync(ownerPath, 'utf8')) as { token?: string };
      if (current.token === owner.token) rmSync(path, { recursive: true, force: true });
    } catch {
      // Never remove a lock whose ownership cannot be proven.
    }
  }
}

export async function withReleaseKitLockAsync<T>(workspaceRootPath: string, fn: () => Promise<T>): Promise<T> {
  if (releaseKitLockContext.getStore()) throw new Error('Release Kit lock cannot be re-entered by its current owner.');
  const path = lockDir(workspaceRootPath);
  const ownerPath = join(path, 'owner.json');
  const owner = { token: randomUUID(), pid: process.pid, hostname: hostname(), createdAt: new Date().toISOString() };
  mkdirSync(dirname(path), { recursive: true });
  const deadline = Date.now() + RELEASE_KIT_LOCK_TIMEOUT_MS;
  while (true) {
    try {
      mkdirSync(path, { recursive: false });
      try {
        writeFileSync(ownerPath, JSON.stringify(owner), { encoding: 'utf8', flag: 'wx' });
      } catch (error) {
        rmSync(path, { recursive: true, force: true });
        throw error;
      }
      break;
    } catch (error) {
      if (!isNodeError(error) || error.code !== 'EEXIST') throw error;
      let liveOwner: { pid: number; hostname: string } | undefined;
      try {
        if (releaseKitLockIsAbandoned(path)) {
          rmSync(path, { recursive: true, force: true });
          continue;
        }
        liveOwner = releaseKitLiveOwner(path);
      } catch {
        // The lock changed while being inspected. Retry until the deadline.
      }
      if (liveOwner) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
        continue;
      }
      if (Date.now() >= deadline) throw new Error('Timed out waiting for Release Kit lock.');
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
    }
  }
  try {
    return await releaseKitLockContext.run(owner.token, fn);
  } finally {
    try {
      const current = JSON.parse(readFileSync(ownerPath, 'utf8')) as { token?: string };
      if (current.token === owner.token) rmSync(path, { recursive: true, force: true });
    } catch {
      // Never remove a lock whose ownership cannot be proven.
    }
  }
}

function releaseKitLockIsAbandoned(path: string): boolean {
  try {
    const owner = JSON.parse(readFileSync(join(path, 'owner.json'), 'utf8')) as { pid?: number; hostname?: string };
    if (owner.hostname !== hostname() || !Number.isInteger(owner.pid) || (owner.pid ?? 0) <= 0) return false;
    try {
      process.kill(owner.pid!, 0);
      return false;
    } catch (error) {
      return isNodeError(error) && error.code === 'ESRCH';
    }
  } catch {
    try {
      return Date.now() - statSync(path).mtimeMs > RELEASE_KIT_ORPHAN_LOCK_STALE_MS;
    } catch {
      return false;
    }
  }
}

function releaseKitLiveOwner(path: string): { pid: number; hostname: string } | undefined {
  try {
    const owner = JSON.parse(readFileSync(join(path, 'owner.json'), 'utf8')) as { pid?: number; hostname?: string };
    if (owner.hostname !== hostname() || !Number.isInteger(owner.pid) || (owner.pid ?? 0) <= 0) return undefined;
    process.kill(owner.pid!, 0);
    return { pid: owner.pid!, hostname: owner.hostname };
  } catch {
    return undefined;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
