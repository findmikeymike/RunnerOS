import { describe, expect, test } from 'bun:test'
import type { HqStateRouteHint } from '@craft-agent/shared/hq-state'
import type { AgentDefinitionDTO, ContextDocDTO } from '../../shared/types'
import {
  dedupeAgentsBySlug,
  proactiveHqModeStorageKey,
  resolveHqRecommendationActionState,
  resolveHqRouteReadiness,
  selectHqRouteContextDocs,
  unhealthyHqSources,
  userFacingHqAttention,
} from './artist-hq-proactive'

describe('artist HQ proactive helpers', () => {
  test('scopes proactive mode storage by workspace', () => {
    expect(proactiveHqModeStorageKey('artist-a')).toBe('artist-hq:proactive-mode:artist-a')
    expect(proactiveHqModeStorageKey('artist-a')).not.toBe(proactiveHqModeStorageKey('artist-b'))
  })

  test('blocks launch when proactive mode is off or agent is unavailable', () => {
    const route = routeHint({ agentSlug: 'outreach-agent' })

    expect(resolveHqRouteReadiness(route, new Set(['outreach-agent']), false)).toEqual({
      agentAvailable: true,
      blockedReason: undefined,
      canLaunch: false,
    })
    expect(resolveHqRouteReadiness(route, new Set(['comms-agent']), true)).toEqual({
      agentAvailable: false,
      blockedReason: '@outreach-agent is not active in this workspace.',
      canLaunch: false,
    })
  })

  test('allows launch only for an available agent route with no blocker', () => {
    expect(resolveHqRouteReadiness(routeHint({ agentSlug: 'outreach-agent' }), new Set(['outreach-agent']), true)).toEqual({
      agentAvailable: true,
      blockedReason: undefined,
      canLaunch: true,
    })
    expect(resolveHqRouteReadiness(routeHint({ blockedReason: 'Needs review.' }), new Set(['outreach-agent']), true)).toEqual({
      agentAvailable: true,
      blockedReason: 'Needs review.',
      canLaunch: false,
    })
  })

  test('dedupes agents and selects only requested context docs', () => {
    expect(dedupeAgentsBySlug([
      agent('outreach-agent', 'First'),
      agent('outreach-agent', 'Second'),
      agent('comms-agent', 'Comms'),
    ]).map((agent) => agent.metadata.name)).toEqual(['First', 'Comms'])

    expect(selectHqRouteContextDocs(routeHint({ contextDocSlugs: ['artist-profile', 'artist-network'] }), [
      contextDoc('artist-profile'),
      contextDoc('artist-calendar'),
      contextDoc('artist-network'),
    ])).toEqual({
      contextDocs: [contextDoc('artist-profile'), contextDoc('artist-network')],
      disabledSlugs: [],
      missingSlugs: [],
    })
  })

  test('reports missing and disabled route context docs', () => {
    expect(selectHqRouteContextDocs(routeHint({ contextDocSlugs: ['artist-profile', 'artist-profile', 'artist-network', 'artist-vault'] }), [
      contextDoc('artist-profile'),
      contextDoc('artist-vault', false),
    ])).toEqual({
      contextDocs: [contextDoc('artist-profile')],
      disabledSlugs: ['artist-vault'],
      missingSlugs: ['artist-network'],
    })
  })

  test('maps recommendation lifecycle to safe card actions', () => {
    const ready = { canLaunch: true, agentAvailable: true }
    expect(resolveHqRecommendationActionState('proposed', ready, true, false)).toEqual(expect.objectContaining({ canLaunch: true, canDefer: true, label: 'Start Route' }))
    expect(resolveHqRecommendationActionState('launched', ready, true, false)).toEqual(expect.objectContaining({ canLaunch: false, canDefer: false, label: 'Work in Progress' }))
    expect(resolveHqRecommendationActionState('awaiting_approval', ready, true, false)).toEqual(expect.objectContaining({ canLaunch: false, label: 'Awaiting Approval' }))
    expect(resolveHqRecommendationActionState('completed', ready, true, false)).toEqual(expect.objectContaining({ canLaunch: false, canRate: true, label: 'Completed' }))
    expect(resolveHqRecommendationActionState('failed', ready, true, false)).toEqual(expect.objectContaining({ canLaunch: true, canRate: true, label: 'Retry Route' }))
  })

  test('returns only degraded and unavailable source health', () => {
    expect(unhealthyHqSources([
      { source: 'outputs', status: 'fresh', checkedAt: '2026-07-11T00:00:00.000Z', itemCount: 1 },
      { source: 'scheduled-work', status: 'degraded', checkedAt: '2026-07-11T00:00:00.000Z', itemCount: 0 },
      { source: 'workflow-runs', status: 'unavailable', checkedAt: '2026-07-11T00:00:00.000Z', itemCount: 0 },
    ]).map((source) => source.source)).toEqual(['scheduled-work', 'workflow-runs'])
  })

  test('keeps internal source-health diagnostics out of the artist-facing action list', () => {
    expect(userFacingHqAttention([
      { kind: 'source-health', text: 'Outputs are stale.', source: 'operational:outputs' },
      { kind: 'vault', text: 'Add the final master.', source: 'artist-vault' },
      { kind: 'approval', text: 'Approve the press release.', source: 'approvals' },
    ])).toEqual([
      { kind: 'vault', text: 'Add the final master.', source: 'artist-vault' },
      { kind: 'approval', text: 'Approve the press release.', source: 'approvals' },
    ])
  })
})

function routeHint(overrides: Partial<HqStateRouteHint> = {}): HqStateRouteHint {
  return {
    target: 'agent',
    action: 'outreach',
    prompt: 'Run outreach.',
    confidence: 'high',
    agentSlug: 'outreach-agent',
    contextDocSlugs: [],
    ...overrides,
  }
}

function agent(slug: string, name: string): AgentDefinitionDTO {
  return {
    slug,
    metadata: { name, description: `${name} description.` },
    systemPrompt: '',
    path: `/tmp/${slug}`,
    source: 'global',
  } as AgentDefinitionDTO
}

function contextDoc(slug: string, enabled = true): ContextDocDTO {
  return {
    slug,
    metadata: { name: slug, routing: { mode: 'broadcast' }, enabled },
    body: '',
  } as ContextDocDTO
}
