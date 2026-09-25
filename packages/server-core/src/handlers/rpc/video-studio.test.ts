import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { withVideoProjectLock, commitImportedVideoProject, clipDurationForImport, collectImportableVideoStudioFiles, generateVideoMediaDerivatives, generateVideoMediaDerivativesAsync, probeMediaMetadata } from './video-studio';

import { createRunnerVideoProject, readVideoProjectWithContent, writeVideoProject } from '@craft-agent/shared/video';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'runneros-video-folder-'));
  tempDirs.push(dir);
  return dir;
}

describe('collectImportableVideoStudioFiles', () => {
  test('recursively collects export-safe media files from a folder', () => {
    const root = makeTempDir();
    const nested = join(root, 'nested');
    mkdirSync(nested);
    const video = join(root, 'clip.mp4');
    const image = join(nested, 'frame.png');
    const audio = join(nested, 'track.wav');
    const caption = join(root, 'captions.srt');
    const note = join(root, 'notes.txt');
    for (const path of [video, image, audio, caption, note]) writeFileSync(path, 'x');

    const result = collectImportableVideoStudioFiles([root]);

    expect(result.files.sort()).toEqual([audio, caption, image, video].sort());
    expect(result.skipped).toBe(1);
  });

  test('caps collected files and counts overflow as skipped', () => {
    const root = makeTempDir();
    const first = join(root, 'a.mp4');
    const second = join(root, 'b.mp4');
    writeFileSync(first, 'x');
    writeFileSync(second, 'x');

    const result = collectImportableVideoStudioFiles([root], 1);

    expect(result.files).toHaveLength(1);
    expect(result.skipped).toBe(1);
  });
});

describe('clipDurationForImport', () => {
  test('keeps image imports at the editor default duration', () => {
    expect(clipDurationForImport('/does/not/need/to/exist.png', 'image')).toBe(3000);
  });

  test('falls back when ffprobe cannot read video duration', () => {
    const root = makeTempDir();
    const bogusVideo = join(root, 'bogus.mp4');
    writeFileSync(bogusVideo, 'not a real mp4');

    expect(clipDurationForImport(bogusVideo, 'video')).toBe(5000);
  });

  test('probes real video duration, dimensions, fps, and streams', () => {
    const root = makeTempDir();
    const video = join(root, 'probe.mp4');
    const fixture = spawnSync('ffmpeg', [
      '-y',
      '-f', 'lavfi',
      '-i', 'testsrc=size=160x90:rate=10',
      '-f', 'lavfi',
      '-i', 'sine=frequency=440:duration=1',
      '-t', '1',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      video,
    ], { encoding: 'utf-8' });
    expect(fixture.status, fixture.stderr || fixture.stdout).toBe(0);

    const metadata = probeMediaMetadata(video, 'video');

    expect(metadata.durationMs).toBeGreaterThanOrEqual(900);
    expect(metadata.durationMs).toBeLessThanOrEqual(1200);
    expect(metadata.width).toBe(160);
    expect(metadata.height).toBe(90);
    expect(metadata.fps).toBe(10);
    expect(metadata.hasVideo).toBe(true);
    expect(metadata.hasAudio).toBe(true);
    expect(metadata.codec).toBeTruthy();
  });

  test('generates thumbnail and waveform derivatives for video with audio', () => {
    const root = makeTempDir();
    const video = join(root, 'source.mp4');
    const fixture = spawnSync('ffmpeg', [
      '-y',
      '-f', 'lavfi',
      '-i', 'testsrc=size=160x90:rate=10',
      '-f', 'lavfi',
      '-i', 'sine=frequency=440:duration=1',
      '-t', '1',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      video,
    ], { encoding: 'utf-8' });
    expect(fixture.status, fixture.stderr || fixture.stdout).toBe(0);

    const derivatives = generateVideoMediaDerivatives(video, 'video', { hasAudio: true }, {
      thumbnailPath: join(root, 'thumbs', 'source.jpg'),
      waveformPath: join(root, 'waves', 'source.png'),
    });

    expect(derivatives.thumbnailPath).toBeTruthy();
    expect(derivatives.waveformPath).toBeTruthy();
    expect(existsSync(derivatives.thumbnailPath!)).toBe(true);
    expect(existsSync(derivatives.waveformPath!)).toBe(true);
  });

  test('generates derivatives through async ffmpeg helper', async () => {
    const root = makeTempDir();
    const video = join(root, 'source-async.mp4');
    const fixture = spawnSync('ffmpeg', [
      '-y',
      '-f', 'lavfi',
      '-i', 'testsrc=size=160x90:rate=10',
      '-t', '1',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      video,
    ], { encoding: 'utf-8' });
    expect(fixture.status, fixture.stderr || fixture.stdout).toBe(0);

    const derivatives = await generateVideoMediaDerivativesAsync(video, 'video', { hasAudio: false }, {
      thumbnailPath: join(root, 'thumbs', 'source-async.jpg'),
      waveformPath: join(root, 'waves', 'source-async.png'),
    });

    expect(derivatives.thumbnailPath).toBeTruthy();
    expect(derivatives.waveformPath).toBeUndefined();
    expect(existsSync(derivatives.thumbnailPath!)).toBe(true);
  });
});


describe('import commit preserves intervening edits', () => {
  test('refuses a stale import after another editor saved', () => {
    const path = join(makeTempDir(), 'video.runner-video.json');
    const project = createRunnerVideoProject({ workspaceId: 'test', title: 'Before import' });
    writeVideoProject(path, project);
    const baseline = readFileSync(path, 'utf-8');
    writeVideoProject(path, { ...project, title: 'Other editor saved this' }, { expectedContent: baseline });
    const newer = readFileSync(path, 'utf-8');
    expect(() => commitImportedVideoProject(path, baseline, { ...project, title: 'Stale import' })).toThrow('newer edits are preserved');
    expect(readFileSync(path, 'utf-8')).toBe(newer);
  });

  test('commits an import when the saved project is unchanged', () => {
    const path = join(makeTempDir(), 'video.runner-video.json');
    const project = createRunnerVideoProject({ workspaceId: 'test', title: 'Before import' });
    writeVideoProject(path, project);
    const baseline = readFileSync(path, 'utf-8');
    commitImportedVideoProject(path, baseline, { ...project, title: 'Imported safely' });
    expect(JSON.parse(readFileSync(path, 'utf-8')).title).toBe('Imported safely');
  });
});


test('busy project rejects overlapping work without running it later and releases after failure', async () => {
  const projectPath = join(makeTempDir(), 'project.json');
  let release!: () => void;
  const pending = withVideoProjectLock(projectPath, () => new Promise<void>(resolve => { release = resolve; }));
  let overlapRan = false;
  await expect(withVideoProjectLock(projectPath, () => { overlapRan = true; })).rejects.toThrow('busy');
  expect(overlapRan).toBe(false);
  await expect(withVideoProjectLock(`${projectPath}.other`, () => 'independent')).resolves.toBe('independent');
  release();
  await pending;
  expect(overlapRan).toBe(false);
  await expect(withVideoProjectLock(projectPath, () => { throw new Error('failed render'); })).rejects.toThrow('failed render');
  await expect(withVideoProjectLock(projectPath, () => 'retry')).resolves.toBe('retry');
});


test('import snapshot keeps model and baseline paired when another writer commits', () => {
  const path = join(makeTempDir(), 'video.runner-video.json');
  writeVideoProject(path, createRunnerVideoProject({ workspaceId: 'test', title: 'Original' }));
  const snapshot = readVideoProjectWithContent(path);
  expect(JSON.parse(snapshot.content).title).toBe(snapshot.project.title);
  writeVideoProject(path, { ...snapshot.project, title: 'Newer edit' }, { expectedContent: snapshot.content });
  snapshot.project.title = 'Stale import';
  expect(() => commitImportedVideoProject(path, snapshot.content, snapshot.project)).toThrow('newer edits are preserved');
  expect(JSON.parse(readFileSync(path, 'utf-8')).title).toBe('Newer edit');
});
