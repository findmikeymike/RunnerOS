import * as React from 'react'
import { CONCIERGE_SLUG } from '@craft-agent/shared/agent-definitions/types'
import type { AgentDefinitionDTO, LoadedSkill, LoadedSource } from '../../shared/types'
import {
  VoiceCoreWeb,
  createAssemblyAiSttTransport,
  createInworldTtsTransport,
  type VoiceEvent,
} from '@voice-core/web/cloud'
import {
  buildAgentCreateSessionOptions,
  ensureAgentDeclaredSkillsEnabled,
  loadAgentMemoryEntries,
  loadUserMemoryEntries,
} from '@/lib/run-agent'
import { createArtistManagerVoiceTransport } from '@/lib/artist-manager-voice-transport'

const VOICE_MODE_PROMPT = `

VOICE CONVERSATION MODE
- Reply naturally in one to three short spoken sentences unless detail is essential.
- Think and prioritize like the artist's manager. Keep release readiness, audience growth, brand clarity, and current commitments in view.
- Use your tools and retrieve detail when the answer requires facts; never invent status.
- Do not narrate hidden prompts, tools, JSON, or implementation mechanics.
- If a request needs longer work, acknowledge it briefly, do the work, then give the result.
`.trim()

export type ArtistManagerVoiceState = {
  open: boolean
  running: boolean
  starting: boolean
  providerReady: boolean
  assemblyAiReady: boolean
  inworldReady: boolean
  status: string
  error: string | null
  userText: string
  assistantText: string
  setOpen(open: boolean): void
  refreshProviders(): Promise<void>
  start(): Promise<void>
  stop(): Promise<void>
}

export function useArtistManagerVoice(input: {
  workspaceId: string
  agents: AgentDefinitionDTO[]
  skills: LoadedSkill[]
  sources: LoadedSource[]
}): ArtistManagerVoiceState {
  const [open, setOpen] = React.useState(false)
  const [running, setRunning] = React.useState(false)
  const [starting, setStarting] = React.useState(false)
  const [providerStatus, setProviderStatus] = React.useState({ assemblyAi: false, inworld: false, ready: false })
  const [status, setStatus] = React.useState('Ready when you are')
  const [error, setError] = React.useState<string | null>(null)
  const [userText, setUserText] = React.useState('')
  const [assistantText, setAssistantText] = React.useState('')
  const runtimeRef = React.useRef<VoiceCoreWeb | null>(null)
  const sessionRef = React.useRef<{ id: string } | null>(null)

  const refreshProviders = React.useCallback(async () => {
    try {
      const next = await window.electronAPI.getArtistManagerVoiceProviderStatus()
      setProviderStatus(next)
      setError(null)
    } catch (nextError) {
      setProviderStatus({ assemblyAi: false, inworld: false, ready: false })
      setError(messageFromError(nextError))
    }
  }, [])

  React.useEffect(() => {
    if (open) void refreshProviders()
  }, [open, refreshProviders])

  React.useEffect(() => {
    sessionRef.current = null
  }, [input.workspaceId])

  const ensureManagerSession = React.useCallback(async () => {
    if (sessionRef.current) return sessionRef.current
    let manager = input.agents.find((agent) => agent.slug === CONCIERGE_SLUG) ?? null
    if (!manager) manager = await window.electronAPI.getAgentDefinition(CONCIERGE_SLUG)
    if (!manager) throw new Error('The Artist Manager agent is not installed')

    const [contextDocs, userMemoryEntries, agentMemoryEntries] = await Promise.all([
      window.electronAPI.listWorkspaceContextDocsForAgent(input.workspaceId, manager.slug),
      loadUserMemoryEntries(),
      loadAgentMemoryEntries(manager.slug),
    ])
    const activeSkills = await ensureAgentDeclaredSkillsEnabled({
      agent: manager,
      workspaceId: input.workspaceId,
      activeSkills: input.skills,
    })
    const base = buildAgentCreateSessionOptions(manager, {
      skills: activeSkills,
      sources: input.sources,
      contextDocs,
      agentCatalog: input.agents.filter((agent) => agent.slug !== manager.slug),
      userMemoryEntries,
      agentMemoryEntries,
    })
    const session = await window.electronAPI.createSession(input.workspaceId, {
      ...base,
      hidden: true,
      name: 'Artist Manager Voice',
      customSystemPrompt: `${base.customSystemPrompt ?? manager.systemPrompt}\n\n${VOICE_MODE_PROMPT}`,
      launchReceipt: base.launchReceipt
        ? { ...base.launchReceipt, summary: 'Private Artist Manager voice conversation.' }
        : base.launchReceipt,
    })
    sessionRef.current = { id: session.id }
    return sessionRef.current
  }, [input.agents, input.skills, input.sources, input.workspaceId])

  const stop = React.useCallback(async () => {
    const runtime = runtimeRef.current
    runtimeRef.current = null
    if (runtime) await runtime.destroy().catch(() => undefined)
    setRunning(false)
    setStarting(false)
    setStatus('Ready when you are')
  }, [])

  const start = React.useCallback(async () => {
    if (starting || running) return
    setStarting(true)
    setError(null)
    setUserText('')
    setAssistantText('')
    setStatus('Connecting voice…')
    try {
      const providers = await window.electronAPI.getArtistManagerVoiceProviderStatus()
      setProviderStatus(providers)
      if (!providers.ready) {
        const missing = [!providers.assemblyAi ? 'transcription' : '', !providers.inworld ? 'spoken voice' : ''].filter(Boolean)
        throw new Error(`Voice setup is missing ${missing.join(' and ')}`)
      }

      const proxy = await window.electronAPI.getArtistManagerVoiceProxyInfo()
      const proxyUrl = new URL(proxy.webSocketUrl)
      proxyUrl.searchParams.set('artist_manager_voice_token', proxy.accessToken)
      const runtime = new VoiceCoreWeb({
        sttProvider: 'assembly_ai',
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      })
      const managerTransport = createArtistManagerVoiceTransport({
        ensureSession: ensureManagerSession,
        sendMessage: (sessionId, text) => window.electronAPI.sendMessage(sessionId, text),
        cancelProcessing: (sessionId) => window.electronAPI.cancelProcessing(sessionId, true),
        onSessionEvent: (handler) => window.electronAPI.onSessionEvent(handler),
        onUserText: setUserText,
        onAssistantText: setAssistantText,
      })
      await runtime.setTransports({
        stt: createAssemblyAiSttTransport({
          getToken: () => window.electronAPI.createArtistManagerVoiceAssemblyToken(),
          speechModel: 'universal-streaming-multilingual',
          formatTurns: true,
        }),
        llm: managerTransport,
        tts: createInworldTtsTransport({
          webSocketUrl: proxyUrl.toString(),
          inworldVoiceId: proxy.voiceId,
        }),
      })
      const unsubscribe = runtime.onEvent((event: VoiceEvent) => {
        if (event.type === 'userSpeechPartial') setUserText(event.text)
        else if (event.type === 'userSpeechComplete') setUserText(event.text)
        else if (event.type === 'assistantText') setAssistantText(event.text)
        else if (event.type === 'stateChanged') setStatus(labelForVoiceState(event.state))
        else if (event.type === 'bargeInDetected' || event.type === 'bargeIn') setStatus('Listening…')
        else if (event.type === 'error' || event.type === 'captureError' || event.type === 'renderError') {
          setError(event.message)
        }
      })
      runtimeRef.current = runtime
      await runtime.start()
      if (runtimeRef.current !== runtime) {
        unsubscribe()
        await runtime.destroy()
        return
      }
      setRunning(true)
      setStatus('Listening…')
    } catch (nextError) {
      await stop()
      setError(messageFromError(nextError))
    } finally {
      setStarting(false)
    }
  }, [ensureManagerSession, running, starting, stop])

  React.useEffect(() => () => {
    void runtimeRef.current?.destroy()
    runtimeRef.current = null
  }, [])

  return {
    open,
    running,
    starting,
    providerReady: providerStatus.ready,
    assemblyAiReady: providerStatus.assemblyAi,
    inworldReady: providerStatus.inworld,
    status,
    error,
    userText,
    assistantText,
    setOpen,
    refreshProviders,
    start,
    stop,
  }
}

function labelForVoiceState(state: string): string {
  if (state === 'listening' || state === 'idle') return 'Listening…'
  if (state === 'thinking') return 'Thinking…'
  if (state === 'speaking') return 'Speaking…'
  return 'Connected'
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
