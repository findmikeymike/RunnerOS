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
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readRun,
  STARTER_WORKFLOWS,
  writeRun,
  type LoadedWorkflow,
  type WorkflowMetadata,
  type WorkflowRunSnapshot,
} from '@craft-agent/shared/workflows';
import { writeAgentMessageReceipt } from '@craft-agent/shared/agent-messaging';
import { readOutput, type OutputManifest } from '@craft-agent/shared/outputs';
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
  deletedSessions: string[];
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
  const deletedSessions: string[] = [];
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
    deleteSession: async (sessionId) => {
      deletedSessions.push(sessionId);
    },
    getWorkspaceRootPath: (_workspaceId) => workspaceRoot,
    emit: (event) => {
      events.push(event);
    },
  };

  return {
    deps,
    sessions,
    deletedSessions,
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
  test('Content Mastermind runs exactly four isolated characters and creates one canonical portfolio output', async () => {
    const template = STARTER_WORKFLOWS.find((workflow) => workflow.slug === 'content-mastermind')!
    const workflow: LoadedWorkflow = {
      ...template,
      path: '/tmp/content-mastermind',
      source: 'global',
    }
    const nativeOutput = `NATIVE_KEEPER ${'n'.repeat(520)}`
    const anticipationOutput = `ANTICIPATION_KEEPER ${'a'.repeat(520)}`
    const absurdOutput = `ABSURD_KEEPER ${'z'.repeat(520)}`
    const finalOutput = `# Campaign Content Portfolio\n\nBIG_SWING ${'f'.repeat(1900)}`
    const h = makeHarness({
      stepOutputs: [nativeOutput, anticipationOutput, absurdOutput, finalOutput],
    })
    const runner = new WorkflowRunner(h.deps)

    await runner.start({
      workflow,
      workspaceId: WORKSPACE_ID,
      triggerInputs: {
        campaign_brief: 'Launch the single',
        locked_elements: 'Keep the chorus',
        production_context: 'Phone shoot plus one ambitious concept',
      },
    })
    await waitFor(() => lastCompleted(h.events) !== undefined)

    const completed = lastCompleted(h.events)!
    expect(completed.state).toBe('succeeded')
    expect(h.sessions.size).toBe(4)
    expect(completed.steps.map((step) => step.attempts)).toEqual([1, 1, 1, 1])
    expect(h.promptsSent[0]?.prompt).not.toContain('ANTICIPATION_KEEPER')
    expect(h.promptsSent[1]?.prompt).not.toContain('NATIVE_KEEPER')
    expect(h.promptsSent[2]?.prompt).not.toContain('NATIVE_KEEPER')
    expect(h.promptsSent[3]?.prompt).toContain('NATIVE_KEEPER')
    expect(h.promptsSent[3]?.prompt).toContain('ANTICIPATION_KEEPER')
    expect(h.promptsSent[3]?.prompt).toContain('ABSURD_KEEPER')
    expect([...h.sessions.values()].map((session) => (session.options as { spawnedFromAgent?: { agentSlug?: string } }).spawnedFromAgent?.agentSlug)).toEqual([
      'content-genius',
      'anticipation-director',
      'scroll-stopper',
      'content-director',
    ])
    expect(completed.outputIds).toHaveLength(1)
    const manifest = readOutput(workspaceRoot, completed.finalOutputId!)
    expect(manifest?.title).toBe('Campaign Content Mastermind')
    expect(manifest?.tags).toContain('show-in-canvas')
    expect(manifest?.origin.agentSlug).toBe('content-director')
    expect(manifest?.preview?.mode).toBe('markdown')
  })

  test('Paid Campaign Builder threads strategy into creative and both packets into one approval-ready final', async () => {
    const template = STARTER_WORKFLOWS.find((workflow) => workflow.slug === 'paid-campaign-builder')!
    const workflow: LoadedWorkflow = {
      ...template,
      path: '/tmp/paid-campaign-builder',
      source: 'global',
    }
    const strategyOutput = `STRATEGY_KEEPER ${'s'.repeat(920)}`
    const creativeOutput = `CREATIVE_KEEPER ${'c'.repeat(1220)}`
    const finalOutput = `# Paid Campaign Packet\n\nAPPROVAL_PACKET ${'f'.repeat(1650)}`
    const h = makeHarness({
      stepOutputs: [strategyOutput, creativeOutput, finalOutput],
    })
    const runner = new WorkflowRunner(h.deps)

    await runner.start({
      workflow,
      workspaceId: WORKSPACE_ID,
      triggerInputs: {
        campaign_brief: 'Launch the single on August 21',
        budget: '$1,500',
        platforms: 'Meta and Spotify',
        territories: 'US, UK, Canada',
        destination: 'Approved smart link',
        available_assets: 'Performance clip, cover art, and artist photos',
      },
    })
    await waitFor(() => lastCompleted(h.events) !== undefined)

    const completed = lastCompleted(h.events)!
    expect(completed.state).toBe('succeeded')
    expect(h.sessions.size).toBe(3)
    expect(completed.steps.map((step) => step.attempts)).toEqual([1, 1, 1])
    expect(h.promptsSent[0]?.prompt).not.toContain('CREATIVE_KEEPER')
    expect(h.promptsSent[1]?.prompt).toContain('STRATEGY_KEEPER')
    expect(h.promptsSent[2]?.prompt).toContain('STRATEGY_KEEPER')
    expect(h.promptsSent[2]?.prompt).toContain('CREATIVE_KEEPER')
    expect(h.promptsSent[2]?.prompt).toContain('never publish, launch, change budgets, or mutate an external account')
    expect([...h.sessions.values()].map((session) => (session.options as { spawnedFromAgent?: { agentSlug?: string } }).spawnedFromAgent?.agentSlug)).toEqual([
      'ads-strategist',
      'ad-creative-agent',
      'ads-agent',
    ])
    expect(completed.outputIds).toHaveLength(1)
    const manifest = readOutput(workspaceRoot, completed.finalOutputId!)
    expect(manifest?.title).toBe('Paid Campaign Builder')
    expect(manifest?.tags).toContain('show-in-canvas')
    expect(manifest?.origin.agentSlug).toBe('ads-agent')
    expect(manifest?.preview?.mode).toBe('markdown')
  })

  test('Industry Outreach Pipeline hands research to Outreach and creates one no-send final packet', async () => {
    const template = STARTER_WORKFLOWS.find((workflow) => workflow.slug === 'industry-outreach-pipeline')!
    const workflow: LoadedWorkflow = {
      ...template,
      path: '/tmp/industry-outreach-pipeline',
      source: 'global',
    }
    const hunterOutput = `HUNTER_TARGET_LIST ${'h'.repeat(1420)}`
    const finalOutput = `# Industry Outreach Packet\n\nAPPROVAL_ONLY ${'o'.repeat(1850)}`
    const h = makeHarness({
      stepOutputs: [hunterOutput, finalOutput],
    })
    h.setStepBehavior(0, async (record) => {
      record.toolUseCount = 1
    })
    h.setStepBehavior(1, async (record) => {
      record.toolUseCount = 1
    })
    const runner = new WorkflowRunner(h.deps)

    await runner.start({
      workflow,
      workspaceId: WORKSPACE_ID,
      triggerInputs: {
        campaign_brief: 'Alternative R&B single with a late-August release',
        outreach_goal: 'Find credible artist-development relationships',
        target_lanes: 'A&R, indie labels, managers, and sync',
        markets: 'US and UK',
        sender_identity: 'Artist manager',
        target_count: 10,
        draft_count: 3,
        enrichment_budget: 0,
      },
    })
    await waitFor(() => lastCompleted(h.events) !== undefined)

    const completed = lastCompleted(h.events)!
    expect(completed.state).toBe('succeeded')
    expect(h.sessions.size).toBe(2)
    expect(completed.steps.map((step) => step.attempts)).toEqual([1, 1])
    expect(h.promptsSent[0]?.prompt).not.toContain('HUNTER_TARGET_LIST')
    expect(h.promptsSent[0]?.prompt).toContain('Do not purchase contact enrichment during this step')
    expect(h.promptsSent[1]?.prompt).toContain('HUNTER_TARGET_LIST')
    expect(h.promptsSent[1]?.prompt).toContain('Later paid contact-enrichment planning ceiling:\n$0')
    expect(h.promptsSent[1]?.prompt).toContain('Do not perform paid lookup in this workflow')
    expect(h.promptsSent[1]?.prompt).toContain('create one private Gmail draft for each Ready Now finalist')
    expect([...h.sessions.values()].map((session) => (session.options as { spawnedFromAgent?: { agentSlug?: string } }).spawnedFromAgent?.agentSlug)).toEqual([
      'industry-hunter',
      'outreach-agent',
    ])
    expect(completed.outputIds).toHaveLength(1)
    const manifest = readOutput(workspaceRoot, completed.finalOutputId!)
    expect(manifest?.title).toBe('Industry Outreach Pipeline')
    expect(manifest?.tags).toContain('show-in-canvas')
    expect(manifest?.origin.agentSlug).toBe('outreach-agent')
    expect(manifest?.preview?.mode).toBe('markdown')
  })

  test('College Radio Campaign verifies once, hands off once, and creates one no-send final packet', async () => {
    const template = STARTER_WORKFLOWS.find((workflow) => workflow.slug === 'college-radio-campaign')!
    const workflow: LoadedWorkflow = {
      ...template,
      path: '/tmp/college-radio-campaign',
      source: 'global',
    }
    const verifiedOutput = `VERIFIED_RADIO_TARGETS ${'r'.repeat(1620)}`
    const finalOutput = `# College Radio Campaign\n\nAPPROVAL_ONLY ${'o'.repeat(1850)}`
    const h = makeHarness({
      stepOutputs: [verifiedOutput, finalOutput],
    })
    h.setStepBehavior(0, async (record) => {
      record.toolUseCount = 1
    })
    const runner = new WorkflowRunner(h.deps)

    await runner.start({
      workflow,
      workspaceId: WORKSPACE_ID,
      triggerInputs: {
        release_brief: 'Alternative single releasing September 18',
        sound_alikes: 'Japanese Breakfast, St. Vincent, Mitski',
        clean_status: 'Clean edit available',
        markets: 'Chicago, Austin, and college towns in the Midwest',
        station_count: 12,
        email_draft_count: 5,
        sender_identity: 'Artist manager',
        include_physical: false,
      },
    })
    await waitFor(() => lastCompleted(h.events) !== undefined)

    const completed = lastCompleted(h.events)!
    expect(completed.state).toBe('succeeded')
    expect(h.sessions.size).toBe(2)
    expect(completed.steps.map((step) => step.attempts)).toEqual([1, 1])
    expect(h.promptsSent[0]?.prompt).not.toContain('VERIFIED_RADIO_TARGETS')
    expect(h.promptsSent[0]?.prompt).toContain('Do not call create_output or message_agent')
    expect(h.promptsSent[1]?.prompt).toContain('VERIFIED_RADIO_TARGETS')
    expect(h.promptsSent[1]?.prompt).toContain('Include physical-submission targets:\nfalse')
    expect(h.promptsSent[1]?.prompt).toContain('create one private Gmail draft for each email-ready target')
    expect([...h.sessions.values()].map((session) => (session.options as { spawnedFromAgent?: { agentSlug?: string } }).spawnedFromAgent?.agentSlug)).toEqual([
      'college-radio-agent',
      'outreach-agent',
    ])
    expect(completed.outputIds).toHaveLength(1)
    const manifest = readOutput(workspaceRoot, completed.finalOutputId!)
    expect(manifest?.title).toBe('College Radio Campaign')
    expect(manifest?.tags).toContain('show-in-canvas')
    expect(manifest?.origin.agentSlug).toBe('outreach-agent')
    expect(manifest?.preview?.mode).toBe('markdown')
  })

  test('Merch Product Builder runs one bounded lead agent and creates one private-draft launch kit', async () => {
    const template = STARTER_WORKFLOWS.find((workflow) => workflow.slug === 'merch-product-builder')!
    const workflow: LoadedWorkflow = {
      ...template,
      path: '/tmp/merch-product-builder',
      source: 'global',
    }
    const finalOutput = `# Merch Launch Kit\n\nSHOPIFY_ROUTING_AND_APPROVALS ${'m'.repeat(2250)}`
    const h = makeHarness({
      stepOutputs: [finalOutput],
    })
    h.setStepBehavior(0, async (record) => {
      record.toolUseCount = 1
    })
    const runner = new WorkflowRunner(h.deps)

    await runner.start({
      workflow,
      workspaceId: WORKSPACE_ID,
      triggerInputs: {
        artwork: '/workspace/vault/shirt-front.png',
        product_goal: 'One campaign shirt for the September single',
        product_preferences: 'Black and bone garments, centered full front',
        target_market: 'United States',
        mockup_request: true,
        artist_reference: '/workspace/vault/artist-face-reference.jpg',
        generation_budget: 0,
        sample_first: true,
      },
    })
    await waitFor(() => lastCompleted(h.events) !== undefined)

    const completed = lastCompleted(h.events)!
    expect(completed.state).toBe('succeeded')
    expect(h.sessions.size).toBe(1)
    expect(completed.steps.map((step) => step.attempts)).toEqual([1])
    expect(h.promptsSent[0]?.prompt).toContain('Lifestyle mockup requested:\ntrue')
    expect(h.promptsSent[0]?.prompt).toContain('Later image-generation planning ceiling:\n$0')
    expect(h.promptsSent[0]?.prompt).toContain('Do not generate or purchase imagery in this workflow')
    expect(h.promptsSent[0]?.prompt).toContain('Contact Art Director exactly once only when')
    expect(h.promptsSent[0]?.prompt).toContain('If Shopify validates successfully, contact Shopify Agent exactly once')
    expect(h.promptsSent[0]?.prompt).toContain('create-anew-product ... --private-draft --agent')
    expect(h.promptsSent[0]?.prompt).toContain('private artwork upload and one unpublished Printify product draft are the only allowed writes')
    expect(h.promptsSent[0]?.prompt).toContain('at most 2 agents across this workflow step')
    expect((h.sessions.values().next().value?.options as { launchReceipt?: { workflow?: { maxAgentMessages?: number } } }).launchReceipt?.workflow?.maxAgentMessages).toBe(2)
    expect([...h.sessions.values()].map((session) => (session.options as { spawnedFromAgent?: { agentSlug?: string } }).spawnedFromAgent?.agentSlug)).toEqual([
      'print-agent',
    ])
    expect(completed.outputIds).toHaveLength(1)
    const manifest = readOutput(workspaceRoot, completed.finalOutputId!)
    expect(manifest?.title).toBe('Merch Launch Kit')
    expect(manifest?.tags).toContain('show-in-canvas')
    expect(manifest?.origin.agentSlug).toBe('print-agent')
    expect(manifest?.preview?.mode).toBe('markdown')
  })

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
    expect(h.deletedSessions).toEqual(['sess-1', 'sess-2']);

    // Persisted to disk.
    const onDisk = readRun(workspaceRoot, completed.id);
    expect(onDisk).not.toBeNull();
    expect(onDisk!.state).toBe('succeeded');
    expect(onDisk!.steps[1]!.output).toBe('STEP_TWO_OUT');
  });

  test('Weekly Signal Scan carries one failed lane into a useful partial synthesis', async () => {
    const template = STARTER_WORKFLOWS.find((workflow) => workflow.slug === 'weekly-signal-scan')!;
    const metadata = structuredClone(template.metadata);
    for (const step of metadata.steps) {
      step.retries = 0;
      step.completion = { requireNonEmptyOutput: true, minOutputChars: 1 };
    }
    const workflow: LoadedWorkflow = { ...template, metadata, path: '/tmp/weekly-signal-scan', source: 'global' };
    const h = makeHarness({ stepOutputs: ['unused', 'platform evidence', 'industry evidence', 'partial brief'] });
    h.setStepBehavior(0, async () => { throw new Error('YouTube unavailable'); });
    const runner = new WorkflowRunner(h.deps);

    await runner.start({
      workflow,
      workspaceId: WORKSPACE_ID,
      triggerInputs: { artist_name: 'Artist', lookback_days: 7 },
    });
    await waitFor(() => lastCompleted(h.events) !== undefined);

    const completed = lastCompleted(h.events)!;
    expect(completed.state).toBe('succeeded');
    expect(completed.steps[0]!.state).toBe('failed');
    expect(completed.steps[1]!.state).toBe('succeeded');
    expect(h.promptsSent.at(-1)!.prompt).toContain('Workflow lane unavailable: youtube-intel failed');
    expect(h.promptsSent.at(-1)!.prompt).toContain('platform evidence');
    expect(h.promptsSent.at(-1)!.prompt).toContain('industry evidence');
  });

  test('Weekly Signal Scan names every unavailable collector lane without inventing packets', async () => {
    const template = STARTER_WORKFLOWS.find((workflow) => workflow.slug === 'weekly-signal-scan')!;
    const metadata = structuredClone(template.metadata);
    for (const step of metadata.steps) {
      step.retries = 0;
      step.completion = { requireNonEmptyOutput: true, minOutputChars: 1 };
    }
    const workflow: LoadedWorkflow = { ...template, metadata, path: '/tmp/weekly-signal-scan', source: 'global' };
    const h = makeHarness({ stepOutputs: ['unused', 'unused', 'unused', 'scan unavailable'] });
    h.setStepBehavior(0, async () => { throw new Error('YouTube unavailable'); });
    h.setStepBehavior(1, async () => { throw new Error('Platform unavailable'); });
    h.setStepBehavior(2, async () => { throw new Error('Industry unavailable'); });
    const runner = new WorkflowRunner(h.deps);

    await runner.start({
      workflow,
      workspaceId: WORKSPACE_ID,
      triggerInputs: { artist_name: 'Artist', lookback_days: 7 },
    });
    await waitFor(() => lastCompleted(h.events) !== undefined);

    const synthesisPrompt = h.promptsSent.at(-1)!.prompt;
    expect(lastCompleted(h.events)!.state).toBe('succeeded');
    expect(synthesisPrompt).toContain('Workflow lane unavailable: youtube-intel failed');
    expect(synthesisPrompt).toContain('Workflow lane unavailable: platform-watch failed');
    expect(synthesisPrompt).toContain('Workflow lane unavailable: industry-desk failed');
  });

  test('creates a default output from the final succeeded workflow step', async () => {
    const h = makeHarness({ stepOutputs: ['draft notes', '# Final report\n\nReady to ship.'] });
    const runner = new WorkflowRunner(h.deps);

    await runner.start({
      workflow: makeWorkflow({ outputs: { mode: 'final-step', kind: 'document', title: 'Configured portfolio title' } }),
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
      title: 'Configured portfolio title',
      kind: 'document',
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
    expect(manifest?.tags).toContain('show-in-canvas');
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

  test('creates the canonical final output when an earlier step attached evidence only', async () => {
    const evidenceOutputId = '11111111-2222-4333-8444-555555555555';
    const h = makeHarness({ stepOutputs: ['research evidence', '# Final director packet'] });
    h.setStepBehavior(0, async () => {
      const current = [...h.events]
        .reverse()
        .find((event): event is Extract<WorkflowRunEvent, { type: 'run.updated' }> => event.type === 'run.updated')
        ?.run;
      if (!current) throw new Error('run snapshot not emitted');
      writeRun(workspaceRoot, {
        ...current,
        outputIds: [evidenceOutputId],
        finalOutputId: undefined,
      });
    });

    const runner = new WorkflowRunner(h.deps);
    await runner.start({
      workflow: makeWorkflow({
        outputs: {
          mode: 'final-step',
          kind: 'document',
          title: 'Canonical director packet',
          primary: { from: 'step-output', step: 'second' },
        },
      }),
      workspaceId: WORKSPACE_ID,
      triggerInputs: { topic: 'canonical output' },
    });

    await waitFor(() => lastCompleted(h.events) !== undefined);

    const completed = lastCompleted(h.events)!;
    expect(completed.outputIds).toHaveLength(2);
    expect(completed.outputIds).toContain(evidenceOutputId);
    expect(completed.finalOutputId).not.toBe(evidenceOutputId);
    expect(readOutput(workspaceRoot, completed.finalOutputId!)?.origin.stepId).toBe('second');
  });

  test('rejects out-of-range starter workload before creating a session', async () => {
    const template = STARTER_WORKFLOWS.find((workflow) => workflow.slug === 'industry-outreach-pipeline')!;
    const workflow: LoadedWorkflow = { ...template, path: '/tmp/industry-outreach-pipeline', source: 'global' };
    const h = makeHarness();
    const runner = new WorkflowRunner(h.deps);

    await expect(runner.start({
      workflow,
      workspaceId: WORKSPACE_ID,
      triggerInputs: {
        campaign_brief: 'Launch',
        outreach_goal: 'Relationships',
        target_count: 1000,
      },
    })).rejects.toThrow('Workflow input "target_count" must be at most 25.');
    expect(h.sessions.size).toBe(0);
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

  test('workflow step records compact message_agent child receipts', async () => {
    const h = makeHarness({ stepOutputs: ['PARENT_DONE'] });
    const runner = new WorkflowRunner(h.deps);

    h.setStepBehavior(0, async (rec) => {
      const options = rec.options as {
        launchReceipt?: { workflow?: { runId?: string; stepId?: string } };
      };
      writeAgentMessageReceipt(workspaceRoot, {
        schemaVersion: 1,
        id: 'child-receipt-1',
        workspaceId: WORKSPACE_ID,
        parentSessionId: rec.id,
        parentRunId: options.launchReceipt?.workflow?.runId,
        parentStepId: options.launchReceipt?.workflow?.stepId,
        childSessionId: 'child-sess-1',
        callerAgentSlug: 'researcher',
        targetAgentSlug: 'critic',
        task: 'Review the parent step output.',
        status: 'succeeded',
        policy: {
          permissionMode: 'safe',
          timeoutSeconds: 120,
          maxTurns: 1,
          maxDepth: 3,
          depth: 1,
        },
        constraints: {
          sourceSlugs: [],
          skillSlugs: [],
        },
        result: {
          summary: 'Child review passed.',
          output: 'ok',
          toolUseCount: 1,
          toolNames: ['read_file'],
        },
        createdAt: '2026-06-23T10:00:00.000Z',
        updatedAt: '2026-06-23T10:00:01.000Z',
        completedAt: '2026-06-23T10:00:01.000Z',
      });
    });

    await runner.start({
      workflow: makeWorkflow({
        steps: [{ id: 'first', agent: 'researcher', input: 'Research {{trigger.topic}}' }],
      }),
      workspaceId: WORKSPACE_ID,
      triggerInputs: { topic: 'subagent tracing' },
    });

    await waitFor(() => lastCompleted(h.events) !== undefined);

    const completed = lastCompleted(h.events)!;
    expect(completed.steps[0]!.agentMessageReceipts).toEqual([
      {
        receiptId: 'child-receipt-1',
        childSessionId: 'child-sess-1',
        targetAgentSlug: 'critic',
        status: 'succeeded',
        summary: 'Child review passed.',
        createdAt: '2026-06-23T10:00:00.000Z',
        updatedAt: '2026-06-23T10:00:01.000Z',
        completedAt: '2026-06-23T10:00:01.000Z',
      },
    ]);

    const onDisk = readRun(workspaceRoot, completed.id);
    expect(onDisk?.steps[0]!.agentMessageReceipts).toEqual(completed.steps[0]!.agentMessageReceipts);
    expect(JSON.stringify(onDisk?.steps[0]!.agentMessageReceipts)).not.toContain('Review the parent step output');
  });

  test('workflow retry replaces stale message_agent child receipts', async () => {
    const h = makeHarness({ stepOutputs: ['unused', 'long enough'] });
    const runner = new WorkflowRunner(h.deps);

    function writeReceipt(rec: SessionRecord, id: string, summary: string): void {
      const options = rec.options as {
        launchReceipt?: { workflow?: { runId?: string; stepId?: string } };
      };
      writeAgentMessageReceipt(workspaceRoot, {
        schemaVersion: 1,
        id,
        workspaceId: WORKSPACE_ID,
        parentSessionId: rec.id,
        parentRunId: options.launchReceipt?.workflow?.runId,
        parentStepId: options.launchReceipt?.workflow?.stepId,
        childSessionId: `${id}-session`,
        targetAgentSlug: 'critic',
        task: `Child task for ${id}`,
        status: 'succeeded',
        policy: {
          permissionMode: 'safe',
          timeoutSeconds: 120,
          maxTurns: 1,
          maxDepth: 3,
          depth: 1,
        },
        constraints: {
          sourceSlugs: [],
          skillSlugs: [],
        },
        result: {
          summary,
          output: 'ok',
          toolUseCount: 0,
          toolNames: [],
        },
        createdAt: id === 'failed-attempt-receipt'
          ? '2026-06-23T10:00:00.000Z'
          : '2026-06-23T10:00:01.000Z',
        updatedAt: id === 'failed-attempt-receipt'
          ? '2026-06-23T10:00:00.000Z'
          : '2026-06-23T10:00:01.000Z',
        completedAt: id === 'failed-attempt-receipt'
          ? '2026-06-23T10:00:00.000Z'
          : '2026-06-23T10:00:01.000Z',
      });
    }

    h.setStepBehavior(0, async (rec) => {
      writeReceipt(rec, 'failed-attempt-receipt', 'stale failed attempt');
      throw new Error('first attempt failed');
    });
    h.setStepBehavior(1, async (rec) => {
      writeReceipt(rec, 'successful-attempt-receipt', 'fresh successful attempt');
    });

    await runner.start({
      workflow: makeWorkflow({
        steps: [{
          id: 'first',
          agent: 'researcher',
          input: 'Research {{trigger.topic}}',
          retries: 1,
        }],
      }),
      workspaceId: WORKSPACE_ID,
      triggerInputs: { topic: 'subagent retry tracing' },
    });

    await waitFor(() => lastCompleted(h.events) !== undefined);

    const completed = lastCompleted(h.events)!;
    expect(completed.steps[0]!.attempts).toBe(2);
    expect(completed.steps[0]!.agentMessageReceipts?.map((receipt) => receipt.receiptId)).toEqual([
      'successful-attempt-receipt',
    ]);
    expect(JSON.stringify(completed.steps[0]!.agentMessageReceipts)).not.toContain('failed-attempt-receipt');

    const onDisk = readRun(workspaceRoot, completed.id);
    expect(onDisk?.steps[0]!.agentMessageReceipts).toEqual(completed.steps[0]!.agentMessageReceipts);
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

  test('run post-processing executes after Output finalization and records failures', async () => {
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {});
    const h = makeHarness({ stepOutputs: ['STEP_ONE_OUT', 'STEP_TWO_OUT'] });
    let finalOutputSeen: string | undefined;
    h.deps.postProcessSucceededRun = (run) => {
      finalOutputSeen = run.finalOutputId;
      throw new Error('Signal routing failed.');
    };
    try {
      const runner = new WorkflowRunner(h.deps);
      await runner.start({
        workflow: makeWorkflow(),
        workspaceId: WORKSPACE_ID,
        triggerInputs: { topic: 'post-process' },
      });

      await waitFor(() => lastCompleted(h.events) !== undefined);
      const completed = lastCompleted(h.events)!;
      expect(finalOutputSeen).toBe(completed.finalOutputId);
      expect(completed.state).toBe('succeeded');
      expect(completed.outputError).toBe('Signal routing failed.');
      expect(readRun(workspaceRoot, completed.id)?.outputError).toBe('Signal routing failed.');
    } finally {
      errorSpy.mockRestore();
    }
  });

  test('does not persist success until Output finalization and post-processing finish', async () => {
    const h = makeHarness({ stepOutputs: ['STEP_ONE_OUT', 'STEP_TWO_OUT'] });
    let releasePostProcessing: (() => void) | undefined;
    const postProcessingGate = new Promise<void>((resolve) => {
      releasePostProcessing = resolve;
    });
    h.deps.postProcessSucceededRun = async () => {
      await postProcessingGate;
    };
    const runner = new WorkflowRunner(h.deps);
    const start = await runner.start({
      workflow: makeWorkflow(),
      workspaceId: WORKSPACE_ID,
      triggerInputs: { topic: 'finalization-race' },
    });

    await waitFor(() => readRun(workspaceRoot, start.id)?.finalOutputId !== undefined);
    const duringPostProcessing = readRun(workspaceRoot, start.id);
    expect(duringPostProcessing?.state).toBe('running');
    expect(lastCompleted(h.events)).toBeUndefined();

    releasePostProcessing!();
    await waitFor(() => lastCompleted(h.events) !== undefined);
    expect(readRun(workspaceRoot, start.id)?.state).toBe('succeeded');
  });

  test('cancellation during post-processing cannot be overwritten by success', async () => {
    const h = makeHarness({ stepOutputs: ['STEP_ONE_OUT', 'STEP_TWO_OUT'] });
    let releasePostProcessing: (() => void) | undefined;
    const postProcessingGate = new Promise<void>((resolve) => {
      releasePostProcessing = resolve;
    });
    let contextWritten = false;
    h.deps.postProcessSucceededRun = async (_run, signal) => {
      await postProcessingGate;
      signal.throwIfAborted();
      contextWritten = true;
    };
    const runner = new WorkflowRunner(h.deps);
    const start = await runner.start({
      workflow: makeWorkflow(),
      workspaceId: WORKSPACE_ID,
      triggerInputs: { topic: 'cancel-finalization-race' },
    });

    await waitFor(() => readRun(workspaceRoot, start.id)?.finalOutputId !== undefined);
    await runner.cancel(WORKSPACE_ID, start.id);
    releasePostProcessing!();

    await waitFor(() => lastCompleted(h.events) !== undefined);
    expect(lastCompleted(h.events)?.state).toBe('cancelled');
    expect(readRun(workspaceRoot, start.id)?.state).toBe('cancelled');
    expect(contextWritten).toBe(false);
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
          { id: 'second', agent: 'writer', input: 'Write fallback from {{steps.first.output}}' },
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
    expect(h.promptsSent.map((p) => p.prompt.split('\n\n---\n\n')[0])).toEqual([
      'Research t',
      'Write fallback from [Workflow lane unavailable: first failed (step-threw). recoverable]',
    ]);

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

  test('onFailure ask fails explicitly until checkpoint support exists', async () => {
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
    expect(completed.steps[0]!.error).toMatchObject({ code: 'on-failure-ask-unsupported' });
    expect(findUpdatedDetail(h.events, 'step.failed')).toMatchObject({
      onFailure: 'ask',
      error: { code: 'on-failure-ask-unsupported' },
    });
    expect(h.deletedSessions).toEqual(['sess-1']);
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
    expect(h.deletedSessions).toEqual(['sess-1', 'sess-2']);
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
    expect(h.deletedSessions).toEqual(['sess-1']);
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

  test('completion contract rejects prose when the required concrete Output is missing', async () => {
    const h = makeHarness({ stepOutputs: ['I created the complete report.'] });
    h.deps.getSessionOutputs = () => [];
    const runner = new WorkflowRunner(h.deps);

    await runner.start({
      workflow: makeWorkflow({
        steps: [{
          id: 'first',
          agent: 'researcher',
          input: 'Research {{trigger.topic}}',
          completion: {
            requiredOutput: {
              kind: 'report',
              title: 'Weekly YouTube Intelligence Report',
              requirePrimary: true,
            },
          },
        }],
      }),
      workspaceId: WORKSPACE_ID,
      triggerInputs: { topic: 'output gate' },
    });

    await waitFor(() => lastCompleted(h.events) !== undefined);
    const completed = lastCompleted(h.events)!;
    expect(completed.state).toBe('failed');
    expect(completed.steps[0]!.error?.code).toBe('completion-required-output-missing');
    expect(h.promptsSent[0]!.prompt).toContain('text in the final answer does not substitute for it');
  });

  test('completion contract accepts an exact Output with a primary asset', async () => {
    const h = makeHarness({ stepOutputs: ['Report summary for downstream synthesis.'] });
    const outputId = '11111111-1111-4111-8111-111111111111';
    const outputDir = join(workspaceRoot, 'outputs', outputId);
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(join(outputDir, 'report.md'), '# Report');
    h.deps.getSessionOutputs = (workspaceId, sessionId) => [{
      id: outputId,
      workspaceId,
      title: 'Weekly YouTube Intelligence Report',
      kind: 'report',
      status: 'published',
      summary: 'Report',
      origin: { source: 'workflow', sessionId },
      assets: [{ id: 'primary', role: 'primary', path: 'report.md', mimeType: 'text/markdown' }],
      primary: { id: 'primary', role: 'primary', path: 'report.md', mimeType: 'text/markdown' },
      createdAt: '2026-08-31T00:00:00.000Z',
      updatedAt: '2026-08-31T00:00:00.000Z',
    } as OutputManifest];
    const runner = new WorkflowRunner(h.deps);

    await runner.start({
      workflow: makeWorkflow({
        steps: [{
          id: 'first',
          agent: 'researcher',
          input: 'Research {{trigger.topic}}',
          completion: {
            requiredOutput: {
              kind: 'report',
              title: 'Weekly YouTube Intelligence Report',
              requirePrimary: true,
            },
          },
        }],
      }),
      workspaceId: WORKSPACE_ID,
      triggerInputs: { topic: 'output gate' },
    });

    await waitFor(() => lastCompleted(h.events) !== undefined);
    expect(lastCompleted(h.events)!.state).toBe('succeeded');
    expect(lastCompleted(h.events)!.steps[0]!.completion?.satisfied).toBe(true);
  });

  test('completion contract rejects an Output whose primary asset is missing', async () => {
    const h = makeHarness({ stepOutputs: ['Report summary for downstream synthesis.'] });
    h.deps.getSessionOutputs = (workspaceId, sessionId) => [{
      id: '22222222-2222-4222-8222-222222222222',
      workspaceId,
      title: 'Weekly YouTube Intelligence Report',
      kind: 'report',
      status: 'published',
      summary: 'Report',
      origin: { source: 'workflow', sessionId },
      assets: [{ id: 'primary', role: 'primary', path: 'missing.md', mimeType: 'text/markdown' }],
      primary: { id: 'primary', role: 'primary', path: 'missing.md', mimeType: 'text/markdown' },
      createdAt: '2026-08-31T00:00:00.000Z',
      updatedAt: '2026-08-31T00:00:00.000Z',
    } as OutputManifest];
    const runner = new WorkflowRunner(h.deps);

    await runner.start({
      workflow: makeWorkflow({
        steps: [{
          id: 'first',
          agent: 'researcher',
          input: 'Research {{trigger.topic}}',
          completion: {
            requiredOutput: {
              kind: 'report',
              title: 'Weekly YouTube Intelligence Report',
              requirePrimary: true,
            },
          },
        }],
      }),
      workspaceId: WORKSPACE_ID,
      triggerInputs: { topic: 'output gate' },
    });

    await waitFor(() => lastCompleted(h.events) !== undefined);
    expect(lastCompleted(h.events)!.state).toBe('failed');
    expect(lastCompleted(h.events)!.steps[0]!.error?.code).toBe('completion-required-output-missing');
  });

  test('completion contract rejects a readable directory as a primary asset', async () => {
    const h = makeHarness({ stepOutputs: ['Report summary for downstream synthesis.'] });
    const outputId = '33333333-3333-4333-8333-333333333333';
    mkdirSync(join(workspaceRoot, 'outputs', outputId, 'report-dir'), { recursive: true });
    h.deps.getSessionOutputs = (workspaceId, sessionId) => [{
      id: outputId,
      workspaceId,
      title: 'Weekly YouTube Intelligence Report',
      kind: 'report',
      status: 'published',
      summary: 'Report',
      origin: { source: 'workflow', sessionId },
      assets: [{ id: 'primary', role: 'primary', path: 'report-dir', mimeType: 'text/markdown' }],
      primary: { id: 'primary', role: 'primary', path: 'report-dir', mimeType: 'text/markdown' },
      createdAt: '2026-08-31T00:00:00.000Z',
      updatedAt: '2026-08-31T00:00:00.000Z',
    } as OutputManifest];
    const runner = new WorkflowRunner(h.deps);

    await runner.start({
      workflow: makeWorkflow({
        steps: [{
          id: 'first',
          agent: 'researcher',
          input: 'Research {{trigger.topic}}',
          completion: {
            requiredOutput: {
              kind: 'report',
              title: 'Weekly YouTube Intelligence Report',
              requirePrimary: true,
            },
          },
        }],
      }),
      workspaceId: WORKSPACE_ID,
      triggerInputs: { topic: 'output gate' },
    });

    await waitFor(() => lastCompleted(h.events) !== undefined);
    expect(lastCompleted(h.events)!.state).toBe('failed');
    expect(lastCompleted(h.events)!.steps[0]!.error?.code).toBe('completion-required-output-missing');
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

  test('rerun from a later step exposes skipped failed lanes as unavailable', async () => {
    const h = makeHarness({ stepOutputs: ['PARTIAL_SYNTHESIS'] });
    const runner = new WorkflowRunner(h.deps);
    const now = new Date().toISOString();
    const workflow = makeWorkflow({
      steps: [
        { id: 'collector', agent: 'researcher', input: 'Collect {{trigger.topic}}', onFailure: 'continue' },
        { id: 'synthesize', agent: 'writer', input: 'Synthesize {{steps.collector.output}}' },
      ],
    });
    const original: WorkflowRunSnapshot = {
      id: FAILED_RUN_ID,
      workflowSlug: workflow.slug,
      workspaceId: WORKSPACE_ID,
      state: 'failed',
      trigger: { type: 'manual', inputs: { topic: 'rerun' }, firedAt: now },
      workflowSnapshot: { metadata: workflow.metadata, body: workflow.body },
      steps: [
        {
          id: 'collector',
          state: 'failed',
          attempts: 1,
          error: { code: 'step-threw', message: 'collector offline' },
          completedAt: now,
        },
        {
          id: 'synthesize',
          state: 'failed',
          attempts: 1,
          error: { code: 'step-threw', message: 'synthesis failed' },
          completedAt: now,
        },
      ],
      createdAt: now,
      updatedAt: now,
      completedAt: now,
    };
    writeRun(workspaceRoot, original);

    const rerun = await runner.rerunFromStep({
      workspaceId: WORKSPACE_ID,
      runId: original.id,
      stepId: 'synthesize',
    });

    expect(rerun.steps[0]!.state).toBe('skipped');
    await waitFor(() => lastCompleted(h.events) !== undefined);
    expect(lastCompleted(h.events)?.state).toBe('succeeded');
    expect(h.promptsSent).toHaveLength(1);
    expect(h.promptsSent[0]!.prompt).toContain('Workflow lane unavailable: collector skipped (rerun-skipped-prior-step)');
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
    expect(escalationEvent.workspaceId).toBe(WORKSPACE_ID);
    const escId = escalationEvent.escalation.id;
    escalationStore.approve(escId, { type: 'user', clientId: 'test-client' });

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
    escalationStore.reject(escalationEvent.escalation.id, { type: 'user', clientId: 'test-client' }, 'user denied');

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
