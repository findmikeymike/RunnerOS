#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  MASTER_SYNC_MIN_CONFIDENCE,
  analyzeMasterSync,
  renderMasterSync,
} from './audio-sync.mjs';
import { executeRepurpose } from './repurpose.mjs';

const args = process.argv.slice(2);
const command = args[0] || 'help';
const MEDIA_EXTS = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi', '.mp3', '.wav', '.m4a', '.aac']);
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi']);

function hasFlag(name) {
  return args.includes(name);
}

function opt(name, fallback) {
  const index = args.indexOf(name);
  if (index === -1 || index + 1 >= args.length) return fallback;
  return args[index + 1];
}

function positional(index) {
  return args.slice(1).filter((arg, i, all) => {
    if (arg.startsWith('--')) return false;
    const prev = all[i - 1];
    return !(prev && prev.startsWith('--'));
  })[index];
}

function print(payload) {
  if (hasFlag('--json')) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  if (payload.lines?.length) console.log(payload.lines.join('\n'));
  else console.log(payload.message || JSON.stringify(payload, null, 2));
}

function fail(message, extra = {}) {
  print({ ok: false, error: message, ...extra });
  process.exit(1);
}

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function writeJsonAtomic(path, value) {
  ensureDir(dirname(path));
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
  renameSync(tmp, path);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function run(commandName, commandArgs, options = {}) {
  return spawnSync(commandName, commandArgs, { encoding: 'utf-8', ...options });
}

function commandOk(commandName, versionArgs = ['-version']) {
  return run(commandName, versionArgs).status === 0;
}

function seconds(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function ff(value) {
  return Number(value).toFixed(3).replace(/\.?0+$/, '');
}

function mediaFiles(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (!statSync(path).isFile()) continue;
    const ext = extname(name).toLowerCase();
    if (MEDIA_EXTS.has(ext)) files.push(path);
  }
  return files.sort((a, b) => basename(a).localeCompare(basename(b)));
}

function probe(path) {
  const result = run('ffprobe', [
    '-v', 'error',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    path,
  ]);
  if (result.status !== 0) {
    return { ok: false, path, error: result.stderr || result.stdout || 'ffprobe failed' };
  }
  const raw = JSON.parse(result.stdout || '{}');
  const video = (raw.streams || []).find((stream) => stream.codec_type === 'video');
  const audio = (raw.streams || []).find((stream) => stream.codec_type === 'audio');
  return {
    ok: true,
    path,
    file: basename(path),
    ext: extname(path).toLowerCase(),
    duration: seconds(raw.format?.duration),
    width: video?.width ?? null,
    height: video?.height ?? null,
    hasVideo: Boolean(video),
    hasAudio: Boolean(audio),
    videoCodec: video?.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null,
  };
}

function editDirFor(inputDir) {
  return resolve(inputDir, 'edit');
}

function inventoryPath(inputDir) {
  return join(editDirFor(inputDir), 'inventory.json');
}

function edlPath(inputDir) {
  return join(editDirFor(inputDir), 'edl.json');
}

function packedPath(inputDir) {
  return join(editDirFor(inputDir), 'takes_packed.md');
}

function masterSyncReportPath(videoPath) {
  const stem = basename(videoPath, extname(videoPath));
  return join(dirname(videoPath), 'edit', `${stem}.master-sync.json`);
}

function inspect(inputDir) {
  const root = resolve(inputDir);
  if (!existsSync(root) || !statSync(root).isDirectory()) fail(`Input folder not found: ${root}`);
  if (!commandOk('ffprobe')) fail('ffprobe is required. Install FFmpeg first.');
  const editDir = editDirFor(root);
  ensureDir(editDir);
  const files = mediaFiles(root);
  const entries = files.map(probe);
  const inventory = {
    ok: entries.every((entry) => entry.ok),
    inputDir: root,
    editDir,
    generatedAt: new Date().toISOString(),
    files: entries,
  };
  writeJsonAtomic(inventoryPath(root), inventory);
  writeProjectNotes(root, inventory);
  writePackedTranscript(root, inventory);
  return inventory;
}

function writeProjectNotes(inputDir, inventory) {
  const lines = [
    '# Raw Video Edit',
    '',
    `Input: ${inputDir}`,
    `Generated: ${inventory.generatedAt}`,
    '',
    '## Source Media',
    '',
    ...inventory.files.map((file) => `- ${file.file}: ${ff(file.duration)}s, ${file.width || '?'}x${file.height || '?'}, audio=${file.hasAudio ? 'yes' : 'no'}`),
    '',
    '## Notes',
    '',
    '- Source files are preserved.',
    '- Generated files live in this edit folder.',
  ];
  writeFileSync(join(editDirFor(inputDir), 'project.md'), `${lines.join('\n')}\n`, 'utf-8');
}

function writePackedTranscript(inputDir, inventory) {
  const lines = [
    '# Takes Packed',
    '',
    'No transcript has been generated yet. Run `transcribe <footage-dir> --json` when speech-accurate cuts matter.',
    '',
  ];
  for (const file of inventory.files.filter((entry) => entry.ok)) {
    lines.push(`## ${file.file} duration ${ff(file.duration)}s`);
    lines.push(`[000.00-${ff(file.duration)}] Source span. Audio=${file.hasAudio ? 'yes' : 'no'} Video=${file.hasVideo ? 'yes' : 'no'}`);
    lines.push('');
  }
  writeFileSync(packedPath(inputDir), `${lines.join('\n')}\n`, 'utf-8');
}

function findWhisperJson(transcriptsDir, sourcePath) {
  const stem = basename(sourcePath, extname(sourcePath));
  const direct = join(transcriptsDir, `${stem}.json`);
  if (existsSync(direct)) return direct;
  const found = readdirSync(transcriptsDir).find((name) => name.startsWith(stem) && name.endsWith('.json'));
  return found ? join(transcriptsDir, found) : null;
}

function transcribe(inputDir) {
  const root = resolve(inputDir);
  const inventory = existsSync(inventoryPath(root)) ? readJson(inventoryPath(root)) : inspect(root);
  if (!commandOk('whisper', ['--help'])) fail('whisper is required for transcription. Install OpenAI Whisper or skip transcription.');
  const transcriptsDir = join(editDirFor(root), 'transcripts');
  ensureDir(transcriptsDir);
  const model = opt('--model', 'base');
  const language = opt('--language', '');
  const transcriptFiles = [];
  for (const file of inventory.files.filter((entry) => entry.ok && entry.hasAudio)) {
    const whisperArgs = [
      file.path,
      '--model', model,
      '--output_format', 'json',
      '--output_dir', transcriptsDir,
    ];
    if (language) whisperArgs.push('--language', language);
    const result = run('whisper', whisperArgs);
    if (result.status !== 0) fail('whisper transcription failed.', { file: file.path, stderr: result.stderr || result.stdout });
    const transcriptPath = findWhisperJson(transcriptsDir, file.path);
    if (transcriptPath) transcriptFiles.push({ source: file.path, transcriptPath });
  }
  const lines = ['# Takes Packed', '', 'Generated from local Whisper transcript JSON.', ''];
  for (const item of transcriptFiles) {
    const data = readJson(item.transcriptPath);
    lines.push(`## ${basename(item.source)} duration ${ff(probe(item.source).duration)}s`);
    for (const segment of data.segments || []) {
      const text = String(segment.text || '').trim().replace(/\s+/g, ' ');
      if (!text) continue;
      lines.push(`[${ff(segment.start || 0).padStart(6, '0')}-${ff(segment.end || 0).padStart(6, '0')}] ${text}`);
    }
    lines.push('');
  }
  writeFileSync(packedPath(root), `${lines.join('\n')}\n`, 'utf-8');
  const report = {
    ok: true,
    inputDir: root,
    transcriptsDir,
    takesPackedPath: packedPath(root),
    transcriptFiles,
  };
  writeJsonAtomic(join(editDirFor(root), 'transcribe-report.json'), report);
  return report;
}

function dimensions(aspect) {
  if (aspect === '16:9') return { width: 1920, height: 1080 };
  if (aspect === '1:1') return { width: 1080, height: 1080 };
  if (aspect === '4:5') return { width: 1080, height: 1350 };
  return { width: 1080, height: 1920 };
}

function makePlan(inputDir) {
  const root = resolve(inputDir);
  const inventory = existsSync(inventoryPath(root)) ? readJson(inventoryPath(root)) : inspect(root);
  const aspect = opt('--aspect', '9:16');
  const maxDuration = seconds(opt('--max-duration', '60'), 60);
  const title = opt('--title', basename(root));
  const caption = opt('--caption', '');
  let remaining = maxDuration;
  const segments = [];
  for (const file of inventory.files.filter((entry) => entry.ok && entry.hasVideo)) {
    if (remaining <= 0) break;
    const duration = Math.max(0.2, Math.min(file.duration, remaining));
    segments.push({
      id: randomUUID(),
      source: file.path,
      sourceFile: file.file,
      start: 0,
      end: duration,
      reason: 'auto-selected source span',
    });
    remaining -= duration;
  }
  if (!segments.length) fail('No renderable video files found in input folder.', { inventoryPath: inventoryPath(root) });
  const edl = {
    version: 1,
    inputDir: root,
    editDir: editDirFor(root),
    title,
    aspect,
    dimensions: dimensions(aspect),
    targetDuration: maxDuration,
    generatedAt: new Date().toISOString(),
    segments,
    captions: { enabled: Boolean(caption), text: caption },
    grade: { preset: 'neutral' },
  };
  writeJsonAtomic(edlPath(root), edl);
  return edl;
}

function drawTextFilter(text, width) {
  const escaped = text.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
  return `drawtext=text='${escaped}':fontcolor=white:fontsize=${Math.max(36, Math.round(width / 22))}:box=1:boxcolor=black@0.45:boxborderw=18:x=(w-text_w)/2:y=h-(text_h*3)`;
}

function segmentFilter(edl, segment, hasAudio) {
  const { width, height } = edl.dimensions;
  const video = [
    `scale=${width}:${height}:force_original_aspect_ratio=increase`,
    `crop=${width}:${height}`,
    'setsar=1',
    'fps=30',
    'format=yuv420p',
  ];
  const duration = segment.end - segment.start;
  const fade = Math.min(0.03, Math.max(0, duration / 4));
  const audio = hasAudio && fade > 0
    ? ['aresample=async=1:first_pts=0', `afade=t=in:st=0:d=${ff(fade)}`, `afade=t=out:st=${ff(Math.max(0, duration - fade))}:d=${ff(fade)}`].join(',')
    : null;
  return { video: video.join(','), audio };
}

function render(inputDir) {
  const root = resolve(inputDir);
  const edl = existsSync(edlPath(root)) ? readJson(edlPath(root)) : makePlan(root);
  if (!commandOk('ffmpeg')) fail('ffmpeg is required. Install FFmpeg first.');
  if (!commandOk('ffprobe')) fail('ffprobe is required. Install FFmpeg first.');
  const editDir = editDirFor(root);
  const tmpDir = join(editDir, '.render-tmp');
  rmSync(tmpDir, { recursive: true, force: true });
  ensureDir(tmpDir);
  const renderedSegments = [];
  for (const [index, segment] of edl.segments.entries()) {
    const info = probe(segment.source);
    const duration = segment.end - segment.start;
    const out = join(tmpDir, `segment-${String(index + 1).padStart(3, '0')}.mp4`);
    const filters = segmentFilter(edl, segment, info.hasAudio);
    const ffArgs = [
      '-y',
      '-ss', ff(segment.start),
      '-i', segment.source,
      '-t', ff(duration),
      '-vf', filters.video,
      ...(filters.audio ? ['-af', filters.audio] : ['-an']),
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '20',
      ...(filters.audio ? ['-c:a', 'aac', '-b:a', '160k'] : []),
      '-movflags', '+faststart',
      out,
    ];
    const result = run('ffmpeg', ffArgs);
    if (result.status !== 0) fail('ffmpeg failed while rendering a segment.', { segment, stderr: result.stderr });
    renderedSegments.push(out);
  }
  const listPath = join(tmpDir, 'concat.txt');
  writeFileSync(listPath, renderedSegments.map((file) => `file '${file.replace(/'/g, "'\\''")}'`).join('\n') + '\n', 'utf-8');
  const output = resolve(opt('--out', join(editDir, 'preview.mp4')));
  ensureDir(dirname(output));
  const concatOut = edl.captions?.enabled ? join(tmpDir, 'concat.mp4') : output;
  let concat = run('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', concatOut]);
  if (concat.status !== 0) {
    concat = run('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c:v', 'libx264', '-c:a', 'aac', concatOut]);
  }
  if (concat.status !== 0) fail('ffmpeg concat failed.', { stderr: concat.stderr });
  if (edl.captions?.enabled) {
    const filter = drawTextFilter(edl.captions.text, edl.dimensions.width);
    const captioned = run('ffmpeg', ['-y', '-i', concatOut, '-vf', filter, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'copy', output]);
    if (captioned.status !== 0) fail('ffmpeg caption burn failed.', { stderr: captioned.stderr });
  }
  const finalProbe = probe(output);
  const report = {
    ok: true,
    output,
    inputDir: root,
    editDir,
    edlPath: edlPath(root),
    inventoryPath: inventoryPath(root),
    takesPackedPath: packedPath(root),
    duration: finalProbe.duration,
    width: finalProbe.width,
    height: finalProbe.height,
    hasAudio: finalProbe.hasAudio,
    segments: edl.segments.length,
    checks: [
      finalProbe.ok ? 'ffprobe output ok' : 'ffprobe output failed',
      finalProbe.duration > 0 ? 'duration positive' : 'duration missing',
      finalProbe.width === edl.dimensions.width && finalProbe.height === edl.dimensions.height ? 'aspect dimensions matched' : 'aspect dimensions differ',
    ],
  };
  writeJsonAtomic(join(editDir, 'render-report.json'), report);
  return report;
}

function syncMaster(videoInput, masterInput) {
  if (!videoInput || !masterInput) {
    fail('sync-master requires both a camera video and the clean master audio.');
  }
  if (!commandOk('ffmpeg')) fail('ffmpeg is required. Install FFmpeg first.');
  if (!commandOk('ffprobe')) fail('ffprobe is required. Install FFmpeg first.');
  const videoPath = resolve(videoInput);
  const masterPath = resolve(masterInput);
  const videoInfo = probe(videoPath);
  const masterInfo = probe(masterPath);
  if (!videoInfo.ok) fail('Could not inspect the camera video.', { detail: videoInfo.error });
  if (!masterInfo.ok) fail('Could not inspect the master audio.', { detail: masterInfo.error });
  if (!videoInfo.hasVideo) fail('The camera input must contain a video stream.');
  if (!videoInfo.hasAudio) fail('The camera video has no scratch audio to match against the master.');
  if (!masterInfo.hasAudio) fail('The selected master file has no audio stream.');

  const minConfidence = Math.min(0.95, Math.max(
    MASTER_SYNC_MIN_CONFIDENCE,
    seconds(opt('--min-confidence', String(MASTER_SYNC_MIN_CONFIDENCE)), MASTER_SYNC_MIN_CONFIDENCE),
  ));
  const cameraMix = Math.min(1, Math.max(0, seconds(opt('--camera-mix', '0'), 0)));
  const masterOffsetMs = seconds(opt('--master-offset-ms', '0'), 0);
  const reportPath = masterSyncReportPath(videoPath);
  const analyzeOnly = hasFlag('--analyze-only');
  const force = hasFlag('--force');
  const output = resolve(opt('--out', join(dirname(videoPath), 'edit', `${basename(videoPath, extname(videoPath))}-synced.mp4`)));
  if (!analyzeOnly && (output === videoPath || output === masterPath)) {
    fail('Refusing to overwrite source media. Choose a different --out path.');
  }
  const analysis = analyzeMasterSync(videoPath, masterPath, { minConfidence });
  ensureDir(dirname(reportPath));

  const report = {
    ok: analysis.accepted,
    status: analysis.accepted ? 'matched' : 'needs-review',
    videoPath,
    masterPath,
    output: analyzeOnly ? null : output,
    reportPath,
    analyzeOnly,
    forced: force && !analysis.accepted,
    cameraMix,
    masterOffsetMs,
    analysis,
    guidance: analysis.accepted
      ? 'The master match cleared the automatic confidence gate.'
      : 'The match is weak or ambiguous. Review the files, use a manual offset, or explicitly force only after checking the proposed timing.',
  };
  writeJsonAtomic(reportPath, report);

  if (analyzeOnly) return report;
  if (!analysis.accepted && !force) {
    fail('Automatic master sync refused a weak or ambiguous match.', {
      reportPath,
      confidence: analysis.confidence,
      minConfidence,
    });
  }

  ensureDir(dirname(output));
  renderMasterSync({
    videoPath,
    masterPath,
    outputPath: output,
    videoDuration: videoInfo.duration,
    masterDuration: masterInfo.duration,
    analysis,
    cameraMix,
    masterOffsetMs,
  });
  const outputInfo = probe(output);
  if (!outputInfo.ok || !outputInfo.hasVideo || !outputInfo.hasAudio || outputInfo.duration <= 0) {
    fail('The synchronized preview failed output verification.', { output, outputInfo });
  }
  report.status = analysis.accepted ? 'rendered' : 'rendered-forced';
  report.outputDuration = outputInfo.duration;
  report.outputHasVideo = outputInfo.hasVideo;
  report.outputHasAudio = outputInfo.hasAudio;
  report.checks = [
    'source video preserved',
    'output contains video',
    'output contains synchronized master audio',
    analysis.accepted ? 'automatic confidence gate passed' : 'render forced for manual review',
  ];
  writeJsonAtomic(reportPath, report);
  return report;
}

function usage() {
  return {
    ok: true,
    lines: [
      'runner-raw-video-editor',
      '',
      'Commands:',
      '  raw-video-editor doctor --json',
      '  raw-video-editor inspect <footage-dir> --json',
      '  raw-video-editor transcribe <footage-dir> [--model base] [--language en] --json',
      '  raw-video-editor plan <footage-dir> [--max-duration 45] [--aspect 9:16] [--caption "..."] --json',
      '  raw-video-editor render <footage-dir> [--out edit/preview.mp4] --json',
      '  raw-video-editor sync-master <camera-video> <master-audio> [--out edit/synced.mp4] [--camera-mix 0] [--analyze-only] --json',
      '  raw-video-editor repurpose <source-video> [--out-dir edit/repurpose] [--brief variant-brief.json] [--render] --json',
    ],
  };
}

if (command === 'doctor') {
  print({
    ok: commandOk('ffmpeg') && commandOk('ffprobe'),
    checks: [
      { name: 'ffmpeg', ok: commandOk('ffmpeg') },
      { name: 'ffprobe', ok: commandOk('ffprobe') },
      { name: 'whisper', ok: commandOk('whisper', ['--help']), optional: true },
    ],
  });
} else if (command === 'inspect') {
  print(inspect(positional(0) || process.cwd()));
} else if (command === 'transcribe') {
  print(transcribe(positional(0) || process.cwd()));
} else if (command === 'plan') {
  print(makePlan(positional(0) || process.cwd()));
} else if (command === 'render') {
  print(render(positional(0) || process.cwd()));
} else if (command === 'sync-master') {
  try {
    print(syncMaster(positional(0), positional(1)));
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
} else if (command === 'repurpose') {
  try {
    const result = await executeRepurpose({
      source: positional(0),
      outDir: opt('--out-dir', undefined),
      briefPath: opt('--brief', undefined),
      render: hasFlag('--render'),
      sceneThreshold: seconds(opt('--scene-threshold', '0.35'), 0.35),
    });
    print(result);
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
} else {
  print(usage());
}
