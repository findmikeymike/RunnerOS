import { randomUUID } from 'node:crypto'
import type { Api, Context, Model, SimpleStreamOptions } from '@earendil-works/pi-ai'
import type { LlmConnection } from '@craft-agent/shared/config/llm-connections'
import {
  VOICE_FOCUS_LIMITS,
  type VoiceFocusCancelRequest,
  type VoiceFocusEvent,
  type VoiceFocusRegisterRequest,
  type VoiceFocusSession,
  type VoiceFocusTurnRequest,
} from '../shared/artist-manager-voice-focus'

type StreamEvent = { type: string; delta?: string; reason?: string }
export type VoiceFocusResolvedConfig = { connection: LlmConnection; model: string }
export type VoiceFocusDependencies = {
  resolveConfig(request: VoiceFocusRegisterRequest): Promise<VoiceFocusResolvedConfig>
  resolveModel(connection: LlmConnection, model: string): Promise<Model<Api>>
  getApiKey(connection: string): Promise<string | null>
  stream(model: Model<Api>, context: Context, options: SimpleStreamOptions): AsyncIterable<StreamEvent> | Promise<AsyncIterable<StreamEvent>>
  timeoutMs?: number
}

const supportedApis = new Set(['openai-completions', 'openai-responses', 'anthropic-messages'])
const bareModel = (id: string) => id.startsWith('pi/') ? id.slice(3) : id

const productionDependencies: VoiceFocusDependencies = {
  async resolveConfig(request) {
    const [{ loadGlobalAgent }, { getWorkspaceByNameOrId }, { loadWorkspaceConfig }, { resolveSessionConnection }] = await Promise.all([
      import('@craft-agent/shared/agent-definitions/storage'),
      import('@craft-agent/shared/config/storage'),
      import('@craft-agent/shared/workspaces'),
      import('@craft-agent/shared/agent/backend/factory'),
    ])
    const workspace = getWorkspaceByNameOrId(request.workspaceId)
    const manager = loadGlobalAgent('concierge')
    if (!workspace || !manager) throw new Error('Artist Manager workspace is unavailable')
    const defaults = loadWorkspaceConfig(workspace.rootPath)?.defaults
    const connection = resolveSessionConnection(manager.metadata.llmConnection, defaults?.defaultLlmConnection)
    if (!connection) throw new Error('Configure an Artist Manager model connection first')
    const model = request.model?.trim() || manager.metadata.model || defaults?.model || connection.defaultModel
    if (!model || model === 'fast' || model === 'default') throw new Error('Select an exact configured voice model')
    return { connection, model }
  },
  async resolveModel(connection, requestedModel) {
    const { getModels } = await import('@earendil-works/pi-ai/compat')
    const provider = connection.piAuthProvider || (connection.providerType === 'anthropic' ? 'anthropic' : undefined)
    if (!provider) throw new Error('This connection protocol is not supported by focused voice yet')
    const model = getModels(provider as Parameters<typeof getModels>[0]).find(candidate => candidate.id === bareModel(requestedModel))
    if (!model) throw new Error('The exact voice model is unavailable for this connection; no fallback was used')
    if (!supportedApis.has(model.api) || (connection.customEndpoint && connection.customEndpoint.api !== model.api)) {
      throw new Error('This connection protocol is not supported by focused voice yet')
    }
    return { ...model, ...(connection.baseUrl ? { baseUrl: connection.baseUrl } : {}) }
  },
  async getApiKey(connection) {
    const { getCredentialManager } = await import('@craft-agent/shared/credentials')
    return getCredentialManager().getLlmApiKey(connection)
  },
  async stream(model, context, options) {
    const { streamSimple } = await import('@earendil-works/pi-ai/compat')
    return streamSimple(model, context, options)
  },
}

type Exchange = { user: string; assistant: string }
type ActiveTurn = { id: string; controller: AbortController }
type SessionState = {
  info: VoiceFocusSession
  sdkModel: Model<Api>
  systemPrompt: string
  history: Exchange[]
  active?: ActiveTurn
  usedTurns: Set<string>
}
type OwnerState = { session?: SessionState }

/** No agent, tool registration, tool execution, model retries, or saved-config writes. */
export class ArtistManagerVoiceFocusService {
  private readonly owners = new Map<number, OwnerState>()
  constructor(private readonly deps: VoiceFocusDependencies = productionDependencies) {}

  async register(ownerId: number, request: VoiceFocusRegisterRequest): Promise<VoiceFocusSession> {
    assertText(request.workspaceId, 200, 'workspace')
    assertText(request.systemPrompt, VOICE_FOCUS_LIMITS.promptChars, 'context')
    if (request.model !== undefined && (typeof request.model !== 'string' || request.model.length > 200)) throw new Error('Invalid voice model')
    if (request.thinking !== undefined && request.thinking !== 'off' && request.thinking !== 'low') throw new Error('Invalid voice reasoning level')
    if (!Number.isSafeInteger(ownerId) || ownerId < 0) throw new Error('Invalid voice owner')
    if (!this.owners.has(ownerId) && this.owners.size >= VOICE_FOCUS_LIMITS.owners) throw new Error('Too many focused voice conversations')
    this.stopOwner(ownerId)
    const owner: OwnerState = {}
    this.owners.set(ownerId, owner)
    try {
      const resolved = await this.deps.resolveConfig(request)
      if (resolved.connection.authType !== 'api_key' && resolved.connection.authType !== 'api_key_with_endpoint') {
        throw new Error('Focused voice currently requires an API-key connection; OAuth and other auth are not supported')
      }
      const model = await this.deps.resolveModel(resolved.connection, resolved.model)
      if (bareModel(resolved.model) !== model.id || !supportedApis.has(model.api)) throw new Error('The exact voice model is unavailable; no fallback was used')
      assertEndpoint(model.baseUrl)
      if (this.owners.get(ownerId) !== owner) throw new Error('Voice setup was cancelled')
      const info: VoiceFocusSession = { sessionId: randomUUID(), connection: resolved.connection.slug, model: resolved.model, thinking: request.thinking ?? 'low' }
      owner.session = { info, sdkModel: model, systemPrompt: request.systemPrompt, history: [], usedTurns: new Set() }
      return { ...info }
    } catch (error) {
      if (this.owners.get(ownerId) === owner) this.owners.delete(ownerId)
      throw error
    }
  }

  async startTurn(ownerId: number, request: VoiceFocusTurnRequest, emit: (event: VoiceFocusEvent) => void): Promise<void> {
    const session = this.ownedSession(ownerId, request.sessionId)
    assertText(request.turnId, 100, 'turn')
    assertText(request.text, VOICE_FOCUS_LIMITS.inputChars, 'input')
    if (request.systemPrompt !== undefined) assertText(request.systemPrompt, VOICE_FOCUS_LIMITS.promptChars, 'context')
    if (session.active) throw new Error('A voice response is already running')
    if (session.usedTurns.has(request.turnId)) throw new Error('Voice turn was already submitted')
    if (session.usedTurns.size >= 1000) throw new Error('Start a new focused voice conversation')
    session.usedTurns.add(request.turnId)
    if (request.systemPrompt !== undefined) session.systemPrompt = request.systemPrompt
    const active: ActiveTurn = { id: request.turnId, controller: new AbortController() }
    session.active = active
    const signal = active.controller.signal
    const current = () => this.owners.get(ownerId)?.session === session && session.active === active && !signal.aborted
    const send = (event: { type: 'text_delta'; delta: string } | { type: 'done' }) => {
      if (current()) emit({ ...event, sessionId: session.info.sessionId, turnId: request.turnId })
    }
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; active.controller.abort() }, this.deps.timeoutMs ?? VOICE_FOCUS_LIMITS.timeoutMs)
    let abortListener!: () => void
    const aborted = new Promise<never>((_, reject) => {
      abortListener = () => reject(new Error('Voice cancelled'))
      signal.addEventListener('abort', abortListener, { once: true })
    })
    const run = async () => {
      const apiKey = await this.deps.getApiKey(session.info.connection)
      if (!current()) return
      if (!apiKey?.trim()) throw new Error('missing credential')
      const context: Context = {
        systemPrompt: session.systemPrompt,
        tools: [],
        messages: session.history.flatMap<Context['messages'][number]>(exchange => [
          { role: 'user', content: exchange.user, timestamp: 0 },
          { role: 'assistant', content: [{ type: 'text', text: exchange.assistant }], api: session.sdkModel.api, provider: session.sdkModel.provider, model: session.sdkModel.id, stopReason: 'stop', timestamp: 0, usage: emptyUsage() },
        ]),
      }
      context.messages.push({ role: 'user', content: request.text, timestamp: Date.now() })
      const stream = await this.deps.stream(session.sdkModel, context, {
        apiKey, signal, maxTokens: VOICE_FOCUS_LIMITS.outputTokens, maxRetries: 0,
        reasoning: session.info.thinking === 'off' ? undefined : session.info.thinking,
        toolChoice: 'none',
      })
      let text = ''
      let done = false
      for await (const event of stream) {
        if (!current()) return
        if (event.type.startsWith('toolcall') || event.type === 'error') throw new Error('provider response failed')
        if (event.type === 'text_delta' && event.delta) {
          if (text.length + event.delta.length > VOICE_FOCUS_LIMITS.outputChars) throw new Error('response limit')
          text += event.delta
          send({ type: 'text_delta', delta: event.delta })
        } else if (event.type === 'done') {
          if (event.reason !== 'stop' && event.reason !== 'length') throw new Error('unsupported completion')
          done = true
          break
        }
      }
      if (!current()) return
      if (!done || !text.trim()) throw new Error('incomplete response')
      session.history.push({ user: request.text, assistant: text })
      while (session.history.length > VOICE_FOCUS_LIMITS.historyTurns || historySize(session.history) > VOICE_FOCUS_LIMITS.historyChars) session.history.shift()
      send({ type: 'done' })
    }
    try {
      await Promise.race([run(), aborted])
    } catch {
      const shouldPublish = current() || (timedOut && this.owners.get(ownerId)?.session === session && session.active === active)
      active.controller.abort()
      if (shouldPublish) {
        try {
          emit({ sessionId: session.info.sessionId, turnId: request.turnId, type: 'error', message: timedOut ? 'Voice response timed out. Please try again.' : 'Voice response failed. No fallback model was used.' })
        } catch { /* A destroyed renderer must not prevent provider cancellation. */ }
      }
    } finally {
      clearTimeout(timer)
      signal.removeEventListener('abort', abortListener)
      if (session.active === active) session.active = undefined
    }
  }

  cancel(ownerId: number, request: VoiceFocusCancelRequest): void {
    const session = this.ownedSession(ownerId, request.sessionId)
    if (session.active?.id === request.turnId) session.active.controller.abort()
  }

  stop(ownerId: number, sessionId: string): void {
    this.ownedSession(ownerId, sessionId)
    this.stopOwner(ownerId)
  }

  stopOwner(ownerId: number): void {
    this.owners.get(ownerId)?.session?.active?.controller.abort()
    this.owners.delete(ownerId)
  }

  close(): void { for (const ownerId of this.owners.keys()) this.stopOwner(ownerId) }

  private ownedSession(ownerId: number, sessionId: string): SessionState {
    const session = this.owners.get(ownerId)?.session
    if (!session || session.info.sessionId !== sessionId) throw new Error('Voice conversation is unavailable for this window')
    return session
  }
}

function assertText(value: unknown, max: number, name: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`Invalid voice ${name}`)
}
function assertEndpoint(endpoint: string): void {
  const url = new URL(endpoint)
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) || url.username || url.password || url.search || url.hash) throw new Error('Unsupported voice endpoint')
}
function historySize(history: Exchange[]): number { return history.reduce((size, exchange) => size + exchange.user.length + exchange.assistant.length, 0) }
function emptyUsage() { return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } }
