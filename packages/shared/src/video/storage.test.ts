import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  addVideoProjectVersion,
  appendVideoAgentEvent,
  createRunnerVideoProject,
  migrateVideoProject,
  readVideoProject,
  type VideoClip,
  upsertVideoMediaAsset,
  validateRunnerVideoProject,
  writeVideoProject,
} from './index.ts';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'runner-video-test-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('Runner video project storage', () => {
  test('creates a valid default project', () => {
    const project = createRunnerVideoProject({ title: 'Launch Cut', workspaceId: 'workspace-1' });
    const validation = validateRunnerVideoProject(project);

    expect(validation.ok).toBe(true);
    expect(project.version).toBe(1);
    expect(project.settings.aspectRatio).toBe('9:16');
    expect(project.timeline.tracks.map((track) => track.id)).toEqual(['video-main', 'audio-main', 'captions-main']);
    expect(project.versions).toHaveLength(1);
  });

  test('writes and reads a valid project atomically', () => {
    const project = createRunnerVideoProject({ title: 'Saved Cut', workspaceId: 'workspace-1' });
    const projectPath = join(root, 'nested', 'video.runner-video.json');

    writeVideoProject(projectPath, project);
    const loaded = readVideoProject(projectPath);

    expect(loaded.id).toBe(project.id);
    expect(loaded.title).toBe('Saved Cut');
  });

  test('validates clip media references', () => {
    const project = createRunnerVideoProject({ title: 'Bad Ref', workspaceId: 'workspace-1' });
    project.timeline.tracks[0]!.clips.push({
      id: 'clip-1',
      type: 'video',
      mediaId: 'missing',
      startMs: 0,
      durationMs: 1000,
    });

    const validation = validateRunnerVideoProject(project);

    expect(validation.ok).toBe(false);
    expect(validation.errors[0]?.message).toContain('Referenced media');
  });

  test('accepts partial clip transforms with renderer defaults', () => {
    const project = createRunnerVideoProject({ title: 'Partial Transform', workspaceId: 'workspace-1' });
    project.timeline.tracks[0]!.clips.push({
      id: 'clip-1',
      type: 'video',
      startMs: 0,
      durationMs: 1000,
      transform: { x: 24 },
    } as VideoClip);

    const validation = validateRunnerVideoProject(project);

    expect(validation.ok).toBe(true);
  });

  test('tracks media, versions, and agent events', () => {
    const project = createRunnerVideoProject({ title: 'Agent Cut', workspaceId: 'workspace-1' });
    upsertVideoMediaAsset(project, {
      id: 'media-1',
      type: 'video',
      label: 'clip.mp4',
      path: '/tmp/clip.mp4',
      source: { kind: 'user-import' },
    });
    const version = addVideoProjectVersion(project, 'Imported media', 'agent', {
      agentSlug: 'video-editor-agent',
      sessionId: 'session-1',
    });
    const event = appendVideoAgentEvent(project, {
      agentSlug: 'video-editor-agent',
      sessionId: 'session-1',
      toolName: 'video_media_import',
      summary: 'Imported media',
      afterVersionId: version.id,
    });

    expect(project.media).toHaveLength(1);
    expect(project.versions.at(-1)?.summary).toBe('Imported media');
    expect(project.agentEvents.at(-1)?.id).toBe(event.id);
    expect(validateRunnerVideoProject(project).ok).toBe(true);
  });

  test('rejects an unknown aspectRatio at validation', () => {
    const project = createRunnerVideoProject({ title: 'Bad Ratio', workspaceId: 'workspace-1' });
    (project.settings as { aspectRatio: string }).aspectRatio = 'banana';
    const validation = validateRunnerVideoProject(project);
    expect(validation.ok).toBe(false);
    expect(validation.errors.some((issue) => issue.path === 'settings.aspectRatio')).toBe(true);
  });

  test('migrateVideoProject rejects a newer schema version', () => {
    expect(() => migrateVideoProject({ version: 99 })).toThrow(/newer schema/i);
    // Current version passes through untouched.
    const ok = createRunnerVideoProject({ title: 'V1', workspaceId: 'w' });
    expect(migrateVideoProject(ok)).toBe(ok);
  });

  test('backs up the prior project on overwrite', () => {
    const projectPath = join(root, 'video.runner-video.json');
    const project = createRunnerVideoProject({ title: 'First', workspaceId: 'workspace-1' });
    writeVideoProject(projectPath, project);
    expect(existsSync(`${projectPath}.bak`)).toBe(false); // no prior file to back up

    const updated = { ...project, title: 'Second', updatedAt: new Date().toISOString() };
    writeVideoProject(projectPath, updated);
    expect(existsSync(`${projectPath}.bak`)).toBe(true); // prior good copy preserved
  });

  test('recovers a corrupt project file from its backup', () => {
    const projectPath = join(root, 'video.runner-video.json');
    const project = createRunnerVideoProject({ title: 'Recoverable', workspaceId: 'workspace-1' });
    writeVideoProject(projectPath, project);
    writeVideoProject(projectPath, { ...project, updatedAt: new Date().toISOString() }); // creates .bak

    writeFileSync(projectPath, 'this is not valid json {{{', 'utf-8'); // corrupt the live file

    const recovered = readVideoProject(projectPath);
    expect(recovered.id).toBe(project.id);
    expect(recovered.title).toBe('Recoverable');
    expect(JSON.parse(readFileSync(projectPath, 'utf-8')).id).toBe(project.id);
    expect(existsSync(`${projectPath}.bak`)).toBe(true);
    expect(existsSync(`${projectPath}.corrupt.bak`)).toBe(false);
  });

  test('does not recover newer schema projects from a stale backup', () => {
    const projectPath = join(root, 'video.runner-video.json');
    const project = createRunnerVideoProject({ title: 'Old Backup', workspaceId: 'workspace-1' });
    writeVideoProject(projectPath, project);
    writeVideoProject(projectPath, { ...project, updatedAt: new Date().toISOString() }); // creates .bak
    writeFileSync(projectPath, `${JSON.stringify({ ...project, version: 99 }, null, 2)}\n`, 'utf-8');

    expect(() => readVideoProject(projectPath)).toThrow(/newer schema/i);
  });
});
