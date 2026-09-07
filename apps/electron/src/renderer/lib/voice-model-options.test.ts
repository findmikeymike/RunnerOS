import { expect, test } from 'bun:test'
import type { LlmConnectionWithStatus } from '../../shared/types'
import { buildVoiceModelOptions, isFastVoiceModel, voiceModelOptionValue, voiceModelProvider } from './voice-model-options'

const connection = (slug: string, provider: string, extra: Partial<LlmConnectionWithStatus> = {}): LlmConnectionWithStatus => ({
  slug, name: slug, providerType: 'pi', piAuthProvider: provider, authType: 'api_key',
  isAuthenticated: true, isDefault: false, createdAt: 0, ...extra,
}) as LlmConnectionWithStatus

test('fast voice families use model IDs, excluding full-size and specialty models', () => {
  for (const id of ['pi/deepseek-v4-flash', 'pi/google/gemini-2.5-flash', 'claude-haiku-4-5-20251001', 'pi/openai/gpt-4.1-mini', 'pi/x-ai/grok-4-fast']) expect(isFastVoiceModel(id)).toBe(true)
  for (const id of ['pi/deepseek-v4-pro', 'claude-sonnet-5', 'auto/fastest', 'auto/fast', 'fast', 'pi/minimax-m2.5', 'pi/gpt-4o-mini-tts', 'pi/google/gemini-flash-image', 'pi/gpt-4o-mini-search-preview', 'pi/codex-mini-latest']) expect(isFastVoiceModel(id)).toBe(false)
})

test('only connected API-key routes using supported protocols can supply choices', () => {
  expect(voiceModelProvider(connection('deepseek', 'deepseek'))).toBe('deepseek')
  expect(voiceModelProvider(connection('claude', '', { providerType: 'anthropic' }))).toBe('anthropic')
  for (const candidate of [connection('oauth', 'anthropic', { authType: 'oauth' }), connection('missing-key', 'openai', { isAuthenticated: false }), connection('direct-google', 'google'), connection('codex', 'openai-codex'), connection('no-auth', 'deepseek', { authType: 'none' })]) expect(voiceModelProvider(candidate)).toBeNull()
})

test('one option selects the matching connection and model atomically across providers', () => {
  const choices = buildVoiceModelOptions([connection('ds', 'deepseek'), connection('or', 'openrouter')], {
    deepseek: [{ id: 'pi/deepseek-v4-pro', name: 'Pro' }, { id: 'pi/deepseek-v4-flash', name: 'Flash' }],
    openrouter: [{ id: 'pi/openai/gpt-4.1-mini', name: 'GPT mini' }],
  })
  expect(choices).toHaveLength(2)
  expect(choices.find(option => option.label === 'GPT mini')).toMatchObject({ connectionSlug: 'or', model: 'pi/openai/gpt-4.1-mini' })
  expect(choices.find(option => option.label === 'Flash')).toMatchObject({ connectionSlug: 'ds', model: 'pi/deepseek-v4-flash' })
})

test('bare and pi IDs dedupe within a route while distinct connections remain selectable', () => {
  const models = [{ id: 'pi/gpt-4.1-mini', name: 'GPT mini' }, { id: 'gpt-4.1-mini', name: 'GPT mini' }]
  const choices = buildVoiceModelOptions([connection('first', 'openai'), connection('second', 'openai')], { openai: models })
  expect(choices).toHaveLength(2)
  expect(voiceModelOptionValue('first', 'gpt-4.1-mini')).toBe(choices[0]!.value)
  expect(choices[0]!.value).not.toBe(choices[1]!.value)
})

test('an excluded legacy selection is never introduced by its label or curated tiers', () => {
  const choices = buildVoiceModelOptions([connection('ds', 'deepseek', { models: ['pi/deepseek-v4-pro'] })], {
    deepseek: [{ id: 'pi/deepseek-v4-pro', name: 'Fast mini model' }],
  })
  expect(choices).toEqual([])
})
