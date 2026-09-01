import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import {
  artistVaultContextMetadata,
  importArtistVaultAssets,
  reviewArtistVaultTrackIntelligence,
  saveArtistVaultTrackDraft,
  vaultAssetForAgentDetail,
} from '@craft-agent/shared/artist-vault';
import {
  importMissionAssets,
  getMissionAssetManifestPath,
  missionAssetContextMetadata,
  saveMissionLyricsAsync,
  serializeMissionAssetContext,
} from '@craft-agent/shared/mission-assets';
import { loadContextDoc, upsertContextDoc } from '@craft-agent/shared/workspace-context';
import {
  refreshVerifiedTrackContextForAgents,
  verifiedArtistVaultManifestForAgents,
  verifiedMissionAssetManifestForAgents,
} from './agent-visibility';

function tempWorkspace(): string {
  return mkdtempSync(join(tmpdir(), 'track-agent-visibility-'));
}

describe('Track Intelligence agent visibility', () => {
  test('withholds reviewed Vault intelligence after the source audio changes', () => {
    const workspace = tempWorkspace();
    const source = join(workspace, 'vault-master.wav');
    writeFileSync(source, 'audio-v1');
    const imported = importArtistVaultAssets(workspace, 'workspace-1', [source], { kindHint: 'master-final' });
    const audio = imported.imported[0]!;
    saveArtistVaultTrackDraft(workspace, 'workspace-1', audio.id, {
      status: 'draft',
      schemaVersion: 1,
      draft: {
        id: 'draft-1',
        lyrics: {
          timingSource: 'transcription',
          timingStatus: 'ready',
          lines: [{ id: 'line-1', text: 'approved line', startMs: 0, endMs: 1000 }],
        },
        provenance: { sourceSha256: audio.sha256 },
      },
    });
    const reviewed = reviewArtistVaultTrackIntelligence(workspace, 'workspace-1', {
      assetId: audio.id,
      draftId: 'draft-1',
      lyrics: {
        timingSource: 'transcription',
        timingStatus: 'ready',
        lines: [{ id: 'line-1', text: 'approved line', startMs: 0, endMs: 1000 }],
      },
    }, 'client-1');
    expect(vaultAssetForAgentDetail(verifiedArtistVaultManifestForAgents(workspace, reviewed).assets[0]!).trackIntelligence).toBeDefined();

    writeFileSync(join(workspace, audio.relativePath!), 'audio-v2');
    const stale = verifiedArtistVaultManifestForAgents(workspace, reviewed).assets[0]!;

    expect(vaultAssetForAgentDetail(stale).trackIntelligence).toBeUndefined();
  });

  test('withholds campaign lyrics and metadata after the source audio changes', async () => {
    const workspace = tempWorkspace();
    const source = join(workspace, 'campaign-master.wav');
    writeFileSync(source, 'audio-v1');
    const audio = importMissionAssets(workspace, 'workspace-1', [source], { kindHint: 'master' }).imported[0]!;
    const reviewed = await saveMissionLyricsAsync(workspace, 'workspace-1', {
      sourceAudioAssetId: audio.id,
      lyricsText: 'bound lyric',
      lyricLines: [{ text: 'bound lyric', start_time: 0, end_time: 1 }],
    }, 'client-1');
    expect(serializeMissionAssetContext(verifiedMissionAssetManifestForAgents(workspace, reviewed.manifest))).toContain('bound lyric');

    writeFileSync(join(workspace, audio.relativePath!), 'audio-v2');
    const stale = verifiedMissionAssetManifestForAgents(workspace, reviewed.manifest);
    const staleAudio = stale.files.find((file) => file.id === audio.id);
    const staleLyrics = stale.files.find((file) => file.kind === 'lyrics');

    expect(staleAudio?.trackIntelligence).toBeUndefined();
    expect(staleLyrics?.usableByAgents).toBe(false);
    expect(staleLyrics?.lyrics).toBeUndefined();
    expect(serializeMissionAssetContext(stale)).not.toContain('bound lyric');
  });

  test('withholds a drifted legacy lyrics file while preserving canonical approved lyrics', async () => {
    const workspace = tempWorkspace();
    const source = join(workspace, 'canonical-master.wav');
    writeFileSync(source, 'audio-v1');
    const audio = importMissionAssets(workspace, 'workspace-1', [source], { kindHint: 'master' }).imported[0]!;
    const reviewed = await saveMissionLyricsAsync(workspace, 'workspace-1', {
      sourceAudioAssetId: audio.id,
      lyricsText: 'canonical approved lyric',
    }, 'client-1');
    writeFileSync(join(workspace, reviewed.lyricsAsset.relativePath!), 'drifted legacy file');

    const verified = verifiedMissionAssetManifestForAgents(workspace, reviewed.manifest);
    const legacyLyrics = verified.files.find((file) => file.kind === 'lyrics');
    const body = serializeMissionAssetContext(verified);

    expect(legacyLyrics?.usableByAgents).toBe(false);
    expect(legacyLyrics?.relativePath).toBeUndefined();
    expect(legacyLyrics?.lyrics).toBeUndefined();
    expect(body).toContain('canonical approved lyric');
    expect(body).not.toContain('drifted legacy file');
  });

  test('replaces legacy campaign context before an agent prompt can load it', () => {
    const workspace = tempWorkspace();
    upsertContextDoc(workspace, {
      slug: 'mission-assets',
      metadata: missionAssetContextMetadata(),
      body: 'legacy draft lyric\n/private/path/to/master.wav',
    });

    refreshVerifiedTrackContextForAgents(workspace, 'workspace-1', 'campaign');

    const body = loadContextDoc(workspace, 'mission-assets')?.body ?? '';
    expect(body).not.toContain('legacy draft lyric');
    expect(body).not.toContain('/private/path/to/master.wav');
    expect(body).toContain('Campaign Assets');
  });

  test('replaces legacy HQ Vault context before an agent prompt can load it', () => {
    const workspace = tempWorkspace();
    upsertContextDoc(workspace, {
      slug: 'artist-vault',
      metadata: artistVaultContextMetadata(),
      body: 'private legacy track notes\n/private/path/to/vault-master.wav',
    });

    refreshVerifiedTrackContextForAgents(workspace, 'workspace-1', 'hq');

    const body = loadContextDoc(workspace, 'artist-vault')?.body ?? '';
    expect(body).not.toContain('private legacy track notes');
    expect(body).not.toContain('/private/path/to/vault-master.wav');
    expect(body).toContain('artist Vault assets');
  });

  test('replaces legacy context with a safe empty view when the manifest is damaged', () => {
    const workspace = tempWorkspace();
    upsertContextDoc(workspace, {
      slug: 'mission-assets',
      metadata: missionAssetContextMetadata(),
      body: 'legacy draft lyric\n/private/path/to/master.wav',
    });
    const manifestPath = getMissionAssetManifestPath(workspace);
    mkdirSync(dirname(manifestPath), { recursive: true });
    writeFileSync(manifestPath, '{"files":"broken"}');

    const result = refreshVerifiedTrackContextForAgents(workspace, 'workspace-1', 'campaign');

    expect(result.ok).toBe(true);
    const body = loadContextDoc(workspace, 'mission-assets')?.body ?? '';
    expect(body).not.toContain('legacy draft lyric');
    expect(body).not.toContain('/private/path/to/master.wav');
    expect(body).toContain('Campaign Assets');
  });

  test('reports an unsafe persisted slug instead of throwing when context storage is read-only', () => {
    const workspace = tempWorkspace();

    const result = refreshVerifiedTrackContextForAgents(
      workspace,
      'workspace-1',
      'campaign',
      () => { throw new Error('EACCES'); },
    );

    expect(result).toMatchObject({
      ok: false,
      unsafePersistedSlug: 'mission-assets',
    });
  });
});
