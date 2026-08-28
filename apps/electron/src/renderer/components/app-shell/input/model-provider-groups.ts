export interface ModelProviderConnection {
  slug: string
  name: string
  providerType: string
  piAuthProvider?: string
  isAuthenticated: boolean
}

export interface ModelProviderGroup<TConnection extends ModelProviderConnection = ModelProviderConnection> {
  id: string
  label: string
  connections: TConnection[]
}

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Claude',
  'openai-codex': 'Codex',
  openai: 'OpenAI',
  deepseek: 'DeepSeek',
  google: 'Gemini',
  xai: 'Grok',
  'github-copilot': 'Copilot',
  openrouter: 'OpenRouter',
  groq: 'Groq',
  mistral: 'Mistral',
  'amazon-bedrock': 'Amazon Bedrock',
  'google-vertex': 'Google Vertex',
  'azure-openai-responses': 'Azure OpenAI',
  'vercel-ai-gateway': 'Vercel AI Gateway',
  huggingface: 'Hugging Face',
  'kimi-coding': 'Kimi',
  minimax: 'Minimax',
  zai: 'z.ai',
}

function titleCaseProvider(value: string): string {
  return value
    .split(/[-_]/)
    .filter(Boolean)
    .map(part => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ')
}

export function modelProviderIdentity(connection: ModelProviderConnection): { id: string; label: string } {
  if (connection.providerType === 'anthropic') return { id: 'anthropic', label: 'Claude' }

  if (connection.providerType === 'pi' && connection.piAuthProvider) {
    return {
      id: connection.piAuthProvider,
      label: PROVIDER_LABELS[connection.piAuthProvider] ?? titleCaseProvider(connection.piAuthProvider),
    }
  }

  // Custom/local endpoints have no dependable upstream identity. Keep their
  // configured name so the picker never guesses or merges unrelated routes.
  return { id: `connection:${connection.slug}`, label: connection.name }
}

export function groupConnectedModelProviders<TConnection extends ModelProviderConnection>(
  connections: TConnection[],
): ModelProviderGroup<TConnection>[] {
  const groups = new Map<string, ModelProviderGroup<TConnection>>()

  for (const connection of connections) {
    if (!connection.isAuthenticated) continue
    const identity = modelProviderIdentity(connection)
    const existing = groups.get(identity.id)
    if (existing) {
      existing.connections.push(connection)
    } else {
      groups.set(identity.id, {
        id: identity.id,
        label: identity.label,
        connections: [connection],
      })
    }
  }

  return [...groups.values()]
}
