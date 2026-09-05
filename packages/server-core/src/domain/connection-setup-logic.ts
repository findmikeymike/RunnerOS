/**
 * Connection Setup Logic
 *
 * Pure functions extracted from ipc.ts for testability.
 * No dependency on ipcMain, sessionManager, credential manager, or file I/O.
 */

import type { ModelDefinition } from '@craft-agent/shared/config/models'
import {
  type LlmConnection,
  getDefaultModelsForConnection,
  getDefaultModelForConnection,
} from '@craft-agent/shared/config'

// ============================================================
// Error Parsing
// ============================================================

/**
 * Parse an error message from a connection test into a user-friendly string.
 */
export function parseTestConnectionError(msg: string): string {
  const lower = msg.toLowerCase()

  if (lower.includes('econnrefused') || lower.includes('enotfound') || lower.includes('fetch failed')) {
    return 'Cannot connect to API server. Check the URL and ensure the server is running.'
  }
  if (lower.includes('no api key found for')) {
    return 'Provider mismatch during setup. Select a provider preset in Runner Backend API Key mode, or use Anthropic API Key mode for arbitrary compatible endpoints.'
  }
  if (lower.includes('401') || lower.includes('unauthorized') || lower.includes('authentication')) {
    return 'Invalid API key'
  }
  if (lower.includes('404') && lower.includes('model')) {
    return 'Model not found. Check the model name and try again.'
  }
  if (lower.includes('404')) {
    return 'API endpoint not found. Check the URL.'
  }
  if (lower.includes('429') || lower.includes('rate limit')) {
    return 'Rate limit exceeded. Please try again.'
  }
  if (lower.includes('403')) {
    return 'API key does not have permission to access this resource'
  }

  return msg.slice(0, 300)
}

/**
 * Guard against ambiguous Pi custom endpoint tests where no provider routing is selected.
 */
export function validateSetupTestInput(params: {
  provider: 'anthropic' | 'pi'
  baseUrl?: string
  piAuthProvider?: string
}): { valid: true } | { valid: false; error: string } {
  const hasCustomEndpoint = !!params.baseUrl?.trim()
  if (params.provider === 'pi' && hasCustomEndpoint && !params.piAuthProvider) {
    return {
      valid: false,
      error: 'Custom endpoint in Runner Backend mode requires selecting a provider preset. For arbitrary Anthropic-compatible endpoints, use Anthropic API Key mode.',
    }
  }

  return { valid: true }
}

/**
 * Returns true when a URL points to local loopback.
 * Used to permit keyless setup tests for local model runtimes (e.g. Ollama).
 */
export function isLoopbackBaseUrl(baseUrl?: string): boolean {
  if (!baseUrl?.trim()) return false
  try {
    const hostname = new URL(baseUrl.trim()).hostname
    const normalizedHostname = hostname.startsWith('[') && hostname.endsWith(']')
      ? hostname.slice(1, -1)
      : hostname
    return normalizedHostname === 'localhost' || normalizedHostname === '127.0.0.1' || normalizedHostname === '::1'
  } catch {
    return false
  }
}

/**
 * Normalize the friendly OmniRoute server URL to its OpenAI-compatible base.
 * A bare origin becomes `/v1`; explicit reverse-proxy paths are preserved.
 */
export function normalizeOmniRouteBaseUrl(baseUrl?: string): string | undefined {
  const trimmed = baseUrl?.trim()
  if (!trimmed) return undefined

  try {
    const url = new URL(trimmed)
    if (url.pathname === '' || url.pathname === '/') {
      url.pathname = '/v1'
    }
    return url.toString().replace(/\/$/, '')
  } catch {
    return trimmed
  }
}

/**
 * Named external gateways get stricter transport validation than arbitrary
 * custom endpoints because the product presents them as trusted presets.
 */
export function validateOmniRouteEndpoint(baseUrl?: string): { valid: true; baseUrl: string } | { valid: false; error: string } {
  const normalized = normalizeOmniRouteBaseUrl(baseUrl)
  if (!normalized) {
    return { valid: false, error: 'OmniRoute server URL is required.' }
  }

  try {
    const url = new URL(normalized)
    if (url.username || url.password) {
      return { valid: false, error: 'OmniRoute credentials must use the API key field, not the server URL.' }
    }
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopbackBaseUrl(normalized))) {
      return { valid: false, error: 'Remote OmniRoute servers must use HTTPS. HTTP is allowed only for localhost.' }
    }
    return { valid: true, baseUrl: normalized }
  } catch {
    return { valid: false, error: 'Enter a valid OmniRoute server URL.' }
  }
}

/**
 * Setup tests require API keys for non-local endpoints, but local loopback
 * endpoints may be keyless.
 */
export function setupTestRequiresApiKey(baseUrl?: string): boolean {
  return !isLoopbackBaseUrl(baseUrl)
}

// ============================================================
// Built-in Connection Templates
// ============================================================

/**
 * Built-in connection templates for the onboarding flow.
 * Each template defines the default configuration for a known connection slug.
 */
export const BUILT_IN_CONNECTION_TEMPLATES: Record<string, {
  name: string | ((hasCustomEndpoint: boolean) => string)
  providerType: LlmConnection['providerType'] | ((hasCustomEndpoint: boolean) => LlmConnection['providerType'])
  authType: LlmConnection['authType'] | ((hasCustomEndpoint: boolean) => LlmConnection['authType'])
  piAuthProvider?: string
}> = {
  'anthropic-api': {
    name: (h) => h ? 'Custom Anthropic-Compatible' : 'Anthropic (API Key)',
    providerType: (h) => h ? 'pi_compat' : 'anthropic',
    authType: (h) => h ? 'api_key_with_endpoint' : 'api_key',
  },
  'claude-max': {
    name: 'Claude Max',
    providerType: 'anthropic',
    authType: 'oauth',
  },
  'chatgpt-plus': {
    name: 'GPT/Codex',
    providerType: 'pi',
    authType: 'oauth',
    piAuthProvider: 'openai-codex',
  },
  'github-copilot': {
    name: 'GitHub Copilot',
    providerType: 'pi',
    authType: 'oauth',
    piAuthProvider: 'github-copilot',
  },
  'pi-api-key': {
    name: 'Runner Backend (API Key)',
    providerType: 'pi',
    authType: 'api_key',
    // piAuthProvider set dynamically from setup.piAuthProvider
  },
  'omniroute': {
    name: 'OmniRoute Auto',
    providerType: 'pi_compat',
    authType: 'none',
    piAuthProvider: 'omniroute',
  },
}

// ============================================================
// Pi Auth Provider Display Names
// ============================================================

const PI_AUTH_PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  'openai-codex': 'OpenAI',
  google: 'Google AI Studio',
  openrouter: 'OpenRouter',
  omniroute: 'OmniRoute',
  'azure-openai-responses': 'Azure OpenAI',
  'amazon-bedrock': 'Amazon Bedrock',
  groq: 'Groq',
  mistral: 'Mistral',
  xai: 'xAI',
  cerebras: 'Cerebras',
  zai: 'z.ai',
  huggingface: 'Hugging Face',
  minimax: 'Minimax',
  'minimax-cn': 'Minimax CN',
  'kimi-coding': 'Kimi (Coding)',
  'vercel-ai-gateway': 'Vercel AI Gateway',
}

/** Get a human-readable display name for a Pi auth provider key */
export function piAuthProviderDisplayName(piAuthProvider: string): string | null {
  return PI_AUTH_PROVIDER_DISPLAY_NAMES[piAuthProvider] ?? null
}

// ============================================================
// Connection Creation
// ============================================================

/**
 * Create an LLM connection configuration from a connection slug.
 * Uses built-in templates for known slugs, throws for unknown slugs
 * (custom connections are created through the settings UI).
 */
export function createBuiltInConnection(slug: string, baseUrl?: string | null): LlmConnection {
  // Try exact match first, then strip numeric suffix for derived slugs (e.g. 'anthropic-api-2' → 'anthropic-api')
  const baseSlug = slug.replace(/-\d+$/, '')
  const template = BUILT_IN_CONNECTION_TEMPLATES[slug] ?? BUILT_IN_CONNECTION_TEMPLATES[baseSlug]
  if (!template) {
    throw new Error(`Unknown built-in connection slug: ${slug}. Custom connections should be created through settings.`)
  }

  const hasCustomEndpoint = !!baseUrl
  const providerType = typeof template.providerType === 'function'
    ? template.providerType(hasCustomEndpoint)
    : template.providerType
  const authType = typeof template.authType === 'function'
    ? template.authType(hasCustomEndpoint)
    : template.authType
  let name = typeof template.name === 'function'
    ? template.name(hasCustomEndpoint)
    : template.name

  // Append suffix number to name for derived connections (e.g. 'anthropic-api-2' → 'Anthropic (API Key) 2')
  const suffixMatch = slug.match(/-(\d+)$/)
  if (suffixMatch && !BUILT_IN_CONNECTION_TEMPLATES[slug]) {
    name = `${name} ${suffixMatch[1]}`
  }

  const isEmbeddedOmniRoute = baseSlug === 'omniroute'

  return {
    slug,
    name,
    providerType,
    authType,
    baseUrl: isEmbeddedOmniRoute ? normalizeOmniRouteBaseUrl(baseUrl ?? undefined) : undefined,
    customEndpoint: isEmbeddedOmniRoute ? { api: 'openai-completions' } : undefined,
    // The default tier is pinned to the free route rather than `auto`. `auto`
    // means "best available", which is free today only because a fresh profile
    // has no paid keys — the moment someone adds one it can start spending.
    // Artists get this connection without asking for it, so it must not be a
    // route that quietly becomes billable.
    models: isEmbeddedOmniRoute ? [...OMNIROUTE_DEFAULT_TIERS] : getDefaultModelsForConnection(providerType, template.piAuthProvider),
    defaultModel: isEmbeddedOmniRoute ? OMNIROUTE_DEFAULT_TIERS[0] : getDefaultModelForConnection(providerType, template.piAuthProvider),
    modelSelectionMode: isEmbeddedOmniRoute
      ? 'userDefined3Tier'
      : providerType === 'pi' ? 'automaticallySyncedFromProvider' : undefined,
    piAuthProvider: template.piAuthProvider,
    createdAt: Date.now(),
  }
}

// ============================================================
// Model Validation
// ============================================================

/**
 * Validate that the default model exists in the provided model list.
 * Handles both string and ModelDefinition model entries.
 *
 * This was extracted from inline logic in the setupLlmConnection IPC handler
 * to fix a bug where Array.includes() compared strings against ModelDefinition
 * objects, always returning false for Pi connections.
 */
export function validateModelList(
  models: Array<ModelDefinition | string>,
  defaultModel: string | undefined,
): { valid: boolean; error?: string; resolvedDefaultModel?: string } {
  if (!models || models.length === 0) {
    return { valid: true }
  }

  const modelIds = models.map(m => typeof m === 'string' ? m : m.id)

  if (defaultModel && !modelIds.includes(defaultModel)) {
    return {
      valid: false,
      error: `Default model "${defaultModel}" is not in the provided model list.`,
    }
  }

  if (!defaultModel) {
    const firstModel = models[0]
    const firstModelId = typeof firstModel === 'string' ? firstModel : firstModel!.id
    return {
      valid: true,
      resolvedDefaultModel: firstModelId,
    }
  }

  return { valid: true }
}

/**
 * The tier set every embedded OmniRoute connection should hold.
 *
 * Both the free routes: `auto` is deliberately absent because it means "best
 * available", which is free today only while a profile has no paid keys.
 */
export const OMNIROUTE_DEFAULT_TIERS = ['auto/best-free', 'auto/best-free', 'auto/fast'] as const

/**
 * Tier sets this app shipped as a default and may therefore correct.
 *
 * The first collapsed all three tiers onto the free route and erased the fast
 * tier. The second restored them but made `auto` the default. Neither was a
 * choice anyone made, so replacing them is a correction rather than an
 * override — and anything not listed here is left alone.
 */
const MACHINE_WRITTEN_OMNIROUTE_TIERS: readonly string[] = [
  'auto/best-free,auto/best-free,auto/best-free',
  'auto/best-free,auto,auto/fast',
]

/**
 * What an existing OmniRoute connection should be rewritten to, if anything.
 *
 * Returns null when the stored tiers are the artist's own, or already correct.
 * The corrected shape is never itself a machine-written shape, so this repairs
 * once and then stops: a rule that rewrites its own output is exactly how the
 * original all-free bug reapplied itself on every launch.
 */
export function planOmniRouteTierRepair(
  // A connection's models can be full definitions rather than ids. Only the
  // string form can match a shipped default, and a joined object never will,
  // so an unusual shape simply falls through and is left alone.
  storedModels: readonly (string | ModelDefinition)[] | undefined,
): { models: string[]; defaultModel: string } | null {
  if (!MACHINE_WRITTEN_OMNIROUTE_TIERS.includes((storedModels ?? []).join(','))) return null
  return { models: [...OMNIROUTE_DEFAULT_TIERS], defaultModel: OMNIROUTE_DEFAULT_TIERS[0] }
}
