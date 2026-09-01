import { isLoopbackBaseUrl, validateOmniRouteEndpoint } from './connection-setup-logic'

export interface OmniRouteDiscoveredModel {
  id: string
  name: string
  costInput: number
  costOutput: number
  contextWindow: number
  reasoning: boolean
}

export interface DiscoverOmniRouteModelsOptions {
  baseUrl: string
  apiKey: string
  timeoutMs?: number
  fetchImpl?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>
}

const MAX_RESPONSE_CHARS = 5_000_000
const MAX_MODELS = 5_000

function finitePositive(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

function readPrice(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
  }
  return 0
}

export async function discoverOmniRouteModels(options: DiscoverOmniRouteModelsOptions): Promise<OmniRouteDiscoveredModel[]> {
  const endpoint = validateOmniRouteEndpoint(options.baseUrl)
  if (!endpoint.valid) throw new Error(endpoint.error)

  const apiKey = options.apiKey.trim()
  if (!apiKey && !isLoopbackBaseUrl(endpoint.baseUrl)) {
    throw new Error('OmniRoute inference key is required for remote servers.')
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 8_000)

  try {
    const response = await (options.fetchImpl ?? fetch)(`${endpoint.baseUrl}/models`, {
      method: 'GET',
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
      redirect: 'error',
      signal: controller.signal,
    })

    const text = await response.text()
    if (text.length > MAX_RESPONSE_CHARS) {
      throw new Error('OmniRoute model catalog is too large to load safely.')
    }
    if (!response.ok) {
      throw new Error(`OmniRoute model discovery failed (${response.status}).`)
    }

    let payload: unknown
    try {
      payload = JSON.parse(text)
    } catch {
      throw new Error('OmniRoute returned an invalid model catalog.')
    }

    const rawModels = Array.isArray(payload)
      ? payload
      : payload && typeof payload === 'object' && Array.isArray((payload as { data?: unknown[] }).data)
        ? (payload as { data: unknown[] }).data
        : null
    if (!rawModels) throw new Error('OmniRoute returned an invalid model catalog.')

    const seen = new Set<string>()
    const models: OmniRouteDiscoveredModel[] = []
    for (const raw of rawModels) {
      if (!raw || typeof raw !== 'object') continue
      const record = raw as Record<string, unknown>
      const idCandidate = typeof record.id === 'string'
        ? record.id
        : typeof record.modelId === 'string'
          ? record.modelId
          : typeof record.model_id === 'string'
            ? record.model_id
            : ''
      const id = idCandidate.trim()
      if (!id || id.length > 512 || seen.has(id)) continue

      const nameCandidate = typeof record.name === 'string'
        ? record.name
        : typeof record.displayName === 'string'
          ? record.displayName
          : typeof record.display_name === 'string'
            ? record.display_name
            : id
      const capabilities = record.capabilities && typeof record.capabilities === 'object'
        ? record.capabilities as Record<string, unknown>
        : {}
      const pricing = record.pricing && typeof record.pricing === 'object'
        ? record.pricing as Record<string, unknown>
        : {}

      seen.add(id)
      models.push({
        id,
        name: nameCandidate.trim() || id,
        costInput: readPrice(pricing.input),
        costOutput: readPrice(pricing.output),
        contextWindow: finitePositive(record.context_length) || finitePositive(record.max_context_window_tokens),
        reasoning: capabilities.reasoning === true || capabilities.thinking === true,
      })
      if (models.length >= MAX_MODELS) break
    }

    if (models.length === 0) throw new Error('OmniRoute returned no usable chat models or routes.')
    return models
  } catch (error) {
    if (controller.signal.aborted) throw new Error('OmniRoute model discovery timed out.')
    throw error
  } finally {
    clearTimeout(timer)
  }
}
