import * as React from 'react'
import { CONCIERGE_SLUG } from '@craft-agent/shared/agent-definitions/types'
import type { AgentDefinitionDTO, LoadedSkill, LoadedSource, ArtistManagerMoonshineStatus } from '../../shared/types'
import { VoiceCoreWeb, createAssemblyAiSttTransport, createInworldTtsTransport, type VoiceEvent } from '@voice-core/web/cloud'
import { normalizeVoiceHandoffTargets, type VoiceHandoffTarget, type VoiceHandoffProposal } from '../../shared/artist-manager-voice-handoff'
import { createVoiceHandoffCoordinator } from '@/lib/artist-manager-voice-handoff'
import { createVoiceFocusTransport } from '@/lib/artist-manager-voice-focus-transport'
import { buildVoiceFocusPrompt } from '@/lib/artist-manager-voice-focus-prompt'
import { DEFAULT_ARTIST_MANAGER_VOICE_SETTINGS, type ArtistManagerVoiceSettings } from '@craft-agent/shared/config/artist-manager-voice-settings'
import { VoiceTimingTrace, observeVoiceStt, observeVoiceTts, type VoiceTimingRecord } from '@/lib/artist-manager-voice-timing'
import { VoiceSessionLifecycle } from '@/lib/voice-session-lifecycle'
import { createElectronMoonshineSttTransport } from '../../../../../vendor/voice-core-electron/renderer/moonshineSttTransport'
import { parseMoonshineModelId, type ElectronMoonshineRuntimeStarted, type ElectronMoonshineRuntimePoll } from '../../../../../vendor/voice-core-electron/main/moonshineModels'
import { ELECTRON_INWORLD_TTS_MODEL_ID } from '../../../../../vendor/voice-core-electron/renderer/inworldTtsPolicy'
import {
  type ArtistManagerVoiceStyleId,
} from '@/lib/artist-manager-voice-style'

export type ArtistManagerVoiceState = {
  timingEnabled: boolean; setTimingEnabled(value: boolean): void
  typedTrial: boolean; setTypedTrial(value: boolean): void
  voiceModel: string | null; voiceRouteReady: boolean
  timingRecords: VoiceTimingRecord[]; canSendTyped: boolean; sendTyped(text: string): Promise<void>
  open: boolean; running: boolean; starting: boolean; stopping: boolean; installing: boolean
  providerReady: boolean; assemblyAiReady: boolean; inworldReady: boolean; hearingReady: boolean
  status: string; error: string | null; userText: string; assistantText: string
  sttSelection: string
  managerStyle: ArtistManagerVoiceStyleId
  moonshineAvailable: boolean; moonshineTiers: ArtistManagerMoonshineStatus['tiers']
  inputDeviceId: string; outputDeviceId: string; devices: MediaDeviceInfo[]
  setInputDeviceId(value: string): void; setOutputDeviceId(value: string): void
  refreshDevices(): Promise<void>; installMoonshine(modelId: string): Promise<void>
  setOpen(open: boolean): void; refreshProviders(): Promise<void>; start(): Promise<void>; stop(): Promise<void>
}

export function useArtistManagerVoice(input: {
  workspaceId: string; agents: AgentDefinitionDTO[]; skills: LoadedSkill[]; sources: LoadedSource[]
  handoffTargets?: VoiceHandoffTarget[]
  onOpenCommand?(proposal: VoiceHandoffProposal, isCurrent: () => boolean): Promise<void>
}): ArtistManagerVoiceState {
  const [timingEnabled, setTimingEnabled] = React.useState(() => readPreference('measure', 'false') === 'true')
  const [typedTrial, setTypedTrial] = React.useState(false)
  const [typedSending, setTypedSending] = React.useState(false)
  const [timingRecords, setTimingRecords] = React.useState<VoiceTimingRecord[]>([])
  const timingRef = React.useRef<VoiceTimingTrace | null>(null)
  const runtimeRef = React.useRef<VoiceCoreWeb | null>(null)
  const typedSendingRef = React.useRef(false)
  const [open, setOpenState] = React.useState(false)
  const [running, setRunning] = React.useState(false)
  const [starting, setStarting] = React.useState(false)
  const [stopping, setStopping] = React.useState(false)
  const [installing, setInstalling] = React.useState(false)
  const [providers, setProviders] = React.useState({ assemblyAi: false, inworld: false, ready: false })
  const [moonshine, setMoonshine] = React.useState<ArtistManagerMoonshineStatus>({ available: false, tiers: [] })
  const [voiceSettings, setVoiceSettings] = React.useState<ArtistManagerVoiceSettings>({ ...DEFAULT_ARTIST_MANAGER_VOICE_SETTINGS })
  const [settingsLoaded, setSettingsLoaded] = React.useState(false)
  const sttSelection = voiceSettings.sttSelection
  const managerStyle = voiceSettings.style
  const [inputDeviceId, setInput] = React.useState(() => readPreference('input', ''))
  const [outputDeviceId, setOutput] = React.useState(() => readPreference('output', ''))
  const [devices, setDevices] = React.useState<MediaDeviceInfo[]>([])
  const [status, setStatus] = React.useState('Ready when you are')
  const [error, setError] = React.useState<string | null>(null)
  const [userText, setUserText] = React.useState('')
  const [assistantText, setAssistantText] = React.useState('')
  const lifecycle = React.useRef(new VoiceSessionLifecycle<VoiceCoreWeb>()).current
  const mounted = React.useRef(true)
  const refreshEpoch = React.useRef(0)
  const installBusy = React.useRef(false)
  const unsubscribe = React.useRef<(() => void) | null>(null)
  const stopEpoch = React.useRef(0)
  const currentInput = React.useRef(input)
  currentInput.current = input
  const handoff = React.useRef<ReturnType<typeof createVoiceHandoffCoordinator> | null>(null)
  const shutdownSucceeded = React.useRef(true)

  const stop = React.useCallback(async (cancelHandoff = true) => {
    if (cancelHandoff) handoff.current?.cancel()
    shutdownSucceeded.current = false
    const epoch = ++stopEpoch.current
    timingRef.current?.stop(); timingRef.current = null; runtimeRef.current = null
    const cleanup = lifecycle.stop()
    unsubscribe.current?.(); unsubscribe.current = null
    if (mounted.current) { setRunning(false); setStarting(false); setStopping(true); setStatus('Stopping audio and agent…') }
    try {
      await cleanup
      if (epoch === stopEpoch.current) shutdownSucceeded.current = true
      if (mounted.current && epoch === stopEpoch.current) setStatus('Ready when you are')
    } catch (cause) {
      if (mounted.current && epoch === stopEpoch.current) {
        setError(messageFromError(cause)); setStatus('Agent shutdown could not be confirmed. Restart is blocked.')
      }
    } finally { if (mounted.current && epoch === stopEpoch.current) setStopping(false) }
  }, [lifecycle])

  React.useLayoutEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; refreshEpoch.current++; void stop() }
  }, [stop])
  React.useLayoutEffect(() => { void stop() }, [input.workspaceId, stop])

  const refreshDevices = React.useCallback(async () => {
    try {
      const next = await navigator.mediaDevices.enumerateDevices()
      if (mounted.current) setDevices(next)
    } catch (cause) { if (mounted.current) setError(messageFromError(cause)) }
  }, [])
  const refreshProviders = React.useCallback(async () => {
    const epoch = ++refreshEpoch.current
    try {
      const [cloud, local, settings] = await Promise.all([
        window.electronAPI.getArtistManagerVoiceProviderStatus(),
        window.electronAPI.invokeArtistManagerMoonshine({ method: 'status' }) as Promise<ArtistManagerMoonshineStatus>,
        window.electronAPI.artistManagerVoiceSettings.get(),
      ])
      if (!mounted.current || epoch !== refreshEpoch.current) return
      setProviders(cloud); setMoonshine(local); setVoiceSettings(settings); setSettingsLoaded(true)
    } catch (cause) {
      if (mounted.current && epoch === refreshEpoch.current) {
        setSettingsLoaded(false)
        setProviders({ assemblyAi: false, inworld: false, ready: false })
        setMoonshine({ available: false, tiers: [] }); setError(messageFromError(cause))
      }
    }
  }, [])
  React.useEffect(() => {
    if (!open) return
    void refreshProviders(); void refreshDevices()
    navigator.mediaDevices?.addEventListener('devicechange', refreshDevices)
    return () => navigator.mediaDevices?.removeEventListener('devicechange', refreshDevices)
  }, [open, refreshProviders, refreshDevices])

  const installMoonshine = React.useCallback(async (modelId: string) => {
    if (installBusy.current) return
    installBusy.current = true; setInstalling(true); setError(null)
    await stop()
    try {
      await window.electronAPI.invokeArtistManagerMoonshine({ method: 'install', modelId: parseMoonshineModelId(modelId) })
      await refreshProviders()
    } catch (cause) { if (mounted.current) setError(messageFromError(cause)) }
    finally { installBusy.current = false; if (mounted.current) setInstalling(false) }
  }, [stop, refreshProviders])

  const start = React.useCallback(async () => {
    if (installBusy.current) return
    let ticket: number
    try { ticket = lifecycle.begin() } catch { return }
    handoff.current?.cancel(); handoff.current = null
    stopEpoch.current++; setStopping(false)
    setStarting(true); setError(null); setUserText(''); setAssistantText(''); setStatus('Connecting voice…')
    const alive = () => mounted.current && lifecycle.owns(ticket)
    const trace = timingEnabled ? new VoiceTimingTrace(crypto.randomUUID(), record => {
      if (!mounted.current) return
      setTimingRecords(previous => [...previous.slice(-499), record])
      window.electronAPI.debugLog('[voice-timing]', JSON.stringify(record))
    }) : null
    timingRef.current = trace
    try {
      await lifecycle.ready(ticket)
      const settings = await window.electronAPI.artistManagerVoiceSettings.get()
      lifecycle.assertOwner(ticket)
      setVoiceSettings(settings); setSettingsLoaded(true)
      if (!settings.connectionSlug || !settings.model) throw new Error('Choose a voice model in Settings → Conversation before starting.')
      const selectedHearing = settings.sttSelection
      const selectedStyle = settings.style
      const cloud = await window.electronAPI.getArtistManagerVoiceProviderStatus()
      lifecycle.assertOwner(ticket); setProviders(cloud)
      if (!cloud.inworld) throw new Error('Configure an Inworld key in Settings for spoken responses')
      if (selectedHearing === 'assembly_ai' && !cloud.assemblyAi) throw new Error('Configure AssemblyAI or select an installed Moonshine model')
      const modelId = selectedHearing === 'assembly_ai' ? null : parseMoonshineModelId(selectedHearing)
      if (modelId) {
        const local = await window.electronAPI.invokeArtistManagerMoonshine({ method: 'status' }) as ArtistManagerMoonshineStatus
        lifecycle.assertOwner(ticket); setMoonshine(local)
        if (!local.available) throw new Error(local.error || 'Moonshine native resources are unavailable')
        if (!local.tiers.some(tier => tier.modelId === modelId && tier.registered && tier.installState === 'ready' && !tier.hasError)) throw new Error('Install the selected Moonshine model in voice settings first')
      }
      const proxy = await window.electronAPI.getArtistManagerVoiceProxyInfo()
      lifecycle.assertOwner(ticket)
      const proxyUrl = new URL(proxy.webSocketUrl)
      proxyUrl.searchParams.set('artist_manager_voice_token', proxy.accessToken)
      // Native Moonshine is an injected transport, not the unsupported WASM Moonshine provider.
      const runtime = new VoiceCoreWeb({
        ...(modelId ? {} : { sttProvider: 'assembly_ai' as const }),
        echoCancellation: true, noiseSuppression: true, autoGainControl: true, localBargeIn: false,
        inputDeviceId: inputDeviceId || undefined, outputDeviceId: outputDeviceId || undefined,
      })
      lifecycle.attach(ticket, runtime)
      runtimeRef.current = runtime
      const nativeSession = crypto.randomUUID()
      const control = async (method: 'cancel' | 'stop' | 'finalize' | 'finish', turn?: number) => {
        if (method === 'finalize') trace?.mark('stt-finalize-request', {}, false, true)
        await window.electronAPI.invokeArtistManagerMoonshine(method === 'finalize' || method === 'finish'
          ? { method, sessionId: nativeSession, turn: turn! } : { method, sessionId: nativeSession })
      }
      const stt = modelId ? createElectronMoonshineSttTransport({
        startMoonshineRuntime: id => window.electronAPI.invokeArtistManagerMoonshine({ method: 'start', modelId: id, sessionId: nativeSession }) as Promise<ElectronMoonshineRuntimeStarted>,
        feedMoonshineAudio: async (pcm, sampleRateHz, channels) => {
          const audio = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength).slice()
          await window.electronAPI.invokeArtistManagerMoonshine({ method: 'feed', sessionId: nativeSession, audio, sampleRateHz, channels })
        },
        pollMoonshineRuntime: () => window.electronAPI.invokeArtistManagerMoonshine({ method: 'poll', sessionId: nativeSession }) as Promise<ElectronMoonshineRuntimePoll>,
        finalizeMoonshineRuntime: turn => control('finalize', turn),
        finishMoonshineTurn: turn => control('finish', turn),
        cancelMoonshineRuntime: () => control('cancel'), stopMoonshineRuntime: () => control('stop'),
      }, modelId) : createAssemblyAiSttTransport({
        getToken: () => window.electronAPI.createArtistManagerVoiceAssemblyToken(),
        speechModel: 'universal-streaming-multilingual', formatTurns: true,
      })
      let handoffArmed = false
      let handoffStopEpoch = -1
      const handoffCurrent = () => mounted.current && currentInput.current.workspaceId === input.workspaceId && (alive() || stopEpoch.current === handoffStopEpoch)
      const coordinator = createVoiceHandoffCoordinator({
        stop: async () => {
          const cleanup = stop(false)
          handoffStopEpoch = stopEpoch.current
          await cleanup
          if (!shutdownSucceeded.current) throw new Error('Audio shutdown failed; Command was not opened.')
        },
        isCurrent: handoffCurrent,
        open: async proposal => {
          const latest = currentInput.current
          const destinationCurrent = () => handoffCurrent() && normalizeVoiceHandoffTargets(currentInput.current.handoffTargets ?? []).some(target => target.slug === proposal.agentSlug)
          if (!latest.onOpenCommand || !destinationCurrent()) {
            throw new Error('That agent is no longer available. Open Command to choose another agent.')
          }
          await latest.onOpenCommand(proposal, destinationCurrent)
          if (mounted.current) setOpenState(false)
        },
      })
      handoff.current = coordinator
      const refreshFocusPrompt = async () => {
        lifecycle.assertOwner(ticket)
        const docs = await window.electronAPI.listWorkspaceContextDocsForAgent(input.workspaceId, CONCIERGE_SLUG)
        lifecycle.assertOwner(ticket)
        return buildVoiceFocusPrompt(docs, selectedStyle)
      }
      await runtime.setTransports({
        stt: observeVoiceStt(stt, trace, timingEnabled && typedTrial),
        llm: createVoiceFocusTransport({
          api: window.electronAPI.artistManagerVoiceFocus,
          ensureSession: async () => {
            trace?.mark('session-setup-start')
            const systemPrompt = await refreshFocusPrompt()
            lifecycle.assertOwner(ticket)
            const session = await window.electronAPI.artistManagerVoiceFocus.register({
              workspaceId: input.workspaceId, systemPrompt,
              handoffTargets: input.onOpenCommand ? normalizeVoiceHandoffTargets(input.handoffTargets ?? []) : [],
            })
            if (alive()) trace?.mark('session-setup-ready', { sessionId: session.sessionId, model: session.model, connection: session.connection, thinking: session.thinking })
            return session
          },
          refreshPrompt: refreshFocusPrompt,
          onHandoffReady: proposal => { if (alive()) { handoffArmed = true; coordinator.ready(proposal) } },
          onTiming: (stage, details) => trace?.mark(stage, details),
          onUserText: text => { if (alive()) setUserText(text) },
          onAssistantText: text => { if (alive()) setAssistantText(text) },
        }),
        tts: observeVoiceTts(createInworldTtsTransport({ webSocketUrl: proxyUrl.toString(), inworldVoiceId: proxy.voiceId, inworldModelId: ELECTRON_INWORLD_TTS_MODEL_ID }), trace),
      })
      lifecycle.assertOwner(ticket)
      unsubscribe.current = runtime.onEvent((event: VoiceEvent) => {
        if (!alive()) return
        trace?.event(event)
        if (event.type === 'userSpeechPartial' || event.type === 'userSpeechComplete') setUserText(event.text)
        else if (event.type === 'assistantText') setAssistantText(event.text)
        else if (event.type === 'bargeIn' && handoffArmed) { coordinator.cancel(); void stop() }
        else if (event.type === 'agentSpeechComplete') {
          void coordinator.finish().catch(cause => { if (mounted.current) setError(messageFromError(cause)) })
        }
        else if (event.type === 'assistantActivity') setStatus(event.text)
        else if (event.type === 'stateChanged') setStatus(labelForVoiceState(event.state))
        else if (event.type === 'error' || event.type === 'captureError' || event.type === 'renderError') { setError(event.message); void stop() }
      })
      await runtime.start()
      lifecycle.assertOwner(ticket)
      trace?.mark('listening')
      setRunning(true); setStarting(false); setStatus('Listening…')
      void refreshDevices()
    } catch (cause) {
      trace?.mark('error')
      if (alive()) { await stop(); if (mounted.current) setError(messageFromError(cause)) }
    } finally { if (alive()) setStarting(false) }
  }, [timingEnabled, typedTrial, input.workspaceId, input.handoffTargets, input.onOpenCommand, lifecycle, inputDeviceId, outputDeviceId, stop, refreshDevices])

  const canSendTyped = timingEnabled && typedTrial && running && !typedSending && status === 'Listening…'
  const sendTyped = async (text: string) => {
    const runtime = runtimeRef.current
    const trace = timingRef.current
    if (!canSendTyped || typedSendingRef.current || !runtime || !text.trim() || text.length > 2000) return
    typedSendingRef.current = true; setTypedSending(true)
    trace?.queueInput(text.trim(), true)
    try { await runtime.completeUserTranscript(text.trim()) }
    catch (cause) { if (runtimeRef.current === runtime && mounted.current) setError(messageFromError(cause)) }
    finally { typedSendingRef.current = false; if (mounted.current) setTypedSending(false) }
  }

  const change = <T extends string>(key: string, setter: React.Dispatch<React.SetStateAction<T>>, value: T) => { void stop(); setter(value); writePreference(key, value) }
  const hearingReady = sttSelection === 'assembly_ai' ? providers.assemblyAi
    : moonshine.available && moonshine.tiers.some(tier => tier.modelId === sttSelection && tier.registered && tier.installState === 'ready' && !tier.hasError)
  const voiceRouteReady = settingsLoaded && Boolean(voiceSettings.connectionSlug && voiceSettings.model)
  return {
    voiceModel: voiceSettings.model, voiceRouteReady,
    timingEnabled, setTimingEnabled: value => { if (!running && !starting && !stopping) { setTimingEnabled(value); writePreference('measure', String(value)) } },
    typedTrial, setTypedTrial: value => { if (!running && !starting && !stopping) setTypedTrial(value) },
    timingRecords, canSendTyped, sendTyped,
    open, running, starting, stopping, installing, status, error, userText, assistantText,
    providerReady: voiceRouteReady && hearingReady && providers.inworld, hearingReady, assemblyAiReady: providers.assemblyAi, inworldReady: providers.inworld,
    sttSelection,
    managerStyle,
    moonshineAvailable: moonshine.available, moonshineTiers: moonshine.tiers, installMoonshine,
    inputDeviceId, outputDeviceId, devices, refreshDevices,
    setInputDeviceId: value => change('input', setInput, value), setOutputDeviceId: value => change('output', setOutput, value),
    setOpen: value => { if (!value) void stop(); setOpenState(value) }, refreshProviders, start, stop,
  }
}
function labelForVoiceState(state: string): string {
  return state === 'listening' || state === 'idle' ? 'Listening…' : state === 'thinking' ? 'Working…' : state === 'speaking' ? 'Speaking…' : 'Connected'
}
function messageFromError(error: unknown): string { return error instanceof Error ? error.message : String(error) }
function readPreference(key: string, fallback: string): string {
  try { return localStorage.getItem('artist-manager-voice:' + key) || fallback } catch { return fallback }
}
function writePreference(key: string, value: string): void {
  try { localStorage.setItem('artist-manager-voice:' + key, value) } catch { /* Optional preferences. */ }
}
