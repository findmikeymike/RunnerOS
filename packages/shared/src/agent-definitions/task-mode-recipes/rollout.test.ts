import { describe, expect, test } from 'bun:test'
import { STARTER_AGENTS } from '../starter-templates.ts'
import { parseAgentFile, serializeAgent } from '../storage.ts'
import { resolveAgentTaskMode, filterContextDocsForTaskMode, buildAgentTaskModeStarterPrompt } from '../task-modes.ts'
import { buildWorkspaceContextSection } from '../../agent-prompt/compose.ts'
import { TIER_TWO_TASK_MODES } from './tier-two.ts'
import { MANAGER_TASK_MODES } from './manager.ts'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadGlobalAgent, writeGlobalAgent, replaceBuiltInAgentMetadata, migrateBuiltInAgentTaskModes } from '../storage.ts'

describe('shared agent focus rollout', () => {
  test('startup adds recipes to stock agents and preserves their other fields', () => {
    const globalAgentsDir = mkdtempSync(join(tmpdir(), 'artist-focus-installed-'))
    const options = { globalAgentsDir }
    try {
      for (const starter of STARTER_AGENTS.filter(agent => agent.metadata.taskModes?.length)) {
        const { taskModes, ...metadata } = starter.metadata
        const systemPrompt = starter.systemPrompt
        writeGlobalAgent({ slug: starter.slug, metadata, systemPrompt }, options)
        const installed = loadGlobalAgent(starter.slug, options)!
        expect(migrateBuiltInAgentTaskModes(starter, options).updated, starter.slug).toBe(true)
        const refreshed = loadGlobalAgent(starter.slug, options)!
        expect(refreshed.metadata.taskModes, starter.slug).toEqual(taskModes)
        expect(refreshed.systemPrompt, starter.slug).toBe(systemPrompt)
        const { taskModes: updatedModes, ...remaining } = refreshed.metadata
        expect(remaining, starter.slug).toEqual(installed.metadata)
        for (const mode of updatedModes!) expect(resolveAgentTaskMode(refreshed, mode.id)).toBeDefined()
        // A later startup must also refresh existing nested recipes, not only add missing ones.
        const revised = structuredClone(taskModes!)
        revised[0]!.helpText = 'Updated artist guidance'
        expect(replaceBuiltInAgentMetadata(starter.slug, {
          taskModes: { from: taskModes, to: revised },
        }, options).updated, starter.slug).toBe(true)
        expect(loadGlobalAgent(starter.slug, options)!.metadata.taskModes, starter.slug).toEqual(revised)
        expect(replaceBuiltInAgentMetadata(starter.slug, {
          taskModes: { from: taskModes, to: [] },
        }, options).updated, 'stale expected metadata must not overwrite newer recipes').toBe(false)
      }
    } finally {
      rmSync(globalAgentsDir, { recursive: true, force: true })
    }
  })
  test('all installed recipes survive parsing and resolve against their own inventory', () => {
    const focused = STARTER_AGENTS.filter(agent => agent.metadata.taskModes?.length)
    expect(focused).toHaveLength(28)
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
