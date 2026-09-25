import { sliceVideoClipMetadata, maximumClipDurationMs } from '../../../../tools/video-studio/lib/clip-editing.mjs';
import { parseCubeLut, validateColorAdjustments, validateColorProjectBudget } from '../../../../tools/video-studio/lib/color-pipeline.mjs';
import { assertSafeVideoExportPaths } from '../../../../tools/video-studio/lib/export-safety.mjs';
import { commitVideoProjectContent } from '../../../../tools/video-studio/lib/project-storage.mjs';
import { positiveNumber, ffmpegNumber, clamp, clipSpeed, finiteNumber, clipTransform, renderSimpleMp4 } from '../../../../tools/video-studio/lib/render-engine.mjs';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { errorResponse } from '../response.ts';

type MediaType = 'video' | 'audio' | 'image' | 'caption' | 'svg' | 'lottie' | 'html' | 'unknown';
type TrackType = 'video' | 'audio' | 'image' | 'text' | 'caption' | 'effect' | 'adjustment';
type ClipType = 'video' | 'audio' | 'image' | 'text' | 'caption' | 'shape' | 'lottie' | 'html';
type AspectRatio = '9:16' | '1:1' | '16:9' | '4:5' | 'custom';

const videoProjectLocks = new Map<string, Promise<void>>();
const INSPECTION_RENDER_TIMEOUT_MS = 60_000;
let undoSnapshotSequence = 0;

async function withVideoProjectLock<T>(projectPath: string, task: () => Promise<T> | T): Promise<T> {
  const key = resolve(projectPath);
  const previous = videoProjectLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolveCurrent) => {
    release = resolveCurrent;
  });
  const chained = previous.catch(() => undefined).then(() => current);
  videoProjectLocks.set(key, chained);
  await previous.catch(() => undefined);
  try {
    return await task();
  } finally {
    release();
    if (videoProjectLocks.get(key) === chained) videoProjectLocks.delete(key);
  }
}

interface VideoProjectCreateInput {
  projectPath?: string;
  projectDir?: string;
  title: string;
  aspectRatio?: AspectRatio;
  width?: number;
  height?: number;
  fps?: number;
  overwrite?: boolean;
}

interface VideoProjectUpdateInput {
  projectPath: string;
  title?: string;
  aspectRatio?: AspectRatio;
  width?: number;
  height?: number;
  fps?: number;
}

interface VideoMediaImportInput {
  projectPath: string;
  mediaPath: string;
  label?: string;
  mediaType?: MediaType;
}

interface VideoClipAddInput {
  projectPath: string;
  mediaId?: string;
  trackId?: string;
  type?: ClipType;
  startMs?: number;
  durationMs?: number;
  sourceInMs?: number;
  sourceOutMs?: number;
  volume?: number;
  speed?: number;
  fadeInMs?: number;
  fadeOutMs?: number;
  label?: string;
  text?: string;
}

interface VideoClipEditInput {
  projectPath: string;
  clipId?: string;
  action: 'move' | 'trim' | 'pack' | 'split' | 'delete' | 'duplicate' | 'settings';
  startMs?: number;
  durationMs?: number;
  sourceInMs?: number;
  sourceOutMs?: number;
  volume?: number;
  speed?: number;
  fadeInMs?: number;
  fadeOutMs?: number;
  atMs?: number;
  ripple?: boolean;
  snap?: boolean;
}

interface VideoClipAdjustInput {
  projectPath: string;
  clipId?: string;
  clipIds?: string[];
  lutCube?: string;
  lutName?: string;
  lutIntensity?: number;
  removeLut?: boolean;
  preset?: 'neutral' | 'clean' | 'cinematic' | 'warm' | 'punchy' | 'black-and-white';
  exposure?: number;
  contrast?: number;
  saturation?: number;
  highlights?: number;
  shadows?: number;
  temperature?: number;
  tint?: number;
  sharpen?: number;
  vignette?: number;
  grain?: number;
  reset?: boolean;
}

interface VideoClipTransformInput {
  projectPath: string;
  clipId: string;
  x?: number;
  y?: number;
  scale?: number;
  rotateDeg?: number;
  opacity?: number;
  cropX?: number;
  cropY?: number;
  cropWidth?: number;
  cropHeight?: number;
  layoutPreset?: 'center' | 'pip-top-right' | 'pip-bottom-right' | 'split-left' | 'split-right' | 'split-top' | 'split-bottom';
  keyframes?: Array<{ timeMs: number; property: 'x' | 'y'; value: number; easing?: 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' }>;
  resetTransform?: boolean;
  resetCrop?: boolean;
  resetKeyframes?: boolean;
}

interface VideoExportInput {
  projectPath: string;
  outputPath?: string;
  preset?: string;
  publishOutput?: boolean;
  showInCanvas?: boolean;
}

interface VideoProjectReadInput {
  projectPath: string;
  startFrame?: number;
  endFrame?: number;
}

interface VideoInspectTimelineInput {
  projectPath: string;
  startFrame?: number;
  endFrame?: number;
  maxFrames?: number;
}

interface VideoInspectMediaInput {
  projectPath: string;
  mediaId: string;
  overview?: boolean;
  maxFrames?: number;
  startSeconds?: number;
  endSeconds?: number;
}

interface VideoProjectSnapshotInput {
  projectPath: string;
  label?: string;
}

interface VideoProjectDiffInput {
  projectPath: string;
  snapshotPath?: string;
}

interface VideoProjectUndoInput {
  projectPath: string;
}

interface VideoProject {
  version: 1;
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  workspaceId: string;
  settings: Record<string, unknown>;
  media: Array<Record<string, unknown> & { id: string; type: MediaType; label: string; path: string }>;
  timeline: {
    durationMs: number;
    tracks: Array<{ id: string; type: TrackType; label: string; locked?: boolean; muted?: boolean; hidden?: boolean; clips: Array<Record<string, unknown> & { id: string; type: ClipType; startMs: number; durationMs: number; mediaId?: string; adjustments?: VideoClipAdjustments; volume?: number; speed?: number; fadeInMs?: number; fadeOutMs?: number }> }>;
    markers: unknown[];
    selection?: unknown;
  };
  captions: Array<{ id: string; label: string; cues: Array<{ id: string; startMs: number; durationMs: number; text: string }>; style?: Record<string, unknown> }>;
  overlays: unknown[];
  effects: unknown[];
  templates: unknown[];
  exports: Array<Record<string, unknown>>;
  versions: Array<Record<string, unknown>>;
  agentEvents: Array<Record<string, unknown>>;
}

interface ExportCleanupResult {
  removedPaths: string[];
  warnings: string[];
}

interface ParsedCaptionCue {
  id: string;
  startMs: number;
  durationMs: number;
  text: string;
}

interface VideoMediaProbeMetadata {
  durationMs?: number;
  width?: number;
  height?: number;
  fps?: number;
  sizeBytes?: number;
  codec?: string;
  hasAudio?: boolean;
  hasVideo?: boolean;
}

interface VideoMediaDerivativePaths {
  thumbnailPath?: string;
  waveformPath?: string;
}

interface VideoExportRenderSettings {
  slug: string;
  width: number;
  height: number;
  fps: number;
}

interface VideoClipAdjustments {
  pipeline?: 'rgb-v1';
  lut?: ReturnType<typeof parseCubeLut>;
  exposure?: number;
  contrast?: number;
  saturation?: number;
  highlights?: number;
  shadows?: number;
  temperature?: number;
  tint?: number;
  sharpen?: number;
  vignette?: number;
  grain?: number;
  preset?: string;
}

interface VideoTransformShape {
  x?: unknown;
  y?: unknown;
  scale?: unknown;
  rotateDeg?: unknown;
}

interface VideoCropShape {
  x?: unknown;
  y?: unknown;
  width?: unknown;
  height?: unknown;
}

interface VideoKeyframeShape {
  timeMs?: unknown;
  property?: unknown;
  value?: unknown;
  easing?: unknown;
}

function baseDir(ctx: SessionToolContext): string {
  return ctx.workingDirectory || ctx.workspacePath;
}

function resolvePath(ctx: SessionToolContext, path: string): string {
  return isAbsolute(path) ? path : resolve(baseDir(ctx), path);
}

function isPathInside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function resolveWorkspacePath(ctx: SessionToolContext, path: string, label: string): { ok: true; path: string } | { ok: false; error: string } {
  const resolved = resolvePath(ctx, path);
  const root = resolve(baseDir(ctx));
  if (!isPathInside(root, resolved)) {
    return { ok: false, error: `${label} must be inside the session working directory: ${root}` };
  }
  return { ok: true, path: resolved };
}

function slugify(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
  return slug || 'video-project';
}

function aspectSettings(aspectRatio: string | undefined): { aspectRatio: AspectRatio; width: number; height: number; fps: number } {
  if (aspectRatio === '16:9') return { aspectRatio, width: 1920, height: 1080, fps: 30 };
  if (aspectRatio === '1:1') return { aspectRatio, width: 1080, height: 1080, fps: 30 };
  if (aspectRatio === '4:5') return { aspectRatio, width: 1080, height: 1350, fps: 30 };
  return { aspectRatio: '9:16', width: 1080, height: 1920, fps: 30 };
}

const VIDEO_EXPORT_PRESETS: Record<string, Partial<VideoExportRenderSettings>> = {
  'simple-mp4': {},
  placeholder: {},
  'mp4-16x9-1080p': { width: 1920, height: 1080, fps: 30 },
  'mp4-9x16-1080x1920': { width: 1080, height: 1920, fps: 30 },
  'mp4-1x1-1080': { width: 1080, height: 1080, fps: 30 },
  'mp4-4x5-1080x1350': { width: 1080, height: 1350, fps: 30 },
  'mp4-source-size': {},
};

function resolveExportPreset(project: VideoProject, preset: string | undefined, realVideo: boolean): { settings?: VideoExportRenderSettings; error?: string } {
  const slug = preset ?? (realVideo ? 'simple-mp4' : 'placeholder');
  const selected = VIDEO_EXPORT_PRESETS[slug];
  if (!selected) return { error: `Unknown export preset: ${slug}` };
  if (realVideo && slug === 'placeholder') return { error: 'The placeholder preset requires a non-video output path.' };
  if (!realVideo && slug !== 'placeholder') return { error: `Preset ${slug} requires a video output path.` };
  const width = selected.width ?? (typeof project.settings.width === 'number' ? project.settings.width : 1080);
  const height = selected.height ?? (typeof project.settings.height === 'number' ? project.settings.height : 1920);
  const fps = selected.fps ?? (typeof project.settings.fps === 'number' ? project.settings.fps : 30);
  return { settings: { slug, width, height, fps } };
}

function aspectMatchesDimensions(aspectRatio: string | undefined, width: number | undefined, height: number | undefined): boolean {
  if (!aspectRatio || aspectRatio === 'custom' || width === undefined || height === undefined) return true;
  const preset = aspectSettings(aspectRatio);
  return preset.width === width && preset.height === height;
}

function normalizeAspectRatio(aspectRatio: string | undefined, width: number | undefined, height: number | undefined): AspectRatio {
  if (aspectRatio === '16:9' || aspectRatio === '1:1' || aspectRatio === '4:5' || aspectRatio === '9:16') {
    return aspectMatchesDimensions(aspectRatio, width, height) ? aspectRatio : 'custom';
  }
  return 'custom';
}

function compactSettings(settings: Partial<{ aspectRatio: AspectRatio; width: number; height: number; fps: number }>): Partial<{ aspectRatio: AspectRatio; width: number; height: number; fps: number }> {
  return Object.fromEntries(Object.entries(settings).filter(([, value]) => value !== undefined)) as Partial<{ aspectRatio: AspectRatio; width: number; height: number; fps: number }>;
}

function createProject(title: string, workspaceId: string, settings: Partial<{ aspectRatio: AspectRatio; width: number; height: number; fps: number }>): VideoProject {
  const now = new Date().toISOString();
  const defaults = aspectSettings(settings.aspectRatio);
  const compacted = compactSettings(settings);
  const mergedSettings = { ...defaults, ...compacted };
  mergedSettings.aspectRatio = normalizeAspectRatio(mergedSettings.aspectRatio, mergedSettings.width, mergedSettings.height);
  return {
    version: 1,
    id: randomUUID(),
    title: title.trim() || 'Untitled Video',
    createdAt: now,
    updatedAt: now,
    workspaceId,
    settings: mergedSettings,
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

const readContents = new WeakMap<VideoProject, string>();

function commitProject(path: string, project: VideoProject, expectedContent: string | null): void {
  const content = `${JSON.stringify(project, null, 2)}\n`;
  commitVideoProjectContent(path, content, { expectedContent });
  readContents.set(project, content);
}

function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
  renameSync(tmp, path);
}

function videoProjectSidecarDir(projectPath: string): string {
  // Canonical file identity isolates sibling copies, even when their project IDs match.
  const canonical = realpathSync(projectPath);
  const projectId = readProject(canonical).id;
  const namespace = createHash('sha256').update(`${canonical}\0${projectId}`).digest('hex');
  return join(dirname(canonical), '.runner-video', 'projects', namespace);
}

function undoDir(projectPath: string): string {
  return join(videoProjectSidecarDir(projectPath), 'undo');
}

function snapshotsDir(projectPath: string): string {
  return join(videoProjectSidecarDir(projectPath), 'snapshots');
}

function fpsForProject(project: VideoProject): number {
  const fps = project.settings?.fps;
  return typeof fps === 'number' && Number.isFinite(fps) && fps > 0 ? fps : 30;
}

function msToFrame(project: VideoProject, ms: number): number {
  return Math.max(0, Math.round((Math.max(0, ms) / 1000) * fpsForProject(project)));
}

function frameToMs(project: VideoProject, frame: number): number {
  return Math.max(0, Math.round((Math.max(0, frame) / fpsForProject(project)) * 1000));
}

function compactObject<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Partial<T>;
}

function undoSnapshotFiles(projectPath: string): string[] {
  const dir = undoDir(projectPath);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.runner-video.json'))
    .sort()
    .map((name) => join(dir, name));
}

function latestUndoSnapshot(projectPath: string): string | undefined {
  return undoSnapshotFiles(projectPath).at(-1);
}

function trimUndoSnapshots(projectPath: string, keep = 25): void {
  const files = undoSnapshotFiles(projectPath);
  for (const file of files.slice(0, Math.max(0, files.length - keep))) {
    rmSync(file, { force: true });
  }
}

function writeUndoSnapshot(projectPath: string, project: VideoProject, reason: string): string {
  const dir = undoDir(projectPath);
  mkdirSync(dir, { recursive: true });
  const safeReason = slugify(reason).slice(0, 32);
  undoSnapshotSequence = (undoSnapshotSequence + 1) % 1_000_000;
  const sequence = String(undoSnapshotSequence).padStart(6, '0');
  const snapshotPath = join(dir, `${Date.now()}-${sequence}-${safeReason}-${randomUUID()}.runner-video.json`);
  writeJsonAtomic(snapshotPath, project);
  return snapshotPath;
}

function writeProjectWithUndo(projectPath: string, beforeProject: VideoProject, nextProject: VideoProject, reason: string): string {
  const undoPath = writeUndoSnapshot(projectPath, beforeProject, reason);
  try {
    commitProject(projectPath, nextProject, readContents.get(beforeProject) ?? null);
  } catch (error) {
    rmSync(undoPath, { force: true });
    throw error;
  }
  trimUndoSnapshots(projectPath);
  return undoPath;
}

function cloneProject(project: VideoProject): VideoProject {
  const clone = JSON.parse(JSON.stringify(project)) as VideoProject;
  const baseline = readContents.get(project);
  if (baseline !== undefined) readContents.set(clone, baseline);
  return clone;
}

function readProject(projectPath: string): VideoProject {
  const content = readFileSync(projectPath, 'utf-8');
  const project = JSON.parse(content) as VideoProject;
  const errors = validateProject(project);
  if (errors.length > 0) throw new Error(errors[0]);
  readContents.set(project, content);
  return project;
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
  const item = value[key];
  return typeof item === 'string' && item.trim() ? item : undefined;
}

function exportFilePaths(record: Record<string, unknown>, projectPath: string): string[] {
  const projectDir = dirname(projectPath);
  return ['path', 'receiptPath']
    .map((key) => stringField(record, key))
    .filter((path): path is string => Boolean(path))
    .map((path) => resolve(projectDir, path));
}

function cleanupRevertedExportFiles(projectPath: string, current: VideoProject, restored: VideoProject): ExportCleanupResult {
  const projectDir = dirname(projectPath);
  const restoredExportIds = new Set(restored.exports.map((record) => stringField(record, 'id')).filter(Boolean));
  const restoredPaths = new Set(restored.exports.flatMap((record) => exportFilePaths(record, projectPath)));
  const candidatePaths = new Set<string>();
  const warnings: string[] = [];
  const removedPaths: string[] = [];

  for (const record of current.exports) {
    const id = stringField(record, 'id');
    if (id && restoredExportIds.has(id)) continue;
    for (const path of exportFilePaths(record, projectPath)) {
      if (!restoredPaths.has(path)) candidatePaths.add(path);
    }
  }

  for (const path of candidatePaths) {
    if (!isPathInside(projectDir, path) || resolve(path) === resolve(projectPath)) {
      warnings.push(`Skipped export side-effect cleanup outside project folder: ${path}`);
      continue;
    }
    if (!existsSync(path)) continue;
    try {
      if (statSync(path).isDirectory()) {
        warnings.push(`Skipped export side-effect cleanup for directory: ${path}`);
        continue;
      }
      rmSync(path, { force: true });
      removedPaths.push(path);
    } catch (error) {
      warnings.push(`Failed to remove reverted export file ${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { removedPaths, warnings };
}

// Agent summaries describe a look; its large sample table stays in the project.
function summarizeAdjustments(adjustments: VideoClipAdjustments = {}) {
  const { lut, ...controls } = adjustments;
  return {
    ...controls,
    ...(lut ? { lut: compactObject({ name: lut.name, size: lut.size, intensity: lut.intensity ?? 1, domainMin: lut.domainMin, domainMax: lut.domainMax }) } : {}),
  };
}

function summarizeClip(project: VideoProject, clip: VideoProject['timeline']['tracks'][number]['clips'][number], trackId: string): Record<string, unknown> {
  const media = clip.mediaId ? project.media.find((asset) => asset.id === clip.mediaId) : undefined;
  const startFrame = msToFrame(project, clip.startMs);
  const durationFrames = Math.max(1, msToFrame(project, clip.durationMs));
  return compactObject({
    id: clip.id,
    trackId,
    type: clip.type,
    mediaId: clip.mediaId,
    mediaType: media?.type,
    label: clip.label,
    startMs: clip.startMs,
    durationMs: clip.durationMs,
    startFrame,
    durationFrames,
    endFrame: startFrame + durationFrames,
    sourceInMs: clip.sourceInMs,
    sourceOutMs: clip.sourceOutMs,
    trimStartFrame: typeof clip.sourceInMs === 'number' ? msToFrame(project, clip.sourceInMs) : undefined,
    trimEndFrame: typeof clip.sourceOutMs === 'number' ? msToFrame(project, clip.sourceOutMs) : undefined,
    speed: clip.speed,
    volume: clip.volume,
    opacity: typeof clip.opacity === 'number' ? clip.opacity : undefined,
    fadeInMs: clip.fadeInMs,
    fadeOutMs: clip.fadeOutMs,
    disabled: clip.disabled === true ? true : undefined,
    transform: clip.transform,
    crop: clip.crop,
    adjustments: clip.adjustments ? summarizeAdjustments(clip.adjustments) : undefined,
    keyframeCount: Array.isArray(clip.keyframes) ? clip.keyframes.length : undefined,
    captionCueIds: clip.captionCueIds,
    text: typeof clip.text === 'object' && clip.text ? clip.text : undefined,
  });
}

function summarizeTimeline(project: VideoProject, window?: { startFrame?: number; endFrame?: number }): Record<string, unknown> {
  const fps = fpsForProject(project);
  const totalFrames = msToFrame(project, project.timeline.durationMs);
  const startFrame = Math.max(0, Math.round(window?.startFrame ?? 0));
  const endFrame = Math.max(startFrame, Math.round(window?.endFrame ?? totalFrames));
  const hasWindow = window?.startFrame !== undefined || window?.endFrame !== undefined;
  return {
    projectId: project.id,
    title: project.title,
    fps,
    width: project.settings.width,
    height: project.settings.height,
    aspectRatio: project.settings.aspectRatio,
    durationMs: project.timeline.durationMs,
    totalFrames,
    window: hasWindow ? { startFrame, endFrame } : undefined,
    selection: project.timeline.selection,
    markers: project.timeline.markers,
    tracks: project.timeline.tracks.map((track, index) => {
      const clips = track.clips
        .map((clip) => summarizeClip(project, clip, track.id))
        .filter((clip) => {
          if (!hasWindow) return true;
          const clipStart = typeof clip.startFrame === 'number' ? clip.startFrame : 0;
          const clipEnd = typeof clip.endFrame === 'number' ? clip.endFrame : clipStart;
          return clipEnd > startFrame && clipStart < endFrame;
        });
      return compactObject({
        id: track.id,
        index,
        type: track.type,
        label: track.label,
        locked: track.locked === true ? true : undefined,
        muted: track.muted === true ? true : undefined,
        hidden: track.hidden === true ? true : undefined,
        clipCount: track.clips.length,
        clips,
      });
    }),
  };
}

function summarizeMedia(project: VideoProject): Array<Record<string, unknown>> {
  const projectDir = dirname(project.media[0]?.path ?? '');
  return project.media.map((asset) => compactObject({
    id: asset.id,
    type: asset.type,
    label: asset.label,
    path: asset.path,
    exists: existsSync(asset.path),
    durationMs: asset.durationMs,
    durationFrames: typeof asset.durationMs === 'number' ? msToFrame(project, asset.durationMs) : undefined,
    width: asset.width,
    height: asset.height,
    fps: asset.fps,
    sizeBytes: asset.sizeBytes,
    codec: asset.codec,
    hasAudio: asset.hasAudio,
    hasVideo: asset.hasVideo,
    thumbnailPath: asset.thumbnailPath,
    waveformPath: asset.waveformPath,
    transcriptPath: asset.transcriptPath,
    originalPath: typeof asset.originalPath === 'string' ? asset.originalPath : undefined,
    relativePath: projectDir ? relative(projectDir, asset.path) : undefined,
    usedByClipIds: project.timeline.tracks.flatMap((track) => track.clips.filter((clip) => clip.mediaId === asset.id).map((clip) => clip.id)),
  }));
}

function diffProjects(before: VideoProject, after: VideoProject): Record<string, unknown> {
  const beforeClips = new Map(before.timeline.tracks.flatMap((track) => track.clips.map((clip) => [clip.id, { trackId: track.id, clip }] as const)));
  const afterClips = new Map(after.timeline.tracks.flatMap((track) => track.clips.map((clip) => [clip.id, { trackId: track.id, clip }] as const)));
  const addedClipIds = [...afterClips.keys()].filter((id) => !beforeClips.has(id));
  const removedClipIds = [...beforeClips.keys()].filter((id) => !afterClips.has(id));
  const changedClipIds = [...afterClips.entries()]
    .filter(([id, item]) => {
      const previous = beforeClips.get(id);
      return previous && JSON.stringify(previous) !== JSON.stringify(item);
    })
    .map(([id]) => id);
  const addedMediaIds = projectIds(after.media).filter((id) => !projectIds(before.media).includes(id));
  const removedMediaIds = projectIds(before.media).filter((id) => !projectIds(after.media).includes(id));
  return {
    beforeProjectId: before.id,
    afterProjectId: after.id,
    titleChanged: before.title !== after.title,
    settingsChanged: JSON.stringify(before.settings) !== JSON.stringify(after.settings),
    durationMsBefore: before.timeline.durationMs,
    durationMsAfter: after.timeline.durationMs,
    addedClipIds,
    removedClipIds,
    changedClipIds,
    addedMediaIds,
    removedMediaIds,
    versionCountBefore: before.versions.length,
    versionCountAfter: after.versions.length,
  };
}

function projectIds(items: Array<{ id: string }>): string[] {
  return items.map((item) => item.id);
}

function sampleFrames(startFrame: number, endFrame: number | undefined, totalFrames: number, maxFrames: number | undefined): number[] {
  if (totalFrames <= 0) return [];
  const start = clamp(Math.round(startFrame), 0, Math.max(0, totalFrames - 1));
  if (endFrame === undefined) return [start];
  const end = clamp(Math.round(endFrame), start + 1, totalFrames);
  const span = Math.max(1, end - start);
  const count = clamp(Math.round(maxFrames ?? 6), 1, Math.min(12, span));
  return Array.from({ length: count }, (_, index) => start + Math.floor((span * (index + 0.5)) / count));
}

function extractFrameImage(videoPath: string, outputPath: string, atSeconds: number): void {
  mkdirSync(dirname(outputPath), { recursive: true });
  const result = spawnSync('ffmpeg', [
    '-y',
    '-v', 'error',
    '-ss', ffmpegNumber(atSeconds),
    '-i', videoPath,
    '-frames:v', '1',
    '-q:v', '3',
    outputPath,
  ], { encoding: 'utf-8', timeout: 30_000 });
  if (result.status !== 0 || !existsSync(outputPath)) {
    throw new Error(result.stderr || result.stdout || 'ffmpeg failed to extract timeline frame.');
  }
}

function renderTimelineInspection(project: VideoProject, projectPath: string, args: VideoInspectTimelineInput): Record<string, unknown> {
  const totalFrames = msToFrame(project, project.timeline.durationMs);
  if (totalFrames <= 0) throw new Error('Timeline is empty.');
  const frames = sampleFrames(args.startFrame ?? 0, args.endFrame, totalFrames, args.maxFrames);
  const inspectionId = randomUUID();
  const dir = join(dirname(projectPath), 'inspections', inspectionId);
  const tempVideoPath = join(dir, 'timeline-preview.mp4');
  mkdirSync(dir, { recursive: true });
  const renderSettings = resolveExportPreset(project, 'simple-mp4', true);
  if (renderSettings.error || !renderSettings.settings) throw new Error(renderSettings.error ?? 'Invalid timeline inspection preset.');
  renderSimpleMp4(project, tempVideoPath, renderSettings.settings, { timeoutMs: INSPECTION_RENDER_TIMEOUT_MS });
  const imagePaths = frames.map((frame) => {
    const imagePath = join(dir, `frame-${String(frame).padStart(6, '0')}.jpg`);
    extractFrameImage(tempVideoPath, imagePath, frame / fpsForProject(project));
    return imagePath;
  });
  rmSync(tempVideoPath, { force: true });
  return {
    inspectionId,
    projectPath,
    fps: fpsForProject(project),
    width: renderSettings.settings.width,
    height: renderSettings.settings.height,
    totalFrames,
    frameNumbers: frames,
    imagePaths,
  };
}

function renderMediaOverview(asset: VideoProject['media'][number], project: VideoProject, projectPath: string, args: VideoInspectMediaInput): Record<string, unknown> {
  if (asset.type !== 'video') throw new Error('overview is only supported for video media.');
  if (!existsSync(asset.path)) throw new Error(`Media file not found: ${asset.path}`);
  const durationSeconds = Math.max(0.001, (positiveNumber(asset.durationMs) ?? 1000) / 1000);
  const start = clamp(args.startSeconds ?? 0, 0, durationSeconds);
  const end = clamp(args.endSeconds ?? durationSeconds, start + 0.001, durationSeconds);
  const count = clamp(Math.round(args.maxFrames ?? 12), 1, 36);
  const outputPath = join(dirname(projectPath), 'inspections', randomUUID(), `${asset.id}-overview.jpg`);
  mkdirSync(dirname(outputPath), { recursive: true });
  const fpsExpression = Math.max(0.05, count / Math.max(0.001, end - start));
  const result = spawnSync('ffmpeg', [
    '-y',
    '-v', 'error',
    '-ss', ffmpegNumber(start),
    '-t', ffmpegNumber(end - start),
    '-i', asset.path,
    '-vf', `fps=${ffmpegNumber(fpsExpression)},scale=160:90:force_original_aspect_ratio=decrease,pad=160:90:(ow-iw)/2:(oh-ih)/2,tile=${Math.min(6, count)}x${Math.ceil(count / Math.min(6, count))}`,
    '-frames:v', '1',
    '-q:v', '4',
    outputPath,
  ], { encoding: 'utf-8', timeout: 45_000 });
  if (result.status !== 0 || !existsSync(outputPath)) {
    throw new Error(result.stderr || result.stdout || 'ffmpeg failed to render media overview.');
  }
  return {
    mediaId: asset.id,
    overviewPath: outputPath,
    startSeconds: start,
    endSeconds: end,
    requestedTiles: count,
    durationFrames: typeof asset.durationMs === 'number' ? msToFrame(project, asset.durationMs) : undefined,
  };
}

function validateProject(project: VideoProject): string[] {
  const errors: string[] = [];
  if (!project || typeof project !== 'object') return ['Project must be an object.'];
  if (project.version !== 1) errors.push('version must be 1.');
  if (!project.id) errors.push('id is required.');
  if (!project.title) errors.push('title is required.');
  if (!project.workspaceId) errors.push('workspaceId is required.');
  if (!project.settings || typeof project.settings !== 'object') errors.push('settings is required.');
  if (!Array.isArray(project.media)) errors.push('media must be an array.');
  if (!project.timeline || !Array.isArray(project.timeline.tracks)) errors.push('timeline.tracks must be an array.');
  for (const key of ['captions', 'overlays', 'effects', 'templates', 'exports', 'versions', 'agentEvents'] as const) {
    if (!Array.isArray(project[key])) errors.push(`${key} must be an array.`);
  }
  const mediaIds = new Set((project.media || []).map((asset) => asset.id));
  for (const [trackIndex, track] of (project.timeline?.tracks || []).entries()) {
    if (!Array.isArray(track.clips)) errors.push(`timeline.tracks[${trackIndex}].clips must be an array.`);
    const ordered = [...(track.clips || [])].sort((a, b) => a.startMs - b.startMs);
    let cursor = 0;
    for (const [clipIndex, clip] of (track.clips || []).entries()) {
      const path = `timeline.tracks[${trackIndex}].clips[${clipIndex}]`;
      if (!clip.id) errors.push(`${path}.id is required.`);
      if (typeof clip.startMs !== 'number' || !Number.isFinite(clip.startMs) || clip.startMs < 0) errors.push(`${path}.startMs must be non-negative.`);
      if (typeof clip.durationMs !== 'number' || !Number.isFinite(clip.durationMs) || clip.durationMs <= 0) errors.push(`${path}.durationMs must be positive.`);
      if (clip.mediaId && !mediaIds.has(clip.mediaId)) errors.push(`${path}.mediaId references missing media.`);
      const sourceInMs = clip.sourceInMs;
      const sourceOutMs = clip.sourceOutMs;
      if (sourceInMs !== undefined && (typeof sourceInMs !== 'number' || !Number.isFinite(sourceInMs) || sourceInMs < 0)) errors.push(`${path}.sourceInMs must be non-negative.`);
      if (sourceOutMs !== undefined && (typeof sourceOutMs !== 'number' || !Number.isFinite(sourceOutMs) || sourceOutMs < 0)) errors.push(`${path}.sourceOutMs must be non-negative.`);
      if (typeof sourceInMs === 'number' && typeof sourceOutMs === 'number' && sourceOutMs <= sourceInMs) errors.push(`${path}.sourceOutMs must be greater than sourceInMs.`);
      if (clip.opacity !== undefined && (typeof clip.opacity !== 'number' || !Number.isFinite(clip.opacity) || clip.opacity < 0 || clip.opacity > 1)) {
        errors.push(`${path}.opacity must be between 0 and 1.`);
      }
      if (clip.transform !== undefined) {
        if (!clip.transform || typeof clip.transform !== 'object' || Array.isArray(clip.transform)) {
          errors.push(`${path}.transform must be an object.`);
        } else {
          const transform = clip.transform as VideoTransformShape;
          for (const key of ['x', 'y', 'scale', 'rotateDeg'] as const) {
            if (transform[key] !== undefined && (typeof transform[key] !== 'number' || !Number.isFinite(transform[key]))) {
              errors.push(`${path}.transform.${key} must be a finite number.`);
            }
          }
          if (typeof transform.scale === 'number' && (transform.scale < 0.05 || transform.scale > 5)) errors.push(`${path}.transform.scale must be between 0.05 and 5.`);
        }
      }
      if (clip.crop !== undefined) {
        if (!clip.crop || typeof clip.crop !== 'object' || Array.isArray(clip.crop)) {
          errors.push(`${path}.crop must be an object.`);
        } else {
          const crop = clip.crop as VideoCropShape;
          for (const key of ['x', 'y', 'width', 'height'] as const) {
            if (typeof crop[key] !== 'number' || !Number.isFinite(crop[key])) errors.push(`${path}.crop.${key} must be a finite number.`);
          }
          if (typeof crop.x === 'number' && crop.x < 0) errors.push(`${path}.crop.x must be non-negative.`);
          if (typeof crop.y === 'number' && crop.y < 0) errors.push(`${path}.crop.y must be non-negative.`);
          if (typeof crop.width === 'number' && crop.width <= 0) errors.push(`${path}.crop.width must be positive.`);
          if (typeof crop.height === 'number' && crop.height <= 0) errors.push(`${path}.crop.height must be positive.`);
        }
      }
      if (clip.keyframes !== undefined) {
        if (!Array.isArray(clip.keyframes)) {
          errors.push(`${path}.keyframes must be an array.`);
        } else {
          for (const [keyframeIndex, rawKeyframe] of clip.keyframes.entries()) {
            const keyframePath = `${path}.keyframes[${keyframeIndex}]`;
            if (!rawKeyframe || typeof rawKeyframe !== 'object' || Array.isArray(rawKeyframe)) {
              errors.push(`${keyframePath} must be an object.`);
              continue;
            }
            const keyframe = rawKeyframe as VideoKeyframeShape;
            if (typeof keyframe.timeMs !== 'number' || !Number.isFinite(keyframe.timeMs) || keyframe.timeMs < 0) errors.push(`${keyframePath}.timeMs must be non-negative.`);
            if (keyframe.property !== 'x' && keyframe.property !== 'y') errors.push(`${keyframePath}.property must be x or y.`);
            if (typeof keyframe.value !== 'number' || !Number.isFinite(keyframe.value)) errors.push(`${keyframePath}.value must be a finite number.`);
          }
        }
      }
    }
    for (const clip of ordered) {
      if (Number.isFinite(clip.startMs) && Number.isFinite(clip.durationMs) && clip.startMs < cursor) {
        errors.push(`timeline.tracks[${trackIndex}].clips.${clip.id}.startMs overlaps the previous clip.`);
      }
      cursor = Math.max(cursor, (clip.startMs || 0) + (clip.durationMs || 0));
    }
  }
  return errors;
}

function addVersion(project: VideoProject, summary: string, ctx: SessionToolContext, toolName: string): string {
  const now = new Date().toISOString();
  const versionId = randomUUID();
  const activeAgentSlug = (ctx as SessionToolContext & { activeAgentSlug?: string }).activeAgentSlug;
  project.versions.push({
    id: versionId,
    createdAt: now,
    summary,
    actor: 'agent',
    agentSlug: activeAgentSlug,
    sessionId: ctx.sessionId,
  });
  project.agentEvents.push({
    id: randomUUID(),
    createdAt: now,
    agentSlug: activeAgentSlug ?? 'unknown-agent',
    sessionId: ctx.sessionId,
    toolName,
    summary,
    afterVersionId: versionId,
  });
  project.updatedAt = now;
  return versionId;
}

function inferMediaType(path: string): MediaType {
  const ext = extname(path).toLowerCase();
  if (['.mp4', '.mov', '.m4v', '.webm', '.mkv'].includes(ext)) return 'video';
  if (['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg'].includes(ext)) return 'audio';
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif'].includes(ext)) return 'image';
  if (['.srt', '.vtt'].includes(ext)) return 'caption';
  if (ext === '.svg') return 'svg';
  return 'unknown';
}

function parseCaptionTimestamp(value: string): number | null {
  const match = value.trim().match(/^(?:(\d+):)?(\d{2}):(\d{2})([,.](\d{1,3}))?$/);
  if (!match) return null;
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2]);
  const secondsValue = Number(match[3]);
  const millis = Number((match[5] ?? '0').padEnd(3, '0').slice(0, 3));
  if (![hours, minutes, secondsValue, millis].every(Number.isFinite)) return null;
  return (((hours * 60 + minutes) * 60 + secondsValue) * 1000) + millis;
}

function stripCaptionText(value: string): string {
  return value.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function parseCaptionFile(content: string): ParsedCaptionCue[] {
  const normalized = content.replace(/\r/g, '').replace(/^\uFEFF/, '');
  const blocks = normalized.split(/\n{2,}/);
  const cues: ParsedCaptionCue[] = [];
  for (const block of blocks) {
    const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    if (lines[0]?.toUpperCase().startsWith('WEBVTT')) continue;
    if (lines[0]?.toUpperCase().startsWith('NOTE')) continue;
    const timingIndex = lines.findIndex((line) => line.includes('-->'));
    if (timingIndex === -1) continue;
    const [rawStart, rawEndWithSettings] = lines[timingIndex]!.split('-->').map((part) => part.trim());
    const rawEnd = rawEndWithSettings?.split(/\s+/)[0];
    if (!rawStart || !rawEnd) continue;
    const startMs = parseCaptionTimestamp(rawStart);
    const endMs = parseCaptionTimestamp(rawEnd);
    if (startMs === null || endMs === null || endMs <= startMs) continue;
    const text = stripCaptionText(lines.slice(timingIndex + 1).join(' '));
    if (!text) continue;
    cues.push({
      id: randomUUID(),
      startMs,
      durationMs: endMs - startMs,
      text,
    });
  }
  return cues;
}

function addCaptionCuesToProject(project: VideoProject, label: string, cues: ParsedCaptionCue[]): string[] {
  if (cues.length === 0) return [];
  const captionTrackId = randomUUID();
  project.captions.push({
    id: captionTrackId,
    label,
    cues,
  });
  const timelineTrack = chooseTrack(project, 'caption', 'captions-main');
  const clipIds: string[] = [];
  for (const cue of cues) {
    const clip = {
      id: randomUUID(),
      type: 'caption' as const,
      startMs: cue.startMs,
      durationMs: cue.durationMs,
      label: cue.text,
      captionCueIds: [cue.id],
    };
    timelineTrack.clips.push(clip);
    clipIds.push(clip.id);
  }
  timelineTrack.clips = orderedClips(timelineTrack.clips);
  project.timeline.durationMs = Math.max(project.timeline.durationMs, timelineDuration(project.timeline.tracks));
  return clipIds;
}

function parseFfprobeRate(value: unknown): number | undefined {
  if (typeof value !== 'string' || !value.trim() || value === '0/0') return undefined;
  const parts = value.split('/').map(Number);
  const numerator = Number(parts[0]);
  const denominator = Number(parts[1]);
  if (!Number.isFinite(numerator)) return undefined;
  if (!Number.isFinite(denominator) || denominator === 0) return numerator > 0 ? numerator : undefined;
  const fps = numerator / denominator;
  return Number.isFinite(fps) && fps > 0 ? Math.round(fps * 1000) / 1000 : undefined;
}

function parsePositiveNumber(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseFloat(value) : Number.NaN;
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function probeMediaMetadata(path: string, mediaType: MediaType = inferMediaType(path)): VideoMediaProbeMetadata {
  const stats = statSync(path);
  const metadata: VideoMediaProbeMetadata = { sizeBytes: stats.size };
  if (!['video', 'audio', 'image'].includes(mediaType)) return metadata;
  const result = spawnSync('ffprobe', [
    '-v', 'error',
    '-print_format', 'json',
    '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height,avg_frame_rate,r_frame_rate',
    path,
  ], { encoding: 'utf-8', timeout: 30_000 });
  if (result.status !== 0 || !result.stdout.trim()) return metadata;
  try {
    const parsed = JSON.parse(result.stdout) as {
      format?: { duration?: string | number };
      streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number; avg_frame_rate?: string; r_frame_rate?: string }>;
    };
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

function runDerivativeFfmpeg(args: string[], outputPath: string): boolean {
  const result = spawnSync('ffmpeg', args, { encoding: 'utf-8', timeout: 45_000 });
  return result.status === 0 && existsSync(outputPath);
}

function generateVideoMediaDerivatives(
  inputPath: string,
  mediaType: MediaType,
  metadata: Pick<VideoMediaProbeMetadata, 'hasAudio'>,
  targets: { thumbnailPath: string; waveformPath: string },
): VideoMediaDerivativePaths {
  const derivatives: VideoMediaDerivativePaths = {};
  if (mediaType === 'video' || mediaType === 'image') {
    mkdirSync(dirname(targets.thumbnailPath), { recursive: true });
    const thumbnailArgs = mediaType === 'video'
      ? ['-y', '-ss', '0', '-i', inputPath, '-frames:v', '1', '-vf', 'scale=320:-2', targets.thumbnailPath]
      : ['-y', '-i', inputPath, '-frames:v', '1', '-vf', 'scale=320:-2', targets.thumbnailPath];
    if (runDerivativeFfmpeg(thumbnailArgs, targets.thumbnailPath)) derivatives.thumbnailPath = targets.thumbnailPath;
  }
  if (mediaType === 'audio' || metadata.hasAudio === true) {
    mkdirSync(dirname(targets.waveformPath), { recursive: true });
    const waveformArgs = [
      '-y',
      '-i', inputPath,
      '-filter_complex', 'aformat=channel_layouts=mono,showwavespic=s=640x120:colors=#ff7a1a',
      '-frames:v', '1',
      targets.waveformPath,
    ];
    if (runDerivativeFfmpeg(waveformArgs, targets.waveformPath)) derivatives.waveformPath = targets.waveformPath;
  }
  return derivatives;
}

function isVideoOutputPath(path: string): boolean {
  return ['.mp4', '.mov', '.m4v', '.webm', '.mkv'].includes(extname(path).toLowerCase());
}

function applyClipSettings(clip: { volume?: number; speed?: number; fadeInMs?: number; fadeOutMs?: number }, input: { volume?: number; speed?: number; fadeInMs?: number; fadeOutMs?: number }): string | null {
  if (input.volume !== undefined) {
    if (!Number.isFinite(input.volume) || input.volume < 0 || input.volume > 4) return 'volume must be between 0 and 4.';
    clip.volume = Math.round(input.volume * 1000) / 1000;
  }
  if (input.speed !== undefined) {
    if (!Number.isFinite(input.speed) || input.speed < 0.25 || input.speed > 4) return 'speed must be between 0.25 and 4.';
    clip.speed = Math.round(input.speed * 1000) / 1000;
  }
  if (input.fadeInMs !== undefined) {
    if (!Number.isFinite(input.fadeInMs) || input.fadeInMs < 0) return 'fadeInMs must be non-negative.';
    clip.fadeInMs = Math.round(input.fadeInMs);
  }
  if (input.fadeOutMs !== undefined) {
    if (!Number.isFinite(input.fadeOutMs) || input.fadeOutMs < 0) return 'fadeOutMs must be non-negative.';
    clip.fadeOutMs = Math.round(input.fadeOutMs);
  }
  return null;
}

const ADJUSTMENT_PRESETS: Record<NonNullable<VideoClipAdjustInput['preset']>, VideoClipAdjustments> = {
  neutral: { pipeline: 'rgb-v1', preset: 'neutral' },
  clean: { pipeline: 'rgb-v1', exposure: 0.03, contrast: 1.05, saturation: 1.04, preset: 'clean' },
  cinematic: { pipeline: 'rgb-v1', exposure: -0.03, contrast: 1.18, saturation: 0.92, highlights: -0.12, shadows: 0.08, preset: 'cinematic' },
  warm: { pipeline: 'rgb-v1', exposure: 0.02, contrast: 1.05, saturation: 1.08, temperature: 0.18, preset: 'warm' },
  punchy: { pipeline: 'rgb-v1', exposure: 0.04, contrast: 1.25, saturation: 1.22, highlights: -0.05, shadows: -0.04, preset: 'punchy' },
  'black-and-white': { pipeline: 'rgb-v1', exposure: 0, contrast: 1.16, saturation: 0, preset: 'black-and-white' },
};

function sanitizedAdjustments(input: Partial<VideoClipAdjustments>): VideoClipAdjustments {
  const next: VideoClipAdjustments = {};
  if (input.exposure !== undefined) next.exposure = clamp(Number(input.exposure), -1, 1);
  if (input.contrast !== undefined) next.contrast = clamp(Number(input.contrast), 0, 3);
  if (input.saturation !== undefined) next.saturation = clamp(Number(input.saturation), 0, 3);
  if (input.highlights !== undefined) next.highlights = clamp(Number(input.highlights), -1, 1);
  if (input.shadows !== undefined) next.shadows = clamp(Number(input.shadows), -1, 1);
  if (input.temperature !== undefined) next.temperature = clamp(Number(input.temperature), -1, 1);
  if (input.tint !== undefined) next.tint = clamp(Number(input.tint), -1, 1);
  if (input.sharpen !== undefined) next.sharpen = clamp(Number(input.sharpen), 0, 1);
  if (input.vignette !== undefined) next.vignette = clamp(Number(input.vignette), 0, 1);
  if (input.grain !== undefined) next.grain = clamp(Number(input.grain), 0, 1);
  if (input.preset !== undefined) next.preset = input.preset;
  return Object.fromEntries(Object.entries(next).filter(([, value]) => Number.isFinite(value as number) || typeof value === 'string')) as VideoClipAdjustments;
}

function hasExplicitAdjustmentInput(args: VideoClipAdjustInput): boolean {
  return [
    args.exposure,
    args.contrast,
    args.saturation,
    args.highlights,
    args.shadows,
    args.temperature,
    args.tint,
    args.sharpen,
    args.vignette,
    args.grain,
  ].some((value) => value !== undefined);
}

function chooseTrack(project: VideoProject, mediaType: MediaType, requestedTrackId?: string): VideoProject['timeline']['tracks'][number] {
  if (requestedTrackId) {
    const found = project.timeline.tracks.find((track) => track.id === requestedTrackId);
    if (found) return found;
    const created = { id: requestedTrackId, type: mediaType === 'audio' ? 'audio' as const : 'video' as const, label: requestedTrackId, clips: [] };
    project.timeline.tracks.push(created);
    return created;
  }
  const preferred = mediaType === 'audio' ? 'audio-main' : mediaType === 'caption' ? 'captions-main' : 'video-main';
  return project.timeline.tracks.find((track) => track.id === preferred) ?? project.timeline.tracks[0]!;
}

function orderedClips<T extends { startMs: number }>(clips: T[]): T[] {
  return [...clips].sort((a, b) => a.startMs - b.startMs);
}

function timelineDuration(tracks: VideoProject['timeline']['tracks']): number {
  return tracks.reduce((duration, track) => {
    const trackEnd = (track.clips || []).reduce((end, clip) => Math.max(end, clip.startMs + clip.durationMs), 0);
    return Math.max(duration, trackEnd);
  }, 0);
}

function findClip(project: VideoProject, clipId: string): { track: VideoProject['timeline']['tracks'][number]; clip: VideoProject['timeline']['tracks'][number]['clips'][number] } | null {
  for (const track of project.timeline.tracks) {
    const clip = track.clips.find((item) => item.id === clipId);
    if (clip) return { track, clip };
  }
  return null;
}

function lockedTrackError(track: VideoProject['timeline']['tracks'][number]): string {
  return `Track "${track.label || track.id}" is locked. Unlock it before editing clips on this track.`;
}

function snapClipStart(track: VideoProject['timeline']['tracks'][number], clipId: string, proposedStartMs: number, thresholdMs = 250): number {
  const snapPoints = track.clips
    .filter((clip) => clip.id !== clipId)
    .map((clip) => clip.startMs + Math.max(1, clip.durationMs));
  let best = Math.max(0, Math.round(proposedStartMs));
  let bestDistance = thresholdMs + 1;
  for (const point of snapPoints) {
    const distance = Math.abs(point - proposedStartMs);
    if (distance < bestDistance) {
      best = point;
      bestDistance = distance;
    }
  }
  return Math.max(0, best);
}

function packTimeline(project: VideoProject): number {
  let changed = 0;
  for (const track of project.timeline.tracks) {
    if (track.locked) continue;
    let cursor = 0;
    track.clips = orderedClips(track.clips).map((clip) => {
      const startMs = cursor;
      cursor += Math.max(1, clip.durationMs);
      if (clip.startMs === startMs) return clip;
      changed += 1;
      return { ...clip, startMs };
    });
  }
  project.timeline.durationMs = timelineDuration(project.timeline.tracks);
  return changed;
}

function rippleTrimEnd(track: VideoProject['timeline']['tracks'][number], clipId: string, nextDurationMs: number): { startMs: number; durationMs: number } | null {
  const ordered = orderedClips(track.clips);
  const clipIndex = ordered.findIndex((item) => item.id === clipId);
  const clip = ordered[clipIndex];
  if (!clip) return null;
  const durationMs = Math.max(1, Math.round(nextDurationMs));
  const deltaMs = durationMs - Math.max(1, clip.durationMs);
  let cursor = 0;
  track.clips = ordered.map((item, index) => {
    if (index < clipIndex) {
      cursor = Math.max(cursor, item.startMs + Math.max(1, item.durationMs));
      return item;
    }
    if (item.id === clip.id) {
      const nextClip = { ...item, durationMs };
      cursor = Math.max(cursor, item.startMs + durationMs);
      return nextClip;
    }
    const startMs = Math.max(item.startMs + deltaMs, cursor);
    cursor = startMs + Math.max(1, item.durationMs);
    return { ...item, startMs };
  });
  return { startMs: clip.startMs, durationMs };
}

function transformForLayoutPreset(project: VideoProject, preset: NonNullable<VideoClipTransformInput['layoutPreset']>): { x: number; y: number; scale: number; rotateDeg: number } {
  const width = typeof project.settings.width === 'number' ? project.settings.width : 1080;
  const height = typeof project.settings.height === 'number' ? project.settings.height : 1920;
  if (preset === 'pip-top-right') return { x: Math.round(width * 0.3), y: -Math.round(height * 0.3), scale: 0.32, rotateDeg: 0 };
  if (preset === 'pip-bottom-right') return { x: Math.round(width * 0.3), y: Math.round(height * 0.3), scale: 0.32, rotateDeg: 0 };
  if (preset === 'split-left') return { x: -Math.round(width * 0.25), y: 0, scale: 0.5, rotateDeg: 0 };
  if (preset === 'split-right') return { x: Math.round(width * 0.25), y: 0, scale: 0.5, rotateDeg: 0 };
  if (preset === 'split-top') return { x: 0, y: -Math.round(height * 0.25), scale: 0.5, rotateDeg: 0 };
  if (preset === 'split-bottom') return { x: 0, y: Math.round(height * 0.25), scale: 0.5, rotateDeg: 0 };
  return { x: 0, y: 0, scale: 1, rotateDeg: 0 };
}

function sanitizeTransformInput(project: VideoProject, clip: VideoProject['timeline']['tracks'][number]['clips'][number], args: VideoClipTransformInput): string | null {
  const base = args.layoutPreset ? transformForLayoutPreset(project, args.layoutPreset) : clipTransform(clip) as { x: number; y: number; scale: number; rotateDeg: number };
  if (args.resetTransform) {
    delete clip.transform;
  } else {
    if (args.x !== undefined) {
      if (!Number.isFinite(args.x)) return 'x must be a finite number.';
      base.x = Math.round(args.x);
    }
    if (args.y !== undefined) {
      if (!Number.isFinite(args.y)) return 'y must be a finite number.';
      base.y = Math.round(args.y);
    }
    if (args.scale !== undefined) {
      if (!Number.isFinite(args.scale) || args.scale < 0.05 || args.scale > 5) return 'scale must be between 0.05 and 5.';
      base.scale = Math.round(args.scale * 1000) / 1000;
    }
    if (args.rotateDeg !== undefined) {
      if (!Number.isFinite(args.rotateDeg)) return 'rotateDeg must be a finite number.';
      base.rotateDeg = Math.round(args.rotateDeg * 1000) / 1000;
    }
    clip.transform = base;
  }

  if (args.opacity !== undefined) {
    if (!Number.isFinite(args.opacity) || args.opacity < 0 || args.opacity > 1) return 'opacity must be between 0 and 1.';
    clip.opacity = Math.round(args.opacity * 1000) / 1000;
  }

  const hasCropInput = args.cropX !== undefined || args.cropY !== undefined || args.cropWidth !== undefined || args.cropHeight !== undefined;
  if (args.resetCrop) {
    delete clip.crop;
  } else if (hasCropInput) {
    const current = clip.crop && typeof clip.crop === 'object' ? clip.crop as VideoCropShape : {};
    const crop = {
      x: args.cropX ?? finiteNumber(current.x, 0),
      y: args.cropY ?? finiteNumber(current.y, 0),
      width: args.cropWidth ?? finiteNumber(current.width, 0),
      height: args.cropHeight ?? finiteNumber(current.height, 0),
    };
    if (![crop.x, crop.y, crop.width, crop.height].every(Number.isFinite)) return 'crop values must be finite numbers.';
    if (crop.x < 0 || crop.y < 0) return 'crop x/y must be non-negative.';
    if (crop.width <= 0 || crop.height <= 0) return 'crop width/height must be positive.';
    clip.crop = {
      x: Math.round(crop.x),
      y: Math.round(crop.y),
      width: Math.round(crop.width),
      height: Math.round(crop.height),
    };
  }

  if (args.resetKeyframes) {
    delete clip.keyframes;
  } else if (args.keyframes !== undefined) {
    clip.keyframes = args.keyframes.map((keyframe) => ({
      timeMs: Math.round(keyframe.timeMs),
      property: keyframe.property,
      value: Math.round(keyframe.value * 1000) / 1000,
      ...(keyframe.easing ? { easing: keyframe.easing } : {}),
    }));
  }
  return null;
}

function ok(text: string, structuredContent: Record<string, unknown>): ToolResult {
  return { content: [{ type: 'text', text }], structuredContent, isError: false };
}

export async function handleVideoGetTimeline(ctx: SessionToolContext, args: VideoProjectReadInput): Promise<ToolResult> {
  if (!args.projectPath) return errorResponse('projectPath is required.');
  const projectPathResult = resolveWorkspacePath(ctx, args.projectPath, 'projectPath');
  if (!projectPathResult.ok) return errorResponse(projectPathResult.error);
  const projectPath = projectPathResult.path;
  if (!existsSync(projectPath)) return errorResponse(`Project not found: ${projectPath}`);
  const project = readProject(projectPath);
  const timeline = summarizeTimeline(project, { startFrame: args.startFrame, endFrame: args.endFrame });
  return ok(`Loaded timeline for "${project.title}".`, {
    ok: true,
    projectPath,
    timeline,
  });
}

export async function handleVideoGetMedia(ctx: SessionToolContext, args: VideoProjectReadInput): Promise<ToolResult> {
  if (!args.projectPath) return errorResponse('projectPath is required.');
  const projectPathResult = resolveWorkspacePath(ctx, args.projectPath, 'projectPath');
  if (!projectPathResult.ok) return errorResponse(projectPathResult.error);
  const projectPath = projectPathResult.path;
  if (!existsSync(projectPath)) return errorResponse(`Project not found: ${projectPath}`);
  const project = readProject(projectPath);
  const media = summarizeMedia(project);
  return ok(`Loaded ${media.length} media assets for "${project.title}".`, {
    ok: true,
    projectPath,
    media,
  });
}

export async function handleVideoInspectTimeline(ctx: SessionToolContext, args: VideoInspectTimelineInput): Promise<ToolResult> {
  if (!args.projectPath) return errorResponse('projectPath is required.');
  const projectPathResult = resolveWorkspacePath(ctx, args.projectPath, 'projectPath');
  if (!projectPathResult.ok) return errorResponse(projectPathResult.error);
  const projectPath = projectPathResult.path;
  if (!existsSync(projectPath)) return errorResponse(`Project not found: ${projectPath}`);
  try {
    const project = readProject(projectPath);
    const inspection = renderTimelineInspection(project, projectPath, args);
    return ok(`Rendered ${Array.isArray(inspection.imagePaths) ? inspection.imagePaths.length : 0} timeline inspection frame(s).`, {
      ok: true,
      ...inspection,
    });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error));
  }
}

export async function handleVideoInspectMedia(ctx: SessionToolContext, args: VideoInspectMediaInput): Promise<ToolResult> {
  if (!args.projectPath) return errorResponse('projectPath is required.');
  if (!args.mediaId) return errorResponse('mediaId is required.');
  const projectPathResult = resolveWorkspacePath(ctx, args.projectPath, 'projectPath');
  if (!projectPathResult.ok) return errorResponse(projectPathResult.error);
  const projectPath = projectPathResult.path;
  if (!existsSync(projectPath)) return errorResponse(`Project not found: ${projectPath}`);
  try {
    const project = readProject(projectPath);
    const asset = project.media.find((item) => item.id === args.mediaId);
    if (!asset) return errorResponse(`Media not found in project: ${args.mediaId}`);
    const summary = summarizeMedia(project).find((item) => item.id === asset.id) ?? {};
    const overview = args.overview ? renderMediaOverview(asset, project, projectPath, args) : undefined;
    return ok(`Inspected media "${asset.label}".`, {
      ok: true,
      projectPath,
      media: summary,
      overview,
    });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error));
  }
}

export async function handleVideoProjectSnapshot(ctx: SessionToolContext, args: VideoProjectSnapshotInput): Promise<ToolResult> {
  if (!args.projectPath) return errorResponse('projectPath is required.');
  const projectPathResult = resolveWorkspacePath(ctx, args.projectPath, 'projectPath');
  if (!projectPathResult.ok) return errorResponse(projectPathResult.error);
  const projectPath = projectPathResult.path;
  if (!existsSync(projectPath)) return errorResponse(`Project not found: ${projectPath}`);
  return withVideoProjectLock(projectPath, () => {
    const project = readProject(projectPath);
    const beforeProject = cloneProject(project);
    const snapshotId = randomUUID();
    const label = args.label?.trim() || 'snapshot';
    const snapshotPath = join(snapshotsDir(projectPath), `${Date.now()}-${slugify(label)}-${snapshotId}.runner-video.json`);
    writeJsonAtomic(snapshotPath, project);
    const versionId = addVersion(project, `Saved snapshot ${label}`, ctx, 'video_project_snapshot');
    const undoSnapshotPath = writeProjectWithUndo(projectPath, beforeProject, project, 'video_project_snapshot');
    return ok(`Saved snapshot for "${project.title}".`, {
      ok: true,
      projectPath,
      snapshotId,
      snapshotPath,
      versionId,
      undoSnapshotPath,
      changedClipIds: [],
      warnings: [],
    });
  });
}

export async function handleVideoProjectDiff(ctx: SessionToolContext, args: VideoProjectDiffInput): Promise<ToolResult> {
  if (!args.projectPath) return errorResponse('projectPath is required.');
  const projectPathResult = resolveWorkspacePath(ctx, args.projectPath, 'projectPath');
  if (!projectPathResult.ok) return errorResponse(projectPathResult.error);
  const projectPath = projectPathResult.path;
  if (!existsSync(projectPath)) return errorResponse(`Project not found: ${projectPath}`);
  const snapshotPath = args.snapshotPath ? resolvePath(ctx, args.snapshotPath) : latestUndoSnapshot(projectPath);
  if (!snapshotPath || !existsSync(snapshotPath)) return errorResponse('No snapshot found. Pass snapshotPath or make an edit/snapshot first.');
  if (!isPathInside(dirname(realpathSync(projectPath)), realpathSync(snapshotPath))) return errorResponse(`snapshotPath must be inside the project folder: ${dirname(projectPath)}`);
  const before = readProject(snapshotPath);
  const after = readProject(projectPath);
  const diff = diffProjects(before, after);
  return ok('Computed video project diff.', {
    ok: true,
    projectPath,
    snapshotPath,
    diff,
  });
}

export async function handleVideoProjectUndo(ctx: SessionToolContext, args: VideoProjectUndoInput): Promise<ToolResult> {
  if (!args.projectPath) return errorResponse('projectPath is required.');
  const projectPathResult = resolveWorkspacePath(ctx, args.projectPath, 'projectPath');
  if (!projectPathResult.ok) return errorResponse(projectPathResult.error);
  const projectPath = projectPathResult.path;
  if (!existsSync(projectPath)) return errorResponse(`Project not found: ${projectPath}`);
  return withVideoProjectLock(projectPath, () => {
    const snapshotPath = latestUndoSnapshot(projectPath);
    if (!snapshotPath) {
      const legacyDir = join(dirname(realpathSync(projectPath)), '.runner-video', 'undo');
      if (existsSync(legacyDir) && readdirSync(legacyDir).some(name => name.endsWith('.runner-video.json'))) {
        return errorResponse('No undo snapshot for this project file. Legacy shared-folder history is preserved, but cannot be restored automatically because its original project file is unknown. Recover a verified snapshot as a separate project copy.');
      }
      return errorResponse('No undo snapshot available.');
    }
    const current = readProject(projectPath);
    const restored = readProject(snapshotPath);
    if (restored.id !== current.id) return errorResponse('Undo snapshot belongs to a different project. Nothing was changed; the snapshot has been preserved.');
    const diff = diffProjects(current, restored);
    addVersion(restored, `Undid latest video project edit`, ctx, 'video_project_undo');
    commitProject(projectPath, restored, readContents.get(current) ?? null);
    const cleanup = cleanupRevertedExportFiles(projectPath, current, restored);
    rmSync(snapshotPath, { force: true });
    return ok(`Restored previous video project state for "${restored.title}".`, {
      ok: true,
      projectPath,
      restoredFrom: snapshotPath,
      diff,
      changedClipIds: [
        ...((diff as { addedClipIds?: string[] }).addedClipIds ?? []),
        ...((diff as { removedClipIds?: string[] }).removedClipIds ?? []),
        ...((diff as { changedClipIds?: string[] }).changedClipIds ?? []),
      ],
      removedExportPaths: cleanup.removedPaths,
      warnings: cleanup.warnings,
    });
  });
}

export async function handleVideoProjectCreate(ctx: SessionToolContext, args: VideoProjectCreateInput): Promise<ToolResult> {
  if (!args.title?.trim()) return errorResponse('title is required.');
  const projectPathResult = args.projectPath
    ? resolveWorkspacePath(ctx, args.projectPath, 'projectPath')
    : resolveWorkspacePath(ctx, join(args.projectDir ?? join('.runneros', 'video-projects', `${slugify(args.title)}-${Date.now()}`), 'video.runner-video.json'), 'projectPath');
  if (!projectPathResult.ok) return errorResponse(projectPathResult.error);
  const projectPath = projectPathResult.path;
  return withVideoProjectLock(projectPath, () => {
    if (existsSync(projectPath) && !args.overwrite) {
      return errorResponse(`Video project already exists: ${projectPath}. Pass overwrite: true to replace it.`);
    }
    const project = createProject(args.title, basename(ctx.workspacePath), {
      aspectRatio: args.aspectRatio,
      width: args.width,
      height: args.height,
      fps: args.fps,
    });
    const baseline = existsSync(projectPath) ? readFileSync(projectPath, 'utf-8') : null;
    commitProject(projectPath, project, args.overwrite ? baseline : null);
    return ok(`Created video project "${project.title}" at ${projectPath}.`, {
      ok: true,
      projectPath,
      projectId: project.id,
      versionId: project.versions[0]?.id,
      changedClipIds: [],
      warnings: [],
    });
  });
}

export async function handleVideoProjectUpdate(ctx: SessionToolContext, args: VideoProjectUpdateInput): Promise<ToolResult> {
  if (!args.projectPath) return errorResponse('projectPath is required.');
  const projectPathResult = resolveWorkspacePath(ctx, args.projectPath, 'projectPath');
  if (!projectPathResult.ok) return errorResponse(projectPathResult.error);
  const projectPath = projectPathResult.path;
  if (!existsSync(projectPath)) return errorResponse(`Project not found: ${projectPath}`);
  return withVideoProjectLock(projectPath, () => {
    const project = readProject(projectPath);
    const beforeProject = cloneProject(project);

    if (args.title !== undefined) {
      const title = args.title.trim();
      if (!title) return errorResponse('title must not be empty.');
      project.title = title;
    }
    const preset = args.aspectRatio && args.aspectRatio !== 'custom' ? aspectSettings(args.aspectRatio) : undefined;
    const nextSettings: Partial<{ aspectRatio: AspectRatio; width: number; height: number; fps: number }> = preset
      ? { aspectRatio: preset.aspectRatio, width: preset.width, height: preset.height }
      : args.aspectRatio === 'custom'
        ? { aspectRatio: 'custom' }
        : {};
    if (args.width !== undefined) {
      if (!Number.isFinite(args.width) || args.width <= 0) return errorResponse('width must be a positive number.');
      nextSettings.width = Math.round(args.width);
    }
    if (args.height !== undefined) {
      if (!Number.isFinite(args.height) || args.height <= 0) return errorResponse('height must be a positive number.');
      nextSettings.height = Math.round(args.height);
    }
    if (args.fps !== undefined) {
      if (!Number.isFinite(args.fps) || args.fps <= 0) return errorResponse('fps must be a positive number.');
      nextSettings.fps = Math.round(args.fps);
    }
    project.settings = { ...project.settings, ...nextSettings };
    const width = typeof project.settings.width === 'number' ? project.settings.width : undefined;
    const height = typeof project.settings.height === 'number' ? project.settings.height : undefined;
    project.settings.aspectRatio = normalizeAspectRatio(typeof project.settings.aspectRatio === 'string' ? project.settings.aspectRatio : undefined, width, height);

    const errors = validateProject(project);
    if (errors.length) return errorResponse(errors[0] ?? 'Invalid video project.');
    const versionId = addVersion(project, 'Updated project settings', ctx, 'video_project_update');
    const undoSnapshotPath = writeProjectWithUndo(projectPath, beforeProject, project, 'video_project_update');
    return ok(`Updated video project "${project.title}".`, {
      ok: true,
      projectPath,
      projectId: project.id,
      settings: project.settings,
      versionId,
      undoSnapshotPath,
      changedClipIds: [],
      warnings: [],
    });
  });
}

export async function handleVideoMediaImport(ctx: SessionToolContext, args: VideoMediaImportInput): Promise<ToolResult> {
  if (!args.projectPath) return errorResponse('projectPath is required.');
  if (!args.mediaPath) return errorResponse('mediaPath is required.');
  const projectPathResult = resolveWorkspacePath(ctx, args.projectPath, 'projectPath');
  if (!projectPathResult.ok) return errorResponse(projectPathResult.error);
  const mediaPathResult = resolveWorkspacePath(ctx, args.mediaPath, 'mediaPath');
  if (!mediaPathResult.ok) return errorResponse(mediaPathResult.error);
  const projectPath = projectPathResult.path;
  const mediaPath = mediaPathResult.path;
  if (!existsSync(projectPath)) return errorResponse(`Project not found: ${projectPath}`);
  if (!existsSync(mediaPath)) return errorResponse(`Media file not found: ${mediaPath}`);
  const stats = statSync(mediaPath);
  if (stats.isDirectory()) return errorResponse(`Media path must be a file: ${mediaPath}`);
  return withVideoProjectLock(projectPath, () => {
    const project = readProject(projectPath);
    const beforeProject = cloneProject(project);
    const mediaId = randomUUID();
    const mediaDir = join(dirname(projectPath), 'media');
    const ext = extname(mediaPath);
    const storedMediaPath = join(mediaDir, `${mediaId}${ext}`);
    const mediaType = args.mediaType ?? inferMediaType(mediaPath);
    const captionCues = mediaType === 'caption' ? parseCaptionFile(readFileSync(mediaPath, 'utf-8')) : [];
    if (mediaType === 'caption' && captionCues.length === 0) return errorResponse(`Caption file did not contain any valid cues: ${mediaPath}`);
    mkdirSync(mediaDir, { recursive: true });
    copyFileSync(mediaPath, storedMediaPath);
    const metadata = probeMediaMetadata(storedMediaPath, mediaType);
    const derivatives = generateVideoMediaDerivatives(storedMediaPath, mediaType, metadata, {
      thumbnailPath: join(dirname(projectPath), 'thumbnails', `${mediaId}.jpg`),
      waveformPath: join(dirname(projectPath), 'waveforms', `${mediaId}.png`),
    });
    const media = {
      id: mediaId,
      type: mediaType,
      label: args.label?.trim() || basename(mediaPath),
      path: storedMediaPath,
      ...metadata,
      ...derivatives,
      originalPath: mediaPath,
      source: { kind: 'user-import' },
    };
    project.media.push(media);
    const changedClipIds = mediaType === 'caption' ? addCaptionCuesToProject(project, media.label, captionCues) : [];
    const versionId = addVersion(project, `Imported media ${media.label}`, ctx, 'video_media_import');
    const undoSnapshotPath = writeProjectWithUndo(projectPath, beforeProject, project, 'video_media_import');
    return ok(`Imported media "${media.label}" into ${project.title}.`, {
      ok: true,
      projectPath,
      mediaId: media.id,
      media,
      captionCueCount: captionCues.length,
      versionId,
      undoSnapshotPath,
      changedClipIds,
      warnings: [],
    });
  });
}

export async function handleVideoClipAdd(ctx: SessionToolContext, args: VideoClipAddInput): Promise<ToolResult> {
  if (!args.projectPath) return errorResponse('projectPath is required.');
  const projectPathResult = resolveWorkspacePath(ctx, args.projectPath, 'projectPath');
  if (!projectPathResult.ok) return errorResponse(projectPathResult.error);
  const projectPath = projectPathResult.path;
  if (!existsSync(projectPath)) return errorResponse(`Project not found: ${projectPath}`);
  return withVideoProjectLock(projectPath, () => {
    const project = readProject(projectPath);
    const beforeProject = cloneProject(project);
    const media = args.mediaId ? project.media.find((asset) => asset.id === args.mediaId) : undefined;
    if (args.mediaId && !media) return errorResponse(`Media not found in project: ${args.mediaId}`);
    const clipType = args.type ?? (media?.type === 'audio' ? 'audio' : media?.type === 'image' ? 'image' : media?.type === 'caption' ? 'caption' : args.text ? 'text' : 'text');
    if (!media && ['video', 'audio', 'image'].includes(clipType)) {
      return errorResponse(`${clipType} clips require a mediaId. Use type: "text" for generated title/text clips.`);
    }
    const durationMs = args.durationMs ?? (clipType === 'image' || clipType === 'text' ? 3000 : 1000);
    if (durationMs <= 0) return errorResponse('durationMs must be positive.');
    const startMs = args.startMs ?? project.timeline.durationMs;
    if (startMs < 0) return errorResponse('startMs must be non-negative.');
    const track = chooseTrack(project, media?.type ?? (clipType === 'audio' ? 'audio' : clipType === 'caption' ? 'caption' : 'video'), args.trackId);
    if (track.locked) return errorResponse(lockedTrackError(track));
    const clip: VideoProject['timeline']['tracks'][number]['clips'][number] = {
      id: randomUUID(),
      mediaId: media?.id,
      type: clipType,
      startMs,
      durationMs,
      sourceInMs: args.sourceInMs,
      sourceOutMs: args.sourceOutMs,
      label: args.label?.trim() || media?.label || clipType,
      ...(args.text ? { text: { text: args.text, fontSize: 64, color: '#ffffff' } } : {}),
    };
    const settingsError = applyClipSettings(clip, args);
    if (settingsError) return errorResponse(settingsError);
    track.clips.push(clip);
    project.timeline.durationMs = Math.max(project.timeline.durationMs, startMs + durationMs);
    const errors = validateProject(project);
    if (errors.length) return errorResponse(errors[0] ?? 'Invalid video project.');
    const versionId = addVersion(project, `Added ${clip.label} clip`, ctx, 'video_clip_add');
    const undoSnapshotPath = writeProjectWithUndo(projectPath, beforeProject, project, 'video_clip_add');
    return ok(`Added clip "${clip.label}" to track "${track.label}".`, {
      ok: true,
      projectPath,
      clipId: clip.id,
      trackId: track.id,
      versionId,
      undoSnapshotPath,
      changedClipIds: [clip.id],
      warnings: [],
    });
  });
}

export async function handleVideoClipEdit(ctx: SessionToolContext, args: VideoClipEditInput): Promise<ToolResult> {
  if (!args.projectPath) return errorResponse('projectPath is required.');
  const projectPathResult = resolveWorkspacePath(ctx, args.projectPath, 'projectPath');
  if (!projectPathResult.ok) return errorResponse(projectPathResult.error);
  const projectPath = projectPathResult.path;
  if (!existsSync(projectPath)) return errorResponse(`Project not found: ${projectPath}`);
  return withVideoProjectLock(projectPath, () => {
    const project = readProject(projectPath);
    const beforeProject = cloneProject(project);
    let trackId: string | undefined;
    let clipId: string | undefined = args.clipId;
    let label = args.clipId;
    let startMs: number | undefined;
    let durationMs: number | undefined;
    let createdClipId: string | undefined;
    let deletedClipId: string | undefined;
    let changed = 0;

    if (args.action === 'pack') {
      changed = packTimeline(project);
      label = 'timeline';
    } else {
      if (!args.clipId) return errorResponse('clipId is required for this action.');
      const found = findClip(project, args.clipId);
      if (!found) return errorResponse(`Clip not found: ${args.clipId}`);
      const { track, clip } = found;
      trackId = track.id;
      label = typeof clip.label === 'string' ? clip.label : clip.id;
      if (track.locked) return errorResponse(lockedTrackError(track));

      if (args.action === 'move') {
        if (typeof args.startMs !== 'number' || !Number.isFinite(args.startMs) || args.startMs < 0) return errorResponse('startMs must be a non-negative number.');
        clip.startMs = args.snap ? snapClipStart(track, clip.id, args.startMs) : Math.max(0, Math.round(args.startMs));
        track.clips = orderedClips(track.clips);
        startMs = clip.startMs;
        durationMs = clip.durationMs;
      } else if (args.action === 'trim') {
        if (typeof args.durationMs !== 'number' || !Number.isFinite(args.durationMs) || args.durationMs <= 0) return errorResponse('durationMs must be a positive number.');
        const initialClip = { ...clip };
        let trimmedClip = clip;
        if (args.ripple) {
          const result = rippleTrimEnd(track, clip.id, args.durationMs);
          if (!result) return errorResponse(`Clip not found: ${args.clipId}`);
          trimmedClip = track.clips.find((item) => item.id === clip.id) ?? clip;
          startMs = result.startMs;
          durationMs = result.durationMs;
        } else {
          clip.durationMs = Math.max(1, Math.round(args.durationMs));
          startMs = clip.startMs;
          durationMs = clip.durationMs;
        }
        if (args.sourceInMs !== undefined) {
          if (!Number.isFinite(args.sourceInMs) || args.sourceInMs < 0) return errorResponse('sourceInMs must be a non-negative number.');
          trimmedClip.sourceInMs = Math.round(args.sourceInMs);
        }
        if (args.sourceOutMs !== undefined) {
          if (!Number.isFinite(args.sourceOutMs) || args.sourceOutMs < 0) return errorResponse('sourceOutMs must be a non-negative number.');
          trimmedClip.sourceOutMs = Math.round(args.sourceOutMs);
        }
        const sourceMaximum = maximumClipDurationMs(trimmedClip, project.media.find(item => item.id === trimmedClip.mediaId));
        if (trimmedClip.durationMs > sourceMaximum) return errorResponse(`Trim duration exceeds available source media (${Math.floor(sourceMaximum)} ms at this speed). No changes were saved.`);
        const metadataOffset = args.sourceInMs === undefined ? 0 : ((trimmedClip.sourceInMs as number) - (typeof initialClip.sourceInMs === 'number' ? initialClip.sourceInMs : 0)) / clipSpeed(initialClip);
        const sliced = sliceVideoClipMetadata(initialClip, metadataOffset, trimmedClip.durationMs);
        trimmedClip.keyframes = sliced.keyframes;
        trimmedClip.captionSource = sliced.captionSource;
      } else if (args.action === 'split') {
        if (typeof args.atMs !== 'number' || !Number.isFinite(args.atMs) || args.atMs < 0) return errorResponse('atMs must be a non-negative number.');
        const splitAt = Math.round(args.atMs);
        if (splitAt <= clip.startMs || splitAt >= clip.startMs + clip.durationMs) return errorResponse('atMs must be inside the clip bounds.');
        const firstDuration = splitAt - clip.startMs;
        const secondDuration = clip.durationMs - firstDuration;
        const sourceInMs = typeof clip.sourceInMs === 'number' ? clip.sourceInMs : 0;
        const sourceSplitMs = sourceInMs + firstDuration * clipSpeed(clip);
        const secondClip = {
          ...sliceVideoClipMetadata(clip, firstDuration, secondDuration),
          id: randomUUID(),
          startMs: splitAt,
          durationMs: secondDuration,
          sourceInMs: sourceSplitMs,
          label: typeof clip.label === 'string' ? `${clip.label} split` : undefined,
        };
        Object.assign(clip, sliceVideoClipMetadata(clip, 0, firstDuration));
        if (clip.sourceOutMs !== undefined) clip.sourceOutMs = sourceSplitMs;
        const index = track.clips.findIndex((item) => item.id === clip.id);
        track.clips.splice(index + 1, 0, secondClip);
        createdClipId = secondClip.id;
        startMs = clip.startMs;
        durationMs = clip.durationMs;
      } else if (args.action === 'delete') {
        const deletedStartMs = clip.startMs;
        const deletedDurationMs = clip.durationMs;
        track.clips = track.clips.filter((item) => item.id !== clip.id);
        if (args.ripple) {
          track.clips = track.clips.map((item) => item.startMs >= deletedStartMs + deletedDurationMs ? {
            ...item,
            startMs: Math.max(0, item.startMs - deletedDurationMs),
          } : item);
        }
        deletedClipId = clip.id;
        clipId = undefined;
      } else if (args.action === 'duplicate') {
        const newClip = {
          ...clip,
          id: randomUUID(),
          startMs: clip.startMs + Math.max(1, clip.durationMs),
          label: typeof clip.label === 'string' ? `${clip.label} copy` : undefined,
        };
        for (let index = 0; index < track.clips.length; index += 1) {
          const item = track.clips[index];
          if (item && item.id !== clip.id && item.startMs >= newClip.startMs) {
            track.clips[index] = { ...item, startMs: item.startMs + Math.max(1, clip.durationMs) };
          }
        }
        track.clips.push(newClip);
        track.clips = orderedClips(track.clips);
        createdClipId = newClip.id;
        clipId = newClip.id;
        startMs = newClip.startMs;
        durationMs = newClip.durationMs;
      } else if (args.action === 'settings') {
        const settingsError = applyClipSettings(clip, args);
        if (settingsError) return errorResponse(settingsError);
        startMs = clip.startMs;
        durationMs = clip.durationMs;
      } else {
        return errorResponse('Unknown video clip edit action.');
      }
    }

    project.timeline.durationMs = timelineDuration(project.timeline.tracks);
    const errors = validateProject(project);
    if (errors.length) return errorResponse(errors[0] ?? 'Invalid video project.');
    const actionLabel = args.action[0]!.toUpperCase() + args.action.slice(1);
    const versionId = addVersion(project, `${actionLabel} ${label ?? 'clip'}${args.action === 'pack' ? '' : ' clip'}`, ctx, 'video_clip_edit');
    const undoSnapshotPath = writeProjectWithUndo(projectPath, beforeProject, project, 'video_clip_edit');
    return ok(`Applied ${args.action} edit to "${label ?? 'timeline'}".`, {
      ok: true,
      projectPath,
      clipId,
      createdClipId,
      deletedClipId,
      changed,
      trackId,
      startMs,
      durationMs,
      versionId,
      undoSnapshotPath,
      changedClipIds: [clipId, createdClipId, deletedClipId].filter(Boolean),
      warnings: [],
    });
  });
}

export async function handleVideoClipAdjust(ctx: SessionToolContext, args: VideoClipAdjustInput): Promise<ToolResult> {
  if (!args.projectPath) return errorResponse('projectPath is required.');
  try { validateColorAdjustments({ ...args, pipeline: 'rgb-v1' }); }
  catch (error) { return errorResponse(`Invalid color adjustments: ${error instanceof Error ? error.message : String(error)}`); }
  if ((args.clipId !== undefined) === (args.clipIds !== undefined)) return errorResponse('Supply exactly one of clipId or clipIds.');
  const ids = args.clipIds ?? [args.clipId!];
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 32 || ids.some(id => typeof id !== 'string' || !id.trim()) || new Set(ids).size !== ids.length) return errorResponse('clipIds must contain 1–32 distinct nonempty clip ids.');
  if (args.removeLut && (args.lutCube !== undefined || args.lutIntensity !== undefined)) return errorResponse('removeLut cannot combine with lutCube or lutIntensity.');
  if (args.lutName !== undefined && (typeof args.lutName !== 'string' || args.lutName.length > 200 || args.lutCube === undefined)) return errorResponse('lutName requires lutCube and must be at most 200 characters.');
  if (args.lutIntensity !== undefined && (!Number.isFinite(args.lutIntensity) || args.lutIntensity < 0 || args.lutIntensity > 1)) return errorResponse('lutIntensity must be between 0 and 1.');
  if (args.reset && (args.lutCube !== undefined || args.lutIntensity !== undefined || args.removeLut || args.preset || hasExplicitAdjustmentInput(args))) return errorResponse('reset cannot combine with adjustment fields.');
  let importedLut: ReturnType<typeof parseCubeLut> | undefined;
  if (args.lutCube !== undefined) {
    if (typeof args.lutCube !== 'string' || Buffer.byteLength(args.lutCube, 'utf8') > 2_000_000) return errorResponse('lutCube must be text no larger than 2 MB.');
    try { importedLut = parseCubeLut(args.lutCube, args.lutName); }
    catch (error) { return errorResponse(`Invalid LUT: ${error instanceof Error ? error.message : String(error)}`); }
  }
  const projectPathResult = resolveWorkspacePath(ctx, args.projectPath, 'projectPath');
  if (!projectPathResult.ok) return errorResponse(projectPathResult.error);
  const projectPath = projectPathResult.path;
  if (!existsSync(projectPath)) return errorResponse(`Project not found: ${projectPath}`);
  return withVideoProjectLock(projectPath, () => {
    const project = readProject(projectPath);
    const beforeProject = cloneProject(project);
    const targets: Array<NonNullable<ReturnType<typeof findClip>>> = [];
    const warnings: string[] = [];
    for (const id of ids) {
      const found = findClip(project, id);
      if (!found) return errorResponse(`Clip not found: ${id}`);
      if (found.track.locked) return errorResponse(lockedTrackError(found.track));
      const media = project.media.find(asset => asset.id === found.clip.mediaId);
      if (!media || !['video', 'image'].includes(media.type) || !['video', 'image'].includes(found.clip.type)) return errorResponse(`Clip "${id}" is not a video or image clip that can render look adjustments.`);
      targets.push(found);
    }
    const preset = args.preset ? ADJUSTMENT_PRESETS[args.preset] : undefined;
    if (args.preset && !preset) return errorResponse(`Unknown adjustment preset: ${args.preset}`);
    for (const { clip } of targets) {
      if (args.reset) { delete clip.adjustments; continue; }
      const base = args.preset ? { ...preset, lut: clip.adjustments?.lut } : { ...clip.adjustments };
      const next = sanitizedAdjustments({
        ...base,
        exposure: args.exposure ?? base.exposure, contrast: args.contrast ?? base.contrast,
        saturation: args.saturation ?? base.saturation, highlights: args.highlights ?? base.highlights,
        shadows: args.shadows ?? base.shadows, temperature: args.temperature ?? base.temperature,
        tint: args.tint ?? base.tint, sharpen: args.sharpen ?? base.sharpen,
        vignette: args.vignette ?? base.vignette, grain: args.grain ?? base.grain,
        preset: hasExplicitAdjustmentInput(args) || importedLut || args.lutIntensity !== undefined ? 'manual' : args.preset ?? base.preset,
      });
      next.lut = importedLut ?? base.lut;
      if (args.removeLut) delete next.lut;
      if (args.lutIntensity !== undefined && !next.lut) return errorResponse(`Clip "${clip.id}" has no LUT to adjust.`);
      if (next.lut) next.lut = { ...next.lut, intensity: args.lutIntensity ?? (importedLut ? 1 : next.lut.intensity ?? 1) };
      const hasLegacyEffects = [next.grain, next.sharpen, next.vignette].some(value => (value ?? 0) !== 0);
      if (hasLegacyEffects) warnings.push(`Clip "${clip.id}" has grain, sharpen or vignette; render to review these effects.`);
      const changesColor = [args.exposure, args.contrast, args.saturation, args.highlights, args.shadows, args.temperature, args.tint].some(value => value !== undefined)
        || args.preset !== undefined || args.lutCube !== undefined || args.lutIntensity !== undefined || args.removeLut;
      if (base.pipeline === 'rgb-v1' || next.lut || changesColor) next.pipeline = 'rgb-v1';
      try { validateColorAdjustments(next); }
      catch (error) { return errorResponse(`Invalid color adjustments: ${error instanceof Error ? error.message : String(error)}`); }
      clip.adjustments = next;
    }
    const errors = validateProject(project);
    if (errors.length) return errorResponse(errors[0] ?? 'Invalid video project.');
    const versionId = addVersion(project, `${args.reset ? 'Reset' : 'Adjusted'} ${targets.length} clip look${targets.length === 1 ? '' : 's'}`, ctx, 'video_clip_adjust');
    try { validateColorProjectBudget(project); }
    catch (error) { return errorResponse(error instanceof Error ? error.message : 'Project exceeds the embedded LUT size budget.'); }
    const undoSnapshotPath = writeProjectWithUndo(projectPath, beforeProject, project, 'video_clip_adjust');
    const first = targets[0]!;
    return ok(`${args.reset ? 'Reset' : 'Applied'} adjustments for ${targets.length} clip${targets.length === 1 ? '' : 's'}.`, {
      ok: true, projectPath,
      ...(targets.length === 1 ? { clipId: first.clip.id, trackId: first.track.id, adjustments: summarizeAdjustments(first.clip.adjustments) } : {}),
      clips: targets.map(({ clip, track }) => ({ clipId: clip.id, trackId: track.id, adjustments: summarizeAdjustments(clip.adjustments) })),
      versionId, undoSnapshotPath, changedClipIds: ids, warnings,
    });
  });
}

export async function handleVideoClipTransform(ctx: SessionToolContext, args: VideoClipTransformInput): Promise<ToolResult> {
  if (!args.projectPath) return errorResponse('projectPath is required.');
  if (!args.clipId) return errorResponse('clipId is required.');
  const projectPathResult = resolveWorkspacePath(ctx, args.projectPath, 'projectPath');
  if (!projectPathResult.ok) return errorResponse(projectPathResult.error);
  const projectPath = projectPathResult.path;
  if (!existsSync(projectPath)) return errorResponse(`Project not found: ${projectPath}`);
  return withVideoProjectLock(projectPath, () => {
    const project = readProject(projectPath);
    const beforeProject = cloneProject(project);
    const found = findClip(project, args.clipId);
    if (!found) return errorResponse(`Clip not found: ${args.clipId}`);
    const { clip, track } = found;
    if (track.locked) return errorResponse(lockedTrackError(track));
    const media = clip.mediaId ? project.media.find((asset) => asset.id === clip.mediaId) : undefined;
    if (!media || !['video', 'image'].includes(media.type)) {
      return errorResponse(`Clip "${clip.label ?? clip.id}" is not a video or image clip that can use transform/crop/opacity rendering.`);
    }

    const inputError = sanitizeTransformInput(project, clip, args);
    if (inputError) return errorResponse(inputError);

    const errors = validateProject(project);
    if (errors.length) return errorResponse(errors[0] ?? 'Invalid video project.');
    const versionId = addVersion(project, `Transformed ${clip.label ?? clip.id} clip`, ctx, 'video_clip_transform');
    const undoSnapshotPath = writeProjectWithUndo(projectPath, beforeProject, project, 'video_clip_transform');
    return ok(`Applied transform to clip "${clip.label ?? clip.id}".`, {
      ok: true,
      projectPath,
      clipId: clip.id,
      trackId: track.id,
      transform: clip.transform,
      crop: clip.crop,
      opacity: clip.opacity,
      keyframes: clip.keyframes,
      versionId,
      undoSnapshotPath,
      changedClipIds: [clip.id],
      warnings: [],
    });
  });
}

export async function handleVideoExport(ctx: SessionToolContext, args: VideoExportInput): Promise<ToolResult> {
  if (!args.projectPath) return errorResponse('projectPath is required.');
  const projectPathResult = resolveWorkspacePath(ctx, args.projectPath, 'projectPath');
  if (!projectPathResult.ok) return errorResponse(projectPathResult.error);
  const projectPath = projectPathResult.path;
  if (!existsSync(projectPath)) return errorResponse(`Project not found: ${projectPath}`);
  const outputPathResult = resolveWorkspacePath(ctx, args.outputPath ?? join(dirname(projectPath), 'renders', 'preview.placeholder.txt'), 'outputPath');
  if (!outputPathResult.ok) return errorResponse(outputPathResult.error);
  const outputPath = outputPathResult.path;
  return withVideoProjectLock(projectPath, async () => {
    const project = readProject(projectPath);
    const beforeProject = cloneProject(project);
    const createdAt = new Date().toISOString();
    const realVideo = isVideoOutputPath(outputPath);
    const receiptPath = `${outputPath}.receipt.json`;
    const preset = resolveExportPreset(project, args.preset, realVideo);
    if (preset.error || !preset.settings) return errorResponse(preset.error ?? 'Invalid export preset.');
    try {
      assertSafeVideoExportPaths(projectPath, project.media, outputPath);
    } catch (error) {
      return errorResponse(error instanceof Error ? error.message : String(error));
    }
    mkdirSync(dirname(outputPath), { recursive: true });
    if (realVideo) {
      try {
        renderSimpleMp4(project, outputPath, preset.settings);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        writeJsonAtomic(receiptPath, {
          ok: false,
          placeholder: false,
          rendered: false,
          projectPath,
          outputPath,
          preset: preset.settings.slug,
          width: preset.settings.width,
          height: preset.settings.height,
          fps: preset.settings.fps,
          createdAt,
          error: message,
        });
        project.exports.push({
          id: randomUUID(),
          createdAt,
          status: 'failed',
          path: outputPath,
          preset: preset.settings.slug,
          placeholder: false,
          error: message,
          receiptPath,
        });
        addVersion(project, `Failed export ${basename(outputPath)}`, ctx, 'video_export');
        writeProjectWithUndo(projectPath, beforeProject, project, 'video_export_failed');
        return errorResponse(`${message} Receipt: ${receiptPath}`);
      }
    } else {
      writeFileSync(outputPath, [
        'RunnerOS Video Studio placeholder export',
        `Project: ${project.title}`,
        `Project ID: ${project.id}`,
        `Created: ${createdAt}`,
        'This is not a playable MP4. Use an .mp4 output path for the simple FFmpeg renderer.',
        '',
      ].join('\n'), 'utf-8');
    }
    writeJsonAtomic(receiptPath, {
      ok: true,
      placeholder: !realVideo,
      rendered: realVideo,
      projectPath,
      outputPath,
      preset: preset.settings.slug,
      width: preset.settings.width,
      height: preset.settings.height,
      fps: preset.settings.fps,
      createdAt,
    });
    project.exports.push({
      id: randomUUID(),
      createdAt,
      status: 'succeeded',
      path: outputPath,
      preset: preset.settings.slug,
      placeholder: !realVideo,
      receiptPath,
    });
    const versionId = addVersion(project, `Exported ${realVideo ? 'video' : 'placeholder'} ${basename(outputPath)}`, ctx, 'video_export');
    const undoSnapshotPath = writeProjectWithUndo(projectPath, beforeProject, project, 'video_export');

    let outputId: string | undefined;
    if (args.publishOutput && ctx.createOutput) {
      const result = await ctx.createOutput({
        title: `${project.title} ${realVideo ? 'video export' : 'placeholder export'}`,
        kind: realVideo ? 'video' : 'receipt',
        summary: realVideo ? 'Video Studio simple MP4 render.' : 'Placeholder Video Studio export receipt.',
        files: [
          { path: outputPath, label: basename(outputPath), role: realVideo ? 'primary' : 'supporting' },
          { path: receiptPath, label: basename(receiptPath), role: realVideo ? 'supporting' : 'primary' },
          { path: projectPath, label: basename(projectPath), role: 'source' },
        ],
        receipts: [{
          provider: 'runner-video-studio',
          action: realVideo ? 'simple-mp4-export' : 'placeholder-export',
          status: 'succeeded',
          displayText: realVideo ? 'Playable MP4 export created.' : 'Placeholder export created.',
          metadata: { projectId: project.id, placeholder: !realVideo, rendered: realVideo },
        }],
        tags: ['video-studio', realVideo ? 'video-export' : 'placeholder-export'],
        showInCanvas: args.showInCanvas,
      });
      outputId = result.outputId;
    }

    return ok(`${realVideo ? 'Rendered video' : 'Created placeholder export'} at ${outputPath}.`, {
      ok: true,
      projectPath,
      outputPath,
      receiptPath,
      placeholder: !realVideo,
      rendered: realVideo,
      preset: preset.settings.slug,
      width: preset.settings.width,
      height: preset.settings.height,
      fps: preset.settings.fps,
      versionId,
      undoSnapshotPath,
      outputId,
      changedClipIds: [],
      warnings: [],
    });
  });
}
