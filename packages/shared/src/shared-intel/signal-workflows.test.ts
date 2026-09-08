import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SIGNAL_CONTRACT_WORKFLOWS, signalSourceLanes, createSignalContractWorkflow } from '../workflows/signal-workflows.ts';
import { STARTER_WORKFLOWS, HQ_DEFAULT_WORKFLOW_SLUGS, CAMPAIGN_DEFAULT_WORKFLOW_SLUGS } from '../workflows/starter-templates.ts';
import { parseWorkflowFile, serializeWorkflow } from '../workflows/parser.ts';
import { parseStructuredStepOutput } from '../workflows/output-schema.ts';
import { deleteGlobalWorkflow, ensureRequiredWorkflows, loadGlobalWorkflow, writeGlobalWorkflow } from '../workflows/storage.ts';
import { normalizeWorkflowTriggerInputs } from '../workflows/trigger-inputs.ts';

describe('new-contract Signal workflows', () => {
  test('legacy weekly scan retains its approved content with one explicit worker focus pin', () => {
    const legacy = STARTER_WORKFLOWS.find(workflow => workflow.slug === 'weekly-signal-scan')!;
    // Artist HQ still queues this workflow. The task-mode rollout pins its
    // existing YouTube scan discipline without changing the frozen Signals
    // instructions, inputs, ordering or output contract.
    expect(legacy.metadata.steps[0]?.taskModeId).toBe('weekly-intelligence');
    const frozenMetadata = {
      ...legacy.metadata,
      steps: legacy.metadata.steps.map((step, index) => {
        if (index !== 0) return step;
        const { taskModeId: _focus, ...frozenStep } = step;
        return frozenStep;
      }),
    };
    expect(createHash('sha256').update(serializeWorkflow(frozenMetadata, legacy.body)).digest('hex')).toBe('d4fcc0dcd8537e7ff9d7eba96551e863c9f1de44284eeb1b40baa2bb9b979b40');
  });
  test('new definitions use host packets, existing workers and host finalization', () => {
    for (const workflow of SIGNAL_CONTRACT_WORKFLOWS) {
      const parsed = parseWorkflowFile(serializeWorkflow(workflow.metadata, workflow.body))!;
      expect(parsed).not.toBeNull();
      expect(parsed.metadata.steps.map(step => step.id)).toEqual(['youtube-intel', 'synthesize']);
      expect(parsed.metadata.steps.map(step => step.agent)).toEqual(['youtube-intelligence-agent', 'signal-analyst-agent']);
      expect(parsed.metadata.outputs?.mode).toBe('none');
      expect(parsed.metadata.steps.every(step => step.input.includes('Signals v2'))).toBe(true);
      expect(parsed.metadata.steps.every(step => step.input.includes('{{trigger.signalPacket | escape}}'))).toBe(true);
      expect(parsed.metadata.steps.at(-1)!.input).toContain('{{steps.youtube-intel.output | escape}}');
      expect(parsed.metadata.steps.every(step => step.completion?.maxAgentMessages === 0)).toBe(true);
      expect(HQ_DEFAULT_WORKFLOW_SLUGS).not.toContain(workflow.slug);
      expect(CAMPAIGN_DEFAULT_WORKFLOW_SLUGS).not.toContain(workflow.slug);
      expect(parseStructuredStepOutput(JSON.stringify({ version: 1, outcome: 'no-change', markdown: '', examinedVideoIds: [], findings: [], ideas: [] }), parsed.metadata.steps.at(-1)!.outputSchema!).ok).toBe(true);
    }
  });
  test('Industry retains website lanes while World and links are video-only', () => {
    expect(signalSourceLanes('industry', 'scan')).toEqual(['youtube', 'platform', 'industry']);
    expect(signalSourceLanes('your-world', 'scan')).toEqual(['youtube']);
    expect(signalSourceLanes('industry', 'links')).toEqual(['youtube']);
    expect(createSignalContractWorkflow('industry', 'scan').slug).toBe('signals-industry-scan');
    expect(createSignalContractWorkflow('your-world', 'links').slug).toBe('signal-video-review');
  });
  test('generic queue normalization does not request host-only inputs before admission', () => {
    const dir = mkdtempSync(join(tmpdir(), 'signal-queue-inputs-'));
    const options = { globalWorkflowsDir: dir };
    try {
      for (const workflow of SIGNAL_CONTRACT_WORKFLOWS) {
        const loaded = writeGlobalWorkflow(workflow, options);
        const artistInputs = { track: 'your-world', mode: 'scan', artist_name: 'Artist' };
        const normalized = normalizeWorkflowTriggerInputs(loaded, { ...artistInputs, signalRequestId: 'host-request', signalPacket: '' });
        expect(normalized).toEqual({ ...artistInputs, signalRequestId: 'host-request', signalContract: 'signals-v1' });
        expect(normalizeWorkflowTriggerInputs(loaded, artistInputs)).toEqual({ ...artistInputs, signalContract: 'signals-v1' });
        for (const name of ['signalRequestId', 'signalContract', 'signalPacket']) {
          expect(loaded.metadata.trigger.inputs?.find(input => input.name === name)?.required).not.toBe(true);
        }
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  test('seeding honors custom definitions and deleted starters', () => {
    const dir = mkdtempSync(join(tmpdir(), 'signal-new-workflows-'));
    const options = { globalWorkflowsDir: dir };
    try {
      expect(ensureRequiredWorkflows(SIGNAL_CONTRACT_WORKFLOWS, options).ensured).toBe(3);
      const custom = { ...SIGNAL_CONTRACT_WORKFLOWS[0]!, body: '# My instructions' };
      writeGlobalWorkflow(custom, options);
      ensureRequiredWorkflows(SIGNAL_CONTRACT_WORKFLOWS, options);
      expect(loadGlobalWorkflow(custom.slug, options)?.body).toBe('# My instructions');
      deleteGlobalWorkflow(custom.slug, [], options);
      ensureRequiredWorkflows(SIGNAL_CONTRACT_WORKFLOWS, options);
      expect(loadGlobalWorkflow(custom.slug, options)).toBeNull();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
