import * as React from 'react'
import { createInworldTtsTransport, type WebTtsTransport } from '@voice-core/web/cloud'
import { ELECTRON_INWORLD_TTS_MODEL_ID } from '../../../../../vendor/voice-core-electron/renderer/inworldTtsPolicy'

type SpeechStatus = 'idle' | 'loading' | 'playing'

/** The speech provider accepts at most 1,000 characters in each text request. */
export function splitDiscoverySpeech(text: string): string[] {
  const chunks: string[] = []
  let remaining = text.trim()
  while (remaining.length > 1000) {
    const window = remaining.slice(0, 1000)
    const sentenceBreaks = [...window.matchAll(/[.!?]\s+|\n+/g)]
    const lastSentence = sentenceBreaks.at(-1)
    const sentenceEnd = lastSentence ? lastSentence.index! + lastSentence[0].length : 0
    const wordEnd = window.search(/\s+\S*$/)
    let end = sentenceEnd > 500 ? sentenceEnd : wordEnd > 0 ? wordEnd : 1000
    // Do not split a surrogate pair in unusually long unbroken text.
    if (end === 1000 && /[\uD800-\uDBFF]/.test(remaining[end - 1]!)) end--
    chunks.push(remaining.slice(0, end).trim())
    remaining = remaining.slice(end).trimStart()
  }
  if (remaining) chunks.push(remaining)
  return chunks
}

type Playback = {
  controller: AbortController
  context: AudioContext
  sources: Set<AudioBufferSourceNode>
  transport?: WebTtsTransport
  finished: boolean
}

function releasePlayback(playback: Playback) {
  playback.controller.abort()
  for (const source of playback.sources) {
    source.onended = null
    try { source.stop() } catch { /* Already ended. */ }
    source.disconnect()
  }
  playback.sources.clear()
  void playback.context.close().catch(() => {})
  void playback.transport?.dispose?.().catch(() => {})
}

/** Read saved discovery text through the existing voice proxy, without opening a voice call. */
export function useDiscoverySpeech(text: string, enabled: boolean): {
  status: SpeechStatus
  error: string | null
  play: () => Promise<void>
  stop: () => void
} {
  const [status, setStatus] = React.useState<SpeechStatus>('idle')
  const [error, setError] = React.useState<string | null>(null)
  const current = React.useRef<Playback | null>(null)
  const mounted = React.useRef(false)

  const stop = React.useCallback(() => {
    const playback = current.current
    current.current = null
    if (playback) releasePlayback(playback)
    if (mounted.current) setStatus('idle')
  }, [])

  React.useLayoutEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      stop()
    }
  }, [stop])

  React.useLayoutEffect(() => {
    stop()
    setError(null)
    return stop
  }, [text, enabled, stop])

  const play = React.useCallback(async () => {
    if (!mounted.current || !enabled || !text.trim() || current.current) return
    setError(null)
    setStatus('loading')
    let playback: Playback | null = null
    try {
      // Resume during the click gesture, before awaiting proxy credentials.
      const context = new AudioContext()
      playback = { context, controller: new AbortController(), sources: new Set(), finished: false }
      const active = playback
      current.current = active
      const alive = () => mounted.current && current.current === active && !active.controller.signal.aborted
      await context.resume()
      if (!alive()) return
      const providers = await window.electronAPI.getArtistManagerVoiceProviderStatus()
      if (!alive()) return
      if (!providers.inworld) throw new Error('Configure an Inworld key in Settings to listen to discoveries.')
      const proxy = await window.electronAPI.getArtistManagerVoiceProxyInfo()
      if (!alive()) return
      const proxyUrl = new URL(proxy.webSocketUrl)
      proxyUrl.searchParams.set('artist_manager_voice_token', proxy.accessToken)
      active.transport = createInworldTtsTransport({
        webSocketUrl: proxyUrl.toString(),
        inworldVoiceId: proxy.voiceId,
        inworldModelId: ELECTRON_INWORLD_TTS_MODEL_ID,
      })
      let nextStart = context.currentTime
      let receivedAudio = false
      const finishIfDrained = () => {
        if (alive() && active.finished && active.sources.size === 0) stop()
      }
      for (const section of splitDiscoverySpeech(text)) {
        if (!alive()) return
        const audio = await active.transport.synthesize({ text: section, signal: active.controller.signal })
        if (!alive()) return
        for await (const chunk of audio) {
          if (!alive()) return
          const frameCount = Math.floor(chunk.frames.length / chunk.channels)
          if (!frameCount) continue
          const buffer = context.createBuffer(chunk.channels, frameCount, chunk.sampleRate)
          for (let channel = 0; channel < chunk.channels; channel++) {
            const samples = buffer.getChannelData(channel)
            for (let frame = 0; frame < frameCount; frame++) {
              samples[frame] = chunk.frames[frame * chunk.channels + channel]!
            }
          }
          const source = context.createBufferSource()
          source.buffer = buffer
          source.connect(context.destination)
          active.sources.add(source)
          source.onended = () => {
            source.disconnect()
            active.sources.delete(source)
            finishIfDrained()
          }
          nextStart = Math.max(nextStart, context.currentTime)
          source.start(nextStart)
          nextStart += buffer.duration
          receivedAudio = true
          setStatus('playing')
        }
      }
      if (!alive()) return
      if (!receivedAudio) throw new Error('No audio was returned. Please try listening again.')
      active.finished = true
      finishIfDrained()
    } catch (cause) {
      if (!mounted.current || (playback && current.current !== playback)) return
      stop()
      setError(cause instanceof Error ? cause.message : 'Could not play this discovery. Please try again.')
    }
  }, [enabled, text, stop])

  return { status, error, play, stop }
}
