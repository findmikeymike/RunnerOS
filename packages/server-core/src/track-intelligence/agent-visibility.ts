import {
  artistVaultContextMetadata,
  artistVaultContextSlug,
  emptyArtistVaultManifest,
  loadArtistVaultManifest,
  resolveArtistVaultAssetPath,
  lyricsTextFromLines,
  serializeArtistVaultContext,
  type VaultAssetRecord,
  type VaultManifest,
} from '@craft-agent/shared/artist-vault';
import {
  loadMissionAssetManifest,
  missionAssetContextMetadata,
  missionAssetContextSlug,
  emptyMissionAssetManifest,
  reconcileMissionLyricsProjections,
  serializeMissionAssetContext,
  type MissionAssetManifest,
  type MissionAssetRecord,
} from '@craft-agent/shared/mission-assets';
import { hashFileSha256 } from '@craft-agent/shared/utils/hash-file';
import { upsertContextDoc } from '@craft-agent/shared/workspace-context';
import type { UpsertContextDocInput } from '@craft-agent/shared/workspace-context';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

function missionAssetPath(workspaceRootPath: string, asset: MissionAssetRecord): string | null {
  if (asset.relativePath) {
    const candidate = resolve(workspaceRootPath, asset.relativePath);
    const relation = relative(workspaceRootPath, candidate);
    if (!relation || relation === '..' || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
      return relation ? null : candidate;
    }
    return candidate;
  }
  return asset.absolutePath && !asset.absolutePath.includes('\0') ? asset.absolutePath : null;
}

function approvedSourceIsFresh(
  workspaceRootPath: string,
  asset: Pick<VaultAssetRecord, 'relativePath' | 'absolutePath' | 'trackIntelligence'>,
  resolvePath: () => string | null,
): boolean {
  const approved = asset.trackIntelligence?.approved;
  if (!approved) return true;
  const expected = approved.provenance.sourceSha256;
  if (!expected) return false;
  try {
    const path = resolvePath();
    return Boolean(path && existsSync(path) && statSync(path).isFile() && hashFileSha256(path) === expected);
  } catch {
    return false;
  }
}

function canonicalLyricsFileMatches(
  workspaceRootPath: string,
  lyricsAsset: MissionAssetRecord,
  sourceAudio: MissionAssetRecord,
): boolean {
  const approvedLines = sourceAudio.trackIntelligence?.approved?.lyrics?.lines;
  if (!approvedLines) return true;
  try {
    const path = missionAssetPath(workspaceRootPath, lyricsAsset);
    if (!path || !existsSync(path)) return false;
    const info = statSync(path);
    if (!info.isFile() || info.size > 1024 * 1024) return false;
    const normalize = (value: string) => value
      .trim()
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .join('\n');
    return normalize(readFileSync(path, 'utf8')) === normalize(lyricsTextFromLines(approvedLines));
  } catch {
    return false;
  }
}

export function verifiedArtistVaultManifestForAgents(
  workspaceRootPath: string,
  manifest: VaultManifest,
): VaultManifest {
  return {
    ...manifest,
    assets: manifest.assets.map((asset) => (
      approvedSourceIsFresh(
        workspaceRootPath,
        asset,
        () => resolveArtistVaultAssetPath(workspaceRootPath, asset),
      )
        ? asset
        : { ...asset, trackIntelligence: undefined }
    )),
  };
}

export function verifiedMissionAssetManifestForAgents(
  workspaceRootPath: string,
  manifest: MissionAssetManifest,
): MissionAssetManifest {
  const reconciled = reconcileMissionLyricsProjections(manifest);
  const audioById = new Map(
    reconciled.files
      .filter((file) => file.kind === 'master' || file.kind === 'demo')
      .map((file) => [file.id, file]),
  );
  const freshness = new Map<string, boolean>();
  for (const file of reconciled.files) {
    if ((file.kind === 'master' || file.kind === 'demo') && file.trackIntelligence?.approved) {
      freshness.set(file.id, approvedSourceIsFresh(
        workspaceRootPath,
        file,
        () => missionAssetPath(workspaceRootPath, file),
      ));
    }
  }
  return {
    ...reconciled,
    files: reconciled.files.map((file) => {
      if ((file.kind === 'master' || file.kind === 'demo') && freshness.get(file.id) === false) {
        return {
          ...file,
          trackIntelligence: undefined,
          notes: 'Reviewed Track Intelligence is unavailable because the source audio changed.',
        };
      }
      const sourceAudioId = file.kind === 'lyrics' ? file.lyrics?.sourceAudioAssetId : undefined;
      if (sourceAudioId && freshness.get(sourceAudioId) === false) {
        return {
          ...file,
          relativePath: undefined,
          absolutePath: undefined,
          usableByAgents: false,
          lyrics: undefined,
          notes: 'Reviewed lyrics are unavailable because the source audio changed.',
        };
      }
      const sourceAudio = sourceAudioId ? audioById.get(sourceAudioId) : undefined;
      if (sourceAudio?.trackIntelligence?.approved && !canonicalLyricsFileMatches(workspaceRootPath, file, sourceAudio)) {
        return {
          ...file,
          relativePath: undefined,
          absolutePath: undefined,
          usableByAgents: false,
          lyrics: undefined,
          notes: 'Legacy lyrics file differs from canonical Track Intelligence.',
        };
      }
      return file;
    }),
  };
}

export function refreshVerifiedTrackContextForAgents(
  workspaceRootPath: string,
  workspaceId: string,
  scope: 'hq' | 'campaign',
  persist: (rootPath: string, input: UpsertContextDocInput) => unknown = upsertContextDoc,
): { ok: true } | { ok: false; error: string; unsafePersistedSlug?: string } {
  const slug = scope === 'campaign' ? missionAssetContextSlug() : artistVaultContextSlug();
  try {
    if (scope === 'campaign') {
      const manifest = verifiedMissionAssetManifestForAgents(
        workspaceRootPath,
        loadMissionAssetManifest(workspaceRootPath, workspaceId),
      );
      persist(workspaceRootPath, {
        slug,
        metadata: missionAssetContextMetadata(),
        body: serializeMissionAssetContext(manifest),
      });
      return { ok: true };
    }
    const manifest = verifiedArtistVaultManifestForAgents(
      workspaceRootPath,
      loadArtistVaultManifest(workspaceRootPath, workspaceId),
    );
    persist(workspaceRootPath, {
      slug,
      metadata: artistVaultContextMetadata(),
      body: serializeArtistVaultContext(manifest),
    });
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const fallback = scope === 'campaign'
      ? {
          slug: missionAssetContextSlug(),
          metadata: missionAssetContextMetadata(),
          body: serializeMissionAssetContext(emptyMissionAssetManifest(workspaceId)),
        }
      : {
          slug: artistVaultContextSlug(),
          metadata: artistVaultContextMetadata(),
          body: serializeArtistVaultContext(emptyArtistVaultManifest(workspaceId)),
        };
    try {
      persist(workspaceRootPath, fallback);
      return { ok: false, error: message };
    } catch (fallbackError) {
      const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      return {
        ok: false,
        error: `${message}; safe fallback write failed: ${fallbackMessage}`,
        unsafePersistedSlug: slug,
      };
    }
  }
}
