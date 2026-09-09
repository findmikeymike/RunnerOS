import type { LlmConnection } from '@craft-agent/shared/config/llm-connections'

/** Subscription tokens must never be sent to a user-configured proxy. */
export function isChatGptVoiceConnection(connection: LlmConnection): boolean {
  return connection.authType === 'oauth' && connection.piAuthProvider === 'openai-codex'
    && !connection.customEndpoint
    && (!connection.baseUrl || connection.baseUrl === 'https://chatgpt.com/backend-api')
}

export function isFastChatGptVoiceModel(id: string): boolean {
  return ['gpt-5.4-mini', 'gpt-5.6-luna', 'gpt-5.3-codex-spark'].includes(id.replace(/^pi\//, ''))
}
