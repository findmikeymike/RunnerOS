import { closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  RunnerVideoProject,
  VideoAgentEvent,
  VideoAspectRatio,
  VideoMediaAsset,
  VideoProjectSettings,
  VideoProjectVersion,
} from './types.ts';
import { DEFAULT_VIDEO_PROJECT_FILE } from './types.ts';
import { validateRunnerVideoProject } from './validation.ts';

export interface CreateVideoProjectInput {
  title: string;
  workspaceId: string;
  projectId?: string;
  sourceSessionId?: string;
  settings?: Partial<VideoProjectSettings>;
}

export interface AppendVideoAgentEventInput {
  agentSlug: string;
  sessionId: string;
  toolName: string;
  summary: string;
  beforeVersionId?: string;
  afterVersionId?: string;
  receiptPath?: string;
}

export function defaultVideoProjectSettings(aspectRatio: VideoAspectRatio = '9:16'): VideoProjectSettings {
  if (aspectRatio === '16:9') return { aspectRatio, width: 1920, height: 1080, fps: 30 };
  if (aspectRatio === '1:1') return { aspectRatio, width: 1080, height: 1080, fps: 30 };
  if (aspectRatio === '4:5') return { aspectRatio, width: 1080, height: 1350, fps: 30 };
  return { aspectRatio, width: 1080, height: 1920, fps: 30 };
}

function compactSettings(settings: Partial<VideoProjectSettings> | undefined): Partial<VideoProjectSettings> {
  if (!settings) return {};
  return Object.fromEntries(Object.entries(settings).filter(([, value]) => value !== undefined)) as Partial<VideoProjectSettings>;
}

export function createRunnerVideoProject(input: CreateVideoProjectInput): RunnerVideoProject {
  const now = new Date().toISOString();
  const initialVersion: VideoProjectVersion = {
    id: randomUUID(),
    createdAt: now,
    summary: 'Created video project',
    actor: 'system',
  };
  return {
    version: 1,
    id: input.projectId ?? randomUUID(),
    title: input.title.trim() || 'Untitled Video',
    createdAt: now,
    updatedAt: now,
    workspaceId: input.workspaceId,
    sourceSessionId: input.sourceSessionId,
    settings: { ...defaultVideoProjectSettings(input.settings?.aspectRatio), ...compactSettings(input.settings) },
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
    versions: [initialVersion],
    agentEvents: [],
  };
}

export const CURRENT_VIDEO_PROJECT_VERSION = 1;

/**
 * Bring a parsed project to the current schema version. Newer-than-known
 * versions are rejected with a clear message instead of being mis-parsed;
 * older versions are migrated forward (scaffold — only v1 exists today).
 */
export function migrateVideoProject(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const record = raw as Record<string, unknown>;
  const version = typeof record.version === 'number' ? record.version : 1;
  if (version > CURRENT_VIDEO_PROJECT_VERSION) {
    throw new Error(
      `This video project uses a newer schema (v${version}) than this RunnerOS build supports (v${CURRENT_VIDEO_PROJECT_VERSION}). Update RunnerOS to open it.`,
    );
  }
  // Future: apply sequential v(n) -> v(n+1) migrations here.
  if (record.version !== CURRENT_VIDEO_PROJECT_VERSION) {
    return { ...record, version: CURRENT_VIDEO_PROJECT_VERSION };
  }
  return raw;
}

/** Atomic + durable write: backup existing good file, fsync temp, then rename. */
function writeVideoProjectFile(projectPath: string, project: RunnerVideoProject): void {
  mkdirSync(dirname(projectPath), { recursive: true });
  if (existsSync(projectPath)) {
    try {
      copyFileSync(projectPath, `${projectPath}.bak`);
    } catch {
      /* best-effort backup; never block a save on backup failure */
    }
  }
  const tmp = `${projectPath}.${process.pid}.${Date.now()}.tmp`;
  const fd = openSync(tmp, 'w');
  try {
    writeSync(fd, `${JSON.stringify(project, null, 2)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, projectPath);
}

export function readVideoProject(projectPath: string): RunnerVideoProject {
  let parsed: unknown;
  try {
    parsed = migrateVideoProject(JSON.parse(readFileSync(projectPath, 'utf-8')));
  } catch (error) {
    // Corrupt / unparseable / unsupported version. Try a backup, then preserve
    // the bad file so a later write can't silently destroy the only copy.
    const backupPath = `${projectPath}.bak`;
    if (existsSync(backupPath)) {
      try {
        const recovered = migrateVideoProject(JSON.parse(readFileSync(backupPath, 'utf-8')));
        if (validateRunnerVideoProject(recovered).ok) return recovered as RunnerVideoProject;
      } catch {
        /* backup also unusable — fall through */
      }
    }
    try {
      copyFileSync(projectPath, `${projectPath}.${Date.now()}.corrupt.bak`);
    } catch {
      /* best-effort */
    }
    throw error instanceof Error ? error : new Error('Invalid video project JSON.');
  }
  const validation = validateRunnerVideoProject(parsed);
  if (!validation.ok) {
    const first = validation.errors[0];
    throw new Error(first ? `${first.path}: ${first.message}` : 'Invalid video project.');
  }
  return parsed as RunnerVideoProject;
}

export function writeVideoProject(projectPath: string, project: RunnerVideoProject): void {
  const validation = validateRunnerVideoProject(project);
  if (!validation.ok) {
    const first = validation.errors[0];
    throw new Error(first ? `${first.path}: ${first.message}` : 'Invalid video project.');
  }
  writeVideoProjectFile(projectPath, project);
}

export function getDefaultVideoProjectPath(projectDir: string): string {
  return join(projectDir, DEFAULT_VIDEO_PROJECT_FILE);
}

export function ensureVideoProject(projectPath: string, input: CreateVideoProjectInput): RunnerVideoProject {
  if (existsSync(projectPath)) return readVideoProject(projectPath);
  const project = createRunnerVideoProject(input);
  writeVideoProject(projectPath, project);
  return project;
}

export function addVideoProjectVersion(
  project: RunnerVideoProject,
  summary: string,
  actor: VideoProjectVersion['actor'] = 'agent',
  meta: Pick<VideoProjectVersion, 'agentSlug' | 'sessionId'> = {},
): VideoProjectVersion {
  const version: VideoProjectVersion = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    summary,
    actor,
    ...meta,
  };
  project.versions.push(version);
  project.updatedAt = version.createdAt;
  return version;
}

export function appendVideoAgentEvent(project: RunnerVideoProject, input: AppendVideoAgentEventInput): VideoAgentEvent {
  const event: VideoAgentEvent = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    ...input,
  };
  project.agentEvents.push(event);
  project.updatedAt = event.createdAt;
  return event;
}

export function upsertVideoMediaAsset(project: RunnerVideoProject, asset: VideoMediaAsset): VideoMediaAsset {
  const index = project.media.findIndex((item) => item.id === asset.id);
  if (index >= 0) project.media[index] = asset;
  else project.media.push(asset);
  project.updatedAt = new Date().toISOString();
  return asset;
}
