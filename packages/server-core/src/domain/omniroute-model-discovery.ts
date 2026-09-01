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

const MAX_RESPONSE_BYTES = 5_000_000
const MAX_MODELS = 5_000
const MAX_MODEL_NAME_CHARS = 256

function truncateModelName(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length <= MAX_MODEL_NAME_CHARS) return trimmed

  const end = /[\uD800-\uDBFF]/.test(trimmed[MAX_MODEL_NAME_CHARS - 1] ?? '')
    ? MAX_MODEL_NAME_CHARS - 1
    : MAX_MODEL_NAME_CHARS
  return trimmed.slice(0, end)
}

async function readBoundedResponseText(response: Response): Promise<string> {
  const contentLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    throw new Error('OmniRoute model catalog is too large to load safely.')
  }

  if (!response.body) return ''

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const parts: string[] = []
  let bytesRead = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      bytesRead += value.byteLength
      if (bytesRead > MAX_RESPONSE_BYTES) {
        await reader.cancel()
        throw new Error('OmniRoute model catalog is too large to load safely.')
      }
      parts.push(decoder.decode(value, { stream: true }))
    }
    parts.push(decoder.decode())
    return parts.join('')
  } finally {
    reader.releaseLock()
  }
}

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

    if (!response.ok) {
      throw new Error(`OmniRoute model discovery failed (${response.status}).`)
    }
    const text = await readBoundedResponseText(response)

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
        name: truncateModelName(nameCandidate) || id,
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
