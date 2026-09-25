/** Node-compatible renderer contract. The .mjs is also bundled into agent hosts. */
export interface RenderClip {
  id: string;
  type: string;
  startMs: number;
  durationMs: number;
  mediaId?: string;
  label?: unknown;
  transform?: unknown;
  crop?: unknown;
  opacity?: unknown;
  keyframes?: unknown;
  speed?: unknown;
  disabled?: boolean;
}
export interface RenderProject {
  title: string;
  settings: object;
  media: Array<{ id: string; type: string; path: string }>;
  timeline: { durationMs: number; tracks: Array<{ id: string; hidden?: boolean; muted?: boolean; clips: RenderClip[] }> };
  captions: Array<{ cues: Array<{ id: string; startMs: number; durationMs: number; text: string }> }>;
  effects?: unknown[];
  overlays?: unknown[];
  templates?: unknown[];
}
export interface RenderCapabilityIssue {
  code: string;
  message: string;
  clipId?: string;
  trackId?: string;
}
export function validateRenderCapabilities(project: RenderProject): { ok: boolean; issues: RenderCapabilityIssue[] };
export function renderSimpleMp4(project: RenderProject, outputPath: string, renderSettings?: { width?: number; height?: number; fps?: number }, options?: { timeoutMs?: number }): void;
export function positiveNumber(value: unknown): number | undefined;
export function ffmpegNumber(value: number): string;
export function clamp(value: number, min: number, max: number): number;
export function clipSpeed(clip: { speed?: unknown }): number;
export function finiteNumber(value: unknown, fallback: number): number;
export function clipTransform(clip: Record<string, unknown>): { x: number; y: number; scale: number; rotateDeg: number };
