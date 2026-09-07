import { expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deleteGlobalWorkflow, getGlobalWorkflowDir, SIGNAL_CONTRACT_WORKFLOW_SLUGS } from '@craft-agent/shared/workflows';
import { seedSignalWorkflows } from './seed-workflows';

test('incremental Signals starters preserve custom files and deletion tombstones', () => {
  const root = mkdtempSync(join(tmpdir(), 'signals-seed-'));
  const options = { globalWorkflowsDir: root };
  try {
    expect(seedSignalWorkflows(options)).toBe(3);
    const [custom, deleted] = SIGNAL_CONTRACT_WORKFLOW_SLUGS;
    const customPath = join(getGlobalWorkflowDir(custom, options), 'WORKFLOW.md');
    writeFileSync(customPath, 'Artist custom content, even if invalid');
    expect(deleteGlobalWorkflow(deleted, [], options)).toBe(true);
    expect(seedSignalWorkflows(options)).toBe(0);
    expect(readFileSync(customPath, 'utf8')).toBe('Artist custom content, even if invalid');
    expect(existsSync(join(getGlobalWorkflowDir(deleted, options), 'WORKFLOW.md'))).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
