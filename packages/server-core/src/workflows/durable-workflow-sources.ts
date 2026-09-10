import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, parse } from 'node:path';
import { canonical, digest } from '../../../shared/src/durable-execution';
import { expandPath } from '../../../shared/src/utils/paths';

/** Frozen prompt-only context; these descriptors never activate connector tools. */
export interface DurableLocalSource {
  slug: string;
  name: string;
  path: string;
  guide: string;
  configDigest: string;
  guideDigest: string;
  identityDigest: string;
}
const unsupported = () => new Error('unsupported-durable-agent-bundle');
function contained(root: string, path: string): boolean {
  const rel = relative(root, path);
  return !isAbsolute(rel) && rel !== '..' && !rel.startsWith('../');
}
function plainPath(root: string, path: string): void {
  if (!contained(root, path)) throw unsupported();
  let current = root;
  for (const part of relative(root, path).split('/').filter(Boolean)) {
    current = join(current, part);
    if (lstatSync(current).isSymbolicLink()) throw unsupported();
  }
}
function sourceConfig(root: string, slug: string): { config: Record<string, any>; folder: string } {
  if (typeof slug !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(slug)) throw unsupported();
  const folder = join(root, 'sources', slug), path = join(folder, 'config.json');
  plainPath(root, path);
  const config = JSON.parse(readFileSync(path, 'utf8'));
  if (!config || typeof config !== 'object' || Array.isArray(config) || config.slug !== slug) throw unsupported();
  return { config, folder };
}
function resolveSource(root: string, slug: string, workspaceRoot: string): DurableLocalSource {
  const { config, folder } = sourceConfig(root, slug);
  if (config.enabled !== true || config.type !== 'local' || config.mcp !== undefined || config.api !== undefined
    || typeof config.name !== 'string' || !config.name.trim() || config.local?.format !== 'filesystem'
    || typeof config.local.path !== 'string' || !config.local.path.trim()
    || Object.keys(config.local).some(key => !['path', 'format'].includes(key))) throw unsupported();
  const expanded = resolve(expandPath(config.local.path, workspaceRoot));
  let requested = expanded;
  // Accept the workspace's platform alias (/var -> /private/var), even when recovery
  // only retains the canonical root. Never follow a link below the matched root.
  let ancestor = parse(expanded).root;
  for (const segment of relative(ancestor, expanded).split('/').filter(Boolean)) {
    ancestor = join(ancestor, segment);
    if (realpathSync(ancestor) === root) {
      requested = join(root, relative(ancestor, expanded));
      break;
    }
  }
  plainPath(root, requested);
  const path = realpathSync(requested), stat = statSync(path);
  if (!contained(root, path) || !stat.isDirectory()) throw unsupported();
  let guide = '';
  const guidePath = join(folder, 'guide.md');
  try { plainPath(root, guidePath); guide = readFileSync(guidePath, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  return { slug, name: config.name, path, guide, configDigest: digest(config), guideDigest: digest(guide),
    identityDigest: digest({ path, dev: stat.dev, ino: stat.ino }) };
}
export function resolveDurableLocalSources(workspaceRoot: string, requiredSlugs: string[] = [], selectedSlugs: string[] = []): DurableLocalSource[] {
  try {
    const slugs = [...new Set([...requiredSlugs, ...selectedSlugs])].sort();
    if (!slugs.length) return [];
    const root = realpathSync(workspaceRoot);
    return slugs.map(slug => resolveSource(root, slug, workspaceRoot));
  } catch { throw unsupported(); }
}
/** Match normal optional-source selection before session composition can mutate context. */
export function selectDurableOptionalSources(workspaceRoot: string, optionalSlugs: string[]): string[] {
  try {
    if (!optionalSlugs.length) return [];
    const root = realpathSync(workspaceRoot);
    return optionalSlugs.filter(slug => {
      try { return sourceConfig(root, slug).config.enabled === true; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
    });
  } catch { throw unsupported(); }
}
export function assertDurableLocalSourcesCurrent(workspaceRoot: string, sources: DurableLocalSource[]): void {
  try {
    const current = resolveDurableLocalSources(workspaceRoot, sources.map(source => source.slug));
    if (canonical(current) !== canonical([...sources].sort((a, b) => a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))) throw unsupported();
  } catch { throw new Error('durable-local-source-changed'); }
}
export function durableLocalSourcesPrompt(sources: DurableLocalSource[]): string {
  if (!sources.length) return '';
  return '\n\nLocal filesystem source context (read using native local read tools):\n' + sources.map(source =>
    JSON.stringify({ name: source.name, slug: source.slug, path: source.path, guide: source.guide })).join('\n');
}
