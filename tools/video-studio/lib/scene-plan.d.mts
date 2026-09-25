import type { RenderProject, RenderClip, RenderCapabilityIssue } from './render-engine.mjs';
export interface SceneMedia { id: string; type: string; path: string; width?: number; height?: number; durationMs?: number }
export interface SceneVisual { clip: RenderClip; media: SceneMedia }
export interface SceneTitle { text: string; startMs: number; endMs: number; fontSize: number; y?: number; centered?: boolean }
export interface SceneCaption { text: string; startMs: number; endMs: number; fontSize: number; bottom: number; boxBorder: number }
export interface SceneGeometry { crop: null | { x: number; y: number; width: number; height: number }; width: number; height: number; x: number; y: number; rotateDeg: number; opacity: number }
export interface ScenePlan { width: number; height: number; fps: number; durationMs: number; background: string; visuals: SceneVisual[]; titles: SceneTitle[]; captions: SceneCaption[]; issues: RenderCapabilityIssue[] }
export interface SceneFrame extends Omit<ScenePlan, 'visuals'> { timeMs: number; visuals: Array<SceneVisual & { sourceTimeMs: number; geometry: SceneGeometry }> }
export function buildScenePlan(project: RenderProject, width?: number, height?: number): ScenePlan;
export function sceneAtTime(plan: ScenePlan, timeMs: number): SceneFrame;
export function visualGeometry(clip: RenderClip, media: SceneMedia, width: number, height: number, timeMs: number): SceneGeometry;
export function validateRenderCapabilities(project: RenderProject): { ok: boolean; issues: RenderCapabilityIssue[] };
export function positionKeyframes(clip: RenderClip, property: string, fallback: number): Array<{ timeMs: number; value: number }>;
export function positiveNumber(value: unknown): number | undefined;
export function clamp(value: number, min: number, max: number): number;
export function clipSpeed(clip: RenderClip): number;
export function finiteNumber(value: unknown, fallback: number): number;
export function clipTransform(clip: RenderClip): {x: number; y: number; scale: number; rotateDeg: number};
