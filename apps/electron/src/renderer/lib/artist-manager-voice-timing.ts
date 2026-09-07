import type { VoiceEvent, WebSttTransport, WebTtsTransport } from '@voice-core/web/cloud'

export type VoiceTimingStage =
  | 'start' | 'stt-start' | 'stt-ready' | 'listening' | 'first-capture'
  | 'first-partial' | 'stt-finalize-request' | 'stt-final' | 'typed-input'
  | 'manager-queued' | 'session-setup-start' | 'session-setup-ready'
  | 'manager-request' | 'manager-first-text' | 'manager-final-text'
  | 'tool-start' | 'tool-result' | 'approval-wait' | 'auth-wait'
  | 'model-fallback-guard-start' | 'model-attempt-reset' | 'manager-complete' | 'answer-delivered'
  | 'activity-speech' | 'tts-request' | 'tts-first-audio' | 'tts-complete'
  | 'playback-start' | 'playback-complete' | 'error' | 'stop'

export type VoiceTimingDetails = {
  chars?: number; words?: number; sampleRate?: number; channels?: number
  tool?: number; failed?: boolean; request?: number; kind?: 'activity' | 'answer'
  finishReason?: string; outputTokens?: number; reasoningTokens?: number
  sessionId?: string; model?: string; connection?: string; thinking?: string
}
export type VoiceTimingRecord = VoiceTimingDetails & {
  run: string; turn: number; stage: VoiceTimingStage; elapsedMs: number
}

/** Opt-in metadata only. No transcripts, prompts, credentials, or tool arguments. */
export class VoiceTimingTrace {
  private readonly startedAt: number
  private turn = 0
  private closed = false
  private readonly seen = new Set<string>()
  private readonly activityTexts: string[] = []
  private ttsRequest = 0
  private pendingInput: { chars: number; words: number; typed: boolean } | null = null

  constructor(
    readonly run: string,
    private readonly emit: (record: VoiceTimingRecord) => void,
    private readonly now: () => number = () => performance.now(),
  ) { this.startedAt = now(); this.mark('start') }

  mark(stage: VoiceTimingStage, details: VoiceTimingDetails = {}, once = false, input = false): void {
    if (this.closed) return
    const turn = this.turn + (input ? 1 : 0)
    const key = `${turn}:${stage}`
    if (once && this.seen.has(key)) return
    if (once) this.seen.add(key)
    // Copy only the allowed scalar fields, even if a caller passes a larger object.
    const record: VoiceTimingRecord = { run: this.run, turn, stage, elapsedMs: Math.max(0, Math.round(this.now() - this.startedAt)) }
    for (const name of ['chars', 'words', 'sampleRate', 'channels', 'tool', 'request', 'outputTokens', 'reasoningTokens'] as const) {
      const value = details[name]
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) record[name] = value
    }
    for (const name of ['sessionId', 'model', 'connection', 'thinking', 'finishReason'] as const) {
      const value = details[name]
      if (typeof value === 'string' && /^[a-zA-Z0-9_./:-]{1,160}$/.test(value)) record[name] = value
    }
    if (typeof details.failed === 'boolean') record.failed = details.failed
    if (details.kind === 'activity' || details.kind === 'answer') record.kind = details.kind
    try { this.emit(record) } catch { /* Diagnostics must never interrupt voice. */ }
  }

  queueInput(text: string, typed = false): void {
    if (!this.closed) this.pendingInput = { chars: text.length, words: text.trim().split(/\s+/).filter(Boolean).length, typed }
  }

  input(text: string, typed = false): void {
    this.queueInput(text, typed)
    this.acceptInput()
  }

  private acceptInput(): void {
    if (this.closed) return
    const input = this.pendingInput
    this.pendingInput = null
    this.turn++
    // Bound bookkeeping across long conversations; retain this input's partial marker.
    for (const key of this.seen) if (!key.startsWith(`${this.turn}:`)) this.seen.delete(key)
    this.mark(input?.typed ? 'typed-input' : 'stt-final', input ?? {})
  }

  event(event: VoiceEvent): void {
    if (this.closed) return
    if (event.type === 'debug' && /^\[latency\] stt-final \+\d+ms$/.test(event.message)) {
      // Emitted only by completeUserTranscript after the SDK accepts input.
      this.acceptInput()
    } else if (event.type === 'assistantActivity') {
      if (this.activityTexts.length < 16) this.activityTexts.push(event.text.trim().replace(/\s+/g, ' '))
      this.mark('activity-speech', { chars: event.text.length, kind: 'activity' })
    } else if (event.type === 'debug' && /^\[latency\] audio-playback-start \+\d+ms$/.test(event.message)) {
      // Worklet playback onset, not merely the runtime's "speaking" state.
      // An uninterrupted activity -> answer queue has no second onset signal.
      this.mark('playback-start')
    } else if (event.type === 'agentSpeechComplete') this.mark('playback-complete')
  }

  synthesis(text: string): VoiceTimingDetails {
    const index = this.activityTexts.indexOf(text.trim().replace(/\s+/g, ' '))
    if (index >= 0) this.activityTexts.splice(index, 1)
    return { request: ++this.ttsRequest, kind: index >= 0 ? 'activity' : 'answer', chars: text.length }
  }

  stop(): void { this.mark('stop'); this.closed = true; this.activityTexts.length = 0; this.pendingInput = null; this.seen.clear() }
}

/** Retains the real transport and its cancellation/keep-alive contract. */
export function observeVoiceStt(stt: WebSttTransport, trace: VoiceTimingTrace | null, typed: boolean): WebSttTransport {
  if (!trace && !typed) return stt
  return {
    keepAliveDuringAssistant: stt.keepAliveDuringAssistant,
    start: async () => { trace?.mark('stt-start', {}, true); await stt.start(); trace?.mark('stt-ready', {}, true) },
    cancelStart: stt.cancelStart ? () => stt.cancelStart!() : undefined,
    stop: () => stt.stop(),
    sendAudio: (pcm, rate, channels) => {
      // In the controlled typed trial, room noise must not dispatch a second turn.
      if (typed) return Promise.resolve()
      trace?.mark('first-capture', { sampleRate: rate, channels }, true, true)
      return stt.sendAudio(pcm, rate, channels)
    },
    onTranscript: handler => stt.onTranscript(event => {
      if (typed) return
      if (event.type === 'final' && event.text.trim()) trace?.queueInput(event.text)
      else if (event.type === 'partial' && event.text.trim()) trace?.mark('first-partial', { chars: event.text.length }, true, true)
      handler(event)
    }),
    onError: stt.onError ? handler => stt.onError!(handler) : undefined,
  }
}

export function observeVoiceTts(tts: WebTtsTransport, trace: VoiceTimingTrace | null): WebTtsTransport {
  if (!trace) return tts
  // Artist Manager uses synthesize(), not the optional streaming-session API.
  return {
    ...tts,
    createStreamingSession: tts.createStreamingSession ? signal => tts.createStreamingSession!(signal) : undefined,
    stop: tts.stop ? () => tts.stop!() : undefined,
    dispose: tts.dispose ? () => tts.dispose!() : undefined,
    async synthesize(request) {
      const details = trace.synthesis(request.text)
      trace.mark('tts-request', details)
      try {
        const stream = await tts.synthesize(request)
        return (async function* () {
          let first = true
          try {
            for await (const chunk of stream) {
              if (first && chunk.frames.length) { first = false; trace.mark('tts-first-audio', details) }
              yield chunk
            }
            trace.mark('tts-complete', details)
          } catch (error) { trace.mark('error', details); throw error }
        })()
      } catch (error) { trace.mark('error', details); throw error }
    },
  }
}
