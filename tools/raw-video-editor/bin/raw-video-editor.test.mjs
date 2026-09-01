import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { analyzeMasterSync, fitLinearMapping, fitRobustLinearMapping } from './audio-sync.mjs';

const cli = resolve(import.meta.dirname, 'raw-video-editor.mjs');
const tempDirs = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function hasFfmpeg() {
  return spawnSync('ffmpeg', ['-version'], { encoding: 'utf-8' }).status === 0
    && spawnSync('ffprobe', ['-version'], { encoding: 'utf-8' }).status === 0;
}

function hasWhisper() {
  return spawnSync('whisper', ['--help'], { encoding: 'utf-8' }).status === 0;
}

function tempFootage() {
  const dir = mkdtempSync(join(tmpdir(), 'runneros-raw-video-'));
  tempDirs.push(dir);
  const fixture = join(dir, 'clip-a.mp4');
  const child = spawnSync('ffmpeg', [
    '-y',
    '-f', 'lavfi',
    '-i', 'testsrc2=size=1280x720:rate=30',
    '-f', 'lavfi',
    '-i', 'sine=frequency=880:sample_rate=44100',
    '-t', '2',
    '-c:v', 'libx264',
    '-c:a', 'aac',
    '-pix_fmt', 'yuv420p',
    fixture,
  ], { encoding: 'utf-8' });
  expect(child.status, child.stderr || child.stdout).toBe(0);
  return dir;
}

function run(args) {
  const child = spawnSync('node', [cli, ...args], { encoding: 'utf-8' });
  expect(child.status, child.stderr || child.stdout).toBe(0);
  return JSON.parse(child.stdout);
}

function runFailure(args) {
  const child = spawnSync('node', [cli, ...args], { encoding: 'utf-8' });
  expect(child.status).toBe(1);
  return JSON.parse(child.stdout);
}

function writeMonoWav(path, durationSeconds = 24, sampleRate = 8_000, variant = 0) {
  const sampleCount = Math.round(durationSeconds * sampleRate);
  const dataSize = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let index = 0; index < sampleCount; index += 1) {
    const time = index / sampleRate;
    const section = Math.floor(time / 0.75);
    const primary = 130 + ((section * (83 + variant * 7) + variant * 211) % 1_100);
    const secondary = 210 + ((section * (47 + variant * 11) + variant * 137) % 780);
    const pulse = 0.35 + 0.65 * Math.max(0, Math.sin(Math.PI * 2 * (1.2 + (section + variant) % 3) * time));
    const sample = pulse * (
      0.38 * Math.sin(Math.PI * 2 * primary * time)
      + 0.2 * Math.sin(Math.PI * 2 * secondary * time)
    );
    buffer.writeInt16LE(Math.round(clampSample(sample) * 32767), 44 + index * 2);
  }
  writeFileSync(path, buffer);
}

function clampSample(value) {
  return Math.max(-1, Math.min(1, value));
}

function masterSyncFixture({
  noiseOnly = false,
  playbackRate = 1,
  duration = 12,
  masterStart = 5.2,
  masterDuration = 24,
  wrongSong = false,
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'runneros-master-sync-fixture-'));
  tempDirs.push(dir);
  const master = join(dir, 'master.wav');
  const cameraMaster = wrongSong ? join(dir, 'different-song.wav') : master;
  const video = join(dir, noiseOnly ? 'noise-camera.mp4' : wrongSong ? 'wrong-song-camera.mp4' : 'performance.mp4');
  writeMonoWav(master, masterDuration);
  if (wrongSong) writeMonoWav(cameraMaster, masterDuration, 8_000, 7);
  const audioInputs = noiseOnly
    ? ['-f', 'lavfi', '-i', `anoisesrc=color=pink:amplitude=0.08:sample_rate=8000:duration=${duration}`]
    : [
        '-ss', String(masterStart), '-t', String(duration * playbackRate), '-i', cameraMaster,
        '-f', 'lavfi', '-i', `anoisesrc=color=pink:amplitude=0.012:sample_rate=8000:duration=${duration}`,
      ];
  const filter = noiseOnly
    ? '[1:a]anull[a]'
    : `[1:a]volume=0.12,lowpass=f=1600,atempo=${playbackRate}[song];[song][2:a]amix=inputs=2:duration=first:normalize=0[a]`;
  const child = spawnSync('ffmpeg', [
    '-y',
    '-f', 'lavfi',
    '-i', `testsrc2=size=640x360:rate=24:duration=${duration}`,
    ...audioInputs,
    '-filter_complex', filter,
    '-map', '0:v:0',
    '-map', '[a]',
    '-t', String(duration),
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-c:a', 'aac',
    '-pix_fmt', 'yuv420p',
    video,
  ], { encoding: 'utf-8' });
  expect(child.status, child.stderr || child.stdout).toBe(0);
  return { dir, master, video };
}

describe('raw-video-editor cli', () => {
  test('fits offset and clock drift from multiple observations', () => {
    const fitted = fitLinearMapping([
      { videoSeconds: 0, masterSeconds: 4.25, weight: 1 },
      { videoSeconds: 20, masterSeconds: 24.254, weight: 1 },
      { videoSeconds: 40, masterSeconds: 44.258, weight: 1 },
    ]);
    expect(fitted?.intercept).toBeCloseTo(4.25, 4);
    expect(fitted?.slope).toBeCloseTo(1.0002, 6);
    expect(fitted?.residualSeconds).toBeLessThan(0.0001);
  });

  test('rejects one bad drift observation instead of pulling the whole alignment', () => {
    const fitted = fitRobustLinearMapping([
      { videoSeconds: 0, masterSeconds: 4.25, weight: 1 },
      { videoSeconds: 20, masterSeconds: 24.254, weight: 1 },
      { videoSeconds: 40, masterSeconds: 44.258, weight: 1 },
      { videoSeconds: 60, masterSeconds: 65.4, weight: 1 },
    ]);
    expect(fitted?.intercept).toBeCloseTo(4.25, 3);
    expect(fitted?.slope).toBeCloseTo(1.0002, 5);
    expect(fitted?.residualSeconds).toBeLessThan(0.001);
  });

  test('matches quiet scratch playback to a master and renders a verified preview', () => {
    if (!hasFfmpeg()) return;
    const { master, video, dir } = masterSyncFixture();
    const analysis = run(['sync-master', video, master, '--analyze-only', '--json']);
    expect(analysis.ok).toBe(true);
    expect(analysis.status).toBe('matched');
    expect(analysis.analysis.accepted).toBe(true);
    expect(analysis.analysis.masterStartSeconds).toBeGreaterThan(5.05);
    expect(analysis.analysis.masterStartSeconds).toBeLessThan(5.35);
    expect(analysis.analysis.confidence).toBeGreaterThanOrEqual(analysis.analysis.minConfidence);

    const output = join(dir, 'edit', 'synced-preview.mp4');
    const rendered = run(['sync-master', video, master, '--out', output, '--json']);
    expect(rendered.status).toBe('rendered');
    expect(rendered.outputHasVideo).toBe(true);
    expect(rendered.outputHasAudio).toBe(true);
    expect(rendered.outputDuration).toBeGreaterThan(11.5);
    expect(existsSync(output)).toBe(true);
    expect(existsSync(rendered.reportPath)).toBe(true);
  }, 60000);

  test('measures meaningful clock drift only across a sufficiently long take', () => {
    if (!hasFfmpeg()) return;
    const { master, video } = masterSyncFixture({
      playbackRate: 1.004,
      duration: 24,
      masterStart: 4,
      masterDuration: 40,
    });
    const analysis = run(['sync-master', video, master, '--analyze-only', '--json']);
    expect(analysis.analysis.accepted).toBe(true);
    expect(analysis.analysis.masterStartSeconds).toBeGreaterThan(3.8);
    expect(analysis.analysis.masterStartSeconds).toBeLessThan(4.2);
    expect(analysis.analysis.playbackRate).toBeGreaterThan(1.002);
    expect(analysis.analysis.playbackRate).toBeLessThan(1.006);
  }, 30000);

  test('refuses unrelated scratch audio instead of manufacturing a confident sync', () => {
    if (!hasFfmpeg()) return;
    const { master, video } = masterSyncFixture({ noiseOnly: true });
    const rejected = runFailure(['sync-master', video, master, '--json']);
    expect(rejected.ok).toBe(false);
    expect(rejected.error).toContain('refused');
    expect(rejected.confidence).toBeLessThan(rejected.minConfidence);
    expect(existsSync(rejected.reportPath)).toBe(true);
    expect(JSON.parse(readFileSync(rejected.reportPath, 'utf-8')).ok).toBe(false);
  }, 30000);

  test('refuses camera playback from a different plausible song', () => {
    if (!hasFfmpeg()) return;
    const { master, video } = masterSyncFixture({ wrongSong: true });
    const rejected = runFailure(['sync-master', video, master, '--json']);
    expect(rejected.ok).toBe(false);
    expect(rejected.error).toContain('refused');
    expect(JSON.parse(readFileSync(rejected.reportPath, 'utf-8')).ok).toBe(false);
  }, 30000);

  test('refuses hour-scale synchronization inputs before fingerprint search', () => {
    if (!hasFfmpeg()) return;
    const { master, video } = masterSyncFixture();
    expect(() => analyzeMasterSync(video, master, { maxAnalysisSeconds: 10 })).toThrow('up to 10 seconds');
  }, 30000);

  test('refuses to overwrite either source file', () => {
    if (!hasFfmpeg()) return;
    const { master, video } = masterSyncFixture();
    const rejected = runFailure(['sync-master', video, master, '--out', video, '--json']);
    expect(rejected.error).toContain('Refusing to overwrite source media');
    expect(existsSync(video)).toBe(true);
  }, 30000);

  test('inspects, transcribes when available, plans, and renders a vertical preview', () => {
    if (!hasFfmpeg()) return;
    const dir = tempFootage();

    const inventory = run(['inspect', dir, '--json']);
    expect(inventory.ok).toBe(true);
    expect(inventory.files[0].hasVideo).toBe(true);

    if (hasWhisper()) {
      const transcript = run(['transcribe', dir, '--model', 'tiny', '--language', 'en', '--json']);
      expect(transcript.ok).toBe(true);
      expect(transcript.transcriptFiles).toHaveLength(1);
      expect(existsSync(join(dir, 'edit', 'transcripts', 'clip-a.json'))).toBe(true);
    }

    const edl = run(['plan', dir, '--max-duration', '1.5', '--aspect', '9:16', '--caption', 'RAW TEST', '--json']);
    expect(edl.segments).toHaveLength(1);
    expect(edl.dimensions).toEqual({ width: 1080, height: 1920 });

    const out = join(dir, 'edit', 'preview.mp4');
    const report = run(['render', dir, '--out', out, '--json']);
    expect(report.ok).toBe(true);
    expect(report.output).toBe(out);
    expect(report.width).toBe(1080);
    expect(report.height).toBe(1920);
    expect(report.duration).toBeGreaterThan(0);
    expect(report.hasAudio).toBe(true);
    expect(existsSync(join(dir, 'edit', 'inventory.json'))).toBe(true);
    expect(existsSync(join(dir, 'edit', 'takes_packed.md'))).toBe(true);
    expect(existsSync(join(dir, 'edit', 'edl.json'))).toBe(true);
    expect(existsSync(out)).toBe(true);

    const renderReport = JSON.parse(readFileSync(join(dir, 'edit', 'render-report.json'), 'utf-8'));
    expect(renderReport.checks).toContain('aspect dimensions matched');
  }, 20000);
});
