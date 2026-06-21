import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const cli = resolve(import.meta.dirname, 'video-studio.mjs');
const tempDirs = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempProject() {
  const dir = mkdtempSync(join(tmpdir(), 'runneros-video-edit-'));
  tempDirs.push(dir);
  const projectPath = join(dir, 'video.runner-video.json');
  run(['create', dir, '--title', 'Edit Test', '--json']);
  const project = JSON.parse(readFileSync(projectPath, 'utf-8'));
  project.timeline.tracks[0].clips = [
    { id: 'clip-a', type: 'video', startMs: 1000, durationMs: 1000, label: 'A' },
    { id: 'clip-b', type: 'video', startMs: 3000, durationMs: 1000, label: 'B' },
  ];
  project.timeline.durationMs = 4000;
  writeFileSync(projectPath, `${JSON.stringify(project, null, 2)}\n`, 'utf-8');
  return projectPath;
}

function run(args, options = {}) {
  const child = spawnSync('node', [cli, ...args], { encoding: 'utf-8' });
  if (options.expectFailure) return child;
  expect(child.status, child.stderr || child.stdout).toBe(0);
  return JSON.parse(child.stdout);
}

function hasFfmpeg() {
  return spawnSync('ffmpeg', ['-version'], { encoding: 'utf-8' }).status === 0
    && spawnSync('ffprobe', ['-version'], { encoding: 'utf-8' }).status === 0;
}

function readProject(projectPath) {
  return JSON.parse(readFileSync(projectPath, 'utf-8'));
}

function averageFrameLuma(videoPath) {
  const frame = spawnSync('ffmpeg', [
    '-v', 'error',
    '-i', videoPath,
    '-frames:v', '1',
    '-f', 'rawvideo',
    '-pix_fmt', 'rgb24',
    '-',
  ]);
  expect(frame.status, frame.stderr?.toString() || frame.stdout?.toString()).toBe(0);
  const bytes = frame.stdout;
  let total = 0;
  for (let index = 0; index < bytes.length; index += 3) {
    total += (bytes[index] + bytes[index + 1] + bytes[index + 2]) / 3;
  }
  return total / (bytes.length / 3);
}

function averageBottomLuma(videoPath, atSeconds) {
  const frame = spawnSync('ffmpeg', [
    '-v',
    'error',
    '-ss',
    String(atSeconds),
    '-i',
    videoPath,
    '-vf',
    'crop=iw:ih/3:0:ih*2/3',
    '-frames:v',
    '1',
    '-f',
    'rawvideo',
    '-pix_fmt',
    'gray',
    '-',
  ]);
  expect(frame.status, frame.stderr?.toString() || frame.stdout?.toString()).toBe(0);
  const bytes = frame.stdout;
  let total = 0;
  for (const byte of bytes) total += byte;
  return total / Math.max(1, bytes.length);
}

function averageCaptionCenterLaneLuma(videoPath, atSeconds) {
  const frame = spawnSync('ffmpeg', [
    '-v',
    'error',
    '-ss',
    String(atSeconds),
    '-i',
    videoPath,
    '-vf',
    'crop=iw:30:0:65',
    '-frames:v',
    '1',
    '-f',
    'rawvideo',
    '-pix_fmt',
    'gray',
    '-',
  ]);
  expect(frame.status, frame.stderr?.toString() || frame.stdout?.toString()).toBe(0);
  const bytes = frame.stdout;
  let total = 0;
  for (const byte of bytes) total += byte;
  return total / Math.max(1, bytes.length);
}

function meanVolumeDb(videoPath) {
  const result = spawnSync('ffmpeg', [
    '-v',
    'info',
    '-i',
    videoPath,
    '-af',
    'volumedetect',
    '-f',
    'null',
    '-',
  ], { encoding: 'utf-8' });
  expect(result.status, result.stderr || result.stdout).toBe(0);
  const match = result.stderr.match(/mean_volume:\s*(-?inf|-?\d+(?:\.\d+)?) dB/);
  expect(match?.[1]).toBeTruthy();
  return match?.[1] === '-inf' ? -1000 : Number(match?.[1]);
}

describe('video-studio edit commands', () => {
  test('packs timeline clips end-to-start', () => {
    const projectPath = tempProject();

    run(['edit', projectPath, '--action', 'pack', '--json']);

    const clips = readProject(projectPath).timeline.tracks[0].clips;
    expect(clips.map((clip) => clip.startMs)).toEqual([0, 1000]);
  });

  test('splits, duplicates, and deletes clips', () => {
    const projectPath = tempProject();

    const split = run(['edit', projectPath, '--action', 'split', '--clip-id', 'clip-a', '--at-ms', '1500', '--json']);
    expect(split.createdClipId).toBeString();

    const duplicate = run(['edit', projectPath, '--action', 'duplicate', '--clip-id', split.createdClipId, '--json']);
    expect(duplicate.createdClipId).toBeString();

    run(['edit', projectPath, '--action', 'delete', '--clip-id', duplicate.createdClipId, '--json']);

    const clips = readProject(projectPath).timeline.tracks[0].clips;
    expect(clips.some((clip) => clip.id === duplicate.createdClipId)).toBe(false);
    expect(clips).toHaveLength(3);
    expect(run(['inspect', projectPath, '--json']).ok).toBe(true);
  });

  test('updates clip playback and audio settings', () => {
    const projectPath = tempProject();

    const updated = run([
      'edit',
      projectPath,
      '--action',
      'settings',
      '--clip-id',
      'clip-a',
      '--speed',
      '1.5',
      '--volume',
      '0.25',
      '--fade-in-ms',
      '120',
      '--fade-out-ms',
      '180',
      '--json',
    ]);

    expect(updated.updatedClipId).toBe('clip-a');
    const clip = readProject(projectPath).timeline.tracks[0].clips.find((item) => item.id === 'clip-a');
    expect(clip).toMatchObject({ speed: 1.5, volume: 0.25, fadeInMs: 120, fadeOutMs: 180 });
  });

  test('inspect fails on overlapping clips', () => {
    const projectPath = tempProject();
    const project = readProject(projectPath);
    project.timeline.tracks[0].clips[1].startMs = 1200;
    writeFileSync(projectPath, `${JSON.stringify(project, null, 2)}\n`, 'utf-8');

    const result = run(['inspect', projectPath, '--json'], { expectFailure: true });

    expect(result.status).toBe(1);
    const payload = JSON.parse(result.stdout);
    expect(payload.issues.some((issue) => issue.type === 'overlap')).toBe(true);
  });

  test('duplicate ripples by timeline time even when clips are stored out of order', () => {
    const projectPath = tempProject();
    const project = readProject(projectPath);
    project.timeline.tracks[0].clips = [
      { id: 'late-array-first', type: 'video', startMs: 1000, durationMs: 1000, label: 'Later' },
      { id: 'selected-earlier', type: 'video', startMs: 0, durationMs: 1000, label: 'Earlier' },
    ];
    writeFileSync(projectPath, `${JSON.stringify(project, null, 2)}\n`, 'utf-8');

    run(['edit', projectPath, '--action', 'duplicate', '--clip-id', 'selected-earlier', '--json']);

    expect(run(['inspect', projectPath, '--json']).ok).toBe(true);
    expect(readProject(projectPath).timeline.tracks[0].clips.map((clip) => clip.startMs)).toEqual([0, 1000, 2000]);
  });

  test('moves with snap and trims clips', () => {
    const projectPath = tempProject();

    const moved = run(['edit', projectPath, '--action', 'move', '--clip-id', 'clip-b', '--start-ms', '1900', '--snap', '--json']);
    expect(moved.startMs).toBe(2000);

    const trimmed = run(['edit', projectPath, '--action', 'trim', '--clip-id', 'clip-a', '--duration-ms', '750', '--source-in-ms', '100', '--source-out-ms', '850', '--json']);
    expect(trimmed.clipDurationMs).toBe(750);

    const clips = readProject(projectPath).timeline.tracks[0].clips;
    expect(clips.find((clip) => clip.id === 'clip-a')).toMatchObject({ durationMs: 750, sourceInMs: 100, sourceOutMs: 850 });
    expect(run(['inspect', projectPath, '--json']).ok).toBe(true);
  });

  test('probe reports real media metadata', () => {
    if (!hasFfmpeg()) return;
    const dir = mkdtempSync(join(tmpdir(), 'runneros-video-probe-'));
    tempDirs.push(dir);
    const sourcePath = join(dir, 'source.mp4');
    const fixture = spawnSync('ffmpeg', [
      '-y',
      '-f', 'lavfi',
      '-i', 'testsrc=size=160x90:rate=10',
      '-f', 'lavfi',
      '-i', 'sine=frequency=440:duration=2',
      '-t', '2',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      sourcePath,
    ], { encoding: 'utf-8' });
    expect(fixture.status, fixture.stderr || fixture.stdout).toBe(0);

    const probed = run(['probe', sourcePath, '--json']);

    expect(probed.type).toBe('video');
    expect(probed.width).toBe(160);
    expect(probed.height).toBe(90);
    expect(probed.fps).toBe(10);
    expect(probed.durationMs).toBeGreaterThanOrEqual(900);
    expect(probed.hasVideo).toBe(true);
    expect(probed.hasAudio).toBe(true);
    expect(probed.codec).toBeTruthy();
  });

  test('simple MP4 export preserves audio from video clips', () => {
    if (!hasFfmpeg()) return;
    const projectPath = tempProject();
    const projectDir = projectPath.replace('/video.runner-video.json', '');
    const sourcePath = `${projectDir}/source.mp4`;
    const outputPath = `${projectDir}/out.mp4`;
    const silentOutputPath = `${projectDir}/silent.mp4`;
    const fixture = spawnSync('ffmpeg', [
      '-y',
      '-f', 'lavfi',
      '-i', 'testsrc=size=160x90:rate=10',
      '-f', 'lavfi',
      '-i', 'sine=frequency=440:duration=2',
      '-t', '2',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      sourcePath,
    ], { encoding: 'utf-8' });
    expect(fixture.status, fixture.stderr || fixture.stdout).toBe(0);
    const project = readProject(projectPath);
    project.media.push({ id: 'media-video', type: 'video', label: 'Source', path: sourcePath, source: { kind: 'user-import' } });
    project.timeline.tracks[0].clips = [{
      id: 'clip-video',
      mediaId: 'media-video',
      type: 'video',
      startMs: 0,
      durationMs: 1000,
      label: 'Source',
      speed: 1.5,
      volume: 0.75,
      fadeInMs: 100,
      fadeOutMs: 100,
    }];
    project.timeline.durationMs = 1000;
    writeFileSync(projectPath, `${JSON.stringify(project, null, 2)}\n`, 'utf-8');

    run(['export', projectPath, '--out', outputPath, '--json']);

    const audioProbe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', outputPath], { encoding: 'utf-8' });
    expect(audioProbe.status).toBe(0);
    expect(audioProbe.stdout.trim()).not.toBe('');

    project.timeline.tracks[0].clips[0].volume = 0;
    writeFileSync(projectPath, `${JSON.stringify(project, null, 2)}\n`, 'utf-8');
    run(['export', projectPath, '--out', silentOutputPath, '--json']);
    expect(meanVolumeDb(silentOutputPath)).toBeLessThan(meanVolumeDb(outputPath) - 20);
  });

  test('export fails when speed outruns known source duration', () => {
    if (!hasFfmpeg()) return;
    const projectPath = tempProject();
    const projectDir = projectPath.replace('/video.runner-video.json', '');
    const sourcePath = `${projectDir}/source.mp4`;
    const outputPath = `${projectDir}/too-fast.mp4`;
    const fixture = spawnSync('ffmpeg', [
      '-y',
      '-f', 'lavfi',
      '-i', 'testsrc=size=160x90:rate=10:duration=2',
      '-t', '2',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      sourcePath,
    ], { encoding: 'utf-8' });
    expect(fixture.status, fixture.stderr || fixture.stdout).toBe(0);
    const project = readProject(projectPath);
    project.media.push({ id: 'media-video', type: 'video', label: 'Source', path: sourcePath, durationMs: 2000, source: { kind: 'user-import' } });
    project.timeline.tracks[0].clips = [{ id: 'clip-video', mediaId: 'media-video', type: 'video', startMs: 0, durationMs: 2000, label: 'Source', speed: 2 }];
    project.timeline.durationMs = 2000;
    writeFileSync(projectPath, `${JSON.stringify(project, null, 2)}\n`, 'utf-8');

    const result = run(['export', projectPath, '--out', outputPath, '--json'], { expectFailure: true });

    expect(result.status).toBe(1);
    expect(result.stderr || result.stdout).toContain('speed requires');
  });

  test('simple MP4 export burns project captions into video', () => {
    if (!hasFfmpeg()) return;
    const projectPath = tempProject();
    const project = readProject(projectPath);
    const outputPath = join(dirname(projectPath), 'captioned.mp4');
    project.settings = { ...project.settings, aspectRatio: 'custom', width: 320, height: 180, fps: 10 };
    project.timeline.tracks[0].clips = [];
    project.timeline.tracks[2].clips = [{
      id: 'caption-clip',
      type: 'caption',
      startMs: 100,
      durationMs: 1500,
      label: 'HELLO CAPTION TEST',
      captionCueIds: ['cue-1'],
    }];
    project.captions = [{
      id: 'captions-1',
      label: 'Captions',
      cues: [{ id: 'cue-1', startMs: 100, durationMs: 1500, text: 'HELLO CAPTION TEST' }],
    }];
    project.timeline.durationMs = 1800;
    writeFileSync(projectPath, `${JSON.stringify(project, null, 2)}\n`, 'utf-8');

    run(['export', projectPath, '--out', outputPath, '--json']);

    expect(averageBottomLuma(outputPath, 0.5)).toBeGreaterThan(20);
    expect(averageCaptionCenterLaneLuma(outputPath, 0.5)).toBeLessThan(20);
  });

  test('simple MP4 export handles caption punctuation safely', () => {
    if (!hasFfmpeg()) return;
    const projectPath = tempProject();
    const project = readProject(projectPath);
    const outputPath = join(dirname(projectPath), 'punctuation-caption.mp4');
    project.settings = { ...project.settings, aspectRatio: 'custom', width: 320, height: 180, fps: 10 };
    project.timeline.tracks[0].clips = [];
    project.timeline.tracks[2].clips = [{
      id: 'caption-clip',
      type: 'caption',
      startMs: 100,
      durationMs: 1200,
      label: "It's ok: yes, now; [100%]",
      captionCueIds: ['cue-1'],
    }];
    project.captions = [{
      id: 'captions-1',
      label: 'Captions',
      cues: [{ id: 'cue-1', startMs: 100, durationMs: 1200, text: "It's ok: yes, now; [100%]" }],
    }];
    project.timeline.durationMs = 1600;
    writeFileSync(projectPath, `${JSON.stringify(project, null, 2)}\n`, 'utf-8');

    run(['export', projectPath, '--out', outputPath, '--json']);
  });

  test('simple MP4 export uses caption clip timing instead of raw cue timing', () => {
    if (!hasFfmpeg()) return;
    const projectPath = tempProject();
    const project = readProject(projectPath);
    const outputPath = join(dirname(projectPath), 'moved-caption.mp4');
    project.settings = { ...project.settings, aspectRatio: 'custom', width: 320, height: 180, fps: 10 };
    project.timeline.tracks[0].clips = [];
    project.timeline.tracks[2].clips = [{
      id: 'caption-clip',
      type: 'caption',
      startMs: 1000,
      durationMs: 700,
      label: 'MOVED CAPTION TEST',
      captionCueIds: ['cue-1'],
    }];
    project.captions = [{
      id: 'captions-1',
      label: 'Captions',
      cues: [{ id: 'cue-1', startMs: 100, durationMs: 1500, text: 'MOVED CAPTION TEST' }],
    }];
    project.timeline.durationMs = 1800;
    writeFileSync(projectPath, `${JSON.stringify(project, null, 2)}\n`, 'utf-8');

    run(['export', projectPath, '--out', outputPath, '--json']);

    expect(averageBottomLuma(outputPath, 0.5)).toBeLessThan(20);
    expect(averageBottomLuma(outputPath, 1.2)).toBeGreaterThan(20);
  });

  test('simple MP4 export honors hidden and disabled caption clips', () => {
    if (!hasFfmpeg()) return;
    const projectPath = tempProject();
    const project = readProject(projectPath);
    const hiddenOutput = join(dirname(projectPath), 'hidden-caption.mp4');
    const disabledOutput = join(dirname(projectPath), 'disabled-caption.mp4');
    project.settings = { ...project.settings, aspectRatio: 'custom', width: 320, height: 180, fps: 10 };
    project.timeline.tracks[0].clips = [];
    project.timeline.tracks[2].hidden = true;
    project.timeline.tracks[2].clips = [{
      id: 'caption-clip',
      type: 'caption',
      startMs: 100,
      durationMs: 1500,
      label: 'HIDDEN CAPTION TEST',
      captionCueIds: ['cue-1'],
    }];
    project.captions = [{
      id: 'captions-1',
      label: 'Captions',
      cues: [{ id: 'cue-1', startMs: 100, durationMs: 1500, text: 'HIDDEN CAPTION TEST' }],
    }];
    project.timeline.durationMs = 1800;
    writeFileSync(projectPath, `${JSON.stringify(project, null, 2)}\n`, 'utf-8');

    run(['export', projectPath, '--out', hiddenOutput, '--json']);

    expect(averageBottomLuma(hiddenOutput, 0.5)).toBeLessThan(20);

    project.timeline.tracks[2].hidden = false;
    project.timeline.tracks[2].clips[0].disabled = true;
    writeFileSync(projectPath, `${JSON.stringify(project, null, 2)}\n`, 'utf-8');

    run(['export', projectPath, '--out', disabledOutput, '--json']);

    expect(averageBottomLuma(disabledOutput, 0.5)).toBeLessThan(20);
  });

  test('simple MP4 export fails loudly instead of silently truncating caption cues', () => {
    const projectPath = tempProject();
    const project = readProject(projectPath);
    const outputPath = join(dirname(projectPath), 'long-captions.mp4');
    const cues = Array.from({ length: 201 }, (_, index) => ({
      id: `cue-${index}`,
      startMs: index * 10,
      durationMs: 5,
      text: `Caption ${index}`,
    }));
    project.timeline.tracks[0].clips = [];
    project.timeline.tracks[2].clips = cues.map((cue) => ({
      id: `clip-${cue.id}`,
      type: 'caption',
      startMs: cue.startMs,
      durationMs: cue.durationMs,
      label: cue.text,
      captionCueIds: [cue.id],
    }));
    project.captions = [{ id: 'captions-long', label: 'Captions', cues }];
    project.timeline.durationMs = 3000;
    writeFileSync(projectPath, `${JSON.stringify(project, null, 2)}\n`, 'utf-8');

    const result = run(['export', projectPath, '--out', outputPath, '--json'], { expectFailure: true });

    expect(result.status).toBe(1);
    expect(result.stderr || result.stdout).toContain('at most 200 caption cues');
  });

  test('simple MP4 export applies clip look adjustments', () => {
    if (!hasFfmpeg()) return;
    const projectPath = tempProject();
    const projectDir = projectPath.replace('/video.runner-video.json', '');
    const sourcePath = `${projectDir}/gray.mp4`;
    const baselinePath = `${projectDir}/baseline.mp4`;
    const adjustedPath = `${projectDir}/adjusted.mp4`;
    const fixture = spawnSync('ffmpeg', [
      '-y',
      '-f', 'lavfi',
      '-i', 'color=c=gray:s=64x64:r=10:d=1',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      sourcePath,
    ], { encoding: 'utf-8' });
    expect(fixture.status, fixture.stderr || fixture.stdout).toBe(0);
    const project = readProject(projectPath);
    project.settings = { ...project.settings, aspectRatio: 'custom', width: 64, height: 64, fps: 10 };
    project.media.push({ id: 'media-gray', type: 'video', label: 'Gray', path: sourcePath, source: { kind: 'user-import' } });
    project.timeline.tracks[0].clips = [{ id: 'clip-gray', mediaId: 'media-gray', type: 'video', startMs: 0, durationMs: 1000, label: 'Gray' }];
    project.timeline.durationMs = 1000;
    writeFileSync(projectPath, `${JSON.stringify(project, null, 2)}\n`, 'utf-8');

    run(['export', projectPath, '--out', baselinePath, '--json']);
    project.timeline.tracks[0].clips[0].adjustments = { exposure: 0.6, contrast: 1.2, saturation: 1, preset: 'manual' };
    writeFileSync(projectPath, `${JSON.stringify(project, null, 2)}\n`, 'utf-8');
    run(['export', projectPath, '--out', adjustedPath, '--json']);

    expect(averageFrameLuma(adjustedPath)).toBeGreaterThan(averageFrameLuma(baselinePath) + 25);
  });

  test('export preset controls output dimensions', () => {
    if (!hasFfmpeg()) return;
    const projectPath = tempProject();
    const project = readProject(projectPath);
    project.settings = { ...project.settings, aspectRatio: 'custom', width: 64, height: 64, fps: 10 };
    project.timeline.tracks[0].clips = [{ id: 'title', type: 'text', startMs: 0, durationMs: 1000, label: 'Title', text: { text: 'Title', fontSize: 32, color: '#ffffff' } }];
    project.timeline.durationMs = 1000;
    writeFileSync(projectPath, `${JSON.stringify(project, null, 2)}\n`, 'utf-8');
    const outputPath = join(dirname(projectPath), 'square.mp4');

    const exported = run(['export', projectPath, '--out', outputPath, '--preset', 'mp4-1x1-1080', '--json']);

    expect(exported.preset).toBe('mp4-1x1-1080');
    expect(exported.width).toBe(1080);
    expect(exported.height).toBe(1080);
    const dimensions = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', outputPath], { encoding: 'utf-8' });
    expect(dimensions.status).toBe(0);
    expect(dimensions.stdout.trim()).toBe('1080x1080');
  });
});
