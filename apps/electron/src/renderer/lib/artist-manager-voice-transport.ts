import type { SessionEvent } from '../../shared/types'
import type { LlmGenerateRequest, LlmTokenEvent, WebLlmTransport } from '@voice-core/web/cloud'

export type ArtistManagerVoiceTransportDeps = {
  ensureSession(): Promise<{ id: string }>
  sendMessage(sessionId: string, text: string): Promise<void>
  cancelProcessing(sessionId: string): Promise<void>
  onSessionEvent(handler: (event: SessionEvent) => void): () => void
  onUserText?(text: string): void
  onAssistantText?(text: string): void
}

export function createArtistManagerVoiceTransport(deps: ArtistManagerVoiceTransportDeps): WebLlmTransport {
  return {
    async generateReply(request: LlmGenerateRequest): Promise<AsyncIterable<LlmTokenEvent>> {
      const session = await deps.ensureSession()
      return streamManagerReply(deps, session.id, request)
    },
  }
}

async function* streamManagerReply(
  deps: ArtistManagerVoiceTransportDeps,
  sessionId: string,
  request: LlmGenerateRequest,
): AsyncIterable<LlmTokenEvent> {
  const queue = createEventQueue<LlmTokenEvent>()
  let completeText = ''
  let streamedText = ''
  let fallbackProtected = false
  let ended = false

  const finish = () => {
    if (ended) return
    ended = true
    const answer = (completeText || streamedText).trim()
    if (answer) {
      if (fallbackProtected) queue.push({ text: answer })
      deps.onAssistantText?.(answer)
    }
    queue.push({ text: '', done: true })
    queue.end()
  }
  const fail = (error: Error) => {
    if (ended) return
    ended = true
    queue.fail(error)
  }

  const unsubscribe = deps.onSessionEvent((event) => {
    if (!('sessionId' in event) || event.sessionId !== sessionId) return
    if (event.type === 'model_fallback_started') {
      fallbackProtected = true
    } else if (event.type === 'text_delta') {
      streamedText += event.delta
      if (!fallbackProtected) queue.push({ text: event.delta })
    } else if (event.type === 'text_complete' && !event.isIntermediate) {
      completeText = event.text
      if (!fallbackProtected && !streamedText && event.text) queue.push({ text: event.text })
    } else if (event.type === 'model_attempt_reset') {
      completeText = ''
      streamedText = ''
    } else if (event.type === 'complete') {
      finish()
    } else if (event.type === 'error') {
      fail(new Error(event.error))
    } else if (event.type === 'typed_error') {
      fail(new Error(event.error.message || event.error.title || 'Artist Manager failed'))
    } else if (event.type === 'interrupted') {
      fail(new Error('Artist Manager response interrupted'))
    }
  })

  const handleAbort = () => {
    void deps.cancelProcessing(sessionId).catch(() => undefined)
    fail(abortError(request.signal))
  }
  request.signal.addEventListener('abort', handleAbort, { once: true })
  const responseTimeout = globalThis.setTimeout(() => {
    void deps.cancelProcessing(sessionId).catch(() => undefined)
    fail(new Error('Artist Manager voice response timed out'))
  }, 120_000)

  try {
    deps.onUserText?.(request.userText)
    await deps.sendMessage(sessionId, request.userText)
    yield* queue.iterable
  } finally {
    globalThis.clearTimeout(responseTimeout)
    unsubscribe()
    request.signal.removeEventListener('abort', handleAbort)
  }
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('Artist Manager voice turn cancelled')
}

function createEventQueue<T>() {
  const values: T[] = []
  const waiters: Array<() => void> = []
  let done = false
  let error: Error | null = null

  const wake = () => waiters.splice(0).forEach((resolve) => resolve())
  const iterable: AsyncIterable<T> = {
    async *[Symbol.asyncIterator]() {
      while (true) {
        while (values.length) yield values.shift() as T
        if (error) throw error
        if (done) return
        await new Promise<void>((resolve) => waiters.push(resolve))
      }
    },
  }

  return {
    iterable,
    push(value: T) {
      if (done || error) return
      values.push(value)
      wake()
    },
    end() {
      done = true
      wake()
    },
    fail(nextError: Error) {
      error = nextError
      wake()
    },
  }
}
