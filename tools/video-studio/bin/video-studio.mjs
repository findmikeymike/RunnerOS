#!/usr/bin/env node
import { closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const command = args[0] || 'help';

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
  const fd = openSync(tmp, 'w');
  try {
    writeSync(fd, `${JSON.stringify(value, null, 2)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch (error) {
    // Preserve the corrupt file so a later write can't destroy the only copy.
    try { copyFileSync(path, `${path}.${Date.now()}.corrupt.bak`); } catch { /* best-effort */ }
    throw error;
  }
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function defaultSettings(aspectRatio = '9:16') {
  if (aspectRatio === '16:9') return { aspectRatio, width: 1920, height: 1080, fps: 30 };
  if (aspectRatio === '1:1') return { aspectRatio, width: 1080, height: 1080, fps: 30 };
  if (aspectRatio === '4:5') return { aspectRatio, width: 1080, height: 1350, fps: 30 };
  return { aspectRatio, width: 1080, height: 1920, fps: 30 };
}

const VIDEO_EXPORT_PRESETS = {
  'simple-mp4': {},
  placeholder: {},
  'mp4-16x9-1080p': { width: 1920, height: 1080, fps: 30 },
  'mp4-9x16-1080x1920': { width: 1080, height: 1920, fps: 30 },
  'mp4-1x1-1080': { width: 1080, height: 1080, fps: 30 },
  'mp4-4x5-1080x1350': { width: 1080, height: 1350, fps: 30 },
  'mp4-source-size': {},
};

function resolveExportPreset(project, preset, realVideo) {
  const slug = preset || (realVideo ? 'simple-mp4' : 'placeholder');
  const selected = VIDEO_EXPORT_PRESETS[slug];
  if (!selected) fail(`Unknown export preset: ${slug}`);
  if (realVideo && slug === 'placeholder') fail('The placeholder preset requires a non-video output path.');
  if (!realVideo && slug !== 'placeholder') fail(`Preset ${slug} requires a video output path.`);
  const width = selected.width || (typeof project.settings?.width === 'number' ? project.settings.width : 1080);
  const height = selected.height || (typeof project.settings?.height === 'number' ? project.settings.height : 1920);
  const fps = selected.fps || (typeof project.settings?.fps === 'number' ? project.settings.fps : 30);
  return { slug, width, height, fps };
}

function createProject({ title, workspaceId, aspectRatio }) {
  const now = new Date().toISOString();
  return {
    version: 1,
    id: randomUUID(),
    title: title || 'Untitled Video',
    createdAt: now,
    updatedAt: now,
    workspaceId: workspaceId || basename(process.cwd()),
    settings: defaultSettings(aspectRatio),
    media: [],
    timeline: {
      durationMs: 0,
      tracks: [
        { id: 'video-main', type: 'video', label: 'Video', clips: [] },
        { id: 'audio-main', type: 'audio', label: 'Audio', clips: [] },
        { id: 'captions-main', type: 'caption', label: 'Captions', clips: [] },
      ],
      markers: [],
    },
    captions: [],
    overlays: [],
    effects: [],
    templates: [],
    exports: [],
    versions: [{ id: randomUUID(), createdAt: now, summary: 'Created video project', actor: 'system' }],
    agentEvents: [],
  };
}

function validateProject(project) {
  const errors = [];
  const requiredArrays = ['media', 'captions', 'overlays', 'effects', 'templates', 'exports', 'versions', 'agentEvents'];
  if (!project || typeof project !== 'object' || Array.isArray(project)) errors.push('Project must be an object.');
  else {
    if (project.version !== 1) errors.push('version must be 1.');
    if (!project.id) errors.push('id is required.');
    if (!project.title) errors.push('title is required.');
    if (!project.workspaceId) errors.push('workspaceId is required.');
    if (!project.settings || typeof project.settings !== 'object') errors.push('settings is required.');
    else {
      if (!project.settings.aspectRatio) errors.push('settings.aspectRatio is required.');
      if (!(project.settings.width > 0)) errors.push('settings.width must be positive.');
      if (!(project.settings.height > 0)) errors.push('settings.height must be positive.');
      if (!(project.settings.fps > 0)) errors.push('settings.fps must be positive.');
    }
    for (const key of requiredArrays) {
      if (!Array.isArray(project[key])) errors.push(`${key} must be an array.`);
    }
    if (!project.timeline || typeof project.timeline !== 'object') errors.push('timeline is required.');
    else if (!Array.isArray(project.timeline.tracks)) errors.push('timeline.tracks must be an array.');

    const mediaIds = new Set((project.media || []).map((media) => media.id).filter(Boolean));
    for (const [trackIndex, track] of (project.timeline?.tracks || []).entries()) {
      if (!Array.isArray(track.clips)) errors.push(`timeline.tracks[${trackIndex}].clips must be an array.`);
      for (const [clipIndex, clip] of (track.clips || []).entries()) {
        const path = `timeline.tracks[${trackIndex}].clips[${clipIndex}]`;
        if (!clip.id) errors.push(`${path}.id is required.`);
        if (typeof clip.durationMs !== 'number' || !Number.isFinite(clip.durationMs) || clip.durationMs <= 0) errors.push(`${path}.durationMs must be positive.`);
        if (typeof clip.startMs !== 'number' || !Number.isFinite(clip.startMs) || clip.startMs < 0) errors.push(`${path}.startMs must be non-negative.`);
        if (clip.mediaId && !mediaIds.has(clip.mediaId)) errors.push(`${path}.mediaId references missing media.`);
        if (clip.sourceInMs !== undefined && (typeof clip.sourceInMs !== 'number' || !Number.isFinite(clip.sourceInMs) || clip.sourceInMs < 0)) errors.push(`${path}.sourceInMs must be non-negative.`);
        if (clip.sourceOutMs !== undefined && (typeof clip.sourceOutMs !== 'number' || !Number.isFinite(clip.sourceOutMs) || clip.sourceOutMs < 0)) errors.push(`${path}.sourceOutMs must be non-negative.`);
        if (clip.sourceInMs !== undefined && clip.sourceOutMs !== undefined && clip.sourceOutMs <= clip.sourceInMs) errors.push(`${path}.sourceOutMs must be greater than sourceInMs.`);
        if (clip.volume !== undefined && (typeof clip.volume !== 'number' || !Number.isFinite(clip.volume) || clip.volume < 0 || clip.volume > 4)) errors.push(`${path}.volume must be between 0 and 4.`);
        if (clip.speed !== undefined && (typeof clip.speed !== 'number' || !Number.isFinite(clip.speed) || clip.speed < 0.25 || clip.speed > 4)) errors.push(`${path}.speed must be between 0.25 and 4.`);
        if (clip.fadeInMs !== undefined && (typeof clip.fadeInMs !== 'number' || !Number.isFinite(clip.fadeInMs) || clip.fadeInMs < 0)) errors.push(`${path}.fadeInMs must be non-negative.`);
        if (clip.fadeOutMs !== undefined && (typeof clip.fadeOutMs !== 'number' || !Number.isFinite(clip.fadeOutMs) || clip.fadeOutMs < 0)) errors.push(`${path}.fadeOutMs must be non-negative.`);
      }
    }
    for (const [trackIndex, track] of (project.captions || []).entries()) {
      if (!track.id) errors.push(`captions[${trackIndex}].id is required.`);
      if (!track.label) errors.push(`captions[${trackIndex}].label is required.`);
      if (!Array.isArray(track.cues)) errors.push(`captions[${trackIndex}].cues must be an array.`);
      for (const [cueIndex, cue] of (track.cues || []).entries()) {
        const path = `captions[${trackIndex}].cues[${cueIndex}]`;
        if (!cue.id) errors.push(`${path}.id is required.`);
        if (typeof cue.startMs !== 'number' || !Number.isFinite(cue.startMs) || cue.startMs < 0) errors.push(`${path}.startMs must be non-negative.`);
        if (typeof cue.durationMs !== 'number' || !Number.isFinite(cue.durationMs) || cue.durationMs <= 0) errors.push(`${path}.durationMs must be positive.`);
        if (typeof cue.text !== 'string' || cue.text.trim().length === 0) errors.push(`${path}.text is required.`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

function timelineDuration(tracks) {
  return (tracks || []).reduce((duration, track) => {
    const trackEnd = (track.clips || []).reduce((end, clip) => Math.max(end, (clip.startMs || 0) + (clip.durationMs || 0)), 0);
    return Math.max(duration, trackEnd);
  }, 0);
}

function orderedClips(track) {
  return [...(track.clips || [])].sort((a, b) => (a.startMs || 0) - (b.startMs || 0));
}

function addProjectVersion(project, summary) {
  const now = new Date().toISOString();
  project.updatedAt = now;
  project.versions = Array.isArray(project.versions) ? project.versions : [];
  project.versions.push({ id: randomUUID(), createdAt: now, summary, actor: 'user' });
}

function findClip(project, clipId) {
  for (const track of project.timeline?.tracks || []) {
    const index = (track.clips || []).findIndex((clip) => clip.id === clipId);
    if (index !== -1) return { track, clip: track.clips[index], index };
  }
  return null;
}

function lockedTrackError(track) {
  fail(`Track "${track.label || track.id}" is locked. Unlock it before editing clips on this track.`);
}

function packProjectTimeline(project) {
  const next = cloneJson(project);
  let moved = 0;
  for (const track of next.timeline.tracks || []) {
    if (track.locked) continue;
    let cursor = 0;
    track.clips = orderedClips(track).map((clip) => {
      const previous = clip.startMs || 0;
      const updated = { ...clip, startMs: cursor };
      if (previous !== cursor) moved += 1;
      cursor += Math.max(1, clip.durationMs || 1);
      return updated;
    });
  }
  next.timeline.durationMs = timelineDuration(next.timeline.tracks);
  addProjectVersion(next, `Packed timeline (${moved} clip${moved === 1 ? '' : 's'} moved)`);
  return { project: next, changed: moved };
}

function splitProjectClip(project, clipId, atMs) {
  if (!Number.isFinite(atMs) || atMs < 0) fail('--at-ms must be a non-negative number.');
  const next = cloneJson(project);
  const found = findClip(next, clipId);
  if (!found) fail(`Clip not found: ${clipId}`);
  const { track, clip, index } = found;
  if (track.locked) lockedTrackError(track);
  const start = clip.startMs || 0;
  const duration = clip.durationMs || 0;
  const end = start + duration;
  if (atMs <= start || atMs >= end) fail(`Split time must be inside the clip (${start}-${end} ms).`);
  const firstDuration = atMs - start;
  const secondDuration = end - atMs;
  const sourceIn = clip.sourceInMs || 0;
  const first = {
    ...clip,
    durationMs: firstDuration,
    sourceOutMs: clip.sourceOutMs !== undefined ? sourceIn + firstDuration : clip.sourceOutMs,
  };
  const second = {
    ...clip,
    id: randomUUID(),
    startMs: atMs,
    durationMs: secondDuration,
    label: clip.label ? `${clip.label} copy` : undefined,
    sourceInMs: sourceIn + firstDuration,
    sourceOutMs: clip.sourceOutMs,
  };
  track.clips.splice(index, 1, first, second);
  next.timeline.durationMs = timelineDuration(next.timeline.tracks);
  addProjectVersion(next, `Split clip ${clip.label || clip.id}`);
  return { project: next, createdClipId: second.id };
}

function deleteProjectClip(project, clipId, ripple = false) {
  const next = cloneJson(project);
  const found = findClip(next, clipId);
  if (!found) fail(`Clip not found: ${clipId}`);
  const { track, clip, index } = found;
  if (track.locked) lockedTrackError(track);
  const removedDuration = clip.durationMs || 0;
  const removedStart = clip.startMs || 0;
  track.clips.splice(index, 1);
  if (ripple) {
    track.clips = (track.clips || []).map((item) => (item.startMs || 0) > removedStart
      ? { ...item, startMs: Math.max(0, (item.startMs || 0) - removedDuration) }
      : item);
  }
  next.timeline.durationMs = timelineDuration(next.timeline.tracks);
  addProjectVersion(next, `Deleted clip ${clip.label || clip.id}${ripple ? ' with ripple' : ''}`);
  return { project: next, deletedClipId: clipId };
}

function duplicateProjectClip(project, clipId) {
  const next = cloneJson(project);
  const found = findClip(next, clipId);
  if (!found) fail(`Clip not found: ${clipId}`);
  const { track, clip, index } = found;
  if (track.locked) lockedTrackError(track);
  const insertStart = (clip.startMs || 0) + Math.max(1, clip.durationMs || 1);
  const clipDuration = Math.max(1, clip.durationMs || 1);
  const duplicate = {
    ...clip,
    id: randomUUID(),
    startMs: insertStart,
    label: clip.label ? `${clip.label} copy` : undefined,
  };
  track.clips = (track.clips || []).map((item) => item.id !== clip.id && (item.startMs || 0) >= insertStart
    ? { ...item, startMs: (item.startMs || 0) + clipDuration }
    : item);
  track.clips.splice(index + 1, 0, duplicate);
  track.clips = orderedClips(track);
  next.timeline.durationMs = timelineDuration(next.timeline.tracks);
  addProjectVersion(next, `Duplicated clip ${clip.label || clip.id}`);
  return { project: next, createdClipId: duplicate.id };
}

function snapClipStart(track, clipId, proposedStartMs, thresholdMs = 250) {
  const starts = (track.clips || [])
    .filter((clip) => clip.id !== clipId)
    .map((clip) => (clip.startMs || 0) + Math.max(1, clip.durationMs || 1));
  let best = Math.max(0, Math.round(proposedStartMs));
  let bestDistance = thresholdMs + 1;
  for (const start of starts) {
    const distance = Math.abs(start - proposedStartMs);
    if (distance < bestDistance) {
      best = start;
      bestDistance = distance;
    }
  }
  return Math.max(0, best);
}

function moveProjectClip(project, clipId, startMs, snap = false) {
  if (!Number.isFinite(startMs) || startMs < 0) fail('--start-ms must be a non-negative number.');
  const next = cloneJson(project);
  const found = findClip(next, clipId);
  if (!found) fail(`Clip not found: ${clipId}`);
  const { track, clip } = found;
  if (track.locked) lockedTrackError(track);
  const nextStart = snap ? snapClipStart(track, clipId, startMs) : Math.max(0, Math.round(startMs));
  clip.startMs = nextStart;
  track.clips = orderedClips(track);
  next.timeline.durationMs = timelineDuration(next.timeline.tracks);
  addProjectVersion(next, `Moved clip ${clip.label || clip.id} to ${nextStart} ms${snap ? ' with snap' : ''}`);
  return { project: next, movedClipId: clipId, startMs: nextStart };
}

function trimProjectClip(project, clipId, durationMs, sourceInMs, sourceOutMs, ripple = false) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) fail('--duration-ms must be a positive number.');
  const next = cloneJson(project);
  const found = findClip(next, clipId);
  if (!found) fail(`Clip not found: ${clipId}`);
  const { track, clip } = found;
  if (track.locked) lockedTrackError(track);
  const nextDurationMs = Math.max(1, Math.round(durationMs));
  const ordered = orderedClips(track);
  const clipIndex = ordered.findIndex((item) => item.id === clipId);
  const deltaMs = nextDurationMs - Math.max(1, clip.durationMs || 1);
  let editedClip = clip;
  if (ripple) {
    let cursor = 0;
    track.clips = ordered.map((item, index) => {
      const itemDuration = Math.max(1, item.durationMs || 1);
      if (index < clipIndex) {
        cursor = Math.max(cursor, (item.startMs || 0) + itemDuration);
        return item;
      }
      if (item.id === clipId) {
        const nextClip = { ...item, durationMs: nextDurationMs };
        cursor = Math.max(cursor, (item.startMs || 0) + nextDurationMs);
        return nextClip;
      }
      const startMs = Math.max((item.startMs || 0) + deltaMs, cursor);
      cursor = startMs + itemDuration;
      return { ...item, startMs };
    });
    editedClip = track.clips.find((item) => item.id === clipId) || clip;
  } else {
    clip.durationMs = nextDurationMs;
  }
  if (sourceInMs !== undefined) {
    if (!Number.isFinite(sourceInMs) || sourceInMs < 0) fail('--source-in-ms must be a non-negative number.');
    editedClip.sourceInMs = Math.round(sourceInMs);
  }
  if (sourceOutMs !== undefined) {
    if (!Number.isFinite(sourceOutMs) || sourceOutMs < 0) fail('--source-out-ms must be a non-negative number.');
    editedClip.sourceOutMs = Math.round(sourceOutMs);
  }
  next.timeline.durationMs = timelineDuration(next.timeline.tracks);
  addProjectVersion(next, `Trimmed clip ${editedClip.label || editedClip.id}${ripple ? ' with ripple' : ''}`);
  return { project: next, trimmedClipId: clipId, clipDurationMs: editedClip.durationMs };
}

function updateProjectClipSettings(project, clipId, settings) {
  const next = cloneJson(project);
  const found = findClip(next, clipId);
  if (!found) fail(`Clip not found: ${clipId}`);
  const { track, clip } = found;
  if (track.locked) lockedTrackError(track);
  applyClipSettings(clip, settings);
  next.timeline.durationMs = timelineDuration(next.timeline.tracks);
  addProjectVersion(next, `Updated clip settings ${clip.label || clip.id}`);
  return { project: next, updatedClipId: clipId };
}

function inspectProject(project) {
  const issues = [];
  const warnings = [];
  const mediaById = new Map((project.media || []).map((media) => [media.id, media]));
  for (const [trackIndex, track] of (project.timeline?.tracks || []).entries()) {
    const clips = orderedClips(track);
    let cursor = 0;
    for (const [clipIndex, clip] of clips.entries()) {
      const label = clip.label || clip.id || `track ${trackIndex} clip ${clipIndex}`;
      const start = clip.startMs || 0;
      const end = start + (clip.durationMs || 0);
      if (start > cursor) warnings.push({ type: 'gap', trackId: track.id, clipId: clip.id, message: `${label} starts after a ${start - cursor} ms gap.` });
      if (start < cursor) issues.push({ type: 'overlap', trackId: track.id, clipId: clip.id, message: `${label} overlaps the previous clip by ${cursor - start} ms.` });
      if (clip.mediaId) {
        const media = mediaById.get(clip.mediaId);
        if (!media) issues.push({ type: 'missing-media', trackId: track.id, clipId: clip.id, message: `${label} references missing media ${clip.mediaId}.` });
        else if (!['video', 'image', 'audio'].includes(media.type)) warnings.push({ type: 'unsupported-simple-render', trackId: track.id, clipId: clip.id, message: `${label} uses ${media.type}, which the simple MP4 renderer cannot render yet.` });
        else if (!existsSync(media.path)) issues.push({ type: 'missing-file', trackId: track.id, clipId: clip.id, message: `${label} media file is missing: ${media.path}` });
      }
      cursor = Math.max(cursor, end);
    }
  }
  return {
    ok: issues.length === 0,
    issues,
    warnings,
    stats: {
      tracks: project.timeline?.tracks?.length || 0,
      clips: (project.timeline?.tracks || []).reduce((count, track) => count + (track.clips?.length || 0), 0),
      media: project.media?.length || 0,
      durationMs: project.timeline?.durationMs || 0,
    },
  };
}

function inferType(path) {
  const ext = extname(path).toLowerCase();
  if (['.mp4', '.mov', '.m4v', '.webm', '.mkv'].includes(ext)) return 'video';
  if (['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg'].includes(ext)) return 'audio';
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif'].includes(ext)) return 'image';
  if (['.srt', '.vtt'].includes(ext)) return 'caption';
  if (ext === '.svg') return 'svg';
  if (ext === '.json') return 'unknown';
  return 'unknown';
}

function parseFfprobeRate(value) {
  if (typeof value !== 'string' || !value.trim() || value === '0/0') return undefined;
  const [numerator, denominator] = value.split('/').map(Number);
  if (!Number.isFinite(numerator)) return undefined;
  if (!Number.isFinite(denominator) || denominator === 0) return numerator > 0 ? numerator : undefined;
  const fps = numerator / denominator;
  return Number.isFinite(fps) && fps > 0 ? Math.round(fps * 1000) / 1000 : undefined;
}

function parsePositiveNumber(value) {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseFloat(value) : Number.NaN;
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function probeMediaMetadata(path, mediaType = inferType(path)) {
  const stats = statSync(path);
  const metadata = { sizeBytes: stats.size };
  if (!['video', 'audio', 'image'].includes(mediaType)) return metadata;
  const result = spawnSync('ffprobe', [
    '-v', 'error',
    '-print_format', 'json',
    '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height,avg_frame_rate,r_frame_rate',
    path,
  ], { encoding: 'utf-8', timeout: 30_000 });
  if (result.status !== 0 || !result.stdout.trim()) return metadata;
  try {
    const parsed = JSON.parse(result.stdout);
    const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
    const video = streams.find((stream) => stream.codec_type === 'video');
    const audio = streams.find((stream) => stream.codec_type === 'audio');
    const durationSeconds = parsePositiveNumber(parsed.format?.duration);
    if (durationSeconds) metadata.durationMs = Math.max(1, Math.round(durationSeconds * 1000));
    if (video) {
      metadata.hasVideo = true;
      metadata.width = typeof video.width === 'number' && video.width > 0 ? video.width : undefined;
      metadata.height = typeof video.height === 'number' && video.height > 0 ? video.height : undefined;
      metadata.fps = parseFfprobeRate(video.avg_frame_rate) ?? parseFfprobeRate(video.r_frame_rate);
      metadata.codec = video.codec_name;
    }
    if (audio) {
      metadata.hasAudio = true;
      if (!metadata.codec) metadata.codec = audio.codec_name;
    }
  } catch {
    return metadata;
  }
  return metadata;
}

function isVideoOutputPath(path) {
  return ['.mp4', '.mov', '.m4v', '.webm', '.mkv'].includes(extname(path).toLowerCase());
}

function escapeDrawText(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/%/g, '\\%')
    .replace(/\r?\n/g, ' ')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .slice(0, 180);
}

function seconds(ms, fallbackMs = 0) {
  return Math.max(0, (ms ?? fallbackMs) / 1000);
}

function ffmpegNumber(value) {
  return value.toFixed(3).replace(/\.?0+$/, '');
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clipSpeed(clip) {
  return clamp(typeof clip.speed === 'number' && Number.isFinite(clip.speed) ? clip.speed : 1, 0.25, 4);
}

function clipVolume(clip) {
  return clamp(typeof clip.volume === 'number' && Number.isFinite(clip.volume) ? clip.volume : 1, 0, 4);
}

function clipFadeSeconds(clip, key, clipDurationSeconds) {
  const value = typeof clip[key] === 'number' && Number.isFinite(clip[key]) ? clip[key] : 0;
  return clamp(value / 1000, 0, Math.max(0, clipDurationSeconds / 2));
}

function atempoFilter(speed) {
  const parts = [];
  let remaining = speed;
  while (remaining > 2) {
    parts.push('atempo=2');
    remaining /= 2;
  }
  while (remaining < 0.5) {
    parts.push('atempo=0.5');
    remaining /= 0.5;
  }
  parts.push(`atempo=${ffmpegNumber(remaining)}`);
  return parts.join(',');
}

function clipSourceDurationSeconds(clip) {
  const requestedMs = Math.max(1, (clip.durationMs || 1000) * clipSpeed(clip));
  if (
    typeof clip.sourceInMs === 'number'
    && Number.isFinite(clip.sourceInMs)
    && typeof clip.sourceOutMs === 'number'
    && Number.isFinite(clip.sourceOutMs)
  ) {
    return seconds(Math.min(requestedMs, Math.max(1, clip.sourceOutMs - clip.sourceInMs)), 1000);
  }
  return seconds(requestedMs, 1000);
}

function sourceAvailableMs(clip, media) {
  const sourceInMs = typeof clip.sourceInMs === 'number' && Number.isFinite(clip.sourceInMs) ? clip.sourceInMs : 0;
  const sourceOutMs = typeof clip.sourceOutMs === 'number' && Number.isFinite(clip.sourceOutMs)
    ? clip.sourceOutMs
    : typeof media.durationMs === 'number' && Number.isFinite(media.durationMs)
      ? media.durationMs
      : undefined;
  return sourceOutMs !== undefined && sourceOutMs > sourceInMs ? sourceOutMs - sourceInMs : undefined;
}

function assertSourceCanCoverSpeed(clip, media) {
  if (media.type === 'image') return;
  const availableMs = sourceAvailableMs(clip, media);
  if (availableMs === undefined) return;
  const requiredMs = (clip.durationMs || 1000) * clipSpeed(clip);
  if (requiredMs > availableMs + 33) {
    const label = clip.label || clip.id;
    fail(`Clip "${label}" speed requires ${Math.ceil(requiredMs)} ms of source media, but only ${Math.floor(availableMs)} ms is available. Shorten durationMs or extend sourceOutMs.`);
  }
}

function applyClipSettings(clip, input) {
  if (input.volume !== undefined) {
    if (!Number.isFinite(input.volume) || input.volume < 0 || input.volume > 4) fail('--volume must be between 0 and 4.');
    clip.volume = Math.round(input.volume * 1000) / 1000;
  }
  if (input.speed !== undefined) {
    if (!Number.isFinite(input.speed) || input.speed < 0.25 || input.speed > 4) fail('--speed must be between 0.25 and 4.');
    clip.speed = Math.round(input.speed * 1000) / 1000;
  }
  if (input.fadeInMs !== undefined) {
    if (!Number.isFinite(input.fadeInMs) || input.fadeInMs < 0) fail('--fade-in-ms must be non-negative.');
    clip.fadeInMs = Math.round(input.fadeInMs);
  }
  if (input.fadeOutMs !== undefined) {
    if (!Number.isFinite(input.fadeOutMs) || input.fadeOutMs < 0) fail('--fade-out-ms must be non-negative.');
    clip.fadeOutMs = Math.round(input.fadeOutMs);
  }
}

function hasAdjustments(adjustments) {
  return Boolean(adjustments && Object.keys(adjustments).some((key) => key !== 'preset'));
}

function adjustmentFilter(inputLabel, outputLabel, adjustments) {
  if (!hasAdjustments(adjustments)) return `${inputLabel}null${outputLabel}`;
  const brightness = clamp(
    (adjustments?.exposure ?? 0)
      + ((adjustments?.highlights ?? 0) * 0.08)
      + ((adjustments?.shadows ?? 0) * 0.06),
    -1,
    1,
  );
  const contrast = clamp(adjustments?.contrast ?? 1, 0, 3);
  const saturation = clamp(
    (adjustments?.saturation ?? 1)
      + ((adjustments?.temperature ?? 0) * 0.04)
      - Math.abs(adjustments?.tint ?? 0) * 0.02,
    0,
    3,
  );
  const gamma = clamp(1 - ((adjustments?.shadows ?? 0) * 0.12) + ((adjustments?.highlights ?? 0) * 0.08), 0.1, 10);
  const filters = [
    `eq=brightness=${ffmpegNumber(brightness)}:contrast=${ffmpegNumber(contrast)}:saturation=${ffmpegNumber(saturation)}:gamma=${ffmpegNumber(gamma)}`,
  ];
  if ((adjustments?.grain ?? 0) > 0) {
    filters.push(`noise=alls=${Math.round(clamp(adjustments.grain, 0, 1) * 18)}:allf=t`);
  }
  if ((adjustments?.sharpen ?? 0) > 0) {
    filters.push(`unsharp=5:5:${ffmpegNumber(clamp(adjustments.sharpen, 0, 1) * 1.2)}:3:3:0`);
  }
  if ((adjustments?.vignette ?? 0) > 0) {
    filters.push(`vignette=angle=${ffmpegNumber(Math.PI / 5 + clamp(adjustments.vignette, 0, 1) * 0.45)}`);
  }
  return `${inputLabel}${filters.join(',')}${outputLabel}`;
}

function textForClip(clip, fallback) {
  return typeof clip.text?.text === 'string' ? clip.text.text : (clip.label || fallback);
}

const MAX_DRAWTEXT_CAPTION_CUES = 200;

function captionCuesForClip(clip, cueById) {
  const cueIds = Array.isArray(clip.captionCueIds) ? clip.captionCueIds : [];
  const cues = cueIds.map((id) => cueById.get(id)).filter(Boolean);
  if (cues.length === 0) return [];
  if (cues.length === 1) return [{ ...cues[0], startMs: clip.startMs, durationMs: clip.durationMs }];
  const sourceStartMs = Math.min(...cues.map((cue) => cue.startMs || 0));
  return cues
    .map((cue) => {
      const offsetMs = Math.max(0, (cue.startMs || 0) - sourceStartMs);
      const durationMs = Math.min(cue.durationMs || 0, Math.max(0, (clip.durationMs || 0) - offsetMs));
      return durationMs > 0 ? { ...cue, startMs: (clip.startMs || 0) + offsetMs, durationMs } : null;
    })
    .filter(Boolean);
}

function captionCuesForRender(project, visibleTracks) {
  const cueById = new Map((project.captions || []).flatMap((track) => (track.cues || []).map((cue) => [cue.id, cue])));
  const hasTimelineCaptionClips = (project.timeline?.tracks || [])
    .flatMap((track) => track.clips || [])
    .some((clip) => clip.type === 'caption' || Array.isArray(clip.captionCueIds));
  const visibleCaptionClips = visibleTracks
    .flatMap((track) => track.clips || [])
    .filter((clip) => clip.disabled !== true && clip.type === 'caption');
  const visibleCues = visibleCaptionClips.flatMap((clip) => captionCuesForClip(clip, cueById));
  const cues = visibleCues.length > 0
    ? visibleCues
    : hasTimelineCaptionClips
      ? []
      : (project.captions || []).flatMap((track) => track.cues || []);
  return [...cues].sort((a, b) => (a.startMs || 0) - (b.startMs || 0));
}

function assertDrawtextCaptionCueLimit(cues) {
  if (cues.length <= MAX_DRAWTEXT_CAPTION_CUES) return;
  fail(`Simple MP4 renderer can burn at most ${MAX_DRAWTEXT_CAPTION_CUES} caption cues right now; got ${cues.length}. Split the caption track or use a subtitle renderer before exporting.`);
}

function hasAudioStream(path) {
  const result = spawnSync('ffprobe', [
    '-v', 'error',
    '-select_streams', 'a',
    '-show_entries', 'stream=index',
    '-of', 'csv=p=0',
    path,
  ], { encoding: 'utf-8', timeout: 30_000 });
  return result.status === 0 && result.stdout.trim().length > 0;
}

function renderSimpleMp4(project, outputPath, renderSettings) {
  const width = renderSettings?.width || (typeof project.settings?.width === 'number' ? project.settings.width : 1080);
  const height = renderSettings?.height || (typeof project.settings?.height === 'number' ? project.settings.height : 1920);
  const fps = renderSettings?.fps || (typeof project.settings?.fps === 'number' ? project.settings.fps : 30);
  const mediaById = new Map((project.media || []).map((media) => [media.id, media]));
  const visibleTracks = (project.timeline?.tracks || []).filter((track) => track.hidden !== true);
  const audibleTrackIds = new Set(visibleTracks.filter((track) => track.muted !== true).map((track) => track.id));
  const clips = visibleTracks
    .flatMap((track) => (track.clips || []).map((clip) => ({ clip, trackId: track.id })))
    .filter((item) => item.clip.disabled !== true)
    .sort((a, b) => (a.clip.startMs || 0) - (b.clip.startMs || 0));
  const activeDurationMs = clips.reduce((end, { clip }) => Math.max(end, (clip.startMs || 0) + (clip.durationMs || 0)), 0);
  const durationMs = activeDurationMs > 0 ? activeDurationMs : (project.timeline?.durationMs || 3000);
  const durationSeconds = Math.max(1, Math.ceil(durationMs / 1000));
  const mediaClips = clips
    .map(({ clip, trackId }) => ({ clip, trackId, media: clip.mediaId ? mediaById.get(clip.mediaId) : undefined }))
    .filter((item) => item.media);
  const unsupportedClips = mediaClips.filter(({ media }) => !['video', 'image', 'audio', 'caption'].includes(media.type));
  const inputSourceClips = mediaClips.filter(({ media }) => ['video', 'image', 'audio'].includes(media.type));
  if (unsupportedClips.length > 0) {
    const labels = unsupportedClips.slice(0, 3).map(({ clip }) => clip.label || clip.id).join(', ');
    fail(`Simple MP4 renderer only supports video, image, audio, and text clips right now: ${labels}.`);
  }

  const args = ['-y', '-f', 'lavfi', '-i', `color=c=#111111:s=${width}x${height}:r=${fps}:d=${durationSeconds}`];
  const inputClips = [];
  for (const { clip, trackId, media } of inputSourceClips) {
    if (!existsSync(media.path)) fail(`Media file not found for clip "${clip.label || clip.id}": ${media.path}`);
    assertSourceCanCoverSpeed(clip, media);
    const sourceDuration = ffmpegNumber(media.type === 'image' ? seconds(clip.durationMs, 1000) : clipSourceDurationSeconds(clip));
    const sourceIn = seconds(typeof clip.sourceInMs === 'number' ? clip.sourceInMs : 0);
    if (media.type === 'image') {
      args.push('-loop', '1', '-t', sourceDuration, '-i', media.path);
    } else {
      if (sourceIn > 0) args.push('-ss', ffmpegNumber(sourceIn));
      args.push('-t', sourceDuration, '-i', media.path);
    }
    inputClips.push({ clip, trackId, media, inputIndex: inputClips.length + 1 });
  }

  const filters = [`[0:v]format=rgba[base0]`];
  let currentVideo = '[base0]';
  let overlayIndex = 0;
  for (const { clip, media, inputIndex } of inputClips.filter((item) => item.media.type === 'video' || item.media.type === 'image')) {
    const start = ffmpegNumber(seconds(clip.startMs));
    const end = ffmpegNumber(seconds((clip.startMs || 0) + (clip.durationMs || 1000)));
    const prepared = `v${overlayIndex}`;
    const next = `base${overlayIndex + 1}`;
    const adjusted = `adj${overlayIndex}`;
    const setpts = media.type === 'video'
      ? `setpts=(PTS-STARTPTS)/${ffmpegNumber(clipSpeed(clip))}+${start}/TB`
      : `setpts=PTS-STARTPTS+${start}/TB`;
    filters.push(
      `[${inputIndex}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black@0,setsar=1,format=rgba[${adjusted}]`,
    );
    filters.push(adjustmentFilter(`[${adjusted}]`, `[${prepared}]`, clip.adjustments));
    filters.push(`[${prepared}]${setpts}[${prepared}t]`);
    filters.push(`${currentVideo}[${prepared}t]overlay=0:0:enable='between(t,${start},${end})'[${next}]`);
    currentVideo = `[${next}]`;
    overlayIndex += 1;
  }

  const textClips = visibleTracks
    .flatMap((track) => track.clips || [])
    .filter((clip) => clip.disabled !== true)
    .filter((clip) => clip.type !== 'caption')
    .filter((clip) => clip.type === 'text' || clip.text || !clip.mediaId)
    .slice(0, 8);
  for (const [index, clip] of textClips.entries()) {
    const start = seconds(clip.startMs);
    const end = Math.max(start + 0.2, start + seconds(clip.durationMs, 3000));
    const y = Math.round(height * 0.42) + (index % 3) * 86;
    const next = `text${index}`;
    filters.push(
      `${currentVideo}drawtext=text='${escapeDrawText(textForClip(clip, project.title))}':fontcolor=white:fontsize=${Math.max(28, Math.round(width / 24))}:x=(w-text_w)/2:y=${y}:enable='between(t,${ffmpegNumber(start)},${ffmpegNumber(end)})'[${next}]`,
    );
    currentVideo = `[${next}]`;
  }

  const captionCues = captionCuesForRender(project, visibleTracks);
  assertDrawtextCaptionCueLimit(captionCues);
  for (const [index, cue] of captionCues.entries()) {
    const start = seconds(cue.startMs);
    const end = Math.max(start + 0.2, start + seconds(cue.durationMs, 1000));
    const next = `caption${index}`;
    filters.push(
      `${currentVideo}drawtext=text='${escapeDrawText(cue.text)}':fontcolor=white:fontsize=${Math.max(24, Math.round(width / 30))}:x=(w-text_w)/2:y=h-text_h-${Math.max(48, Math.round(height * 0.09))}:box=1:boxcolor=black@0.55:boxborderw=${Math.max(10, Math.round(width / 90))}:enable='between(t,${ffmpegNumber(start)},${ffmpegNumber(end)})'[${next}]`,
    );
    currentVideo = `[${next}]`;
  }

  if (textClips.length === 0 && inputClips.length === 0 && captionCues.length === 0) {
    filters.push(`${currentVideo}drawtext=text='${escapeDrawText(project.title)}':fontcolor=white:fontsize=${Math.max(28, Math.round(width / 22))}:x=(w-text_w)/2:y=(h-text_h)/2[title0]`);
    currentVideo = '[title0]';
  }

  const audioLabels = [];
  inputClips.filter((item) => audibleTrackIds.has(item.trackId) && (item.media.type === 'audio' || (item.media.type === 'video' && hasAudioStream(item.media.path)))).forEach(({ clip, inputIndex }, index) => {
    const delayMs = Math.max(0, Math.round(clip.startMs || 0));
    const clipDurationSeconds = seconds(clip.durationMs, 1000);
    const sourceDuration = ffmpegNumber(clipSourceDurationSeconds(clip));
    const fadeIn = clipFadeSeconds(clip, 'fadeInMs', clipDurationSeconds);
    const fadeOut = clipFadeSeconds(clip, 'fadeOutMs', clipDurationSeconds);
    const audioFilters = [
      `atrim=duration=${sourceDuration}`,
      'asetpts=PTS-STARTPTS',
      atempoFilter(clipSpeed(clip)),
      `volume=${ffmpegNumber(clipVolume(clip))}`,
    ];
    if (fadeIn > 0) audioFilters.push(`afade=t=in:st=0:d=${ffmpegNumber(fadeIn)}`);
    if (fadeOut > 0) audioFilters.push(`afade=t=out:st=${ffmpegNumber(Math.max(0, clipDurationSeconds - fadeOut))}:d=${ffmpegNumber(fadeOut)}`);
    audioFilters.push(`adelay=${delayMs}:all=1`);
    const label = `a${index}`;
    filters.push(`[${inputIndex}:a]${audioFilters.join(',')}[${label}]`);
    audioLabels.push(`[${label}]`);
  });
  if (audioLabels.length > 0) {
    filters.push(`${audioLabels.join('')}amix=inputs=${audioLabels.length}:duration=longest:dropout_transition=0,atrim=duration=${durationSeconds}[aout]`);
  }

  filters.push(`${currentVideo}format=yuv420p[vout]`);
  args.push('-filter_complex', filters.join(';'), '-map', '[vout]');
  if (audioLabels.length > 0) args.push('-map', '[aout]');
  args.push('-t', String(durationSeconds), '-r', String(fps), '-pix_fmt', 'yuv420p');
  if (['.mp4', '.mov', '.m4v'].includes(extname(outputPath).toLowerCase())) {
    args.push('-movflags', '+faststart');
  }
  args.push(outputPath);

  const result = spawnSync('ffmpeg', args, { encoding: 'utf-8', timeout: 300_000 });
  if (result.status !== 0) fail(result.stderr || result.stdout || 'ffmpeg failed to render video.');
}

function probeMedia(path) {
  const resolved = resolve(path);
  if (!existsSync(resolved)) fail(`Media file not found: ${path}`);
  const stats = statSync(resolved);
  const type = inferType(resolved);
  return {
    ok: true,
    path: resolved,
    label: basename(resolved),
    type,
    sizeBytes: stats.size,
    modifiedAt: stats.mtime.toISOString(),
    ...probeMediaMetadata(resolved, type),
  };
}

function runDoctor() {
  const nodeVersion = process.version;
  const ffmpeg = spawnSync('ffmpeg', ['-version'], { encoding: 'utf-8', timeout: 15_000 });
  const ffmpegAvailable = ffmpeg.status === 0;
  const lines = [
    `✓ Node: ${nodeVersion}`,
    ffmpegAvailable ? '✓ ffmpeg available for video/image/audio/text MP4 exports' : '• ffmpeg not found; placeholder exports still work.',
    `• Tool root: ${resolve(join(import.meta.dirname, '..'))}`,
    '• Simple media timeline renderer enabled for .mp4 outputs.',
  ];
  print({
    ok: true,
    source: 'video-studio',
    checks: [
      { name: 'node', ok: true, value: nodeVersion },
      { name: 'ffmpeg', ok: ffmpegAvailable },
      { name: 'renderer', ok: ffmpegAvailable, value: ffmpegAvailable ? 'ffmpeg-simple' : 'placeholder-only' },
    ],
    canCreateProjects: true,
    canPlaceholderExport: true,
    canRenderRealVideo: ffmpegAvailable,
    lines,
  });
}

function runCreate() {
  const target = positional(0);
  if (!target) fail('Usage: video-studio create <project-dir-or-file> [--title <title>] [--json]');
  const resolvedTarget = resolve(target);
  const projectPath = extname(resolvedTarget) === '.json'
    ? resolvedTarget
    : join(resolvedTarget, 'video.runner-video.json');
  if (existsSync(projectPath) && !hasFlag('--force')) {
    fail(`Project already exists: ${projectPath}. Pass --force to overwrite.`);
  }
  const project = createProject({
    title: opt('--title', 'Untitled Video'),
    workspaceId: opt('--workspace-id', basename(process.cwd())),
    aspectRatio: opt('--aspect-ratio', '9:16'),
  });
  writeJsonAtomic(projectPath, project);
  print({
    ok: true,
    projectPath,
    projectId: project.id,
    title: project.title,
    lines: [`✓ Created video project: ${projectPath}`],
  });
}

function runValidate() {
  const projectPath = positional(0);
  if (!projectPath) fail('Usage: video-studio validate <project-path> [--json]');
  const resolved = resolve(projectPath);
  if (!existsSync(resolved)) fail(`Project file not found: ${projectPath}`);
  let project;
  try {
    project = readJson(resolved);
  } catch (error) {
    fail(`Project JSON is invalid: ${error.message}`);
  }
  const validation = validateProject(project);
  if (!validation.ok) fail('Project validation failed.', { projectPath: resolved, errors: validation.errors });
  print({
    ok: true,
    projectPath: resolved,
    projectId: project.id,
    title: project.title,
    tracks: project.timeline.tracks.length,
    media: project.media.length,
    lines: [`✓ Project valid: ${resolved}`],
  });
}

function readValidProject(projectPath) {
  const resolved = resolve(projectPath);
  if (!existsSync(resolved)) fail(`Project file not found: ${projectPath}`);
  let project;
  try {
    project = readJson(resolved);
  } catch (error) {
    fail(`Project JSON is invalid: ${error.message}`);
  }
  const validation = validateProject(project);
  if (!validation.ok) fail('Project validation failed.', { projectPath: resolved, errors: validation.errors });
  return { resolved, project };
}

function runProbe() {
  const mediaPath = positional(0);
  if (!mediaPath) fail('Usage: video-studio probe <media-path> [--json]');
  print(probeMedia(mediaPath));
}

function runInspect() {
  const projectPath = positional(0);
  if (!projectPath) fail('Usage: video-studio inspect <project-path> [--json]');
  const { resolved, project } = readValidProject(projectPath);
  const report = inspectProject(project);
  print({
    ok: report.ok,
    projectPath: resolved,
    ...report,
    lines: [
      report.ok ? `✓ Project inspect passed: ${resolved}` : `✕ Project inspect found ${report.issues.length} issue(s).`,
      `• ${report.stats.clips} clips across ${report.stats.tracks} tracks`,
      `• ${report.warnings.length} warning(s)`,
    ],
  });
  if (!report.ok) process.exit(1);
}

function runDryRun() {
  const projectPath = positional(0);
  if (!projectPath) fail('Usage: video-studio dry-run <project-path> [--json]');
  const { resolved, project } = readValidProject(projectPath);
  const report = inspectProject(project);
  const ffmpeg = spawnSync('ffmpeg', ['-version'], { encoding: 'utf-8', timeout: 15_000 });
  const ffmpegAvailable = ffmpeg.status === 0;
  const renderable = report.ok && ffmpegAvailable && report.warnings.every((warning) => warning.type !== 'unsupported-simple-render');
  print({
    ok: renderable,
    projectPath: resolved,
    renderable,
    ffmpegAvailable,
    inspect: report,
    lines: [
      renderable ? `✓ Dry-run export passed: ${resolved}` : `✕ Dry-run export failed: ${resolved}`,
      ffmpegAvailable ? '✓ ffmpeg available' : '✕ ffmpeg unavailable',
      `• ${report.issues.length} issue(s), ${report.warnings.length} warning(s)`,
    ],
  });
  if (!renderable) process.exit(1);
}

function runEdit() {
  const projectPath = positional(0);
  if (!projectPath) fail('Usage: video-studio edit <project-path> --action pack|split|delete|duplicate|move|trim|settings [--clip-id <id>] [--at-ms <ms>] [--start-ms <ms>] [--duration-ms <ms>] [--source-in-ms <ms>] [--source-out-ms <ms>] [--volume <0-4>] [--speed <0.25-4>] [--fade-in-ms <ms>] [--fade-out-ms <ms>] [--snap] [--ripple] [--json]');
  const action = opt('--action', '');
  const clipId = opt('--clip-id', '');
  const { resolved, project } = readValidProject(projectPath);
  let result;
  if (action === 'pack') result = packProjectTimeline(project);
  else if (action === 'split') result = splitProjectClip(project, clipId, Number(opt('--at-ms', Number.NaN)));
  else if (action === 'delete') result = deleteProjectClip(project, clipId, hasFlag('--ripple'));
  else if (action === 'duplicate') result = duplicateProjectClip(project, clipId);
  else if (action === 'move') result = moveProjectClip(project, clipId, Number(opt('--start-ms', Number.NaN)), hasFlag('--snap'));
  else if (action === 'trim') result = trimProjectClip(
    project,
    clipId,
    Number(opt('--duration-ms', Number.NaN)),
    args.includes('--source-in-ms') ? Number(opt('--source-in-ms', Number.NaN)) : undefined,
    args.includes('--source-out-ms') ? Number(opt('--source-out-ms', Number.NaN)) : undefined,
    hasFlag('--ripple'),
  );
  else if (action === 'settings') result = updateProjectClipSettings(project, clipId, {
    volume: args.includes('--volume') ? Number(opt('--volume', Number.NaN)) : undefined,
    speed: args.includes('--speed') ? Number(opt('--speed', Number.NaN)) : undefined,
    fadeInMs: args.includes('--fade-in-ms') ? Number(opt('--fade-in-ms', Number.NaN)) : undefined,
    fadeOutMs: args.includes('--fade-out-ms') ? Number(opt('--fade-out-ms', Number.NaN)) : undefined,
  });
  else fail('Unknown edit action. Use pack, split, delete, duplicate, move, trim, or settings.');
  const validation = validateProject(result.project);
  if (!validation.ok) fail('Edit produced an invalid project.', { errors: validation.errors });
  writeJsonAtomic(resolved, result.project);
  print({
    ok: true,
    projectPath: resolved,
    action,
    ...Object.fromEntries(Object.entries(result).filter(([key]) => key !== 'project')),
    durationMs: result.project.timeline.durationMs,
    lines: [`✓ Applied ${action} edit: ${resolved}`],
  });
}

function runExport() {
  const projectPath = positional(0);
  if (!projectPath) fail('Usage: video-studio export <project-path> --out <output-path> [--json]');
  const resolvedProject = resolve(projectPath);
  const outPath = resolve(opt('--out', join(dirname(resolvedProject), 'renders', 'preview.placeholder.txt')));
  if (!existsSync(resolvedProject)) fail(`Project file not found: ${projectPath}`);
  const project = readJson(resolvedProject);
  const validation = validateProject(project);
  if (!validation.ok) fail('Project validation failed.', { projectPath: resolvedProject, errors: validation.errors });
  // Never overwrite source media with the export output (spec hard rule).
  const projectDir = dirname(resolvedProject);
  const sourceMediaPaths = new Set(
    (project.media || []).map((media) => (media && media.path ? resolve(projectDir, media.path) : null)).filter(Boolean),
  );
  if (sourceMediaPaths.has(outPath)) {
    fail('Refusing to overwrite source media with the export output. Choose a different --out path.');
  }
  ensureDir(dirname(outPath));
  const realVideo = isVideoOutputPath(outPath);
  const renderSettings = resolveExportPreset(project, opt('--preset', realVideo ? 'simple-mp4' : 'placeholder'), realVideo);
  if (realVideo) {
    renderSimpleMp4(project, outPath, renderSettings);
  } else {
    writeFileSync(
      outPath,
      [
        'RunnerOS Video Studio placeholder export',
        `Project: ${project.title}`,
        `Project ID: ${project.id}`,
        `Created: ${new Date().toISOString()}`,
        'This is not a playable MP4. Use an .mp4 output path for the simple FFmpeg renderer.',
        '',
      ].join('\n'),
      'utf-8',
    );
  }
  const receiptPath = `${outPath}.receipt.json`;
  const receipt = {
    ok: true,
    placeholder: !realVideo,
    rendered: realVideo,
    projectPath: resolvedProject,
    outputPath: outPath,
    preset: renderSettings.slug,
    width: renderSettings.width,
    height: renderSettings.height,
    fps: renderSettings.fps,
    createdAt: new Date().toISOString(),
    engine: realVideo ? 'runneros-video-studio-ffmpeg-simple' : 'runneros-video-studio-placeholder',
    note: realVideo ? 'Playable MP4 rendered by the simple FFmpeg media timeline engine.' : 'Placeholder export written by foundation CLI.',
  };
  writeJsonAtomic(receiptPath, receipt);
  project.exports.push({
    id: randomUUID(),
    createdAt: receipt.createdAt,
    status: 'succeeded',
    path: outPath,
    preset: renderSettings.slug,
    placeholder: !realVideo,
    receiptPath,
  });
  project.updatedAt = receipt.createdAt;
  writeJsonAtomic(resolvedProject, project);
  print({
    ok: true,
    projectPath: resolvedProject,
    outputPath: outPath,
    receiptPath,
    placeholder: !realVideo,
    rendered: realVideo,
    preset: renderSettings.slug,
    width: renderSettings.width,
    height: renderSettings.height,
    fps: renderSettings.fps,
    lines: [
      realVideo ? `✓ MP4 export rendered: ${outPath}` : `✓ Placeholder export written: ${outPath}`,
      `✓ Receipt written: ${receiptPath}`,
      realVideo ? '• Playable MP4 created by the simple media renderer.' : '• Use an .mp4 output path for the simple renderer.',
    ],
  });
}

function usage() {
  console.log(`runner-video-studio

Usage:
  video-studio doctor [--json]
  video-studio create <project-dir-or-file> [--title <title>] [--aspect-ratio 9:16|1:1|16:9|4:5] [--force] [--json]
  video-studio probe <media-path> [--json]
  video-studio inspect <project-path> [--json]
  video-studio dry-run <project-path> [--json]
  video-studio edit <project-path> --action pack|split|delete|duplicate|move|trim|settings [--clip-id <id>] [--at-ms <ms>] [--start-ms <ms>] [--duration-ms <ms>] [--source-in-ms <ms>] [--source-out-ms <ms>] [--volume <0-4>] [--speed <0.25-4>] [--fade-in-ms <ms>] [--fade-out-ms <ms>] [--snap] [--ripple] [--json]
  video-studio validate <project-path> [--json]
  video-studio export <project-path> --out <output-path> [--preset <name>] [--json]
`);
}

if (command === 'doctor') runDoctor();
else if (command === 'create') runCreate();
else if (command === 'validate') runValidate();
else if (command === 'probe') runProbe();
else if (command === 'inspect') runInspect();
else if (command === 'dry-run') runDryRun();
else if (command === 'edit') runEdit();
else if (command === 'export') runExport();
else usage();
