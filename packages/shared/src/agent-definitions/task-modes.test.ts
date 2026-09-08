import { describe, expect, test } from 'bun:test';
import { parseAgentFile, serializeAgent } from './storage.ts';
import { STARTER_AGENTS } from './starter-templates.ts';
import { buildAgentTaskModePromptSection, buildAgentTaskModeStarterPrompt, filterContextDocsForTaskMode, resolveAgentTaskMode } from './task-modes.ts';
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
  test('Branding pilot defines four focused choices and one explicit full bundle', () => {
    const branding = STARTER_AGENTS.find((agent) => agent.slug === 'branding-agent');
    expect(branding?.metadata.taskModes?.map((mode) => mode.id)).toEqual([
      'brand-audit',
      'artist-world',
      'voice-beliefs',
      'campaign-angles',
      'full-brand-system',
    ]);
    expect(branding?.metadata.taskModes?.find((mode) => mode.id === 'artist-world')?.primarySkillSlugs)
      .toEqual(['artist-narrative-universe', 'artist-visual-world-director']);
    expect(branding?.metadata.taskModes?.find((mode) => mode.id === 'full-brand-system')?.fullMode)
      .toBe(true);
  });

  test('resolves both primary skills while keeping related skills on-demand', () => {
    const branding = STARTER_AGENTS.find((agent) => agent.slug === 'branding-agent')! as LoadedAgent;
    const mode = resolveAgentTaskMode(branding, 'artist-world')!;

    expect(mode.primarySkillSlugs).toEqual(['artist-narrative-universe', 'artist-visual-world-director']);
    expect(mode.adjacentSkills.map((skill) => skill.slug)).toContain('artist-brand-dna-audit');
    expect(mode.fullMode).toBe(false);
    expect(mode.definitionRevision).toMatch(/^task-mode-v1-[a-f0-9]{8}$/);
    const prompt = buildAgentTaskModePromptSection(mode);
    expect(prompt).toContain('Use every selected primary skill together');
    expect(prompt).toContain('one coherent result');
    expect(prompt).toContain('available on demand — not preloaded');
    expect(prompt).toContain('invoke and read that adjacent skill at that point');
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
    expect(buildAgentTaskModeStarterPrompt(mode)).toContain('selected Voice & Beliefs');
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
});
