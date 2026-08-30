import { describe, expect, test } from 'bun:test'
import type { LlmConnectionWithStatus } from '@craft-agent/shared/config'
import { resolvePulseExecutionTarget } from './pulse-execution'

describe('resolvePulseExecutionTarget', () => {
  test('keeps an authenticated paid default connection', () => {
    expect(resolvePulseExecutionTarget([
      connection('primary', 'pi/deepseek-v4-pro', { isDefault: true }),
      connection('backup', 'claude-sonnet-4-6'),
    ])).toEqual({ llmConnection: 'primary', model: 'pi/deepseek-v4-pro' })
  })

  test('moves unattended runs off a free shared-pool default when a paid connection is ready', () => {
    expect(resolvePulseExecutionTarget([
      connection('free-default', 'pi/z-ai/glm-5.2:free', { isDefault: true }),
      connection('reliable', 'claude-sonnet-4-6'),
    ])).toEqual({ llmConnection: 'reliable', model: 'claude-sonnet-4-6' })
  })

  test('respects a paid workspace override ahead of the global default', () => {
    expect(resolvePulseExecutionTarget([
      connection('global', 'pi/z-ai/glm-5.2:free', { isDefault: true }),
      connection('workspace', 'pi/qwen/qwen3.6-27b'),
    ], 'workspace')).toEqual({ llmConnection: 'workspace', model: 'pi/qwen/qwen3.6-27b' })
  })

  test('keeps the free connection when it is the only authenticated option', () => {
    expect(resolvePulseExecutionTarget([
      connection('free-only', 'pi/z-ai/glm-5.2:free', { isDefault: true }),
      connection('signed-out', 'claude-sonnet-4-6', { isAuthenticated: false }),
    ])).toEqual({ llmConnection: 'free-only', model: 'pi/z-ai/glm-5.2:free' })
  })
})

function connection(
  slug: string,
  defaultModel: string,
  overrides: Partial<LlmConnectionWithStatus> = {},
): LlmConnectionWithStatus {
  return {
    slug,
    name: slug,
    providerType: 'pi',
    authType: 'api_key',
    models: [defaultModel],
    defaultModel,
    createdAt: 1,
    isAuthenticated: true,
    ...overrides,
  }
}
