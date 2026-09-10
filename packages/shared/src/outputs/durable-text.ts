import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createOutputBundle, getOutputDir, readOutputManifest, withOutputBundleLock, writeOutputManifest } from './storage.ts';
import { assertValidOutputId } from './validation.ts';

export interface DurableTextOutputInput {
  id: string;
  workspaceId: string;
  workflowRunId: string;
  workflowSlug: string;
  stepId: string;
  title: string;
  summary?: string;
  kind: 'report' | 'document';
  content: string;
  createdAt: string;
}

function syncPath(path: string): void {
  const fd = openSync(path, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

/** Reject links in all existing ancestors, including dangling links. */
function assertPlainPath(path: string): void {
  const absolute = resolve(path);
  let current = '/';
  for (const part of absolute.split('/').filter(Boolean)) {
    current = join(current, part);
    try { if (lstatSync(current).isSymbolicLink()) throw new Error('durable-output-symlink'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
}

/** Publish one immutable local text bundle. The complete directory is the commit marker. */
export function ensureDurableTextOutput(workspaceRootPath: string, input: DurableTextOutputInput): { outputId: string } {
  assertValidOutputId(input.id);
  if (!input.workspaceId || !input.workflowRunId || !input.workflowSlug || !input.stepId || !input.title.trim()
    || !['report', 'document'].includes(input.kind) || typeof input.content !== 'string'
    || !Number.isFinite(Date.parse(input.createdAt))) throw new Error('durable-output-invalid-input');
  // Resolve a trusted workspace alias once; never follow links below that root.
  const root = realpathSync(workspaceRootPath);
  const outputs = join(root, 'outputs');
  const finalDir = getOutputDir(root, input.id);
  assertPlainPath(outputs);
  assertPlainPath(join(root, 'context', '.locks', 'outputs', `${input.id}.lock`, 'owner.json'));
  assertPlainPath(finalDir);
  return withOutputBundleLock(root, input.id, () => {
    assertPlainPath(finalDir);
    const origin = { source: 'workflow' as const, workflowRunId: input.workflowRunId, workflowSlug: input.workflowSlug, stepId: input.stepId };
    const hash = createHash('sha256').update(input.content).digest('hex');
    // A private staging workspace keeps incomplete bundles out of normal Output listings.
    const stagingRoot = join(root, `.durable-output-${input.id}-${randomUUID()}`);
    assertPlainPath(stagingRoot);
    mkdirSync(stagingRoot, { mode: 0o700 });
    try {
      const expected = createOutputBundle(stagingRoot, { ...input, origin, contentMimeType: 'text/markdown',
        status: 'published', tags: ['show-in-canvas'] });
      // Stable across recovery and distinct from same-titled outputs created by other runs.
      expected.slug = `${expected.slug}-${input.id}`;
      writeOutputManifest(stagingRoot, expected);
      const stagedDir = getOutputDir(stagingRoot, input.id);
      if (existsSync(finalDir)) {
        assertPlainPath(join(finalDir, 'output.json'));
        assertPlainPath(join(finalDir, 'content.md'));
        const existing = readOutputManifest(root, input.id);
        if (!existing || JSON.stringify(existing) !== JSON.stringify(expected)
          || !existsSync(join(finalDir, 'content.md'))
          || createHash('sha256').update(readFileSync(join(finalDir, 'content.md'))).digest('hex') !== hash) {
          throw new Error('durable-output-conflict');
        }
        // A prior process may have died after rename but before the durability barrier.
        syncPath(join(finalDir, 'content.md'));
        syncPath(join(finalDir, 'output.json'));
        syncPath(finalDir);
        syncPath(outputs);
        syncPath(root);
        return { outputId: input.id };
      }
      syncPath(join(stagedDir, 'content.md'));
      syncPath(join(stagedDir, 'output.json'));
      syncPath(stagedDir);
      mkdirSync(outputs, { recursive: true });
      assertPlainPath(finalDir);
      renameSync(stagedDir, finalDir);
      syncPath(outputs);
      syncPath(root);
      return { outputId: input.id };
    } finally { rmSync(stagingRoot, { recursive: true, force: true }); }
  });
}
