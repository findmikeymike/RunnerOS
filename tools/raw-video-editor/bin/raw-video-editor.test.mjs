import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

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

describe('raw-video-editor cli', () => {
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
