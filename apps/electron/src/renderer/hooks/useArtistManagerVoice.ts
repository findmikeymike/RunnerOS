import * as React from 'react'
import { createAvatarPlayback } from '@/lib/artist-manager-avatar-playback'
import type { AvatarPlayback } from '@/lib/mikey-avatar/pose'
import { CONCIERGE_SLUG } from '@craft-agent/shared/agent-definitions/types'
import type { AgentDefinitionDTO, SkillDescriptor, LoadedSource, ArtistManagerMoonshineStatus } from '../../shared/types'
import { VoiceCoreWeb, createAssemblyAiSttTransport, createInworldTtsTransport, type VoiceEvent } from '@voice-core/web/cloud'
import { normalizeVoiceHandoffTargets, type VoiceHandoffTarget, type VoiceHandoffProposal } from '../../shared/artist-manager-voice-handoff'
import { createVoiceHandoffCoordinator } from '@/lib/artist-manager-voice-handoff'
import { createVoiceFocusTransport } from '@/lib/artist-manager-voice-focus-transport'
import { ARTIST_PROFILE_CONTEXT_SLUG, parseArtistProfileDocResult } from '@/lib/artist-profile'
import { buildVoiceFocusPrompt } from '@/lib/artist-manager-voice-focus-prompt'
import { DEFAULT_ARTIST_MANAGER_VOICE_SETTINGS, type ArtistManagerVoiceSettings } from '@craft-agent/shared/config/artist-manager-voice-settings'
import { VoiceTimingTrace, observeVoiceStt, observeVoiceTts, type VoiceTimingRecord } from '@/lib/artist-manager-voice-timing'
import { VoiceSessionLifecycle } from '@/lib/voice-session-lifecycle'
import { createPreparedVoiceRuntime } from '@/lib/prepared-voice-runtime'
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
  preparing: boolean
  prepared: boolean
  avatarState: 'idle' | 'listening' | 'waiting' | 'speaking'
  getAvatarPlayback(): AvatarPlayback
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

type PreparedCall = { greet(): Promise<void>; runtime: VoiceCoreWeb; ticket: number; settings: ArtistManagerVoiceSettings; trace: VoiceTimingTrace | null }

export function useArtistManagerVoice(input: {
  workspaceId: string; agents: AgentDefinitionDTO[]; skills: SkillDescriptor[]; sources: LoadedSource[]
  handoffTargets?: VoiceHandoffTarget[]
  onOpenCommand?(proposal: VoiceHandoffProposal, isCurrent: () => boolean): Promise<void>
}): ArtistManagerVoiceState {
  const [timingEnabled, setTimingEnabled] = React.useState(() => readPreference('measure', 'false') === 'true')
  const [typedTrial, setTypedTrial] = React.useState(false)
  const [typedSending, setTypedSending] = React.useState(false)
  const [timingRecords, setTimingRecords] = React.useState<VoiceTimingRecord[]>([])
  const timingRef = React.useRef<VoiceTimingTrace | null>(null)
  const runtimeRef = React.useRef<VoiceCoreWeb | null>(null)
  const avatarPlayback = React.useRef(createAvatarPlayback()).current
  const [avatarState, setAvatarState] = React.useState<'idle' | 'listening' | 'waiting' | 'speaking'>('idle')
  const typedSendingRef = React.useRef(false)
  const [open, setOpenState] = React.useState(false)
  const [running, setRunning] = React.useState(false)
  const [starting, setStarting] = React.useState(false)
  const [preparing, setPreparing] = React.useState(false)
  const [prepared, setPrepared] = React.useState(false)
  const preparedSettings = React.useRef<string | null>(null)
  const preparation = React.useRef<{ ticket: number; promise: Promise<PreparedCall | null> } | null>(null)
  const activationEpoch = React.useRef(0)
  const activating = React.useRef(false)
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
  const lifecycle = React.useRef(new VoiceSessionLifecycle<{ destroy(): Promise<void> }>()).current
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
    preparedSettings.current = null
    avatarPlayback.reset()
    if (cancelHandoff) handoff.current?.cancel()
    preparation.current = null; activationEpoch.current++; activating.current = false
    shutdownSucceeded.current = false
    const epoch = ++stopEpoch.current
    timingRef.current?.stop(); timingRef.current = null; runtimeRef.current = null
    const cleanup = lifecycle.stop()
    unsubscribe.current?.(); unsubscribe.current = null
    if (mounted.current) { setPrepared(false); setAvatarState('idle'); setRunning(false); setStarting(false); setPreparing(false); setStopping(true); setStatus('Stopping audio and agent…') }
    try {
      await cleanup
      if (epoch === stopEpoch.current) shutdownSucceeded.current = true
      if (mounted.current && epoch === stopEpoch.current) setStatus('Ready when you are')
    } catch (cause) {
      if (mounted.current && epoch === stopEpoch.current) {
        setError(messageFromError(cause)); setStatus('Agent shutdown could not be confirmed. Restart is blocked.')
      }
    } finally { if (mounted.current && epoch === stopEpoch.current) setStopping(false) }
  }, [lifecycle, avatarPlayback])

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

  const prepareCall = React.useCallback(async (ticket: number): Promise<PreparedCall | null> => {
    preparedSettings.current = null
    handoff.current?.cancel(); handoff.current = null
    stopEpoch.current++; setStopping(false)
    setPrepared(false); setPreparing(true); setError(null); setUserText(''); setAssistantText(''); setStatus('Warming up…')
    const alive = () => mounted.current && lifecycle.owns(ticket)
    const trace = new VoiceTimingTrace(crypto.randomUUID(), record => {
      if (!mounted.current) return
      if (timingEnabled) setTimingRecords(previous => [...previous.slice(-499), record])
      window.electronAPI.debugLog('[voice-timing]', JSON.stringify(record))
    })
    timingRef.current = trace
    trace?.mark('prepare-start')
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
        onDiagnostic: event => { window.electronAPI.debugLog('[voice-handoff]', JSON.stringify({ side: 'renderer', ...event })) },
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
      const focus = createVoiceFocusTransport({
          api: window.electronAPI.artistManagerVoiceFocus,
          ensureSession: async () => {
            trace?.mark('session-setup-start')
            const [systemPrompt, profileDoc] = await Promise.all([
              refreshFocusPrompt(),
              window.electronAPI.getWorkspaceContextDoc(input.workspaceId, ARTIST_PROFILE_CONTEXT_SLUG).catch(() => null),
            ])
            const profile = parseArtistProfileDocResult(profileDoc ?? undefined)
            lifecycle.assertOwner(ticket)
            const session = await window.electronAPI.artistManagerVoiceFocus.register({
              workspaceId: input.workspaceId, systemPrompt, artistName: profile.ok ? profile.profile.artistName : undefined,
              handoffTargets: currentInput.current.onOpenCommand ? normalizeVoiceHandoffTargets(currentInput.current.handoffTargets ?? []) : [],
            })
            if (alive()) trace?.mark('session-setup-ready', { sessionId: session.sessionId, model: session.model, connection: session.connection, thinking: session.thinking })
            return session
          },
          refreshPrompt: refreshFocusPrompt,
          onHandoffReady: proposal => { if (alive()) { handoffArmed = true; coordinator.ready(proposal) } },
          onTiming: (stage, details) => trace?.mark(stage, details),
          onUserText: text => { if (alive()) setUserText(text) },
          onAssistantText: text => { if (alive()) setAssistantText(text) },
      })
      const owned = createPreparedVoiceRuntime({ runtime, ...(modelId ? { stt } : {}), focus })
      const unsubscribeWarmError = modelId ? stt.onError?.(cause => {
        if (alive()) { setError(messageFromError(cause)); void stop() }
      }) : undefined
      lifecycle.attach(ticket, { destroy: () => { unsubscribeWarmError?.(); return owned.destroy() } })
      const observedStt = observeVoiceStt(stt, trace, timingEnabled && typedTrial)
      await runtime.setTransports({
        stt: observedStt,
        llm: focus,
        tts: observeVoiceTts(createInworldTtsTransport({ webSocketUrl: proxyUrl.toString(), inworldVoiceId: proxy.voiceId, inworldModelId: ELECTRON_INWORLD_TTS_MODEL_ID, phonemeTimestamps: true }), trace),
      })
      lifecycle.assertOwner(ticket)
      const observePlayback = avatarPlayback.begin()
      const unsubscribePlayback = runtime.onPlaybackFrame(frame => {
        if (alive()) observePlayback(frame)
      })
      let artistSpoke = false
      const unsubscribeEvents = runtime.onEvent((event: VoiceEvent) => {
        if (!alive()) return
        if (event.type === 'userSpeechPartial' || event.type === 'userSpeechComplete') {
          // The SDK has a transcript entry point; its private opening cue is not artist speech.
          if (focus.isOpeningTranscript(event.text)) return
          if (event.text.trim()) artistSpoke = true
        }
        trace?.event(event)
        if (event.type === 'bargeIn') { avatarPlayback.clear(); setAvatarState('listening') }
        if (event.type === 'userSpeechPartial' || event.type === 'userSpeechComplete') setUserText(event.text)
        else if (event.type === 'assistantText') setAssistantText(event.text)
        else if (event.type === 'bargeIn' && handoffArmed) { coordinator.cancel(); void stop() }
        else if (event.type === 'agentSpeechComplete') {
          void coordinator.finish().catch(cause => { if (handoffCurrent()) setError(messageFromError(cause)) })
        }
        else if (event.type === 'assistantActivity') setStatus(event.text)
        else if (event.type === 'stateChanged') {
          setStatus(labelForVoiceState(event.state))
          setAvatarState(event.state === 'speaking' ? 'speaking' : event.state === 'thinking' ? 'waiting' : 'listening')
        }
        else if (event.type === 'error' || event.type === 'captureError' || event.type === 'renderError') { setError(event.message); void stop() }
      })
      unsubscribe.current = () => { unsubscribePlayback(); unsubscribeEvents() }
      // Only the local speech engine and in-memory Manager session are prepared.
      // runtime.start() is the exclusive microphone/capture boundary, in start() below.
      await Promise.all([modelId ? observedStt.start() : Promise.resolve(), focus.prepare()])
      lifecycle.assertOwner(ticket)
      trace?.mark('prepare-ready')
      preparedSettings.current = JSON.stringify(settings)
      setPrepared(true); setPreparing(false); setStatus('Ready when you are')
      return { runtime, ticket, settings, trace, greet: async () => {
        if (alive() && !artistSpoke) await focus.greet(text => runtime.completeUserTranscript(text))
      } }
    } catch (cause) {
      trace?.mark('error')
      if (alive()) {
        const cleanup = stop()
        const epoch = stopEpoch.current
        await cleanup
        if (mounted.current && stopEpoch.current === epoch) setError(messageFromError(cause))
      }
    } finally { if (alive()) setPreparing(false) }
    return null
  }, [timingEnabled, typedTrial, input.workspaceId, lifecycle, inputDeviceId, outputDeviceId, stop, avatarPlayback])

  const prepare = React.useCallback((): Promise<PreparedCall | null> => {
    if (installBusy.current) return Promise.resolve(null)
    if (preparation.current) return preparation.current.promise
    let ticket: number
    try { ticket = lifecycle.begin() } catch { return Promise.resolve(null) }
    const pending = { ticket, promise: Promise.resolve<PreparedCall | null>(null) }
    preparation.current = pending
    pending.promise = prepareCall(ticket)
    return pending.promise
  }, [lifecycle, prepareCall])

  React.useEffect(() => {
    if (open && !installing) void prepare()
  }, [open, installing, prepare])

  const start = React.useCallback(async () => {
    if (installBusy.current || activating.current || running) return
    activating.current = true
    const activation = ++activationEpoch.current
    setStarting(true); setError(null)
    let call: PreparedCall | null = null
    try {
      const pending = prepare()
      timingRef.current?.mark('call-requested')
      call = await pending
      if (!call || activation !== activationEpoch.current) return
      lifecycle.assertOwner(call.ticket)
      const currentSettings = await window.electronAPI.artistManagerVoiceSettings.get()
      lifecycle.assertOwner(call.ticket)
      if (JSON.stringify(currentSettings) !== JSON.stringify(call.settings)) {
        throw new Error('Conversation settings changed. Press Call again to prepare the new settings.')
      }
      await call.runtime.start()
      lifecycle.assertOwner(call.ticket)
      call.trace?.mark('listening')
      setRunning(true); setStatus('Listening…')
      void refreshDevices()
      await call.greet()
    } catch (cause) {
      if (activation === activationEpoch.current) {
        const cleanup = stop()
        const epoch = stopEpoch.current
        await cleanup
        if (mounted.current && stopEpoch.current === epoch) setError(messageFromError(cause))
      }
    } finally {
      if (activation === activationEpoch.current) {
        activating.current = false
        if (mounted.current) setStarting(false)
      }
    }
  }, [prepare, lifecycle, running, refreshDevices, stop])

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
    timingEnabled, setTimingEnabled: value => { if (!running && !starting && !stopping) { void stop(); setTimingEnabled(value); writePreference('measure', String(value)) } },
    typedTrial, setTypedTrial: value => { if (!running && !starting && !stopping) { void stop(); setTypedTrial(value) } },
    timingRecords, canSendTyped, sendTyped,
    avatarState: running ? avatarState : 'idle', getAvatarPlayback: avatarPlayback.sample,
    open, preparing, prepared: prepared && preparedSettings.current === JSON.stringify(voiceSettings), running, starting, stopping, installing, status, error, userText, assistantText,
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
