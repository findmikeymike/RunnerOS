import { createHash, randomUUID } from 'node:crypto';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const ALLOWED_ASPECTS = new Set(['9:16', '4:5', '1:1', '16:9']);
const ALLOWED_GRADES = new Set(['neutral', 'warm', 'cool', 'contrast', 'monochrome']);
const ALLOWED_MODES = new Set(['standard', 'trial', 'fan-page', 'alternate-account']);
const MAX_VARIANTS = 5;
const VARIANT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function writeJsonAtomic(path, value) {
  ensureDir(dirname(path));
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
  renameSync(tmp, path);
}

function run(command, args) {
  return spawnSync(command, args, { encoding: 'utf-8', maxBuffer: 16 * 1024 * 1024 });
}

function commandOk(command, args = ['-version']) {
  return run(command, args).status === 0;
}

function ff(value) {
  return Number(value).toFixed(3).replace(/\.?0+$/, '');
}

function overlapSeconds(a, b) {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
}

function selectedSeconds(segments) {
  return segments.reduce((total, segment) => total + (segment.end - segment.start), 0);
}

function timelineOverlapRatio(left, right) {
  const leftDuration = selectedSeconds(left);
  const rightDuration = selectedSeconds(right);
  if (!leftDuration || !rightDuration) return 0;
  let overlap = 0;
  for (const a of left) for (const b of right) overlap += overlapSeconds(a, b);
  return Math.min(1, overlap / Math.min(leftDuration, rightDuration));
}

function sequenceSignature(segments) {
  return segments.map((segment) => `${segment.start.toFixed(2)}-${segment.end.toFixed(2)}`).join('|');
}

function hasMeaningfulTimelineChange(segments, sourceDuration) {
  if (!segments.length) return false;
  const selectedDuration = selectedSeconds(segments);
  const openingShift = segments[0].start >= Math.min(1.5, sourceDuration * 0.1);
  const meaningfulReduction = selectedDuration <= sourceDuration * 0.85;
  const reordered = segments.some((segment, index) => index > 0 && segment.start < segments[index - 1].start);
  return openingShift || meaningfulReduction || reordered;
}

function dimensions(aspect) {
  if (aspect === '16:9') return { width: 1920, height: 1080 };
  if (aspect === '1:1') return { width: 1080, height: 1080 };
  if (aspect === '4:5') return { width: 1080, height: 1350 };
  return { width: 1080, height: 1920 };
}

function hashFile(path) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolveHash(hash.digest('hex')));
  });
}

function probeSource(sourcePath) {
  const child = run('ffprobe', [
    '-v', 'error',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    sourcePath,
  ]);
  if (child.status !== 0) throw new Error(child.stderr || child.stdout || 'ffprobe failed');
  const raw = JSON.parse(child.stdout || '{}');
  const video = (raw.streams || []).find((stream) => stream.codec_type === 'video');
  const audio = (raw.streams || []).find((stream) => stream.codec_type === 'audio');
  if (!video) throw new Error('The repurposing source must contain a video stream.');
  return {
    duration: Number(raw.format?.duration || video.duration || 0),
    width: Number(video.width || 0),
    height: Number(video.height || 0),
    frameRate: String(video.avg_frame_rate || video.r_frame_rate || ''),
    videoCodec: video.codec_name || null,
    audioCodec: audio?.codec_name || null,
    hasAudio: Boolean(audio),
  };
}

function detectScenes(sourcePath, threshold = 0.35) {
  const safeThreshold = Math.min(0.95, Math.max(0.05, Number(threshold) || 0.35));
  const child = run('ffmpeg', [
    '-hide_banner',
    '-i', sourcePath,
    '-filter:v', `select='gt(scene,${safeThreshold})',showinfo`,
    '-an',
    '-f', 'null',
    '-',
  ]);
  if (child.status !== 0) throw new Error(child.stderr || child.stdout || 'FFmpeg scene analysis failed.');
  const output = `${child.stderr || ''}\n${child.stdout || ''}`;
  const points = [];
  for (const match of output.matchAll(/pts_time:([0-9]+(?:\.[0-9]+)?)/g)) {
    const value = Number(match[1]);
    if (Number.isFinite(value) && value > 0 && !points.some((item) => Math.abs(item - value) < 0.05)) {
      points.push(value);
    }
  }
  return points.sort((a, b) => a - b);
}

function representativeScenes(scenes, limit = 12) {
  if (scenes.length <= limit) return scenes;
  return Array.from({ length: limit }, (_, index) => scenes[Math.round(index * (scenes.length - 1) / (limit - 1))]);
}

function extractScenePreviews(sourcePath, outputDir, scenes) {
  const previewDir = join(outputDir, 'scene-previews');
  rmSync(previewDir, { recursive: true, force: true });
  ensureDir(previewDir);
  return representativeScenes(scenes).map((scene, index) => {
    const timestamp = Math.min(scene.end - 0.01, scene.start + Math.min(0.25, scene.duration / 2));
    const path = join(previewDir, `scene-${String(index + 1).padStart(2, '0')}.jpg`);
    const child = run('ffmpeg', [
      '-y',
      '-ss', ff(Math.max(0, timestamp)),
      '-i', sourcePath,
      '-frames:v', '1',
      '-vf', 'scale=640:-2:force_original_aspect_ratio=decrease',
      '-q:v', '3',
      path,
    ]);
    if (child.status !== 0) throw new Error(`FFmpeg failed to create a scene preview: ${child.stderr || child.stdout}`);
    return { sceneIndex: scene.index, timestamp, path };
  });
}

function makeBriefTemplate(analysis) {
  const end = Math.min(analysis.source.duration, 20);
  return {
    version: 1,
    source: {
      expectedSha256: analysis.source.sha256,
      releaseKitItemId: null,
      campaignId: null,
    },
    rights: {
      confirmed: false,
      basis: 'owned',
      note: 'Confirm that the artist owns or is licensed to repurpose this source.',
    },
    variants: [
      {
        id: 'alternate-hook-1',
        title: 'Alternate hook',
        destination: { platform: 'instagram', account: '', mode: 'standard' },
        editorialIntent: 'Describe the new angle and why it suits this account.',
        hook: 'Describe the first-three-second idea.',
        aspect: '9:16',
        segments: [{ start: 0, end }],
        overlay: { text: '', style: 'clean' },
        grade: 'neutral',
      },
    ],
  };
}

export async function analyzeRepurposeSource({ source, outDir, sceneThreshold = 0.35 }) {
  if (!commandOk('ffmpeg') || !commandOk('ffprobe')) {
    throw new Error('FFmpeg and ffprobe are required for video repurposing.');
  }
  const sourcePath = resolve(source);
  if (!existsSync(sourcePath)) throw new Error(`Source video not found: ${sourcePath}`);
  const outputDir = resolve(outDir || join(dirname(sourcePath), 'edit', 'repurpose', basename(sourcePath, extname(sourcePath))));
  ensureDir(outputDir);
  const media = probeSource(sourcePath);
  if (!(media.duration > 0)) throw new Error('The source video has no usable duration.');
  const sha256 = await hashFile(sourcePath);
  const sceneBoundaries = detectScenes(sourcePath, sceneThreshold);
  const scenes = [0, ...sceneBoundaries, media.duration].map((start, index, points) => {
    const end = points[index + 1];
    return end == null ? null : { index, start, end, duration: end - start };
  }).filter(Boolean);
  const scenePreviews = extractScenePreviews(sourcePath, outputDir, scenes);
  const analysis = {
    version: 1,
    generatedAt: new Date().toISOString(),
    outputDir,
    source: {
      path: sourcePath,
      file: basename(sourcePath),
      sha256,
      ...media,
    },
    scenes,
    scenePreviews,
    guidance: [
      'Use different hooks, selected moments, structure, pacing, or account-native framing.',
      'A font, filter, border, crop nudge, or re-encode alone is cosmetic and must not pass as a new editorial variant.',
      'Trial is only a destination mode when the user explicitly requests it.',
    ],
  };
  writeJsonAtomic(join(outputDir, 'analysis.json'), analysis);
  const template = makeBriefTemplate(analysis);
  writeJsonAtomic(join(outputDir, 'variant-brief.template.json'), template);
  return { analysis, briefTemplatePath: join(outputDir, 'variant-brief.template.json') };
}

function normalizeSegment(segment, duration, label) {
  const start = Number(segment?.start);
  const end = Number(segment?.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) throw new Error(`${label} has a segment without numeric start/end values.`);
  if (start < 0 || end <= start || end > duration + 0.05) throw new Error(`${label} has an invalid segment ${start}-${end} for a ${duration.toFixed(2)}s source.`);
  return { start, end };
}

export function validateRepurposeBrief(brief, analysis) {
  const errors = [];
  const warnings = [];
  const variants = [];
  if (brief?.version !== 1) errors.push('Brief version must be 1.');
  if (brief?.rights?.confirmed !== true) errors.push('Rights must be explicitly confirmed before variants can be rendered.');
  if (!['owned', 'licensed', 'authorized'].includes(brief?.rights?.basis)) errors.push('Rights basis must be owned, licensed, or authorized.');
  if (!brief?.source?.expectedSha256) {
    errors.push('The brief must name the exact expected source SHA-256.');
  } else if (brief.source.expectedSha256 !== analysis.source.sha256) {
    errors.push('The source file no longer matches the hash used to create this brief.');
  }
  const inputVariants = Array.isArray(brief?.variants) ? brief.variants : [];
  const variantIds = new Set();
  if (!inputVariants.length) errors.push('At least one editorial variant is required.');
  if (inputVariants.length > MAX_VARIANTS) errors.push(`A single job may contain at most ${MAX_VARIANTS} variants.`);

  for (const [index, raw] of inputVariants.entries()) {
    const label = `Variant ${index + 1}`;
    try {
      const id = String(raw?.id || `variant-${index + 1}`).trim();
      const title = String(raw?.title || '').trim();
      const editorialIntent = String(raw?.editorialIntent || '').trim();
      const hook = String(raw?.hook || '').trim();
      const aspect = String(raw?.aspect || '9:16');
      const grade = String(raw?.grade || 'neutral');
      const destination = {
        platform: String(raw?.destination?.platform || '').trim(),
        account: String(raw?.destination?.account || '').trim(),
        mode: String(raw?.destination?.mode || 'standard'),
        trialRequested: raw?.destination?.trialRequested === true,
      };
      if (!id || !title) errors.push(`${label} needs an id and title.`);
      if (!VARIANT_ID_PATTERN.test(id)) errors.push(`${label} id must use lowercase letters, numbers, and hyphens only.`);
      if (variantIds.has(id)) errors.push(`${label} id must be unique within the brief.`);
      variantIds.add(id);
      if (!editorialIntent || !hook) errors.push(`${label} needs an editorial intent and hook.`);
      if (!destination.platform || !destination.account) errors.push(`${label} needs an explicit destination platform and account.`);
      if (!ALLOWED_MODES.has(destination.mode)) errors.push(`${label} has unsupported destination mode ${destination.mode}.`);
      if (destination.mode === 'trial' && !destination.trialRequested) {
        errors.push(`${label} uses Trial mode without an explicit trialRequested confirmation.`);
      }
      if (!ALLOWED_ASPECTS.has(aspect)) errors.push(`${label} has unsupported aspect ${aspect}.`);
      if (!ALLOWED_GRADES.has(grade)) errors.push(`${label} has unsupported grade ${grade}.`);
      const segments = (Array.isArray(raw?.segments) ? raw.segments : []).map((segment) => normalizeSegment(segment, analysis.source.duration, label));
      if (!segments.length) errors.push(`${label} needs at least one selected source segment.`);
      const duration = selectedSeconds(segments);
      if (duration < 3) warnings.push(`${label} is shorter than three seconds and may not be publishable as a Reel.`);
      const meaningfulTimelineChange = hasMeaningfulTimelineChange(segments, analysis.source.duration);
      if (!meaningfulTimelineChange) {
        errors.push(`${label} is cosmetic only. Change the opening, selected moments, duration, or sequence before rendering.`);
      }
      variants.push({
        ...raw,
        id,
        title,
        editorialIntent,
        hook,
        aspect,
        grade,
        destination,
        segments,
        duration,
        meaningfulDifference: meaningfulTimelineChange ? 'meaningfully-different' : 'cosmetic-only',
      });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  for (let left = 0; left < variants.length; left += 1) {
    for (let right = left + 1; right < variants.length; right += 1) {
      const a = variants[left];
      const b = variants[right];
      const overlap = timelineOverlapRatio(a.segments, b.segments);
      const sameOpening = Math.abs(a.segments[0].start - b.segments[0].start) < 1.5;
      const sameSequence = sequenceSignature(a.segments) === sequenceSignature(b.segments);
      if (overlap > 0.9 && sameOpening && sameSequence) {
        errors.push(`${a.title} and ${b.title} are effectively the same edit. Give them different openings, selections, duration, or order.`);
      } else if (overlap > 0.8 && sameOpening) {
        warnings.push(`${a.title} and ${b.title} are borderline similar; review them side by side before approval.`);
      }
    }
  }

  return {
    ok: errors.length === 0,
    status: errors.length ? 'needs-revision' : warnings.length ? 'ready-with-warnings' : 'ready',
    errors,
    warnings,
    variants,
  };
}

function escapeFilterPath(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/,/g, '\\,')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/;/g, '\\;');
}

function videoFilter(variant, overlayTextPath) {
  const { width, height } = dimensions(variant.aspect);
  const anchor = variant.cropAnchor === 'left' ? '0' : variant.cropAnchor === 'right' ? 'iw-ow' : '(iw-ow)/2';
  const filters = [
    `scale=${width}:${height}:force_original_aspect_ratio=increase`,
    `crop=${width}:${height}:${anchor}:(ih-oh)/2`,
    'setsar=1',
    'fps=30',
  ];
  if (variant.grade === 'warm') filters.push('eq=saturation=1.08:gamma_r=1.04:gamma_b=0.97');
  if (variant.grade === 'cool') filters.push('eq=saturation=1.04:gamma_r=0.98:gamma_b=1.04');
  if (variant.grade === 'contrast') filters.push('eq=contrast=1.08:saturation=1.05');
  if (variant.grade === 'monochrome') filters.push('hue=s=0,eq=contrast=1.06');
  if (overlayTextPath) {
    const style = variant.overlay?.style === 'boxed';
    filters.push(`drawtext=textfile='${escapeFilterPath(overlayTextPath)}':fontcolor=white:fontsize=${Math.max(34, Math.round(width / 24))}:box=${style ? 1 : 0}:boxcolor=black@0.58:boxborderw=16:x=(w-text_w)/2:y=h-(text_h*3.2)`);
  }
  filters.push('format=yuv420p');
  return filters.join(',');
}

async function renderVariant({ analysis, outputDir, variant }) {
  const variantDir = join(outputDir, variant.id);
  const tempDir = join(variantDir, '.segments');
  rmSync(tempDir, { recursive: true, force: true });
  ensureDir(tempDir);
  const overlay = String(variant.overlay?.text || '').trim();
  const overlayTextPath = overlay ? join(tempDir, 'overlay.txt') : null;
  if (overlayTextPath) writeFileSync(overlayTextPath, overlay, 'utf-8');
  const rendered = [];
  for (const [index, segment] of variant.segments.entries()) {
    const output = join(tempDir, `segment-${String(index + 1).padStart(3, '0')}.mp4`);
    const args = [
      '-y',
      '-ss', ff(segment.start),
      '-i', analysis.source.path,
      '-t', ff(segment.end - segment.start),
      '-vf', videoFilter(variant, overlayTextPath),
      ...(analysis.source.hasAudio ? ['-af', 'aresample=async=1:first_pts=0,loudnorm=I=-14:TP=-1.5:LRA=11'] : ['-an']),
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '20',
      ...(analysis.source.hasAudio ? ['-c:a', 'aac', '-b:a', '160k'] : []),
      '-movflags', '+faststart',
      output,
    ];
    const child = run('ffmpeg', args);
    if (child.status !== 0) throw new Error(`FFmpeg failed while rendering ${variant.title}: ${child.stderr || child.stdout}`);
    rendered.push(output);
  }
  const concatList = join(tempDir, 'concat.txt');
  writeFileSync(concatList, `${rendered.map((file) => `file '${file.replace(/'/g, "'\\''")}'`).join('\n')}\n`, 'utf-8');
  const output = join(variantDir, `${variant.id}.mp4`);
  let child = run('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', concatList, '-c', 'copy', '-movflags', '+faststart', output]);
  if (child.status !== 0) {
    child = run('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', concatList, '-c:v', 'libx264', ...(analysis.source.hasAudio ? ['-c:a', 'aac'] : ['-an']), '-movflags', '+faststart', output]);
  }
  if (child.status !== 0) throw new Error(`FFmpeg failed while assembling ${variant.title}: ${child.stderr || child.stdout}`);
  const outputProbe = probeSource(output);
  const sha256 = await hashFile(output);
  writeJsonAtomic(join(variantDir, 'edl.json'), {
    version: 1,
    sourcePath: analysis.source.path,
    sourceSha256: analysis.source.sha256,
    ...variant,
  });
  rmSync(tempDir, { recursive: true, force: true });
  return {
    path: output,
    sha256,
    duration: outputProbe.duration,
    width: outputProbe.width,
    height: outputProbe.height,
    hasAudio: outputProbe.hasAudio,
    checks: [
      'source preserved',
      outputProbe.duration > 0 ? 'duration positive' : 'duration missing',
      outputProbe.width === dimensions(variant.aspect).width && outputProbe.height === dimensions(variant.aspect).height
        ? 'aspect dimensions matched'
        : 'aspect dimensions differ',
    ],
  };
}

export async function executeRepurpose({ source, outDir, briefPath, render = false, sceneThreshold = 0.35 }) {
  const { analysis, briefTemplatePath } = await analyzeRepurposeSource({ source, outDir, sceneThreshold });
  if (!briefPath) {
    return {
      ok: true,
      status: 'awaiting-brief',
      analysisPath: join(analysis.outputDir, 'analysis.json'),
      briefTemplatePath,
      guidance: 'Use the analysis to define concrete edits, confirm the pinned source rights, and rerun with --brief --render. The user\'s Create variants action already authorizes the requested renders; do not add another plan-approval pause.',
    };
  }
  const resolvedBrief = resolve(briefPath);
  if (!existsSync(resolvedBrief)) throw new Error(`Variant brief not found: ${resolvedBrief}`);
  const brief = JSON.parse(readFileSync(resolvedBrief, 'utf-8'));
  const validation = validateRepurposeBrief(brief, analysis);
  const manifest = {
    version: 1,
    jobId: randomUUID(),
    createdAt: new Date().toISOString(),
    status: validation.ok ? (render ? 'rendering' : 'planned') : 'needs-revision',
    source: {
      path: analysis.source.path,
      file: analysis.source.file,
      sha256: analysis.source.sha256,
      releaseKitItemId: brief?.source?.releaseKitItemId || null,
      campaignId: brief?.source?.campaignId || null,
    },
    rights: brief?.rights || null,
    validation: {
      status: validation.status,
      errors: validation.errors,
      warnings: validation.warnings,
    },
    variants: validation.variants.map((variant) => ({
      id: variant.id,
      title: variant.title,
      destination: variant.destination,
      editorialIntent: variant.editorialIntent,
      hook: variant.hook,
      sourceSegments: variant.segments,
      transformations: {
        structure: variant.segments.length > 1 ? 'multi-segment recut' : 'new selected excerpt',
        cropAnchor: variant.cropAnchor || 'center',
        overlay: variant.overlay || null,
        grade: variant.grade,
      },
      meaningfulDifference: variant.meaningfulDifference,
      assessmentBasis: 'local-editorial-timeline-gate',
      approvalStatus: 'draft',
      output: null,
      platformMediaId: null,
    })),
  };
  const manifestPath = join(analysis.outputDir, 'variant-manifest.json');
  writeJsonAtomic(manifestPath, manifest);
  if (!validation.ok) {
    return { ok: false, status: 'needs-revision', manifestPath, validation };
  }
  if (!render) {
    return { ok: true, status: 'planned', manifestPath, validation };
  }
  for (const [index, variant] of validation.variants.entries()) {
    try {
      manifest.variants[index].output = await renderVariant({ analysis, outputDir: analysis.outputDir, variant });
      manifest.variants[index].renderStatus = 'ready';
    } catch (error) {
      manifest.variants[index].renderStatus = 'failed';
      manifest.variants[index].failureReason = error instanceof Error ? error.message : String(error);
    }
    writeJsonAtomic(manifestPath, manifest);
  }
  const readyCount = manifest.variants.filter((variant) => variant.renderStatus === 'ready').length;
  const failedCount = manifest.variants.filter((variant) => variant.renderStatus === 'failed').length;
  manifest.status = failedCount === 0
    ? 'rendered-for-review'
    : readyCount > 0
      ? 'partially-rendered'
      : 'needs-attention';
  manifest.completedAt = new Date().toISOString();
  writeJsonAtomic(manifestPath, manifest);
  return {
    ok: readyCount > 0,
    status: manifest.status,
    manifestPath,
    readyCount,
    failedCount,
    variants: manifest.variants,
  };
}
