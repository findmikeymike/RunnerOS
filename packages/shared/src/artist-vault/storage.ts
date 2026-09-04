import { createHash, randomUUID } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import {
  access as accessAsync,
  copyFile as copyFileAsync,
  mkdir as mkdirAsync,
  readdir as readdirAsync,
  readFile as readFileAsync,
  rename as renameAsync,
  rm as rmAsync,
  stat as statAsync,
  writeFile as writeFileAsync,
} from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import {
  categoryForKind,
  classifyVaultAsset,
  defaultVaultPolicy,
  displayVaultKind,
  inferVaultMimeType,
  vaultRelativePath,
} from './classify.ts';
import {
  ARTIST_VAULT_DIR,
  ARTIST_VAULT_MANIFEST_FILE,
  type VaultAssetKind,
  type VaultAssetImportCandidate,
  type VaultAssetImportOptions,
  type VaultAssetImportResult,
  type VaultAssetRecord,
  type VaultAssetSource,
  type VaultAssetStatus,
  type VaultAssetUpdatePatch,
  type TrackIntelligence,
  type TrackIntelligenceReviewInput,
  type TrackLyricLine,
  type VaultFolderLinkResult,
  type VaultAssetScanResult,
  type VaultManifest,
  type VaultRightsStatus,
  type VaultStorageMode,
} from './types.ts';
import { normalizeTrackCharacter } from './track-intelligence.ts';
import { hashFileSha256 } from '../utils/hash-file.ts';

const DEFAULT_DIRECTORIES = [
  'music/masters-finals',
  'music/demos',
  'music/stems',
  'music/beats-instrumentals',
  'music/mix-references',
  'music/lyrics-notes',
  'video/final-videos',
  'video/raw-footage',
  'video/content-clips',
  'video/b-roll',
  'video/live-performance',
  'video/project-files',
  'visuals/cover-art',
  'visuals/artist-photos',
  'visuals/face-references',
  'visuals/logos-marks',
  'visuals/brand-assets',
  'visuals/posters-flyers',
  'visuals/merch-designs',
  'campaigns/release-assets',
  'campaigns/ads',
  'campaigns/press',
  'campaigns/social-packs',
  'business/contracts',
  'business/splits',
  'business/rights-and-royalties/catalog',
  'business/rights-and-royalties/registration-evidence',
  'business/rights-and-royalties/filing-packets',
  'business/legal/reviews',
  'business/legal/negotiation-packets',
  'business/invoices',
  'business/one-sheets',
  'business/epk',
  'references/moodboards',
  'references/inspiration',
  'references/similar-artists',
  'references/swipe-files',
];
const MAX_INLINE_HASH_BYTES = 256 * 1024 * 1024;
const VAULT_CATEGORIES = new Set(['music', 'video', 'visuals', 'campaigns', 'business', 'references']);
const VAULT_KINDS = new Set<VaultAssetKind>([
  'master-final',
  'demo',
  'stem',
  'beat-instrumental',
  'mix-reference',
  'lyrics-note',
  'final-video',
  'raw-footage',
  'content-clip',
  'b-roll',
  'live-performance',
  'video-project',
  'cover-art',
  'artist-photo',
  'face-reference',
  'logo-mark',
  'brand-asset',
  'poster-flyer',
  'merch-design',
  'release-asset',
  'ad-asset',
  'press-asset',
  'social-pack',
  'contract',
  'split-sheet',
  'rights-record',
  'invoice',
  'one-sheet',
  'epk',
  'moodboard',
  'inspiration',
  'similar-artist-reference',
  'swipe-file',
  'other',
]);
const VAULT_STATUSES = new Set<VaultAssetStatus>(['draft', 'review', 'approved', 'final', 'archived', 'missing']);
const VAULT_RIGHTS_STATUSES = new Set<VaultRightsStatus>(['safe-to-use', 'needs-clearance', 'private', 'unknown']);
const VAULT_SOURCES = new Set<VaultAssetSource>(['copy', 'linked-file', 'linked-folder', 'agent-output', 'manual']);
const VAULT_STORAGE_MODES = new Set<VaultStorageMode>(['copied', 'linked', 'mixed']);

export function getArtistVaultRoot(workspaceRootPath: string): string {
  return join(workspaceRootPath, ARTIST_VAULT_DIR);
}

export function getArtistVaultManifestPath(workspaceRootPath: string): string {
  return join(getArtistVaultRoot(workspaceRootPath), ARTIST_VAULT_MANIFEST_FILE);
}

export function ensureArtistVaultFolders(workspaceRootPath: string): void {
  const root = getArtistVaultRoot(workspaceRootPath);
  mkdirSync(root, { recursive: true });
  for (const dir of DEFAULT_DIRECTORIES) {
    mkdirSync(join(root, dir), { recursive: true });
  }
}

export async function ensureArtistVaultFoldersAsync(workspaceRootPath: string): Promise<void> {
  const root = getArtistVaultRoot(workspaceRootPath);
  await mkdirAsync(root, { recursive: true });
  await Promise.all(DEFAULT_DIRECTORIES.map((dir) => mkdirAsync(join(root, dir), { recursive: true })));
}

export function isSafeVaultRelativePath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/');
  if (!normalized.startsWith(`${ARTIST_VAULT_DIR}/`)) return false;
  if (normalized.includes('\0')) return false;
  if (normalized.startsWith('/') || normalized.includes('//')) return false;
  return !normalized.split('/').some((part) => part === '..' || part === '');
}

export function loadArtistVaultManifest(workspaceRootPath: string, workspaceId = 'workspace'): VaultManifest {
  const file = getArtistVaultManifestPath(workspaceRootPath);
  if (!existsSync(file)) return emptyArtistVaultManifest(workspaceId);
  const result = readManifestFile(file);
  return result.manifest ?? emptyArtistVaultManifest(workspaceId);
}

function loadArtistVaultManifestForImport(workspaceRootPath: string, workspaceId: string): VaultManifest {
  const file = getArtistVaultManifestPath(workspaceRootPath);
  if (!existsSync(file)) return emptyArtistVaultManifest(workspaceId);
  const result = readManifestFile(file);
  if (result.manifest) return result.manifest;
  const backup = backupInvalidManifest(file);
  throw new Error(`Artist Vault manifest is invalid (${result.reason}). Backup saved to ${backup}. Fix or remove manifest before importing.`);
}

async function loadArtistVaultManifestForImportAsync(workspaceRootPath: string, workspaceId: string): Promise<VaultManifest> {
  const file = getArtistVaultManifestPath(workspaceRootPath);
  if (!(await pathExists(file))) return emptyArtistVaultManifest(workspaceId);
  const result = await readManifestFileAsync(file);
  if (result.manifest) return result.manifest;
  const backup = await backupInvalidManifestAsync(file);
  throw new Error(`Artist Vault manifest is invalid (${result.reason}). Backup saved to ${backup}. Fix or remove manifest before importing.`);
}

function readManifestFile(file: string): { manifest?: VaultManifest; reason: string } {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as VaultManifest;
    if (!isVaultManifest(parsed)) return { reason: 'schema mismatch' };
    return { manifest: parsed, reason: 'ok' };
  } catch (err) {
    return { reason: err instanceof Error ? err.message : 'parse failed' };
  }
}

async function readManifestFileAsync(file: string): Promise<{ manifest?: VaultManifest; reason: string }> {
  try {
    const parsed = JSON.parse(await readFileAsync(file, 'utf-8')) as VaultManifest;
    if (!isVaultManifest(parsed)) return { reason: 'schema mismatch' };
    return { manifest: parsed, reason: 'ok' };
  } catch (err) {
    return { reason: err instanceof Error ? err.message : 'parse failed' };
  }
}

export function saveArtistVaultManifest(workspaceRootPath: string, manifest: VaultManifest): VaultManifest {
  ensureArtistVaultFolders(workspaceRootPath);
  const file = getArtistVaultManifestPath(workspaceRootPath);
  atomicWriteJson(file, manifest);
  return manifest;
}

export async function saveArtistVaultManifestAsync(workspaceRootPath: string, manifest: VaultManifest): Promise<VaultManifest> {
  await ensureArtistVaultFoldersAsync(workspaceRootPath);
  const file = getArtistVaultManifestPath(workspaceRootPath);
  await atomicWriteJsonAsync(file, manifest);
  return manifest;
}

export function updateArtistVaultAsset(
  workspaceRootPath: string,
  workspaceId: string,
  assetId: string,
  patch: VaultAssetUpdatePatch,
): VaultManifest {
  if (!assetId.trim()) throw new Error('Asset id is required');
  const manifest = loadArtistVaultManifestForImport(workspaceRootPath, workspaceId);
  const asset = manifest.assets.find((candidate) => candidate.id === assetId);
  if (!asset) throw new Error(`Vault asset not found: ${assetId}`);

  if (patch.kind !== undefined) {
    asset.kind = patch.kind;
    asset.category = categoryForKind(patch.kind);
  }
  if (patch.label !== undefined) asset.label = patch.label.trim() || displayVaultKind(asset.kind);
  if (patch.status !== undefined) asset.status = patch.status;
  if (patch.rightsStatus !== undefined) asset.rightsStatus = patch.rightsStatus;
  if (patch.usableByAgents !== undefined) asset.usableByAgents = patch.usableByAgents;
  if (patch.campaigns !== undefined) setOptionalStringList(asset, 'campaigns', patch.campaigns);
  if (patch.tags !== undefined) setOptionalStringList(asset, 'tags', patch.tags);
  if (patch.genre !== undefined) setOptionalStringList(asset, 'genre', patch.genre);
  if (patch.moods !== undefined) setOptionalStringList(asset, 'moods', patch.moods);
  if (patch.bpm !== undefined) {
    if (patch.bpm === null || !Number.isFinite(patch.bpm) || patch.bpm <= 0) {
      delete asset.bpm;
    } else {
      asset.bpm = Math.round(patch.bpm);
    }
  }
  if (patch.similarSongs !== undefined) setOptionalStringList(asset, 'similarSongs', patch.similarSongs);
  if (patch.notes !== undefined) asset.notes = patch.notes;

  asset.updatedAt = new Date().toISOString();
  manifest.workspaceId = workspaceId;
  manifest.updatedAt = asset.updatedAt;
  return saveArtistVaultManifest(workspaceRootPath, manifest);
}

export function resolveArtistVaultAssetPath(
  workspaceRootPath: string,
  asset: Pick<VaultAssetRecord, 'relativePath' | 'absolutePath'>,
): string | null {
  if (asset.relativePath) {
    if (!isSafeVaultRelativePath(asset.relativePath)) return null;
    return resolve(workspaceRootPath, asset.relativePath);
  }
  return asset.absolutePath && !asset.absolutePath.includes('\0') ? asset.absolutePath : null;
}

export function hashArtistVaultAssetFileSha256(workspaceRootPath: string, asset: VaultAssetRecord): string {
  const path = resolveArtistVaultAssetPath(workspaceRootPath, asset);
  if (!path || !existsSync(path) || !statSync(path).isFile()) throw new Error('The track audio file is missing.');
  return hashFileSha256(path);
}

export function saveArtistVaultTrackDraft(
  workspaceRootPath: string,
  workspaceId: string,
  assetId: string,
  intelligence: TrackIntelligence,
): VaultManifest {
  const manifest = loadArtistVaultManifestForImport(workspaceRootPath, workspaceId);
  const asset = requireTrackAsset(manifest, assetId);
  asset.trackIntelligence = {
    schemaVersion: 1,
    status: intelligence.status,
    approved: asset.trackIntelligence?.approved,
    draft: intelligence.status === 'draft' ? intelligence.draft : undefined,
    failureReason: intelligence.failureReason,
  };
  asset.updatedAt = new Date().toISOString();
  manifest.updatedAt = asset.updatedAt;
  return saveArtistVaultManifest(workspaceRootPath, manifest);
}

export function reviewArtistVaultTrackIntelligence(
  workspaceRootPath: string,
  workspaceId: string,
  input: TrackIntelligenceReviewInput,
  clientId: string,
): VaultManifest {
  const manifest = loadArtistVaultManifestForImport(workspaceRootPath, workspaceId);
  const asset = requireTrackAsset(manifest, input.assetId);
  const existing = asset.trackIntelligence;
  const draft = existing?.draft ?? existing?.approved;
  if (!draft || draft.id !== input.draftId) throw new Error('This track analysis draft is stale. Reopen the current track package before saving.');
  const currentSourceSha256 = hashArtistVaultAssetFileSha256(workspaceRootPath, asset);
  if (!draft.provenance.sourceSha256) {
    throw new Error('This older track draft is not bound to the audio file. Re-run transcription before approving lyrics.');
  }
  if (draft.provenance.sourceSha256 !== currentSourceSha256) {
    throw new Error('The audio changed after analysis. Re-run transcription before approving lyrics.');
  }
  const now = new Date().toISOString();
  const character = normalizeTrackCharacter(input.character ?? draft.character ?? existing?.approved?.character);
  const lines = normalizeReviewedLyricLines(input.lyrics.lines, draft.lyrics?.lines);

  asset.trackIntelligence = {
    status: 'reviewed',
    schemaVersion: 1,
    approved: {
      ...draft,
      lyrics: {
        lines,
        language: input.lyrics.language?.trim() || draft.lyrics?.language,
        timingSource: input.lyrics.timingSource,
        timingStatus: input.lyrics.timingStatus,
        artistSuppliedText: input.lyrics.artistSuppliedText,
      },
      character,
      reviewedAt: now,
      reviewedBy: { type: 'user', clientId },
    },
  };
  setOptionalStringList(asset, 'genre', character?.genre ?? []);
  setOptionalStringList(asset, 'moods', character?.moods ?? []);
  if (character?.tempoBpm) asset.bpm = character.tempoBpm;
  else delete asset.bpm;
  asset.updatedAt = now;
  manifest.updatedAt = now;
  return saveArtistVaultManifest(workspaceRootPath, manifest);
}

function requireTrackAsset(manifest: VaultManifest, assetId: string): VaultAssetRecord {
  const asset = manifest.assets.find((candidate) => candidate.id === assetId);
  if (!asset) throw new Error(`Vault asset not found: ${assetId}`);
  if (!['master-final', 'demo', 'beat-instrumental', 'mix-reference'].includes(asset.kind)) {
    throw new Error('Track Intelligence is available for audio tracks only.');
  }
  return asset;
}

function normalizeReviewedLyricLines(
  lines: TrackLyricLine[],
  existing: TrackLyricLine[] | undefined,
): TrackLyricLine[] {
  return lines.map((line, index) => {
    const startMs = typeof line.startMs === 'number' && Number.isFinite(line.startMs) ? Math.max(0, Math.round(line.startMs)) : undefined;
    const endMs = typeof line.endMs === 'number' && Number.isFinite(line.endMs) && startMs !== undefined ? Math.max(startMs, Math.round(line.endMs)) : undefined;
    const prior = existing?.find((candidate) => candidate.id === line.id) ?? existing?.[index];
    const text = line.text.trim();
    const corrected = Boolean(line.corrected || (prior && prior.text !== text));
    return {
      id: line.id.trim() || `line-${index + 1}`,
      text,
      startMs,
      endMs,
      words: corrected ? undefined : line.words,
      corrected,
      section: normalizeTrackLyricSection(line.section),
    };
  });
}

function normalizeTrackLyricSection(value: TrackLyricLine['section']): TrackLyricLine['section'] {
  return value && ['verse', 'pre-chorus', 'chorus', 'hook', 'bridge', 'outro'].includes(value)
    ? value
    : undefined;
}

export function planArtistVaultImports(
  workspaceRootPath: string,
  filePaths: string[],
  options: VaultAssetImportOptions = {},
): { candidates: VaultAssetImportCandidate[]; skipped: Array<{ path: string; reason: string }> } {
  const candidates: VaultAssetImportCandidate[] = [];
  const skipped: Array<{ path: string; reason: string }> = [];
  const plannedDestinations = new Set<string>();

  for (const sourcePath of filePaths) {
    try {
      if (!sourcePath || sourcePath.includes('\0')) {
        skipped.push({ path: sourcePath, reason: 'Invalid path' });
        continue;
      }
      const info = statSync(sourcePath);
      if (!info.isFile()) {
        skipped.push({ path: sourcePath, reason: 'Only files can be imported' });
        continue;
      }
      const classification = classifyVaultAsset(sourcePath, options.kindHint ?? 'any');
      const destinationRelativePath = uniqueDestinationRelativePath(
        workspaceRootPath,
        classification.directory,
        basename(sourcePath),
        plannedDestinations,
      );
      const policy = defaultVaultPolicy(classification.kind);
      plannedDestinations.add(destinationRelativePath);
      candidates.push({
        sourcePath,
        fileName: basename(sourcePath),
        category: classification.category,
        kind: classification.kind,
        destinationRelativePath,
        confidence: classification.confidence,
        reason: classification.reason,
        sizeBytes: info.size,
        mimeType: inferVaultMimeType(sourcePath),
        defaultStatus: policy.status,
        defaultRightsStatus: policy.rightsStatus,
        defaultUsableByAgents: policy.usableByAgents,
      });
    } catch (err) {
      skipped.push({ path: sourcePath, reason: err instanceof Error ? err.message : 'Unable to inspect file' });
    }
  }

  return { candidates, skipped };
}

export async function planArtistVaultImportsAsync(
  workspaceRootPath: string,
  filePaths: string[],
  options: VaultAssetImportOptions = {},
): Promise<{ candidates: VaultAssetImportCandidate[]; skipped: Array<{ path: string; reason: string }> }> {
  const candidates: VaultAssetImportCandidate[] = [];
  const skipped: Array<{ path: string; reason: string }> = [];
  const plannedDestinations = new Set<string>();

  for (const sourcePath of filePaths) {
    try {
      if (!sourcePath || sourcePath.includes('\0')) {
        skipped.push({ path: sourcePath, reason: 'Invalid path' });
        continue;
      }
      const info = await statAsync(sourcePath);
      if (!info.isFile()) {
        skipped.push({ path: sourcePath, reason: 'Only files can be imported' });
        continue;
      }
      const classification = classifyVaultAsset(sourcePath, options.kindHint ?? 'any');
      const destinationRelativePath = await uniqueDestinationRelativePathAsync(
        workspaceRootPath,
        classification.directory,
        basename(sourcePath),
        plannedDestinations,
      );
      const policy = defaultVaultPolicy(classification.kind);
      plannedDestinations.add(destinationRelativePath);
      candidates.push({
        sourcePath,
        fileName: basename(sourcePath),
        category: classification.category,
        kind: classification.kind,
        destinationRelativePath,
        confidence: classification.confidence,
        reason: classification.reason,
        sizeBytes: info.size,
        mimeType: inferVaultMimeType(sourcePath),
        defaultStatus: policy.status,
        defaultRightsStatus: policy.rightsStatus,
        defaultUsableByAgents: policy.usableByAgents,
      });
    } catch (err) {
      skipped.push({ path: sourcePath, reason: err instanceof Error ? err.message : 'Unable to inspect file' });
    }
  }

  return { candidates, skipped };
}

export function importArtistVaultAssets(
  workspaceRootPath: string,
  workspaceId: string,
  filePaths: string[],
  options: VaultAssetImportOptions = {},
): VaultAssetImportResult {
  ensureArtistVaultFolders(workspaceRootPath);
  const manifest = loadArtistVaultManifestForImport(workspaceRootPath, workspaceId);
  const plan = planArtistVaultImports(workspaceRootPath, filePaths, options);
  const imported: VaultAssetRecord[] = [];
  const skipped = [...plan.skipped];
  const now = new Date().toISOString();

  for (const candidate of plan.candidates) {
    try {
      const destination = resolve(workspaceRootPath, candidate.destinationRelativePath);
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(candidate.sourcePath, destination);
      const { sizeBytes, sha256 } = sizeAndHash(destination);
      const record: VaultAssetRecord = {
        id: `vault_asset_${randomUUID()}`,
        category: candidate.category,
        kind: candidate.kind,
        label: displayVaultKind(candidate.kind),
        relativePath: candidate.destinationRelativePath,
        mimeType: candidate.mimeType ?? inferVaultMimeType(candidate.fileName),
        sizeBytes,
        sha256,
        source: 'copy',
        status: candidate.defaultStatus,
        rightsStatus: candidate.defaultRightsStatus,
        usableByAgents: candidate.defaultUsableByAgents,
        notes: candidate.reason,
        createdAt: now,
        updatedAt: now,
      };
      imported.push(record);
      manifest.assets.push(record);
    } catch (err) {
      skipped.push({
        path: candidate.sourcePath,
        reason: err instanceof Error ? err.message : 'Failed to copy file',
      });
    }
  }

  manifest.workspaceId = workspaceId;
  manifest.vaultRoot = ARTIST_VAULT_DIR;
  manifest.storageMode = 'copied';
  manifest.updatedAt = new Date().toISOString();
  saveArtistVaultManifest(workspaceRootPath, manifest);
  return { manifest, imported, skipped };
}

export async function importArtistVaultAssetsAsync(
  workspaceRootPath: string,
  workspaceId: string,
  filePaths: string[],
  options: VaultAssetImportOptions = {},
): Promise<VaultAssetImportResult> {
  await ensureArtistVaultFoldersAsync(workspaceRootPath);
  const manifest = await loadArtistVaultManifestForImportAsync(workspaceRootPath, workspaceId);
  const plan = await planArtistVaultImportsAsync(workspaceRootPath, filePaths, options);
  const imported: VaultAssetRecord[] = [];
  const skipped = [...plan.skipped];
  const now = new Date().toISOString();

  for (const candidate of plan.candidates) {
    try {
      const destination = resolve(workspaceRootPath, candidate.destinationRelativePath);
      await mkdirAsync(dirname(destination), { recursive: true });
      await copyFileAsync(candidate.sourcePath, destination);
      const { sizeBytes, sha256 } = await sizeAndHashAsync(destination);
      const record: VaultAssetRecord = {
        id: `vault_asset_${randomUUID()}`,
        category: candidate.category,
        kind: candidate.kind,
        label: displayVaultKind(candidate.kind),
        relativePath: candidate.destinationRelativePath,
        mimeType: candidate.mimeType ?? inferVaultMimeType(candidate.fileName),
        sizeBytes,
        sha256,
        source: 'copy',
        status: candidate.defaultStatus,
        rightsStatus: candidate.defaultRightsStatus,
        usableByAgents: candidate.defaultUsableByAgents,
        notes: candidate.reason,
        createdAt: now,
        updatedAt: now,
      };
      imported.push(record);
      manifest.assets.push(record);
    } catch (err) {
      skipped.push({
        path: candidate.sourcePath,
        reason: err instanceof Error ? err.message : 'Failed to copy file',
      });
    }
  }

  manifest.workspaceId = workspaceId;
  manifest.vaultRoot = ARTIST_VAULT_DIR;
  manifest.storageMode = 'copied';
  manifest.updatedAt = new Date().toISOString();
  await saveArtistVaultManifestAsync(workspaceRootPath, manifest);
  return { manifest, imported, skipped };
}

export function scanArtistVault(
  workspaceRootPath: string,
  workspaceId: string,
): VaultAssetScanResult {
  ensureArtistVaultFolders(workspaceRootPath);
  const manifest = loadArtistVaultManifestForImport(workspaceRootPath, workspaceId);
  const vaultRoot = getArtistVaultRoot(workspaceRootPath);
  const trackedPaths = trackedManifestPaths(manifest);
  const added: VaultAssetRecord[] = [];
  const skipped: Array<{ path: string; reason: string }> = [];
  const now = new Date().toISOString();

  for (const absolutePath of listVaultFiles(vaultRoot)) {
    const relativePath = toWorkspaceRelativePath(workspaceRootPath, absolutePath);
    if (shouldSkipVaultFile(relativePath)) continue;
    if (trackedPaths.has(relativePath)) continue;

    try {
      const classification = classifyVaultAsset(absolutePath);
      const folderKind = kindFromRelativePath(relativePath);
      const kind = folderKind ?? classification.kind;
      const policy = defaultVaultPolicy(kind);
      const { sizeBytes, sha256 } = sizeAndHash(absolutePath);
      const record: VaultAssetRecord = {
        id: `vault_asset_${randomUUID()}`,
        category: categoryForKind(kind),
        kind,
        label: displayVaultKind(kind),
        relativePath,
        mimeType: inferVaultMimeType(absolutePath),
        sizeBytes,
        sha256,
        source: 'manual',
        status: policy.status,
        rightsStatus: policy.rightsStatus,
        usableByAgents: policy.usableByAgents,
        notes: 'Indexed from Vault folder scan',
        createdAt: now,
        updatedAt: now,
      };
      added.push(record);
      manifest.assets.push(record);
      trackedPaths.add(relativePath);
    } catch (err) {
      skipped.push({ path: relativePath, reason: err instanceof Error ? err.message : 'Unable to index file' });
    }
  }

  manifest.workspaceId = workspaceId;
  manifest.vaultRoot = ARTIST_VAULT_DIR;
  manifest.storageMode = manifest.storageMode === 'linked' ? 'mixed' : manifest.storageMode;
  manifest.updatedAt = new Date().toISOString();
  saveArtistVaultManifest(workspaceRootPath, manifest);
  return { manifest, added, skipped };
}

export async function scanArtistVaultAsync(
  workspaceRootPath: string,
  workspaceId: string,
): Promise<VaultAssetScanResult> {
  await ensureArtistVaultFoldersAsync(workspaceRootPath);
  const manifest = await loadArtistVaultManifestForImportAsync(workspaceRootPath, workspaceId);
  const vaultRoot = getArtistVaultRoot(workspaceRootPath);
  const trackedPaths = trackedManifestPaths(manifest);
  const added: VaultAssetRecord[] = [];
  const skipped: Array<{ path: string; reason: string }> = [];
  const now = new Date().toISOString();

  for (const absolutePath of await listVaultFilesAsync(vaultRoot)) {
    const relativePath = toWorkspaceRelativePath(workspaceRootPath, absolutePath);
    if (shouldSkipVaultFile(relativePath)) continue;
    if (trackedPaths.has(relativePath)) continue;

    try {
      const classification = classifyVaultAsset(absolutePath);
      const folderKind = kindFromRelativePath(relativePath);
      const kind = folderKind ?? classification.kind;
      const policy = defaultVaultPolicy(kind);
      const { sizeBytes, sha256 } = await sizeAndHashAsync(absolutePath);
      const record: VaultAssetRecord = {
        id: `vault_asset_${randomUUID()}`,
        category: categoryForKind(kind),
        kind,
        label: displayVaultKind(kind),
        relativePath,
        mimeType: inferVaultMimeType(absolutePath),
        sizeBytes,
        sha256,
        source: 'manual',
        status: policy.status,
        rightsStatus: policy.rightsStatus,
        usableByAgents: policy.usableByAgents,
        notes: 'Indexed from Vault folder scan',
        createdAt: now,
        updatedAt: now,
      };
      added.push(record);
      manifest.assets.push(record);
      trackedPaths.add(relativePath);
    } catch (err) {
      skipped.push({ path: relativePath, reason: err instanceof Error ? err.message : 'Unable to index file' });
    }
  }

  manifest.workspaceId = workspaceId;
  manifest.vaultRoot = ARTIST_VAULT_DIR;
  manifest.storageMode = manifest.storageMode === 'linked' ? 'mixed' : manifest.storageMode;
  manifest.updatedAt = new Date().toISOString();
  await saveArtistVaultManifestAsync(workspaceRootPath, manifest);
  return { manifest, added, skipped };
}

export function linkArtistVaultFolder(
  workspaceRootPath: string,
  workspaceId: string,
  folderPath: string,
): VaultFolderLinkResult {
  ensureArtistVaultFolders(workspaceRootPath);
  const manifest = loadArtistVaultManifestForImport(workspaceRootPath, workspaceId);
  const linked: VaultAssetRecord[] = [];
  const skipped: Array<{ path: string; reason: string }> = [];
  const folderRoot = resolve(folderPath);

  try {
    const info = statSync(folderRoot);
    if (!info.isDirectory()) throw new Error('Only folders can be linked');
  } catch (err) {
    return {
      manifest,
      linked,
      skipped: [{ path: folderRoot, reason: err instanceof Error ? err.message : 'Unable to inspect folder' }],
    };
  }

  const trackedPaths = trackedManifestAbsolutePaths(manifest);
  const now = new Date().toISOString();

  for (const absolutePath of listVaultFiles(folderRoot)) {
    if (shouldSkipLinkedFile(absolutePath)) continue;
    if (trackedPaths.has(absolutePath)) continue;
    try {
      const classification = classifyVaultAsset(absolutePath);
      const policy = defaultVaultPolicy(classification.kind);
      const { sizeBytes, sha256 } = sizeAndHash(absolutePath);
      const record: VaultAssetRecord = {
        id: `vault_asset_${randomUUID()}`,
        category: classification.category,
        kind: classification.kind,
        label: displayVaultKind(classification.kind),
        absolutePath,
        mimeType: inferVaultMimeType(absolutePath),
        sizeBytes,
        sha256,
        source: 'linked-folder',
        status: policy.status,
        rightsStatus: policy.rightsStatus,
        usableByAgents: policy.usableByAgents,
        notes: `Linked from folder: ${folderRoot}`,
        createdAt: now,
        updatedAt: now,
      };
      linked.push(record);
      manifest.assets.push(record);
      trackedPaths.add(absolutePath);
    } catch (err) {
      skipped.push({ path: absolutePath, reason: err instanceof Error ? err.message : 'Unable to link file' });
    }
  }

  manifest.workspaceId = workspaceId;
  manifest.vaultRoot = ARTIST_VAULT_DIR;
  manifest.storageMode = manifest.assets.some((asset) => asset.source === 'copy' || asset.source === 'manual' || asset.source === 'agent-output')
    ? 'mixed'
    : 'linked';
  manifest.updatedAt = new Date().toISOString();
  saveArtistVaultManifest(workspaceRootPath, manifest);
  return { manifest, linked, skipped };
}

export async function linkArtistVaultFolderAsync(
  workspaceRootPath: string,
  workspaceId: string,
  folderPath: string,
): Promise<VaultFolderLinkResult> {
  await ensureArtistVaultFoldersAsync(workspaceRootPath);
  const manifest = await loadArtistVaultManifestForImportAsync(workspaceRootPath, workspaceId);
  const linked: VaultAssetRecord[] = [];
  const skipped: Array<{ path: string; reason: string }> = [];
  const folderRoot = resolve(folderPath);

  try {
    const info = await statAsync(folderRoot);
    if (!info.isDirectory()) throw new Error('Only folders can be linked');
  } catch (err) {
    return {
      manifest,
      linked,
      skipped: [{ path: folderRoot, reason: err instanceof Error ? err.message : 'Unable to inspect folder' }],
    };
  }

  const trackedPaths = trackedManifestAbsolutePaths(manifest);
  const now = new Date().toISOString();

  for (const absolutePath of await listVaultFilesAsync(folderRoot)) {
    if (shouldSkipLinkedFile(absolutePath)) continue;
    if (trackedPaths.has(absolutePath)) continue;
    try {
      const classification = classifyVaultAsset(absolutePath);
      const policy = defaultVaultPolicy(classification.kind);
      const { sizeBytes, sha256 } = await sizeAndHashAsync(absolutePath);
      const record: VaultAssetRecord = {
        id: `vault_asset_${randomUUID()}`,
        category: classification.category,
        kind: classification.kind,
        label: displayVaultKind(classification.kind),
        absolutePath,
        mimeType: inferVaultMimeType(absolutePath),
        sizeBytes,
        sha256,
        source: 'linked-folder',
        status: policy.status,
        rightsStatus: policy.rightsStatus,
        usableByAgents: policy.usableByAgents,
        notes: `Linked from folder: ${folderRoot}`,
        createdAt: now,
        updatedAt: now,
      };
      linked.push(record);
      manifest.assets.push(record);
      trackedPaths.add(absolutePath);
    } catch (err) {
      skipped.push({ path: absolutePath, reason: err instanceof Error ? err.message : 'Unable to link file' });
    }
  }

  manifest.workspaceId = workspaceId;
  manifest.vaultRoot = ARTIST_VAULT_DIR;
  manifest.storageMode = manifest.assets.some((asset) => asset.source === 'copy' || asset.source === 'manual' || asset.source === 'agent-output')
    ? 'mixed'
    : 'linked';
  manifest.updatedAt = new Date().toISOString();
  await saveArtistVaultManifestAsync(workspaceRootPath, manifest);
  return { manifest, linked, skipped };
}

export function emptyArtistVaultManifest(workspaceId: string): VaultManifest {
  return {
    version: 1,
    workspaceId,
    vaultRoot: ARTIST_VAULT_DIR,
    storageMode: 'copied',
    assets: [],
    updatedAt: new Date().toISOString(),
  };
}

function trackedManifestPaths(manifest: VaultManifest): Set<string> {
  return new Set(manifest.assets
    .map((asset) => asset.relativePath)
    .filter((path): path is string => Boolean(path)));
}

function trackedManifestAbsolutePaths(manifest: VaultManifest): Set<string> {
  return new Set(manifest.assets
    .map((asset) => asset.absolutePath)
    .filter((path): path is string => Boolean(path)));
}

function listVaultFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const absolutePath = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...listVaultFiles(absolutePath));
    } else if (entry.isFile()) {
      files.push(absolutePath);
    }
  }
  return files;
}

async function listVaultFilesAsync(root: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdirAsync(root, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const absolutePath = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listVaultFilesAsync(absolutePath));
    } else if (entry.isFile()) {
      files.push(absolutePath);
    }
  }
  return files;
}

function toWorkspaceRelativePath(workspaceRootPath: string, absolutePath: string): string {
  return relative(workspaceRootPath, absolutePath).replace(/\\/g, '/');
}

function shouldSkipVaultFile(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/');
  if (!normalized.startsWith(`${ARTIST_VAULT_DIR}/`)) return true;
  const fileName = basename(normalized);
  return fileName === ARTIST_VAULT_MANIFEST_FILE
    || fileName.startsWith(`${ARTIST_VAULT_MANIFEST_FILE}.`)
    || fileName.endsWith('.tmp');
}

function shouldSkipLinkedFile(path: string): boolean {
  const fileName = basename(path);
  return fileName === ARTIST_VAULT_MANIFEST_FILE
    || fileName.startsWith(`${ARTIST_VAULT_MANIFEST_FILE}.`)
    || fileName.endsWith('.tmp');
}

function kindFromRelativePath(relativePath: string): VaultAssetRecord['kind'] | null {
  const normalized = relativePath.replace(/\\/g, '/');
  if (normalized.startsWith('vault/music/masters-finals/')) return 'master-final';
  if (normalized.startsWith('vault/music/demos/')) return 'demo';
  if (normalized.startsWith('vault/music/stems/')) return 'stem';
  if (normalized.startsWith('vault/music/beats-instrumentals/')) return 'beat-instrumental';
  if (normalized.startsWith('vault/music/mix-references/')) return 'mix-reference';
  if (normalized.startsWith('vault/music/lyrics-notes/')) return 'lyrics-note';
  if (normalized.startsWith('vault/video/final-videos/')) return 'final-video';
  if (normalized.startsWith('vault/video/raw-footage/')) return 'raw-footage';
  if (normalized.startsWith('vault/video/content-clips/')) return 'content-clip';
  if (normalized.startsWith('vault/video/b-roll/')) return 'b-roll';
  if (normalized.startsWith('vault/video/live-performance/')) return 'live-performance';
  if (normalized.startsWith('vault/video/project-files/')) return 'video-project';
  if (normalized.startsWith('vault/visuals/cover-art/')) return 'cover-art';
  if (normalized.startsWith('vault/visuals/artist-photos/')) return 'artist-photo';
  if (normalized.startsWith('vault/visuals/face-references/')) return 'face-reference';
  if (normalized.startsWith('vault/visuals/logos-marks/')) return 'logo-mark';
  if (normalized.startsWith('vault/visuals/brand-assets/')) return 'brand-asset';
  if (normalized.startsWith('vault/visuals/posters-flyers/')) return 'poster-flyer';
  if (normalized.startsWith('vault/visuals/merch-designs/')) return 'merch-design';
  if (normalized.startsWith('vault/campaigns/release-assets/')) return 'release-asset';
  if (normalized.startsWith('vault/campaigns/ads/')) return 'ad-asset';
  if (normalized.startsWith('vault/campaigns/press/')) return 'press-asset';
  if (normalized.startsWith('vault/campaigns/social-packs/')) return 'social-pack';
  if (normalized.startsWith('vault/business/contracts/')) return 'contract';
  if (normalized.startsWith('vault/business/splits/')) return 'split-sheet';
  if (normalized.startsWith('vault/business/rights-and-royalties/')) return 'rights-record';
  if (normalized.startsWith('vault/business/legal/')) return 'contract';
  if (normalized.startsWith('vault/business/invoices/')) return 'invoice';
  if (normalized.startsWith('vault/business/one-sheets/')) return 'one-sheet';
  if (normalized.startsWith('vault/business/epk/')) return 'epk';
  if (normalized.startsWith('vault/references/moodboards/')) return 'moodboard';
  if (normalized.startsWith('vault/references/inspiration/')) return 'inspiration';
  if (normalized.startsWith('vault/references/similar-artists/')) return 'similar-artist-reference';
  if (normalized.startsWith('vault/references/swipe-files/')) return 'swipe-file';
  return null;
}

function uniqueDestinationRelativePath(
  workspaceRootPath: string,
  directory: string,
  fileName: string,
  plannedDestinations: Set<string>,
): string {
  const ext = extname(fileName);
  const stem = ext ? fileName.slice(0, -ext.length) : fileName;
  let index = 1;
  while (true) {
    const candidateName = index === 1 ? fileName : `${stem}-${index}${ext}`;
    const relative = vaultRelativePath(directory, candidateName);
    const absolute = resolve(workspaceRootPath, relative);
    if (!existsSync(absolute) && !plannedDestinations.has(relative)) return relative;
    index += 1;
  }
}

async function uniqueDestinationRelativePathAsync(
  workspaceRootPath: string,
  directory: string,
  fileName: string,
  plannedDestinations: Set<string>,
): Promise<string> {
  const ext = extname(fileName);
  const stem = ext ? fileName.slice(0, -ext.length) : fileName;
  let index = 1;
  while (true) {
    const candidateName = index === 1 ? fileName : `${stem}-${index}${ext}`;
    const relative = vaultRelativePath(directory, candidateName);
    const absolute = resolve(workspaceRootPath, relative);
    if (!(await pathExists(absolute)) && !plannedDestinations.has(relative)) return relative;
    index += 1;
  }
}

function sizeAndHash(path: string): { sizeBytes: number; sha256?: string } {
  const sizeBytes = statSync(path).size;
  if (sizeBytes > MAX_INLINE_HASH_BYTES) return { sizeBytes };
  const data = readFileSync(path);
  return {
    sizeBytes,
    sha256: createHash('sha256').update(data).digest('hex'),
  };
}

async function sizeAndHashAsync(path: string): Promise<{ sizeBytes: number; sha256?: string }> {
  const sizeBytes = (await statAsync(path)).size;
  if (sizeBytes > MAX_INLINE_HASH_BYTES) return { sizeBytes };
  const data = await readFileAsync(path);
  return {
    sizeBytes,
    sha256: createHash('sha256').update(data).digest('hex'),
  };
}

function invalidBackupPath(file: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${file}.invalid-${stamp}`;
}

function backupInvalidManifest(file: string): string {
  const backup = invalidBackupPath(file);
  copyFileSync(file, backup);
  return backup;
}

async function backupInvalidManifestAsync(file: string): Promise<string> {
  const backup = invalidBackupPath(file);
  await copyFileAsync(file, backup);
  return backup;
}

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

async function atomicWriteJsonAsync(file: string, value: unknown): Promise<void> {
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFileAsync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf-8');
    await renameAsync(tmp, file);
  } catch (err) {
    try { await rmAsync(tmp, { force: true }); } catch { /* ignore */ }
    throw err;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await accessAsync(path);
    return true;
  } catch {
    return false;
  }
}

function isVaultManifest(value: unknown): value is VaultManifest {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<VaultManifest>;
  return candidate.version === 1
    && typeof candidate.workspaceId === 'string'
    && candidate.vaultRoot === ARTIST_VAULT_DIR
    && typeof candidate.storageMode === 'string'
    && VAULT_STORAGE_MODES.has(candidate.storageMode)
    && Array.isArray(candidate.assets)
    && candidate.assets.every(isVaultAssetRecord)
    && typeof candidate.updatedAt === 'string';
}

function isVaultAssetRecord(value: unknown): value is VaultAssetRecord {
  if (!value || typeof value !== 'object') return false;
  const asset = value as Partial<VaultAssetRecord>;
  if (typeof asset.id !== 'string') return false;
  if (typeof asset.category !== 'string' || !VAULT_CATEGORIES.has(asset.category)) return false;
  if (typeof asset.kind !== 'string' || !VAULT_KINDS.has(asset.kind as VaultAssetKind)) return false;
  if (typeof asset.label !== 'string') return false;
  if (typeof asset.source !== 'string' || !VAULT_SOURCES.has(asset.source as VaultAssetSource)) return false;
  if (typeof asset.status !== 'string' || !VAULT_STATUSES.has(asset.status as VaultAssetStatus)) return false;
  if (typeof asset.rightsStatus !== 'string' || !VAULT_RIGHTS_STATUSES.has(asset.rightsStatus as VaultRightsStatus)) return false;
  if (typeof asset.usableByAgents !== 'boolean') return false;
  if (typeof asset.createdAt !== 'string' || typeof asset.updatedAt !== 'string') return false;
  if (asset.relativePath !== undefined && (typeof asset.relativePath !== 'string' || !isSafeVaultRelativePath(asset.relativePath))) return false;
  if (asset.absolutePath !== undefined && (typeof asset.absolutePath !== 'string' || asset.absolutePath.includes('\0'))) return false;
  if (asset.genre !== undefined && !isStringArray(asset.genre)) return false;
  if (asset.moods !== undefined && !isStringArray(asset.moods)) return false;
  if (asset.similarSongs !== undefined && !isStringArray(asset.similarSongs)) return false;
  if (asset.bpm !== undefined && (typeof asset.bpm !== 'number' || !Number.isFinite(asset.bpm) || asset.bpm <= 0)) return false;
  if (asset.trackIntelligence !== undefined && !isTrackIntelligence(asset.trackIntelligence)) return false;
  return true;
}

function isTrackIntelligence(value: unknown): value is TrackIntelligence {
  if (!value || typeof value !== 'object') return false;
  const intelligence = value as Partial<TrackIntelligence>;
  if (intelligence.schemaVersion !== 1) return false;
  if (!['pending', 'draft', 'reviewed', 'failed', 'skipped'].includes(intelligence.status ?? '')) return false;
  if (intelligence.draft !== undefined && !isTrackIntelligenceRevision(intelligence.draft)) return false;
  if (intelligence.approved !== undefined && !isTrackIntelligenceRevision(intelligence.approved)) return false;
  return true;
}

function isTrackIntelligenceRevision(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const revision = value as NonNullable<TrackIntelligence['draft']>;
  if (typeof revision.id !== 'string' || !revision.id) return false;
  if (!revision.provenance || typeof revision.provenance !== 'object') return false;
  if (revision.lyrics !== undefined) {
    if (!Array.isArray(revision.lyrics.lines)) return false;
    if (!['alignment', 'transcription', 'manual'].includes(revision.lyrics.timingSource)) return false;
    if (!['ready', 'needs-alignment'].includes(revision.lyrics.timingStatus)) return false;
    if (revision.lyrics.lines.some((line) => (
      !line || typeof line.id !== 'string' || typeof line.text !== 'string'
      || (line.startMs !== undefined && (typeof line.startMs !== 'number' || !Number.isFinite(line.startMs) || line.startMs < 0))
      || (line.endMs !== undefined && (typeof line.endMs !== 'number' || !Number.isFinite(line.endMs) || (line.startMs !== undefined && line.endMs < line.startMs)))
      || (line.section !== undefined && !['verse', 'pre-chorus', 'chorus', 'hook', 'bridge', 'outro'].includes(line.section))
    ))) return false;
  }
  return true;
}

function cleanStringList(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function setOptionalStringList(
  asset: VaultAssetRecord,
  key: 'campaigns' | 'tags' | 'genre' | 'moods' | 'similarSongs',
  values: string[],
): void {
  const cleaned = cleanStringList(values);
  if (cleaned.length) {
    asset[key] = cleaned;
  } else {
    delete asset[key];
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}
