import { existsSync, realpathSync, statSync, readdirSync, lstatSync, readlinkSync } from 'node:fs';
import { dirname, basename, join, resolve, relative, isAbsolute, sep } from 'node:path';

// Resolve existing ancestors too, so destinations through a symlinked directory
// are checked before their files have been created.
function canonicalLocation(path, seen = new Set()) {
  const absolute = resolve(path);
  if (seen.has(absolute)) throw new Error('Export path contains a symlink cycle. Choose a different output path.');
  seen.add(absolute);
  try {
    if (lstatSync(absolute).isSymbolicLink()) return canonicalLocation(resolve(dirname(absolute), readlinkSync(absolute)), seen);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (existsSync(absolute)) return realpathSync(absolute);
  const parent = dirname(absolute);
  return parent === absolute ? absolute : join(canonicalLocation(parent, seen), basename(absolute));
}
function inside(root, path) {
  const rel = relative(root, path);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}
function sameFile(left, right) {
  if (!existsSync(left) || !existsSync(right)) return false;
  const a = statSync(left), b = statSync(right);
  return a.dev === b.dev && a.ino === b.ino;
}
function containsInode(directory, candidate) {
  if (!existsSync(directory)) return false;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (containsInode(path, candidate)) return true;
    } else if (sameFile(path, candidate)) return true;
  }
  return false;
}

/** Refuse destinations that would modify a project, its recovery data or media. */
export function assertSafeVideoExportPaths(projectPath, media, outputPath) {
  const project = resolve(projectPath);
  const canonicalProject = canonicalLocation(project);
  const controls = [...new Set([project, canonicalProject])].flatMap((path) => [path, `${path}.bak`, `${path}.write-lock`]);
  const sidecarRoots = [...new Set([dirname(project), dirname(canonicalProject)])].map((dir) => join(dir, '.runner-video'));
  const sourcePaths = media.filter((asset) => typeof asset.path === 'string').map((asset) => resolve(dirname(project), asset.path));
  for (const target of [resolve(outputPath), resolve(`${outputPath}.receipt.json`)]) {
    const canonicalTarget = canonicalLocation(target);
    const isControl = controls.some((path) => canonicalLocation(path) === canonicalTarget || sameFile(path, target));
    const isRecoveryFile = [project, canonicalProject].some((path) => canonicalTarget.startsWith(`${path}.`) && (canonicalTarget.endsWith('.corrupt.bak') || canonicalTarget.endsWith('.tmp')));
    const isSidecar = sidecarRoots.some((root) => inside(canonicalLocation(root), canonicalTarget));
    const isSidecarAlias = existsSync(target) && statSync(target).nlink > 1 && sidecarRoots.some((root) => containsInode(root, target));
    if (isControl || isRecoveryFile || isSidecar || isSidecarAlias) throw new Error('Refusing to overwrite video project or recovery files with an export or receipt. Choose a different output path.');
    if (sourcePaths.some((path) => canonicalLocation(path) === canonicalTarget || sameFile(path, target))) throw new Error('Refusing to overwrite source media with the export output. Choose a different output path.');
  }
}
