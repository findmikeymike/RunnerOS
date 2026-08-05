import { describe, expect, test } from 'bun:test'
import { buildAgentCreateSessionOptions, sendAgentDraft } from './run-agent'
import { CONCIERGE_SLUG } from '@craft-agent/shared/agent-definitions/types'
import type { AgentDefinitionDTO, LoadedSource } from '../../shared/types'
import type { MemoryEntry } from '@craft-agent/shared/memory/types'

function makeAgent(): AgentDefinitionDTO {
  return {
    slug: 'test-agent',
    metadata: {
      name: 'Test Agent',
      description: 'For tests.',
    },
    systemPrompt: 'You are a test agent.',
    path: '/tmp/fake',
    source: 'global',
  } as AgentDefinitionDTO
}

function makeMemory(name: string, expires?: string): MemoryEntry {
  return {
    name,
    type: 'reference',
    created: '2026-05-01',
    expires,
    body: 'Body.',
  }
}

function makeSource(slug: string, usable = true): LoadedSource {
  return {
    config: {
      id: `id-${slug}`,
      name: slug,
      slug,
      enabled: true,
      provider: slug,
      type: 'api',
      api: usable ? { baseUrl: 'https://example.com', authType: 'none' } : { baseUrl: 'https://example.com', authType: 'oauth' },
      isAuthenticated: usable,
    },
    guide: null,
    folderPath: `/tmp/sources/${slug}`,
    workspaceRootPath: '/tmp/ws',
    workspaceId: 'ws-1',
  } as unknown as LoadedSource
}

describe('buildAgentCreateSessionOptions memory receipts', () => {
  test('records active user and agent memory names in direct launch receipts', () => {
    const options = buildAgentCreateSessionOptions(makeAgent(), {
      skills: [],
      sources: [],
      userMemoryEntries: [
        makeMemory('Current user fact', '2999-12-31'),
        makeMemory('Expired user fact', '2000-01-01'),
      ],
      agentMemoryEntries: [makeMemory('Review rule')],
    })

    expect(options.launchReceipt?.injected.memory).toEqual({
      user: [{ name: 'Current user fact' }],
      agent: [{ name: 'Review rule' }],
    })
  })

  test('injects the active agent catalog into Concierge launch receipts', () => {
    const options = buildAgentCreateSessionOptions(
      {
        ...makeAgent(),
        slug: CONCIERGE_SLUG,
        metadata: { name: 'HNIC', description: 'Routes work.' },
      },
      {
        skills: [],
        sources: [],
        agentCatalog: [
          {
            ...makeAgent(),
            slug: 'comms-agent',
            metadata: {
              name: 'Comms Agent',
              description: 'Drafts fan, press, and partner comms.',
              tags: ['comms'],
            },
          },
        ],
      },
    )

    expect(options.launchReceipt?.routing).toEqual({
      mode: 'concierge',
      activeAgentCount: 1,
      instruction: 'Use the active agent capability catalog to route the user to a specialist when appropriate.',
    })
    expect(options.launchReceipt?.injected.agentCatalog).toEqual([
      expect.objectContaining({ slug: 'comms-agent', name: 'Comms Agent', tags: ['comms'] }),
    ])
    expect(options.customSystemPrompt).toContain('Comms Agent')
  })

  test('launches with optional sources only when they are usable', () => {
    const agent = {
      ...makeAgent(),
      metadata: {
        name: 'Outreach Agent',
        description: 'For tests.',
        sources: ['zero'],
        optionalSources: ['gmail'],
      },
    } as AgentDefinitionDTO

    const disconnected = buildAgentCreateSessionOptions(agent, {
      skills: [],
      sources: [makeSource('zero'), makeSource('gmail', false)],
    })
    expect(disconnected.enabledSourceSlugs).toEqual(['zero'])
    expect(disconnected.customSystemPrompt).not.toContain('@gmail')

    const connected = buildAgentCreateSessionOptions(agent, {
      skills: [],
      sources: [makeSource('zero'), makeSource('gmail')],
    })
    expect(connected.enabledSourceSlugs).toEqual(['zero', 'gmail'])
    expect(connected.customSystemPrompt).toContain('@gmail')
  })

  test('does not inject optional Meta Ads when it is not authenticated', () => {
    const agent = {
      ...makeAgent(),
      slug: 'ads-agent',
      metadata: {
        name: 'Ads Agent',
        description: 'For tests.',
        sources: ['google-ads', 'ads-operator'],
        optionalSources: ['meta-ads'],
      },
    } as AgentDefinitionDTO

    const disconnected = buildAgentCreateSessionOptions(agent, {
      skills: [],
      sources: [makeSource('google-ads'), makeSource('ads-operator'), makeSource('meta-ads', false)],
    })
    expect(disconnected.enabledSourceSlugs).toEqual(['google-ads', 'ads-operator'])
    expect(disconnected.customSystemPrompt).toContain('@google-ads')
    expect(disconnected.customSystemPrompt).toContain('@ads-operator')
    expect(disconnected.customSystemPrompt).not.toContain('@meta-ads')

    const connected = buildAgentCreateSessionOptions(agent, {
      skills: [],
      sources: [makeSource('google-ads'), makeSource('ads-operator'), makeSource('meta-ads')],
    })
    expect(connected.enabledSourceSlugs).toEqual(['google-ads', 'ads-operator', 'meta-ads'])
    expect(connected.customSystemPrompt).toContain('@meta-ads')
  })

  test('passes trusted worker tools into spawned sessions and receipts', () => {
    const agent = {
      ...makeAgent(),
      metadata: {
        name: 'Industry Hunter',
        description: 'For tests.',
        trustedWorkerTools: ['start_deep_research', 'create_output'],
      },
    } as AgentDefinitionDTO

    const options = buildAgentCreateSessionOptions(agent, {
      skills: [],
      sources: [],
    })

    expect(options.trustedWorkerTools).toEqual(['start_deep_research', 'create_output'])
    expect(options.launchReceipt?.injected.trustedWorkerTools).toEqual(['start_deep_research', 'create_output'])
  })
})

describe('sendAgentDraft', () => {
  test('waits for confirmed delivery', async () => {
    let delivered = false
    await sendAgentDraft(async () => {
      await Promise.resolve()
      delivered = true
      return true
    }, 'session-1', 'Start the work', 'Test Agent')

    expect(delivered).toBe(true)
  })

  test('surfaces a failed first message', async () => {
    expect(
      sendAgentDraft(async () => false, 'session-1', 'Start the work', 'Test Agent'),
    ).rejects.toThrow('first message failed to send')
  })
})
