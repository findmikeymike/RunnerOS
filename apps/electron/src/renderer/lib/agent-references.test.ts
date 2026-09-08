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

test('migrated assignments resolve their active custom alias while unavailable parents cannot launch', () => {
  const agent = { slug: 'writer', metadata: { name: 'Writer', description: '', skills: ['legacy:zero', 'removed-parent'] }, systemPrompt: '', path: '/test', source: 'global' } satisfies AgentDefinitionDTO
  const caps = { canRead: true, canEdit: true, canDelete: true, canExport: true, canListFiles: true }
  const result = resolveAgentReferences(agent, [
    { id: 'custom', slug: 'zero-personal-123', aliases: ['legacy:zero'], origin: 'user', source: 'workspace', metadata: { name: 'My Zero', description: '' }, capabilities: caps },
    { id: 'missing', slug: 'removed-parent', origin: 'managed', source: 'global', available: false, metadata: { name: 'Unavailable skill', description: '' }, capabilities: caps },
  ], [])
  expect(result.resolvedSkills).toEqual(['legacy:zero'])
  expect(result.missingSkills).toEqual(['removed-parent'])
})
