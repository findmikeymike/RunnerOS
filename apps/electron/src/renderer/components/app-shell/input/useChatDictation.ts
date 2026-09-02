import * as React from 'react'

export type ChatDictationState = 'idle' | 'starting' | 'recording' | 'transcribing'

const MAX_RECORDING_SECONDS = 120
const MIME_TYPE_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
]

export class DictationOperationFence {
  private generation = 0
  private active = false

  begin(): number | null {
    if (this.active) return null
    this.active = true
    this.generation += 1
    return this.generation
  }

  cancel(): void {
    this.active = false
    this.generation += 1
  }

  isCurrent(operation: number): boolean {
    return this.active && this.generation === operation
  }

  finish(operation: number): void {
    if (this.generation === operation) this.active = false
  }
}

export function appendDictationTranscript(draft: string, transcript: string): string {
  const cleanTranscript = transcript.replace(/\s+/g, ' ').trim()
  if (!cleanTranscript) return draft
  if (!draft) return cleanTranscript
  if (/\s$/.test(draft)) return `${draft}${cleanTranscript}`
  return `${draft} ${cleanTranscript}`
}

export function getSupportedDictationMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null
  return MIME_TYPE_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type)) ?? null
}

export function useChatDictation(input: {
  sessionId?: string
  onTranscript: (transcript: string) => void
  onError: (message: string) => void
}): {
  state: ChatDictationState
  elapsedSeconds: number
  start: () => Promise<void>
  stop: () => void
} {
  const [state, setState] = React.useState<ChatDictationState>('idle')
  const [elapsedSeconds, setElapsedSeconds] = React.useState(0)
  const recorderRef = React.useRef<MediaRecorder | null>(null)
  const streamRef = React.useRef<MediaStream | null>(null)
  const chunksRef = React.useRef<Blob[]>([])
  const recordingSessionRef = React.useRef<string | undefined>()
  const currentSessionRef = React.useRef(input.sessionId)
  const mountedRef = React.useRef(true)
  const operationFenceRef = React.useRef(new DictationOperationFence())

  const releaseStream = React.useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  const cancel = React.useCallback(() => {
    operationFenceRef.current.cancel()
    const recorder = recorderRef.current
    recorderRef.current = null
    if (recorder) {
      recorder.onstop = null
      if (recorder.state !== 'inactive') recorder.stop()
    }
    chunksRef.current = []
    releaseStream()
    if (mountedRef.current) {
      setState('idle')
      setElapsedSeconds(0)
    }
  }, [releaseStream])

  React.useEffect(() => {
    if (currentSessionRef.current !== input.sessionId) cancel()
    currentSessionRef.current = input.sessionId
  }, [input.sessionId, cancel])

  React.useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      cancel()
    }
  }, [cancel])

  React.useEffect(() => {
    if (state !== 'recording') return
    const startedAt = Date.now()
    const timer = window.setInterval(() => {
      const seconds = Math.floor((Date.now() - startedAt) / 1000)
      setElapsedSeconds(seconds)
      if (seconds >= MAX_RECORDING_SECONDS && recorderRef.current?.state === 'recording') {
        recorderRef.current.stop()
      }
    }, 250)
    return () => window.clearInterval(timer)
  }, [state])

  const stop = React.useCallback(() => {
    const recorder = recorderRef.current
    if (recorder?.state === 'recording') recorder.stop()
  }, [])

  const start = React.useCallback(async () => {
    if (state !== 'idle') return
    const operation = operationFenceRef.current.begin()
    if (operation === null) return
    const isCurrentOperation = () => mountedRef.current && operationFenceRef.current.isCurrent(operation)
    setState('starting')
    try {
      const availability = await window.electronAPI.getChatDictationAvailability()
      if (!isCurrentOperation()) return
      if (!availability.available) {
        operationFenceRef.current.finish(operation)
        setState('idle')
        input.onError(availability.error ?? 'Local dictation is unavailable in this build.')
        return
      }

      const permission = await window.electronAPI.requestChatDictationAccess()
      if (!isCurrentOperation()) return
      if (permission !== 'granted') {
        operationFenceRef.current.finish(operation)
        setState('idle')
        input.onError(permission === 'denied' || permission === 'restricted'
          ? 'Microphone access is off. Enable Artist OS in System Settings → Privacy & Security → Microphone.'
          : 'Artist OS could not access the microphone.')
        return
      }
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone recording is unavailable in this build.')
      const mimeType = getSupportedDictationMimeType()
      if (!mimeType) throw new Error('This system does not provide a supported microphone recording format.')

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      if (!isCurrentOperation() || currentSessionRef.current !== input.sessionId) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }

      streamRef.current = stream
      const recorder = new MediaRecorder(stream, { mimeType })
      recorderRef.current = recorder
      recordingSessionRef.current = input.sessionId
      chunksRef.current = []
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }
      recorder.onerror = () => {
        if (!isCurrentOperation()) return
        cancel()
        input.onError('Microphone recording failed. Try again.')
      }
      recorder.onstop = async () => {
        if (!isCurrentOperation()) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        recorderRef.current = null
        releaseStream()
        const blob = new Blob(chunksRef.current, { type: mimeType })
        chunksRef.current = []
        if (!mountedRef.current) return
        if (blob.size === 0) {
          operationFenceRef.current.finish(operation)
          setState('idle')
          input.onError('No audio was captured. Try again.')
          return
        }

        setState('transcribing')
        try {
          const result = await window.electronAPI.transcribeChatDictation({
            audioData: new Uint8Array(await blob.arrayBuffer()),
            mimeType,
          })
          if (!isCurrentOperation() || currentSessionRef.current !== recordingSessionRef.current) return
          if (!result.ok || !result.transcript) throw new Error(result.error ?? 'No speech was detected.')
          input.onTranscript(result.transcript)
        } catch (error) {
          if (isCurrentOperation() && currentSessionRef.current === recordingSessionRef.current) {
            input.onError(error instanceof Error ? error.message : 'Dictation transcription failed.')
          }
        } finally {
          if (isCurrentOperation() && currentSessionRef.current === recordingSessionRef.current) {
            operationFenceRef.current.finish(operation)
            setState('idle')
            setElapsedSeconds(0)
          }
        }
      }
      recorder.start(250)
      setElapsedSeconds(0)
      setState('recording')
    } catch (error) {
      if (operationFenceRef.current.isCurrent(operation)) {
        const shouldReport = mountedRef.current
        cancel()
        if (shouldReport) input.onError(error instanceof Error ? error.message : 'Could not start dictation.')
      }
    }
  }, [cancel, input, releaseStream, state])

  return { state, elapsedSeconds, start, stop }
}
