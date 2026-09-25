import { buildColorLut, serializeCubeLut, validateColorAdjustments } from './color-pipeline.mjs';
import {
    seconds, clamp, clipSpeed, clipVolume, clipFadeSeconds, clipTransform, clipOpacity, clipCrop,
    visualSourceSize, fittedVisualSize, assertSourceCanCoverSpeed,
    validateRenderCapabilities, buildScenePlan, positionKeyframes,
} from './scene-plan.mjs';
export { positiveNumber, clamp, clipSpeed, finiteNumber, clipTransform, validateRenderCapabilities } from './scene-plan.mjs';
// Canonical FFmpeg timeline renderer shared by the Node CLI and agent tools.
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const SIMPLE_RENDER_TIMEOUT_MS = 180_000;

export function ffmpegNumber(value) {
    return value.toFixed(3).replace(/\.?0+$/, '');
}



function ffmpegExprNumber(value) {
    const rounded = Math.round(value * 1000) / 1000;
    return Object.is(rounded, -0) ? '0' : ffmpegNumber(rounded);
}
function keyframeExpression(clip, property, fallback) {
    const uniqueFrames = positionKeyframes(clip, property, fallback);
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
function visualCompositionFilter(inputLabel, outputLabel, clip, media, canvas, colorParts = []) {
    const transform = clipTransform(clip);
    const crop = clipCrop(clip, media);
    const source = visualSourceSize(media, crop, canvas.width, canvas.height);
    const fitted = fittedVisualSize(source, canvas.width, canvas.height, transform.scale);
    const parts = [];
    if (crop)
        parts.push(`crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}`);
    parts.push(`scale=${fitted.width}:${fitted.height}:force_original_aspect_ratio=decrease`);
    parts.push('setsar=1', 'format=rgba', ...colorParts);
    if (transform.rotateDeg !== 0) {
        const angle = (transform.rotateDeg * Math.PI) / 180;
        parts.push(`rotate=${ffmpegExprNumber(angle)}:ow=rotw(${ffmpegExprNumber(angle)}):oh=roth(${ffmpegExprNumber(angle)}):fillcolor=black@0`);
    }
    const opacity = clipOpacity(clip);
    if (opacity < 1)
        parts.push(`colorchannelmixer=aa=${ffmpegExprNumber(opacity)}`);
    return `${inputLabel}${parts.length ? parts.join(',') : 'null'}${outputLabel}`;
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

function hasAdjustments(adjustments) {
    return Boolean(adjustments && Object.keys(adjustments).some((key) => key !== 'preset'));
}
function adjustmentParts(adjustments, writeLut) {
    validateColorAdjustments(adjustments);
    const lut = buildColorLut(adjustments);
    if (!hasAdjustments(adjustments)) return [];
    const brightness = clamp((adjustments?.exposure ?? 0) + ((adjustments?.highlights ?? 0) * 0.08) + ((adjustments?.shadows ?? 0) * 0.06), -1, 1);
    const contrast = clamp(adjustments?.contrast ?? 1, 0, 3);
    const saturation = clamp((adjustments?.saturation ?? 1) + ((adjustments?.temperature ?? 0) * 0.04) - Math.abs(adjustments?.tint ?? 0) * 0.02, 0, 3);
    const gamma = clamp(1 - ((adjustments?.shadows ?? 0) * 0.12) + ((adjustments?.highlights ?? 0) * 0.08), 0.1, 10);
    const parts = adjustments?.pipeline === 'rgb-v1' ? [] : [`eq=brightness=${ffmpegNumber(brightness)}:contrast=${ffmpegNumber(contrast)}:saturation=${ffmpegNumber(saturation)}:gamma=${ffmpegNumber(gamma)}`];
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
    if (lut) parts.push(`lut3d=file='${writeLut(lut)}':interp=trilinear`);
    return parts;
}

function adjustmentFilter(inputLabel, outputLabel, adjustments, writeLut) {
    const parts = adjustmentParts(adjustments, writeLut);
    return `${inputLabel}${parts.length ? parts.join(',') : 'null'}${outputLabel}`;
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
    const scene = buildScenePlan(project, width, height);
    const durationMs = scene.durationMs;
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
    const writeLut = (lut) => {
        mkdirSync(textFileDir, { recursive: true });
        const lutPath = join(textFileDir, `color-${textFileIndex++}.cube`);
        writeFileSync(lutPath, serializeCubeLut(lut), 'utf-8');
        return lutPath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "'\\''");
    };
    try {
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
        if (clip.adjustments?.pipeline === 'rgb-v1' || clip.adjustments?.lut) {
            // Match preview: crop/resize, color, then rotation and opacity.
            filters.push(visualCompositionFilter(`[${inputIndex}:v]`, `[${prepared}]`, clip, media, { width, height }, adjustmentParts(clip.adjustments, writeLut)));
        } else {
            // Preserve established ordering for existing unversioned projects.
            filters.push(visualCompositionFilter(`[${inputIndex}:v]`, `[${adjusted}]`, clip, media, { width, height }));
            filters.push(adjustmentFilter(`[${adjusted}]`, `[${prepared}]`, clip.adjustments, writeLut));
        }
        filters.push(`[${prepared}]${setpts}[${composed}]`);
        filters.push(`${currentVideo}[${composed}]overlay=x='${overlayPosition.x}':y='${overlayPosition.y}':enable='between(t,${start},${end})'[${next}]`);
        currentVideo = `[${next}]`;
        overlayIndex += 1;
    }
    for (const [index, title] of scene.titles.entries()) {
        const next = `text${index}`;
        const y = title.centered ? '(h-text_h)/2' : title.y;
        const enable = title.centered ? '' : `:enable='between(t,${ffmpegNumber(title.startMs / 1000)},${ffmpegNumber(title.endMs / 1000)})'`;
        filters.push(`${currentVideo}drawtext=${drawTextFileOption(title.text)}:expansion=none:fontcolor=white:fontsize=${title.fontSize}:x=(w-text_w)/2:y=${y}${enable}[${next}]`);
        currentVideo = `[${next}]`;
    }
    for (const [index, caption] of scene.captions.entries()) {
        const next = `caption${index}`;
        filters.push(`${currentVideo}drawtext=${drawTextFileOption(caption.text)}:expansion=none:fontcolor=white:fontsize=${caption.fontSize}:x=(w-text_w)/2:y=h-text_h-${caption.bottom}:box=1:boxcolor=black@0.55:boxborderw=${caption.boxBorder}:enable='between(t,${ffmpegNumber(caption.startMs / 1000)},${ffmpegNumber(caption.endMs / 1000)})'[${next}]`);
        currentVideo = `[${next}]`;
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
    if (result.error) {
        throw new Error(result.error.message || 'ffmpeg failed to render video.');
    }
    if (result.status !== 0) {
        throw new Error(result.stderr || result.stdout || 'ffmpeg failed to render video.');
    }
    } finally { rmSync(textFileDir, { recursive: true, force: true }); }
}
