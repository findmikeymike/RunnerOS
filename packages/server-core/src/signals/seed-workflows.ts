import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ensureRequiredWorkflows, getGlobalWorkflowDir, SIGNAL_CONTRACT_WORKFLOWS, type WorkflowStorageOptions } from '@craft-agent/shared/workflows';

/** Incremental library addition only. Never repair/overwrite a custom file or activate a workflow. */
export function seedSignalWorkflows(options?: WorkflowStorageOptions): number {
  const missing = SIGNAL_CONTRACT_WORKFLOWS.filter(workflow => !existsSync(join(getGlobalWorkflowDir(workflow.slug, options), 'WORKFLOW.md')));
  return ensureRequiredWorkflows(missing, options).ensured;
}
