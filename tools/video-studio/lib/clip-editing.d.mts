export function sliceVideoClipMetadata<T>(clip: T, offsetMs: number, durationMs: number): T;
interface SourceBoundClip { type?: string; sourceInMs?: number; sourceOutMs?: number; speed?: number }
interface SourceBoundMedia { type?: string; durationMs?: number }
export function availableClipSourceMs(clip: SourceBoundClip, media?: SourceBoundMedia): number | undefined;
export function maximumClipDurationMs(clip: SourceBoundClip, media?: SourceBoundMedia): number;
export function boundedTrailingTrimDuration(clip: SourceBoundClip & { startMs: number; durationMs: number }, media: SourceBoundMedia | undefined, requestedMs: number, nextStartMs?: number, ripple?: boolean): number;
