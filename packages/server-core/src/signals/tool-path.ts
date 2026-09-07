import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** Environment roots work in packaged CJS; cwd ancestors cover source checkouts. */
export function resolveSignalToolPath(name: string): string {
  if (!['youtube-research', 'youtube-intelligence'].includes(name)) throw new Error('Unsupported Signals tool.');
  const roots = [process.env.CRAFT_RESOURCES_BASE, process.env.CRAFT_APP_ROOT].filter((root): root is string => Boolean(root));
  let directory = process.cwd();
  while (true) {
    roots.push(directory);
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  for (const root of roots) {
    const path = resolve(root, 'tools', name, 'bin', `${name}.mjs`);
    if (existsSync(path)) return path;
  }
  throw new Error('YouTube research tools are unavailable on this host.');
}
