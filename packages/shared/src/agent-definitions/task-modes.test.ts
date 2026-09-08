import { describe, expect, test } from 'bun:test';
import { parseAgentFile, serializeAgent } from './storage.ts';
import { STARTER_AGENTS } from './starter-templates.ts';
import { buildAgentTaskModePromptSection, filterContextDocsForTaskMode, resolveAgentTaskMode } from './task-modes.ts';
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
  test('Branding pilot defines six focused choices and one explicit full bundle', () => {
    const branding = STARTER_AGENTS.find((agent) => agent.slug === 'branding-agent');
    expect(branding?.metadata.taskModes?.map((mode) => mode.id)).toEqual([
      'brand-audit',
      'narrative-universe',
      'belief-worldview',
      'visual-world',
      'brand-expression',
      'campaign-angles',
      'full-brand-system',
    ]);
    expect(branding?.metadata.taskModes?.find((mode) => mode.id === 'visual-world')?.primarySkillSlugs)
      .toEqual(['artist-visual-world-director']);
    expect(branding?.metadata.taskModes?.find((mode) => mode.id === 'full-brand-system')?.fullMode)
      .toBe(true);
  });

  test('resolves one primary skill while keeping related skills awareness-only', () => {
    const branding = STARTER_AGENTS.find((agent) => agent.slug === 'branding-agent')! as LoadedAgent;
    const mode = resolveAgentTaskMode(branding, 'visual-world')!;

    expect(mode.primarySkillSlugs).toEqual(['artist-visual-world-director']);
    expect(mode.adjacentSkills.map((skill) => skill.slug)).toContain('artist-brand-dna-audit');
    expect(mode.definitionRevision).toMatch(/^task-mode-v1-[a-f0-9]{8}$/);
    expect(buildAgentTaskModePromptSection(mode)).toContain('awareness only');
  });

  test('narrows only prompt delivery and leaves unselected docs out of the launch set', () => {
    const branding = STARTER_AGENTS.find((agent) => agent.slug === 'branding-agent')! as LoadedAgent;
    const mode = resolveAgentTaskMode(branding, 'visual-world');
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
