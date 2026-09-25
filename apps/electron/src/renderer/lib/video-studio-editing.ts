import type { VideoClip } from '@craft-agent/shared/video'

export function clipPlaybackSpeed(clip: Pick<VideoClip, 'speed'>): number {
  return typeof clip.speed === 'number' && Number.isFinite(clip.speed) && clip.speed > 0 ? clip.speed : 1
}

export function previewClipSourceTime(clip: VideoClip, timelineMs: number): number {
  return Math.max(0, ((clip.sourceInMs ?? 0) + Math.max(0, timelineMs - clip.startMs) * clipPlaybackSpeed(clip)) / 1000)
}

export function timelineMsFromPreviewVideoTime(clip: VideoClip, currentTimeSeconds: number): number {
  return clip.startMs + Math.max(0, currentTimeSeconds * 1000 - (clip.sourceInMs ?? 0)) / clipPlaybackSpeed(clip)
}

export function splitVideoClip(clip: VideoClip, splitAtMs: number, secondId: string): [VideoClip, VideoClip] {
  const firstDuration = splitAtMs - clip.startMs
  if (firstDuration <= 0 || firstDuration >= clip.durationMs) throw new Error('Split must be inside the clip.')
  const sourceBoundary = (clip.sourceInMs ?? 0) + firstDuration * clipPlaybackSpeed(clip)
  return [
    { ...clip, durationMs: firstDuration, sourceOutMs: sourceBoundary },
    { ...clip, id: secondId, startMs: splitAtMs, durationMs: clip.durationMs - firstDuration, sourceInMs: sourceBoundary, label: clip.label ? `${clip.label} split` : undefined },
  ]
}

// Comparing parsed content avoids false conflicts caused only by JSON formatting.
export function videoProjectFingerprint(text: string): string {
  try { return JSON.stringify(JSON.parse(text)) } catch { return text }
}

export function isExternalVideoProjectChange(text: string, saved: string | null, pending: string | null): boolean {
  const fingerprint = videoProjectFingerprint(text)
  return saved !== null && fingerprint !== saved && fingerprint !== pending
}

export function nextPreviewClip<T extends { clip: Pick<VideoClip, 'startMs'> }>(clips: T[], afterMs: number): T | null {
  return clips.find(({ clip }) => clip.startMs >= Math.max(0, Math.round(afterMs))) ?? null
}

export async function requireVideoProjectWrite(write: (() => Promise<boolean>) | undefined): Promise<void> {
  if (!write) throw new Error('Video Studio save bridge is unavailable.')
  if (await write() !== true) throw new Error('Video project was not saved. Your edits are still in the editor.')
}

export function sourceInAfterLeadingTrim(clip: Pick<VideoClip, 'speed'>, initialSourceInMs: number, timelineDeltaMs: number): number {
  return Math.max(0, Math.round(initialSourceInMs + timelineDeltaMs * clipPlaybackSpeed(clip)))
}

export type VideoPreviewMode = 'source' | 'rendered'

export function previewMediaTime(mode: VideoPreviewMode, clip: VideoClip | null, timelineMs: number): number {
  return mode === 'source' && clip ? previewClipSourceTime(clip, timelineMs) : Math.max(0, timelineMs / 1000)
}

export function previewTimelineTime(mode: VideoPreviewMode, clip: VideoClip | null, seconds: number): number {
  return mode === 'source' && clip ? timelineMsFromPreviewVideoTime(clip, seconds) : Math.max(0, seconds * 1000)
}

export function previewPlaybackRate(mode: VideoPreviewMode, clip: VideoClip | null): number {
  return mode === 'source' && clip ? clipPlaybackSpeed(clip) : 1
}

// Export bookkeeping and save history do not change the rendered composition.
export function videoCompositionFingerprint(text: string): string {
  try {
    const { title, settings, media, timeline, captions, overlays, effects, templates } = JSON.parse(text)
    return JSON.stringify({ title, settings, media, timeline, captions, overlays, effects, templates })
  } catch { return text }
}

export function renderedPreviewFreshness(currentText: string, renderedFingerprint: string | null): 'current' | 'edited' | 'unknown' {
  return renderedFingerprint === null ? 'unknown' : videoCompositionFingerprint(currentText) === renderedFingerprint ? 'current' : 'edited'
}
