import { describe, expect, test } from 'bun:test'
import { assertExpectedContextBody, selectContextDocsForAgentLaunch } from './workspace-context'
import { resolveAgentTaskMode, STARTER_AGENTS } from '@craft-agent/shared/agent-definitions'
import { artistInstagramSnapshotMetadata } from '@craft-agent/shared/artist-context'
import type { LoadedContextDoc } from '@craft-agent/shared/workspace-context'

function doc(slug: string, metadata: Partial<LoadedContextDoc['metadata']> = {}): LoadedContextDoc {
  return { slug, path: `/tmp/context/${slug}`, workspaceRootPath: '/tmp/context', body: `Body ${slug}`,
    metadata: { name: slug, enabled: true, routing: { mode: 'broadcast' }, ...metadata } }
}

describe('focused context delivery', () => {
  test('a real focused recipe delivers its authorized on-demand snapshot', () => {
    const agent = STARTER_AGENTS.find(agent => agent.slug === 'social-publisher')!
    const mode = resolveAgentTaskMode(agent, 'growth')!
    const snapshot = doc('artist-instagram-snapshot', artistInstagramSnapshotMetadata())
    expect(selectContextDocsForAgentLaunch([snapshot], agent.slug)).toEqual([])
    expect(selectContextDocsForAgentLaunch([snapshot, doc('artist-voice')], agent.slug, mode).map(doc => doc.slug))
      .toEqual(['artist-instagram-snapshot'])
  })

  test('focus selection never overrides disabled or targeted access restrictions', () => {
    const agent = STARTER_AGENTS.find(agent => agent.slug === 'social-publisher')!
    const mode = resolveAgentTaskMode(agent, 'growth')!
    expect(selectContextDocsForAgentLaunch([doc('artist-instagram-snapshot', { enabled: false })], agent.slug, mode)).toEqual([])
    expect(selectContextDocsForAgentLaunch([doc('artist-instagram-snapshot', {
      private: true, routing: { mode: 'targeted', agents: ['writer'] },
    })], agent.slug, mode)).toEqual([])
  })

  test('Manager focus retains its brief and does not expose another worker private document', () => {
    const agent = STARTER_AGENTS.find(agent => agent.slug === 'concierge')!
    const mode = resolveAgentTaskMode(agent, 'just-talk')!
    const brief = doc('hq-state-of-play')
    const privateDoc = doc('artist-profile', { private: true, routing: { mode: 'targeted', agents: ['writer'] } })
    const selected = selectContextDocsForAgentLaunch([brief, privateDoc], agent.slug, mode)
    expect(selected.some(doc => doc.slug === 'hq-state-of-play')).toBe(true)
    expect(selected.some(doc => doc.slug === 'artist-profile')).toBe(false)
  })

  test('ordinary launches retain the previous delivery policy', () => {
    expect(selectContextDocsForAgentLaunch([doc('artist-profile'), doc('on-demand'), doc('always', { delivery: 'always' })], 'writer').map(doc => doc.slug))
      .toEqual(['artist-profile', 'always'])
  })
})

describe('workspace context compare-and-swap', () => {
  test('accepts the exact body that was read', () => {
    expect(() => assertExpectedContextBody('campaign-calendar', 'current', 'current')).not.toThrow()
    expect(() => assertExpectedContextBody('campaign-calendar', null, null)).not.toThrow()
  })

  test('rejects a stale body before it can overwrite a newer write', () => {
    expect(() => assertExpectedContextBody('campaign-calendar', 'runner update', 'stale renderer copy'))
      .toThrow('CONTEXT_DOC_CONFLICT')
  })
})
