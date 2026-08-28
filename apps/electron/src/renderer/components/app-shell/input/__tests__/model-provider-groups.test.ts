import { describe, expect, test } from 'bun:test'
import {
  groupConnectedModelProviders,
  modelProviderIdentity,
  type ModelProviderConnection,
} from '../model-provider-groups'

function connection(overrides: Partial<ModelProviderConnection>): ModelProviderConnection {
  return {
    slug: 'connection',
    name: 'Connection',
    providerType: 'pi',
    isAuthenticated: true,
    ...overrides,
  }
}

describe('model provider groups', () => {
  test('uses artist-facing provider family names', () => {
    expect(modelProviderIdentity(connection({ providerType: 'anthropic' }))).toEqual({ id: 'anthropic', label: 'Claude' })
    expect(modelProviderIdentity(connection({ piAuthProvider: 'openai-codex' }))).toEqual({ id: 'openai-codex', label: 'Codex' })
    expect(modelProviderIdentity(connection({ piAuthProvider: 'deepseek' }))).toEqual({ id: 'deepseek', label: 'DeepSeek' })
  })

  test('shows only connected providers and merges duplicate routes by family', () => {
    const groups = groupConnectedModelProviders([
      connection({ slug: 'claude-api', providerType: 'anthropic', name: 'Claude API' }),
      connection({ slug: 'claude-runner', piAuthProvider: 'anthropic', name: 'Claude Runner' }),
      connection({ slug: 'codex', piAuthProvider: 'openai-codex', name: 'ChatGPT' }),
      connection({ slug: 'deepseek', piAuthProvider: 'deepseek', name: 'DeepSeek', isAuthenticated: false }),
    ])

    expect(groups.map(group => [group.label, group.connections.map(item => item.slug)])).toEqual([
      ['Claude', ['claude-api', 'claude-runner']],
      ['Codex', ['codex']],
    ])
  })

  test('keeps custom endpoints separate instead of guessing their provider', () => {
    const groups = groupConnectedModelProviders([
      connection({ slug: 'studio-local', providerType: 'pi_compat', name: 'Studio Local' }),
    ])

    expect(groups.map(group => ({ id: group.id, label: group.label }))).toEqual([
      { id: 'connection:studio-local', label: 'Studio Local' },
    ])
  })
})
