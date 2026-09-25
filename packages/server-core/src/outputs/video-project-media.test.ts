import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, linkSync, truncateSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRunnerVideoProject } from '@craft-agent/shared/video';
import type { OutputManifest } from '@craft-agent/shared/outputs';
import { withVideoProjectMedia } from './video-project-media';
let root: string, dir: string, projectPath: string, mediaPath: string, project: ReturnType<typeof createRunnerVideoProject>, output: OutputManifest;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'derived-video-media-'));
  dir = join(root, 'outputs', 'c1370000-1111-4111-8111-111111111112');
  mkdirSync(join(dir, 'media'), { recursive: true });
  projectPath = join(dir, 'video.runner-video.json'); mediaPath = join(dir, 'media', 'image.png');
  writeFileSync(mediaPath, 'pixels');
  project = createRunnerVideoProject({ title: 'Test', workspaceId: 'ws' });
  project.media.push({ id: 'image', type: 'image', label: 'Image', path: mediaPath, source: { kind: 'user-import' } });
  output = { id: 'c1370000-1111-4111-8111-111111111112', assets: [{ id: 'project', path: 'video.runner-video.json', label: 'Project', role: 'source' }] } as OutputManifest;
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
const save = () => writeFileSync(projectPath, JSON.stringify(project));
const assets = () => withVideoProjectMedia(root, output).assets;
test('derives local import without mutating project or manifest', () => {
  save(); const before = readFileSync(projectPath, 'utf8');
  expect(assets().at(-1)).toMatchObject({ id: 'video-media-image', path: 'media/image.png', sizeBytes: 6 });
  expect(output.assets).toHaveLength(1); expect(readFileSync(projectPath, 'utf8')).toBe(before);
});
test('existing registration wins even with conflicting path', () => {
  output.assets.push({ id: 'video-media-image', label: 'Existing', role: 'attachment', path: 'existing.png' }); save();
  expect(assets()).toEqual(output.assets);
});
test('duplicate media identities fail closed', () => { project.media.push({ ...project.media[0]! }); save(); expect(assets()).toEqual(output.assets); });
test.each(['missing', 'directory', 'outside', 'foreign-output', 'symlink', 'hardlink'])('does not derive unsafe %s media', kind => {
  const outside = join(root, 'secret.png'); writeFileSync(outside, 'private');
  if (kind === 'missing') rmSync(mediaPath);
  if (kind === 'directory') { rmSync(mediaPath); mkdirSync(mediaPath); }
  if (kind === 'outside') project.media[0]!.path = outside;
  if (kind === 'foreign-output') { const other = join(root, 'outputs', 'other', 'media'); mkdirSync(other, { recursive: true }); project.media[0]!.path = join(other, 'image.png'); writeFileSync(project.media[0]!.path, 'private'); }
  if (kind === 'symlink') { rmSync(mediaPath); symlinkSync(outside, mediaPath); }
  if (kind === 'hardlink') { rmSync(mediaPath); linkSync(outside, mediaPath); }
  save(); expect(assets()).toEqual(output.assets);
});
test.each(['malformed', 'oversized', 'foreign-project'])('ignores %s project without recovery writes', kind => {
  save();
  if (kind === 'malformed') writeFileSync(projectPath, '{');
  if (kind === 'oversized') truncateSync(projectPath, 32 * 1024 * 1024 + 1);
  if (kind === 'foreign-project') { const external = join(root, 'project.runner-video.json'); writeFileSync(external, JSON.stringify(project)); rmSync(projectPath); symlinkSync(external, projectPath); }
  expect(assets()).toEqual(output.assets);
});
