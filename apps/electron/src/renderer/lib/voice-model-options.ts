import type { LlmConnectionWithStatus } from '../../shared/types'

export type VoiceModelCatalogEntry = { id: string; name: string }
export type VoiceModelOption = {
  value: string
  label: string
  description: string
  connectionSlug: string
  model: string
}

// These bundled SDK providers use the streaming protocols supported by voice.
// Mixed/unsupported protocols are omitted; main validates the exact model again.
const SUPPORTED_PROVIDERS = new Set([
  'ant-ling', 'anthropic', 'baseten', 'cerebras', 'cloudflare-ai-gateway',
  'cloudflare-workers-ai', 'deepseek', 'fireworks', 'github-copilot', 'groq',
  'huggingface', 'kimi-coding', 'minimax', 'minimax-cn', 'moonshotai',
  'moonshotai-cn', 'nvidia', 'openai', 'opencode-go', 'openrouter',
  'qwen-token-plan', 'qwen-token-plan-cn', 'qwen-token-plan-individual',
  'together', 'vercel-ai-gateway', 'xai', 'xiaomi', 'xiaomi-token-plan-ams',
  'xiaomi-token-plan-cn', 'xiaomi-token-plan-sgp', 'zai', 'zai-coding-cn',
])
const SUPPORTED_APIS = new Set(['openai-completions', 'openai-responses', 'anthropic-messages'])
const PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Anthropic', openai: 'OpenAI', deepseek: 'DeepSeek', openrouter: 'OpenRouter',
  xai: 'xAI', groq: 'Groq', cerebras: 'Cerebras', fireworks: 'Fireworks', together: 'Together',
}

export function voiceModelProvider(connection: LlmConnectionWithStatus): string | null {
  if (!connection.isAuthenticated || !['api_key', 'api_key_with_endpoint'].includes(connection.authType)) return null
  const provider = connection.piAuthProvider || (connection.providerType === 'anthropic' ? 'anthropic' : '')
  if (!SUPPORTED_PROVIDERS.has(provider)) return null
  if (connection.customEndpoint && !SUPPORTED_APIS.has(connection.customEndpoint.api)) return null
  return provider
}

export function isFastVoiceModel(id: string): boolean {
  const bare = id.replace(/^pi\//, '')
  if (!bare || bare.length > 200 || /\s/.test(bare) || bare.startsWith('auto/')) return false
  if (/(?:^|[/_.:-])(?:audio|image|embedding|embeddings|tts|transcribe|transcription|realtime|search|codex)(?:$|[/_.:-])/i.test(bare)) return false
  return /(?:^|[/_.:-])(?:flash|haiku|mini|fast)(?:$|[/_.:-])/i.test(bare) && bare !== 'fast'
}

export function voiceModelOptionValue(connectionSlug: string, model: string): string {
  return JSON.stringify([connectionSlug, model.replace(/^pi\//, '')])
}

/** An option always carries its route; the picker never guesses a connection. */
export function buildVoiceModelOptions(
  connections: readonly LlmConnectionWithStatus[],
  catalogs: Readonly<Record<string, readonly VoiceModelCatalogEntry[]>>,
): VoiceModelOption[] {
  const options: VoiceModelOption[] = []
  const seen = new Set<string>()
  for (const connection of connections) {
    const provider = voiceModelProvider(connection)
    if (!provider) continue
    for (const model of catalogs[provider] ?? []) {
      if (!isFastVoiceModel(model.id)) continue
      const value = voiceModelOptionValue(connection.slug, model.id)
      if (seen.has(value)) continue
      seen.add(value)
      options.push({
        value, label: model.name || model.id.replace(/^pi\//, ''),
        description: `${PROVIDER_LABELS[provider] ?? provider} · ${connection.name}`,
        connectionSlug: connection.slug, model: model.id,
      })
    }
  }
  return options.sort((a, b) => a.label.localeCompare(b.label) || a.description.localeCompare(b.description))
}
