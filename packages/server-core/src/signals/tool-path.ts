import { readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';

export class SignalToolPathError extends Error {
  constructor(unreadable = false) {
    super(unreadable ? 'YouTube research tools cannot be read. Check the Artist OS installation and file permissions.'
      : 'YouTube research tools are missing from this host. Repair the Artist OS installation and retry.');
    this.name = 'SignalToolPathError';
  }
}
function missingPath(error: unknown): boolean {
  return ['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException)?.code ?? '');
}

function checkoutRoot(directory: string): string | undefined {
  const path = resolve(directory);
  const candidates = [path];
  // These are the supported dev launch locations, not an ancestor search.
  if ((basename(path) === 'electron' && basename(dirname(path)) === 'apps')
    || (basename(path) === 'server-core' && basename(dirname(path)) === 'packages')) {
    candidates.push(resolve(path, '../..'));
  }
  for (const candidate of candidates) {
    try {
      const manifest = JSON.parse(readFileSync(resolve(candidate, 'package.json'), 'utf8'));
      const server = JSON.parse(readFileSync(resolve(candidate, 'packages/server-core/package.json'), 'utf8'));
      if (manifest?.name === 'craft-agent' && server?.name === '@craft-agent/server-core'
        && Array.isArray(manifest.workspaces) && manifest.workspaces.includes('packages/*') && manifest.workspaces.includes('apps/*')) return candidate;
    } catch (error) {
      if (!missingPath(error) && !(error instanceof SyntaxError)) throw new SignalToolPathError(true);
    }
  }
}

/** Host-provided packaged roots, or verified dev launch layouts; never crawl cwd ancestors. */
export function resolveSignalToolPath(name: string): string {
  if (!['youtube-research', 'youtube-intelligence'].includes(name)) throw new Error('Unsupported Signals tool.');
  const roots = [process.env.CRAFT_RESOURCES_BASE, process.env.CRAFT_APP_ROOT]
    .filter((root): root is string => typeof root === 'string' && isAbsolute(root));
  if (process.env.CRAFT_IS_PACKAGED !== '1') {
    const configured = process.env.CRAFT_RESOURCES_BASE || process.env.CRAFT_APP_ROOT;
    for (const directory of configured ? [...roots] : [process.cwd()]) {
      const root = checkoutRoot(directory);
      if (root) roots.push(root);
    }
  }
  let unreadable = false;
  for (const root of new Set(roots)) {
    try {
      const trustedRoot = realpathSync(root);
      const path = realpathSync(resolve(root, 'tools', name, 'bin', `${name}.mjs`));
      const within = relative(trustedRoot, path);
      if (within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within) || !statSync(path).isFile()) continue;
      return path;
    } catch (error) { if (!missingPath(error)) unreadable = true; }
  }
  throw new SignalToolPathError(unreadable);
}
