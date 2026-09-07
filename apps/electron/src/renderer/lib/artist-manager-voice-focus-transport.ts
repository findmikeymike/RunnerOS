import type { WebLlmTransport, LlmTokenEvent } from '@voice-core/web/cloud'
import type { VoiceFocusEvent, VoiceFocusSession } from '../../shared/artist-manager-voice-focus'
import type { VoiceHandoffProposal } from '../../shared/artist-manager-voice-handoff'
import type { ElectronAPI } from '../../shared/types'
import type { VoiceTimingDetails, VoiceTimingStage } from './artist-manager-voice-timing'

type Deps = {
  api: ElectronAPI['artistManagerVoiceFocus']
  ensureSession(): Promise<VoiceFocusSession>
  refreshPrompt(): Promise<string>
  onTiming?(stage: VoiceTimingStage, details?: VoiceTimingDetails): void
  onHandoffReady?(proposal: VoiceHandoffProposal): void
  onUserText?(text: string): void
  onAssistantText?(text: string): void
}

/** Each text event is final-answer content from a model with no tool executor. */
export function createVoiceFocusTransport(deps: Deps): WebLlmTransport & { prepare(): Promise<void>; stop(): Promise<void> } {
  let stopped = false
  let stopPromise: Promise<void> | undefined
  let sessionPromise: Promise<VoiceFocusSession> | undefined
  const active = new Set<AbortController>()
  const ensurePreparedSession = () => {
    if (stopped) throw new Error('Focused voice stopped')
    return sessionPromise ??= deps.ensureSession()
  }
  return {
    retryEmptyResponse: false,
    async prepare() {
      if (stopped) throw new Error('Focused voice stopped')
      const controller = new AbortController()
      active.add(controller)
      try {
        await abortable(ensurePreparedSession(), controller.signal)
        if (stopped) throw new Error('Focused voice stopped')
      } finally { active.delete(controller) }
    },
    stop() {
      if (stopPromise) return stopPromise
      let resolve!: () => void
      let reject!: (reason: unknown) => void
      stopPromise = new Promise<void>((yes, no) => { resolve = yes; reject = no })
      stopped = true
      for (const controller of active) controller.abort()
      // Main also cancels a registration that has not returned a session yet.
      // Send immediately; repeated cleanup shares both success and failure.
      try { deps.api.stop().then(resolve, reject) } catch (error) { reject(error) }
      return stopPromise
    },
    async generateReply(request) {
      if (stopped || request.signal.aborted) throw new Error('Focused voice stopped')
      const controller = new AbortController()
      active.add(controller)
      const signal = AbortSignal.any([request.signal, controller.signal])
      const stream = (async function* (): AsyncGenerator<LlmTokenEvent> {
        const queue: LlmTokenEvent[] = []
        let failure: Error | undefined
        let done = false
        let first = true
        let answer = ''
        let wake: (() => void) | undefined
        let session: VoiceFocusSession | undefined
        let unsubscribe: (() => void) | undefined
        const turnId = crypto.randomUUID()
        const fail = (error: Error) => { failure = error; wake?.() }
        const abort = () => fail(new Error('Focused voice stopped'))
        signal.addEventListener('abort', abort, { once: true })
        try {
          if (signal.aborted || stopped) throw new Error('Focused voice stopped')
          deps.onTiming?.('manager-queued')
          session = await abortable(ensurePreparedSession(), signal)
          const systemPrompt = await abortable(deps.refreshPrompt(), signal)
          if (signal.aborted || stopped) throw new Error('Focused voice stopped')
          unsubscribe = deps.api.onEvent((event: VoiceFocusEvent) => {
            if (event.sessionId !== session!.sessionId || event.turnId !== turnId || done || failure || signal.aborted) return
            if (event.type === 'error') { fail(new Error(event.message)); return }
            if (event.type === 'completion') {
              deps.onTiming?.('manager-complete', { finishReason: event.finishReason, outputTokens: event.outputTokens, reasoningTokens: event.reasoningTokens })
              return
            }
            if (event.type === 'handoff_ready') { deps.onHandoffReady?.(event.proposal); return }
            if (event.type === 'text_delta') {
              if (first) { first = false; deps.onTiming?.('manager-first-text') }
              answer += event.delta
              deps.onAssistantText?.(answer)
              queue.push({ text: event.delta })
            } else if (event.type === 'done') {
              done = true
              deps.onTiming?.('answer-delivered', { chars: answer.length })
              queue.push({ text: '', done: true })
            }
            wake?.()
          })
          deps.onUserText?.(request.userText)
          // Subscribe before dispatch. Consume events while the IPC request runs.
          void deps.api.startTurn({ sessionId: session.sessionId, turnId, text: request.userText, systemPrompt })
            .catch(() => fail(new Error('Focused voice could not complete this reply')))
          while (true) {
            if (failure) throw failure
            if (queue.length) { yield queue.shift()!; continue }
            if (done) break
            await new Promise<void>(resolve => { wake = resolve })
            wake = undefined
          }
        } finally {
          signal.removeEventListener('abort', abort)
          unsubscribe?.()
          active.delete(controller)
          if (session && !done) await deps.api.cancel({ sessionId: session.sessionId, turnId })
        }
      })()
      return { [Symbol.asyncIterator]: () => ({
        next: () => stream.next(),
        return: async () => { controller.abort(); active.delete(controller); return stream.return(undefined) },
        throw: async error => { controller.abort(); active.delete(controller); return stream.throw(error) },
      }) }
    },
  }
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error('Focused voice stopped'))
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error('Focused voice stopped'))
    signal.addEventListener('abort', abort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}
