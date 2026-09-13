import { isChatGptVoiceConnection } from '../shared/voice-subscription-route'
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

import { normalizeVoiceHandoffTargets, buildVoiceHandoffTool, buildVoiceNativeDraftTool, parseVoiceHandoffProposal, parseVoiceNativeDraftProposal, isVoiceHandoffConfirmation, type VoiceHandoffTarget, type VoiceHandoffProposal, type VoiceNativeDraftProposal } from '../shared/artist-manager-voice-handoff'
import { resolveVoiceHandoffIntent } from './artist-manager-voice-handoff-intent'
import { selectVoiceOpener, voiceArtistName } from '../shared/artist-manager-voice-openers'
import { buildVoiceOpeningGreetingPrompt } from '../shared/artist-manager-voice-persona'

type StreamEvent = { contentIndex?: number; partial?: { content?: Array<{ type: string; name?: string; arguments?: unknown }> }; type: string; delta?: string; reason?: string; toolCall?: { name: string; arguments: unknown }; message?: { usage?: { output?: number; reasoning?: number } } }
export type VoiceFocusResolvedConfig = { connection: LlmConnection; model: string; thinking?: ArtistManagerVoiceSettings['thinking']; style?: ArtistManagerVoiceSettings['style'] }
export type VoiceFocusDiagnostic = {
  stage: 'turn' | 'first-text' | 'speech-streaming' | 'intent' | 'offer' | 'clarification' | 'confirmed' | 'completed' | 'failed'
  sessionId: string
  turnId: string
  pendingOffer?: boolean
  confirmation?: boolean
  targetCount?: number
  toolCalls?: number
  route?: 'background-draft' | 'command'
  intent?: 'confirm' | 'continue' | 'clarify'
}
export type VoiceFocusDependencies = {
  resolveConfig(request: VoiceFocusRegisterRequest): Promise<VoiceFocusResolvedConfig>
  resolveModel(connection: LlmConnection, model: string): Promise<Model<Api>>
  getApiKey(connection: string, signal?: AbortSignal, expectedModel?: Model<Api>): Promise<string | null>
  stream(model: Model<Api>, context: Context, options: SimpleStreamOptions): AsyncIterable<StreamEvent> | Promise<AsyncIterable<StreamEvent>>
  timeoutMs?: number
}

const supportedApis = new Set(['openai-completions', 'openai-responses', 'anthropic-messages', 'openai-codex-responses'])
const bareModel = (id: string) => id.startsWith('pi/') ? id.slice(3) : id
const SPEECH_MODE_PROMPT = 'Respond using exactly one available tool. Use voice_reply for conversation or advice, open_command_chat for an agreed handoff, and propose_background_draft only when that tool is available for a local draft proposal. voice_reply streams directly to speech, so keep it to 1–3 short sentences and at most 60 words unless more is requested. Never put text outside the tool or combine tools.\n\n'
const SPEECH_TOOL: NonNullable<Context['tools']>[number] = {
  name: 'voice_reply',
  description: 'Speak an ordinary conversational reply. This only speaks; it does not execute work, navigate, or hand off. Use for advice, questions, discussion, and acknowledgements.',
  parameters: { type: 'object', properties: { text: { type: 'string', description: 'The spoken answer: 1–3 short sentences, at most 60 words unless more was requested.' } }, required: ['text'], additionalProperties: false } as NonNullable<Context['tools']>[number]['parameters'],
}

// Keep provider payload validation separate from speech parsing. A changed SDK
// shape must not silently turn the enforced speech choice into a free-text turn.
function requireSpeechChoice(payload: unknown, background = false): unknown {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('invalid voice payload')
  const value = payload as Record<string, unknown>
  const thinking = value.thinking
  if (!thinking || typeof thinking !== 'object' || !('type' in thinking) || thinking.type !== 'disabled') throw new Error('voice reasoning must be disabled')
  const tools = value.tools
  const expected = ['voice_reply', 'open_command_chat', ...(background ? ['propose_background_draft'] : [])]
  if (!Array.isArray(tools) || tools.length !== expected.length || !tools.every((tool, index) =>
    tool?.type === 'function' && tool.function?.name === expected[index])) throw new Error('invalid voice tools')
  return { ...value, tool_choice: 'required', parallel_tool_calls: false }
}

// A greeting needs no career snapshot. Keep the whole-utterance boundary narrow:
// "hey, what agent helps with campaigns?" must still receive the full context.
function isOpeningGreeting(text: string): boolean {
  const normalized = text.toLowerCase().replace(/[’‘]/g, "'")
    .replace(/[.,!?，。！？]/g, ' ').replace(/\s+/g, ' ').trim()
  return /^(?:(?:um|uh) )?(?:(?:hello|hi|hey|yo)(?: there)?(?: (?:how are you|how's it going|what's up))?|how are you|how's it going|what's up|mm|hmm|um|uh)$/.test(normalized)
}

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
  const chatGpt = isChatGptVoiceConnection(connection)
  if (!chatGpt && connection.authType !== 'api_key' && connection.authType !== 'api_key_with_endpoint') {
    throw new Error('Use a ChatGPT connection or an API-key provider for Conversation. Claude requires an Anthropic API key.')
  }
  const model = await resolveModel(connection, requestedModel)
  if (bareModel(requestedModel) !== model.id || !supportedApis.has(model.api)) throw new Error('The exact voice model is unavailable; no fallback was used')
  if (chatGpt) {
    if (model.provider !== 'openai-codex' || model.api !== 'openai-codex-responses' || model.baseUrl !== 'https://chatgpt.com/backend-api') {
      throw new Error('The ChatGPT voice route must use the official subscription endpoint')
    }
  } else if (model.api === 'openai-codex-responses') {
    throw new Error('Choose a signed-in ChatGPT connection for this voice model')
  }
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
  if (!connection || connection.slug !== settings.connectionSlug) throw new Error('The connection for your voice model no longer exists; choose a model in Settings → Conversation')
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
  if (!saved.connectionSlug || !saved.model) throw new Error('Choose a voice model in Settings → Conversation before starting')
  const settings = parseArtistManagerVoiceSettings({ ...saved, model: request.model ?? saved.model, thinking: request.thinking ?? saved.thinking })
  const connection = await deps.getConnection(saved.connectionSlug)
  if (!connection || connection.slug !== saved.connectionSlug) throw new Error('The connection for your voice model no longer exists; choose a model in Settings → Conversation')
  return { connection, model: settings.model!, thinking: settings.thinking, style: settings.style }
}

const productionDependencies: VoiceFocusDependencies = {
  async resolveConfig(request) {
    const resolved = await resolveSavedVoiceFocusConfig(request)
    const { getWorkspaceByNameOrId } = await import('@craft-agent/shared/config/storage')
    if (!getWorkspaceByNameOrId(request.workspaceId)) throw new Error('Artist Manager workspace is unavailable')
    return resolved
  },
  resolveModel: resolveConfiguredVoiceModel,
  async getApiKey(connection, signal, expectedModel) {
    const configured = await getConfiguredConnection(connection)
    if (!configured) throw new Error('Voice connection was removed')
    if (expectedModel) {
      const currentModel = await validateResolvedVoiceRoute(configured, expectedModel.id, resolveConfiguredVoiceModel)
      if (currentModel.provider !== expectedModel.provider || currentModel.api !== expectedModel.api || currentModel.baseUrl !== expectedModel.baseUrl) {
        throw new Error('Voice connection changed; start a new conversation')
      }
    }
    if (isChatGptVoiceConnection(configured)) {
      const { getChatGptAccessToken } = await import('@craft-agent/shared/auth/chatgpt-credentials')
      return getChatGptAccessToken(connection, signal)
    }
    if (configured.authType !== 'api_key' && configured.authType !== 'api_key_with_endpoint') throw new Error('Voice connection changed; choose a model again')
    const { getCredentialManager } = await import('@craft-agent/shared/credentials')
    return getCredentialManager().getLlmApiKey(connection)
  },
  async stream(model, context, options) {
    const { streamSimple } = await import('@earendil-works/pi-ai/compat')
    return streamSimple(model, context, options)
  },
}

export type VoiceFocusWorkHost = {
  context?(ownerId: number, workspaceId: string, sessionId: string): Promise<{text: string; unresolved: boolean}>
  enabled(ownerId: number, workspaceId: string): boolean
  launch(input: { ownerId: number; workspaceId: string; sessionId: string; turnId: string; proposal: VoiceNativeDraftProposal }): Promise<{ taskId: string; state: string }>
}

const WORK_MODE_PROMPT = '\n\nNative local draft work is available through propose_background_draft. It proposes a bounded local draft with an active specialist; the app asks for confirmation and enforces permissions before launch. Publishing, sending, spending, credentials and destructive work are unavailable through voice. Use open_command_chat for those or unsupported work, explaining that it opens an unsent brief for review. ROUTING: local draft requests default to propose_background_draft, even when the artist names a specialist. For example, “ask Scriptwriter to draft a short-form script” means background work. Use open_command_chat when the artist explicitly wants to open Command or work directly in a specialist chat, for example “open Scriptwriter so I can work with him”. Do not substitute Command merely because a specialist is named. If the requested focus or route is unclear, ask one necessary question through voice_reply. Never offer both routes for the same request. Never claim work started from a proposal. Never put work instructions into voice_reply. Keep talking while admitted work runs.'

type Exchange = { user: string | null; assistant: string }
type ActiveTurn = { id: string; controller: AbortController }
type SessionState = {
  info: VoiceFocusSession
  sdkModel: Model<Api>
  systemPrompt: string
  greetingPrompt: string
  workspaceId: string
  artistName: string
  history: Exchange[]
  active?: ActiveTurn
  usedTurns: Set<string>
  handoffTargets: VoiceHandoffTarget[]
  pendingHandoff?: { proposal: VoiceNativeDraftProposal; expiresAt: number; background?: boolean }
  // Admission identity and its outcome outlive an interrupted speech turn or offer expiry.
  workAdmission?: {
    proposal: VoiceNativeDraftProposal
    inFlight?: Promise<{ taskId: string; state: string }>
    result?: { taskId: string; state: string }
  }
  deliveredWork?: Set<string>
  handedOff?: boolean
}
type OwnerState = { session?: SessionState }

/** Direct streaming with one confirmation-gated Command handoff; no general agent executor. */
export class ArtistManagerVoiceFocusService {
  private readonly recentOpeners = new Map<string, number>()
  private readonly owners = new Map<number, OwnerState>()
  constructor(
    private readonly deps: VoiceFocusDependencies = productionDependencies,
    private readonly onDiagnostic?: (event: VoiceFocusDiagnostic) => void,
    private readonly work?: VoiceFocusWorkHost,
  ) {}

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
      const nativeTasks = request.workBridgeVersion === 1 && this.work?.enabled(ownerId, request.workspaceId) === true
        && (request.thinking ?? resolved.thinking) === 'off' && model.provider === 'deepseek' && model.api === 'openai-completions' && model.id === 'deepseek-v4-flash' && model.baseUrl === 'https://api.deepseek.com'
      const info: VoiceFocusSession = { ...(nativeTasks ? { nativeTasks: true } : {}), sessionId: randomUUID(), connection: resolved.connection.slug, model: resolved.model, thinking: request.thinking ?? resolved.thinking ?? 'low' }
      owner.session = { info, workspaceId: request.workspaceId, artistName: voiceArtistName(request.artistName), sdkModel: model, systemPrompt: request.systemPrompt, greetingPrompt: buildVoiceOpeningGreetingPrompt(resolved.style), history: [], usedTurns: new Set(), handoffTargets: normalizeVoiceHandoffTargets(request.handoffTargets ?? []) }
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
    if (request.opening !== undefined && typeof request.opening !== 'boolean') throw new Error('Invalid opening mode')
    if (request.opening && session.usedTurns.size > 0) throw new Error('Opening is only available before the first voice turn')
    if (session.handedOff) throw new Error('This voice conversation has handed off to Command')
    if (session.active) throw new Error('A voice response is already running')
    if (session.usedTurns.has(request.turnId)) throw new Error('Voice turn was already submitted')
    if (session.usedTurns.size >= 1000) throw new Error('Start a new focused voice conversation')
    session.usedTurns.add(request.turnId)
    if (request.systemPrompt !== undefined) session.systemPrompt = request.systemPrompt
    const active: ActiveTurn = { id: request.turnId, controller: new AbortController() }
    session.active = active
    const signal = active.controller.signal
    const diagnostic = (details: Omit<VoiceFocusDiagnostic, 'sessionId' | 'turnId'>) => {
      // Fixed scalar fields only: no speech, brief, provider payload or credentials.
      try { this.onDiagnostic?.({ ...details, sessionId: session.info.sessionId, turnId: request.turnId }) } catch { /* Logging cannot break a call. */ }
    }
    const current = () => this.owners.get(ownerId)?.session === session && session.active === active && !signal.aborted
    const send = (event: { type: 'text_delta'; delta: string } | { type: 'done' } | VoiceFocusCompletion | { type: 'handoff_ready'; proposal: VoiceHandoffProposal } | { type: 'work_admitted'; taskId: string }) => {
      if (current()) emit({ ...event, sessionId: session.info.sessionId, turnId: request.turnId })
    }
    let timedOut = false
    let incomplete = false
    // Keep an already offered destination if the artist interrupts the intent
    // check. A later clear yes can still accept it, until its original expiry.
    let pendingIntentUnresolved = false
    const timer = setTimeout(() => { timedOut = true; active.controller.abort() }, this.deps.timeoutMs ?? VOICE_FOCUS_LIMITS.timeoutMs)
    let abortListener!: () => void
    const aborted = new Promise<never>((_, reject) => {
      abortListener = () => reject(new Error('Voice cancelled'))
      signal.addEventListener('abort', abortListener, { once: true })
    })
    const run = async () => {
      const remember = (text: string) => {
        session.history.push({ user: request.opening ? null : request.text, assistant: text })
        while (session.history.length > VOICE_FOCUS_LIMITS.historyTurns || historySize(session.history) > VOICE_FOCUS_LIMITS.historyChars) session.history.shift()
      }
      if (request.opening) {
        const opener = selectVoiceOpener(session.artistName, this.recentOpeners.get(session.workspaceId))
        this.recentOpeners.delete(session.workspaceId)
        this.recentOpeners.set(session.workspaceId, opener.index)
        if (this.recentOpeners.size > 128) this.recentOpeners.delete(this.recentOpeners.keys().next().value!)
        remember(opener.text)
        send({ type: 'text_delta', delta: opener.text })
        send({ type: 'done' })
        return
      }
      const pending = session.pendingHandoff ?? (session.workAdmission ? { proposal: session.workAdmission.proposal, background: true, expiresAt: Infinity } : undefined)
      const pendingOffer = Boolean(pending && pending.expiresAt > Date.now())
      if (!pendingOffer) session.pendingHandoff = undefined
      let confirmation = isVoiceHandoffConfirmation(request.text)
      diagnostic({ stage: 'turn', pendingOffer, confirmation, targetCount: session.handoffTargets.length })
      let apiKey: string | null | undefined
      let continuingAfterOffer = false
      if (pending && pendingOffer && !confirmation && !pending.background) {
        pendingIntentUnresolved = true
        apiKey = await this.deps.getApiKey(session.info.connection, signal, session.sdkModel)
        if (!current()) return
        if (!apiKey?.trim()) throw new Error('missing credential')
        const intent = await resolveVoiceHandoffIntent({
          model: session.sdkModel, stream: this.deps.stream, apiKey,
          proposal: pending.proposal, text: request.text, signal,
        })
        if (!current()) return
        pendingIntentUnresolved = false
        diagnostic({ stage: 'intent', intent })
        confirmation = intent === 'confirm'
        if (intent === 'clarify') {
          const reply = `Want me to open ${pending.proposal.agentName} in Command, or keep talking? Say yes to open it.`
          session.pendingHandoff = { ...pending, expiresAt: Date.now() + 120_000 }
          remember(reply)
          send({ type: 'text_delta', delta: reply })
          diagnostic({ stage: 'clarification' })
          send({ type: 'done' })
          return
        }
        continuingAfterOffer = intent === 'continue'
      }
      session.pendingHandoff = undefined
      if (pending && pendingOffer && confirmation) {
        if (pending.background) {
          if (!session.info.nativeTasks || !this.work?.enabled(ownerId, session.workspaceId)) {
            send({ type: 'text_delta', delta: 'Background work is unavailable. We can keep talking or open this draft in Command.' })
            send({ type: 'done' }); return
          }
          const admission = session.workAdmission ??= { proposal: pending.proposal }
          pendingIntentUnresolved = true
          try {
            // Reuse the original attempt even if speech was interrupted while the host was admitting it.
            if (!admission.result) {
              const attempt = admission.inFlight ??= this.work.launch({ ownerId, workspaceId: session.workspaceId, sessionId: session.info.sessionId, turnId: request.turnId, proposal: admission.proposal })
              try { admission.result = await attempt }
              finally { if (admission.inFlight === attempt) admission.inFlight = undefined }
            }
            const admitted = admission.result
            if (!['running', 'succeeded', 'waiting_for_user', 'waiting_for_approval'].includes(admitted.state)) throw new Error('admission uncertain')
            if (!current()) return // Retain the outcome for reconciliation; detach speech only.
            const reply = `${admission.proposal.agentName} has the draft task. We can keep talking while they work.`
            remember(reply)
            send({ type: 'work_admitted', taskId: admitted.taskId })
            session.workAdmission = undefined
            pendingIntentUnresolved = false
            send({ type: 'text_delta', delta: reply }); send({ type: 'done' }); return
          } catch {
            if (!current()) return
            // The separate admission record retains its original identity without an offer expiry.
            send({ type: 'text_delta', delta: "I couldn't confirm that task started. Check its existing task status before retrying; we can keep talking." })
            send({ type: 'done' }); return
          }
        }
        // The app's previous turn named the destination and task. Consume once;
        // a bare yes without that live offer cannot open anything.
        session.handedOff = true
        diagnostic({ stage: 'confirmed' })
        send({ type: 'text_delta', delta: `I'll open Command with ${pending.proposal.agentName} and put our plan in a draft for you to review and send.` })
        send({ type: 'handoff_ready', proposal: pending.proposal })
        send({ type: 'done' })
        return
      }
      const greetingOnly = session.history.length === 0 && isOpeningGreeting(request.text)
      const handoffTool = greetingOnly || continuingAfterOffer ? null : buildVoiceHandoffTool(session.handoffTargets)
      apiKey ??= await this.deps.getApiKey(session.info.connection, signal, session.sdkModel)
      if (!current()) return
      if (!apiKey?.trim()) throw new Error('missing credential')
      // DeepSeek rejects required tools while reasoning is enabled. Enable this
      // verified streaming envelope only on its non-reasoning route; preserve
      // the existing protocol for other providers and thinking settings.
      const workContext = session.info.nativeTasks && this.work?.context
        ? await this.work.context(ownerId, session.workspaceId, session.info.sessionId).catch(() => ({text: '\nTask status is unavailable. Do not propose new background work until it is reconciled.', unresolved: true}))
        : {text: '', unresolved: false}
      if (!current()) return
      const backgroundTool = !workContext.unresolved && handoffTool && !session.workAdmission && session.info.nativeTasks && this.work?.enabled(ownerId, session.workspaceId)
        ? buildVoiceNativeDraftTool(session.handoffTargets) : null
      if (backgroundTool && handoffTool) handoffTool.description = 'Open an UNSENT brief only when the artist explicitly requests Command or direct work in a specialist chat, or for work unsupported by local background drafting. A request to have a specialist draft something belongs to propose_background_draft. This tool ends the voice call after confirmation; it does not execute work. ' + handoffTool.description
      const speechEnvelope = !!handoffTool && session.info.thinking === 'off'
        && session.sdkModel.provider === 'deepseek' && session.sdkModel.api === 'openai-completions'
        && session.sdkModel.id === 'deepseek-v4-flash' && session.sdkModel.baseUrl === 'https://api.deepseek.com'
      const context: Context = {
        systemPrompt: greetingOnly ? session.greetingPrompt : (speechEnvelope ? SPEECH_MODE_PROMPT : '') + session.systemPrompt + workContext.text + (backgroundTool ? WORK_MODE_PROMPT : '') + (session.workAdmission ? '\n\nAn earlier local draft admission is still being reconciled. Keep talking, but do not offer or imply a replacement draft or claim its execution outcome. Refer to its existing task status; a new call must recover its journal identity before any retry.' : '') + (continuingAfterOffer
          ? '\n\nThe artist wants to continue talking or change the plan. Answer their latest reply naturally. Do not repeat the previous handoff offer in this reply, and do not claim the app lacks handoff capability. A new handoff can be offered on a later turn after the revised work is agreed.' : ''),
        tools: handoffTool ? [...(speechEnvelope ? [SPEECH_TOOL] : []), handoffTool as NonNullable<Context['tools']>[number], ...(backgroundTool ? [backgroundTool as NonNullable<Context['tools']>[number]] : [])] : [],
        messages: session.history.flatMap<Context['messages'][number]>(exchange => [
          ...(exchange.user === null ? [] : [{ role: 'user' as const, content: exchange.user, timestamp: 0 }]),
          { role: 'assistant', content: [{ type: 'text', text: exchange.assistant }], api: session.sdkModel.api, provider: session.sdkModel.provider, model: session.sdkModel.id, stopReason: 'stop', timestamp: 0, usage: emptyUsage() },
        ]),
      }
      context.messages.push({ role: 'user', content: request.text, timestamp: Date.now() })
      const stream = await this.deps.stream(session.sdkModel, context, {
        transport: session.sdkModel.api === 'openai-codex-responses' ? 'sse' : undefined,
        apiKey, signal, maxTokens: session.info.thinking === 'off' ? VOICE_FOCUS_LIMITS.outputTokens : VOICE_FOCUS_LIMITS.reasoningOutputTokens, maxRetries: 0,
        reasoning: session.info.thinking === 'off' ? undefined : session.info.thinking,
        toolChoice: handoffTool ? 'auto' : 'none',
        // The common SDK options expose only auto/none; its supported payload
        // hook carries DeepSeek's required choice without a type cast or retry.
        onPayload: speechEnvelope ? payload => requireSpeechChoice(payload, !!backgroundTool) : undefined,
      })
      let text = ''
      let done = false
      let proposal: VoiceNativeDraftProposal | null = null
      let backgroundProposal = false
      let toolStarts = 0
      let speechTool = false
      let toolCompleted = false
      let providerTextSeen = false
      const streamSpeech = (value: unknown) => {
        if (typeof value !== 'string' || value.length > VOICE_FOCUS_LIMITS.outputChars || !value.startsWith(text)) throw new Error('invalid streamed speech')
        const delta = value.slice(text.length)
        text = value
        if (delta) {
          if (!providerTextSeen) { providerTextSeen = true; diagnostic({ stage: 'first-text' }) }
          send({ type: 'text_delta', delta })
        }
      }
      for await (const event of stream) {
        if (!current()) return
        if (event.type === 'error') throw new Error('provider response failed')
        if (event.type.startsWith('toolcall')) {
          if (!handoffTool || toolCompleted) throw new Error('unexpected tool')
          if (event.type === 'toolcall_start' && ++toolStarts > 1) throw new Error('multiple handoffs')
          const partial = event.contentIndex === undefined ? undefined : event.partial?.content?.[event.contentIndex]
          const call = event.type === 'toolcall_end' ? event.toolCall : partial?.type === 'toolCall' ? partial : undefined
          if (call?.name) {
            if (speechTool && call.name !== 'voice_reply') throw new Error('tool after speech commitment')
            if (call.name === 'voice_reply') {
              if (!speechEnvelope) throw new Error('unexpected speech tool')
              if (!speechTool) {
                speechTool = true
                text = '' // Never speak or retain a provider preamble outside the speech tool.
                diagnostic({ stage: 'speech-streaming' })
              }
              const args = call.arguments
              if (args && typeof args === 'object' && !Array.isArray(args) && 'text' in args) streamSpeech(args.text)
              if (event.type === 'toolcall_end') {
                if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).length !== 1 || !('text' in args) || !text.trim()) throw new Error('invalid speech tool')
                toolCompleted = true
              }
            } else if (call.name !== 'open_command_chat' && !(backgroundTool && call.name === 'propose_background_draft')) throw new Error('invalid handoff')
          }
          if (event.type === 'toolcall_end' && !speechTool) {
            if (proposal || (event.toolCall?.name !== 'open_command_chat' && !(backgroundTool && event.toolCall?.name === 'propose_background_draft'))) throw new Error('invalid handoff')
            backgroundProposal = event.toolCall?.name === 'propose_background_draft'
            proposal = (backgroundProposal ? parseVoiceNativeDraftProposal : parseVoiceHandoffProposal)(event.toolCall.arguments, randomUUID(), session.handoffTargets)
            if (!proposal) throw new Error('invalid handoff')
            toolCompleted = true
          }
          continue
        }
        if (event.type === 'text_delta' && event.delta) {
          if (!providerTextSeen) { providerTextSeen = true; diagnostic({ stage: 'first-text' }) }
          if (text.length + event.delta.length > VOICE_FOCUS_LIMITS.outputChars) throw new Error('response limit')
          text += event.delta
          if (speechTool) throw new Error('text outside speech tool')
          if (!handoffTool) send({ type: 'text_delta', delta: event.delta })
        } else if (event.type === 'done') {
          send(completionMetadata(event))
          if (event.reason === 'length') {
            incomplete = true
            throw new Error('reply truncated')
          }
          if (proposal || speechTool ? event.reason !== 'toolUse' || !toolCompleted : event.reason !== 'stop' || toolStarts > 0) throw new Error('unsupported completion')
          done = true
          break
        }
      }
      if (!current()) return
      if (!done || (!text.trim() && !proposal)) throw new Error('incomplete response')
      if (proposal) {
        const offer = backgroundProposal ? `Have ${proposal.agentName}${proposal.taskModeLabel ? ` using ${proposal.taskModeLabel}` : ''} draft ${proposal.taskTitle} while we keep talking? This only starts local draft work.` : `How about I open Command with ${proposal.agentName} to work on ${proposal.taskTitle}? I'll carry our plan over as a draft for you to review and send.`
        text = offer
        send({ type: 'text_delta', delta: offer })
        session.pendingHandoff = { proposal, expiresAt: Date.now() + 120_000, ...(backgroundProposal ? { background: true } : {}) }
        diagnostic({ stage: 'offer', toolCalls: toolStarts || 1, route: backgroundProposal ? 'background-draft' : 'command' })
      } else if (handoffTool && !speechTool) {
        send({ type: 'text_delta', delta: text })
      }
      remember(text)
      send({ type: 'done' })
      diagnostic({ stage: 'completed', toolCalls: proposal ? 1 : 0 })
    }
    try {
      await Promise.race([run(), aborted])
    } catch {
      diagnostic({ stage: 'failed' })
      if (!pendingIntentUnresolved) session.pendingHandoff = undefined
      const shouldPublish = current() || (timedOut && this.owners.get(ownerId)?.session === session && session.active === active)
      active.controller.abort()
      if (shouldPublish) {
        try {
          emit({ sessionId: session.info.sessionId, turnId: request.turnId, type: 'error', message: session.workAdmission ? 'The voice reply stopped while draft admission was being confirmed. The task may still be running; check its existing task status before retrying.' : timedOut ? 'Voice response timed out. Please try again.' : incomplete ? 'The voice reply was cut short. Please try again.' : 'Voice response failed. No fallback model was used.' })
        } catch { /* A destroyed renderer must not prevent provider cancellation. */ }
      }
    } finally {
      clearTimeout(timer)
      signal.removeEventListener('abort', abortListener)
      if (session.active === active) session.active = undefined
    }
  }

  recordWorkDelivery(ownerId: number, sessionId: string, deliveryId: string, text: string): void {
    const session = this.ownedSession(ownerId, sessionId)
    session.deliveredWork ??= new Set()
    if (session.deliveredWork.has(deliveryId)) return
    session.deliveredWork.add(deliveryId)
    if (session.deliveredWork.size > 100) session.deliveredWork.delete(session.deliveredWork.values().next().value!)
    session.history.push({user: null, assistant: text})
    while (session.history.length > VOICE_FOCUS_LIMITS.historyTurns || historySize(session.history) > VOICE_FOCUS_LIMITS.historyChars) session.history.shift()
  }
  ownedWorkspace(ownerId: number, sessionId: string): string { return this.ownedSession(ownerId, sessionId).workspaceId }

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
function historySize(history: Exchange[]): number { return history.reduce((size, exchange) => size + (exchange.user?.length ?? 0) + exchange.assistant.length, 0) }
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
