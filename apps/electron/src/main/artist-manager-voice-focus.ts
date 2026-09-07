import { randomUUID } from 'node:crypto'
import type { Api, Context, Model, SimpleStreamOptions } from '@earendil-works/pi-ai'
import { getArtistManagerVoiceSettings } from '@craft-agent/shared/config/artist-manager-voice-storage'
import { parseArtistManagerVoiceSettings, type ArtistManagerVoiceSettings } from '@craft-agent/shared/config/artist-manager-voice-settings'
import type { LlmConnection } from '@craft-agent/shared/config/llm-connections'
import {
  VOICE_FOCUS_LIMITS,
  type VoiceFocusCancelRequest,
  type VoiceFocusCompletion,
  type VoiceFocusEvent,
  type VoiceFocusRegisterRequest,
  type VoiceFocusSession,
  type VoiceFocusTurnRequest,
} from '../shared/artist-manager-voice-focus'

import { normalizeVoiceHandoffTargets, buildVoiceHandoffTool, parseVoiceHandoffProposal, isVoiceHandoffConfirmation, type VoiceHandoffTarget, type VoiceHandoffProposal } from '../shared/artist-manager-voice-handoff'

type StreamEvent = { type: string; delta?: string; reason?: string; toolCall?: { name: string; arguments: unknown }; message?: { usage?: { output?: number; reasoning?: number } } }
export type VoiceFocusResolvedConfig = { connection: LlmConnection; model: string; thinking?: ArtistManagerVoiceSettings['thinking'] }
export type VoiceFocusDependencies = {
  resolveConfig(request: VoiceFocusRegisterRequest): Promise<VoiceFocusResolvedConfig>
  resolveModel(connection: LlmConnection, model: string): Promise<Model<Api>>
  getApiKey(connection: string): Promise<string | null>
  stream(model: Model<Api>, context: Context, options: SimpleStreamOptions): AsyncIterable<StreamEvent> | Promise<AsyncIterable<StreamEvent>>
  timeoutMs?: number
}

const supportedApis = new Set(['openai-completions', 'openai-responses', 'anthropic-messages'])
const bareModel = (id: string) => id.startsWith('pi/') ? id.slice(3) : id

export type VoiceSettingsRouteDependencies = {
  getConnection(slug: string): LlmConnection | null | Promise<LlmConnection | null>
  resolveModel: VoiceFocusDependencies['resolveModel']
}

async function getConfiguredConnection(slug: string): Promise<LlmConnection | null> {
  const { getLlmConnection } = await import('@craft-agent/shared/config/storage')
  return getLlmConnection(slug)
}

async function resolveConfiguredVoiceModel(connection: LlmConnection, requestedModel: string): Promise<Model<Api>> {
  const { getModels } = await import('@earendil-works/pi-ai/compat')
  const provider = connection.piAuthProvider || (connection.providerType === 'anthropic' ? 'anthropic' : undefined)
  if (!provider) throw new Error('This connection protocol is not supported by conversation voice yet')
  const model = getModels(provider as Parameters<typeof getModels>[0]).find(candidate => candidate.id === bareModel(requestedModel))
  if (!model) throw new Error('The exact voice model is unavailable for this connection; no fallback was used')
  if (!supportedApis.has(model.api) || (connection.customEndpoint && connection.customEndpoint.api !== model.api)) {
    throw new Error('This connection protocol is not supported by conversation voice yet')
  }
  return { ...model, ...(connection.baseUrl ? { baseUrl: connection.baseUrl } : {}) }
}

async function validateResolvedVoiceRoute(
  connection: LlmConnection,
  requestedModel: string,
  resolveModel: VoiceFocusDependencies['resolveModel'],
): Promise<Model<Api>> {
  if (connection.authType !== 'api_key' && connection.authType !== 'api_key_with_endpoint') {
    throw new Error('Conversation voice requires an API-key connection; OAuth and other auth are not supported')
  }
  const model = await resolveModel(connection, requestedModel)
  if (bareModel(requestedModel) !== model.id || !supportedApis.has(model.api)) throw new Error('The exact voice model is unavailable; no fallback was used')
  assertEndpoint(model.baseUrl)
  return model
}

/** Validate routing without fetching credentials, starting a session or calling a provider. */
export async function validateVoiceSettingsRoute(
  value: unknown,
  deps: VoiceSettingsRouteDependencies = { getConnection: getConfiguredConnection, resolveModel: resolveConfiguredVoiceModel },
): Promise<ArtistManagerVoiceSettings> {
  const settings = parseArtistManagerVoiceSettings(value)
  if (settings.connectionSlug === null || settings.model === null) return settings
  const connection = await deps.getConnection(settings.connectionSlug)
  if (!connection || connection.slug !== settings.connectionSlug) throw new Error('The selected conversation voice connection no longer exists; choose it in Settings')
  await validateResolvedVoiceRoute(connection, settings.model, deps.resolveModel)
  return settings
}

/** Diagnostic model overrides stay on the saved voice connection; Command defaults are never consulted. */
export async function resolveSavedVoiceFocusConfig(
  request: Pick<VoiceFocusRegisterRequest, 'model' | 'thinking'>,
  deps: {
    getSettings(): ArtistManagerVoiceSettings | Promise<ArtistManagerVoiceSettings>
    getConnection: VoiceSettingsRouteDependencies['getConnection']
  } = { getSettings: getArtistManagerVoiceSettings, getConnection: getConfiguredConnection },
): Promise<VoiceFocusResolvedConfig> {
  const saved = parseArtistManagerVoiceSettings(await deps.getSettings())
  if (!saved.connectionSlug || !saved.model) throw new Error('Choose a conversation voice connection and model in Settings before starting')
  const settings = parseArtistManagerVoiceSettings({ ...saved, model: request.model ?? saved.model, thinking: request.thinking ?? saved.thinking })
  const connection = await deps.getConnection(saved.connectionSlug)
  if (!connection || connection.slug !== saved.connectionSlug) throw new Error('The selected conversation voice connection no longer exists; choose it in Settings')
  return { connection, model: settings.model!, thinking: settings.thinking }
}

const productionDependencies: VoiceFocusDependencies = {
  async resolveConfig(request) {
    const resolved = await resolveSavedVoiceFocusConfig(request)
    const { getWorkspaceByNameOrId } = await import('@craft-agent/shared/config/storage')
    if (!getWorkspaceByNameOrId(request.workspaceId)) throw new Error('Artist Manager workspace is unavailable')
    return resolved
  },
  resolveModel: resolveConfiguredVoiceModel,
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
  handoffTargets: VoiceHandoffTarget[]
  pendingHandoff?: { proposal: VoiceHandoffProposal; expiresAt: number }
  handedOff?: boolean
}
type OwnerState = { session?: SessionState }

/** Direct streaming with one confirmation-gated Command handoff; no general agent executor. */
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
      const model = await validateResolvedVoiceRoute(resolved.connection, resolved.model, this.deps.resolveModel)
      if (this.owners.get(ownerId) !== owner) throw new Error('Voice setup was cancelled')
      const info: VoiceFocusSession = { sessionId: randomUUID(), connection: resolved.connection.slug, model: resolved.model, thinking: request.thinking ?? resolved.thinking ?? 'low' }
      owner.session = { info, sdkModel: model, systemPrompt: request.systemPrompt, history: [], usedTurns: new Set(), handoffTargets: normalizeVoiceHandoffTargets(request.handoffTargets ?? []) }
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
    if (session.handedOff) throw new Error('This voice conversation has handed off to Command')
    if (session.active) throw new Error('A voice response is already running')
    if (session.usedTurns.has(request.turnId)) throw new Error('Voice turn was already submitted')
    if (session.usedTurns.size >= 1000) throw new Error('Start a new focused voice conversation')
    session.usedTurns.add(request.turnId)
    if (request.systemPrompt !== undefined) session.systemPrompt = request.systemPrompt
    const active: ActiveTurn = { id: request.turnId, controller: new AbortController() }
    session.active = active
    const signal = active.controller.signal
    const current = () => this.owners.get(ownerId)?.session === session && session.active === active && !signal.aborted
    const send = (event: { type: 'text_delta'; delta: string } | { type: 'done' } | VoiceFocusCompletion | { type: 'handoff_ready'; proposal: VoiceHandoffProposal }) => {
      if (current()) emit({ ...event, sessionId: session.info.sessionId, turnId: request.turnId })
    }
    let timedOut = false
    let incomplete = false
    const timer = setTimeout(() => { timedOut = true; active.controller.abort() }, this.deps.timeoutMs ?? VOICE_FOCUS_LIMITS.timeoutMs)
    let abortListener!: () => void
    const aborted = new Promise<never>((_, reject) => {
      abortListener = () => reject(new Error('Voice cancelled'))
      signal.addEventListener('abort', abortListener, { once: true })
    })
    const run = async () => {
      const pending = session.pendingHandoff
      session.pendingHandoff = undefined
      if (pending && pending.expiresAt > Date.now() && isVoiceHandoffConfirmation(request.text)) {
        // The app's previous turn named the destination and task. Consume once;
        // a bare yes without that live offer cannot open anything.
        session.handedOff = true
        send({ type: 'text_delta', delta: `I'll open Command with ${pending.proposal.agentName} and put our plan in a draft for you to review and send.` })
        send({ type: 'handoff_ready', proposal: pending.proposal })
        send({ type: 'done' })
        return
      }
      const handoffTool = buildVoiceHandoffTool(session.handoffTargets)
      const apiKey = await this.deps.getApiKey(session.info.connection)
      if (!current()) return
      if (!apiKey?.trim()) throw new Error('missing credential')
      const context: Context = {
        systemPrompt: session.systemPrompt,
        tools: handoffTool ? [handoffTool as NonNullable<Context['tools']>[number]] : [],
        messages: session.history.flatMap<Context['messages'][number]>(exchange => [
          { role: 'user', content: exchange.user, timestamp: 0 },
          { role: 'assistant', content: [{ type: 'text', text: exchange.assistant }], api: session.sdkModel.api, provider: session.sdkModel.provider, model: session.sdkModel.id, stopReason: 'stop', timestamp: 0, usage: emptyUsage() },
        ]),
      }
      context.messages.push({ role: 'user', content: request.text, timestamp: Date.now() })
      const stream = await this.deps.stream(session.sdkModel, context, {
        apiKey, signal, maxTokens: session.info.thinking === 'off' ? VOICE_FOCUS_LIMITS.outputTokens : VOICE_FOCUS_LIMITS.reasoningOutputTokens, maxRetries: 0,
        reasoning: session.info.thinking === 'off' ? undefined : session.info.thinking,
        toolChoice: handoffTool ? 'auto' : 'none',
      })
      let text = ''
      let done = false
      let proposal: VoiceHandoffProposal | null = null
      let toolStarts = 0
      for await (const event of stream) {
        if (!current()) return
        if (event.type === 'error') throw new Error('provider response failed')
        if (event.type.startsWith('toolcall')) {
          if (!handoffTool) throw new Error('unexpected tool')
          if (event.type === 'toolcall_start' && ++toolStarts > 1) throw new Error('multiple handoffs')
          if (event.type === 'toolcall_end') {
            if (proposal || event.toolCall?.name !== 'open_command_chat') throw new Error('invalid handoff')
            proposal = parseVoiceHandoffProposal(event.toolCall.arguments, randomUUID(), session.handoffTargets)
            if (!proposal) throw new Error('invalid handoff')
          }
          continue
        }
        if (event.type === 'text_delta' && event.delta) {
          if (text.length + event.delta.length > VOICE_FOCUS_LIMITS.outputChars) throw new Error('response limit')
          text += event.delta
          // A model can put an execution claim before its tool call. Hold this
          // short reply until its final shape is known when handoff is available.
          // Tool turns speak only the app's validated offer, never that preamble.
          if (!handoffTool) send({ type: 'text_delta', delta: event.delta })
        } else if (event.type === 'done') {
          send(completionMetadata(event))
          if (event.reason === 'length') {
            incomplete = true
            throw new Error('reply truncated')
          }
          if (proposal ? event.reason !== 'toolUse' : event.reason !== 'stop' || toolStarts > 0) throw new Error('unsupported completion')
          done = true
          break
        }
      }
      if (!current()) return
      if (!done || (!text.trim() && !proposal)) throw new Error('incomplete response')
      if (proposal) {
        const offer = `How about I open Command with ${proposal.agentName} to work on ${proposal.taskTitle}? I'll carry our plan over as a draft for you to review and send.`
        text = offer
        send({ type: 'text_delta', delta: offer })
        session.pendingHandoff = { proposal, expiresAt: Date.now() + 120_000 }
      } else if (handoffTool) {
        send({ type: 'text_delta', delta: text })
      }
      session.history.push({ user: request.text, assistant: text })
      while (session.history.length > VOICE_FOCUS_LIMITS.historyTurns || historySize(session.history) > VOICE_FOCUS_LIMITS.historyChars) session.history.shift()
      send({ type: 'done' })
    }
    try {
      await Promise.race([run(), aborted])
    } catch {
      session.pendingHandoff = undefined
      const shouldPublish = current() || (timedOut && this.owners.get(ownerId)?.session === session && session.active === active)
      active.controller.abort()
      if (shouldPublish) {
        try {
          emit({ sessionId: session.info.sessionId, turnId: request.turnId, type: 'error', message: timedOut ? 'Voice response timed out. Please try again.' : incomplete ? 'The voice reply was cut short. Please try again.' : 'Voice response failed. No fallback model was used.' })
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
function completionMetadata(event: StreamEvent): VoiceFocusCompletion {
  const record: VoiceFocusCompletion = {
    type: 'completion',
    finishReason: event.reason === 'stop' || event.reason === 'length' || event.reason === 'toolUse' ? event.reason : 'other',
  }
  const output = event.message?.usage?.output
  const reasoning = event.message?.usage?.reasoning
  if (typeof output === 'number' && Number.isSafeInteger(output) && output >= 0) record.outputTokens = output
  if (typeof reasoning === 'number' && Number.isSafeInteger(reasoning) && reasoning >= 0) record.reasoningTokens = reasoning
  return record
}
function emptyUsage() { return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } }
