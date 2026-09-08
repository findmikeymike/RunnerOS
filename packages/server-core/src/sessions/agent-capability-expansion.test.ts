import { describe, expect, test } from 'bun:test';
import { resolveAgentCapabilityExpansion as resolve, type AgentCapabilityExpansionInput } from './agent-capability-expansion.ts';

function request(overrides: Partial<AgentCapabilityExpansionInput> = {}): AgentCapabilityExpansionInput {
  return {
    skillSlug: 'visual', reason: 'The story now needs a visual language',
    taskMode: { schemaVersion: 1, id: 'artist-world', label: 'World', definitionRevision: 'mode-v1', selectionSource: 'user', primarySkills: ['narrative'], adjacentSkills: [
      { slug: 'visual', when: 'Visual work', expansion: 'same-session' },
      { slug: 'voice', when: 'Voice work', expansion: 'same-session' },
      { slug: 'campaign', when: 'Rollout', expansion: 'delegate' },
    ], fullMode: false },
    agentMetadata: { skills: ['narrative', 'visual', 'voice', 'campaign'] },
    skill: { slug: 'visual', content: '# Visual\nComplete instructions.', metadata: { name: 'Visual', description: 'Visual work' } },
    expansions: [], inputMessageId: 'user-turn-1', enabledSourceSlugs: ['profile'], currentSkillSlugs: ['narrative'], now: 100,
    ...overrides,
  };
}

describe('host capability expansion policy', () => {
  test('delivers full instructions and a content revision without mutating host input', () => {
    const input = request();
    const before = structuredClone(input);
    const result = resolve(input);
    expect(result.result.instructions).toBe(input.skill!.content);
    expect(result.receipt.contentRevision).toMatch(/^[a-f0-9]{64}$/);
    expect(result.receipt.inputMessageId).toBe('user-turn-1');
    expect(result.nextSkillSlugs).toEqual(['narrative', 'visual']);
    expect(input).toEqual(before);
  });
  test('rejects missing admitted mode, unavailable inventory, missing instructions and handoff boundaries', () => {
    for (const overrides of [
      { taskMode: undefined }, { inputMessageId: '' }, { agentMetadata: { skills: [] } },
      { skill: null }, { skillSlug: 'campaign' }, { skillSlug: 'narrative' },
      { skill: { ...request().skill!, content: ' ' } },
    ]) expect(() => resolve(request(overrides))).toThrow();
  });
  test('refuses source enabling and new always-allow tool authority', () => {
    const skill = request().skill!;
    expect(() => resolve(request({ skill: { ...skill, metadata: { ...skill.metadata, requiredSources: ['new-account'] } } }))).toThrow('requires new sources');
    expect(() => resolve(request({ skill: { ...skill, metadata: { ...skill.metadata, alwaysAllow: ['Write'] } } }))).toThrow('additional tool authority');
    expect(resolve(request({ skill: { ...skill, metadata: { ...skill.metadata, requiredSources: ['profile'], alwaysAllow: ['Read'] } }, authorizedToolNames: ['Read'] })).result.alreadyLoaded).toBe(false);
  });
  test('same skill and revision is idempotent across retries without spending another slot', () => {
    const first = resolve(request());
    const repeat = resolve(request({ expansions: first.expansions, currentSkillSlugs: first.nextSkillSlugs }));
    expect(repeat.result.alreadyLoaded).toBe(true);
    expect(repeat.expansions).toEqual(first.expansions);
    expect(repeat.nextSkillSlugs).toEqual(first.nextSkillSlugs);
    expect(() => resolve(request({ expansions: first.expansions, skill: { ...request().skill!, content: 'Changed instructions' } }))).toThrow('changed since');
  });
  test('refuses a second expansion on the admitted response but permits the next user turn', () => {
    const first = resolve(request());
    const next = request({ skillSlug: 'voice', skill: { ...request().skill!, slug: 'voice' }, expansions: first.expansions });
    expect(() => resolve(next)).toThrow('one new capability');
    expect(resolve({ ...next, inputMessageId: 'user-turn-2' }).expansions).toHaveLength(2);
  });
  test('session limit survives switching modes and still allows idempotent rereads', () => {
    const first = resolve(request());
    const second = resolve(request({ skillSlug: 'voice', skill: { ...request().skill!, slug: 'voice' }, expansions: first.expansions, inputMessageId: 'turn-2' }));
    const third = request({ skillSlug: 'campaign', skill: { ...request().skill!, slug: 'campaign' }, expansions: second.expansions, inputMessageId: 'turn-3' });
    third.taskMode = { ...third.taskMode!, id: 'new-focus', adjacentSkills: [{ slug: 'campaign', when: 'Campaign', expansion: 'same-session' }] };
    expect(() => resolve(third)).toThrow('two adjacent capabilities');
    expect(resolve(request({ expansions: second.expansions, inputMessageId: 'turn-3' })).result.alreadyLoaded).toBe(true);
  });
});
