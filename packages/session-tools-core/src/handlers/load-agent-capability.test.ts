import { describe, expect, test } from 'bun:test';
import type { SessionToolContext } from '../context.ts';
import { getToolDefsAsJsonSchema, LoadAgentCapabilitySchema, SESSION_TOOL_DEFS } from '../tool-defs.ts';
import { handleLoadAgentCapability } from './load-agent-capability.ts';

const context = (loadAgentCapability?: SessionToolContext['loadAgentCapability']) => ({ loadAgentCapability } as SessionToolContext);

describe('load_agent_capability', () => {
  test('fails visibly when the host callback is absent', async () => {
    const result = await handleLoadAgentCapability(context(), { skillSlug: 'narrative', reason: 'The story needs structure' });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('[ERROR]');
  });
  test('delivers exactly host-authorized instructions and preserves idempotent status', async () => {
    const seen: unknown[] = [];
    const result = await handleLoadAgentCapability(context(async input => {
      seen.push(input);
      return { skillSlug: input.skillSlug, instructions: '# Skill\nExact instructions.', alreadyLoaded: true };
    }), { skillSlug: ' narrative ', reason: ' Story work now ' });
    expect(seen).toEqual([{ skillSlug: 'narrative', reason: 'Story work now' }]);
    expect(result.isError).toBe(false);
    expect(result.content[0]?.text).toBe('Already loaded capability: narrative\n\n# Skill\nExact instructions.');
  });
  test.each(['Not declared by this mode', 'Requires another source', 'Only two expansions allowed'])('returns host refusal without fallback or local reads: %s', async reason => {
    const result = await handleLoadAgentCapability(context(async () => { throw new Error(reason); }), { skillSlug: 'narrative', reason: 'Story work' });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain(reason);
  });
  test('rejects invalid request before calling the host', async () => {
    let calls = 0;
    const ctx = context(async input => { calls++; return { skillSlug: input.skillSlug, instructions: 'Unexpected' }; });
    for (const input of [{ skillSlug: '../skill', reason: 'Read it' }, { skillSlug: 'narrative', reason: ' ' }]) {
      expect((await handleLoadAgentCapability(ctx, input)).isError).toBe(true);
      expect(LoadAgentCapabilitySchema.safeParse(input).success).toBe(false);
    }
    expect(calls).toBe(0);
  });
  test('does not claim success for wrong or empty host delivery', async () => {
    for (const delivery of [{ skillSlug: 'other', instructions: 'Wrong' }, { skillSlug: 'narrative', instructions: ' ' }]) {
      const result = await handleLoadAgentCapability(context(async () => delivery), { skillSlug: 'narrative', reason: 'Story work' });
      expect(result.isError).toBe(true);
    }
  });
  test('is registered for provider-neutral dispatch with the same schema', () => {
    const tool = SESSION_TOOL_DEFS.find(tool => tool.name === 'load_agent_capability');
    expect(tool?.handler).toBe(handleLoadAgentCapability);
    expect(tool?.inputSchema).toBe(LoadAgentCapabilitySchema);
    expect(tool?.safeMode).toBe('allow');
    expect(tool?.readOnly).toBe(false);
    expect(getToolDefsAsJsonSchema().some(tool => tool.name === 'load_agent_capability')).toBe(true);
  });
});
