import { describe, expect, test } from 'bun:test';
import type { SessionToolContext } from '../context.ts';
import { handleMessageAgent } from './message-agent.ts';
import { handleListAgents } from './list-agents.ts';

function makeCtx(overrides?: Partial<SessionToolContext>): SessionToolContext {
  return {
    sessionId: 'parent',
    workspacePath: '/tmp/ws',
    get sourcesPath() { return '/tmp/ws/sources'; },
    get skillsPath() { return '/tmp/ws/skills'; },
    plansFolderPath: '/tmp/ws/plans',
    callbacks: {
      onPlanSubmitted: () => {},
      onAuthRequest: () => {},
    },
    fs: {} as SessionToolContext['fs'],
    loadSourceConfig: () => null,
    ...overrides,
  } as SessionToolContext;
}

describe('message_agent handler', () => {
  test('errors when capability is unavailable', async () => {
    const result = await handleMessageAgent(makeCtx(), {
      agentSlug: 'reviewer',
      task: 'Review this.',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('not available');
  });

  test('returns structured service result', async () => {
    const result = await handleMessageAgent(makeCtx({
      messageAgent: async (input) => ({
        ok: true,
        status: 'succeeded',
        receiptId: 'r1',
        childSessionId: 's2',
        agentSlug: input.agentSlug,
        output: 'Looks good.',
        summary: 'Looks good.',
        toolUseCount: 0,
        toolNames: [],
        durationMs: 12,
      }),
    }), {
      agentSlug: 'reviewer',
      task: 'Review this.',
    });

    expect(result.isError).toBe(false);
    expect(result.structuredContent?.receiptId).toBe('r1');
    expect(result.content[0]?.text).toContain('completed');
  });

  test('returns model-visible error text for failed service result', async () => {
    const result = await handleMessageAgent(makeCtx({
      messageAgent: async (input) => ({
        ok: false,
        status: 'timed-out',
        receiptId: 'r2',
        childSessionId: 's3',
        agentSlug: input.agentSlug,
        toolUseCount: 0,
        toolNames: [],
        durationMs: 12,
        error: { code: 'timeout', message: 'Delegated agent timed out.' },
      }),
    }), {
      agentSlug: 'reviewer',
      task: 'Review this.',
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent?.receiptId).toBe('r2');
    expect(result.content[0]?.text.startsWith('[ERROR]')).toBe(true);
    expect(result.content[0]?.text).toContain('timeout');
  });

  test('reports background start as success', async () => {
    const result = await handleMessageAgent(makeCtx({
      messageAgent: async (input) => ({
        ok: true,
        status: 'running',
        receiptId: 'r3',
        childSessionId: 's4',
        agentSlug: input.agentSlug,
        toolUseCount: 0,
        toolNames: [],
        durationMs: 2,
      }),
    }), {
      agentSlug: 'reviewer',
      task: 'Review this.',
      background: true,
    });

    expect(result.isError).toBe(false);
    expect(result.structuredContent?.status).toBe('running');
    expect(result.content[0]?.text).toContain('started delegated task in the background');
  });
});


describe('mode routing tool boundary', () => {
  test('passes discovered mode id unchanged to the delegation service', async () => {
    let selected: string | undefined;
    const result = await handleMessageAgent(makeCtx({ messageAgent: async input => {
      selected = input.taskModeId;
      return { ok: true, status: 'succeeded', agentSlug: input.agentSlug, toolUseCount: 0, toolNames: [], durationMs: 0 };
    } }), { agentSlug: 'branding-agent', task: 'Build an artist world', taskModeId: 'artist-world' });
    expect(result.isError).toBe(false);
    expect(selected).toBe('artist-world');
  });
  test('list_agents exposes concise mode metadata without changing authority fields', async () => {
    const agent = {
      slug: 'branding-agent', name: 'Branding', description: 'Branding work', active: true,
      skills: ['narrative', 'visual'], sources: [], tags: [], permissionMode: 'safe',
      sourceReadiness: { status: 'ready' as const, sources: [] },
      taskModes: [{ id: 'artist-world', label: 'Artist World', description: 'Story and visual world', fullMode: false }],
    };
    const result = await handleListAgents(makeCtx({ listAgents: () => ({ total: 1, returned: 1, agents: [agent] }) }), { activeOnly: true });
    const payload = JSON.parse(result.content[0]!.text!);
    expect(payload.agents[0].taskModes).toEqual(agent.taskModes);
    expect(payload.agents[0].permissionMode).toBe('safe');
    expect(payload.agents[0].skills).toEqual(['narrative', 'visual']);
  });
});
