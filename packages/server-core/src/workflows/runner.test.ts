/**
 * Workflows — runner tests
 *
 * Pure unit tests against a mock `WorkflowRunnerDeps`. We never spin up a
 * real SessionManager or hit an LLM. Persistence is verified by routing
 * `getWorkspaceRootPath` at a `mkdtempSync`'d directory and re-reading
 * the on-disk run.json.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readRun,
  writeRun,
  type LoadedWorkflow,
  type WorkflowMetadata,
  type WorkflowRunSnapshot,
} from '@craft-agent/shared/workflows';
import { readOutput } from '@craft-agent/shared/outputs';
import {
  WorkflowRunner,
  type WorkflowRunEvent,
  type WorkflowRunEventDetail,
  type WorkflowRunnerDeps,
} from './runner.ts';

// ----------------------------------------------------------------------------
// Test fixtures
// ----------------------------------------------------------------------------

let workspaceRoot: string;

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'wf-runner-'));
});

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true });
});

const WORKSPACE_ID = 'ws-test';
const ORPHANED_RUN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FAILED_RUN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const INVALID_STEP_RUN_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const MISSING_RUN_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const INACTIVE_RUN_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const TERMINAL_RUN_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

function makeWorkflow(metadata: Partial<WorkflowMetadata> = {}): LoadedWorkflow {
  const md: WorkflowMetadata = {
    name: 'Test',
    description: 'Test workflow',
    trigger: {
      type: 'manual',
      inputs: [{ name: 'topic', type: 'string', required: true }],
    },
    steps: [
      { id: 'first', agent: 'researcher', input: 'Research {{trigger.topic}}' },
      { id: 'second', agent: 'writer', input: 'Write about: {{steps.first.output}}' },
    ],
    ...metadata,
  };
  return {
    slug: 'test-flow',
    metadata: md,
    body: '',
    path: '/tmp/fake',
    source: 'global',
  };
}

interface SessionRecord {
  id: string;
  prompts: string[];
  output: string;
  aborted: boolean;
  options: unknown;
  toolUseCount: number;
}

interface MockHarness {
  deps: WorkflowRunnerDeps;
  sessions: Map<string, SessionRecord>;
  promptsSent: Array<{ sessionId: string; prompt: string }>;
  events: WorkflowRunEvent[];
  /** Override what `sendMessage` does for a given step index. */
  setStepBehavior: (index: number, fn: (record: SessionRecord) => Promise<void>) => void;
}

function makeHarness(opts: {
  stepOutputs?: string[];
  permissionMode?: 'safe' | 'ask' | 'allow-all';
  unavailableAgentSlugs?: string[];
} = {}): MockHarness {
  const sessions = new Map<string, SessionRecord>();
  const promptsSent: Array<{ sessionId: string; prompt: string }> = [];
  const events: WorkflowRunEvent[] = [];
  const stepBehaviors = new Map<number, (record: SessionRecord) => Promise<void>>();
  let stepCounter = 0;

  const deps: WorkflowRunnerDeps = {
    createSession: async (_workspaceId, _options) => {
      const id = `sess-${sessions.size + 1}`;
      const output = opts.stepOutputs?.[sessions.size] ?? `output-${sessions.size + 1}`;
      sessions.set(id, { id, prompts: [], output, aborted: false, options: _options, toolUseCount: 0 });
      return { id };
    },
    resolveAgentSessionOptions: async (_workspaceId, agentSlug) => ({
      customSystemPrompt: `persona:${agentSlug}`,
      agentSkillSlugs: [`${agentSlug}-skill`],
      enabledSourceSlugs: [`${agentSlug}-source`],
      llmConnection: `${agentSlug}-conn`,
      model: `${agentSlug}-model`,
      permissionMode: opts.permissionMode ?? 'safe',
      thinkingLevel: 'high',
      spawnedFromAgent: {
        agentSlug,
        agentName: `Agent ${agentSlug}`,
        timestamp: 1,
      },
      launchReceipt: {
        createdAt: 1,
        origin: 'agent',
        agent: {
          slug: agentSlug,
          name: `Agent ${agentSlug}`,
          description: `Agent ${agentSlug} description`,
        },
        config: {},
        injected: {
          systemPromptChars: `persona:${agentSlug}`.length,
          skills: [`${agentSlug}-skill`],
          sources: [`${agentSlug}-source`],
          contextDocs: [{ slug: `${agentSlug}-doc`, name: `${agentSlug} Doc` }],
        },
      },
    }),
    preflightStepAgent: async (_workspaceId, agentSlug) => {
      if (opts.unavailableAgentSlugs?.includes(agentSlug)) {
        throw new Error(`Agent not found: ${agentSlug}`);
      }
    },
    sendMessage: async (sessionId, prompt) => {
      const rec = sessions.get(sessionId);
      if (!rec) throw new Error(`unknown session ${sessionId}`);
      rec.prompts.push(prompt);
      promptsSent.push({ sessionId, prompt });
      const behavior = stepBehaviors.get(stepCounter);
      stepCounter += 1;
      if (behavior) await behavior(rec);
    },
    getLastAssistantText: (sessionId) => {
      const rec = sessions.get(sessionId);
      return rec?.output ?? '';
    },
    getSessionToolUseCount: (sessionId) => {
      return sessions.get(sessionId)?.toolUseCount ?? 0;
    },
    abortSession: async (sessionId) => {
      const rec = sessions.get(sessionId);
      if (rec) rec.aborted = true;
    },
    getWorkspaceRootPath: (_workspaceId) => workspaceRoot,
    emit: (event) => {
      events.push(event);
    },
  };

  return {
    deps,
    sessions,
    promptsSent,
    events,
    setStepBehavior: (index, fn) => stepBehaviors.set(index, fn),
  };
}

/** Wait until the predicate returns true or `maxMs` elapses. */
async function waitFor(pred: () => boolean, maxMs = 2000): Promise<void> {
  const start = Date.now();
  while (!pred() && Date.now() - start < maxMs) {
    await new Promise((r) => setTimeout(r, 5));
  }
  if (!pred()) throw new Error(`waitFor timed out after ${maxMs}ms`);
}

function lastCompleted(events: WorkflowRunEvent[]): WorkflowRunSnapshot | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.type === 'run.completed') return e.run;
  }
  return undefined;
}

function findUpdatedDetail(
  events: WorkflowRunEvent[],
  kind: WorkflowRunEventDetail['kind'],
): WorkflowRunEventDetail | undefined {
  for (const event of events) {
    if (event.type === 'run.updated' && event.detail?.kind === kind) return event.detail;
  }
  return undefined;
}

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe('WorkflowRunner', () => {
  test('happy path: 2-step workflow succeeds and threads outputs via templater', async () => {
    const h = makeHarness({ stepOutputs: ['STEP_ONE_OUT', 'STEP_TWO_OUT'] });
    const runner = new WorkflowRunner(h.deps);

    const start = await runner.start({
      workflow: makeWorkflow(),
      workspaceId: WORKSPACE_ID,
      triggerInputs: { topic: 'cats' },
    });

    expect(start.state).toBe('running');
    expect(start.steps).toHaveLength(2);

    await waitFor(() => lastCompleted(h.events) !== undefined);

    const completed = lastCompleted(h.events)!;
    expect(completed.state).toBe('succeeded');
    expect(completed.steps[0]!.state).toBe('succeeded');
    expect(completed.steps[0]!.output).toBe('STEP_ONE_OUT');
    expect(completed.steps[1]!.state).toBe('succeeded');
    expect(completed.steps[1]!.output).toBe('STEP_TWO_OUT');
    expect(h.sessions.get('sess-1')!.options).toMatchObject({
      customSystemPrompt: 'persona:researcher',
      agentSkillSlugs: ['researcher-skill'],
      enabledSourceSlugs: ['researcher-source'],
      permissionMode: 'safe',
      spawnedFromAgent: { agentSlug: 'researcher', agentName: 'Agent researcher' },
    });

    // Templater threading: step 1 received the trigger input, step 2
    // received step 1's output substituted into its prompt.
    expect(h.promptsSent[0]!.prompt).toStartWith('Research cats');
    expect(h.promptsSent[1]!.prompt).toStartWith('Write about: STEP_ONE_OUT');

    // Persisted to disk.
    const onDisk = readRun(workspaceRoot, completed.id);
    expect(onDisk).not.toBeNull();
    expect(onDisk!.state).toBe('succeeded');
    expect(onDisk!.steps[1]!.output).toBe('STEP_TWO_OUT');
  });

  test('creates a default output from the final succeeded workflow step', async () => {
    const h = makeHarness({ stepOutputs: ['draft notes', '# Final report\n\nReady to ship.'] });
    const runner = new WorkflowRunner(h.deps);

    await runner.start({
      workflow: makeWorkflow(),
      workspaceId: WORKSPACE_ID,
      triggerInputs: { topic: 'outputs' },
    });

    await waitFor(() => lastCompleted(h.events) !== undefined);

    const completed = lastCompleted(h.events)!;
    expect(completed.state).toBe('succeeded');
    expect(completed.finalOutputId).toBeString();
    const outputId = completed.finalOutputId!;
    expect(completed.outputIds).toEqual([outputId]);
    expect(completed.outputError).toBeUndefined();

    const manifest = readOutput(workspaceRoot, outputId);
    expect(manifest).toMatchObject({
      id: outputId,
      workspaceId: WORKSPACE_ID,
      title: 'Test output',
      kind: 'report',
      status: 'published',
      origin: {
        source: 'workflow',
        workflowRunId: completed.id,
        workflowSlug: 'test-flow',
        workflowName: 'Test',
        stepId: 'second',
        sessionId: 'sess-2',
      },
      preview: {
        mode: 'markdown',
      },
    });
    expect(manifest!.summary).toContain('Final report');
    expect(h.events.some((event) => event.type === 'outputs.updated')).toBe(true);
  });

  test('preserves explicit workflow outputs attached while the runner is active', async () => {
    const explicitOutputId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const h = makeHarness({
      stepOutputs: ['# Explicit report'],
    });
    h.setStepBehavior(0, async () => {
      const current = [...h.events]
        .reverse()
        .find((event): event is Extract<WorkflowRunEvent, { type: 'run.updated' }> => event.type === 'run.updated')
        ?.run;
      if (!current) throw new Error('run snapshot not emitted');
      writeRun(workspaceRoot, {
        ...current,
        outputIds: [explicitOutputId],
        finalOutputId: explicitOutputId,
      });
    });
    let defaultOutputCalled = false;
    h.deps.createDefaultWorkflowOutput = (run) => {
      defaultOutputCalled = true;
      return run;
    };

    const runner = new WorkflowRunner(h.deps);
    await runner.start({
      workflow: makeWorkflow({
        steps: [{ id: 'first', agent: 'researcher', input: 'Research {{trigger.topic}}' }],
      }),
      workspaceId: WORKSPACE_ID,
      triggerInputs: { topic: 'explicit outputs' },
    });

    await waitFor(() => lastCompleted(h.events) !== undefined);

    const completed = lastCompleted(h.events)!;
    expect(completed.state).toBe('succeeded');
    expect(completed.outputIds).toEqual([explicitOutputId]);
    expect(completed.finalOutputId).toBe(explicitOutputId);
    expect(defaultOutputCalled).toBe(false);
    const onDisk = readRun(workspaceRoot, completed.id);
    expect(onDisk!.outputIds).toEqual([explicitOutputId]);
    expect(onDisk!.finalOutputId).toBe(explicitOutputId);
  });

  test('default output creation failure is recorded without failing the run', async () => {
    const h = makeHarness({ stepOutputs: ['STEP_ONE_OUT', 'STEP_TWO_OUT'] });
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {});
    h.deps.createDefaultWorkflowOutput = () => {
      throw new Error('output disk full');
    };
    try {
      const runner = new WorkflowRunner(h.deps);

      await runner.start({
        workflow: makeWorkflow(),
        workspaceId: WORKSPACE_ID,
        triggerInputs: { topic: 'outputs' },
      });

      await waitFor(() => lastCompleted(h.events) !== undefined);

      const completed = lastCompleted(h.events)!;
      expect(completed.state).toBe('succeeded');
      expect(completed.finalOutputId).toBeUndefined();
      expect(completed.outputIds).toBeUndefined();
      expect(completed.outputError).toBe('output disk full');

      const onDisk = readRun(workspaceRoot, completed.id);
      expect(onDisk!.state).toBe('succeeded');
      expect(onDisk!.outputError).toBe('output disk full');
    } finally {
      errorSpy.mockRestore();
    }
  });

  test('workflow step records a compact agent execution receipt', async () => {
    const h = makeHarness({ stepOutputs: ['RECEIPT_OUT'] });
    const runner = new WorkflowRunner(h.deps);

    await runner.start({
      workflow: makeWorkflow({
        steps: [{ id: 'first', agent: 'researcher', input: 'Research {{trigger.topic}}' }],
      }),
      workspaceId: WORKSPACE_ID,
      triggerInputs: { topic: 'observability' },
    });

    await waitFor(() => lastCompleted(h.events) !== undefined);

    const completed = lastCompleted(h.events)!;
    const receipt = completed.steps[0]!.executionReceipt;
    expect(receipt).toMatchObject({
      agent: { slug: 'researcher', name: 'Agent researcher' },
      config: {
        model: 'researcher-model',
        llmConnection: 'researcher-conn',
        permissionMode: 'safe',
        thinkingLevel: 'high',
      },
      injected: {
        skills: ['researcher-skill'],
        sources: ['researcher-source'],
        contextDocs: {
          count: 1,
          docs: [{ slug: 'researcher-doc', name: 'researcher Doc' }],
        },
        systemPromptChars: 'persona:researcher'.length,
      },
    });
    expect(receipt?.prompt.chars).toBe(h.promptsSent[0]!.prompt.length);
    expect(receipt?.prompt.sha256).toBe(
      createHash('sha256').update(h.promptsSent[0]!.prompt).digest('hex'),
    );
    expect(JSON.stringify(receipt)).not.toContain('persona:researcher');

    const onDisk = readRun(workspaceRoot, completed.id);
    expect(onDisk?.steps[0]!.executionReceipt).toEqual(receipt);
  });

  test('hidden workflow steps downgrade interactive ask permission mode to safe', async () => {
    const h = makeHarness({ stepOutputs: ['DONE'], permissionMode: 'ask' });
    const runner = new WorkflowRunner(h.deps);

    await runner.start({
      workflow: makeWorkflow({
        steps: [{ id: 'first', agent: 'writer', input: 'Write {{trigger.topic}}' }],
      }),
      workspaceId: WORKSPACE_ID,
      triggerInputs: { topic: 'permission checks' },
    });

    await waitFor(() => lastCompleted(h.events) !== undefined);

    expect(h.sessions.get('sess-1')!.options).toMatchObject({
      hidden: true,
      permissionMode: 'safe',
      launchReceipt: {
        config: {
          permissionMode: 'safe',
        },
      },
    });
    expect(lastCompleted(h.events)!.steps[0]!.executionReceipt?.config.permissionMode).toBe('safe');
  });

  test('cancel mid-run: run is cancelled and active session is aborted exactly once', async () => {
    const h = makeHarness();
    const runner = new WorkflowRunner(h.deps);

    let runId: string | undefined;
    let resolveStep: (() => void) | undefined;
    const stepPending = new Promise<void>((resolve) => {
      resolveStep = resolve;
    });

    // Step 0 waits until we cancel, then resolves.
    h.setStepBehavior(0, async () => {
      await stepPending;
    });

    const start = await runner.start({
      workflow: makeWorkflow(),
      workspaceId: WORKSPACE_ID,
      triggerInputs: { topic: 't' },
    });
    runId = start.id;

    // Wait until the first session has been spawned + sendMessage entered.
    await waitFor(() => h.promptsSent.length === 1);

    const cancelled = await runner.cancel(WORKSPACE_ID, runId);
    expect(cancelled.state).toBe('cancelled');
    const cancelledOnDisk = readRun(workspaceRoot, runId);
    expect(cancelledOnDisk?.state).toBe('cancelled');
    expect(cancelledOnDisk?.steps[0]!.error?.code).toBe('cancelled');
    resolveStep!();

    await waitFor(() => lastCompleted(h.events) !== undefined);

    const completed = lastCompleted(h.events)!;
    expect(completed.state).toBe('cancelled');

    // Only the first session was spawned + aborted; second step never ran.
    expect(h.sessions.size).toBe(1);
    const onlySession = [...h.sessions.values()][0]!;
    expect(onlySession.aborted).toBe(true);
    expect(h.promptsSent).toHaveLength(1);
  });

  test('cancel reports missing and inactive runs accurately, returns terminal snapshot', async () => {
    const h = makeHarness();
    const runner = new WorkflowRunner(h.deps);
    const now = new Date().toISOString();

    await expect(runner.cancel(WORKSPACE_ID, MISSING_RUN_ID)).rejects.toThrow(/not found/);

    writeRun(workspaceRoot, {
      id: INACTIVE_RUN_ID,
      workflowSlug: 'test-flow',
      workspaceId: WORKSPACE_ID,
      state: 'running',
      trigger: { type: 'manual', inputs: { topic: 't' }, firedAt: now },
      workflowSnapshot: { metadata: makeWorkflow().metadata, body: '' },
      steps: [{ id: 'first', state: 'running', attempts: 1 }],
      createdAt: now,
      updatedAt: now,
    });
    await expect(runner.cancel(WORKSPACE_ID, INACTIVE_RUN_ID)).rejects.toThrow(/not active/);

    writeRun(workspaceRoot, {
      id: TERMINAL_RUN_ID,
      workflowSlug: 'test-flow',
      workspaceId: WORKSPACE_ID,
      state: 'failed',
      trigger: { type: 'manual', inputs: { topic: 't' }, firedAt: now },
      workflowSnapshot: { metadata: makeWorkflow().metadata, body: '' },
      steps: [{ id: 'first', state: 'failed', attempts: 1 }],
      createdAt: now,
      updatedAt: now,
      completedAt: now,
    });
    // Terminal-but-known: cancel-after-finish race returns the persisted snapshot.
    const terminalResult = await runner.cancel(WORKSPACE_ID, TERMINAL_RUN_ID);
    expect(terminalResult.state).toBe('failed');
    expect(terminalResult.id).toBe(TERMINAL_RUN_ID);
  });

  test('cancel returns the persisted snapshot when run is already terminal (succeeded)', async () => {
    const h = makeHarness({ stepOutputs: ['DONE_ONE', 'DONE_TWO'] });
    const runner = new WorkflowRunner(h.deps);

    const start = await runner.start({
      workflow: makeWorkflow(),
      workspaceId: WORKSPACE_ID,
      triggerInputs: { topic: 't' },
    });

    await waitFor(() => lastCompleted(h.events) !== undefined);
    expect(lastCompleted(h.events)!.state).toBe('succeeded');

    // After natural completion, cancel must not throw and must return the snapshot.
    const result = await runner.cancel(WORKSPACE_ID, start.id);
    expect(result.state).toBe('succeeded');
    expect(result.id).toBe(start.id);
  });

  test('output finalization failure marks outputError on the run', async () => {
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {});
    const h = makeHarness({ stepOutputs: ['STEP_ONE_OUT', 'STEP_TWO_OUT'] });
    h.deps.createDefaultWorkflowOutput = () => {
      throw new Error('output disk full');
    };
    try {
      const runner = new WorkflowRunner(h.deps);

      const start = await runner.start({
        workflow: makeWorkflow(),
        workspaceId: WORKSPACE_ID,
        triggerInputs: { topic: 'output-error' },
      });

      await waitFor(() => lastCompleted(h.events) !== undefined);

      // The last emitted snapshot from finalizeDefaultOutput should carry outputError.
      const updates = h.events.filter(
        (e): e is Extract<WorkflowRunEvent, { type: 'run.updated' }> => e.type === 'run.updated' && e.run.id === start.id,
      );
      const final = updates[updates.length - 1]!;
      expect(final.run.state).toBe('succeeded');
      expect(final.run.outputError).toBe('output disk full');

      // The run itself succeeded — output finalization is a side effect.
      const completed = lastCompleted(h.events)!;
      expect(completed.state).toBe('succeeded');

      // Persisted via OutputService.markWorkflowOutputError.
      const onDisk = readRun(workspaceRoot, start.id);
      expect(onDisk!.state).toBe('succeeded');
      expect(onDisk!.outputError).toBe('output disk full');
    } finally {
      errorSpy.mockRestore();
    }
  });

  test('step throws: run fails, second step is never run, error recorded', async () => {
    const h = makeHarness();
    const runner = new WorkflowRunner(h.deps);

    h.setStepBehavior(0, async () => {
      throw new Error('boom');
    });

    await runner.start({
      workflow: makeWorkflow(),
      workspaceId: WORKSPACE_ID,
      triggerInputs: { topic: 't' },
    });

    await waitFor(() => lastCompleted(h.events) !== undefined);

    const completed = lastCompleted(h.events)!;
    expect(completed.state).toBe('failed');
    expect(completed.steps[0]!.state).toBe('failed');
    expect(completed.steps[0]!.error).toEqual({ code: 'step-threw', message: 'boom' });
    expect(completed.steps[1]!.state).toBe('queued');
    expect(h.sessions.size).toBe(1);
  });

  test('onFailure continue records failed step and runs later steps', async () => {
    const h = makeHarness({ stepOutputs: ['unused', 'RECOVERED'] });
    const runner = new WorkflowRunner(h.deps);

    h.setStepBehavior(0, async () => {
      throw new Error('recoverable');
    });

    await runner.start({
      workflow: makeWorkflow({
        steps: [
          {
            id: 'first',
            agent: 'researcher',
            input: 'Research {{trigger.topic}}',
            onFailure: 'continue',
          },
          { id: 'second', agent: 'writer', input: 'Write fallback' },
        ],
      }),
      workspaceId: WORKSPACE_ID,
      triggerInputs: { topic: 't' },
    });

    await waitFor(() => lastCompleted(h.events) !== undefined);

    const completed = lastCompleted(h.events)!;
    expect(completed.state).toBe('succeeded');
    expect(completed.steps[0]!.state).toBe('failed');
    expect(completed.steps[0]!.error).toEqual({ code: 'step-threw', message: 'recoverable' });
    expect(completed.steps[1]!.state).toBe('succeeded');
    expect(completed.steps[1]!.output).toBe('RECOVERED');
    expect(h.promptsSent.map((p) => p.prompt.split('\n\n---\n\n')[0])).toEqual(['Research t', 'Write fallback']);

    expect(findUpdatedDetail(h.events, 'step.failed')).toMatchObject({
      kind: 'step.failed',
      stepId: 'first',
      attempts: 1,
      onFailure: 'continue',
      error: { code: 'step-threw', message: 'recoverable' },
    });

    const onDisk = readRun(workspaceRoot, completed.id);
    expect(onDisk?.state).toBe('succeeded');
    expect(onDisk?.steps[0]!.state).toBe('failed');
    expect(onDisk?.steps[1]!.state).toBe('succeeded');
  });

  test('onFailure ask is parsed by the runner but stops without checkpoint support', async () => {
    const h = makeHarness();
    const runner = new WorkflowRunner(h.deps);

    h.setStepBehavior(0, async () => {
      throw new Error('needs human');
    });

    await runner.start({
      workflow: makeWorkflow({
        steps: [
          {
            id: 'first',
            agent: 'researcher',
            input: 'Research {{trigger.topic}}',
            onFailure: 'ask',
          },
          { id: 'second', agent: 'writer', input: 'Write fallback' },
        ],
      }),
      workspaceId: WORKSPACE_ID,
      triggerInputs: { topic: 't' },
    });

    await waitFor(() => lastCompleted(h.events) !== undefined);

    const completed = lastCompleted(h.events)!;
    expect(completed.state).toBe('failed');
    expect(completed.steps[0]!.state).toBe('failed');
    expect(completed.steps[1]!.state).toBe('queued');
    expect(h.sessions.size).toBe(1);
    expect(findUpdatedDetail(h.events, 'step.failed')).toMatchObject({ onFailure: 'ask' });
  });

  test('structured output: parses JSON and exposes dot-paths to later steps', async () => {
    const h = makeHarness({
      stepOutputs: ['{"title":"Reliable workflows","count":2}', 'DONE'],
    });
    const runner = new WorkflowRunner(h.deps);

    await runner.start({
      workflow: makeWorkflow({
        steps: [
          {
            id: 'first',
            agent: 'researcher',
            input: 'Research {{trigger.topic}}',
            outputSchema: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                count: { type: 'number' },
              },
              required: ['title'],
            },
          },
          { id: 'second', agent: 'writer', input: 'Write about: {{steps.first.output.title}}' },
        ],
      }),
      workspaceId: WORKSPACE_ID,
      triggerInputs: { topic: 'cats' },
    });

    await waitFor(() => lastCompleted(h.events) !== undefined);

    const completed = lastCompleted(h.events)!;
    expect(completed.state).toBe('succeeded');
    expect(completed.steps[0]!.output).toEqual({ title: 'Reliable workflows', count: 2 });
    expect(h.promptsSent[0]!.prompt).toContain('Return only JSON');
    expect(h.promptsSent[0]!.prompt).toContain('"title"');
    expect(h.promptsSent[0]!.prompt.lastIndexOf('Return only JSON')).toBeGreaterThan(
      h.promptsSent[0]!.prompt.lastIndexOf('Workflow step completion contract'),
    );
    expect(h.promptsSent[1]!.prompt).toStartWith('Write about: Reliable workflows');
  });

  test('structured output retries after invalid JSON and records attempt count', async () => {
    const h = makeHarness({ stepOutputs: ['not json', '{"title":"Recovered"}'] });
    const runner = new WorkflowRunner(h.deps);

    await runner.start({
      workflow: makeWorkflow({
        steps: [
          {
            id: 'first',
            agent: 'researcher',
            input: 'Research {{trigger.topic}}',
            outputSchema: {
              type: 'object',
              properties: { title: { type: 'string' } },
              required: ['title'],
            },
            retries: 1,
          },
        ],
      }),
      workspaceId: WORKSPACE_ID,
      triggerInputs: { topic: 'cats' },
    });

    await waitFor(() => lastCompleted(h.events) !== undefined);

    const completed = lastCompleted(h.events)!;
    expect(completed.state).toBe('succeeded');
    expect(completed.steps[0]!.attempts).toBe(2);
    expect(completed.steps[0]!.output).toEqual({ title: 'Recovered' });
    expect(h.sessions.size).toBe(2);
    expect(findUpdatedDetail(h.events, 'step.retrying')).toMatchObject({
      kind: 'step.retrying',
      stepId: 'first',
      attempt: 1,
      maxAttempts: 2,
      error: { code: 'invalid-structured-output' },
    });
  });

  test('retry attempt clears stale output and completion evidence while running', async () => {
    const h = makeHarness({ stepOutputs: ['short', 'long enough'] });
    let releaseSecondAttempt: (() => void) | undefined;
    h.setStepBehavior(1, async () => {
      await new Promise<void>((resolve) => { releaseSecondAttempt = resolve; });
    });
    const runner = new WorkflowRunner(h.deps);

    await runner.start({
      workflow: makeWorkflow({
        steps: [{
          id: 'first',
          agent: 'researcher',
          input: 'Research {{trigger.topic}}',
          completion: { minOutputChars: 10 },
          retries: 1,
        }],
      }),
      workspaceId: WORKSPACE_ID,
      triggerInputs: { topic: 'cats' },
    });

    await waitFor(() => h.promptsSent.length === 2);
    const latest = [...h.events].reverse().find((event) => event.type === 'run.updated') as
      | Extract<WorkflowRunEvent, { type: 'run.updated' }>
      | undefined;
    expect(latest?.run.steps[0]!.attempts).toBe(2);
    expect(latest?.run.steps[0]!.state).toBe('running');
    expect(latest?.run.steps[0]!.output).toBeUndefined();
    expect(latest?.run.steps[0]!.completion).toBeUndefined();

    releaseSecondAttempt!();
    await waitFor(() => lastCompleted(h.events) !== undefined);
    expect(lastCompleted(h.events)!.state).toBe('succeeded');
  });

  test('timeout aborts the attempt and fails when retries are exhausted', async () => {
    const h = makeHarness();
    const runner = new WorkflowRunner(h.deps);
    h.setStepBehavior(0, async () => {
      await new Promise(() => {});
    });

    await runner.start({
      workflow: makeWorkflow({
        steps: [
          {
            id: 'first',
            agent: 'researcher',
            input: 'Research {{trigger.topic}}',
            timeout: 0.01,
          },
        ],
      }),
      workspaceId: WORKSPACE_ID,
      triggerInputs: { topic: 'cats' },
    });

    await waitFor(() => lastCompleted(h.events) !== undefined);

    const completed = lastCompleted(h.events)!;
    expect(completed.state).toBe('failed');
    expect(completed.steps[0]!.state).toBe('failed');
    expect(completed.steps[0]!.error?.code).toBe('timeout');
    expect(h.sessions.get('sess-1')!.aborted).toBe(true);
    expect(findUpdatedDetail(h.events, 'step.failed')).toMatchObject({
      kind: 'step.failed',
      stepId: 'first',
      attempts: 1,
      onFailure: 'stop',
      error: { code: 'timeout' },
      timeoutSeconds: 0.01,
    });
  });

  test('concurrency: starting a second run for the same workflow+workspace rejects', async () => {
    const h = makeHarness();
    const runner = new WorkflowRunner(h.deps);

    let release: (() => void) | undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    h.setStepBehavior(0, async () => {
      await gate;
    });

    await runner.start({
      workflow: makeWorkflow(),
      workspaceId: WORKSPACE_ID,
      triggerInputs: { topic: 't' },
    });

    // Wait until the first run has actually entered its first step.
    await waitFor(() => h.promptsSent.length === 1);

    await expect(
      runner.start({
        workflow: makeWorkflow(),
        workspaceId: WORKSPACE_ID,
        triggerInputs: { topic: 't' },
      }),
    ).rejects.toThrow(/already has an active run/);

    // Drain.
    release!();
    await waitFor(() => lastCompleted(h.events) !== undefined);
  });

  test('initial persist failure rejects start and releases the concurrency slot', async () => {
    const h = makeHarness();
    const blockedPath = join(workspaceRoot, 'not-a-directory');
    writeFileSync(blockedPath, 'blocked');
    let rootPath = blockedPath;
    h.deps.getWorkspaceRootPath = () => rootPath;
    const runner = new WorkflowRunner(h.deps);

    await expect(
      runner.start({
        workflow: makeWorkflow(),
        workspaceId: WORKSPACE_ID,
        triggerInputs: { topic: 't' },
      }),
    ).rejects.toThrow();

    rootPath = workspaceRoot;
    await runner.start({
      workflow: makeWorkflow(),
      workspaceId: WORKSPACE_ID,
      triggerInputs: { topic: 't' },
    });
    await waitFor(() => lastCompleted(h.events) !== undefined);
    expect(lastCompleted(h.events)!.state).toBe('succeeded');
  });

  test('unexpected loop crash marks run failed and releases the concurrency slot', async () => {
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {});
    const h = makeHarness();
    const blockedPath = join(workspaceRoot, 'not-a-directory');
    writeFileSync(blockedPath, 'blocked');
    let persistCall = 0;
    h.deps.getWorkspaceRootPath = () => {
      persistCall += 1;
      return persistCall === 2 ? blockedPath : workspaceRoot;
    };
    const runner = new WorkflowRunner(h.deps);

    try {
      const start = await runner.start({
        workflow: makeWorkflow(),
        workspaceId: WORKSPACE_ID,
        triggerInputs: { topic: 't' },
      });

      await waitFor(() => lastCompleted(h.events) !== undefined);
      const crashed = lastCompleted(h.events)!;
      expect(crashed.id).toBe(start.id);
      expect(crashed.state).toBe('failed');
      expect(crashed.steps[0]!.error?.code).toBe('runner-crashed');

      await runner.start({
        workflow: makeWorkflow(),
        workspaceId: WORKSPACE_ID,
        triggerInputs: { topic: 't' },
      });
      await waitFor(() => h.events.filter((e) => e.type === 'run.completed').length === 2);
    } finally {
      errorSpy.mockRestore();
    }
  });

  test('uses the run snapshot even if the source workflow object is mutated mid-run', async () => {
    const h = makeHarness({ stepOutputs: ['ONE', 'TWO'] });
    const runner = new WorkflowRunner(h.deps);
    const workflow = makeWorkflow();

    let release: (() => void) | undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    h.setStepBehavior(0, async () => {
      await gate;
    });

    await runner.start({
      workflow,
      workspaceId: WORKSPACE_ID,
      triggerInputs: { topic: 'snapshot' },
    });
    await waitFor(() => h.promptsSent.length === 1);

    workflow.metadata.name = 'Mutated';
    workflow.metadata.steps[1]!.input = 'MUTATED {{steps.first.output}}';
    release!();

    await waitFor(() => lastCompleted(h.events) !== undefined);
    const completed = lastCompleted(h.events)!;
    expect(completed.workflowSnapshot.metadata.name).toBe('Test');
    expect(h.promptsSent[1]!.prompt).toStartWith('Write about: ONE');
  });

  test('workflow step sessions are hidden from the main session list', async () => {
    const h = makeHarness();
    const runner = new WorkflowRunner(h.deps);

    await runner.start({
      workflow: makeWorkflow({ steps: [{ id: 'first', agent: 'researcher', input: 'Research {{trigger.topic}}' }] }),
      workspaceId: WORKSPACE_ID,
      triggerInputs: { topic: 'hidden' },
    });

    await waitFor(() => lastCompleted(h.events) !== undefined);
    expect((h.sessions.get('sess-1')!.options as { hidden?: boolean }).hidden).toBe(true);
  });

  test('completion contract fails a step that does not use tools when required', async () => {
    const h = makeHarness({ stepOutputs: ['Draft text'] });
    const runner = new WorkflowRunner(h.deps);

    await runner.start({
      workflow: makeWorkflow({
        steps: [{
          id: 'first',
          agent: 'researcher',
          input: 'Research {{trigger.topic}}',
          completion: { requireToolUse: true },
        }],
      }),
      workspaceId: WORKSPACE_ID,
      triggerInputs: { topic: 'tool gate' },
    });

    await waitFor(() => lastCompleted(h.events) !== undefined);
    const completed = lastCompleted(h.events)!;
    expect(completed.state).toBe('failed');
    expect(completed.steps[0]!.error?.code).toBe('completion-tool-use-required');
    expect(completed.steps[0]!.completion).toEqual({
      outputChars: 'Draft text'.length,
      toolUseCount: 0,
      satisfied: false,
    });
    expect(h.promptsSent[0]!.prompt).toContain('You must use at least one available tool');
  });

  test('completion contract accepts a step with required tool use and enough output', async () => {
    const h = makeHarness({ stepOutputs: ['A sufficiently detailed result'] });
    h.setStepBehavior(0, async (record) => {
      record.toolUseCount = 1;
    });
    const runner = new WorkflowRunner(h.deps);

    await runner.start({
      workflow: makeWorkflow({
        steps: [{
          id: 'first',
          agent: 'researcher',
          input: 'Research {{trigger.topic}}',
          completion: { requireToolUse: true, minOutputChars: 10 },
        }],
      }),
      workspaceId: WORKSPACE_ID,
      triggerInputs: { topic: 'tool gate' },
    });

    await waitFor(() => lastCompleted(h.events) !== undefined);
    const completed = lastCompleted(h.events)!;
    expect(completed.state).toBe('succeeded');
    expect(completed.steps[0]!.completion).toEqual({
      outputChars: 'A sufficiently detailed result'.length,
      toolUseCount: 1,
      satisfied: true,
    });
  });

  test('recovery marks orphaned running runs interrupted', () => {
    const h = makeHarness();
    const runner = new WorkflowRunner(h.deps);
    const now = new Date().toISOString();
    const orphaned: WorkflowRunSnapshot = {
      id: ORPHANED_RUN_ID,
      workflowSlug: 'test-flow',
      workspaceId: WORKSPACE_ID,
      state: 'running',
      trigger: { type: 'manual', inputs: { topic: 't' }, firedAt: now },
      workflowSnapshot: {
        metadata: makeWorkflow().metadata,
        body: '',
      },
      steps: [
        { id: 'first', state: 'succeeded', attempts: 1, output: 'DONE' },
        { id: 'second', state: 'running', attempts: 1, sessionId: 'lost-session' },
      ],
      createdAt: now,
      updatedAt: now,
    };
    writeRun(workspaceRoot, orphaned);

    const recovered = runner.recoverInterruptedRuns(
      [{ id: WORKSPACE_ID, rootPath: workspaceRoot }],
      'server restarted',
    );

    expect(recovered).toHaveLength(1);
    expect(recovered[0]!.state).toBe('interrupted');
    expect(recovered[0]!.resumeFromStepId).toBe('second');
    expect(recovered[0]!.steps[1]!.state).toBe('failed');
    expect(recovered[0]!.steps[1]!.error).toEqual({
      code: 'run-interrupted',
      message: 'server restarted',
    });

    const onDisk = readRun(workspaceRoot, orphaned.id);
    expect(onDisk?.state).toBe('interrupted');
    expect(onDisk?.interruptionReason).toBe('server restarted');
    expect(h.events.map((event) => event.type)).toEqual(['run.updated', 'run.completed']);
  });

  test('rerun from failed step preserves prior successful outputs for templates', async () => {
    const h = makeHarness({ stepOutputs: ['RERUN_SECOND'] });
    const runner = new WorkflowRunner(h.deps);
    const now = new Date().toISOString();
    const original: WorkflowRunSnapshot = {
      id: FAILED_RUN_ID,
      workflowSlug: 'test-flow',
      workspaceId: WORKSPACE_ID,
      state: 'failed',
      trigger: { type: 'manual', inputs: { topic: 'rerun' }, firedAt: now },
      workflowSnapshot: {
        metadata: makeWorkflow().metadata,
        body: 'original body',
      },
      steps: [
        {
          id: 'first',
          state: 'succeeded',
          attempts: 1,
          output: 'ORIGINAL_FIRST',
          completedAt: now,
        },
        {
          id: 'second',
          state: 'failed',
          attempts: 1,
          error: { code: 'step-threw', message: 'boom' },
          completedAt: now,
        },
      ],
      createdAt: now,
      updatedAt: now,
      completedAt: now,
    };
    writeRun(workspaceRoot, original);

    const rerun = await runner.rerunFromStep({ workspaceId: WORKSPACE_ID, runId: original.id });

    expect(rerun.id).not.toBe(original.id);
    expect(rerun.resumedFromRunId).toBe(original.id);
    expect(rerun.resumeFromStepId).toBe('second');
    expect(rerun.steps[0]!.state).toBe('succeeded');
    expect(rerun.steps[0]!.output).toBe('ORIGINAL_FIRST');

    await waitFor(() => lastCompleted(h.events) !== undefined);
    const completed = lastCompleted(h.events)!;
    expect(completed.state).toBe('succeeded');
    expect(completed.steps[0]!.output).toBe('ORIGINAL_FIRST');
    expect(completed.steps[1]!.output).toBe('RERUN_SECOND');
    expect(h.promptsSent).toHaveLength(1);
    expect(h.promptsSent[0]!.prompt).toStartWith('Write about: ORIGINAL_FIRST');

    const originalOnDisk = readRun(workspaceRoot, original.id);
    expect(originalOnDisk?.state).toBe('failed');
    expect(originalOnDisk?.steps[1]!.error?.message).toBe('boom');
    expect(originalOnDisk?.resumedByRunId).toBe(rerun.id);
  });

  test('start rejects missing step agents before persisting a running run', async () => {
    const h = makeHarness({ unavailableAgentSlugs: ['writer'] });
    const runner = new WorkflowRunner(h.deps);

    await expect(
      runner.start({
        workflow: makeWorkflow(),
        workspaceId: WORKSPACE_ID,
        triggerInputs: { topic: 'x' },
      }),
    ).rejects.toThrow(/Workflow step "second" references unavailable agent "writer"/);

    expect(h.sessions.size).toBe(0);
    expect(h.events).toHaveLength(0);
  });

  test('rerun rejects missing rerun step agents before persisting a running run', async () => {
    const h = makeHarness({ unavailableAgentSlugs: ['writer'] });
    const runner = new WorkflowRunner(h.deps);
    const now = new Date().toISOString();
    const original: WorkflowRunSnapshot = {
      id: FAILED_RUN_ID,
      workflowSlug: 'test-flow',
      workspaceId: WORKSPACE_ID,
      state: 'failed',
      trigger: { type: 'manual', inputs: { topic: 'rerun' }, firedAt: now },
      workflowSnapshot: {
        metadata: makeWorkflow().metadata,
        body: 'original body',
      },
      steps: [
        { id: 'first', state: 'succeeded', attempts: 1, output: 'ORIGINAL_FIRST' },
        { id: 'second', state: 'failed', attempts: 1 },
      ],
      createdAt: now,
      updatedAt: now,
      completedAt: now,
    };
    writeRun(workspaceRoot, original);

    await expect(
      runner.rerunFromStep({ workspaceId: WORKSPACE_ID, runId: original.id }),
    ).rejects.toThrow(/Workflow step "second" references unavailable agent "writer"/);

    expect(h.sessions.size).toBe(0);
    const originalOnDisk = readRun(workspaceRoot, original.id);
    expect(originalOnDisk?.resumedByRunId).toBeUndefined();
  });

  test('rerun rejects an invalid step id', async () => {
    const h = makeHarness();
    const runner = new WorkflowRunner(h.deps);
    const now = new Date().toISOString();
    writeRun(workspaceRoot, {
      id: INVALID_STEP_RUN_ID,
      workflowSlug: 'test-flow',
      workspaceId: WORKSPACE_ID,
      state: 'failed',
      trigger: { type: 'manual', inputs: { topic: 'rerun' }, firedAt: now },
      workflowSnapshot: {
        metadata: makeWorkflow().metadata,
        body: '',
      },
      steps: [
        { id: 'first', state: 'succeeded', attempts: 1, output: 'ORIGINAL_FIRST' },
        { id: 'second', state: 'failed', attempts: 1 },
      ],
      createdAt: now,
      updatedAt: now,
      completedAt: now,
    });

    await expect(
      runner.rerunFromStep({
        workspaceId: WORKSPACE_ID,
        runId: INVALID_STEP_RUN_ID,
        stepId: 'missing',
      }),
    ).rejects.toThrow(/Workflow step not found/);
    expect(h.sessions.size).toBe(0);
  });

  // -------------------------------------------------------------------------
  // R5: per-job toolset overrides (Hermes MIT — cron/scheduler.py:60-88,
  // cron/jobs.py:523/662). Verifies the precedence chain applied at
  // runner.executeStepAttempt before createSession.
  // -------------------------------------------------------------------------

  test('per-job toolset override replaces the agent default enabledSourceSlugs at session boot', async () => {
    const h = makeHarness({ stepOutputs: ['ok', 'ok2'] });
    const runner = new WorkflowRunner(h.deps);

    await runner.start({
      workflow: makeWorkflow(),
      workspaceId: WORKSPACE_ID,
      triggerInputs: {
        topic: 'demo',
        // R5 override — agent default would have been ['researcher-source'].
        enabled_source_slugs: ['github'],
      },
    });
    await waitFor(() => lastCompleted(h.events) !== undefined);

    // sess-1 boots with the per-job override, NOT the agent's default.
    expect((h.sessions.get('sess-1')!.options as { enabledSourceSlugs?: string[] }).enabledSourceSlugs).toEqual(['github']);
  });

  test('per-job override of empty array denies all sources (does not fall through to defaults)', async () => {
    const h = makeHarness({ stepOutputs: ['ok', 'ok2'] });
    const runner = new WorkflowRunner(h.deps);

    await runner.start({
      workflow: makeWorkflow(),
      workspaceId: WORKSPACE_ID,
      triggerInputs: {
        topic: 'demo',
        enabled_source_slugs: [],
      },
    });
    await waitFor(() => lastCompleted(h.events) !== undefined);

    // Empty array = explicit deny-all. Must propagate as [] to session, not
    // the agent's default ['researcher-source'].
    expect((h.sessions.get('sess-1')!.options as { enabledSourceSlugs?: string[] }).enabledSourceSlugs).toEqual([]);
  });

  test('no per-job override leaves agent default enabledSourceSlugs intact (backward compat)', async () => {
    const h = makeHarness({ stepOutputs: ['ok', 'ok2'] });
    const runner = new WorkflowRunner(h.deps);

    await runner.start({
      workflow: makeWorkflow(),
      workspaceId: WORKSPACE_ID,
      triggerInputs: { topic: 'demo' },
    });
    await waitFor(() => lastCompleted(h.events) !== undefined);

    expect((h.sessions.get('sess-1')!.options as { enabledSourceSlugs?: string[] }).enabledSourceSlugs)
      .toEqual(['researcher-source']);
  });

  test('per-platform config overrides agent default when per-job override is absent', async () => {
    const h = makeHarness({ stepOutputs: ['ok', 'ok2'] });
    const runner = new WorkflowRunner({
      ...h.deps,
      getPlatformToolsetConfig: () => ({
        workflow: { enabled_source_slugs: ['platform-source'] },
      }),
    });

    await runner.start({
      workflow: makeWorkflow(),
      workspaceId: WORKSPACE_ID,
      triggerInputs: { topic: 'demo' },
    });
    await waitFor(() => lastCompleted(h.events) !== undefined);

    expect((h.sessions.get('sess-1')!.options as { enabledSourceSlugs?: string[] }).enabledSourceSlugs)
      .toEqual(['platform-source']);
  });

  test('per-job override wins over per-platform config', async () => {
    const h = makeHarness({ stepOutputs: ['ok', 'ok2'] });
    const runner = new WorkflowRunner({
      ...h.deps,
      getPlatformToolsetConfig: () => ({
        workflow: { enabled_source_slugs: ['platform-source'] },
      }),
    });

    await runner.start({
      workflow: makeWorkflow(),
      workspaceId: WORKSPACE_ID,
      triggerInputs: { topic: 'demo', enabled_source_slugs: ['github'] },
    });
    await waitFor(() => lastCompleted(h.events) !== undefined);

    expect((h.sessions.get('sess-1')!.options as { enabledSourceSlugs?: string[] }).enabledSourceSlugs).toEqual(['github']);
  });

  test('malformed override does not crash the run; logs warning and uses agent default', async () => {
    const h = makeHarness({ stepOutputs: ['ok', 'ok2'] });
    const runner = new WorkflowRunner(h.deps);
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});

    try {
      await runner.start({
        workflow: makeWorkflow(),
        workspaceId: WORKSPACE_ID,
        // Invalid shape — string instead of string[].
        triggerInputs: { topic: 'demo', enabled_source_slugs: 'github' as unknown as string[] },
      });
      await waitFor(() => lastCompleted(h.events) !== undefined);
    } finally {
      warnSpy.mockRestore();
    }

    expect(lastCompleted(h.events)!.state).toBe('succeeded');
    expect((h.sessions.get('sess-1')!.options as { enabledSourceSlugs?: string[] }).enabledSourceSlugs)
      .toEqual(['researcher-source']);
  });

  // -------------------------------------------------------------------------
  // R7 / Plan 01-07: subconscious-mode hint resolution.
  //
  // Verifies the runner consults the precedence chain (per-job >
  // per-platform > default) and stashes the resolved hint on agentOptions
  // via the `__subconsciousMode` annotation so the bootstrap layer can
  // forward it. The actual escalate-on-write gate lives in the agent
  // layer; this test only asserts the runner-side plumbing.
  // -------------------------------------------------------------------------

  test('R7: per-job permission_mode "subconscious" stashes hint on agentOptions', async () => {
    const h = makeHarness({ stepOutputs: ['ok', 'ok2'] });
    const runner = new WorkflowRunner(h.deps);

    await runner.start({
      workflow: makeWorkflow(),
      workspaceId: WORKSPACE_ID,
      triggerInputs: { topic: 'demo', permission_mode: 'subconscious' },
    });
    await waitFor(() => lastCompleted(h.events) !== undefined);

    const opts = h.sessions.get('sess-1')!.options as {
      __subconsciousMode?: string;
    };
    expect(opts.__subconsciousMode).toBe('subconscious');
  });

  test('R7: per-job permission_mode "yolo" stashes hint on agentOptions', async () => {
    const h = makeHarness({ stepOutputs: ['ok', 'ok2'] });
    const runner = new WorkflowRunner(h.deps);

    await runner.start({
      workflow: makeWorkflow(),
      workspaceId: WORKSPACE_ID,
      triggerInputs: { topic: 'demo', permission_mode: 'yolo' },
    });
    await waitFor(() => lastCompleted(h.events) !== undefined);

    const opts = h.sessions.get('sess-1')!.options as {
      __subconsciousMode?: string;
    };
    expect(opts.__subconsciousMode).toBe('yolo');
  });

  test('R7: no per-job permission_mode → __subconsciousMode is unset (default)', async () => {
    const h = makeHarness({ stepOutputs: ['ok', 'ok2'] });
    const runner = new WorkflowRunner(h.deps);

    await runner.start({
      workflow: makeWorkflow(),
      workspaceId: WORKSPACE_ID,
      triggerInputs: { topic: 'demo' },
    });
    await waitFor(() => lastCompleted(h.events) !== undefined);

    const opts = h.sessions.get('sess-1')!.options as {
      __subconsciousMode?: string;
    };
    // "default" mode is a no-op at the gate, so we don't bother stashing.
    expect(opts.__subconsciousMode).toBeUndefined();
  });

  test('R7: per-platform permission_mode applies when per-job override is absent', async () => {
    const h = makeHarness({ stepOutputs: ['ok', 'ok2'] });
    const runner = new WorkflowRunner({
      ...h.deps,
      getPlatformToolsetConfig: () => ({
        workflow: { permission_mode: 'subconscious' },
      }),
    });

    await runner.start({
      workflow: makeWorkflow(),
      workspaceId: WORKSPACE_ID,
      triggerInputs: { topic: 'demo' },
    });
    await waitFor(() => lastCompleted(h.events) !== undefined);

    const opts = h.sessions.get('sess-1')!.options as {
      __subconsciousMode?: string;
    };
    expect(opts.__subconsciousMode).toBe('subconscious');
  });

  test('R7: per-job permission_mode wins over per-platform config', async () => {
    const h = makeHarness({ stepOutputs: ['ok', 'ok2'] });
    const runner = new WorkflowRunner({
      ...h.deps,
      getPlatformToolsetConfig: () => ({
        workflow: { permission_mode: 'subconscious' },
      }),
    });

    await runner.start({
      workflow: makeWorkflow(),
      workspaceId: WORKSPACE_ID,
      triggerInputs: { topic: 'demo', permission_mode: 'yolo' },
    });
    await waitFor(() => lastCompleted(h.events) !== undefined);

    const opts = h.sessions.get('sess-1')!.options as {
      __subconsciousMode?: string;
    };
    expect(opts.__subconsciousMode).toBe('yolo');
  });

  // -------------------------------------------------------------------------
  // R7 / Plan 01-07: real pause integration — agent-side simulator.
  //
  // The agent-side gate (`gateWriteAttempt`) is a published API on
  // `@craft-agent/shared/agent`. The runner forwards the resolved mode +
  // runId to its `createSession` dep via typed fields on `CreateSessionOptions`
  // (`subconsciousMode`, `workflowRunId`); a production agent backend reads
  // those, sets them on its instance, and invokes `gateWriteAttempt` from
  // its PreToolUse hook (see `claude-agent.ts`).
  //
  // We simulate that here by having the test's mock `createSession` invoke
  // `gateWriteAttempt` directly with the same fields the production agent
  // would read. This is sufficient to prove the runner→agent contract:
  // when the runner sets `subconsciousMode === 'subconscious'`, the gate
  // pauses; `approveEscalation` resumes and the closure runs; `rejectEscalation`
  // returns denied without running the closure.
  // -------------------------------------------------------------------------

  test('R7: subconscious mode pauses on write; approveEscalation resumes and executes', async () => {
    const {
      gateWriteAttempt,
      getEscalationStore,
      _resetSubconsciousModeForTests,
      _resetDefaultEscalationStore,
    } = await import('@craft-agent/shared/agent');

    _resetSubconsciousModeForTests();
    _resetDefaultEscalationStore();
    const escalationStore = getEscalationStore(':memory:');

    // Custom harness whose createSession simulates an agent calling
    // gateWriteAttempt on a write tool.
    const sessions = new Map<string, SessionRecord>();
    const events: WorkflowRunEvent[] = [];
    const toolExecuted: string[] = [];
    let gatePromise: Promise<unknown> | null = null;

    const deps: WorkflowRunnerDeps = {
      createSession: async (_wsId, options) => {
        const id = `sess-${sessions.size + 1}`;
        const isFirstStep = sessions.size === 0;
        sessions.set(id, {
          id,
          prompts: [],
          output: 'ok',
          aborted: false,
          options,
          toolUseCount: 0,
        });
        const o = options as {
          subconsciousMode?: 'default' | 'subconscious' | 'yolo';
          workflowRunId?: string;
        };
        if (isFirstStep && o.subconsciousMode === 'subconscious' && o.workflowRunId) {
          // Simulate the agent PreToolUse hook attempting a write tool.
          gatePromise = gateWriteAttempt({
            mode: o.subconsciousMode,
            toolName: 'Write',
            args: { path: '/tmp/x', contents: 'hi' },
            workflowRunId: o.workflowRunId,
            store: escalationStore,
            execute: async () => {
              toolExecuted.push('Write');
              return 'wrote';
            },
          });
        }
        return { id };
      },
      resolveAgentSessionOptions: async () => ({ permissionMode: 'safe' }),
      sendMessage: async () => {},
      getLastAssistantText: () => 'ok',
      abortSession: async () => {},
      getWorkspaceRootPath: () => workspaceRoot,
      emit: (event) => events.push(event),
    };

    const runner = new WorkflowRunner(deps);

    await runner.start({
      workflow: makeWorkflow(),
      workspaceId: WORKSPACE_ID,
      triggerInputs: { topic: 'demo', permission_mode: 'subconscious' },
    });

    // Wait for the gate to produce a pending escalation event via the
    // runner's notifier bridge.
    await waitFor(() => events.some((e) => e.type === 'escalation.created'));
    expect(gatePromise).not.toBeNull();
    expect(toolExecuted).toEqual([]); // write NOT yet executed — paused.

    // Assert an `escalation.created` event went out via deps.emit.
    expect(events.some((e) => e.type === 'escalation.created')).toBe(true);

    // Approve → gate resolves and replays execute(). Filter by event id so
    // this test is robust to leftover rows in the singleton SQLite store.
    const escalationEvent = events.find((e) => e.type === 'escalation.created');
    if (escalationEvent?.type !== 'escalation.created') throw new Error('no escalation event');
    const escId = escalationEvent.escalation.id;
    escalationStore.approve(escId);

    const outcome = (await gatePromise) as unknown as { kind: string; result?: unknown };
    expect(outcome.kind).toBe('executed');
    expect(outcome.result).toBe('wrote');
    expect(toolExecuted).toEqual(['Write']); // write replayed after approval.

    _resetSubconsciousModeForTests();
    _resetDefaultEscalationStore();
    escalationStore.close();
  });

  test('R7: subconscious mode pauses on write; rejectEscalation returns denied and does not execute', async () => {
    const {
      gateWriteAttempt,
      getEscalationStore,
      _resetSubconsciousModeForTests,
      _resetDefaultEscalationStore,
    } = await import('@craft-agent/shared/agent');

    _resetSubconsciousModeForTests();
    _resetDefaultEscalationStore();
    const escalationStore = getEscalationStore(':memory:');

    const sessions = new Map<string, SessionRecord>();
    const events: WorkflowRunEvent[] = [];
    const toolExecuted: string[] = [];
    let gatePromise: Promise<unknown> | null = null;

    const deps: WorkflowRunnerDeps = {
      createSession: async (_wsId, options) => {
        const id = `sess-${sessions.size + 1}`;
        const isFirstStep = sessions.size === 0;
        sessions.set(id, {
          id,
          prompts: [],
          output: 'ok',
          aborted: false,
          options,
          toolUseCount: 0,
        });
        const o = options as {
          subconsciousMode?: 'default' | 'subconscious' | 'yolo';
          workflowRunId?: string;
        };
        if (isFirstStep && o.subconsciousMode === 'subconscious' && o.workflowRunId) {
          gatePromise = gateWriteAttempt({
            mode: o.subconsciousMode,
            toolName: 'Edit',
            args: { path: '/tmp/y' },
            workflowRunId: o.workflowRunId,
            store: escalationStore,
            execute: async () => {
              toolExecuted.push('Edit');
              return 'edited';
            },
          });
        }
        return { id };
      },
      resolveAgentSessionOptions: async () => ({ permissionMode: 'safe' }),
      sendMessage: async () => {},
      getLastAssistantText: () => 'ok',
      abortSession: async () => {},
      getWorkspaceRootPath: () => workspaceRoot,
      emit: (event) => events.push(event),
    };

    const runner = new WorkflowRunner(deps);

    await runner.start({
      workflow: makeWorkflow(),
      workspaceId: WORKSPACE_ID,
      triggerInputs: { topic: 'demo', permission_mode: 'subconscious' },
    });

    await waitFor(() => events.some((e) => e.type === 'escalation.created'));
    expect(toolExecuted).toEqual([]);

    const escalationEvent = events.find((e) => e.type === 'escalation.created');
    if (escalationEvent?.type !== 'escalation.created') throw new Error('no escalation event');
    escalationStore.reject(escalationEvent.escalation.id, 'user denied');

    const outcome = (await gatePromise) as unknown as { kind: string; reason?: string };
    expect(outcome.kind).toBe('denied');
    expect(outcome.reason).toContain('rejected');
    expect(toolExecuted).toEqual([]); // never ran.

    _resetSubconsciousModeForTests();
    _resetDefaultEscalationStore();
    escalationStore.close();
  });

  test('R7: runner promotes subconscious mode + workflowRunId to typed fields on CreateSessionOptions', async () => {
    const h = makeHarness({ stepOutputs: ['ok', 'ok2'] });
    const runner = new WorkflowRunner(h.deps);

    const snap = await runner.start({
      workflow: makeWorkflow(),
      workspaceId: WORKSPACE_ID,
      triggerInputs: { topic: 'demo', permission_mode: 'subconscious' },
    });
    await waitFor(() => lastCompleted(h.events) !== undefined);

    const opts = h.sessions.get('sess-1')!.options as {
      subconsciousMode?: string;
      workflowRunId?: string;
    };
    expect(opts.subconsciousMode).toBe('subconscious');
    expect(opts.workflowRunId).toBe(snap.id);
  });
});
