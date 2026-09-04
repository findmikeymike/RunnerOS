import { existsSync, mkdirSync, mkdtempSync, readdirSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import {
  artistVaultContextMetadata,
  classifyVaultAsset,
  getArtistVaultManifestPath,
  ensureArtistVaultFolders,
  importArtistVaultAssets,
  importArtistVaultAssetsAsync,
  linkArtistVaultFolder,
  linkArtistVaultFolderAsync,
  loadArtistVaultManifest,
  planArtistVaultImports,
  scanArtistVault,
  serializeArtistVaultContext,
  saveArtistVaultTrackDraft,
  reviewArtistVaultTrackIntelligence,
  vaultAssetForAgentDetail,
  vaultAssetForAgentList,
  updateArtistVaultAsset,
} from './index.ts';

function tempWorkspace(): string {
  return mkdtempSync(join(tmpdir(), 'artist-vault-'));
}

describe('artist vault', () => {
  test('creates the private Rights & Royalties workspace structure', () => {
    const workspace = tempWorkspace();

    ensureArtistVaultFolders(workspace);

    const catalogDir = join(workspace, 'vault/business/rights-and-royalties/catalog');
    expect(existsSync(catalogDir)).toBe(true);
    expect(existsSync(join(workspace, 'vault/business/rights-and-royalties/registration-evidence'))).toBe(true);
    expect(existsSync(join(workspace, 'vault/business/rights-and-royalties/filing-packets'))).toBe(true);

    writeFileSync(join(catalogDir, 'bmi-works.csv'), 'title,writer\nNight Drive,Mikey Mike\n');
    const scan = scanArtistVault(workspace, 'workspace-1');
    const record = scan.added.find((asset) => asset.relativePath?.endsWith('bmi-works.csv'));
    expect(record?.kind).toBe('rights-record');
    expect(record?.category).toBe('business');
    expect(record?.rightsStatus).toBe('private');
    expect(record?.usableByAgents).toBe(false);
    expect(serializeArtistVaultContext(scan.manifest)).not.toContain('bmi-works.csv');
  });

  test('classifies artist library filenames into Vault categories', () => {
    expect(classifyVaultAsset('/tmp/final-master.wav').kind).toBe('master-final');
    expect(classifyVaultAsset('/tmp/vocal-stem.wav').kind).toBe('stem');
    expect(classifyVaultAsset('/tmp/cover-art-v4.png').kind).toBe('cover-art');
    expect(classifyVaultAsset('/tmp/press-headshot.jpg').kind).toBe('artist-photo');
    expect(classifyVaultAsset('/tmp/face-reference-01.jpg').kind).toBe('face-reference');
    expect(classifyVaultAsset('/tmp/song-splitsheet.pdf').kind).toBe('split-sheet');
    expect(classifyVaultAsset('/tmp/studio-bts.mov').kind).toBe('raw-footage');
  });

  test('plans destination paths and avoids collisions within one import batch', () => {
    const workspace = tempWorkspace();
    const first = join(workspace, 'source-master.wav');
    const second = join(workspace, 'other', 'source-master.wav');
    mkdirSync(join(workspace, 'other'), { recursive: true });
    writeFileSync(first, 'audio-one');
    writeFileSync(second, 'audio-two');

    const plan = planArtistVaultImports(workspace, [first, second], { kindHint: 'master-final' });

    expect(plan.skipped).toEqual([]);
    expect(plan.candidates.map((candidate) => candidate.destinationRelativePath)).toEqual([
      'vault/music/masters-finals/source-master.wav',
      'vault/music/masters-finals/source-master-2.wav',
    ]);
  });

  test('plans ad assets into campaign ads as final usable assets', () => {
    const workspace = tempWorkspace();
    const adVideo = join(workspace, 'watching-tornado-videos-ad.mp4');
    writeFileSync(adVideo, 'fake video');

    const plan = planArtistVaultImports(workspace, [adVideo], { kindHint: 'ad-asset' });

    expect(plan.skipped).toEqual([]);
    expect(plan.candidates[0]?.kind).toBe('ad-asset');
    expect(plan.candidates[0]?.destinationRelativePath).toBe('vault/campaigns/ads/watching-tornado-videos-ad.mp4');
    expect(plan.candidates[0]?.defaultStatus).toBe('final');
    expect(plan.candidates[0]?.defaultUsableByAgents).toBe(true);
  });

  test('plans face reference images into the dedicated visual bucket', () => {
    const workspace = tempWorkspace();
    const faceReference = join(workspace, 'mikey-face-reference.jpg');
    writeFileSync(faceReference, 'fake image');

    const plan = planArtistVaultImports(workspace, [faceReference], { kindHint: 'face-reference' });

    expect(plan.skipped).toEqual([]);
    expect(plan.candidates[0]?.kind).toBe('face-reference');
    expect(plan.candidates[0]?.destinationRelativePath).toBe('vault/visuals/face-references/mikey-face-reference.jpg');
    expect(plan.candidates[0]?.defaultStatus).toBe('final');
    expect(plan.candidates[0]?.defaultUsableByAgents).toBe(true);
  });

  test('copies files, writes manifest, and emits compact agent context', () => {
    const workspace = tempWorkspace();
    const master = join(workspace, 'night-drive-final.wav');
    const photo = join(workspace, 'press-headshot.jpg');
    const faceReference = join(workspace, 'face-reference-01.jpg');
    writeFileSync(master, 'fake audio');
    writeFileSync(photo, 'fake image');
    writeFileSync(faceReference, 'fake face image');

    importArtistVaultAssets(workspace, 'workspace-1', [master, photo, faceReference]);
    const loaded = loadArtistVaultManifest(workspace, 'workspace-1');
    const body = serializeArtistVaultContext(loaded);

    expect(getArtistVaultManifestPath(workspace)).toContain('vault/manifest.json');
    expect(loaded.assets).toHaveLength(3);
    expect(loaded.assets.map((asset) => asset.kind).sort()).toEqual(['artist-photo', 'face-reference', 'master-final']);
    expect(loaded.assets.every((asset) => asset.usableByAgents)).toBe(true);
    expect(loaded.assets.every((asset) => asset.status === 'final')).toBe(true);
    expect(body).toContain('"kind": "master-final"');
    expect(body).toContain('Final master: vault/music/masters-finals/night-drive-final.wav');
    expect(body).toContain('Press photo: vault/visuals/artist-photos/press-headshot.jpg');
    expect(body).toContain('Face reference: vault/visuals/face-references/face-reference-01.jpg');
    expect(body).toContain('Only agent-approved Vault files are exposed here.');
    expect(body).toContain('Private or non-agent-usable assets: 0');
    expect(artistVaultContextMetadata().description).toContain('song matching metadata');
    expect(artistVaultContextMetadata().routing).toEqual({ mode: 'broadcast' });
  });

  test('sensitive business assets default private and redact their paths', () => {
    const workspace = tempWorkspace();
    const split = join(workspace, 'song-splitsheet.pdf');
    writeFileSync(split, 'private splits');

    const imported = importArtistVaultAssets(workspace, 'workspace-1', [split]);
    const asset = imported.imported[0];
    const privateManifest = updateArtistVaultAsset(workspace, 'workspace-1', asset!.id, {
      rightsStatus: 'private',
      usableByAgents: false,
    });
    const privateAsset = privateManifest.assets[0];
    const body = serializeArtistVaultContext(privateManifest);

    expect(asset?.kind).toBe('split-sheet');
    expect(asset?.rightsStatus).toBe('private');
    expect(asset?.usableByAgents).toBe(false);
    expect(privateAsset?.rightsStatus).toBe('private');
    expect(privateAsset?.usableByAgents).toBe(false);
    expect(asset?.relativePath).toBe('vault/business/splits/song-splitsheet.pdf');
    expect(body).not.toContain('"kind": "split-sheet"');
    expect(body).not.toContain('song-splitsheet.pdf');
    expect(body).not.toContain('vault/business/splits/song-splitsheet.pdf');
    expect(body).toContain('Private or non-agent-usable assets: 1');
  });

  test('does not hash very large media into memory', () => {
    const workspace = tempWorkspace();
    const source = join(workspace, 'huge-raw-footage.mov');
    writeFileSync(source, '');
    truncateSync(source, 257 * 1024 * 1024);

    const result = importArtistVaultAssets(workspace, 'workspace-1', [source]);
    const imported = result.imported[0];

    expect(result.imported).toHaveLength(1);
    expect(imported?.sizeBytes).toBe(257 * 1024 * 1024);
    expect(imported?.sha256).toBeUndefined();
  });

  test('scans manually dropped Vault files into manifest once with policy defaults', () => {
    const workspace = tempWorkspace();
    const masterPath = join(workspace, 'vault/music/masters-finals/live-master.wav');
    const contractPath = join(workspace, 'vault/business/contracts/deal-contract.pdf');
    const faceReferencePath = join(workspace, 'vault/visuals/face-references/face-reference.jpg');
    mkdirSync(join(workspace, 'vault/music/masters-finals'), { recursive: true });
    mkdirSync(join(workspace, 'vault/business/contracts'), { recursive: true });
    mkdirSync(join(workspace, 'vault/visuals/face-references'), { recursive: true });
    writeFileSync(masterPath, 'manual audio');
    writeFileSync(contractPath, 'manual contract');
    writeFileSync(faceReferencePath, 'manual image');

    const first = scanArtistVault(workspace, 'workspace-1');
    const second = scanArtistVault(workspace, 'workspace-1');
    const loaded = loadArtistVaultManifest(workspace, 'workspace-1');

    expect(first.added.map((asset) => asset.kind).sort()).toEqual(['contract', 'face-reference', 'master-final']);
    expect(first.added.find((asset) => asset.kind === 'contract')?.usableByAgents).toBe(false);
    expect(first.added.find((asset) => asset.kind === 'contract')?.rightsStatus).toBe('private');
    expect(first.added.find((asset) => asset.kind === 'face-reference')?.usableByAgents).toBe(true);
    expect(first.added.find((asset) => asset.kind === 'master-final')?.usableByAgents).toBe(true);
    expect(second.added).toHaveLength(0);
    expect(loaded.assets).toHaveLength(3);
  });

  test('links an external folder without copying files and keeps sensitive documents private', () => {
    const workspace = tempWorkspace();
    const linkedFolder = join(workspace, 'external');
    mkdirSync(linkedFolder, { recursive: true });
    writeFileSync(join(linkedFolder, 'approved-cover.png'), 'image');
    writeFileSync(join(linkedFolder, 'producer-contract.pdf'), 'private');

    const result = linkArtistVaultFolder(workspace, 'workspace-1', linkedFolder);
    const body = serializeArtistVaultContext(result.manifest);

    expect(result.linked.map((asset) => asset.kind).sort()).toEqual(['contract', 'cover-art']);
    expect(result.linked.every((asset) => asset.source === 'linked-folder')).toBe(true);
    expect(result.linked.every((asset) => asset.relativePath === undefined)).toBe(true);
    expect(result.linked.find((asset) => asset.kind === 'cover-art')?.usableByAgents).toBe(true);
    expect(result.linked.find((asset) => asset.kind === 'contract')?.usableByAgents).toBe(false);
    expect(result.manifest.storageMode).toBe('linked');
    expect(body).toContain(join(linkedFolder, 'approved-cover.png'));
    expect(body).not.toContain(join(linkedFolder, 'producer-contract.pdf'));
  });

  test('linked folder scan skips Vault manifest and temp files', () => {
    const workspace = tempWorkspace();
    const linkedFolder = join(workspace, 'linked-vault-like-folder');
    mkdirSync(linkedFolder, { recursive: true });
    writeFileSync(join(linkedFolder, 'manifest.json'), '{}');
    writeFileSync(join(linkedFolder, 'manifest.json.invalid-2026'), '{}');
    writeFileSync(join(linkedFolder, 'render.tmp'), 'tmp');
    writeFileSync(join(linkedFolder, 'approved-cover.png'), 'image');

    const result = linkArtistVaultFolder(workspace, 'workspace-1', linkedFolder);

    expect(result.linked).toHaveLength(1);
    expect(result.linked[0]?.absolutePath).toBe(join(linkedFolder, 'approved-cover.png'));
  });

  test('async import and linked-folder paths mirror sync behavior for RPC handlers', async () => {
    const workspace = tempWorkspace();
    const source = join(workspace, 'single-cover.png');
    const linkedFolder = join(workspace, 'external-async');
    mkdirSync(linkedFolder, { recursive: true });
    writeFileSync(source, 'image');
    writeFileSync(join(linkedFolder, 'session-contract.pdf'), 'private');

    const imported = await importArtistVaultAssetsAsync(workspace, 'workspace-1', [source], { kindHint: 'cover-art' });
    const linked = await linkArtistVaultFolderAsync(workspace, 'workspace-1', linkedFolder);
    const body = serializeArtistVaultContext(linked.manifest);

    expect(imported.imported[0]?.relativePath).toBe('vault/visuals/cover-art/single-cover.png');
    expect(linked.linked[0]?.kind).toBe('contract');
    expect(body).not.toContain(join(linkedFolder, 'session-contract.pdf'));
  });

  test('updates asset metadata and keeps category aligned with kind', () => {
    const workspace = tempWorkspace();
    const source = join(workspace, 'press-headshot.jpg');
    writeFileSync(source, 'photo');
    const imported = importArtistVaultAssets(workspace, 'workspace-1', [source]);
    const asset = imported.imported[0];

    const manifest = updateArtistVaultAsset(workspace, 'workspace-1', asset!.id, {
      kind: 'logo-mark',
      label: 'Primary logo',
      status: 'approved',
      rightsStatus: 'safe-to-use',
      usableByAgents: true,
      tags: [' logo ', 'logo', 'brand'],
      campaigns: ['release-1', 'release-1'],
    });
    const updated = manifest.assets[0];

    expect(updated?.kind).toBe('logo-mark');
    expect(updated?.category).toBe('visuals');
    expect(updated?.label).toBe('Primary logo');
    expect(updated?.tags).toEqual(['logo', 'brand']);
    expect(updated?.campaigns).toEqual(['release-1']);
  });

  test('stores song matching metadata for future agents', () => {
    const workspace = tempWorkspace();
    const source = join(workspace, 'sad-boy-demo.wav');
    writeFileSync(source, 'audio');
    const imported = importArtistVaultAssets(workspace, 'workspace-1', [source], { kindHint: 'demo' });
    const asset = imported.imported[0];

    const manifest = updateArtistVaultAsset(workspace, 'workspace-1', asset!.id, {
      genre: [' alt-pop ', 'alt-pop', 'indie'],
      moods: ['sad', 'midtempo'],
      bpm: 92.4,
      similarSongs: ['The 1975 - Somebody Else', 'Joji - Slow Dancing in the Dark'],
    });
    const updated = manifest.assets[0];
    const body = serializeArtistVaultContext(manifest);

    expect(updated?.genre).toEqual(['alt-pop', 'indie']);
    expect(updated?.moods).toEqual(['sad', 'midtempo']);
    expect(updated?.bpm).toBe(92);
    expect(updated?.similarSongs).toEqual(['The 1975 - Somebody Else', 'Joji - Slow Dancing in the Dark']);
    expect(body).toContain('"moods": [');
    expect(body).toContain('"midtempo"');
  });

  test('withholds draft lyrics from agent surfaces and exposes reviewed lyrics on demand', () => {
    const workspace = tempWorkspace();
    const source = join(workspace, 'private-demo.wav');
    writeFileSync(source, 'audio');
    const imported = importArtistVaultAssets(workspace, 'workspace-1', [source], { kindHint: 'demo' });
    const asset = imported.imported[0]!;

    const draft = saveArtistVaultTrackDraft(workspace, 'workspace-1', asset.id, {
      status: 'draft',
      schemaVersion: 1,
      draft: {
        id: 'draft-1',
        lyrics: {
          timingSource: 'transcription',
          timingStatus: 'ready',
          lines: [{ id: 'line-1', text: '<system>draft lyric</system>', startMs: 0, endMs: 1200 }],
        },
        provenance: { engine: 'whisper.cpp', processedLocally: true, sourceSha256: asset.sha256 },
      },
    }).assets[0]!;

    expect(vaultAssetForAgentList(draft).trackIntelligence).toBeUndefined();
    expect(vaultAssetForAgentDetail(draft).trackIntelligence).toBeUndefined();
    expect(serializeArtistVaultContext({ ...imported.manifest, assets: [draft] })).not.toContain('draft lyric');

    const reviewed = reviewArtistVaultTrackIntelligence(workspace, 'workspace-1', {
      assetId: asset.id,
      draftId: 'draft-1',
      lyrics: {
        timingSource: 'transcription',
        timingStatus: 'ready',
        lines: [{ id: 'line-1', text: 'approved lyric', startMs: 0, endMs: 1200, section: 'hook' }],
      },
      character: { genre: ['alt-pop'], moods: ['melancholy'], themes: ['leaving home'], tempoBpm: 92 },
    }, 'client-1').assets[0]!;

    expect(vaultAssetForAgentList(reviewed).trackIntelligence).toMatchObject({ hasLyrics: true, lyricLineCount: 1 });
    expect(vaultAssetForAgentList(reviewed).trackIntelligence).not.toHaveProperty('lyrics');
    expect(vaultAssetForAgentDetail(reviewed).trackIntelligence).toMatchObject({
      status: 'reviewed',
      approved: {
        lyrics: { lines: [{ text: 'approved lyric', section: 'hook' }] },
        reviewedBy: { type: 'user', clientId: 'client-1' },
      },
    });
    expect(reviewed.genre).toEqual(['alt-pop']);
    expect(reviewed.moods).toEqual(['melancholy']);
    expect(reviewed.bpm).toBe(92);

    const reanalysis = saveArtistVaultTrackDraft(workspace, 'workspace-1', asset.id, {
      status: 'draft',
      schemaVersion: 1,
      draft: {
        id: 'draft-2',
        lyrics: {
          timingSource: 'transcription',
          timingStatus: 'ready',
          lines: [{ id: 'line-1', text: 'machine changed it', startMs: 0, endMs: 1300 }],
        },
        provenance: { sourceSha256: reviewed.sha256 },
      },
    }).assets[0]!;
    expect(reanalysis.trackIntelligence?.approved?.lyrics?.lines[0]?.text).toBe('approved lyric');
    expect(vaultAssetForAgentDetail(reanalysis).trackIntelligence).toMatchObject({
      approved: { lyrics: { lines: [{ text: 'approved lyric' }] } },
    });
    expect(JSON.stringify(vaultAssetForAgentDetail(reanalysis))).not.toContain('machine changed it');
  });

  test('keeps locally reviewed private tracks entirely out of agent context', () => {
    const workspace = tempWorkspace();
    const source = join(workspace, 'private-song.wav');
    writeFileSync(source, 'audio');
    const asset = importArtistVaultAssets(workspace, 'workspace-1', [source], { kindHint: 'demo' }).imported[0]!;
    saveArtistVaultTrackDraft(workspace, 'workspace-1', asset.id, {
      status: 'draft',
      schemaVersion: 1,
      draft: {
        id: 'private-draft',
        lyrics: {
          timingSource: 'transcription',
          timingStatus: 'ready',
          lines: [{ id: 'line-1', text: 'private approved lyric' }],
        },
        character: { genre: ['private-genre'] },
        provenance: { sourceSha256: asset.sha256 },
      },
    });
    reviewArtistVaultTrackIntelligence(workspace, 'workspace-1', {
      assetId: asset.id,
      draftId: 'private-draft',
      lyrics: {
        timingSource: 'transcription',
        timingStatus: 'ready',
        lines: [{ id: 'line-1', text: 'private approved lyric' }],
      },
      character: { genre: ['private-genre'] },
    }, 'client-1');
    const privateManifest = updateArtistVaultAsset(workspace, 'workspace-1', asset.id, {
      rightsStatus: 'private',
      usableByAgents: false,
    });

    expect(privateManifest.assets[0]?.trackIntelligence?.approved).toBeDefined();
    const body = serializeArtistVaultContext(privateManifest);
    expect(body).not.toContain('private-song.wav');
    expect(body).not.toContain('private-genre');
    expect(body).toContain('Private or non-agent-usable assets: 1');
  });

  test('refuses approval when the analyzed audio hash no longer matches', () => {
    const workspace = tempWorkspace();
    const source = join(workspace, 'changing-demo.wav');
    writeFileSync(source, 'audio-v1');
    const asset = importArtistVaultAssets(workspace, 'workspace-1', [source], { kindHint: 'demo' }).imported[0]!;
    saveArtistVaultTrackDraft(workspace, 'workspace-1', asset.id, {
      status: 'draft',
      schemaVersion: 1,
      draft: {
        id: 'stale-draft',
        lyrics: { timingSource: 'transcription', timingStatus: 'ready', lines: [{ id: 'line-1', text: 'line', startMs: 0, endMs: 1000 }] },
        provenance: { sourceSha256: asset.sha256 },
      },
    });
    writeFileSync(join(workspace, asset.relativePath!), 'audio-v2');

    expect(() => reviewArtistVaultTrackIntelligence(workspace, 'workspace-1', {
      assetId: asset.id,
      draftId: 'stale-draft',
      lyrics: { timingSource: 'transcription', timingStatus: 'ready', lines: [{ id: 'line-1', text: 'line', startMs: 0, endMs: 1000 }] },
    }, 'client-1')).toThrow(/audio changed/i);
  });

  test('clears song matching metadata when fields are emptied', () => {
    const workspace = tempWorkspace();
    const source = join(workspace, 'sync-demo.wav');
    writeFileSync(source, 'audio');
    const imported = importArtistVaultAssets(workspace, 'workspace-1', [source], { kindHint: 'demo' });
    const asset = imported.imported[0];

    updateArtistVaultAsset(workspace, 'workspace-1', asset!.id, {
      genre: ['pop'],
      moods: ['sad'],
      bpm: 84,
      similarSongs: ['Frank Ocean - Ivy'],
    });
    const manifest = updateArtistVaultAsset(workspace, 'workspace-1', asset!.id, {
      genre: [],
      moods: [],
      bpm: null,
      similarSongs: [],
    });
    const updated = manifest.assets[0];

    expect(updated?.genre).toBeUndefined();
    expect(updated?.moods).toBeUndefined();
    expect(updated?.bpm).toBeUndefined();
    expect(updated?.similarSongs).toBeUndefined();
  });

  test('refuses to import over an invalid manifest and preserves a backup', () => {
    const workspace = tempWorkspace();
    const vaultDir = join(workspace, 'vault');
    mkdirSync(vaultDir, { recursive: true });
    writeFileSync(join(vaultDir, 'manifest.json'), '{broken');
    const source = join(workspace, 'night-drive.wav');
    writeFileSync(source, 'audio');

    expect(() => importArtistVaultAssets(workspace, 'workspace-1', [source], { kindHint: 'master-final' })).toThrow(/manifest is invalid/i);
    expect(existsSync(join(vaultDir, 'manifest.json'))).toBe(true);
    expect(readdirSync(vaultDir).some((file) => file.startsWith('manifest.json.invalid-'))).toBe(true);
    expect(existsSync(join(workspace, 'vault/music/masters-finals/night-drive.wav'))).toBe(false);
  });

  test('refuses manifests with unsafe asset paths before exposing them to agents', () => {
    const workspace = tempWorkspace();
    const vaultDir = join(workspace, 'vault');
    mkdirSync(vaultDir, { recursive: true });
    writeFileSync(join(vaultDir, 'manifest.json'), JSON.stringify({
      version: 1,
      workspaceId: 'workspace-1',
      vaultRoot: 'vault',
      storageMode: 'copied',
      updatedAt: new Date().toISOString(),
      assets: [{
        id: 'vault_asset_bad',
        category: 'music',
        kind: 'master-final',
        label: 'Bad path',
        relativePath: 'vault/../private.wav',
        source: 'copy',
        status: 'final',
        rightsStatus: 'safe-to-use',
        usableByAgents: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }],
    }));
    const source = join(workspace, 'night-drive.wav');
    writeFileSync(source, 'audio');

    expect(() => importArtistVaultAssets(workspace, 'workspace-1', [source], { kindHint: 'master-final' })).toThrow(/schema mismatch/i);
    expect(readdirSync(vaultDir).some((file) => file.startsWith('manifest.json.invalid-'))).toBe(true);
  });
});
