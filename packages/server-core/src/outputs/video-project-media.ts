import { readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { assertOutputAssetPath, getOutputDir, type OutputAsset, type OutputManifest } from '@craft-agent/shared/outputs';
import { migrateVideoProject, validateRunnerVideoProject, type RunnerVideoProject } from '@craft-agent/shared/video';

const MAX_PROJECT_BYTES = 32 * 1024 * 1024;
function inside(root: string, path: string): boolean {
  const child = relative(root, path);
  return child !== '' && child !== '..' && !child.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(child);
}

/** Derive preview registrations from the current project without rewriting its Output.
 * Only files imported into this project's own media directory gain registrations.
 * Existing registrations remain authoritative, including mismatches rejected by RPC.
 */
export function withVideoProjectMedia(workspaceRoot: string, output: OutputManifest): OutputManifest {
  const projectAsset = output.assets.find(asset => asset.path.toLowerCase().endsWith('.runner-video.json'));
  if (!projectAsset) return output;
  try {
    const outputDir = realpathSync(getOutputDir(workspaceRoot, output.id));
    const workspaceDir = realpathSync(workspaceRoot);
    if (!inside(workspaceDir, outputDir)) return output;
    const projectPath = realpathSync(assertOutputAssetPath(workspaceRoot, output.id, projectAsset.path));
    if (!inside(outputDir, projectPath)) return output;
    const projectStat = statSync(projectPath);
    if (!projectStat.isFile() || projectStat.nlink > 1 || projectStat.size > MAX_PROJECT_BYTES) return output;
    // readVideoProject performs recovery writes. This GET path must remain read-only.
    const parsed = migrateVideoProject(JSON.parse(readFileSync(projectPath, 'utf8')));
    if (!validateRunnerVideoProject(parsed).ok) return output;
    const project = parsed as RunnerVideoProject;
    const ids = project.media.map(media => media.id);
    if (new Set(ids).size !== ids.length) return output;
    const mediaDir = resolve(dirname(projectPath), 'media');
    const canonicalMediaDir = realpathSync(mediaDir);
    if (!inside(outputDir, canonicalMediaDir)) return output;
    const registered = new Set(output.assets.map(asset => asset.id));
    const derived: OutputAsset[] = [];
    for (const media of project.media) {
      const id = `video-media-${media.id}`;
      if (registered.has(id) || !['video', 'audio', 'image'].includes(media.type)) continue;
      try {
        const requested = resolve(dirname(projectPath), media.path);
        const path = realpathSync(requested);
        if (!inside(canonicalMediaDir, path) || !inside(outputDir, path)) continue;
        const stats = statSync(path);
        if (!stats.isFile() || stats.nlink > 1) continue;
        derived.push({ id, label: media.label, role: 'attachment', path: relative(outputDir, path).split('\\').join('/'), sizeBytes: stats.size });
      } catch { /* Missing or unsafe media remains unavailable, without breaking Output loading. */ }
    }
    return derived.length ? { ...output, assets: [...output.assets, ...derived] } : output;
  } catch { return output; }
}
