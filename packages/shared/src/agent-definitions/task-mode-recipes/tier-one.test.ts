import { describe, expect, test } from 'bun:test'
import { STARTER_AGENTS } from '../starter-templates.ts'
import { parseAgentFile, serializeAgent } from '../storage.ts'
import { STARTER_SKILLS } from '../../skills/starter-templates.ts'
import { BUNDLED_STARTER_SKILLS } from '../../skills/bundled.generated.ts'
import { TIER_ONE_TASK_MODES } from './tier-one.ts'

describe('Tier 1 task-mode recipes', () => {
  test('every recipe survives parsing against its real starter capability inventory', () => {
    const installed = new Set([...STARTER_SKILLS, ...BUNDLED_STARTER_SKILLS].map(skill => skill.slug))
    for (const [slug, taskModes] of Object.entries(TIER_ONE_TASK_MODES)) {
      const agent = STARTER_AGENTS.find(candidate => candidate.slug === slug)!
      expect(agent, slug).toBeDefined()
      const parsed = parseAgentFile(serializeAgent({ ...agent.metadata, taskModes }, agent.systemPrompt))!
      expect(parsed.metadata.taskModes, slug).toEqual(taskModes)
      for (const mode of taskModes) {
        for (const skill of [...mode.primarySkillSlugs, ...(mode.adjacentSkills ?? []).map(item => item.slug)]) {
          expect(installed.has(skill), `${slug}/${mode.id}: ${skill}`).toBe(true)
        }
      }
    }
  })

  test('marketplace providers are never preloaded, including comprehensive choices', () => {
    for (const modes of Object.values(TIER_ONE_TASK_MODES)) {
      for (const mode of modes) {
        expect(mode.primarySkillSlugs).not.toContain('monid')
        expect(mode.primarySkillSlugs).not.toContain('zero')
        expect(mode.requiredSourceSlugs ?? []).not.toContain('zero')
        const zero = mode.adjacentSkills?.find(skill => skill.slug === 'zero')
        if (zero) expect(zero.when).toContain('confirmed missing Monid capability')
      }
    }
  })

  test('offline interpretation does not inherit live retrieval adapters', () => {
    for (const [slug, id] of [
      ['spotify-analyst', 'check-changes'],
      ['spotify-analyst', 'growth-review'],
      ['youtube-intelligence-agent', 'audience-research'],
      ['youtube-intelligence-agent', 'content-strategy'],
      ['youtube-research-agent', 'viral-ideas'],
      ['print-agent', 'product-plan'],
      ['print-agent', 'listing-copy'],
      ['raw-video-editor', 'edit-direction'],
    ]) {
      const mode = TIER_ONE_TASK_MODES[slug!]!.find(mode => mode.id === id)!
      expect(mode.requiredSourceSlugs ?? [], `${slug}/${id}`).toEqual([])
      expect(mode.optionalSourceSlugs ?? [], `${slug}/${id}`).toEqual([])
    }
  })

  test('platform modes preserve browser fallback without loading unrelated accounts', () => {
    const modes = TIER_ONE_TASK_MODES['ads-agent']!
    for (const [id, optional] of [['meta-ads', 'meta-ads'], ['google-ads', 'google-ads']]) {
      const mode = modes.find(mode => mode.id === id)!
      expect(mode.requiredSourceSlugs).toEqual(['ads-operator'])
      expect(mode.optionalSourceSlugs).toEqual([optional!])
    }
    expect(TIER_ONE_TASK_MODES['branding-agent']).toBeUndefined()
    expect(TIER_ONE_TASK_MODES['artist-manager']).toBeUndefined()
  })
})
