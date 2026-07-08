#!/usr/bin/env node
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { get } from 'node:https';

const args = process.argv.slice(2);
const command = args[0] || 'help';
const TOOL_ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..');
const DEFAULT_CACHE_DIR = join(homedir(), '.runneros', 'whisper');
const PLATFORM_KEY = `${process.platform}-${process.arch}`;
const MODEL_URLS = {
  'tiny.en': 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin',
  tiny: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin',
  'base.en': 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin',
  base: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin',
  'small.en': 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin',
  small: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin',
};

function hasFlag(name) {
  return args.includes(name);
}

function opt(name, fallback = undefined) {
  const index = args.indexOf(name);
  if (index === -1 || index + 1 >= args.length) return fallback;
  return args[index + 1];
}

function jsonMode() {
  return hasFlag('--json');
}

function print(payload) {
  if (jsonMode()) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  if (payload.lines) console.log(payload.lines.join('\n'));
  else console.log(payload.message || JSON.stringify(payload, null, 2));
}

function exit(payload, status = 0) {
  print(payload);
  process.exit(status);
}

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function run(cmd, cmdArgs, options = {}) {
  return spawnSync(cmd, cmdArgs, { encoding: 'utf-8', timeout: 30_000, ...options });
}

function isExecutable(cmd, versionArgs = ['--help']) {
  const result = run(cmd, versionArgs);
  return result.status === 0;
}

function firstExisting(paths) {
  return paths.find((path) => path && existsSync(path)) || null;
}

function bundledRuntimeCandidates(name) {
  const exe = process.platform === 'win32' ? `${name}.exe` : name;
  return [
    join(TOOL_ROOT, 'bin', process.platform, process.arch, exe),
    join(TOOL_ROOT, 'bin', PLATFORM_KEY, exe),
    join(TOOL_ROOT, 'bin', process.platform, exe),
    join(TOOL_ROOT, 'bin', exe),
  ];
}

function provenancePath(binaryPath) {
  return `${binaryPath}.provenance.json`;
}

function readProvenance(binaryPath) {
  const path = provenancePath(binaryPath);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

function isBundledRuntime(binaryPath) {
  const normalized = resolve(binaryPath);
  return normalized.startsWith(resolve(TOOL_ROOT, 'bin'));
}

function packagedRuntimeRequired() {
  return process.env.RUNNEROS_REQUIRE_PACKAGED_LYRICS_RUNTIME === '1'
    || process.env.CRAFT_IS_PACKAGED === '1';
}

function commandExists(cmd) {
  return run(process.platform === 'win32' ? 'where' : 'which', [cmd]).status === 0;
}

function resolveCommand(candidates, versionArgs = ['--help']) {
  for (const candidate of candidates.filter(Boolean)) {
    if (candidate.includes('/') || candidate.includes('\\')) {
      if (existsSync(candidate) && isExecutable(candidate, versionArgs)) return candidate;
      continue;
    }
    if (commandExists(candidate) && isExecutable(candidate, versionArgs)) return candidate;
  }
  return null;
}

function resolveFfmpeg() {
  const explicit = process.env.RUNNEROS_FFMPEG || process.env.FFMPEG_PATH;
  if (explicit) return existsSync(explicit) && isExecutable(explicit, ['-version']) ? explicit : null;
  return resolveCommand([
    ...bundledRuntimeCandidates('ffmpeg'),
    'ffmpeg',
  ], ['-version']);
}

function resolveWhisperCli() {
  const explicit = process.env.RUNNEROS_WHISPER_CPP_CLI || process.env.WHISPER_CPP_CLI;
  if (explicit) return existsSync(explicit) && isExecutable(explicit, ['--version']) ? explicit : null;
  return resolveCommand([
    ...bundledRuntimeCandidates('whisper-cli'),
    'whisper-cli',
  ], ['--version']);
}

function modelCacheDir() {
  return resolve(process.env.RUNNEROS_WHISPER_MODEL_DIR || opt('--model-dir', join(DEFAULT_CACHE_DIR, 'models')));
}

function modelFilename(model) {
  return `ggml-${model}.bin`;
}

function resolveModelPath(model = 'base.en') {
  const explicit = opt('--model-file') || process.env.RUNNEROS_WHISPER_MODEL || process.env.WHISPER_CPP_MODEL;
  if (explicit) return resolve(explicit);
  return join(modelCacheDir(), modelFilename(model));
}

function modelUrl(model) {
  return MODEL_URLS[model] || null;
}

function doctorPayload() {
  const model = opt('--model', 'base.en');
  const whisperCli = resolveWhisperCli();
  const ffmpeg = resolveFfmpeg();
  const requirePackagedRuntime = packagedRuntimeRequired();
  const whisperProvenance = whisperCli ? readProvenance(whisperCli) : null;
  const ffmpegProvenance = ffmpeg ? readProvenance(ffmpeg) : null;
  const modelPath = resolveModelPath(model);
  const modelExists = existsSync(modelPath);
  const blockers = [];
  if (!whisperCli) blockers.push({ code: 'missing_whisper_cli', message: 'whisper.cpp whisper-cli binary is missing.' });
  if (!ffmpeg) blockers.push({ code: 'missing_ffmpeg', message: 'FFmpeg is missing; audio conversion to 16k mono WAV cannot run.' });
  if (requirePackagedRuntime && whisperCli && !isBundledRuntime(whisperCli)) {
    blockers.push({ code: 'packaged_whisper_cli_missing', message: `Packaged app requires bundled whisper-cli under ${join(TOOL_ROOT, 'bin', process.platform, process.arch)}.` });
  }
  if (requirePackagedRuntime && ffmpeg && !isBundledRuntime(ffmpeg)) {
    blockers.push({ code: 'packaged_ffmpeg_missing', message: `Packaged app requires bundled FFmpeg under ${join(TOOL_ROOT, 'bin', process.platform, process.arch)}.` });
  }
  if (requirePackagedRuntime && whisperCli && isBundledRuntime(whisperCli) && !whisperProvenance) {
    blockers.push({ code: 'missing_whisper_cli_provenance', message: `Bundled whisper-cli is missing provenance: ${provenancePath(whisperCli)}` });
  }
  if (requirePackagedRuntime && ffmpeg && isBundledRuntime(ffmpeg) && !ffmpegProvenance) {
    blockers.push({ code: 'missing_ffmpeg_provenance', message: `Bundled FFmpeg is missing provenance: ${provenancePath(ffmpeg)}` });
  }
  if (!modelExists) blockers.push({ code: 'missing_model', message: `Whisper model missing: ${modelPath}` });
  return {
    ok: blockers.length === 0,
    mode: 'runneros_lyrics_transcriber_doctor',
    engine: 'whisper.cpp',
    license: {
      engine: 'MIT',
      model: 'OpenAI Whisper ggml model; verify exact downloaded file provenance before bundling',
      ffmpeg: 'Use LGPL-only build for packaged app unless GPL obligations are accepted',
    },
    whisperCli,
    whisperCliBundled: whisperCli ? isBundledRuntime(whisperCli) : false,
    whisperCliProvenance: whisperProvenance,
    ffmpeg,
    ffmpegBundled: ffmpeg ? isBundledRuntime(ffmpeg) : false,
    ffmpegProvenance,
    packagedRuntimeRequired: requirePackagedRuntime,
    expectedRuntimeDir: join(TOOL_ROOT, 'bin', process.platform, process.arch),
    model,
    modelPath,
    modelExists,
    cacheDir: modelCacheDir(),
    blockers,
  };
}

function commandDoctor() {
  const payload = doctorPayload();
  exit(payload, payload.ok ? 0 : 1);
}

function download(url, destination) {
  return new Promise((resolvePromise, reject) => {
    ensureDir(dirname(destination));
    const tmp = `${destination}.${process.pid}.${Date.now()}.tmp`;
    const file = createWriteStream(tmp);
    get(url, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode || 0) && response.headers.location) {
        file.close();
        rmSync(tmp, { force: true });
        download(response.headers.location, destination).then(resolvePromise, reject);
        return;
      }
      if ((response.statusCode || 0) >= 400) {
        file.close();
        rmSync(tmp, { force: true });
        reject(new Error(`download failed with HTTP ${response.statusCode}`));
        return;
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        renameSync(tmp, destination);
        resolvePromise(destination);
      });
    }).on('error', (error) => {
      file.close();
      rmSync(tmp, { force: true });
      reject(error);
    });
  });
}

async function commandInstallModel() {
  const model = opt('--model', 'base.en');
  const url = modelUrl(model);
  if (!url) exit({ ok: false, error: `Unsupported model: ${model}`, supportedModels: Object.keys(MODEL_URLS) }, 1);
  const destination = resolveModelPath(model);
  if (existsSync(destination) && !hasFlag('--force')) {
    exit({ ok: true, mode: 'runneros_lyrics_transcriber_install_model', model, modelPath: destination, alreadyExists: true });
  }
  try {
    await download(url, destination);
    const provenancePath = `${destination}.provenance.json`;
    writeFileSync(provenancePath, `${JSON.stringify({
      source: url,
      engine: 'whisper.cpp',
      model,
      license: 'OpenAI Whisper ggml model; verify exact file license before bundling',
      downloadedAt: new Date().toISOString(),
      checksumStatus: 'not configured',
    }, null, 2)}\n`, 'utf-8');
    exit({ ok: true, mode: 'runneros_lyrics_transcriber_install_model', model, modelPath: destination, provenancePath });
  } catch (error) {
    exit({ ok: false, error: `Model download failed: ${error.message}`, model, url, modelPath: destination }, 1);
  }
}

function parseTimestamp(value) {
  if (typeof value === 'number') return value;
  const text = String(value || '').trim().replace(',', '.');
  if (!text) return 0;
  const parts = text.split(':').map(Number);
  if (parts.length === 3 && parts.every(Number.isFinite)) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2 && parts.every(Number.isFinite)) return parts[0] * 60 + parts[1];
  const numeric = Number(text);
  return Number.isFinite(numeric) ? numeric : 0;
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeSegment(segment) {
  const timestamps = segment.timestamps || {};
  const start = segment.start ?? segment.t0 ?? timestamps.from ?? timestamps.start ?? 0;
  const end = segment.end ?? segment.t1 ?? timestamps.to ?? timestamps.end ?? start;
  const text = cleanText(segment.text ?? segment.sentence ?? segment.line ?? '');
  return {
    text,
    start_time: Number(parseTimestamp(start).toFixed(3)),
    end_time: Number(parseTimestamp(end).toFixed(3)),
  };
}

function parseWhisperJson(data) {
  const rawSegments = Array.isArray(data)
    ? data
    : data.transcription || data.segments || data.result?.segments || [];
  return rawSegments.map(normalizeSegment).filter((line) => line.text);
}

function parseTimestampedStdout(stdout) {
  const regex = /^\s*\[([0-9:.]+)\s+-->\s+([0-9:.]+)\]\s*(.*?)\s*$/gm;
  const lines = [];
  for (const match of stdout.matchAll(regex)) {
    const text = cleanText(match[3]);
    if (!text) continue;
    lines.push({
      text,
      start_time: Number(parseTimestamp(match[1]).toFixed(3)),
      end_time: Number(parseTimestamp(match[2]).toFixed(3)),
    });
  }
  return lines;
}

function transcriptText(lines) {
  return lines.map((line) => line.text).join('\n').trim();
}

function writeJson(path, value) {
  ensureDir(dirname(path));
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

function outputBase(outDir, audioFile) {
  const stem = basename(audioFile, extname(audioFile)).replace(/[^a-zA-Z0-9._-]+/g, '-');
  return join(outDir, `${stem}.lyrics`);
}

function commandTranscribe() {
  const audioFile = resolve(opt('--audio-file') || opt('-f') || '');
  if (!audioFile || !existsSync(audioFile)) exit({ ok: false, error: `Audio file not found: ${audioFile}` }, 1);
  const model = opt('--model', 'base.en');
  const doctor = doctorPayload();
  if (!doctor.ok) exit({ ...doctor, mode: 'runneros_lyrics_transcriber_transcribe', ok: false }, 1);
  const outDir = resolve(opt('--out-dir', join(dirname(audioFile), 'lyrics')));
  ensureDir(outDir);
  const wavPath = join(outDir, `${basename(audioFile, extname(audioFile))}.whisper-input.wav`);
  const convert = run(doctor.ffmpeg, ['-y', '-i', audioFile, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wavPath]);
  if (convert.status !== 0 || !existsSync(wavPath)) {
    exit({ ok: false, error: 'FFmpeg audio conversion failed.', stderr: convert.stderr || convert.stdout }, 1);
  }
  const base = outputBase(outDir, audioFile);
  const maxLen = opt('--max-len', hasFlag('--word-timestamps') ? '1' : '64');
  const whisperArgs = ['-m', doctor.modelPath, '-f', wavPath, '-ml', maxLen, '-oj', '-of', base];
  const language = opt('--language');
  if (language) whisperArgs.push('-l', language);
  const whisper = run(doctor.whisperCli, whisperArgs, { maxBuffer: 32 * 1024 * 1024 });
  if (whisper.status !== 0) {
    exit({ ok: false, error: 'whisper.cpp transcription failed.', stderr: whisper.stderr || whisper.stdout }, 1);
  }
  const whisperJsonPath = `${base}.json`;
  let lyricLines = [];
  if (existsSync(whisperJsonPath)) {
    lyricLines = parseWhisperJson(JSON.parse(readFileSync(whisperJsonPath, 'utf-8')));
  }
  if (lyricLines.length === 0) lyricLines = parseTimestampedStdout(whisper.stdout || '');
  const payload = {
    ok: lyricLines.length > 0,
    mode: 'runneros_lyrics_transcriber_transcribe',
    engine: 'whisper.cpp',
    audio_file: audioFile,
    model,
    model_file: doctor.modelPath,
    lyrics_text: transcriptText(lyricLines),
    lyric_lines: lyricLines,
    word_timestamps_requested: hasFlag('--word-timestamps'),
    output_dir: outDir,
    transcript_json: join(outDir, 'transcript.json'),
    lyrics_text_file: join(outDir, 'lyrics.txt'),
    whisper_json: existsSync(whisperJsonPath) ? whisperJsonPath : null,
    review_required: true,
    note: 'Song transcription can mishear sung lyrics. Review/edit before final lyric video timing.',
  };
  writeJson(payload.transcript_json, payload);
  writeFileSync(payload.lyrics_text_file, `${payload.lyrics_text}\n`, 'utf-8');
  exit(payload, payload.ok ? 0 : 1);
}

function usage() {
  exit({
    ok: true,
    lines: [
      'runneros-lyrics-transcriber',
      '',
      'Commands:',
      '  doctor --json',
      '  install-model --model base.en --json',
      '  transcribe --audio-file song.wav --model base.en --out-dir ./lyrics --json',
      '',
      'Env overrides:',
      '  RUNNEROS_WHISPER_CPP_CLI=/path/to/whisper-cli',
      '  RUNNEROS_WHISPER_MODEL=/path/to/ggml-base.en.bin',
      '  RUNNEROS_WHISPER_MODEL_DIR=/path/to/model-cache',
      '  RUNNEROS_FFMPEG=/path/to/ffmpeg',
    ],
  });
}

if (command === 'doctor') commandDoctor();
else if (command === 'install-model') await commandInstallModel();
else if (command === 'transcribe') commandTranscribe();
else usage();
