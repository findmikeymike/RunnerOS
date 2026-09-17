import { describe, expect, test } from 'bun:test';
import { parseAgentFile, serializeAgent } from './storage.ts';
import { STARTER_AGENTS } from './starter-templates.ts';
import { buildAgentTaskModePromptSection, buildAgentTaskModeStarterPrompt, filterContextDocsForTaskMode, resolveAgentSessionTaskMode, resolveAgentTaskMode, selectTaskModeSourceSlugs } from './task-modes.ts';
import type { AgentMetadata, LoadedAgent } from './types.ts';

function testAgent(metadata: AgentMetadata): LoadedAgent {
  return {
    slug: 'test-agent',
    metadata,
    systemPrompt: 'Test.',
    path: '/tmp/test-agent',
    source: 'global',
  };
}

describe('agent task modes', () => {
  test('Artist Direction defines four focused choices and one explicit full bundle', () => {
    const branding = STARTER_AGENTS.find((agent) => agent.slug === 'branding-agent');
    expect(branding?.metadata.taskModes?.map((mode) => mode.id)).toEqual([
      'brand-audit',
      'voice-beliefs',
      'artist-world',
      'public-expression',
      'full-brand-system',
    ]);
    expect(branding?.metadata.taskModes?.find((mode) => mode.id === 'artist-world')?.primarySkillSlugs)
      .toEqual(['artist-narrative-universe', 'artist-visual-world-director']);
    expect(branding?.metadata.taskModes?.find((mode) => mode.id === 'full-brand-system')?.fullMode)
      .toBe(true);
  });

  test('resolves both primary skills while keeping related skills on-demand', () => {
    const branding = STARTER_AGENTS.find((agent) => agent.slug === 'branding-agent')! as LoadedAgent;
    const withAdjacent = { ...branding, metadata: { ...branding.metadata, taskModes: branding.metadata.taskModes!.map(mode => mode.id === 'artist-world' ? { ...mode, adjacentSkills: [{ slug: 'artist-brand-dna-audit', when: 'When identity needs clarification.', expansion: 'same-session' as const }] } : mode) } };
    const mode = resolveAgentTaskMode(withAdjacent, 'artist-world')!;

    expect(mode.primarySkillSlugs).toEqual(['artist-narrative-universe', 'artist-visual-world-director']);
    expect(mode.adjacentSkills.map((skill) => skill.slug)).toContain('artist-brand-dna-audit');
    expect(mode.fullMode).toBe(false);
    expect(mode.definitionRevision).toMatch(/^task-mode-v1-[a-f0-9]{8}$/);
    const prompt = buildAgentTaskModePromptSection(mode);
    expect(prompt).toContain('Use every selected primary skill together');
    expect(prompt).toContain('one coherent result');
    expect(prompt).toContain('available on demand — not preloaded');
    expect(prompt).toContain('call load_agent_capability with its skillSlug and the concrete reason');
    expect(prompt).toContain('Never preload adjacent skills just in case.');
  });

  test('builds a hidden conversational opener from the selected focus', () => {
    const branding = STARTER_AGENTS.find((agent) => agent.slug === 'branding-agent')! as LoadedAgent;
    const mode = resolveAgentTaskMode(branding, 'artist-world')!;
    const prompt = buildAgentTaskModeStarterPrompt(mode);

    expect(prompt).toContain('selected Artist World');
    expect(prompt).toContain('ask one sharp, useful opening question');
    expect(prompt).toContain('Do not mention this internal start signal');
  });

  test('narrows only prompt delivery and leaves unselected docs out of the launch set', () => {
    const branding = STARTER_AGENTS.find((agent) => agent.slug === 'branding-agent')! as LoadedAgent;
    const mode = resolveAgentTaskMode(branding, 'artist-world');
    const docs = [
      { slug: 'artist-profile' },
      { slug: 'artist-branding' },
      { slug: 'artist-network' },
    ];
    expect(filterContextDocsForTaskMode(docs, mode).map((doc) => doc.slug)).toEqual([
      'artist-profile',
      'artist-branding',
    ]);
  });

  test('Voice & Beliefs pairs conviction with public expression without loading all branding skills', () => {
    const branding = STARTER_AGENTS.find((agent) => agent.slug === 'branding-agent')! as LoadedAgent;
    const mode = resolveAgentTaskMode(branding, 'voice-beliefs')!;
    expect(mode.primarySkillSlugs).toEqual(['artist-belief-system', 'artist-brand-expression-strategist']);
    expect(mode.fullMode).toBe(false);
    expect(mode.adjacentSkills.some(skill => mode.primarySkillSlugs.includes(skill.slug))).toBe(false);
    expect(buildAgentTaskModeStarterPrompt(mode)).toContain('selected Voice & Convictions');
  });

  test('parser accepts focused bundles but still rejects multiple skills declared as a single focus', () => {
    const branding = STARTER_AGENTS.find((agent) => agent.slug === 'branding-agent')!;
    const metadata = structuredClone(branding.metadata);
    metadata.taskModes = metadata.taskModes!.filter(mode => mode.id === 'artist-world');
    expect(parseAgentFile(serializeAgent(metadata, 'Test.'))?.metadata.taskModes).toHaveLength(1);
    metadata.taskModes[0]!.kind = 'focus';
    const invalid = parseAgentFile(serializeAgent(metadata, 'Test.'))!;
    expect(invalid.metadata.taskModes ?? []).toHaveLength(0);
    expect(invalid.warnings.length).toBeGreaterThan(0);
  });

  test('rejects a mode that reaches outside the parent agent inventory', () => {
    const agent = testAgent({
      name: 'Test',
      description: 'Test.',
      skills: ['allowed'],
      taskModes: [{
        id: 'bad-mode',
        label: 'Bad',
        description: 'Bad mode.',
        kind: 'focus',
        primarySkillSlugs: ['not-allowed'],
      }],
    });
    expect(() => resolveAgentTaskMode(agent, 'bad-mode')).toThrow('unavailable skills');
  });

  test('round-trips nested task modes through AGENT.md frontmatter', () => {
    const branding = STARTER_AGENTS.find((agent) => agent.slug === 'branding-agent')!;
    const serialized = serializeAgent(branding.metadata, branding.systemPrompt);
    const parsed = parseAgentFile(serialized);

    expect(parsed?.warnings).toEqual([]);
    expect(parsed?.metadata.taskModes).toEqual(branding.metadata.taskModes);
  });

  test('keeps canonical focus recipes available for legacy-qualified built-in skills', () => {
    const manager = STARTER_AGENTS.find((agent) => agent.slug === 'concierge')!;
    const metadata = structuredClone(manager.metadata);
    metadata.skills = metadata.skills?.map((slug) => (
      slug === 'artist-manager-operating-system' ? `legacy:${slug}` : slug
    ));

    const parsed = parseAgentFile(serializeAgent(metadata, manager.systemPrompt))!;
    expect(parsed.metadata.taskModes).toEqual(manager.metadata.taskModes);
    expect(resolveAgentTaskMode({ ...manager, metadata: parsed.metadata }, 'this-week')?.primarySkillSlugs)
      .toEqual(['artist-manager-operating-system']);
  });
});

describe('focused adapter selection', () => {
  test('publishing chooses one ready declared route in policy order', () => {
    const mode = { id: 'publish', primarySkillSlugs: ['social-publishing'], requiredSourceSlugs: [], optionalSourceSlugs: ['printing-press-social', 'postiz', 'trypost'] };
    expect(selectTaskModeSourceSlugs(mode, ['trypost', 'postiz', 'printing-press-social', 'unrelated'])).toEqual(['trypost']);
    expect(selectTaskModeSourceSlugs(mode, ['postiz', 'printing-press-social'])).toEqual(['postiz']);
    expect(selectTaskModeSourceSlugs(mode, ['printing-press-social'])).toEqual(['printing-press-social']);
    expect(selectTaskModeSourceSlugs(mode, ['unrelated'])).toEqual([]);
    expect(selectTaskModeSourceSlugs({ ...mode, optionalSourceSlugs: ['postiz'] }, ['trypost', 'postiz'])).toEqual(['postiz']);
  });
  test('ordinary optional generation sources remain awareness-only even when usable', () => {
    const mode = { id: 'canvas', primarySkillSlugs: ['spotify-canvas-video'], requiredSourceSlugs: ['video-studio'], optionalSourceSlugs: ['media-generation', 'hypermotion'] };
    expect(selectTaskModeSourceSlugs(mode, ['video-studio', 'media-generation', 'hypermotion'])).toEqual(['video-studio']);
  });
});


describe('virtual General mode', () => {
  test('all starter workers expose only declared capabilities on demand', () => {
    for (const agent of STARTER_AGENTS) {
      if (agent.metadata.taskModes?.some(mode => mode.id === 'general')) continue;
      const mode = resolveAgentTaskMode(agent as LoadedAgent, 'general')!;
      expect(mode.primarySkillSlugs).toEqual([]);
      expect(mode.adjacentSkills.map(skill => skill.slug)).toEqual([...new Set(agent.metadata.skills ?? [])]);
      expect(mode.requiredSourceSlugs).toEqual([]);
      expect(selectTaskModeSourceSlugs(mode, mode.optionalSourceSlugs)).toEqual([]);
      expect(mode.fullMode).toBe(false);
      expect(buildAgentTaskModePromptSection(mode)).toContain('No topic selection is required');
      expect(filterContextDocsForTaskMode([{ slug: 'artist-profile' }, { slug: 'unrelated-domain' }], mode)).toEqual([{ slug: 'artist-profile' }]);
    }
  });
  test('preserves an explicit custom General recipe', () => {
    const agent = testAgent({ name: 'Custom', description: 'Test', skills: ['custom'], taskModes: [{ id: 'general', kind: 'focus', label: 'My General', description: 'Custom focus', primarySkillSlugs: ['custom'] }] });
    const mode = resolveAgentTaskMode(agent, 'general')!;
    expect(mode.primarySkillSlugs).toEqual(['custom']);
    expect(mode.definitionRevision).toStartWith('task-mode-v1-');
  });
});


test('session resolution defaults interactive workers to General but preserves unattended focus and Manager conversation', () => {
  const worker = STARTER_AGENTS.find(agent => agent.slug === 'world-builder')! as LoadedAgent;
  expect(resolveAgentSessionTaskMode(worker)?.id).toBe('general');
  expect(resolveAgentSessionTaskMode(worker, undefined, 'user')?.id).toBe('general');
  expect(resolveAgentSessionTaskMode(worker, undefined, 'handoff')?.id).toBe('general');
  expect(() => resolveAgentSessionTaskMode(worker, undefined, 'workflow')).toThrow('Choose a focus');
  expect(() => resolveAgentSessionTaskMode(worker, undefined, 'automation')).toThrow('Choose a focus');
  const chosen = worker.metadata.taskModes![0]!.id;
  expect(resolveAgentSessionTaskMode(worker, chosen, 'workflow')?.id).toBe(chosen);
  const manager = STARTER_AGENTS.find(agent => agent.slug === 'concierge')! as LoadedAgent;
  expect(resolveAgentSessionTaskMode(manager)?.id).toBe('general');
  expect(resolveAgentTaskMode(manager, 'just-talk')).toEqual(resolveAgentTaskMode(manager, 'general'));
  const legacy = { ...manager, metadata: { ...manager.metadata, taskModes: manager.metadata.taskModes!.map(mode => mode.id === 'general' ? { ...mode, id: 'just-talk', label: 'Just Talk' } : mode) } };
  expect(resolveAgentSessionTaskMode(legacy)).toEqual(resolveAgentSessionTaskMode(manager));
  expect(resolveAgentTaskMode(legacy, 'just-talk')?.primarySkillSlugs).toEqual(['artist-manager-operating-system']);
});

test('HQ helper General stays lean and old saved setup focuses still resolve', () => {
  const helper = STARTER_AGENTS.find(agent => agent.slug === 'setup-concierge')! as LoadedAgent;
  const general = resolveAgentTaskMode(helper, 'general')!;
  expect(general.definitionRevision).toStartWith('task-mode-general-v1-');
  expect(general.primarySkillSlugs).toEqual([]);
  expect(general.context?.preloadTopics).toEqual([]);
  expect(general.adjacentSkills.map(skill => skill.slug)).toContain('setup-brain');
  expect(buildAgentTaskModePromptSection(general)).toContain('No topic selection is required');
  expect(resolveAgentTaskMode(helper, 'connect')?.id).toBe('general');
  expect(resolveAgentTaskMode(helper, 'choose-tools')?.id).toBe('tools');
  const custom = { ...helper, metadata: { ...helper.metadata, taskModes: [...helper.metadata.taskModes!, { id: 'connect', kind: 'focus' as const, label: 'Custom', description: 'Saved custom recipe', primarySkillSlugs: ['setup-tools'] }] } };
  expect(resolveAgentTaskMode(custom, 'connect')?.label).toBe('Custom');
});

 test('legacy stock campaign focus resumes in release direction without exposing identity audits', async () => {
  const { ARTIST_DIRECTION_AGENT, resolveArtistDirectionForScope } = await import('./artist-direction')
  const campaign = resolveArtistDirectionForScope(ARTIST_DIRECTION_AGENT, 'campaign')
  expect(resolveAgentTaskMode(campaign, 'brand-audit')?.id).toBe('audience-connection')
  expect(resolveAgentTaskMode(campaign, 'brand-audit')?.primarySkillSlugs).toEqual(['release-creative-direction'])
  expect(resolveAgentTaskMode(campaign, 'full-brand-system')?.id).toBe('creative-brief')
  expect(resolveAgentTaskMode(ARTIST_DIRECTION_AGENT, 'campaign-angles')?.id).toBe('public-expression')
  expect(() => resolveAgentTaskMode(campaign, 'made-up-focus')).toThrow()
  const custom = { ...campaign, metadata: { ...campaign.metadata, taskModes: campaign.metadata.taskModes!.slice(0, 1) } }
  expect(() => resolveAgentTaskMode(custom, 'brand-audit')).toThrow()
  expect(resolveAgentTaskMode(campaign, 'general')?.context?.preloadTopics).toContain('campaign-creative-direction')
})

 test('stock World Builder resumes older world recipes in the experience role', async () => {
  const { WORLD_BUILDER_AGENT } = await import('./artist-direction')
  expect(resolveAgentTaskMode(WORLD_BUILDER_AGENT, 'story-world')?.id).toBe('fan-experience')
  expect(resolveAgentTaskMode(WORLD_BUILDER_AGENT, 'full-world')?.id).toBe('fan-experience')
  expect(resolveAgentTaskMode(WORLD_BUILDER_AGENT, 'campaign-rollout')?.id).toBe('world-touchpoints')
})
