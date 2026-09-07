import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { STARTER_AGENTS } from '../agent-definitions/starter-templates.ts';
import { deleteGlobalAgent, ensureRequiredAgents, loadGlobalAgent, writeGlobalAgent } from '../agent-definitions/storage.ts';
import { STARTER_WORKFLOWS } from '../workflows/starter-templates.ts';
import { deleteGlobalWorkflow, ensureRequiredWorkflows, loadGlobalWorkflow, writeGlobalWorkflow } from '../workflows/storage.ts';
import { SIGNAL_BRIEFING_INSTRUCTIONS } from './briefing.ts';
import { scheduledWorkDefinitionDigest } from '../scheduled-work/index.ts';

const roots: string[] = [];
function directory() {
  const root = mkdtempSync(join(tmpdir(), 'signal-briefing-template-'));
  roots.push(root);
  return root;
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const agent = STARTER_AGENTS.find(item => item.slug === 'signal-analyst-agent')!;
const workflow = STARTER_WORKFLOWS.find(item => item.slug === 'weekly-signal-scan')!;
const suffix = `\n\n${SIGNAL_BRIEFING_INSTRUCTIONS}`;

describe('Signal briefing shipped templates', () => {
  test('agent and workflow share the exact text-only contract without replacing the full report', () => {
    const synthesis = workflow.metadata.steps.find(step => step.id === 'synthesize')!;
    expect(agent.systemPrompt.endsWith(suffix)).toBe(true);
    expect(synthesis.input.endsWith(suffix)).toBe(true);
    for (const phrase of ['## Your Briefing', '120-150 words', '2-3 strongest supported insights',
      'only when the evidence', 'The full report has the details and sources.',
      'omit Your Briefing entirely', 'Do not generate audio']) {
      expect(synthesis.input).toContain(phrase);
    }
    expect(workflow.metadata.steps).toHaveLength(4);
    expect(workflow.metadata.outputs?.primary).toEqual({ from: 'step-output', step: 'synthesize' });
    expect(agent.systemPrompt).toContain('## Confidence and sources');
  });

  test('refreshes the old shipped agent prompt, preserves metadata, is idempotent', () => {
    const options = { globalAgentsDir: directory() };
    writeGlobalAgent({ ...agent, metadata: { ...agent.metadata, name: 'My Analyst' }, systemPrompt: agent.systemPrompt.slice(0, -suffix.length) }, options);
    ensureRequiredAgents([agent], options);
    expect(loadGlobalAgent(agent.slug, options)?.systemPrompt).toBe(agent.systemPrompt);
    expect(loadGlobalAgent(agent.slug, options)?.metadata.name).toBe('My Analyst');
    expect(ensureRequiredAgents([agent], options).ensured).toBe(0);
    expect(loadGlobalAgent(agent.slug, options)?.systemPrompt).toBe(agent.systemPrompt);
  });

  test('does not overwrite customized or resurrect deleted agent prompts', () => {
    const options = { globalAgentsDir: directory() };
    const custom = `${agent.systemPrompt.slice(0, -suffix.length)}\nMy custom direction.`;
    writeGlobalAgent({ ...agent, systemPrompt: custom }, options);
    ensureRequiredAgents([agent], options);
    expect(loadGlobalAgent(agent.slug, options)?.systemPrompt).toBe(custom);
    deleteGlobalAgent(agent.slug, [], options);
    ensureRequiredAgents([agent], options);
    expect(loadGlobalAgent(agent.slug, options)).toBeNull();
  });

  test('agent-only refresh preserves installed workflow bytes and both scheduled digest checks', () => {
    const options = { globalWorkflowsDir: directory() };
    const agentOptions = { globalAgentsDir: directory() };
    const old = structuredClone(workflow);
    old.metadata.steps.find(step => step.id === 'synthesize')!.input = workflow.metadata.steps.at(-1)!.input.slice(0, -suffix.length);
    old.metadata.steps[0]!.input += '\nCustom collector instruction.';
    old.metadata.name = 'My scan';
    old.body = '# My notes';
    writeGlobalWorkflow(old, options);
    writeGlobalAgent({ ...agent, systemPrompt: agent.systemPrompt.slice(0, -suffix.length) }, agentOptions);
    const file = join(options.globalWorkflowsDir, workflow.slug, 'WORKFLOW.md');
    const before = readFileSync(file, 'utf8');
    const saved = loadGlobalWorkflow(workflow.slug, options)!;
    // Both AutomationWorkQueue and SessionManager.startWorkflow use this exact digest payload.
    const workflowDigest = scheduledWorkDefinitionDigest({ metadata: saved.metadata, body: saved.body });
    const action = { type: 'queue-work', execution: { type: 'workflow-run', workflowSlug: workflow.slug, workflowDigest } };
    const configurationDigest = scheduledWorkDefinitionDigest({ matcherId: 'weekly', actionIndex: 0, event: 'SchedulerTick', action });
    ensureRequiredAgents([agent], agentOptions);
    ensureRequiredWorkflows([workflow], options);
    const loaded = loadGlobalWorkflow(workflow.slug, options)!;
    expect(readFileSync(file, 'utf8')).toBe(before);
    expect(scheduledWorkDefinitionDigest({ metadata: loaded.metadata, body: loaded.body })).toBe(workflowDigest);
    expect(scheduledWorkDefinitionDigest({ matcherId: 'weekly', actionIndex: 0, event: 'SchedulerTick', action })).toBe(configurationDigest);
    expect(loaded.metadata.steps.at(-1)!.input).toBe(old.metadata.steps.at(-1)!.input);
    expect(loadGlobalAgent(agent.slug, agentOptions)?.systemPrompt).toBe(agent.systemPrompt);
    expect(loaded.metadata.steps[0]!.input).toBe(old.metadata.steps[0]!.input);
    expect(loaded.metadata.name).toBe('My scan');
    expect(loaded.body).toBe(old.body);
    expect(ensureRequiredWorkflows([workflow], options).ensured).toBe(0);
    expect(loadGlobalWorkflow(workflow.slug, options)!.metadata).toEqual(loaded.metadata);
  });

  test('new installs receive the briefing workflow template', () => {
    const options = { globalWorkflowsDir: directory() };
    expect(ensureRequiredWorkflows([workflow], options).ensured).toBe(1);
    expect(loadGlobalWorkflow(workflow.slug, options)?.metadata.steps.at(-1)?.input).toContain(SIGNAL_BRIEFING_INSTRUCTIONS);
  });

  test('preserves custom synthesis input and deleted workflows', () => {
    const options = { globalWorkflowsDir: directory() };
    const custom = structuredClone(workflow);
    custom.metadata.steps.at(-1)!.input = 'My custom synthesis direction.';
    writeGlobalWorkflow(custom, options);
    ensureRequiredWorkflows([workflow], options);
    expect(loadGlobalWorkflow(workflow.slug, options)?.metadata.steps.at(-1)!.input).toBe('My custom synthesis direction.');
    deleteGlobalWorkflow(workflow.slug, [], options);
    ensureRequiredWorkflows([workflow], options);
    expect(loadGlobalWorkflow(workflow.slug, options)).toBeNull();
  });
});
