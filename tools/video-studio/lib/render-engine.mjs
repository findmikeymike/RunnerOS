// Canonical FFmpeg timeline renderer shared by the Node CLI and agent tools.
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const SIMPLE_RENDER_TIMEOUT_MS = 180_000;
export function positiveNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}
function seconds(ms, fallbackMs = 0) {
    return Math.max(0, (ms ?? fallbackMs) / 1000);
}
export function ffmpegNumber(value) {
    return value.toFixed(3).replace(/\.?0+$/, '');
}
export function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
export function clipSpeed(clip) {
    return clamp(typeof clip.speed === 'number' && Number.isFinite(clip.speed) ? clip.speed : 1, 0.25, 4);
}
function clipVolume(clip) {
    return clamp(typeof clip.volume === 'number' && Number.isFinite(clip.volume) ? clip.volume : 1, 0, 4);
}
function clipFadeSeconds(clip, key, clipDurationSeconds) {
    const value = typeof clip[key] === 'number' && Number.isFinite(clip[key]) ? clip[key] : 0;
    return clamp(value / 1000, 0, Math.max(0, clipDurationSeconds / 2));
}
export function finiteNumber(value, fallback) {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
export function clipTransform(clip) {
    const transform = clip.transform && typeof clip.transform === 'object' ? clip.transform : {};
    return {
        x: finiteNumber(transform.x, 0),
        y: finiteNumber(transform.y, 0),
        scale: clamp(finiteNumber(transform.scale, 1), 0.05, 5),
        rotateDeg: finiteNumber(transform.rotateDeg, 0),
    };
}
function clipOpacity(clip) {
    return clamp(finiteNumber(clip.opacity, 1), 0, 1);
}
function clipCrop(clip, media) {
    if (!clip.crop || typeof clip.crop !== 'object')
        return null;
    const crop = clip.crop;
    const mediaWidth = positiveNumber(media.width) ?? Number.POSITIVE_INFINITY;
    const mediaHeight = positiveNumber(media.height) ?? Number.POSITIVE_INFINITY;
    const x = Math.max(0, Math.round(finiteNumber(crop.x, 0)));
    const y = Math.max(0, Math.round(finiteNumber(crop.y, 0)));
    const width = Math.round(finiteNumber(crop.width, 0));
    const height = Math.round(finiteNumber(crop.height, 0));
    if (width <= 0 || height <= 0)
        return null;
    return {
        x: clamp(x, 0, Math.max(0, mediaWidth - 1)),
        y: clamp(y, 0, Math.max(0, mediaHeight - 1)),
        width: Math.max(1, Math.min(width, Math.max(1, mediaWidth - x))),
        height: Math.max(1, Math.min(height, Math.max(1, mediaHeight - y))),
    };
}
function visualSourceSize(media, crop, canvasWidth, canvasHeight) {
    return {
        width: crop?.width ?? positiveNumber(media.width) ?? canvasWidth,
        height: crop?.height ?? positiveNumber(media.height) ?? canvasHeight,
    };
}
function fittedVisualSize(source, canvasWidth, canvasHeight, scale) {
    const fit = Math.min(canvasWidth / Math.max(1, source.width), canvasHeight / Math.max(1, source.height));
    return {
        width: Math.max(1, Math.round(source.width * fit * scale)),
        height: Math.max(1, Math.round(source.height * fit * scale)),
    };
}
function ffmpegExprNumber(value) {
    const rounded = Math.round(value * 1000) / 1000;
    return Object.is(rounded, -0) ? '0' : ffmpegNumber(rounded);
}
function keyframeExpression(clip, property, fallback) {
    const frames = Array.isArray(clip.keyframes)
        ? clip.keyframes
            .filter((frame) => Boolean(frame) && typeof frame === 'object')
            .filter((frame) => frame.property === property && typeof frame.value === 'number' && Number.isFinite(frame.value))
            .map((frame) => ({
            timeMs: clamp(Math.round(finiteNumber(frame.timeMs, 0)), 0, Math.max(1, clip.durationMs)),
            value: frame.value,
        }))
            .sort((a, b) => a.timeMs - b.timeMs)
        : [];
    if (frames.length === 0)
        return ffmpegExprNumber(fallback);
    const hasExplicitZeroFrame = frames.some((frame) => frame.timeMs === 0);
    const uniqueFrames = [...(hasExplicitZeroFrame ? [] : [{ timeMs: 0, value: fallback }]), ...frames]
        .filter((frame, index, items) => index === items.findIndex((item) => item.timeMs === frame.timeMs))
        .sort((a, b) => a.timeMs - b.timeMs);
    if (uniqueFrames.length === 1)
        return ffmpegExprNumber(uniqueFrames[0].value);
    const timelineSeconds = (timeMs) => (clip.startMs + timeMs) / 1000;
    let expression = ffmpegExprNumber(uniqueFrames.at(-1).value);
    for (let index = uniqueFrames.length - 2; index >= 0; index -= 1) {
        const current = uniqueFrames[index];
        const next = uniqueFrames[index + 1];
        const start = timelineSeconds(current.timeMs);
        const end = timelineSeconds(next.timeMs);
        const span = Math.max(0.001, end - start);
        const value = `${ffmpegExprNumber(current.value)}+(${ffmpegExprNumber(next.value - current.value)})*((t-${ffmpegExprNumber(start)})/${ffmpegExprNumber(span)})`;
        expression = `if(lt(t,${ffmpegExprNumber(end)}),${value},${expression})`;
    }
    return expression;
}
function visualOverlayPosition(clip, transform) {
    const x = keyframeExpression(clip, 'x', transform.x);
    const y = keyframeExpression(clip, 'y', transform.y);
    return {
        x: `(main_w-overlay_w)/2+${x}`,
        y: `(main_h-overlay_h)/2+${y}`,
    };
}
function visualCompositionFilter(inputLabel, outputLabel, clip, media, canvas) {
    const transform = clipTransform(clip);
    const crop = clipCrop(clip, media);
    const source = visualSourceSize(media, crop, canvas.width, canvas.height);
    const fitted = fittedVisualSize(source, canvas.width, canvas.height, transform.scale);
    const parts = [];
    if (crop)
        parts.push(`crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}`);
    parts.push(`scale=${fitted.width}:${fitted.height}:force_original_aspect_ratio=decrease`);
    parts.push('setsar=1', 'format=rgba');
    if (transform.rotateDeg !== 0) {
        const angle = (transform.rotateDeg * Math.PI) / 180;
        parts.push(`rotate=${ffmpegExprNumber(angle)}:ow=rotw(${ffmpegExprNumber(angle)}):oh=roth(${ffmpegExprNumber(angle)}):fillcolor=black@0`);
    }
    const opacity = clipOpacity(clip);
    if (opacity < 1)
        parts.push(`colorchannelmixer=aa=${ffmpegExprNumber(opacity)}`);
    return `${inputLabel}${parts.join(',')}${outputLabel}`;
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
    const requestedMs = Math.max(1, clip.durationMs * clipSpeed(clip));
    if (typeof clip.sourceInMs === 'number'
        && Number.isFinite(clip.sourceInMs)
        && typeof clip.sourceOutMs === 'number'
        && Number.isFinite(clip.sourceOutMs)) {
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
    if (media.type === 'image')
        return;
    const availableMs = sourceAvailableMs(clip, media);
    if (availableMs === undefined)
        return;
    const requiredMs = clip.durationMs * clipSpeed(clip);
    if (requiredMs > availableMs + 33) {
        const label = typeof clip.label === 'string' ? clip.label : clip.id;
        throw new Error(`Clip "${label}" speed requires ${Math.ceil(requiredMs)} ms of source media, but only ${Math.floor(availableMs)} ms is available. Shorten durationMs or extend sourceOutMs.`);
    }
}
function hasAdjustments(adjustments) {
    return Boolean(adjustments && Object.keys(adjustments).some((key) => key !== 'preset'));
}
function adjustmentFilter(inputLabel, outputLabel, adjustments) {
    if (!hasAdjustments(adjustments))
        return `${inputLabel}null${outputLabel}`;
    const brightness = clamp((adjustments?.exposure ?? 0) + ((adjustments?.highlights ?? 0) * 0.08) + ((adjustments?.shadows ?? 0) * 0.06), -1, 1);
    const contrast = clamp(adjustments?.contrast ?? 1, 0, 3);
    const saturation = clamp((adjustments?.saturation ?? 1) + ((adjustments?.temperature ?? 0) * 0.04) - Math.abs(adjustments?.tint ?? 0) * 0.02, 0, 3);
    const gamma = clamp(1 - ((adjustments?.shadows ?? 0) * 0.12) + ((adjustments?.highlights ?? 0) * 0.08), 0.1, 10);
    const parts = [`eq=brightness=${ffmpegNumber(brightness)}:contrast=${ffmpegNumber(contrast)}:saturation=${ffmpegNumber(saturation)}:gamma=${ffmpegNumber(gamma)}`];
    if ((adjustments?.grain ?? 0) > 0) {
        const strength = Math.round(clamp(adjustments?.grain ?? 0, 0, 1) * 18);
        parts.push(`noise=alls=${strength}:allf=t`);
    }
    if ((adjustments?.sharpen ?? 0) > 0) {
        const amount = ffmpegNumber(clamp(adjustments?.sharpen ?? 0, 0, 1) * 1.2);
        parts.push(`unsharp=5:5:${amount}:3:3:0`);
    }
    if ((adjustments?.vignette ?? 0) > 0) {
        const angle = ffmpegNumber(Math.PI / 5 + clamp(adjustments?.vignette ?? 0, 0, 1) * 0.45);
        parts.push(`vignette=angle=${angle}`);
    }
    return `${inputLabel}${parts.join(',')}${outputLabel}`;
}
function textForClip(clip, fallback) {
    const textPayload = clip.text;
    if (typeof textPayload === 'object' && textPayload && 'text' in textPayload && typeof textPayload.text === 'string') {
        return textPayload.text;
    }
    return typeof clip.label === 'string' ? clip.label : fallback;
}
const MAX_DRAWTEXT_CAPTION_CUES = 200;
function captionCuesForClip(clip, cueById) {
    const cueIds = Array.isArray(clip.captionCueIds) ? clip.captionCueIds : [];
    const cues = cueIds.map((id) => cueById.get(id)).filter((cue) => Boolean(cue));
    if (cues.length === 0)
        return [];
    if (cues.length === 1)
        return [{ ...cues[0], startMs: clip.startMs, durationMs: clip.durationMs }];
    const sourceStartMs = Math.min(...cues.map((cue) => cue.startMs));
    return cues
        .map((cue) => {
        const offsetMs = Math.max(0, cue.startMs - sourceStartMs);
        const durationMs = Math.min(cue.durationMs, Math.max(0, clip.durationMs - offsetMs));
        return durationMs > 0 ? { ...cue, startMs: clip.startMs + offsetMs, durationMs } : null;
    })
        .filter((cue) => Boolean(cue));
}
function captionCuesForRender(project, visibleTracks) {
    const cueById = new Map(project.captions.flatMap((track) => track.cues.map((cue) => [cue.id, cue])));
    const hasTimelineCaptionClips = project.timeline.tracks
        .flatMap((track) => track.clips)
        .some((clip) => clip.type === 'caption' || Array.isArray(clip.captionCueIds));
    const visibleCaptionClips = visibleTracks
        .flatMap((track) => track.clips)
        .filter((clip) => clip.disabled !== true && clip.type === 'caption');
    const visibleCues = visibleCaptionClips.flatMap((clip) => captionCuesForClip(clip, cueById));
    const cues = visibleCues.length > 0
        ? visibleCues
        : hasTimelineCaptionClips
            ? []
            : project.captions.flatMap((track) => track.cues);
    return [...cues].sort((a, b) => a.startMs - b.startMs);
}
function assertDrawtextCaptionCueLimit(cues) {
    if (cues.length <= MAX_DRAWTEXT_CAPTION_CUES)
        return;
    throw new Error(`Simple MP4 renderer can burn at most ${MAX_DRAWTEXT_CAPTION_CUES} caption cues right now; got ${cues.length}. Split the caption track or use a subtitle renderer before exporting.`);
}
function hasAudioStream(path) {
    const result = spawnSync('ffprobe', [
        '-v', 'error',
        '-select_streams', 'a',
        '-show_entries', 'stream=index',
        '-of', 'csv=p=0',
        path,
    ], { encoding: 'utf-8' });
    return result.status === 0 && result.stdout.trim().length > 0;
}
/** Capability checks are shared by CLI dry-run and every real export. */
export function validateRenderCapabilities(project) {
  const issues = [];
  const add = (code, message, clip, track) => issues.push({ code, message, ...(clip ? { clipId: clip.id } : {}), ...(track ? { trackId: track.id } : {}) });
  for (const field of ['effects', 'overlays', 'templates']) {
    if (Array.isArray(project[field]) && project[field].length > 0) add(`unsupported-${field}`, `The shared renderer does not support project ${field} yet. Remove or bake them into source media before exporting.`);
  }
  const mediaById = new Map(project.media.map((media) => [media.id, media]));
  const visibleTracks = project.timeline.tracks.filter((track) => track.hidden !== true);
  for (const track of visibleTracks) {
    for (const clip of track.clips.filter((item) => item.disabled !== true)) {
      const label = `Clip "${clip.label || clip.id}"`;
      const media = clip.mediaId ? mediaById.get(clip.mediaId) : undefined;
      const visual = media && ['video', 'image'].includes(media.type);
      if (!['video', 'image', 'audio', 'text', 'caption'].includes(clip.type) || (media && !['video', 'image', 'audio', 'caption'].includes(media.type))) {
        add('unsupported-clip', `Simple MP4 renderer only supports video, image, audio, and text clips right now: ${clip.label || clip.id}.`, clip, track);
      }
      if (clip.transitionIn || clip.transitionOut) add('unsupported-transition', `${label} uses transitions, which the shared renderer does not support yet.`, clip, track);
      if (clip.effects !== undefined && (!Array.isArray(clip.effects) || clip.effects.length > 0)) add('unsupported-effects', `${label} uses effects, which the shared renderer does not support yet. Color adjustments remain supported.`, clip, track);
      const transform = clip.transform || {};
      if (clip.transform !== undefined && (!clip.transform || typeof clip.transform !== 'object' || Array.isArray(clip.transform) || ['x', 'y', 'scale', 'rotateDeg'].some((key) => transform[key] !== undefined && !Number.isFinite(transform[key])) || (transform.scale !== undefined && (transform.scale < 0.05 || transform.scale > 5)))) add('invalid-transform', `${label} has an invalid transform. Use finite position/rotation and scale between 0.05 and 5.`, clip, track);
      if (clip.opacity !== undefined && (!Number.isFinite(clip.opacity) || clip.opacity < 0 || clip.opacity > 1)) add('invalid-opacity', `${label} opacity must be between 0 and 1.`, clip, track);
      if (clip.crop !== undefined) {
        const crop = clip.crop;
        if (!crop || typeof crop !== 'object' || ['x', 'y', 'width', 'height'].some((key) => !Number.isFinite(crop[key])) || crop.x < 0 || crop.y < 0 || crop.width <= 0 || crop.height <= 0) add('invalid-crop', `${label} crop must have non-negative x/y and positive width/height.`, clip, track);
        else if ((positiveNumber(media?.width) && crop.x + crop.width > media.width) || (positiveNumber(media?.height) && crop.y + crop.height > media.height)) add('invalid-crop', `${label} crop extends outside the source media dimensions.`, clip, track);
      }
      if (['anchorX', 'anchorY'].some((key) => transform[key] !== undefined && transform[key] !== 0.5)) add('unsupported-anchor', `${label} uses a custom transform anchor; only centered anchors are supported.`, clip, track);
      const hasGeometry = clip.crop || (clip.opacity !== undefined && clip.opacity !== 1) || Object.entries({ x: 0, y: 0, scale: 1, rotateDeg: 0 }).some(([key, fallback]) => (transform[key] ?? fallback) !== fallback);
      if (hasGeometry && !visual) add('unsupported-composition', `${label} uses composition controls on ${clip.type}; transforms, crop, and opacity currently require video or image media.`, clip, track);
      if (clip.keyframes !== undefined) {
        if (!Array.isArray(clip.keyframes)) add('unsupported-keyframes', `${label} keyframes must be an array.`, clip, track);
        else {
          const times = new Set();
          for (const frame of clip.keyframes) {
            if (!visual || !frame || !['x', 'y'].includes(frame.property) || !Number.isFinite(frame.value) || !Number.isFinite(frame.timeMs) || frame.timeMs < 0 || frame.timeMs > clip.durationMs || (frame.easing !== undefined && frame.easing !== 'linear')) {
              add('unsupported-keyframes', `${label} supports only finite x/y position keyframes within the clip duration with linear easing on video or image media.`, clip, track);
              break;
            }
            const key = `${frame.property}:${frame.timeMs}`;
            if (times.has(key)) {
              add('unsupported-keyframes', `${label} has multiple ${frame.property} keyframes at ${frame.timeMs} ms. Use one value per property and time.`, clip, track);
              break;
            }
            times.add(key);
          }
        }
      }
      if (media && ['video', 'audio'].includes(media.type)) {
        try { assertSourceCanCoverSpeed(clip, media); }
        catch (error) { add('insufficient-source', error.message, clip, track); }
      }
    }
  }
  try { assertDrawtextCaptionCueLimit(captionCuesForRender(project, visibleTracks)); }
  catch (error) { add('caption-capacity', error.message); }
  return { ok: issues.length === 0, issues };
}

export function renderSimpleMp4(project, outputPath, renderSettings, options = {}) {
    const capabilities = validateRenderCapabilities(project);
    if (!capabilities.ok) throw new Error(capabilities.issues.map((issue) => issue.message).join(' '));
    const width = renderSettings?.width ?? (typeof project.settings.width === 'number' ? project.settings.width : 1080);
    const height = renderSettings?.height ?? (typeof project.settings.height === 'number' ? project.settings.height : 1920);
    const fps = renderSettings?.fps ?? (typeof project.settings.fps === 'number' ? project.settings.fps : 30);
    const mediaById = new Map(project.media.map((media) => [media.id, media]));
    const visibleTracks = project.timeline.tracks.filter((track) => track.hidden !== true);
    const audibleTrackIds = new Set(visibleTracks.filter((track) => track.muted !== true).map((track) => track.id));
    const clips = visibleTracks
        .flatMap((track, trackIndex) => track.clips.map((clip) => ({ clip, trackId: track.id, trackIndex })))
        .filter((item) => item.clip.disabled !== true)
        .sort((a, b) => a.trackIndex - b.trackIndex || a.clip.startMs - b.clip.startMs);
    const activeDurationMs = clips.reduce((end, { clip }) => Math.max(end, clip.startMs + clip.durationMs), 0);
    const durationMs = activeDurationMs > 0 ? activeDurationMs : project.timeline.durationMs || 3000;
    const durationSeconds = Math.max(1 / fps, durationMs / 1000);
    const mediaClips = clips
        .map(({ clip, trackId }) => ({ clip, trackId, media: clip.mediaId ? mediaById.get(clip.mediaId) : undefined }))
        .filter((item) => Boolean(item.media));
    const unsupportedClips = mediaClips.filter(({ media }) => !['video', 'image', 'audio', 'caption'].includes(media.type));
    const inputSourceClips = mediaClips.filter(({ media }) => ['video', 'image', 'audio'].includes(media.type));
    if (unsupportedClips.length > 0) {
        const labels = unsupportedClips.slice(0, 3).map(({ clip }) => clip.label ?? clip.id).join(', ');
        throw new Error(`Simple MP4 renderer only supports video, image, audio, and text clips right now: ${labels}.`);
    }
    const args = ['-y', '-f', 'lavfi', '-i', `color=c=#111111:s=${width}x${height}:r=${fps}:d=${durationSeconds}`];
    const inputClips = [];
    const textFileDir = join(tmpdir(), `runneros-video-text-${randomUUID()}`);
    let textFileIndex = 0;
    const drawTextFileOption = (text) => {
        mkdirSync(textFileDir, { recursive: true });
        const textPath = join(textFileDir, `text-${textFileIndex}.txt`);
        textFileIndex += 1;
        writeFileSync(textPath, text, 'utf-8');
        return `textfile=${textPath}`;
    };
    for (const { clip, trackId, media } of inputSourceClips) {
        if (!existsSync(media.path))
            throw new Error(`Media file not found for clip "${clip.label ?? clip.id}": ${media.path}`);
        assertSourceCanCoverSpeed(clip, media);
        const sourceDuration = ffmpegNumber(media.type === 'image' ? seconds(clip.durationMs, 1000) : clipSourceDurationSeconds(clip));
        const sourceIn = seconds(typeof clip.sourceInMs === 'number' ? clip.sourceInMs : 0);
        if (media.type === 'image') {
            args.push('-loop', '1', '-t', sourceDuration, '-i', media.path);
        }
        else {
            if (sourceIn > 0)
                args.push('-ss', ffmpegNumber(sourceIn));
            args.push('-t', sourceDuration, '-i', media.path);
        }
        inputClips.push({ clip, trackId, media, inputIndex: inputClips.length + 1 });
    }
    const filters = [`[0:v]format=rgba[base0]`];
    let currentVideo = '[base0]';
    let overlayIndex = 0;
    for (const { clip, media, inputIndex } of inputClips.filter((item) => item.media.type === 'video' || item.media.type === 'image')) {
        const start = ffmpegNumber(seconds(clip.startMs));
        const end = ffmpegNumber(seconds(clip.startMs + clip.durationMs));
        const prepared = `v${overlayIndex}`;
        const next = `base${overlayIndex + 1}`;
        const adjusted = `adj${overlayIndex}`;
        const composed = `cmp${overlayIndex}`;
        const overlayPosition = visualOverlayPosition(clip, clipTransform(clip));
        const setpts = media.type === 'video'
            ? `setpts=(PTS-STARTPTS)/${ffmpegNumber(clipSpeed(clip))}+${start}/TB`
            : `setpts=PTS-STARTPTS+${start}/TB`;
        filters.push(visualCompositionFilter(`[${inputIndex}:v]`, `[${adjusted}]`, clip, media, { width, height }));
        filters.push(adjustmentFilter(`[${adjusted}]`, `[${prepared}]`, clip.adjustments));
        filters.push(`[${prepared}]${setpts}[${composed}]`);
        filters.push(`${currentVideo}[${composed}]overlay=x='${overlayPosition.x}':y='${overlayPosition.y}':enable='between(t,${start},${end})'[${next}]`);
        currentVideo = `[${next}]`;
        overlayIndex += 1;
    }
    const textClips = visibleTracks
        .flatMap((track) => track.clips)
        .filter((clip) => clip.disabled !== true)
        .filter((clip) => clip.type !== 'caption')
        .filter((clip) => clip.type === 'text' || clip.text || !clip.mediaId);
    for (const [index, clip] of textClips.entries()) {
        const start = seconds(clip.startMs);
        const end = Math.max(start + 0.2, start + seconds(clip.durationMs, 3000));
        const y = Math.round(height * 0.42) + (index % 3) * 86;
        const next = `text${index}`;
        filters.push(`${currentVideo}drawtext=${drawTextFileOption(textForClip(clip, project.title))}:expansion=none:fontcolor=white:fontsize=${Math.max(28, Math.round(width / 24))}:x=(w-text_w)/2:y=${y}:enable='between(t,${ffmpegNumber(start)},${ffmpegNumber(end)})'[${next}]`);
        currentVideo = `[${next}]`;
    }
    const captionCues = captionCuesForRender(project, visibleTracks);
    assertDrawtextCaptionCueLimit(captionCues);
    for (const [index, cue] of captionCues.entries()) {
        const start = seconds(cue.startMs);
        const end = Math.max(start + 0.2, start + seconds(cue.durationMs, 1000));
        const next = `caption${index}`;
        filters.push(`${currentVideo}drawtext=${drawTextFileOption(cue.text)}:expansion=none:fontcolor=white:fontsize=${Math.max(24, Math.round(width / 30))}:x=(w-text_w)/2:y=h-text_h-${Math.max(48, Math.round(height * 0.09))}:box=1:boxcolor=black@0.55:boxborderw=${Math.max(10, Math.round(width / 90))}:enable='between(t,${ffmpegNumber(start)},${ffmpegNumber(end)})'[${next}]`);
        currentVideo = `[${next}]`;
    }
    if (textClips.length === 0 && inputClips.length === 0 && captionCues.length === 0) {
        filters.push(`${currentVideo}drawtext=${drawTextFileOption(project.title)}:expansion=none:fontcolor=white:fontsize=${Math.max(28, Math.round(width / 22))}:x=(w-text_w)/2:y=(h-text_h)/2[title0]`);
        currentVideo = '[title0]';
    }
    const audioLabels = [];
    inputClips.filter((item) => audibleTrackIds.has(item.trackId) && (item.media.type === 'audio' || (item.media.type === 'video' && hasAudioStream(item.media.path)))).forEach(({ clip, inputIndex }, index) => {
        const delayMs = Math.max(0, Math.round(clip.startMs ?? 0));
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
        if (fadeIn > 0)
            audioFilters.push(`afade=t=in:st=0:d=${ffmpegNumber(fadeIn)}`);
        if (fadeOut > 0)
            audioFilters.push(`afade=t=out:st=${ffmpegNumber(Math.max(0, clipDurationSeconds - fadeOut))}:d=${ffmpegNumber(fadeOut)}`);
        // Rebuild sample timestamps after delay: some FFmpeg builds emit
        // undefined PTS for the inserted silence after atempo.
        audioFilters.push(`adelay=${delayMs}:all=1`, 'asetpts=N/SR/TB');
        const label = `a${index}`;
        filters.push(`[${inputIndex}:a]${audioFilters.join(',')}[${label}]`);
        audioLabels.push(`[${label}]`);
    });
    if (audioLabels.length > 0) {
        filters.push(`${audioLabels.join('')}amix=inputs=${audioLabels.length}:duration=longest:dropout_transition=0,atrim=duration=${durationSeconds}[aout]`);
    }
    filters.push(`${currentVideo}format=yuv420p[vout]`);
    args.push('-filter_complex', filters.join(';'), '-map', '[vout]');
    if (audioLabels.length > 0)
        args.push('-map', '[aout]');
    args.push('-t', String(durationSeconds), '-r', String(fps), '-pix_fmt', 'yuv420p');
    if (['.mp4', '.mov', '.m4v'].includes(extname(outputPath).toLowerCase())) {
        args.push('-movflags', '+faststart');
    }
    args.push(outputPath);
    const result = spawnSync('ffmpeg', args, { encoding: 'utf-8', timeout: options.timeoutMs ?? SIMPLE_RENDER_TIMEOUT_MS });
    rmSync(textFileDir, { recursive: true, force: true });
    if (result.error) {
        throw new Error(result.error.message || 'ffmpeg failed to render video.');
    }
    if (result.status !== 0) {
        throw new Error(result.stderr || result.stdout || 'ffmpeg failed to render video.');
    }
}
