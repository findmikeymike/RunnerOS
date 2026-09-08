import { describe, expect, test } from 'bun:test'
import { STARTER_AGENTS } from '../starter-templates.ts'
import { parseAgentFile, serializeAgent } from '../storage.ts'
import { resolveAgentTaskMode, filterContextDocsForTaskMode, buildAgentTaskModeStarterPrompt } from '../task-modes.ts'
import { buildWorkspaceContextSection } from '../../agent-prompt/compose.ts'
import { TIER_TWO_TASK_MODES } from './tier-two.ts'
import { MANAGER_TASK_MODES } from './manager.ts'

describe('shared agent focus rollout', () => {
  test('all installed recipes survive parsing and resolve against their own inventory', () => {
    const focused = STARTER_AGENTS.filter(agent => agent.metadata.taskModes?.length)
    expect(focused).toHaveLength(27)
    for (const agent of focused) {
      const parsed = parseAgentFile(serializeAgent(agent.metadata, agent.systemPrompt))!
      expect(parsed.metadata.taskModes, agent.slug).toEqual(agent.metadata.taskModes)
      for (const mode of agent.metadata.taskModes!) {
        const resolved = resolveAgentTaskMode(agent, mode.id)!
        expect(resolved.primarySkillSlugs).toEqual(mode.primarySkillSlugs)
        expect(buildAgentTaskModeStarterPrompt(resolved)).toContain(mode.label)
        expect(buildAgentTaskModeStarterPrompt(resolved)).not.toContain('full brand system')
      }
    }
  })
  test('Manager only preloads management, with optional focused creator capabilities', () => {
    for (const mode of MANAGER_TASK_MODES) expect(mode.primarySkillSlugs).toEqual(['artist-manager-operating-system'])
    expect(MANAGER_TASK_MODES.find(mode => mode.id === 'build-automate')?.adjacentSkills?.map(skill => skill.slug))
      .toEqual(['agent-creator', 'workflow-creator', 'automation-creator', 'source-recipe'])
  })
  test('Tier 2 cards describe actual capabilities and meaningful scope', () => {
    expect(TIER_TWO_TASK_MODES['lyric-video-agent']).toHaveLength(2)
    expect(TIER_TWO_TASK_MODES['record-doctor']!.map(mode => mode.label)).toEqual(['Prepare Submission', 'Refine Producer Note', 'Review & Send'])
    expect(TIER_TWO_TASK_MODES['spotify-playlist-creator']!.map(mode => mode.label)).toEqual(['Build Artist Playlist', 'Review a Playlist'])
  })
  test('empty topic selection is intentional, and context budgets never cut a document', () => {
    const agent = STARTER_AGENTS.find(agent => agent.slug === 'branding-agent')!
    const mode = resolveAgentTaskMode(agent, 'brand-audit')!
    mode.context = { preloadTopics: [], maxPreloadChars: 1_000 }
    expect(filterContextDocsForTaskMode([{ slug: 'artist-profile', body: 'Private context' }], mode)).toEqual([])
    const docs = [{ slug: 'artist-profile', metadata: { name: 'Profile', enabled: true }, body: 'Evidence'.repeat(300) }]
    const rendered = buildWorkspaceContextSection(docs, 1_000)
    expect(rendered).not.toContain('Evidence')
    expect(rendered).toContain('withheld')
    expect(rendered).toContain('get_workspace_context')
    expect(docs[0]!.body).toHaveLength(2_400)
  })
})
