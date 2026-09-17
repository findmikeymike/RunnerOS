import { existsSync, lstatSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { ensureRequiredWorkflows, getGlobalWorkflowDir, SIGNAL_CONTRACT_WORKFLOWS, parseWorkflowFile, serializeWorkflow, type WorkflowStorageOptions } from '@craft-agent/shared/workflows';

// Full normalized stock definitions, before the one-pass transcript workflow.
// Both released revisions: with and without the first step focus/task-mode hint.
const PREVIOUS_STOCK: Record<string, readonly string[]> = {
  'weekly-world-scan': ['827ae15b8c1c130f5394b6f0fa7f4cfad4a631cf426c94712ef4e691e7dfb283', '547a55f1d5e45ccac38ec912170fca0011f9b576ea8f4968ca714e0860de2771'],
  'signal-video-review': ['c88c008436f0c9d21bc37bb83dd3322ff03469aff7c28361574e992dc20d13d2', '4418df6d4279551b6b5bbd1315419e65f8ab1f954373082734a591c139c3fe3b'],
  'signals-industry-scan': ['da0bb088120f6f7935a3f8083438424cffe6bc9cc3c1f9eeab32dadd71d9cd20', '4b2849ae9dcb41d2f4bb57b473e91c98c81af7a5ae713a7392678004b4b9cc5f'],
};

/** Add missing starters and upgrade only exact previous stock; never activate or alter custom work. */
export function seedSignalWorkflows(options?: WorkflowStorageOptions): number {
  const missing = SIGNAL_CONTRACT_WORKFLOWS.filter(workflow => !existsSync(join(getGlobalWorkflowDir(workflow.slug, options), 'WORKFLOW.md')));
  let changed = ensureRequiredWorkflows(missing, options).ensured;
  for (const workflow of SIGNAL_CONTRACT_WORKFLOWS) {
    const path = join(getGlobalWorkflowDir(workflow.slug, options), 'WORKFLOW.md');
    if (!existsSync(path) || !lstatSync(path).isFile()) continue;
    const original = readFileSync(path, 'utf8');
    const parsed = parseWorkflowFile(original);
    if (!parsed || !PREVIOUS_STOCK[workflow.slug]?.includes(createHash('sha256').update(serializeWorkflow(parsed.metadata, parsed.body)).digest('hex'))) continue;
    const backup = `${path}.before-single-pass`;
    if (existsSync(backup)) {
      if (!lstatSync(backup).isFile() || readFileSync(backup, 'utf8') !== original) continue;
    } else writeFileSync(backup, original, { flag: 'wx', mode: 0o600 });
    const temp = `${path}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temp, serializeWorkflow(workflow.metadata, workflow.body), { flag: 'wx', mode: 0o600 });
      if (readFileSync(path, 'utf8') !== original) continue;
      renameSync(temp, path); changed++;
    } finally { rmSync(temp, { force: true }); }
  }
  return changed;
}
