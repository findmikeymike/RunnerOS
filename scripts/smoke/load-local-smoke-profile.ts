#!/usr/bin/env bun
/** Adapted from d66b3dfc4; synthetic fixtures only, never credentials or providers. */
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { createOutputBundle, getOutputDir } from '../../packages/shared/src/outputs/index.ts';
import { getContextDocDir, upsertContextDoc } from '../../packages/shared/src/workspace-context/index.ts';
import context from './templates/demo/context.json';
import outputs from './templates/demo/outputs.json';

const MARKER = '.artist-os-disposable-smoke.json';
const MARKER_BODY = '{"fixture":"artist-os-synthetic-smoke","version":1}\n';
const CAMPAIGN_ID = 'smoke-campaign';

function rejectSymlinks(path: string, recursive = false): void {
  if (!existsSync(path)) {
    // lstat also detects dangling symlinks, which existsSync intentionally hides.
    try { if (lstatSync(path).isSymbolicLink()) throw new Error(`Symlink refused: ${path}`); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    return;
  }
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw new Error(`Symlink refused: ${path}`);
  if (recursive && stat.isDirectory()) {
    for (const child of readdirSync(path)) rejectSymlinks(join(path, child), true);
  }
}

/** Destination is a container for two fixture workspaces, never an existing app workspace. */
export function seedDisposableSmoke(destination: string): { hq: string; campaign: string } {
  if (process.env.NODE_ENV === 'production') throw new Error('Production seeding refused.');
  if (!isAbsolute(destination) || destination.split(sep).includes('..')) {
    throw new Error('Use an absolute disposable destination without traversal.');
  }
  const root = resolve(destination);
  if (dirname(root) === root) throw new Error('Filesystem root refused.');
  for (let path = root; ; path = dirname(path)) {
    rejectSymlinks(path);
    if (dirname(path) === path) break;
  }
  rejectSymlinks(root, true);
  const marker = join(root, MARKER);
  if (existsSync(root)) {
    if (!lstatSync(root).isDirectory()) throw new Error('Destination must be a directory.');
    if (existsSync(marker)) {
      if (readFileSync(marker, 'utf8') !== MARKER_BODY) throw new Error('Invalid disposable marker.');
      const allowed = new Set([MARKER, 'hq', 'campaign']);
      if (readdirSync(root).some(name => !allowed.has(name))) throw new Error('Unexpected files in fixture container.');
    } else if (readdirSync(root).length > 0) {
      throw new Error('Refusing existing unmarked workspace; choose a new or empty directory.');
    }
  }
  mkdirSync(root, { recursive: true });
  const lock = join(root, '.seeding');
  writeFileSync(lock, '', { flag: 'wx' });
  try {
    if (!existsSync(marker)) writeFileSync(marker, MARKER_BODY, { flag: 'wx' });
    const roots = { hq: join(root, 'hq'), campaign: join(root, 'campaign') };
    for (const scope of ['hq', 'campaign'] as const) {
      const workspaceRoot = roots[scope];
      const workspaceId = scope === 'hq' ? 'smoke-hq' : CAMPAIGN_ID;
      const doc = context[scope];
      // Existing directories, including incomplete or user-edited fixtures, are never overwritten.
      if (!existsSync(getContextDocDir(workspaceRoot, doc.slug))) {
        upsertContextDoc(workspaceRoot, {
          slug: doc.slug,
          metadata: { name: doc.name, routing: { mode: 'broadcast' }, enabled: true },
          body: '```json\n' + JSON.stringify({ ...doc.data, workspaceId, ...(scope === 'campaign' ? { campaignId: CAMPAIGN_ID } : {}) }, null, 2) + '\n```',
        });
      }
      const output = outputs[scope];
      if (!existsSync(getOutputDir(workspaceRoot, output.id))) {
        createOutputBundle(workspaceRoot, {
          ...output, workspaceId, kind: 'document', origin: { source: 'manual' },
          status: 'draft', contentMimeType: 'text/markdown', tags: ['synthetic-smoke'],
          context: scope === 'hq' ? { scope: 'hq' } : { scope: 'campaign', campaignId: CAMPAIGN_ID },
          approval: { state: 'none' },
        });
      }
    }
    return roots;
  } finally {
    rmSync(lock);
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--destination') {
    throw new Error('Usage: bun scripts/smoke/load-local-smoke-profile.ts --destination /absolute/disposable-directory');
  }
  console.log(JSON.stringify(seedDisposableSmoke(args[1]!), null, 2));
}
