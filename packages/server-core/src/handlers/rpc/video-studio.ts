import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { RPC_CHANNELS } from '@craft-agent/shared/protocol';
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config';
import { getVideoStudioSource } from '@craft-agent/shared/sources';
import { readVideoProject, writeVideoProject, type RunnerVideoProject, type VideoMediaType, type VideoTrackType } from '@craft-agent/shared/video';
import { writeOutputManifest, type OutputAsset, type OutputManifest } from '@craft-agent/shared/outputs';
import type { RpcServer } from '@craft-agent/server-core/transport';
import { requestClientOpenFileDialog } from '@craft-agent/server-core/transport';
import { sanitizeFilename } from '@craft-agent/server-core/handlers';
import type { HandlerDeps } from '../handler-deps';
import { OutputService, pushOutputsUpdated } from '../../outputs/OutputService';

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.videoStudio.IMPORT_MEDIA,
  RPC_CHANNELS.videoStudio.INSPECT,
  RPC_CHANNELS.videoStudio.DRY_RUN,
  RPC_CHANNELS.videoStudio.EXPORT,
  RPC_CHANNELS.videoStudio.RUN_AGENT,
] as const;

interface VideoStudioImportResult {
  ok: boolean;
  outputId: string;
  imported: Array<{ mediaId: string; assetId: string; label: string; type: string; path: string }>;
  skipped: number;
  projectAssetId: string;
}

interface VideoStudioExportResult {
  ok: boolean;
  outputId: string;
  assetId: string;
  receiptAssetId: string;
  outputPath: string;
  receiptPath: string;
  rendered: boolean;
}

interface VideoStudioReportResult {
  ok: boolean;
  outputId: string;
  command: 'inspect' | 'dry-run';
  assetId: string;
  reportPath: string;
  status: number;
  report: unknown;
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

// Renderer-supplied export preset is passed to the CLI; constrain to a known set.
const ALLOWED_VIDEO_EXPORT_PRESETS = new Set([
  'simple-mp4',
  'placeholder',
  'mp4-16x9-1080p',
  'mp4-9x16-1080x1920',
  'mp4-1x1-1080',
  'mp4-4x5-1080x1350',
  'mp4-source-size',
]);
const videoProjectLocks = new Map<string, Promise<void>>();

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

function resolveRootPath(workspaceId: string): string {
  const workspace = getWorkspaceByNameOrId(workspaceId);
  if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`);
  return workspace.rootPath;
}

function assertLocalWorkspace(workspaceId: string, action: string): void {
  const workspace = getWorkspaceByNameOrId(workspaceId);
  if (workspace?.remoteServer) throw new Error(`${action} is not available for remote workspaces`);
}

function serviceFor(server: RpcServer): OutputService {
  return new OutputService({
    getWorkspaceRootPath: resolveRootPath,
    emitOutputsUpdated: (workspaceId) => pushOutputsUpdated(server, workspaceId),
  });
}

function videoProjectAsset(output: OutputManifest): OutputAsset {
  const asset = output.assets.find((item) => item.path.toLowerCase().endsWith('.runner-video.json'));
  if (!asset) throw new Error(`Output "${output.id}" does not include a Video Studio project file.`);
  return asset;
}

// Delegate to the shared storage layer so the RPC path gets schema migration,
// malformed-file backup/recovery, and durable (fsync) atomic writes.
function readProject(path: string): RunnerVideoProject {
  return readVideoProject(path);
}

function writeProject(path: string, project: RunnerVideoProject): void {
  writeVideoProject(path, project);
}

function fileMetadata(path: string): Pick<OutputAsset, 'mimeType' | 'sizeBytes' | 'sha256'> {
  const stats = statSync(path);
  const buffer = readFileSync(path);
  return {
    mimeType: mimeTypeForPath(path),
    sizeBytes: stats.size,
    sha256: createHash('sha256').update(buffer).digest('hex'),
  };
}

function inferMediaType(path: string): VideoMediaType {
  const ext = extname(path).toLowerCase();
  if (['.mp4', '.mov', '.m4v', '.webm'].includes(ext)) return 'video';
  if (['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg'].includes(ext)) return 'audio';
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.bmp'].includes(ext)) return 'image';
  if (['.srt', '.vtt'].includes(ext)) return 'caption';
  if (ext === '.svg') return 'svg';
  if (ext === '.json' || ext === '.lottie') return 'lottie';
  if (ext === '.html' || ext === '.htm') return 'html';
  return 'unknown';
}

function isImportableMediaType(type: VideoMediaType): boolean {
  return type === 'video' || type === 'audio' || type === 'image';
}

export function collectImportableVideoStudioFiles(paths: string[], maxFiles = 500): { files: string[]; skipped: number } {
  const files: string[] = [];
  let skipped = 0;
  const visit = (path: string): void => {
    if (files.length >= maxFiles) {
      skipped += 1;
      return;
    }
    if (!existsSync(path)) {
      skipped += 1;
      return;
    }
    const stats = statSync(path);
    if (stats.isDirectory()) {
      for (const entry of readdirSync(path)) visit(join(path, entry));
      return;
    }
    if (!stats.isFile()) {
      skipped += 1;
      return;
    }
    if (!isImportableMediaType(inferMediaType(path))) {
      skipped += 1;
      return;
    }
    files.push(path);
  };
  for (const path of paths) visit(path);
  return { files, skipped };
}

function mimeTypeForPath(path: string): string | undefined {
  const ext = extname(path).toLowerCase();
  if (ext === '.mp4' || ext === '.m4v') return 'video/mp4';
  if (ext === '.mov') return 'video/quicktime';
  if (ext === '.webm') return 'video/webm';
  if (ext === '.mp3') return 'audio/mpeg';
  if (ext === '.wav') return 'audio/wav';
  if (ext === '.m4a') return 'audio/mp4';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.json') return 'application/json';
  return undefined;
}

function trackTypeForMedia(mediaType: VideoMediaType): VideoTrackType {
  if (mediaType === 'audio') return 'audio';
  if (mediaType === 'caption') return 'caption';
  if (mediaType === 'image') return 'image';
  return 'video';
}

function preferredTrackId(mediaType: VideoMediaType): string {
  if (mediaType === 'audio') return 'audio-main';
  if (mediaType === 'caption') return 'captions-main';
  return 'video-main';
}

function ensureTrack(project: RunnerVideoProject, mediaType: VideoMediaType): RunnerVideoProject['timeline']['tracks'][number] {
  const id = preferredTrackId(mediaType);
  const found = project.timeline.tracks.find((track) => track.id === id);
  if (found) return found;
  const created = { id, type: trackTypeForMedia(mediaType), label: mediaType === 'audio' ? 'Audio' : mediaType === 'caption' ? 'Captions' : 'Video', clips: [] };
  project.timeline.tracks.push(created);
  return created;
}

function defaultClipDuration(mediaType: VideoMediaType): number {
  if (mediaType === 'image') return 3000;
  if (mediaType === 'caption') return 3000;
  if (mediaType === 'audio') return 5000;
  return 5000;
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

export function probeMediaMetadata(path: string, mediaType: VideoMediaType = inferMediaType(path)): VideoMediaProbeMetadata {
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

export function clipDurationForImport(path: string, mediaType: VideoMediaType): number {
  if (mediaType === 'video' || mediaType === 'audio') {
    return probeMediaMetadata(path, mediaType).durationMs ?? defaultClipDuration(mediaType);
  }
  return defaultClipDuration(mediaType);
}

function addVersion(project: RunnerVideoProject, summary: string, actor: 'user' | 'agent' | 'system' = 'user'): string {
  const now = new Date().toISOString();
  const versionId = randomUUID();
  project.updatedAt = now;
  project.versions.push({ id: versionId, createdAt: now, summary, actor });
  return versionId;
}

function relativeAssetPath(root: string, outputId: string, absolutePath: string): string {
  return relative(join(root, 'outputs', outputId), absolutePath).replace(/\\/g, '/');
}

function mergeAssetsById(existing: OutputAsset[], next: OutputAsset[]): OutputAsset[] {
  const merged = new Map<string, OutputAsset>();
  for (const asset of existing) merged.set(asset.id, asset);
  for (const asset of next) merged.set(asset.id, asset);
  return Array.from(merged.values());
}

function addAssetToOutput(server: RpcServer, workspaceId: string, outputId: string, asset: OutputAsset): void {
  const service = serviceFor(server);
  const root = resolveRootPath(workspaceId);
  const latestOutput = service.get(workspaceId, outputId);
  if (!latestOutput) throw new Error(`Output not found: ${outputId}`);
  writeOutputManifest(root, {
    ...latestOutput,
    updatedAt: new Date().toISOString(),
    assets: mergeAssetsById(latestOutput.assets, [asset]),
  });
  pushOutputsUpdated(server, workspaceId);
}

function videoStudioCli(workspaceId: string): string {
  const workspace = getWorkspaceByNameOrId(workspaceId);
  const root = workspace?.rootPath ?? process.cwd();
  const source = getVideoStudioSource(workspaceId, root);
  return join(source.folderPath, 'bin', 'video-studio.mjs');
}

function parseJsonOutput(stdout: string, fallback: Record<string, unknown>): unknown {
  try {
    return JSON.parse(stdout);
  } catch {
    return fallback;
  }
}

async function runVideoStudioReport(server: RpcServer, workspaceId: string, outputId: string, command: 'inspect' | 'dry-run'): Promise<VideoStudioReportResult> {
  assertLocalWorkspace(workspaceId, `${command === 'inspect' ? 'Inspect' : 'Dry-run'} Video Studio project`);
  const service = serviceFor(server);
  const root = resolveRootPath(workspaceId);
  const output = service.get(workspaceId, outputId);
  if (!output) throw new Error(`Output not found: ${outputId}`);
  const projectAsset = videoProjectAsset(output);
  const projectPath = service.resolveAssetPath(workspaceId, outputId, projectAsset.path);
  return withVideoProjectLock(projectPath, () => {
    const cliPath = videoStudioCli(workspaceId);
    if (!existsSync(cliPath)) throw new Error(`Video Studio CLI not found: ${cliPath}`);
    const child = spawnSync('node', [cliPath, command, projectPath, '--json'], {
      encoding: 'utf-8',
      cwd: dirname(projectPath),
    });
    const report = parseJsonOutput(child.stdout, {
      ok: false,
      error: child.stderr || child.stdout || `Video Studio ${command} failed.`,
      status: child.status ?? 1,
    });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportName = command === 'inspect' ? 'video-inspect' : 'video-dry-run';
    const reportAssetPath = `reports/${reportName}-${stamp}.json`;
    const reportPath = service.resolveAssetPath(workspaceId, outputId, reportAssetPath);
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, `${JSON.stringify({
      command,
      status: child.status ?? 1,
      stdout: child.stdout,
      stderr: child.stderr,
      report,
    }, null, 2)}\n`, 'utf-8');
    const assetId = `video-${reportName}-${stamp}`;
    const reportAsset: OutputAsset = {
      id: assetId,
      label: basename(reportPath),
      role: 'supporting',
      path: relativeAssetPath(root, outputId, reportPath),
      ...fileMetadata(reportPath),
    };
    addAssetToOutput(server, workspaceId, outputId, reportAsset);
    return {
      ok: child.status === 0,
      outputId,
      command,
      assetId,
      reportPath,
      status: child.status ?? 1,
      report,
    };
  });
}

export function registerVideoStudioHandlers(server: RpcServer, _deps: HandlerDeps): void {
  server.handle(
    RPC_CHANNELS.videoStudio.IMPORT_MEDIA,
    async (ctx, workspaceId: string, outputId: string, options?: { mode?: 'files' | 'folder' }): Promise<VideoStudioImportResult> => {
      assertLocalWorkspace(workspaceId, 'Import Video Studio media');
      const mode = options?.mode === 'folder' ? 'folder' : 'files';
      const result = await requestClientOpenFileDialog(server, ctx.clientId, {
        properties: mode === 'folder' ? ['openDirectory'] : ['openFile', 'multiSelections'],
        filters: [
          { name: 'Media', extensions: ['mp4', 'mov', 'm4v', 'webm', 'mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });
      if (result.canceled || result.filePaths.length === 0) {
        return { ok: true, outputId, imported: [], skipped: 0, projectAssetId: '' };
      }

      const service = serviceFor(server);
      const root = resolveRootPath(workspaceId);
      const output = service.get(workspaceId, outputId);
      if (!output) throw new Error(`Output not found: ${outputId}`);
      const projectAsset = videoProjectAsset(output);
      const projectPath = service.resolveAssetPath(workspaceId, outputId, projectAsset.path);
      const imported: VideoStudioImportResult['imported'] = [];
      const collected = collectImportableVideoStudioFiles(result.filePaths);
      await withVideoProjectLock(projectPath, () => {
        const project = readProject(projectPath);
        const mediaDir = service.resolveAssetPath(workspaceId, outputId, 'media/.keep');
        mkdirSync(dirname(mediaDir), { recursive: true });
        const nextAssets: OutputAsset[] = [];
        for (const sourcePath of collected.files) {
          const mediaId = randomUUID();
          const mediaType = inferMediaType(sourcePath);
          const safeName = sanitizeFilename(basename(sourcePath)) || `media${extname(sourcePath)}`;
          const assetPath = `media/${mediaId}-${safeName}`;
          const targetPath = service.resolveAssetPath(workspaceId, outputId, assetPath);
          mkdirSync(dirname(targetPath), { recursive: true });
          copyFileSync(sourcePath, targetPath);

          const label = basename(sourcePath);
          const metadata = probeMediaMetadata(targetPath, mediaType);
          project.media.push({
            id: mediaId,
            type: mediaType,
            label,
            path: targetPath,
            mimeType: mimeTypeForPath(targetPath),
            ...metadata,
            source: { kind: 'user-import' },
          });
          const track = ensureTrack(project, mediaType);
          const startMs = Math.max(0, project.timeline.durationMs || 0);
          const durationMs = metadata.durationMs ?? defaultClipDuration(mediaType);
          track.clips.push({
            id: randomUUID(),
            mediaId,
            type: mediaType === 'audio' ? 'audio' : mediaType === 'caption' ? 'caption' : mediaType === 'image' ? 'image' : 'video',
            startMs,
            durationMs,
            label,
            ...(mediaType === 'video' || mediaType === 'audio' ? { sourceInMs: 0, sourceOutMs: durationMs } : {}),
          });
          project.timeline.durationMs = Math.max(project.timeline.durationMs || 0, startMs + durationMs);
          const asset: OutputAsset = {
            id: `video-media-${mediaId}`,
            label,
            role: 'attachment',
            path: assetPath,
            ...fileMetadata(targetPath),
          };
          nextAssets.push(asset);
          imported.push({ mediaId, assetId: asset.id, label, type: mediaType, path: targetPath });
        }

        if (imported.length > 0) {
          addVersion(project, `Imported ${imported.length} media file${imported.length === 1 ? '' : 's'}`);
          writeProject(projectPath, project);
          const latestOutput = service.get(workspaceId, outputId) ?? output;
          writeOutputManifest(root, {
            ...latestOutput,
            updatedAt: new Date().toISOString(),
            assets: mergeAssetsById(latestOutput.assets, nextAssets),
          });
          pushOutputsUpdated(server, workspaceId);
        }
      });

      return { ok: true, outputId, imported, skipped: collected.skipped, projectAssetId: projectAsset.id };
    },
  );

  server.handle(
    RPC_CHANNELS.videoStudio.INSPECT,
    async (_ctx, workspaceId: string, outputId: string): Promise<VideoStudioReportResult> => runVideoStudioReport(server, workspaceId, outputId, 'inspect'),
  );

  server.handle(
    RPC_CHANNELS.videoStudio.DRY_RUN,
    async (_ctx, workspaceId: string, outputId: string): Promise<VideoStudioReportResult> => runVideoStudioReport(server, workspaceId, outputId, 'dry-run'),
  );

  server.handle(
    RPC_CHANNELS.videoStudio.EXPORT,
    async (_ctx, workspaceId: string, outputId: string, preset = 'simple-mp4'): Promise<VideoStudioExportResult> => {
      assertLocalWorkspace(workspaceId, 'Export Video Studio project');
      if (!ALLOWED_VIDEO_EXPORT_PRESETS.has(preset)) {
        throw new Error(`Unknown export preset: ${preset}`);
      }
      const service = serviceFor(server);
      const root = resolveRootPath(workspaceId);
      const output = service.get(workspaceId, outputId);
      if (!output) throw new Error(`Output not found: ${outputId}`);
      const projectAsset = videoProjectAsset(output);
      const projectPath = service.resolveAssetPath(workspaceId, outputId, projectAsset.path);
      return withVideoProjectLock(projectPath, () => {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const renderPath = service.resolveAssetPath(workspaceId, outputId, `renders/${stamp}.mp4`);
        mkdirSync(dirname(renderPath), { recursive: true });
        const cliPath = videoStudioCli(workspaceId);
        if (!existsSync(cliPath)) throw new Error(`Video Studio CLI not found: ${cliPath}`);
        const child = spawnSync('node', [cliPath, 'export', projectPath, '--preset', preset, '--out', renderPath, '--json'], {
          encoding: 'utf-8',
          cwd: dirname(projectPath),
        });
        const receiptPath = `${renderPath}.receipt.json`;
        const receiptAssetPath = relativeAssetPath(root, outputId, receiptPath);
        const receiptAssetId = `video-render-receipt-${stamp}`;
        if (child.status !== 0) {
          const message = child.stderr || child.stdout || 'Video Studio export failed.';
          writeFileSync(receiptPath, `${JSON.stringify({
            ok: false,
            rendered: false,
            projectPath,
            outputPath: renderPath,
            preset,
            createdAt: new Date().toISOString(),
            status: child.status ?? 1,
            stdout: child.stdout,
            stderr: child.stderr,
            error: message,
          }, null, 2)}\n`, 'utf-8');
          const failureReceiptAsset: OutputAsset = {
            id: receiptAssetId,
            label: basename(receiptPath),
            role: 'supporting',
            path: receiptAssetPath,
            ...fileMetadata(receiptPath),
          };
          addAssetToOutput(server, workspaceId, outputId, failureReceiptAsset);
          throw new Error(message);
        }
        const renderAssetPath = relativeAssetPath(root, outputId, renderPath);
        const assetId = `video-render-${stamp}`;
        const renderAsset: OutputAsset = {
          id: assetId,
          label: basename(renderPath),
          role: 'primary',
          path: renderAssetPath,
          ...fileMetadata(renderPath),
        };
        const receiptAsset: OutputAsset = {
          id: receiptAssetId,
          label: basename(receiptPath),
          role: 'supporting',
          path: receiptAssetPath,
          ...fileMetadata(receiptPath),
        };
        const latestOutput = service.get(workspaceId, outputId) ?? output;
        writeOutputManifest(root, {
          ...latestOutput,
          kind: 'video',
          status: 'published',
          updatedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          summary: `Video Studio export rendered to ${basename(renderPath)}.`,
          primary: renderAsset,
          preview: { mode: 'video', assetId },
          assets: mergeAssetsById(latestOutput.assets, [renderAsset, receiptAsset]),
        });
        pushOutputsUpdated(server, workspaceId);
        return { ok: true, outputId, assetId, receiptAssetId, outputPath: renderPath, receiptPath, rendered: true };
      });
    },
  );

  server.handle(
    RPC_CHANNELS.videoStudio.RUN_AGENT,
    async (_ctx, workspaceId: string, outputId: string, prompt: string) => {
      assertLocalWorkspace(workspaceId, 'Run Video Studio agent');
      if (!prompt?.trim()) throw new Error('Agent prompt is required.');
      return {
        ok: true,
        outputId,
        status: 'not-implemented' as const,
        message: 'Video Studio agent command endpoint is registered; session handoff is the next implementation phase.',
      };
    },
  );
}
