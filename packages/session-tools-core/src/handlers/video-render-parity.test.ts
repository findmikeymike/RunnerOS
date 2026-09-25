import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import type { SessionToolContext } from '../context.ts';
import { handleVideoExport, handleVideoProjectCreate } from './video-tools.ts';

const cli = fileURLToPath(new URL('../../../../tools/video-studio/bin/video-studio.mjs', import.meta.url));
let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'video-render-parity-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

function context(): SessionToolContext {
  return {
    sessionId: 'render-parity', workspacePath: root, workingDirectory: root,
    sourcesPath: join(root, 'sources'), skillsPath: join(root, 'skills'), plansFolderPath: join(root, 'plans'),
    callbacks: { onPlanSubmitted: () => {}, onAuthRequest: () => {} },
    fs: { exists: existsSync, readFile: (path: string) => readFileSync(path, 'utf-8'),
      readFileBuffer: readFileSync, writeFile: writeFileSync, isDirectory: () => false,
      readdir: () => [], stat: () => ({ size: 0, isDirectory: () => false }) },
    loadSourceConfig: () => null,
  } as unknown as SessionToolContext;
}

function ffmpeg(args: string[]): Buffer {
  const result = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { maxBuffer: 32 * 1024 * 1024, timeout: 20_000 });
  expect(result.status, result.error?.message || result.stderr.toString()).toBe(0);
  return result.stdout;
}

function runCli(args: string[]) {
  return spawnSync(process.execPath.includes('bun') ? 'node' : process.execPath, [cli, ...args], {
    encoding: 'utf-8', timeout: 30_000, maxBuffer: 4 * 1024 * 1024,
  });
}

function frame(path: string, seconds: number): Buffer {
  const bytes = ffmpeg(['-ss', String(seconds), '-i', path, '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-']);
  expect(bytes.length).toBe(320 * 240 * 3);
  return bytes;
}

function pixel(bytes: Buffer, x: number, y: number): number[] {
  return [...bytes.subarray((y * 320 + x) * 3, (y * 320 + x) * 3 + 3)];
}

function whitePixels(bytes: Buffer, top: number, bottom: number): number {
  let count = 0;
  for (let y = top; y < bottom; y++) for (let x = 20; x < 300; x++) {
    const i = (y * 320 + x) * 3;
    if (bytes[i]! > 190 && bytes[i + 1]! > 190 && bytes[i + 2]! > 190) count++;
  }
  return count;
}

function rms(path: string, start: number, duration = 0.15): number {
  // A track may end before the video; missing tail samples represent silence.
  const bytes = ffmpeg(['-i', path, '-af', `aresample=async=1:first_pts=0,apad,atrim=start=${start}:end=${start + duration}`, '-vn', '-ac', '1', '-ar', '8000', '-f', 'f32le', '-']);
  expect(bytes.length).toBeGreaterThan(0);
  let sum = 0;
  for (let i = 0; i + 4 <= bytes.length; i += 4) sum += bytes.readFloatLE(i) ** 2;
  return Math.sqrt(sum / (bytes.length / 4));
}

async function fixture() {
  // These are real integration tests: unavailable FFmpeg/FFprobe is a failure.
  expect(spawnSync('ffprobe', ['-version']).status).toBe(0);
  const video = join(root, 'blue.mp4');
  const audio = join(root, 'tone.wav');
  const image = join(root, 'two-colors.ppm');
  ffmpeg(['-f', 'lavfi', '-i', 'color=c=blue:s=320x240:r=10:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video]);
  ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1:sample_rate=48000', audio]);
  const pixels = Buffer.alloc(80 * 80 * 3);
  for (let y = 0; y < 80; y++) for (let x = 0; x < 80; x++) pixels[(y * 80 + x) * 3 + (x < 40 ? 0 : 1)] = 255;
  writeFileSync(image, Buffer.concat([Buffer.from('P6\n80 80\n255\n'), pixels]));
  const projectPath = join(root, 'source.runner-video.json');
  expect((await handleVideoProjectCreate(context(), { projectPath, title: 'Parity', width: 320, height: 240, fps: 10 })).isError).toBe(false);
  const project = JSON.parse(readFileSync(projectPath, 'utf-8'));
  project.media = [
    { id: 'blue', type: 'video', label: 'Blue', path: video, width: 320, height: 240, durationMs: 2000, hasAudio: false },
    { id: 'image', type: 'image', label: 'Red and green', path: image, width: 80, height: 80 },
    { id: 'tone', type: 'audio', label: 'Tone', path: audio, durationMs: 1000, hasAudio: true },
  ];
  project.timeline.durationMs = 2000;
  project.timeline.tracks = [
    { id: 'base', type: 'video', label: 'Base', clips: [{ id: 'base-clip', type: 'video', mediaId: 'blue', startMs: 0, durationMs: 2000 }] },
    { id: 'overlay', type: 'image', label: 'Overlay', clips: [{ id: 'overlay-clip', type: 'image', mediaId: 'image', startMs: 0, durationMs: 2000,
      crop: { x: 0, y: 0, width: 40, height: 80 }, transform: { scale: 0.25, y: -65 }, opacity: 0.5,
      keyframes: [{ timeMs: 0, property: 'x', value: -80 }, { timeMs: 2000, property: 'x', value: 80 }] }] },
    { id: 'title', type: 'text', label: 'Title', clips: [{ id: 'title-clip', type: 'text', startMs: 500, durationMs: 600, text: { text: 'VISIBLE TITLE' } }] },
    { id: 'caption', type: 'caption', label: 'Caption', clips: [{ id: 'caption-clip', type: 'caption', startMs: 1300, durationMs: 500, captionCueIds: ['cue'] }] },
    { id: 'sound', type: 'audio', label: 'Sound', clips: [{ id: 'sound-clip', type: 'audio', mediaId: 'tone', startMs: 500, durationMs: 600, volume: 0.5 }] },
  ];
  // Deliberately different cue timing ensures timeline placement owns the render.
  project.captions = [{ id: 'captions', label: 'Captions', cues: [{ id: 'cue', startMs: 0, durationMs: 400, text: 'CAPTION HERE' }] }];
  return project;
}

describe('real CLI and session-tool render parity', () => {
  test('matches decoded composition, crop, opacity, movement, text, captions and delayed audio', async () => {
    const project = await fixture();
    const handlerProject = join(root, 'handler.runner-video.json');
    const cliProject = join(root, 'cli.runner-video.json');
    writeFileSync(handlerProject, JSON.stringify(project));
    writeFileSync(cliProject, JSON.stringify(project));
    const handlerOutput = join(root, 'handler.mp4');
    const cliOutput = join(root, 'cli.mp4');
    const exported = await handleVideoExport(context(), { projectPath: handlerProject, outputPath: handlerOutput });
    expect(exported.isError, JSON.stringify(exported)).toBe(false);
    const dryRun = runCli(['dry-run', cliProject, '--json']);
    expect(dryRun.status, dryRun.stderr || dryRun.stdout).toBe(0);
    const cliResult = runCli(['export', cliProject, '--out', cliOutput, '--preset', 'simple-mp4', '--json']);
    expect(cliResult.status, cliResult.stderr || cliResult.stdout).toBe(0);
    const samples = [0.2, 0.7, 1.5, 1.9];
    const frames = samples.map(time => {
      const actual = frame(handlerOutput, time);
      const other = frame(cliOutput, time);
      let difference = 0;
      for (let i = 0; i < actual.length; i++) difference += Math.abs(actual[i]! - other[i]!);
      expect(difference / actual.length).toBeLessThan(1);
      return actual;
    });
    const early = pixel(frames[0]!, 96, 55);
    const late = pixel(frames[2]!, 200, 55);
    for (const color of [early, late]) {
      expect(color[0]).toBeGreaterThan(90);
      expect(color[0]).toBeLessThan(165);
      expect(color[1]).toBeLessThan(25); // Crop removed the green half.
      expect(color[2]).toBeGreaterThan(90); // Half-opacity red over blue.
    }
    expect(pixel(frames[0]!, 200, 55)[0]).toBeLessThan(20);
    expect(pixel(frames[2]!, 96, 55)[0]).toBeLessThan(20);
    expect(whitePixels(frames[0]!, 90, 140)).toBe(0);
    expect(whitePixels(frames[0]!, 150, 205)).toBe(0);
    expect(whitePixels(frames[1]!, 90, 140)).toBeGreaterThan(100);
    expect(whitePixels(frames[2]!, 150, 205)).toBeGreaterThan(100);
    expect(whitePixels(frames[3]!, 90, 205)).toBe(0);
    for (const output of [handlerOutput, cliOutput]) {
      const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=start_time,duration', '-of', 'json', output], { encoding: 'utf-8' });
      expect(probe.status, probe.stderr).toBe(0);
      const stream = JSON.parse(probe.stdout).streams[0];
      expect(Number(stream.start_time)).toBeGreaterThanOrEqual(0);
      expect(Number(stream.start_time)).toBeLessThan(0.55);
      expect(Number(stream.duration)).toBeGreaterThan(0.5);
      expect(rms(output, 0.1)).toBeLessThan(0.001);
      expect(rms(output, 0.7)).toBeGreaterThan(0.02);
      expect(rms(output, 0.7)).toBeLessThan(0.06); // Half volume of FFmpeg's 0.125-amplitude sine.
      expect(rms(output, 1.4)).toBeLessThan(0.001);
    }
    expect(Math.abs(rms(handlerOutput, 0.7) - rms(cliOutput, 0.7))).toBeLessThan(0.001);
  }, 60_000);

  test('both exports and CLI dry-run reject unsupported transitions', async () => {
    const project = await fixture();
    project.timeline.tracks[0].clips[0].transitionIn = { type: 'crossfade', durationMs: 200 };
    const projectPath = join(root, 'transition.runner-video.json');
    writeFileSync(projectPath, JSON.stringify(project));
    const handlerOutput = join(root, 'unsupported-handler.mp4');
    const result = await handleVideoExport(context(), { projectPath, outputPath: handlerOutput });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toMatch(/transition/i);
    expect(existsSync(handlerOutput)).toBe(false);
    for (const command of ['dry-run', 'export']) {
      const output = join(root, `unsupported-${command}.mp4`);
      const args = [command, projectPath, '--json'];
      if (command === 'export') args.push('--out', output, '--preset', 'simple-mp4');
      const cliResult = runCli(args);
      expect(cliResult.status).not.toBe(0);
      expect(cliResult.stderr + cliResult.stdout).toMatch(/transition/i);
      expect(existsSync(output)).toBe(false);
    }
  }, 60_000);
});
