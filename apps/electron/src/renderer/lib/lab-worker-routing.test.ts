import { describe, expect, test } from 'bun:test'
import type { AgentDefinitionDTO } from '../../shared/types'
import { getLabWorkerRoles, resolveLabWorkerRoute } from './lab-worker-routing'

describe('lab worker routing', () => {
  test('maps current Lab workers to foundational roles', () => {
    expect(getLabWorkerRoles('reverse-magic')).toContain('lyrics.generate')
    expect(getLabWorkerRoles('legendary-writer')).toContain('lyrics.review')
    expect(getLabWorkerRoles('record-doctor')).toContain('producer.handoff')
    expect(getLabWorkerRoles('reference-master')).toContain('research.reference')
    expect(getLabWorkerRoles('the-excavator')).toContain('song.concept')
    expect(getLabWorkerRoles('the-excavator')).not.toContain('lyrics.generate')
  })

  test('routes to the active worker for a role', () => {
    const route = resolveLabWorkerRoute([
      agent('reverse-magic', 'Reverse Magic'),
      agent('legendary-writer', 'Legendary Writer'),
    ], { role: 'lyrics.review' })

    expect(route.recommended?.agent.slug).toBe('legendary-writer')
    expect(route.candidates).toHaveLength(1)
  })

  test('falls back when no active worker handles the section-specific role', () => {
    const route = resolveLabWorkerRoute([
      agent('legendary-writer', 'Legendary Writer'),
    ], {
      role: 'lyrics.section.chorus',
      fallbackRoles: ['lyrics.rewrite'],
      sectionLabel: 'Chorus',
    })

    expect(route.role).toBe('lyrics.rewrite')
    expect(route.recommended?.agent.slug).toBe('legendary-writer')
  })

  test('returns a chooser set when multiple active workers satisfy a role', () => {
    const route = resolveLabWorkerRoute([
      agent('chorus-writer', 'Chorus Writer'),
      agent('hook-doctor', 'Hook Doctor'),
      agent('legendary-writer', 'Legendary Writer'),
    ], {
      role: 'lyrics.section.chorus',
      fallbackRoles: ['lyrics.rewrite'],
      sectionLabel: 'Chorus',
    })

    expect(route.role).toBe('lyrics.section.chorus')
    expect(route.candidates.map((candidate) => candidate.agent.slug)).toEqual(['chorus-writer', 'hook-doctor'])
    expect(route.recommended?.agent.slug).toBe('chorus-writer')
  })

  test('reports an empty route when no active worker can satisfy the request', () => {
    const route = resolveLabWorkerRoute([
      agent('record-doctor', 'Record Doctor'),
    ], { role: 'lyrics.review' })

    expect(route.candidates).toHaveLength(0)
    expect(route.emptyReason).toContain('No active Lab worker')
  })

  test('routes reference research to Reference Master', () => {
    const route = resolveLabWorkerRoute([
      agent('reverse-magic', 'Reverse Magic'),
      agent('reference-master', 'Reference Master'),
    ], { role: 'research.reference' })

    expect(route.recommended?.agent.slug).toBe('reference-master')
    expect(route.candidates).toHaveLength(1)
  })

  test('routes song concept digs to The Excavator when active', () => {
    const route = resolveLabWorkerRoute([
      agent('reference-master', 'Reference Master'),
      agent('reverse-magic', 'Reverse Magic'),
      agent('the-excavator', 'The Excavator'),
    ], { role: 'song.concept' })

    expect(route.recommended?.agent.slug).toBe('the-excavator')
    expect(route.candidates.map((candidate) => candidate.agent.slug)).toEqual(['the-excavator', 'reverse-magic', 'reference-master'])
  })

  test('routes lyric generation to Reverse Magic instead of The Excavator', () => {
    const route = resolveLabWorkerRoute([
      agent('the-excavator', 'The Excavator'),
      agent('reverse-magic', 'Reverse Magic'),
    ], { role: 'lyrics.generate' })

    expect(route.recommended?.agent.slug).toBe('reverse-magic')
    expect(route.candidates.map((candidate) => candidate.agent.slug)).toEqual(['reverse-magic'])
  })
})

function agent(slug: string, name: string): AgentDefinitionDTO {
  return {
    slug,
    metadata: { name, description: `${name} description.` },
    systemPrompt: '',
    path: `/tmp/${slug}`,
    source: 'global',
  } as AgentDefinitionDTO
}
