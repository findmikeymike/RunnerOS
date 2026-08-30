import { describe, expect, test } from 'bun:test'
import type { LoadedSource } from '@craft-agent/shared/sources'
import type { AgentDefinitionDTO } from '../../shared/types'
import { resolveAgentReferences } from './agent-references'

describe('resolveAgentReferences', () => {
  test('uses canonical source usability for optional no-auth and provider-router sources', () => {
    const agent = {
      slug: 'test-agent',
      metadata: {
        name: 'Test Agent',
        description: 'Test',
        optionalSources: ['no-auth', 'provider-router'],
      },
      systemPrompt: '',
      path: '/tmp/test-agent',
      source: 'global',
    } satisfies AgentDefinitionDTO

    const noAuth = source({
      id: 'no-auth',
      slug: 'no-auth',
      name: 'No auth',
      provider: 'local',
      type: 'local',
      enabled: true,
      local: { path: '/tmp/no-auth', format: 'filesystem' },
    })
    const providerRouter = source({
      id: 'provider-router',
      slug: 'provider-router',
      name: 'Provider router',
      provider: 'router',
      type: 'local',
      enabled: true,
      isAuthenticated: false,
      local: { path: 'provider-router', format: 'provider-router' },
    })

    expect(resolveAgentReferences(agent, [], [noAuth, providerRouter]).resolvedOptionalSources)
      .toEqual(['no-auth'])
  })
})

function source(config: LoadedSource['config']): LoadedSource {
  return {
    config,
    guide: null,
    folderPath: `/tmp/${config.slug}`,
    workspaceRootPath: '/tmp/workspace',
    workspaceId: 'workspace-1',
  }
}
