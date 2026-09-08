import { describe, expect, test } from 'bun:test'
import { STARTER_AGENTS } from './starter-templates.ts'
import { initialAgentSlugsForWorkspace } from './defaults.ts'
import { parseAgentFile, serializeAgent } from './storage.ts'
import { resolveAgentTaskMode, buildAgentTaskModePromptSection } from './task-modes.ts'
import { BUNDLED_STARTER_SKILLS } from '../skills/bundled.generated.ts'

describe('Scriptwriter built-in', () => {
  const agent = STARTER_AGENTS.find(item => item.slug === 'scriptwriter')!

  test('is installed in HQ and campaigns with two format bundles, not in the Lab team', () => {
    expect(agent).toBeDefined()
    expect(initialAgentSlugsForWorkspace('hq', false)).toContain(agent.slug)
    expect(initialAgentSlugsForWorkspace('campaign', false)).toContain(agent.slug)
    expect(initialAgentSlugsForWorkspace('lab', false)).not.toContain(agent.slug)
    const parsed = parseAgentFile(serializeAgent(agent.metadata, agent.systemPrompt))!
    expect(parsed.metadata.taskModes).toEqual(agent.metadata.taskModes)
    expect(parsed.metadata.taskModes?.map(mode => mode.label)).toEqual(['YouTube', 'Reels & TikTok'])
    for (const [id, format] of [['youtube', 'youtube-camera-script'], ['short-form', 'reels-tiktok-script']]) {
      const mode = resolveAgentTaskMode(agent, id)!
      expect(mode.primarySkillSlugs).toEqual(['artist-script-dna', format!])
      expect(mode.adjacentSkills).toEqual([])
      expect(mode.context?.preloadTopics).toContain('artist-branding')
      expect(buildAgentTaskModePromptSection(mode)).toContain('Use every selected primary skill together')
    }
  })

  test('all selected skill instructions and local markdown reference links ship in the bundle', () => {
    for (const slug of agent.metadata.skills!) {
      const skill = BUNDLED_STARTER_SKILLS.find(item => item.slug === slug)!
      expect(skill, slug).toBeDefined()
      expect(skill.files.find(file => file.path === 'SKILL.md')).toBeDefined()
      for (const file of skill.files.filter(file => file.path.endsWith('.md'))) {
        expect(file.content).not.toContain('/Users/michaelb.williams/')
        for (const match of file.content.matchAll(/\]\((references\/[^)#]+)(?:#[^)]*)?\)/g)) {
          expect(skill.files.some(candidate => candidate.path === match[1]), `${slug}: ${match[1]}`).toBe(true)
        }
      }
    }
  })
})
