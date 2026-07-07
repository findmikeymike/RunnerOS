import { existsSync, mkdirSync, mkdtempSync, readdirSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import {
  artistVaultContextMetadata,
  classifyVaultAsset,
  getArtistVaultManifestPath,
  importArtistVaultAssets,
  importArtistVaultAssetsAsync,
  linkArtistVaultFolder,
  linkArtistVaultFolderAsync,
  loadArtistVaultManifest,
  planArtistVaultImports,
  scanArtistVault,
  serializeArtistVaultContext,
  updateArtistVaultAsset,
} from './index.ts';

function tempWorkspace(): string {
  return mkdtempSync(join(tmpdir(), 'artist-vault-'));
}

describe('artist vault', () => {
  test('classifies artist library filenames into Vault categories', () => {
    expect(classifyVaultAsset('/tmp/final-master.wav').kind).toBe('master-final');
    expect(classifyVaultAsset('/tmp/vocal-stem.wav').kind).toBe('stem');
    expect(classifyVaultAsset('/tmp/cover-art-v4.png').kind).toBe('cover-art');
    expect(classifyVaultAsset('/tmp/press-headshot.jpg').kind).toBe('artist-photo');
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

  test('copies files, writes manifest, and emits compact agent context', () => {
    const workspace = tempWorkspace();
    const master = join(workspace, 'night-drive-final.wav');
    const photo = join(workspace, 'press-headshot.jpg');
    writeFileSync(master, 'fake audio');
    writeFileSync(photo, 'fake image');

    importArtistVaultAssets(workspace, 'workspace-1', [master, photo]);
    const loaded = loadArtistVaultManifest(workspace, 'workspace-1');
    const body = serializeArtistVaultContext(loaded);

    expect(getArtistVaultManifestPath(workspace)).toContain('vault/manifest.json');
    expect(loaded.assets).toHaveLength(2);
    expect(loaded.assets.map((asset) => asset.kind).sort()).toEqual(['artist-photo', 'master-final']);
    expect(loaded.assets.every((asset) => asset.usableByAgents)).toBe(true);
    expect(loaded.assets.every((asset) => asset.status === 'final')).toBe(true);
    expect(body).toContain('"kind": "master-final"');
    expect(body).toContain('Final master: vault/music/masters-finals/night-drive-final.wav');
    expect(body).toContain('Press photo: vault/visuals/artist-photos/press-headshot.jpg');
    expect(body).toContain('Vault files are usable by agents by default.');
    expect(body).toContain('Private or non-agent-usable assets: 0');
    expect(artistVaultContextMetadata().description).toContain('song matching metadata');
    expect(artistVaultContextMetadata().routing).toEqual({ mode: 'broadcast' });
  });

  test('business assets default usable and redact paths when marked private', () => {
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
    expect(asset?.rightsStatus).toBe('safe-to-use');
    expect(asset?.usableByAgents).toBe(true);
    expect(privateAsset?.rightsStatus).toBe('private');
    expect(privateAsset?.usableByAgents).toBe(false);
    expect(asset?.relativePath).toBe('vault/business/splits/song-splitsheet.pdf');
    expect(body).toContain('"kind": "split-sheet"');
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
    mkdirSync(join(workspace, 'vault/music/masters-finals'), { recursive: true });
    mkdirSync(join(workspace, 'vault/business/contracts'), { recursive: true });
    writeFileSync(masterPath, 'manual audio');
    writeFileSync(contractPath, 'manual contract');

    const first = scanArtistVault(workspace, 'workspace-1');
    const second = scanArtistVault(workspace, 'workspace-1');
    const loaded = loadArtistVaultManifest(workspace, 'workspace-1');

    expect(first.added.map((asset) => asset.kind).sort()).toEqual(['contract', 'master-final']);
    expect(first.added.find((asset) => asset.kind === 'contract')?.usableByAgents).toBe(true);
    expect(first.added.find((asset) => asset.kind === 'master-final')?.usableByAgents).toBe(true);
    expect(second.added).toHaveLength(0);
    expect(loaded.assets).toHaveLength(2);
  });

  test('links an external folder without copying files and defaults assets usable', () => {
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
    expect(result.linked.every((asset) => asset.usableByAgents)).toBe(true);
    expect(result.manifest.storageMode).toBe('linked');
    expect(body).toContain(join(linkedFolder, 'approved-cover.png'));
    expect(body).toContain(join(linkedFolder, 'producer-contract.pdf'));
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
    expect(body).toContain(join(linkedFolder, 'session-contract.pdf'));
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
