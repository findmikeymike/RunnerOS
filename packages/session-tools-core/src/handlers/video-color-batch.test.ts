import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SessionToolContext } from '../context';
import { commitVideoProjectContent } from '../../../../tools/video-studio/lib/project-storage.mjs';
import { VideoClipAdjustSchema } from '../tool-defs';
import { handleVideoClipAdjust, handleVideoGetTimeline, handleVideoProjectCreate, handleVideoProjectUndo } from './video-tools';

let root: string, projectPath: string, ctx: SessionToolContext;
const cube = 'TITLE "Identity"\nLUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n';
const read = () => JSON.parse(readFileSync(projectPath, 'utf8'));
const snapshots = () => {
  const sidecars = join(root, '.runner-video');
  return existsSync(sidecars) ? readdirSync(sidecars, { recursive: true }).filter(path => String(path).includes('/undo/') && String(path).endsWith('.runner-video.json')) : [];
};
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'video-color-batch-'));
  projectPath = join(root, 'video.runner-video.json');
  ctx = { workspacePath: root, workingDirectory: root, sessionId: 'color-tests', callbacks: {} } as SessionToolContext;
  await handleVideoProjectCreate(ctx, { projectPath, title: 'Color batch' });
  const project = read();
  project.media = [{ id: 'visual', type: 'image', label: 'Visual', path: join(root, 'image.png') }, { id: 'audio', type: 'audio', label: 'Audio', path: join(root, 'audio.wav') }];
  project.timeline = { durationMs: 2000, markers: [], tracks: [
    { id: 'visual-track', type: 'video', label: 'Video', clips: [
      { id: 'a', type: 'image', mediaId: 'visual', startMs: 0, durationMs: 1000 },
      { id: 'b', type: 'image', mediaId: 'visual', startMs: 1000, durationMs: 1000 },
    ] },
    { id: 'audio-track', type: 'audio', label: 'Audio', clips: [{ id: 'sound', type: 'audio', mediaId: 'audio', startMs: 0, durationMs: 1000 }] },
    { id: 'locked-track', type: 'video', label: 'Locked', locked: true, clips: [{ id: 'locked', type: 'image', mediaId: 'visual', startMs: 0, durationMs: 1000 }] },
  ] };
  writeFileSync(projectPath, JSON.stringify(project, null, 2) + '\n');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('atomic agent color adjustment', () => {
  test('applies one validated LUT to multiple clips with one save checkpoint and one undo', async () => {
    const original = read();
    const result = await handleVideoClipAdjust(ctx, { projectPath, clipIds: ['a', 'b'], lutCube: cube, lutName: 'Identity', lutIntensity: 0.35, exposure: 0.2 });
    expect(result.isError).toBe(false);
    expect(snapshots()).toHaveLength(1);
    const updated = read();
    expect(updated.versions).toHaveLength(original.versions.length + 1);
    for (const clip of updated.timeline.tracks[0].clips) {
      expect(clip.adjustments.pipeline).toBe('rgb-v1');
      expect(clip.adjustments.exposure).toBe(0.2);
      expect(clip.adjustments.lut).toMatchObject({ size: 2, name: 'Identity', intensity: 0.35 });
      expect(clip.adjustments.lut.values).toHaveLength(24);
    }
    expect((result.structuredContent as any).changedClipIds).toEqual(['a', 'b']);
    expect((result.structuredContent as any).clips[0].adjustments.lut.values).toBeUndefined();
    expect((await handleVideoProjectUndo(ctx, { projectPath })).isError).toBe(false);
    expect(read().timeline).toEqual(original.timeline);
    expect(snapshots()).toHaveLength(0);
  });
  test.each(['missing', 'sound', 'locked'])('rejects entire batch with %s target without touching file or backup', async (badId) => {
    const before = readFileSync(projectPath, 'utf8');
    writeFileSync(projectPath + '.bak', 'existing backup');
    const result = await handleVideoClipAdjust(ctx, { projectPath, clipIds: ['a', badId], lutCube: cube });
    expect(result.isError).toBe(true);
    expect(readFileSync(projectPath, 'utf8')).toBe(before);
    expect(readFileSync(projectPath + '.bak', 'utf8')).toBe('existing backup');
    expect(snapshots()).toHaveLength(0);
  });
  test.each(['LUT_3D_SIZE 2\n0 0 0', 'LUT_3D_SIZE 1000', 'LUT_3D_SIZE 2\nNaN 0 0', 'x'.repeat(2_000_001)])('rejects malformed or oversized LUT before writes', async (lutCube) => {
    const before = readFileSync(projectPath, 'utf8');
    expect((await handleVideoClipAdjust(ctx, { projectPath, clipIds: ['a', 'b'], lutCube })).isError).toBe(true);
    expect(readFileSync(projectPath, 'utf8')).toBe(before);
    expect(snapshots()).toHaveLength(0);
  });
  test('keeps single clip response compatible and preserves LUT on later numeric edits', async () => {
    const result = await handleVideoClipAdjust(ctx, { projectPath, clipId: 'a', lutCube: cube });
    expect((result.structuredContent as any).clipId).toBe('a');
    expect((await handleVideoClipAdjust(ctx, { projectPath, clipId: 'a', contrast: 1.2, lutIntensity: 0.5 })).isError).toBe(false);
    expect(read().timeline.tracks[0].clips[0].adjustments).toMatchObject({ contrast: 1.2, lut: { intensity: 0.5 } });
    expect((await handleVideoClipAdjust(ctx, { projectPath, clipId: 'a', removeLut: true })).isError).toBe(false);
    expect(read().timeline.tracks[0].clips[0].adjustments).toMatchObject({ contrast: 1.2, pipeline: 'rgb-v1' });
    expect(read().timeline.tracks[0].clips[0].adjustments.lut).toBeUndefined();
  });
  test('rejects missing LUT on a later target without committing earlier target changes', async () => {
    await handleVideoClipAdjust(ctx, { projectPath, clipId: 'a', lutCube: cube });
    const before = readFileSync(projectPath, 'utf8');
    expect((await handleVideoClipAdjust(ctx, { projectPath, clipIds: ['a', 'b'], lutIntensity: 0.4 })).isError).toBe(true);
    expect(readFileSync(projectPath, 'utf8')).toBe(before);
    expect(snapshots()).toHaveLength(1);
  });
  test('rejects invalid selection, conflicting LUT options and incompatible effects', async () => {
    const before = readFileSync(projectPath, 'utf8');
    for (const args of [
      {}, { clipId: 'a', clipIds: ['b'] }, { clipIds: ['a', 'a'] }, { clipIds: [] },
      { clipIds: Array.from({ length: 33 }, (_, i) => String(i)) },
      { clipId: 'a', lutCube: cube, removeLut: true }, { clipId: 'a', lutIntensity: NaN },
      { clipId: 'a', exposure: 2 }, { clipId: 'a', saturation: NaN }, { clipId: 'a', contrast: Infinity }, { clipId: 'a', reset: true, lutCube: cube },
    ]) expect((await handleVideoClipAdjust(ctx, { projectPath, ...args })).isError).toBe(true);
    expect(readFileSync(projectPath, 'utf8')).toBe(before);
    expect(snapshots()).toHaveLength(0);
  });
  test('new presets retain LUTs and texture effects report render-only warnings', async () => {
    await handleVideoClipAdjust(ctx, { projectPath, clipId: 'a', lutCube: cube, lutIntensity: 0.4 });
    const preset = await handleVideoClipAdjust(ctx, { projectPath, clipId: 'a', preset: 'cinematic' });
    expect(preset.isError).toBe(false);
    expect(read().timeline.tracks[0].clips[0].adjustments).toMatchObject({ pipeline: 'rgb-v1', preset: 'cinematic', lut: { intensity: 0.4 } });
    expect(read().timeline.tracks[0].clips[0].adjustments.grain).toBeUndefined();
    const textured = await handleVideoClipAdjust(ctx, { projectPath, clipId: 'a', grain: 0.5 });
    expect(textured.isError).toBe(false);
    expect((textured.structuredContent as any).warnings).toHaveLength(1);
    expect(read().timeline.tracks[0].clips[0].adjustments.lut.intensity).toBe(0.4);
  });
  test('texture edits preserve RGB exposure while explicit color edits upgrade legacy clips', async () => {
    await handleVideoClipAdjust(ctx, { projectPath, clipId: 'a', exposure: 1 });
    expect((await handleVideoClipAdjust(ctx, { projectPath, clipId: 'a', grain: 0.4 })).isError).toBe(false);
    expect(read().timeline.tracks[0].clips[0].adjustments).toMatchObject({ pipeline: 'rgb-v1', exposure: 1, grain: 0.4 });
    const project = read();
    project.timeline.tracks[0].clips[1].adjustments = { exposure: 0.2, grain: 0.1 };
    writeFileSync(projectPath, JSON.stringify(project, null, 2) + '\n');
    expect((await handleVideoClipAdjust(ctx, { projectPath, clipId: 'b', grain: 0.3 })).isError).toBe(false);
    expect(read().timeline.tracks[0].clips[1].adjustments.pipeline).toBeUndefined();
    expect((await handleVideoClipAdjust(ctx, { projectPath, clipId: 'b', contrast: 1.2 })).isError).toBe(false);
    expect(read().timeline.tracks[0].clips[1].adjustments).toMatchObject({ pipeline: 'rgb-v1', exposure: 0.2, contrast: 1.2, grain: 0.3 });
  });
  test('rejects aggregate inline LUT expansion before any snapshot, backup or project write', async () => {
    const project = read();
    project.timeline.tracks[0].clips = Array.from({ length: 32 }, (_, index) => ({ id: `clip-${index}`, type: 'image', mediaId: 'visual', startMs: index * 1000, durationMs: 1000 }));
    project.timeline.durationMs = 32000;
    writeFileSync(projectPath, JSON.stringify(project, null, 2) + '\n');
    const before = readFileSync(projectPath, 'utf8');
    writeFileSync(projectPath + '.bak', 'unchanged backup');
    const values = Array.from({ length: 33 ** 3 * 3 }, (_, i) => Number(((i % 991) / 991).toFixed(6)));
    const rows: string[] = [];
    for (let i = 0; i < values.length; i += 3) rows.push(values.slice(i, i + 3).join(' '));
    const result = await handleVideoClipAdjust(ctx, { projectPath, clipIds: project.timeline.tracks[0].clips.map((clip: any) => clip.id), lutCube: 'LUT_3D_SIZE 33\n' + rows.join('\n') });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain('16 MB');
    expect(readFileSync(projectPath, 'utf8')).toBe(before);
    expect(readFileSync(projectPath + '.bak', 'utf8')).toBe('unchanged backup');
    expect(snapshots()).toHaveLength(0);
    for (const clip of project.timeline.tracks[0].clips) clip.adjustments = { pipeline: 'rgb-v1', lut: { name: 'Large cube', size: 33, values } };
    expect(() => commitVideoProjectContent(projectPath, JSON.stringify(project), { expectedContent: before })).toThrow('16 MB');
    expect(readFileSync(projectPath, 'utf8')).toBe(before);
  });
  test('advertises bounded batch and LUT inputs in the registered tool schema', () => {
    expect(VideoClipAdjustSchema.safeParse({ projectPath, clipIds: ['a', 'b'], lutCube: cube, lutIntensity: 0.3 }).success).toBe(true);
    expect(VideoClipAdjustSchema.safeParse({ projectPath, clipIds: Array(33).fill('a') }).success).toBe(false);
    expect(VideoClipAdjustSchema.safeParse({ projectPath, clipId: 'a', lutIntensity: 1.1 }).success).toBe(false);
  });
});


describe('bounded agent timeline color summaries', () => {
  test.each([1, 3])('summarizes %i large LUT clips without returning or changing sample tables', async (count) => {
    const project = read();
    const values = Array.from({ length: 33 ** 3 * 3 }, (_, i) => (i % 33) / 32);
    project.timeline.tracks[0].clips = Array.from({ length: count }, (_, i) => ({
      id: `graded-${i}`, type: 'image', mediaId: 'visual', startMs: i * 1000, durationMs: 1000,
      adjustments: { pipeline: 'rgb-v1', exposure: 0.15, lut: { name: 'Large look', size: 33, intensity: 0.4, domainMin: [0, 0, 0], domainMax: [1, 1, 1], values } },
    }));
    project.timeline.durationMs = count * 1000;
    const before = JSON.stringify(project, null, 2) + '\n';
    writeFileSync(projectPath, before);
    const result = await handleVideoGetTimeline(ctx, { projectPath });
    expect(result.isError).toBe(false);
    expect(JSON.stringify(result).length).toBeLessThan(20_000);
    for (const clip of (result.structuredContent as any).timeline.tracks[0].clips) {
      expect(clip.adjustments).toEqual({ pipeline: 'rgb-v1', exposure: 0.15, lut: { name: 'Large look', size: 33, intensity: 0.4, domainMin: [0, 0, 0], domainMax: [1, 1, 1] } });
      expect(clip.adjustments.lut.values).toBeUndefined();
    }
    expect(readFileSync(projectPath, 'utf8')).toBe(before);
    expect(read().timeline.tracks[0].clips[0].adjustments.lut.values).toHaveLength(107811);
    expect(snapshots()).toHaveLength(0);
  });
});
