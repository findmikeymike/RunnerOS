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
  assetRelativePath,
  classifyMissionAsset,
  displayKind,
  inferMimeType,
} from './classify.ts';
import {
  MISSION_ASSET_MANIFEST_FILE,
  MISSION_ASSETS_DIR,
  type MissionAssetImportCandidate,
  type MissionAssetImportOptions,
  type MissionAssetImportResult,
  type MissionAssetManifest,
  type MissionAssetRecord,
  type MissionAssetSaveLyricsInput,
  type MissionAssetSaveLyricsResult,
  type MissionAssetScanResult,
} from './types.ts';
import { normalizeTrackCharacter } from '../artist-vault/track-intelligence.ts';
import { hashFileSha256 } from '../utils/hash-file.ts';
import {
  missionLyricsProjectionFromTrackIntelligence,
  reconcileMissionLyricsProjections,
} from './track-intelligence.ts';

const DEFAULT_DIRECTORIES = [
  'audio/masters',
  'audio/demos',
  'audio/stems',
  'audio/references',
  'video/raw',
  'video/edits',
  'video/finals',
  'images/cover-art',
  'images/press-photos',
  'images/moodboard',
  'docs/lyrics',
  'docs/press',
  'docs/notes',
  'exports/social',
  'exports/epk',
];
const MAX_INLINE_HASH_BYTES = 256 * 1024 * 1024;
const MAX_INLINE_LYRICS_BYTES = 512 * 1024;

export function getMissionAssetsRoot(workspaceRootPath: string): string {
  return join(workspaceRootPath, MISSION_ASSETS_DIR);
}

export function getMissionAssetManifestPath(workspaceRootPath: string): string {
  return join(getMissionAssetsRoot(workspaceRootPath), MISSION_ASSET_MANIFEST_FILE);
}

export function ensureMissionAssetsFolders(workspaceRootPath: string): void {
  const root = getMissionAssetsRoot(workspaceRootPath);
  mkdirSync(root, { recursive: true });
  for (const dir of DEFAULT_DIRECTORIES) {
    mkdirSync(join(root, dir), { recursive: true });
  }
}

export async function ensureMissionAssetsFoldersAsync(workspaceRootPath: string): Promise<void> {
  const root = getMissionAssetsRoot(workspaceRootPath);
  await mkdirAsync(root, { recursive: true });
  await Promise.all(DEFAULT_DIRECTORIES.map((dir) => mkdirAsync(join(root, dir), { recursive: true })));
}

export function loadMissionAssetManifest(workspaceRootPath: string, workspaceId = 'workspace'): MissionAssetManifest {
  const file = getMissionAssetManifestPath(workspaceRootPath);
  if (!existsSync(file)) return emptyMissionAssetManifest(workspaceId);
  const result = readManifestFile(file);
  return result.manifest ?? emptyMissionAssetManifest(workspaceId);
}

function loadMissionAssetManifestForImport(workspaceRootPath: string, workspaceId: string): MissionAssetManifest {
  const file = getMissionAssetManifestPath(workspaceRootPath);
  if (!existsSync(file)) return emptyMissionAssetManifest(workspaceId);
  const result = readManifestFile(file);
  if (result.manifest) return result.manifest;
  const backup = backupInvalidManifest(file);
  throw new Error(`Mission asset manifest is invalid (${result.reason}). Backup saved to ${backup}. Fix or remove manifest before importing.`);
}

async function loadMissionAssetManifestForImportAsync(workspaceRootPath: string, workspaceId: string): Promise<MissionAssetManifest> {
  const file = getMissionAssetManifestPath(workspaceRootPath);
  if (!(await pathExists(file))) return emptyMissionAssetManifest(workspaceId);
  const result = await readManifestFileAsync(file);
  if (result.manifest) return result.manifest;
  const backup = await backupInvalidManifestAsync(file);
  throw new Error(`Mission asset manifest is invalid (${result.reason}). Backup saved to ${backup}. Fix or remove manifest before importing.`);
}

function readManifestFile(file: string): { manifest?: MissionAssetManifest; reason: string } {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as MissionAssetManifest;
    if (!isMissionAssetManifest(parsed)) return { reason: 'schema mismatch' };
    return { manifest: reconcileMissionLyricsProjections(parsed), reason: 'ok' };
  } catch (err) {
    return { reason: err instanceof Error ? err.message : 'parse failed' };
  }
}

async function readManifestFileAsync(file: string): Promise<{ manifest?: MissionAssetManifest; reason: string }> {
  try {
    const parsed = JSON.parse(await readFileAsync(file, 'utf-8')) as MissionAssetManifest;
    if (!isMissionAssetManifest(parsed)) return { reason: 'schema mismatch' };
    return { manifest: reconcileMissionLyricsProjections(parsed), reason: 'ok' };
  } catch (err) {
    return { reason: err instanceof Error ? err.message : 'parse failed' };
  }
}

export function saveMissionAssetManifest(workspaceRootPath: string, manifest: MissionAssetManifest): MissionAssetManifest {
  ensureMissionAssetsFolders(workspaceRootPath);
  const file = getMissionAssetManifestPath(workspaceRootPath);
  atomicWriteJson(file, manifest);
  return manifest;
}

export async function saveMissionAssetManifestAsync(workspaceRootPath: string, manifest: MissionAssetManifest): Promise<MissionAssetManifest> {
  await ensureMissionAssetsFoldersAsync(workspaceRootPath);
  const file = getMissionAssetManifestPath(workspaceRootPath);
  await atomicWriteJsonAsync(file, manifest);
  return manifest;
}

export function selectMissionAudioForLyrics(manifest: MissionAssetManifest, audioAssetId?: string): MissionAssetRecord | null {
  const available = manifest.files.filter((file) => file.status === 'available');
  if (audioAssetId) {
    return available.find((file) => file.id === audioAssetId && ['master', 'demo'].includes(file.kind)) ?? null;
  }
  return available.find((file) => file.kind === 'master')
    ?? available.find((file) => file.kind === 'demo')
    ?? null;
}

export function findCanonicalLyricsAsset(manifest: MissionAssetManifest): MissionAssetRecord | null {
  const lyrics = manifest.files.filter((file) => file.kind === 'lyrics' && file.status === 'available');
  return lyrics.find((file) => file.lyrics && !file.lyrics.reviewRequired)
    ?? lyrics.find((file) => file.lyrics)
    ?? lyrics[0]
    ?? null;
}

export async function saveMissionLyricsAsync(
  workspaceRootPath: string,
  workspaceId: string,
  input: MissionAssetSaveLyricsInput,
  reviewedByClientId?: string,
): Promise<MissionAssetSaveLyricsResult> {
  const lyricsText = input.lyricsText.trim();
  if (!lyricsText && !input.character && input.status !== 'machine') throw new Error('Lyrics or track metadata is required');
  await ensureMissionAssetsFoldersAsync(workspaceRootPath);
  const manifest = await loadMissionAssetManifestForImportAsync(workspaceRootPath, workspaceId);
  const now = new Date().toISOString();
  const sourceAudio = input.sourceAudioAssetId
    ? manifest.files.find((file) => file.id === input.sourceAudioAssetId && ['master', 'demo'].includes(file.kind))
    : selectMissionAudioForLyrics(manifest);
  const existing = input.assetId
    ? manifest.files.find((file) => file.id === input.assetId && file.kind === 'lyrics')
    : null;
  if (input.sourceAudioAssetId && !sourceAudio) throw new Error(`Campaign audio asset not found: ${input.sourceAudioAssetId}`);
  const reviewed = !(input.reviewRequired ?? false);
  if (reviewed && !reviewedByClientId?.trim()) throw new Error('A human reviewer identity is required to approve track intelligence.');
  const currentRevision = sourceAudio?.trackIntelligence?.draft ?? sourceAudio?.trackIntelligence?.approved;
  const expectedDraftId = currentRevision?.id ?? (existing?.lyrics ? `legacy-${existing.id}` : undefined);
  if (reviewed && expectedDraftId && input.draftId !== expectedDraftId) {
    throw new Error('This track analysis draft is stale. Reopen the current track package before saving.');
  }
  if (reviewed && currentRevision?.provenance.sourceSha256 && sourceAudio) {
    const sourcePath = sourceAudio.relativePath ? resolve(workspaceRootPath, sourceAudio.relativePath) : sourceAudio.absolutePath;
    if (!sourcePath || !existsSync(sourcePath) || !statSync(sourcePath).isFile()) throw new Error('The track audio file is missing.');
    if (hashFileSha256(sourcePath) !== currentRevision.provenance.sourceSha256) {
      throw new Error('The audio changed after analysis. Re-run transcription before approving lyrics.');
    }
  }
  if (sourceAudio) {
    const prior = sourceAudio.trackIntelligence;
    const lyricsChangedWithoutLines = input.lyricLines === undefined
      && existing?.lyrics?.text !== undefined
      && existing.lyrics.text.trim() !== lyricsText;
    const sourceLines = input.lyricLines
      ?? (lyricsChangedWithoutLines ? undefined : existing?.lyrics?.lyricLines);
    const lyricLines = sourceLines?.length
      ? sourceLines.map((line, index) => ({
        id: `line-${index + 1}`,
        text: line.text,
        startMs: Math.max(0, Math.round(line.start_time * 1000)),
        endMs: Math.max(0, Math.round(line.end_time * 1000)),
      }))
      : lyricsText.split(/\r?\n/).map((text, index) => ({ id: `line-${index + 1}`, text: text.trim() })).filter((line) => line.text);
    const baseRevision = prior?.draft ?? prior?.approved;
    const character = normalizeTrackCharacter(input.character ?? baseRevision?.character);
    const revision = {
      id: reviewed ? (prior?.draft?.id ?? `manual-${randomUUID()}`) : `draft-${randomUUID()}`,
      lyrics: {
        lines: lyricLines.map((line, index) => {
          const approvedLine = prior?.approved?.lyrics?.lines.find((candidate) => candidate.id === line.id);
          const preserveCorrection = !reviewed && approvedLine?.corrected;
          return {
            ...line,
            text: preserveCorrection ? approvedLine.text : line.text,
            corrected: preserveCorrection || (reviewed && Boolean(baseRevision?.lyrics?.lines[index] && baseRevision.lyrics.lines[index]?.text !== line.text)),
          };
        }),
        language: input.language ?? baseRevision?.lyrics?.language,
        timingSource: input.timingSource ?? baseRevision?.lyrics?.timingSource ?? (sourceLines?.length ? 'transcription' : 'manual'),
        timingStatus: sourceLines?.length ? 'ready' as const : 'needs-alignment' as const,
        artistSuppliedText: input.artistSuppliedText ?? baseRevision?.lyrics?.artistSuppliedText,
      },
      character,
      technical: baseRevision?.technical,
      provenance: {
        ...baseRevision?.provenance,
        engine: input.engine ?? baseRevision?.provenance.engine,
        analyzedAt: input.generatedAt ?? baseRevision?.provenance.analyzedAt,
        processedLocally: input.status === 'machine' ? true : baseRevision?.provenance.processedLocally,
        transcriptRelativePath: input.transcriptRelativePath ?? baseRevision?.provenance.transcriptRelativePath,
        sourceSha256: input.status === 'machine'
          ? input.sourceSha256
          : baseRevision?.provenance.sourceSha256 ?? (() => {
            const sourcePath = sourceAudio.relativePath ? resolve(workspaceRootPath, sourceAudio.relativePath) : sourceAudio.absolutePath;
            return sourcePath && existsSync(sourcePath) ? hashFileSha256(sourcePath) : sourceAudio.sha256;
          })(),
      },
    };
    sourceAudio.trackIntelligence = reviewed ? {
      status: 'reviewed',
      schemaVersion: 1,
      approved: {
        ...revision,
        reviewedAt: now,
        reviewedBy: { type: 'user', clientId: reviewedByClientId! },
      },
    } : {
      status: 'draft',
      schemaVersion: 1,
      approved: prior?.approved,
      draft: revision,
    };
    sourceAudio.updatedAt = now;
  }
  const relativePath = existing?.relativePath
    ?? await uniqueDestinationRelativePathAsync(
      workspaceRootPath,
      'docs/lyrics',
      `${slugify(sourceAudio?.label || sourceAudio?.relativePath || 'approved-lyrics')}-lyrics.md`,
      trackedManifestPaths(manifest),
    );
  const absolutePath = resolve(workspaceRootPath, relativePath);
  await mkdirAsync(dirname(absolutePath), { recursive: true });
  await writeFileAsync(absolutePath, `${lyricsText}\n`, 'utf-8');
  const { sizeBytes, sha256 } = await sizeAndHashAsync(absolutePath);
  const compatibilityMetadata = {
    ...existing?.lyrics,
    text: lyricsText,
    reviewRequired: input.reviewRequired ?? false,
    status: input.status ?? 'approved',
    model: input.model ?? existing?.lyrics?.model,
  };
  const lyrics = sourceAudio
    ? missionLyricsProjectionFromTrackIntelligence(sourceAudio, compatibilityMetadata)!
    : {
      ...compatibilityMetadata,
      lyricLines: input.lyricLines ?? existing?.lyrics?.lyricLines,
      transcriptRelativePath: input.transcriptRelativePath ?? existing?.lyrics?.transcriptRelativePath,
      engine: input.engine ?? existing?.lyrics?.engine,
      generatedAt: input.generatedAt ?? existing?.lyrics?.generatedAt,
      sourceSha256: input.sourceSha256 ?? existing?.lyrics?.sourceSha256,
      reviewedAt: input.reviewRequired ? existing?.lyrics?.reviewedAt : now,
    };

  let lyricsAsset: MissionAssetRecord;
  if (existing) {
    lyricsAsset = {
      ...existing,
      label: 'Lyrics',
      relativePath,
      mimeType: 'text/markdown',
      sizeBytes,
      sha256,
      source: input.status === 'machine' ? 'agent-output' : existing.source,
      status: 'available',
      usableByAgents: !(input.reviewRequired ?? false),
      notes: input.reviewRequired ? 'Machine transcript needs lyric review' : 'Approved lyrics for campaign agents',
      lyrics,
      updatedAt: now,
    };
    manifest.files = manifest.files.map((file) => file.id === existing.id ? lyricsAsset : file);
  } else {
    lyricsAsset = {
      id: `asset_${randomUUID()}`,
      kind: 'lyrics',
      label: 'Lyrics',
      relativePath,
      mimeType: 'text/markdown',
      sizeBytes,
      sha256,
      source: input.status === 'machine' ? 'agent-output' : 'manual',
      status: 'available',
      usableByAgents: !(input.reviewRequired ?? false),
      notes: input.reviewRequired ? 'Machine transcript needs lyric review' : 'Approved lyrics for campaign agents',
      lyrics,
      createdAt: now,
      updatedAt: now,
    };
    manifest.files.push(lyricsAsset);
  }

  if (!(input.reviewRequired ?? false)) {
    manifest.files = manifest.files.map((file) => {
      if (file.id === lyricsAsset.id || file.kind !== 'lyrics' || file.status !== 'available') return file;
      if (sourceAudio && file.lyrics?.sourceAudioAssetId && file.lyrics.sourceAudioAssetId !== sourceAudio.id) return file;
      return {
        ...file,
        status: 'moved',
        usableByAgents: false,
        notes: 'Superseded by a newer artist-approved lyric revision',
        updatedAt: now,
      };
    });
  }

  manifest.workspaceId = workspaceId;
  manifest.assetsRoot = MISSION_ASSETS_DIR;
  manifest.updatedAt = now;
  await saveMissionAssetManifestAsync(workspaceRootPath, manifest);
  return { manifest, lyricsAsset };
}

export function planMissionAssetImports(
  workspaceRootPath: string,
  filePaths: string[],
  options: MissionAssetImportOptions = {},
): { candidates: MissionAssetImportCandidate[]; skipped: Array<{ path: string; reason: string }> } {
  const candidates: MissionAssetImportCandidate[] = [];
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
      const classification = classifyMissionAsset(sourcePath, options.kindHint ?? 'any');
      const destinationRelativePath = uniqueDestinationRelativePath(
        workspaceRootPath,
        classification.directory,
        basename(sourcePath),
        plannedDestinations,
      );
      plannedDestinations.add(destinationRelativePath);
      candidates.push({
        sourcePath,
        fileName: basename(sourcePath),
        kind: classification.kind,
        destinationRelativePath,
        confidence: classification.confidence,
        reason: classification.reason,
        sizeBytes: info.size,
        mimeType: inferMimeType(sourcePath),
      });
    } catch (err) {
      skipped.push({ path: sourcePath, reason: err instanceof Error ? err.message : 'Unable to inspect file' });
    }
  }

  return { candidates, skipped };
}

export async function planMissionAssetImportsAsync(
  workspaceRootPath: string,
  filePaths: string[],
  options: MissionAssetImportOptions = {},
): Promise<{ candidates: MissionAssetImportCandidate[]; skipped: Array<{ path: string; reason: string }> }> {
  const candidates: MissionAssetImportCandidate[] = [];
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
      const classification = classifyMissionAsset(sourcePath, options.kindHint ?? 'any');
      const destinationRelativePath = await uniqueDestinationRelativePathAsync(
        workspaceRootPath,
        classification.directory,
        basename(sourcePath),
        plannedDestinations,
      );
      plannedDestinations.add(destinationRelativePath);
      candidates.push({
        sourcePath,
        fileName: basename(sourcePath),
        kind: classification.kind,
        destinationRelativePath,
        confidence: classification.confidence,
        reason: classification.reason,
        sizeBytes: info.size,
        mimeType: inferMimeType(sourcePath),
      });
    } catch (err) {
      skipped.push({ path: sourcePath, reason: err instanceof Error ? err.message : 'Unable to inspect file' });
    }
  }

  return { candidates, skipped };
}

export function importMissionAssets(
  workspaceRootPath: string,
  workspaceId: string,
  filePaths: string[],
  options: MissionAssetImportOptions = {},
): MissionAssetImportResult {
  ensureMissionAssetsFolders(workspaceRootPath);
  const manifest = loadMissionAssetManifestForImport(workspaceRootPath, workspaceId);
  const plan = planMissionAssetImports(workspaceRootPath, filePaths, options);
  const imported: MissionAssetRecord[] = [];
  const skipped = [...plan.skipped];
  const now = new Date().toISOString();

  for (const candidate of plan.candidates) {
    try {
      const destination = resolve(workspaceRootPath, candidate.destinationRelativePath);
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(candidate.sourcePath, destination);
      const { sizeBytes, sha256 } = sizeAndHash(destination);
      let record: MissionAssetRecord = {
        id: `asset_${randomUUID()}`,
        kind: candidate.kind,
        label: displayKind(candidate.kind),
        relativePath: candidate.destinationRelativePath,
        mimeType: candidate.mimeType ?? inferMimeType(candidate.fileName),
        sizeBytes,
        sha256,
        source: 'copy',
        status: 'available',
        usableByAgents: true,
        notes: candidate.reason,
        createdAt: now,
        updatedAt: now,
      };
      record = withImportedLyricsMetadata(record, destination, now);
      imported.push(record);
      manifest.files.push(record);
    } catch (err) {
      skipped.push({
        path: candidate.sourcePath,
        reason: err instanceof Error ? err.message : 'Failed to copy file',
      });
    }
  }

  manifest.workspaceId = workspaceId;
  manifest.assetsRoot = MISSION_ASSETS_DIR;
  manifest.storageMode = 'copied';
  manifest.updatedAt = new Date().toISOString();
  saveMissionAssetManifest(workspaceRootPath, manifest);
  return { manifest, imported, skipped };
}

export async function importMissionAssetsAsync(
  workspaceRootPath: string,
  workspaceId: string,
  filePaths: string[],
  options: MissionAssetImportOptions = {},
): Promise<MissionAssetImportResult> {
  await ensureMissionAssetsFoldersAsync(workspaceRootPath);
  const manifest = await loadMissionAssetManifestForImportAsync(workspaceRootPath, workspaceId);
  const plan = await planMissionAssetImportsAsync(workspaceRootPath, filePaths, options);
  const imported: MissionAssetRecord[] = [];
  const skipped = [...plan.skipped];
  const now = new Date().toISOString();

  for (const candidate of plan.candidates) {
    try {
      const destination = resolve(workspaceRootPath, candidate.destinationRelativePath);
      await mkdirAsync(dirname(destination), { recursive: true });
      await copyFileAsync(candidate.sourcePath, destination);
      const { sizeBytes, sha256 } = await sizeAndHashAsync(destination);
      let record: MissionAssetRecord = {
        id: `asset_${randomUUID()}`,
        kind: candidate.kind,
        label: displayKind(candidate.kind),
        relativePath: candidate.destinationRelativePath,
        mimeType: candidate.mimeType ?? inferMimeType(candidate.fileName),
        sizeBytes,
        sha256,
        source: 'copy',
        status: 'available',
        usableByAgents: true,
        notes: candidate.reason,
        createdAt: now,
        updatedAt: now,
      };
      record = await withImportedLyricsMetadataAsync(record, destination, now);
      imported.push(record);
      manifest.files.push(record);
    } catch (err) {
      skipped.push({
        path: candidate.sourcePath,
        reason: err instanceof Error ? err.message : 'Failed to copy file',
      });
    }
  }

  manifest.workspaceId = workspaceId;
  manifest.assetsRoot = MISSION_ASSETS_DIR;
  manifest.storageMode = 'copied';
  manifest.updatedAt = new Date().toISOString();
  await saveMissionAssetManifestAsync(workspaceRootPath, manifest);
  return { manifest, imported, skipped };
}

export function scanMissionAssets(
  workspaceRootPath: string,
  workspaceId: string,
): MissionAssetScanResult {
  ensureMissionAssetsFolders(workspaceRootPath);
  const manifest = loadMissionAssetManifestForImport(workspaceRootPath, workspaceId);
  const assetsRoot = getMissionAssetsRoot(workspaceRootPath);
  const trackedPaths = trackedManifestPaths(manifest);
  const added: MissionAssetRecord[] = [];
  const skipped: Array<{ path: string; reason: string }> = [];
  const now = new Date().toISOString();

  for (const absolutePath of listAssetFiles(assetsRoot)) {
    const relativePath = toWorkspaceRelativePath(workspaceRootPath, absolutePath);
    if (shouldSkipAssetFile(relativePath)) continue;
    if (trackedPaths.has(relativePath)) continue;

    try {
      const classification = classifyMissionAsset(absolutePath);
      const { sizeBytes, sha256 } = sizeAndHash(absolutePath);
      let record: MissionAssetRecord = {
        id: `asset_${randomUUID()}`,
        kind: kindFromRelativePath(relativePath) ?? classification.kind,
        label: displayKind(kindFromRelativePath(relativePath) ?? classification.kind),
        relativePath,
        mimeType: inferMimeType(absolutePath),
        sizeBytes,
        sha256,
        source: 'manual',
        status: 'available',
        usableByAgents: true,
        notes: 'Indexed from Vault folder scan',
        createdAt: now,
        updatedAt: now,
      };
      record = withImportedLyricsMetadata(record, absolutePath, now);
      added.push(record);
      manifest.files.push(record);
      trackedPaths.add(relativePath);
    } catch (err) {
      skipped.push({ path: relativePath, reason: err instanceof Error ? err.message : 'Unable to index file' });
    }
  }

  manifest.workspaceId = workspaceId;
  manifest.assetsRoot = MISSION_ASSETS_DIR;
  manifest.storageMode = manifest.storageMode === 'linked' ? 'mixed' : manifest.storageMode;
  manifest.updatedAt = new Date().toISOString();
  saveMissionAssetManifest(workspaceRootPath, manifest);
  return { manifest, added, skipped };
}

export async function scanMissionAssetsAsync(
  workspaceRootPath: string,
  workspaceId: string,
): Promise<MissionAssetScanResult> {
  await ensureMissionAssetsFoldersAsync(workspaceRootPath);
  const manifest = await loadMissionAssetManifestForImportAsync(workspaceRootPath, workspaceId);
  const assetsRoot = getMissionAssetsRoot(workspaceRootPath);
  const trackedPaths = trackedManifestPaths(manifest);
  const added: MissionAssetRecord[] = [];
  const skipped: Array<{ path: string; reason: string }> = [];
  const now = new Date().toISOString();

  for (const absolutePath of await listAssetFilesAsync(assetsRoot)) {
    const relativePath = toWorkspaceRelativePath(workspaceRootPath, absolutePath);
    if (shouldSkipAssetFile(relativePath)) continue;
    if (trackedPaths.has(relativePath)) continue;

    try {
      const classification = classifyMissionAsset(absolutePath);
      const folderKind = kindFromRelativePath(relativePath);
      const kind = folderKind ?? classification.kind;
      const { sizeBytes, sha256 } = await sizeAndHashAsync(absolutePath);
      let record: MissionAssetRecord = {
        id: `asset_${randomUUID()}`,
        kind,
        label: displayKind(kind),
        relativePath,
        mimeType: inferMimeType(absolutePath),
        sizeBytes,
        sha256,
        source: 'manual',
        status: 'available',
        usableByAgents: true,
        notes: 'Indexed from Vault folder scan',
        createdAt: now,
        updatedAt: now,
      };
      record = await withImportedLyricsMetadataAsync(record, absolutePath, now);
      added.push(record);
      manifest.files.push(record);
      trackedPaths.add(relativePath);
    } catch (err) {
      skipped.push({ path: relativePath, reason: err instanceof Error ? err.message : 'Unable to index file' });
    }
  }

  manifest.workspaceId = workspaceId;
  manifest.assetsRoot = MISSION_ASSETS_DIR;
  manifest.storageMode = manifest.storageMode === 'linked' ? 'mixed' : manifest.storageMode;
  manifest.updatedAt = new Date().toISOString();
  await saveMissionAssetManifestAsync(workspaceRootPath, manifest);
  return { manifest, added, skipped };
}

export function emptyMissionAssetManifest(workspaceId: string): MissionAssetManifest {
  return {
    version: 1,
    workspaceId,
    assetsRoot: MISSION_ASSETS_DIR,
    storageMode: 'copied',
    files: [],
    updatedAt: new Date().toISOString(),
  };
}

function trackedManifestPaths(manifest: MissionAssetManifest): Set<string> {
  return new Set(manifest.files
    .map((file) => file.relativePath)
    .filter((path): path is string => Boolean(path)));
}

function listAssetFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const absolutePath = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...listAssetFiles(absolutePath));
    } else if (entry.isFile()) {
      files.push(absolutePath);
    }
  }
  return files;
}

async function listAssetFilesAsync(root: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdirAsync(root, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const absolutePath = join(root, entry.name);
    if (entry.isDirectory()) {
      const nestedFiles = await listAssetFilesAsync(absolutePath);
      files.push(...nestedFiles);
    } else if (entry.isFile()) {
      files.push(absolutePath);
    }
  }
  return files;
}

function toWorkspaceRelativePath(workspaceRootPath: string, absolutePath: string): string {
  return relative(workspaceRootPath, absolutePath).replace(/\\/g, '/');
}

function shouldSkipAssetFile(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/');
  if (!normalized.startsWith(`${MISSION_ASSETS_DIR}/`)) return true;
  const fileName = basename(normalized);
  return fileName === MISSION_ASSET_MANIFEST_FILE
    || fileName.startsWith(`${MISSION_ASSET_MANIFEST_FILE}.`)
    || fileName.endsWith('.tmp');
}

function kindFromRelativePath(relativePath: string): MissionAssetRecord['kind'] | null {
  const normalized = relativePath.replace(/\\/g, '/');
  if (normalized.startsWith('assets/audio/masters/')) return 'master';
  if (normalized.startsWith('assets/audio/demos/')) return 'demo';
  if (normalized.startsWith('assets/audio/stems/')) return 'stem';
  if (normalized.startsWith('assets/audio/references/')) return 'audio-reference';
  if (normalized.startsWith('assets/video/raw/')) return 'raw-video';
  if (normalized.startsWith('assets/video/edits/')) return 'edited-video';
  if (normalized.startsWith('assets/video/finals/')) return 'final-video';
  if (normalized.startsWith('assets/images/cover-art/')) return 'cover-art';
  if (normalized.startsWith('assets/images/press-photos/')) return 'press-photo';
  if (normalized.startsWith('assets/images/moodboard/')) return 'moodboard-image';
  if (normalized.startsWith('assets/docs/lyrics/')) return 'lyrics';
  if (normalized.startsWith('assets/docs/press/')) return 'press-doc';
  if (normalized.startsWith('assets/docs/notes/')) return 'note';
  if (normalized.startsWith('assets/exports/')) return 'export';
  return null;
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
    const relative = assetRelativePath(directory, candidateName);
    const absolute = resolve(workspaceRootPath, relative);
    if (!(await pathExists(absolute)) && !plannedDestinations.has(relative)) return relative;
    index += 1;
  }
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
    const relative = assetRelativePath(directory, candidateName);
    const absolute = resolve(workspaceRootPath, relative);
    if (!existsSync(absolute) && !plannedDestinations.has(relative)) return relative;
    index += 1;
  }
}

function slugify(value: string): string {
  return basename(value, extname(value))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'lyrics';
}

function withImportedLyricsMetadata(record: MissionAssetRecord, absolutePath: string, now: string): MissionAssetRecord {
  if (record.kind !== 'lyrics' || record.lyrics || !isPlainLyricsFile(record, absolutePath)) return record;
  const text = readImportedLyricsText(absolutePath);
  if (!text) return record;
  return {
    ...record,
    usableByAgents: false,
    notes: appendNote(record.notes, 'Imported lyrics need review'),
    lyrics: {
      text,
      reviewRequired: true,
      status: 'manual',
      generatedAt: now,
    },
  };
}

async function withImportedLyricsMetadataAsync(record: MissionAssetRecord, absolutePath: string, now: string): Promise<MissionAssetRecord> {
  if (record.kind !== 'lyrics' || record.lyrics || !isPlainLyricsFile(record, absolutePath)) return record;
  const text = await readImportedLyricsTextAsync(absolutePath);
  if (!text) return record;
  return {
    ...record,
    usableByAgents: false,
    notes: appendNote(record.notes, 'Imported lyrics need review'),
    lyrics: {
      text,
      reviewRequired: true,
      status: 'manual',
      generatedAt: now,
    },
  };
}

function isPlainLyricsFile(record: MissionAssetRecord, absolutePath: string): boolean {
  const mime = record.mimeType ?? inferMimeType(absolutePath);
  const ext = extname(absolutePath).toLowerCase();
  return mime === 'text/plain' || mime === 'text/markdown' || ext === '.txt' || ext === '.md';
}

function readImportedLyricsText(absolutePath: string): string | null {
  if (statSync(absolutePath).size > MAX_INLINE_LYRICS_BYTES) return null;
  const text = readFileSync(absolutePath, 'utf-8').trim();
  return text || null;
}

async function readImportedLyricsTextAsync(absolutePath: string): Promise<string | null> {
  const { size } = await statAsync(absolutePath);
  if (size > MAX_INLINE_LYRICS_BYTES) return null;
  const text = (await readFileAsync(absolutePath, 'utf-8')).trim();
  return text || null;
}

function appendNote(existing: string | undefined, note: string): string {
  return existing ? `${existing}; ${note}` : note;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await accessAsync(path);
    return true;
  } catch {
    return false;
  }
}

function sizeAndHash(path: string): { sizeBytes: number; sha256?: string } {
  const sizeBytes = statSync(path).size;
  if (sizeBytes > MAX_INLINE_HASH_BYTES) {
    return { sizeBytes };
  }
  const data = readFileSync(path);
  return {
    sizeBytes,
    sha256: createHash('sha256').update(data).digest('hex'),
  };
}

async function sizeAndHashAsync(path: string): Promise<{ sizeBytes: number; sha256?: string }> {
  const { size } = await statAsync(path);
  if (size > MAX_INLINE_HASH_BYTES) {
    return { sizeBytes: size };
  }
  const data = await readFileAsync(path);
  return {
    sizeBytes: size,
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

function isMissionAssetManifest(value: unknown): value is MissionAssetManifest {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<MissionAssetManifest>;
  return candidate.version === 1
    && typeof candidate.workspaceId === 'string'
    && typeof candidate.assetsRoot === 'string'
    && Array.isArray(candidate.files)
    && typeof candidate.updatedAt === 'string';
}
