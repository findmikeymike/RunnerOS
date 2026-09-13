import { describe, expect, test } from 'bun:test';
import { resolveAgentCapabilityExpansion as resolve, prepareAgentCapabilityExpansion, type AgentCapabilityExpansionInput } from './agent-capability-expansion.ts';

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
  test('focused limit is scoped to its recipe and still allows idempotent rereads', () => {
    const first = resolve(request());
    const second = resolve(request({ skillSlug: 'voice', skill: { ...request().skill!, slug: 'voice' }, expansions: first.expansions, inputMessageId: 'turn-2' }));
    const third = request({ skillSlug: 'campaign', skill: { ...request().skill!, slug: 'campaign' }, expansions: second.expansions, inputMessageId: 'turn-3' });
    third.taskMode = { ...third.taskMode!, id: 'new-focus', adjacentSkills: [{ slug: 'campaign', when: 'Campaign', expansion: 'same-session' }] };
    expect(resolve(third).result.alreadyLoaded).toBe(false);
    const originalFocusThird = { ...third, taskMode: { ...request().taskMode!, adjacentSkills: request().taskMode!.adjacentSkills.map(entry => entry.slug === 'campaign' ? { ...entry, expansion: 'same-session' as const } : entry) } };
    expect(() => resolve(originalFocusThird)).toThrow('two adjacent capabilities');
    expect(resolve(request({ expansions: second.expansions, inputMessageId: 'turn-3' })).result.alreadyLoaded).toBe(true);
  });
});


test('General chooses only needed skills across responses without a lifetime cap or added authority', () => {
  const base = request();
  const taskMode = { ...base.taskMode!, id: 'general', definitionRevision: 'task-mode-general-v1-test', primarySkills: [], adjacentSkills: ['visual', 'voice', 'campaign'].map(slug => ({ slug, when: 'needed', expansion: 'same-session' as const })) };
  let expansions: AgentCapabilityExpansionInput['expansions'] = [];
  for (const [index, slug] of ['visual', 'voice', 'campaign', 'visual'].entries()) {
    const input = request({ taskMode, skillSlug: slug, skill: { ...base.skill!, slug }, inputMessageId: `turn-${index}`, expansions, currentSkillSlugs: [] });
    const result = resolve(input);
    expect(result.nextSkillSlugs).toEqual([slug]);
    expect(result.result.alreadyLoaded).toBe(false);
    expect(resolve({ ...input, expansions: result.expansions }).result.alreadyLoaded).toBe(true);
    expansions = result.expansions;
  }
  expect(expansions).toHaveLength(4);
  expect(() => resolve(request({ taskMode, skillSlug: 'outside' }))).toThrow('outside the worker inventory');
  expect(() => resolve(request({ taskMode, skill: { ...base.skill!, metadata: { ...base.skill!.metadata, requiredSources: ['new-account'] } } }))).toThrow('requires new sources');
  expect(() => resolve(request({ taskMode, skill: { ...base.skill!, metadata: { ...base.skill!.metadata, alwaysAllow: ['Write'] } } }))).toThrow('additional tool authority');
});


test('General registers only installed declared instructions after authority checks, and propagates registration failure', async () => {
  const input = request({ taskMode: { ...request().taskMode!, id: 'general', definitionRevision: 'task-mode-general-v1-test' } });
  let registrations = 0;
  const register = () => { registrations++; };
  await expect(prepareAgentCapabilityExpansion({ ...input, agentMetadata: { skills: [] } }, register)).rejects.toThrow('outside the worker inventory');
  await expect(prepareAgentCapabilityExpansion({ ...input, skill: null }, register)).rejects.toThrow('not installed');
  await expect(prepareAgentCapabilityExpansion({ ...input, skill: { ...input.skill!, metadata: { ...input.skill!.metadata, requiredSources: ['new-account'] } } }, register)).rejects.toThrow('requires new sources');
  await expect(prepareAgentCapabilityExpansion({ ...input, skill: { ...input.skill!, metadata: { ...input.skill!.metadata, alwaysAllow: ['Write'] } } }, register)).rejects.toThrow('additional tool authority');
  expect(registrations).toBe(0);
  expect((await prepareAgentCapabilityExpansion(input, register)).result.instructions).toBe(input.skill!.content);
  expect(registrations).toBe(1);
  await expect(prepareAgentCapabilityExpansion(input, () => { throw new Error('Registration failed'); })).rejects.toThrow('Registration failed');
  expect(input.expansions).toEqual([]);
});


test('General history does not exhaust or silently reuse a later focused capability', () => {
  const taskMode = { ...request().taskMode!, id: 'general', definitionRevision: 'task-mode-general-v1-test' };
  const first = resolve(request({ taskMode }));
  const second = resolve(request({ taskMode, skillSlug: 'voice', skill: { ...request().skill!, slug: 'voice' }, expansions: first.expansions, inputMessageId: 'turn-2' }));
  const focused = resolve(request({ expansions: second.expansions, inputMessageId: 'turn-3' }));
  expect(focused.result.alreadyLoaded).toBe(false);
  expect(focused.expansions).toHaveLength(3);
  expect(focused.receipt.taskModeId).toBe('artist-world');
});


test('General accepts a qualified declared reference only when trusted resolution supplies its alias', async () => {
  const slug = 'legacy:visual';
  const input = request({ skillSlug: slug, agentMetadata: { skills: [slug] }, taskMode: { ...request().taskMode!, id: 'general', definitionRevision: 'task-mode-general-v1-test', adjacentSkills: [{ slug, when: 'Visual work', expansion: 'same-session' }] }, skill: { ...request().skill!, slug: 'retained-visual-copy' } });
  expect(() => resolve(input)).toThrow('not installed and available');
  let registrations = 0;
  const result = await prepareAgentCapabilityExpansion({ ...input, skill: { ...input.skill!, aliases: [slug] } }, () => { registrations++; });
  expect(result.result.skillSlug).toBe(slug);
  expect(result.result.instructions).toBe(input.skill!.content);
  expect(result.nextSkillSlugs).toEqual(['narrative', slug]);
  expect(registrations).toBe(1);
  expect(() => resolve({ ...input, skill: { ...input.skill!, aliases: ['legacy:other'] } })).toThrow('not installed and available');
});
