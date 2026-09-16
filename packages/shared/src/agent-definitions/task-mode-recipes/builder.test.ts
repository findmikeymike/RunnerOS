import { expect, test } from 'bun:test'
import { STARTER_AGENTS, STOCK_BUILDER_ROLE_BASELINES, applyArtistBuilderResponsibility } from '../starter-templates'
import { parseAgentFile, serializeAgent } from '../storage'
import { initialAgentSlugsForWorkspace, isAgentAllowedInArtistWorkspace } from '../defaults'
import { ARTIST_MANAGER_SYSTEM_SKILL_SLUGS, BUILDER_SYSTEM_SKILL_SLUGS, CREATOR_SYSTEM_SKILL_SLUGS, isSystemGlobalSkillSlug } from '../../skills/system'
import { BUILDER_TASK_MODES } from './builder'
import { MANAGER_TASK_MODES, LEGACY_MANAGER_TASK_MODES } from './manager'

test('Builder has optional General, narrow recipes, no strategic preload and default ask permission', () => {
  const builder = STARTER_AGENTS.find(agent => agent.slug === 'builder')!
  expect(builder.metadata.permissionMode).toBe('ask')
  expect(builder.metadata.trustedWorkerTools).toBeUndefined()
  expect(builder.metadata.skills).toEqual([...BUILDER_SYSTEM_SKILL_SLUGS])
  expect(builder.metadata.taskModes?.map(mode => mode.id)).toEqual(['general', 'agents', 'workflows', 'automations'])
  expect(parseAgentFile(serializeAgent(builder.metadata, builder.systemPrompt))?.metadata.taskModes).toEqual(BUILDER_TASK_MODES)
  for (const mode of BUILDER_TASK_MODES) expect(mode.context?.preloadTopics).toEqual([])
  expect(BUILDER_TASK_MODES[0]!.primarySkillSlugs).toEqual([])
  expect(builder.systemPrompt).toContain('Check currently exposed tools before claiming automation maintenance')
  expect(builder.systemPrompt).toContain('Do not create a redundant Output')
})

test('Builder activates once in new HQ and Campaign, never silently in existing roots or Lab', () => {
  for (const scope of ['hq', 'campaign'] as const) {
    expect(initialAgentSlugsForWorkspace(scope, false).filter(slug => slug === 'builder')).toHaveLength(1)
    expect(initialAgentSlugsForWorkspace(scope, true)).not.toContain('builder')
  }
  expect(isAgentAllowedInArtistWorkspace('builder', 'lab')).toBe(false)
  expect(initialAgentSlugsForWorkspace('lab', false)).not.toContain('builder')
})

test('Artist stock roles route construction to Builder while generic RunnerOS remains unchanged', () => {
  for (const stock of STOCK_BUILDER_ROLE_BASELINES) {
    expect(applyArtistBuilderResponsibility(stock, false)).toBe(stock)
    const artist = applyArtistBuilderResponsibility(stock, true)
    expect(artist.systemPrompt).toContain('Builder')
    expect(artist.systemPrompt).not.toContain('use the matching baked-in creator/meta')
    if (stock.slug === 'concierge') {
      expect(artist.metadata.skills).toEqual([...ARTIST_MANAGER_SYSTEM_SKILL_SLUGS])
      expect(artist.systemPrompt).toContain('schedule_work')
      expect(artist.systemPrompt).toContain('supply_work_input')
      expect(artist.systemPrompt).toContain('without a mandatory marketplace search')
      expect(artist.systemPrompt).not.toContain('Monid cannot provide an appropriate tool')
      expect(artist.systemPrompt).not.toContain('suggest the user create one')
    }
    if (stock.slug === 'orchestrator') expect(artist.metadata.skills).toEqual([])
  }
  expect(LEGACY_MANAGER_TASK_MODES.some(mode => mode.id === 'build-automate')).toBe(true)
  expect(MANAGER_TASK_MODES.some(mode => mode.id === 'build-automate')).toBe(false)
  for (const slug of CREATOR_SYSTEM_SKILL_SLUGS) {
    expect(isSystemGlobalSkillSlug(slug)).toBe(true)
    expect(BUILDER_SYSTEM_SKILL_SLUGS).toContain(slug)
    expect(MANAGER_TASK_MODES.flatMap(mode => mode.adjacentSkills ?? []).some(skill => skill.slug === slug)).toBe(false)
  }
})
