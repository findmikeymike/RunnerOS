import { validateColorAdjustments } from './color-pipeline.mjs';
// Browser-safe timeline semantics shared with the FFmpeg renderer. No platform imports.
const MAX_DRAWTEXT_CAPTION_CUES = 200;

export function positiveNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

export function seconds(ms, fallbackMs = 0) {
    return Math.max(0, (ms ?? fallbackMs) / 1000);
}

export function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

export function clipSpeed(clip) {
    return clamp(typeof clip.speed === 'number' && Number.isFinite(clip.speed) ? clip.speed : 1, 0.25, 4);
}

export function finiteNumber(value, fallback) {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function clipVolume(clip) {
    return clamp(finiteNumber(clip.volume, 1), 0, 4);
}

export function clipFadeSeconds(clip, key, clipDurationSeconds = seconds(clip.durationMs, 1000)) {
    return clamp(finiteNumber(clip[key], 0) / 1000, 0, Math.max(0, clipDurationSeconds / 2));
}

/** amix normalize=1 counts delayed silence and zero-volume streams until EOF. */
export function audioGainAtTime(plan, audio, timeMs, knownAudibleClipIds) {
    const known = (entry) => !knownAudibleClipIds || knownAudibleClipIds.has(entry.clip.id);
    if (!Number.isFinite(timeMs) || timeMs < audio.startMs || timeMs >= audio.endMs || !known(audio)) return 0;
    const denominator = plan.audio.filter(entry => timeMs < entry.endMs && known(entry)).length;
    if (!denominator) return 0;
    const duration = Math.max(0, audio.endMs - audio.startMs) / 1000;
    const elapsed = (timeMs - audio.startMs) / 1000;
    const fadeIn = clipFadeSeconds(audio.clip, 'fadeInMs', duration);
    const fadeOut = clipFadeSeconds(audio.clip, 'fadeOutMs', duration);
    const envelope = Math.min(fadeIn > 0 ? clamp(elapsed / fadeIn, 0, 1) : 1,
        fadeOut > 0 ? clamp((duration - elapsed) / fadeOut, 0, 1) : 1);
    return clipVolume(audio.clip) * envelope / denominator;
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

export function clipOpacity(clip) {
    return clamp(finiteNumber(clip.opacity, 1), 0, 1);
}

export function clipCrop(clip, media) {
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

export function visualSourceSize(media, crop, canvasWidth, canvasHeight) {
    return {
        width: crop?.width ?? positiveNumber(media.width) ?? canvasWidth,
        height: crop?.height ?? positiveNumber(media.height) ?? canvasHeight,
    };
}

export function fittedVisualSize(source, canvasWidth, canvasHeight, scale) {
    const fit = Math.min(canvasWidth / Math.max(1, source.width), canvasHeight / Math.max(1, source.height));
    return {
        width: Math.max(1, Math.round(source.width * fit * scale)),
        height: Math.max(1, Math.round(source.height * fit * scale)),
    };
}

export function sourceAvailableMs(clip, media) {
    const sourceInMs = typeof clip.sourceInMs === 'number' && Number.isFinite(clip.sourceInMs) ? clip.sourceInMs : 0;
    const sourceOutMs = typeof clip.sourceOutMs === 'number' && Number.isFinite(clip.sourceOutMs)
        ? clip.sourceOutMs
        : typeof media.durationMs === 'number' && Number.isFinite(media.durationMs)
            ? media.durationMs
            : undefined;
    return sourceOutMs !== undefined && sourceOutMs > sourceInMs ? sourceOutMs - sourceInMs : undefined;
}

export function assertSourceCanCoverSpeed(clip, media) {
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

export function textForClip(clip, fallback) {
    const textPayload = clip.text;
    if (typeof textPayload === 'object' && textPayload && 'text' in textPayload && typeof textPayload.text === 'string') {
        return textPayload.text;
    }
    return typeof clip.label === 'string' ? clip.label : fallback;
}

export function captionCuesForClip(clip, cueById) {
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

export function captionCuesForRender(project, visibleTracks) {
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

export function assertDrawtextCaptionCueLimit(cues) {
    if (cues.length <= MAX_DRAWTEXT_CAPTION_CUES)
        return;
    throw new Error(`Simple MP4 renderer can burn at most ${MAX_DRAWTEXT_CAPTION_CUES} caption cues right now; got ${cues.length}. Split the caption track or use a subtitle renderer before exporting.`);
}

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
      try { validateColorAdjustments(clip.adjustments); } catch (error) { add('invalid-color', `${label}: ${error.message}`, clip, track); }
      const visual = media && ['video', 'image'].includes(media.type);
      const colorNeutral = { exposure:0, contrast:1, saturation:1, highlights:0, shadows:0, temperature:0, tint:0, grain:0, sharpen:0, vignette:0 };
      if (!visual && clip.adjustments && (clip.adjustments.lut || Object.entries(colorNeutral).some(([key, neutral]) => clip.adjustments[key] !== undefined && clip.adjustments[key] !== neutral))) {
        add('unsupported-color', `${label} uses color adjustments without video or image media.`, clip, track);
      }
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

/** Position keyframes are relative to the clip and interpolate from its base transform. */
export function positionKeyframes(clip, property, fallback) {
    const frames = Array.isArray(clip.keyframes) ? clip.keyframes
        .filter((frame) => frame && typeof frame === 'object' && frame.property === property && Number.isFinite(frame.value))
        .map((frame) => ({ timeMs: clamp(Math.round(finiteNumber(frame.timeMs, 0)), 0, Math.max(1, clip.durationMs)), value: frame.value }))
        .sort((a, b) => a.timeMs - b.timeMs) : [];
    return [...(frames.some((frame) => frame.timeMs === 0) ? [] : [{ timeMs: 0, value: fallback }]), ...frames]
        .filter((frame, index, items) => index === items.findIndex((item) => item.timeMs === frame.timeMs))
        .sort((a, b) => a.timeMs - b.timeMs);
}

function positionAtTime(clip, property, fallback, timeMs) {
    const frames = positionKeyframes(clip, property, fallback);
    const localMs = Math.max(0, timeMs - clip.startMs);
    for (let index = 1; index < frames.length; index += 1) {
        const from = frames[index - 1];
        const to = frames[index];
        if (localMs < to.timeMs) return from.value + (to.value - from.value) * ((localMs - from.timeMs) / Math.max(1, to.timeMs - from.timeMs));
    }
    return frames.at(-1).value;
}

/** x/y are center coordinates; width/height are the fitted, unrotated destination size. */
export function visualGeometry(clip, media, width, height, timeMs) {
    const transform = clipTransform(clip);
    const crop = clipCrop(clip, media);
    const fitted = fittedVisualSize(visualSourceSize(media, crop, width, height), width, height, transform.scale);
    return {
        crop, ...fitted,
        x: width / 2 + positionAtTime(clip, 'x', transform.x, timeMs),
        y: height / 2 + positionAtTime(clip, 'y', transform.y, timeMs),
        rotateDeg: transform.rotateDeg,
        opacity: clipOpacity(clip),
    };
}

export function buildScenePlan(project, width, height) {
    width ??= typeof project.settings.width === 'number' ? project.settings.width : 1080;
    height ??= typeof project.settings.height === 'number' ? project.settings.height : 1920;
    const fps = typeof project.settings.fps === 'number' ? project.settings.fps : 30;
    const visibleTracks = project.timeline.tracks.filter((track) => track.hidden !== true);
    const clips = visibleTracks.flatMap((track, trackIndex) => track.clips.map((clip) => ({ clip, trackIndex, trackId: track.id, muted: track.muted })))
        .filter(({ clip }) => clip.disabled !== true)
        .sort((a, b) => a.trackIndex - b.trackIndex || a.clip.startMs - b.clip.startMs);
    const activeDuration = clips.reduce((end, { clip }) => Math.max(end, clip.startMs + clip.durationMs), 0);
    const durationMs = activeDuration > 0 ? activeDuration : project.timeline.durationMs || 3000;
    const mediaById = new Map(project.media.map((media) => [media.id, media]));
    const mediaClips = clips.map(({ clip, trackId, muted }) => ({ clip, trackId, muted, media: mediaById.get(clip.mediaId) })).filter(({ media }) => Boolean(media));
    const audio = mediaClips.filter(({ media, muted }) => !muted && (media.type === 'audio' || media.type === 'video'))
        .map(({ clip, media, trackId }) => {
            const startMs = Math.max(0, Math.round(clip.startMs ?? 0));
            return { clip, media, trackId, startMs, endMs: startMs + Math.max(0, finiteNumber(clip.durationMs, 1000)) };
        });
    const visuals = mediaClips.filter(({ media }) => media.type === 'video' || media.type === 'image');
    const textClips = visibleTracks.flatMap((track) => track.clips)
        .filter((clip) => clip.disabled !== true && clip.type !== 'caption' && (clip.type === 'text' || clip.text || !clip.mediaId));
    const titles = textClips.map((clip, index) => ({
        text: textForClip(clip, project.title),
        startMs: seconds(clip.startMs) * 1000,
        endMs: (seconds(clip.startMs) + Math.max(0.2, seconds(clip.durationMs, 3000))) * 1000,
        fontSize: Math.max(28, Math.round(width / 24)),
        y: Math.round(height * 0.42) + (index % 3) * 86,
    }));
    const captions = captionCuesForRender(project, visibleTracks).map((cue) => ({
        text: cue.text,
        startMs: seconds(cue.startMs) * 1000,
        endMs: (seconds(cue.startMs) + Math.max(0.2, seconds(cue.durationMs, 1000))) * 1000,
        fontSize: Math.max(24, Math.round(width / 30)),
        bottom: Math.max(48, Math.round(height * 0.09)),
        boxBorder: Math.max(10, Math.round(width / 90)),
    }));
    if (!titles.length && !captions.length && !mediaClips.some(({ media }) => ['video', 'image', 'audio'].includes(media.type))) {
        titles.push({ text: project.title, startMs: 0, endMs: durationMs, fontSize: Math.max(28, Math.round(width / 22)), centered: true });
    }
    const issues = [...validateRenderCapabilities(project).issues];
    const neutral = { exposure: 0, highlights: 0, shadows: 0, contrast: 1, saturation: 1, temperature: 0, tint: 0, grain: 0, sharpen: 0, vignette: 0 };
    for (const { clip } of visuals) {
        const adjustments = clip.adjustments;
        const usesColorPipeline = adjustments?.pipeline === 'rgb-v1';
        if (adjustments?.lut || usesColorPipeline) validateColorAdjustments(adjustments);
        const unsupported = adjustments && Object.entries(adjustments).some(([key, value]) => {
            if (key === 'preset' || key === 'lut' || key === 'pipeline') return false;
            if (usesColorPipeline && ['exposure','contrast','saturation','highlights','shadows','temperature','tint'].includes(key)) return false;
            return value !== neutral[key];
        });
        if (unsupported) {
            issues.push({ code: 'preview-unsupported-adjustments', clipId: clip.id, message: `Clip "${clip.label || clip.id}" has color or look adjustments. Render to review these accurately.` });
        }
    }
    return { width, height, fps, durationMs, background: '#111111', audio, visuals, titles, captions, issues };
}

/** Inclusive layer boundaries match FFmpeg's between(t,start,end) enable expression. */
export function sceneAtTime(plan, timeMs) {
    const active = (layer) => timeMs >= layer.startMs && timeMs <= layer.endMs;
    return {
        ...plan, timeMs,
        audio: plan.audio.filter(entry => timeMs >= entry.startMs && timeMs < entry.endMs)
            .map(entry => ({ ...entry, sourceTimeMs: Math.max(0, finiteNumber(entry.clip.sourceInMs, 0)) + Math.max(0, timeMs - entry.startMs) * clipSpeed(entry.clip) })),
        visuals: plan.visuals.filter(({ clip }) => active({ startMs: Math.max(0, clip.startMs), endMs: Math.max(0, clip.startMs + clip.durationMs) }))
            .map(({ clip, media }) => ({ clip, media,
                sourceTimeMs: media.type === 'image' ? 0 : Math.max(0, finiteNumber(clip.sourceInMs, 0)) + Math.max(0, timeMs - clip.startMs) * clipSpeed(clip),
                geometry: visualGeometry(clip, media, plan.width, plan.height, timeMs),
            })),
        titles: plan.titles.filter(active),
        captions: plan.captions.filter(active),
    };
}
