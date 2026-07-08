import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const BIN = new URL('./genesis-lyric.mjs', import.meta.url).pathname;

function run(args, env = {}) {
  return spawnSync(process.execPath, [BIN, ...args, '--json'], {
    encoding: 'utf-8',
    env: { ...process.env, ...env },
  });
}

function briefFile(extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'runneros-genesis-lyric-test-'));
  const file = join(dir, 'brief.json');
  writeFileSync(file, JSON.stringify({
    title: 'Watching Tornado Videos on Youtube',
    lyrics: 'Well I been up for days on end\nWatching tornado videos on YouTube',
    duration_seconds: 6,
    aspect_ratio: '9:16',
    output_dir: dir,
    ...extra,
  }));
  return file;
}

function rawBriefFile(contents) {
  const dir = mkdtempSync(join(tmpdir(), 'runneros-genesis-lyric-test-'));
  const file = join(dir, 'brief.json');
  writeFileSync(file, contents);
  return file;
}

describe('runneros genesis lyric wrapper', () => {
  it('prefers bundled uv runtime when CRAFT_UV is provided', () => {
    const dir = mkdtempSync(join(tmpdir(), 'runneros-genesis-lyric-test-'));
    const fakeUv = join(dir, 'fake-uv.mjs');
    writeFileSync(fakeUv, [
      '#!/usr/bin/env node',
      'console.log(JSON.stringify({ ok: true, mode: "fake_uv", argv: process.argv.slice(2) }))',
    ].join('\n'));
    chmodSync(fakeUv, 0o755);

    const result = run(['doctor'], {
      CRAFT_UV: fakeUv,
      GENESIS_LYRIC_PYTHON: '',
      PYTHON: '',
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.mode, 'fake_uv');
    assert.deepEqual(payload.argv.slice(0, 3), ['run', '--python', '3.12']);
    assert.ok(payload.argv[3].endsWith('genesis_lyric.py'));
    assert.equal(payload.argv[4], 'doctor');
  });

  it('doctor reports the Genesis lyric tool state', () => {
    const result = run(['doctor']);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.mode, 'runneros_genesis_lyric_doctor');
    assert.equal(typeof payload.vendor_exists, 'boolean');
    assert.equal(typeof payload.imports, 'object');
  });

  it('plan normalizes untimed lyrics into one single-video plan', () => {
    const result = run(['plan', '--brief-file', briefFile()]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.mode, 'runneros_genesis_lyric_plan');
    assert.equal(payload.single_video_only, true);
    assert.equal(payload.lyric_line_count, 2);
    assert.equal(payload.lyric_lines[0].start_time, 0);
    assert.equal(payload.lyric_lines[1].end_time, 6);
  });

  it('preflight blocks render when no visual asset is present', () => {
    const result = run(['preflight', '--brief-file', briefFile()]);
    assert.notEqual(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.mode, 'runneros_genesis_lyric_preflight');
    assert.equal(payload.ok, false);
    assert.ok(payload.blockers.some((blocker) => blocker.code === 'missing_visual'));
  });

  it('preflight blocks unsupported aspect ratios', () => {
    const result = run(['preflight', '--brief-file', briefFile({ aspect_ratio: '4:5' })]);
    assert.notEqual(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.ok(payload.blockers.some((blocker) => blocker.code === 'unsupported_aspect_ratio'));
    assert.deepEqual(payload.supported_aspect_ratios, ['9:16', '1:1', '16:9']);
  });

  it('preflight blocks malformed numeric brief fields without traceback', () => {
    const result = run(['preflight', '--brief-file', briefFile({
      audio_start_seconds: 'intro',
      lyric_lines: [{ text: 'bad timing', start_time: 'start', end_time: 1 }],
    })]);
    assert.notEqual(result.status, 0);
    assert.equal(result.stderr, '');
    const payload = JSON.parse(result.stdout);
    assert.ok(payload.blockers.some((blocker) => blocker.code === 'invalid_numeric'));
    assert.ok(payload.blockers.some((blocker) => blocker.code === 'invalid_lyric_timing'));
  });

  it('preflight blocks non-object brief JSON without traceback', () => {
    const result = run(['preflight', '--brief-file', rawBriefFile('[]')]);
    assert.notEqual(result.status, 0);
    assert.equal(result.stderr, '');
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.code, 'invalid_brief');
  });

  it('preflight blocks non-finite numeric values and unsafe run ids', () => {
    const result = run(['preflight', '--brief-file', briefFile({
      duration_seconds: 'NaN',
      run_id: '../../escape',
    })]);
    assert.notEqual(result.status, 0);
    assert.equal(result.stderr, '');
    const payload = JSON.parse(result.stdout);
    assert.ok(payload.blockers.some((blocker) => blocker.code === 'invalid_numeric'));
    assert.ok(payload.blockers.some((blocker) => blocker.code === 'invalid_run_id'));
  });

  it('render stops without approval', () => {
    const result = run(['render', '--brief-file', briefFile()]);
    assert.notEqual(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.code, 'approval_required');
  });

  it('render reuses preflight hard blockers after approval', () => {
    const dir = mkdtempSync(join(tmpdir(), 'runneros-genesis-lyric-test-'));
    const image = join(dir, 'cover.png');
    writeFileSync(image, 'placeholder');
    const result = run(['render', '--brief-file', briefFile({ lyrics: '', image_file: image }), '--approved']);
    assert.notEqual(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.mode, 'runneros_genesis_lyric_render');
    assert.equal(payload.code, 'preflight_blocked');
    assert.ok(payload.blockers.some((blocker) => blocker.code === 'missing_lyrics'));
  });

  it('bad ffmpeg env paths return structured doctor JSON', () => {
    const result = run(['doctor'], {
      GENESIS_FFMPEG_PATH: '/tmp/runneros-missing-ffmpeg',
      GENESIS_FFPROBE_PATH: '/tmp/runneros-missing-ffprobe',
    });
    assert.notEqual(result.status, 0);
    assert.equal(result.stderr, '');
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.mode, 'runneros_genesis_lyric_doctor');
    assert.equal(payload.ok, false);
    assert.equal(payload.ffmpeg, null);
    assert.equal(payload.ffprobe, null);
  });
});
