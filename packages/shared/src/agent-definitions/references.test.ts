import { describe, expect, test } from 'bun:test'
import type { LoadedSource } from '../sources/types.ts'
import { assertAgentReferences, describeMissingReferences, hasMissingReferences, resolveAgentReferences, selectDeclaredSkillsToEnable } from './references.ts'

const agent = { slug: 'writer', metadata: { name: 'Writer', skills: ['legacy:writer', 'missing'], sources: ['ready', 'disabled', 'missing-source'], optionalSources: ['ready', 'optional', 'optional-off', 'absent'] } }
const source = (slug: string, enabled = true): LoadedSource => ({
  config: { id: slug, slug, name: slug, type: 'local', provider: 'local', enabled, local: { path: '/tmp', format: 'filesystem' } },
  guide: null, folderPath: '/tmp', workspaceRootPath: '/tmp', workspaceId: 'test',
})

describe('shared launch reference policy', () => {
  test('interactive and background share the same resolved bundles, but strict work rejects incomplete recipes', () => {
    const resolution = resolveAgentReferences(agent, [{ slug: 'writer-custom', aliases: ['legacy:writer'] }], [source('ready'), source('disabled', false), source('optional'), source('optional-off', false)])
    expect(resolution).toEqual({ resolvedSkills: ['legacy:writer'], missingSkills: ['missing'], resolvedSources: ['ready'], missingSources: ['missing-source'], unusableSources: ['disabled'], resolvedOptionalSources: ['optional'] })
    expect(() => assertAgentReferences(agent, resolution, 'lenient')).not.toThrow()
    expect(() => assertAgentReferences(agent, resolution, 'strict')).toThrow('disabled or disconnected @disabled')
    expect(hasMissingReferences(resolution)).toBe(true)
    expect(describeMissingReferences(resolution)).toContain('disabled or disconnected: @disabled')
  })

  test('optional absent or disconnected sources never prevent a strict launch', () => {
    const optionalAgent = { slug: 'writer', metadata: { name: 'Writer', optionalSources: ['absent', 'disabled'] } }
    const resolution = resolveAgentReferences(optionalAgent, [], [source('disabled', false)])
    expect(() => assertAgentReferences(optionalAgent, resolution, 'strict')).not.toThrow()
    expect(resolution.resolvedOptionalSources).toEqual([])
  })

  test('unavailable skill descriptors cannot satisfy a strict recipe', () => {
    const skillAgent = { slug: 'writer', metadata: { name: 'Writer', skills: ['removed'] } }
    const resolution = resolveAgentReferences(skillAgent, [{ slug: 'removed', available: false }], [])
    expect(() => assertAgentReferences(skillAgent, resolution, 'strict')).toThrow('missing skill @removed')
  })

  test('activation respects active aliases, retries unavailable descriptors, and writes a declaration only once', () => {
    const checked: string[] = []
    const selected = selectDeclaredSkillsToEnable(['legacy:writer', 'disabled', 'disabled', 'absent'], [{ slug: 'custom', aliases: ['legacy:writer'] }, { slug: 'disabled', available: false }], slug => { checked.push(slug); return slug === 'disabled' })
    expect(selected).toEqual(['disabled'])
    expect(checked).toEqual(['disabled', 'absent'])
  })
})
