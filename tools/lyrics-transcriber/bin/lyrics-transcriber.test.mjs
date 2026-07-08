import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const BIN = new URL('./lyrics-transcriber.mjs', import.meta.url).pathname;

function run(args, env = {}) {
  return spawnSync(process.execPath, [BIN, ...args, '--json'], {
    encoding: 'utf-8',
    cwd: mkdtempSync(join(tmpdir(), 'runneros-lyrics-transcriber-cwd-')),
    env: { ...process.env, ...env },
    maxBuffer: 8 * 1024 * 1024,
  });
}

function fakeExecutable(dir, name, source) {
  const path = join(dir, name);
  writeFileSync(path, source);
  chmodSync(path, 0o755);
  return path;
}

function fakeRuntime() {
  const dir = mkdtempSync(join(tmpdir(), 'runneros-lyrics-transcriber-'));
  const audio = join(dir, 'song.wav');
  const model = join(dir, 'ggml-base.en.bin');
  writeFileSync(audio, 'audio');
  writeFileSync(model, 'model');
  const ffmpeg = fakeExecutable(dir, 'ffmpeg', [
    '#!/usr/bin/env node',
    'const fs = await import("node:fs");',
    'const out = process.argv.at(-1);',
    'fs.writeFileSync(out, "wav");',
  ].join('\n'));
  const whisper = fakeExecutable(dir, 'whisper-cli', [
    '#!/usr/bin/env node',
    'const fs = await import("node:fs");',
    'const args = process.argv.slice(2);',
    'if (args.includes("--help")) process.exit(0);',
    'const outBase = args[args.indexOf("-of") + 1];',
    'fs.writeFileSync(`${outBase}.json`, JSON.stringify({',
    '  transcription: [',
    '    { timestamps: { from: "00:00:00,000", to: "00:00:02,500" }, text: "first line" },',
    '    { timestamps: { from: "00:00:02,500", to: "00:00:05,000" }, text: "second line" }',
    '  ]',
    '}));',
  ].join('\n'));
  return { dir, audio, model, ffmpeg, whisper };
}

describe('lyrics-transcriber cli', () => {
  it('doctor reports missing local runtime as structured JSON', () => {
    const result = run(['doctor'], {
      RUNNEROS_WHISPER_CPP_CLI: '/tmp/runneros-missing-whisper-cli',
      RUNNEROS_FFMPEG: '/tmp/runneros-missing-ffmpeg',
      RUNNEROS_WHISPER_MODEL: '/tmp/runneros-missing-model.bin',
    });
    assert.notEqual(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.mode, 'runneros_lyrics_transcriber_doctor');
    assert.equal(payload.ok, false);
    assert.ok(payload.blockers.some((blocker) => blocker.code === 'missing_whisper_cli'));
    assert.ok(payload.blockers.some((blocker) => blocker.code === 'missing_ffmpeg'));
    assert.ok(payload.blockers.some((blocker) => blocker.code === 'missing_model'));
  });

  it('packaged mode rejects non-bundled runtime binaries', () => {
    const runtime = fakeRuntime();
    const result = run(['doctor'], {
      RUNNEROS_REQUIRE_PACKAGED_LYRICS_RUNTIME: '1',
      RUNNEROS_WHISPER_MODEL: runtime.model,
      RUNNEROS_WHISPER_CPP_CLI: runtime.whisper,
      RUNNEROS_FFMPEG: runtime.ffmpeg,
    });
    assert.notEqual(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.packagedRuntimeRequired, true);
    assert.equal(payload.whisperCliBundled, false);
    assert.equal(payload.ffmpegBundled, false);
    assert.ok(payload.blockers.some((blocker) => blocker.code === 'packaged_whisper_cli_missing'));
    assert.ok(payload.blockers.some((blocker) => blocker.code === 'packaged_ffmpeg_missing'));
  });

  it('transcribes audio into timed lyric lines with fake whisper.cpp runtime', () => {
    const runtime = fakeRuntime();
    const outDir = join(runtime.dir, 'lyrics');
    const result = run([
      'transcribe',
      '--audio-file', runtime.audio,
      '--out-dir', outDir,
      '--model', 'base.en',
    ], {
      RUNNEROS_WHISPER_CPP_CLI: runtime.whisper,
      RUNNEROS_FFMPEG: runtime.ffmpeg,
      RUNNEROS_WHISPER_MODEL: runtime.model,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.mode, 'runneros_lyrics_transcriber_transcribe');
    assert.equal(payload.ok, true);
    assert.equal(payload.lyrics_text, 'first line\nsecond line');
    assert.deepEqual(payload.lyric_lines, [
      { text: 'first line', start_time: 0, end_time: 2.5 },
      { text: 'second line', start_time: 2.5, end_time: 5 },
    ]);
    assert.equal(payload.review_required, true);
    assert.ok(existsSync(join(outDir, 'transcript.json')));
    assert.ok(existsSync(join(outDir, 'lyrics.txt')));
    assert.equal(JSON.parse(readFileSync(join(outDir, 'transcript.json'), 'utf-8')).lyrics_text, payload.lyrics_text);
  });
});
