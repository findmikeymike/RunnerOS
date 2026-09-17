import { expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deleteGlobalWorkflow, getGlobalWorkflowDir, SIGNAL_CONTRACT_WORKFLOW_SLUGS, loadGlobalWorkflow, writeGlobalWorkflow, type WorkflowMetadata } from '@craft-agent/shared/workflows';
import { seedSignalWorkflows } from './seed-workflows';
import previousStock from './__fixtures__/signal-workflows-v2.json';

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

test('upgrades exact two-step stock to one synthesis pass and preserves originals', () => {
  const root = mkdtempSync(join(tmpdir(), 'signals-stock-upgrade-'));
  const options = { globalWorkflowsDir: root };
  try {
    for (const workflow of previousStock) writeGlobalWorkflow({ ...workflow, metadata: workflow.metadata as unknown as WorkflowMetadata }, options);
    const originals = previousStock.map(workflow => readFileSync(join(getGlobalWorkflowDir(workflow.slug, options), 'WORKFLOW.md'), 'utf8'));
    expect(seedSignalWorkflows(options)).toBe(3);
    for (const [index, workflow] of previousStock.entries()) {
      expect(loadGlobalWorkflow(workflow.slug, options)?.metadata.steps.map(step => step.id)).toEqual(['synthesize']);
      expect(readFileSync(join(getGlobalWorkflowDir(workflow.slug, options), 'WORKFLOW.md.before-single-pass'), 'utf8')).toBe(originals[index]);
    }
    expect(seedSignalWorkflows(options)).toBe(0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('stock with artist body, agent or task edits is not migrated', () => {
  const root = mkdtempSync(join(tmpdir(), 'signals-custom-upgrade-'));
  const options = { globalWorkflowsDir: root };
  try {
    for (const [index, original] of previousStock.entries()) {
      const workflow = structuredClone(original);
      if (index === 0) workflow.body += '\nArtist preference.';
      else if (index === 1) workflow.metadata.steps[0]!.agent = 'custom-agent';
      else workflow.metadata.steps[0]!.input += '\nKeep my approach.';
      writeGlobalWorkflow({ ...workflow, metadata: workflow.metadata as unknown as WorkflowMetadata }, options);
    }
    expect(seedSignalWorkflows(options)).toBe(0);
    for (const workflow of previousStock) {
      expect(loadGlobalWorkflow(workflow.slug, options)?.metadata.steps).toHaveLength(2);
      expect(existsSync(join(getGlobalWorkflowDir(workflow.slug, options), 'WORKFLOW.md.before-single-pass'))).toBe(false);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// Exact installed stock from before the first step acquired its task-mode hint.
test('upgrades actual installed Industry stock without a task mode and preserves its bytes', () => {
  const root = mkdtempSync(join(tmpdir(), 'signals-installed-upgrade-'));
  const options = { globalWorkflowsDir: root };
  try {
    seedSignalWorkflows(options);
    const path = join(getGlobalWorkflowDir('signals-industry-scan', options), 'WORKFLOW.md');
    const original = readFileSync(new URL('./__fixtures__/signals-industry-scan-before-single-pass.md', import.meta.url), 'utf8');
    writeFileSync(path, original);
    expect(loadGlobalWorkflow('signals-industry-scan', options)?.metadata.steps[0]?.taskModeId).toBeUndefined();
    expect(seedSignalWorkflows(options)).toBe(1);
    expect(loadGlobalWorkflow('signals-industry-scan', options)?.metadata.steps.map(step => [step.id, step.timeout])).toEqual([['synthesize', 300]]);
    expect(readFileSync(`${path}.before-single-pass`, 'utf8')).toBe(original);
    expect(seedSignalWorkflows(options)).toBe(0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('upgrades all old stock without the task-mode hint but preserves a custom hint', () => {
  const root = mkdtempSync(join(tmpdir(), 'signals-old-hint-upgrade-'));
  const options = { globalWorkflowsDir: root };
  try {
    for (const original of previousStock) {
      const workflow = structuredClone(original);
      delete workflow.metadata.steps[0]!.taskModeId;
      writeGlobalWorkflow({ ...workflow, metadata: workflow.metadata as unknown as WorkflowMetadata }, options);
    }
    expect(seedSignalWorkflows(options)).toBe(3);
    const workflow = structuredClone(previousStock[0]!);
    workflow.metadata.steps[0]!.taskModeId = 'artist-custom-mode';
    writeGlobalWorkflow({ ...workflow, metadata: workflow.metadata as unknown as WorkflowMetadata }, options);
    expect(seedSignalWorkflows(options)).toBe(0);
    expect(loadGlobalWorkflow(workflow.slug, options)?.metadata.steps[0]?.taskModeId).toBe('artist-custom-mode');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
