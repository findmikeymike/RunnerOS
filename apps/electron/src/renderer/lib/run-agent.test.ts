import { describe, expect, test } from 'bun:test'
import { buildAgentCreateSessionOptions } from './run-agent'
import { CONCIERGE_SLUG } from '@craft-agent/shared/agent-definitions/types'
import type { AgentDefinitionDTO } from '../../shared/types'
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
})
