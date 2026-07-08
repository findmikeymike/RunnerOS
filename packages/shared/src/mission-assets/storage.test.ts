import { existsSync, mkdirSync, mkdtempSync, readdirSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import {
  classifyMissionAsset,
  getMissionAssetManifestPath,
  importMissionAssets,
  importMissionAssetsAsync,
  loadMissionAssetManifest,
  missionAssetContextMetadata,
  planMissionAssetImports,
  saveMissionLyricsAsync,
  scanMissionAssets,
  serializeMissionAssetContext,
} from './index.ts';

function tempWorkspace(): string {
  return mkdtempSync(join(tmpdir(), 'runner-mission-assets-'));
}

describe('mission assets', () => {
  test('classifies common artist asset filenames', () => {
    expect(classifyMissionAsset('/tmp/final-master.wav').kind).toBe('master');
    expect(classifyMissionAsset('/tmp/vocal-stem.wav').kind).toBe('stem');
    expect(classifyMissionAsset('/tmp/cover-art-v4.png').kind).toBe('cover-art');
    expect(classifyMissionAsset('/tmp/lyrics-final.txt').kind).toBe('lyrics');
    expect(classifyMissionAsset('/tmp/studio-bts.mov').kind).toBe('raw-video');
  });

  test('plans destination paths and avoids collisions within one import batch', () => {
    const workspace = tempWorkspace();
    const first = join(workspace, 'source-master.wav');
    const second = join(workspace, 'other', 'source-master.wav');
    mkdirSync(join(workspace, 'other'), { recursive: true });
    writeFileSync(first, 'audio-one');
    writeFileSync(second, 'audio-two');

    const plan = planMissionAssetImports(workspace, [first, second], { kindHint: 'master' });

    expect(plan.skipped).toEqual([]);
    expect(plan.candidates.map((candidate) => candidate.destinationRelativePath)).toEqual([
      'assets/audio/masters/source-master.wav',
      'assets/audio/masters/source-master-2.wav',
    ]);
  });

  test('copies files, writes manifest, and emits compact agent context', () => {
    const workspace = tempWorkspace();
    const source = join(workspace, 'night-drive-final.wav');
    writeFileSync(source, 'fake audio');

    const result = importMissionAssets(workspace, 'workspace-1', [source], { kindHint: 'master' });
    const loaded = loadMissionAssetManifest(workspace, 'workspace-1');
    const body = serializeMissionAssetContext(loaded);
    const imported = result.imported[0];
    const loadedFile = loaded.files[0];

    expect(result.imported).toHaveLength(1);
    expect(imported?.relativePath).toBe('assets/audio/masters/night-drive-final.wav');
    expect(getMissionAssetManifestPath(workspace)).toContain('assets/manifest.json');
    expect(loadedFile?.kind).toBe('master');
    expect(body).toContain('"kind": "master"');
    expect(body).toContain('Master: assets/audio/masters/night-drive-final.wav');
    expect(body).toContain('Audio files: 1');
    expect(body).toContain('Raw video: 0');
    expect(missionAssetContextMetadata().routing).toEqual({ mode: 'broadcast' });
  });

  test('does not hash very large media into memory', () => {
    const workspace = tempWorkspace();
    const source = join(workspace, 'huge-video.mov');
    writeFileSync(source, '');
    truncateSync(source, 257 * 1024 * 1024);

    const result = importMissionAssets(workspace, 'workspace-1', [source]);
    const imported = result.imported[0];

    expect(result.imported).toHaveLength(1);
    expect(imported?.sizeBytes).toBe(257 * 1024 * 1024);
    expect(imported?.sha256).toBeUndefined();
  });

  test('saves approved lyrics as canonical mission context', async () => {
    const workspace = tempWorkspace();
    const source = join(workspace, 'night-drive-final.wav');
    writeFileSync(source, 'fake audio');
    const imported = importMissionAssets(workspace, 'workspace-1', [source], { kindHint: 'master' }).imported[0];

    const result = await saveMissionLyricsAsync(workspace, 'workspace-1', {
      sourceAudioAssetId: imported?.id,
      lyricsText: 'first line\nsecond line',
      lyricLines: [
        { text: 'first line', start_time: 0, end_time: 2.5 },
        { text: 'second line', start_time: 2.5, end_time: 5 },
      ],
    });
    const body = serializeMissionAssetContext(result.manifest);

    expect(result.lyricsAsset.kind).toBe('lyrics');
    expect(result.lyricsAsset.lyrics?.reviewRequired).toBe(false);
    expect(result.lyricsAsset.lyrics?.sourceAudioAssetId).toBe(imported?.id);
    expect(result.lyricsAsset.relativePath).toContain('assets/docs/lyrics/');
    expect(existsSync(join(workspace, result.lyricsAsset.relativePath!))).toBe(true);
    expect(body).toContain('Lyrics status: approved');
    expect(body).toContain('first line');
    expect(body).toContain('Timed Lyric Lines');
  });

  test('imports plain lyrics text as review-needed callable lyrics', async () => {
    const workspace = tempWorkspace();
    const source = join(workspace, 'lyrics-final.txt');
    writeFileSync(source, 'line one\nline two\n');

    const result = await importMissionAssetsAsync(workspace, 'workspace-1', [source], { kindHint: 'lyrics' });
    const imported = result.imported[0];
    const body = serializeMissionAssetContext(result.manifest);

    expect(imported?.kind).toBe('lyrics');
    expect(imported?.lyrics?.text).toBe('line one\nline two');
    expect(imported?.lyrics?.reviewRequired).toBe(true);
    expect(imported?.lyrics?.status).toBe('manual');
    expect(body).toContain('Lyrics status: needs review');
    expect(body).toContain('line one');
  });

  test('async import copies media and writes manifest', async () => {
    const workspace = tempWorkspace();
    const source = join(workspace, 'cover-art.png');
    writeFileSync(source, 'fake image');

    const result = await importMissionAssetsAsync(workspace, 'workspace-1', [source], { kindHint: 'cover-art' });
    const imported = result.imported[0];

    expect(result.imported).toHaveLength(1);
    expect(imported?.relativePath).toBe('assets/images/cover-art/cover-art.png');
    expect(existsSync(join(workspace, 'assets/images/cover-art/cover-art.png'))).toBe(true);
  });

  test('scans manually dropped vault files into the manifest once', () => {
    const workspace = tempWorkspace();
    const masterPath = join(workspace, 'assets/audio/masters/live-master.wav');
    const rawVideoPath = join(workspace, 'assets/video/raw/studio-bts.mov');
    mkdirSync(join(workspace, 'assets/audio/masters'), { recursive: true });
    mkdirSync(join(workspace, 'assets/video/raw'), { recursive: true });
    writeFileSync(masterPath, 'manual audio');
    writeFileSync(rawVideoPath, 'manual video');

    const first = scanMissionAssets(workspace, 'workspace-1');
    const second = scanMissionAssets(workspace, 'workspace-1');
    const loaded = loadMissionAssetManifest(workspace, 'workspace-1');

    expect(first.added.map((file) => file.kind).sort()).toEqual(['master', 'raw-video']);
    expect(first.added.every((file) => file.source === 'manual')).toBe(true);
    expect(second.added).toHaveLength(0);
    expect(loaded.files).toHaveLength(2);
  });

  test('refuses to import over an invalid manifest and preserves a backup', () => {
    const workspace = tempWorkspace();
    const assetsDir = join(workspace, 'assets');
    mkdirSync(assetsDir, { recursive: true });
    writeFileSync(join(assetsDir, 'manifest.json'), '{broken');
    const source = join(workspace, 'night-drive.wav');
    writeFileSync(source, 'audio');

    expect(() => importMissionAssets(workspace, 'workspace-1', [source], { kindHint: 'master' })).toThrow(/manifest is invalid/i);
    expect(existsSync(join(assetsDir, 'manifest.json'))).toBe(true);
    expect(readdirSync(assetsDir).some((file) => file.startsWith('manifest.json.invalid-'))).toBe(true);
    expect(existsSync(join(workspace, 'assets/audio/masters/night-drive.wav'))).toBe(false);
  });
});
