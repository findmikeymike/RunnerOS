import type { SessionEvent } from '../../shared/types'
import type { LlmGenerateRequest, LlmTokenEvent, WebLlmTransport } from '@voice-core/web/cloud'

export type ArtistManagerVoiceTransportDeps = {
  ensureSession(): Promise<{ id: string }>
  sendMessage(sessionId: string, text: string): Promise<void>
  cancelProcessing(sessionId: string): Promise<void>
  onSessionEvent(handler: (event: SessionEvent) => void): () => void
  onUserText?(text: string): void
  onAssistantText?(text: string): void
  responseTimeoutMs?: number
  totalTimeoutMs?: number
  cancellationTimeoutMs?: number
}

export function createArtistManagerVoiceTransport(deps: ArtistManagerVoiceTransportDeps): WebLlmTransport {
  let tail = Promise.resolve()
  const quarantined = new Set<string>()
  const active = new Set<{ abort: AbortController; close(): Promise<unknown> }>()
  let stopping = false
  return {
    // Replaying a text request can repeat external tool actions.
    retryEmptyResponse: false,
    async stop() {
      stopping = true
      const pending = [...active]
      for (const turn of pending) turn.abort.abort(new Error('Artist Manager voice stopped'))
      await Promise.allSettled(pending.map((turn) => turn.close()))
      await tail
      active.clear()
      if (quarantined.size) throw new Error('Artist Manager tools could not be confirmed stopped. Do not start another voice conversation yet.')
    },
    async generateReply(request: LlmGenerateRequest): Promise<AsyncIterable<LlmTokenEvent>> {
      if (stopping) throw new Error('Artist Manager voice transport has stopped')
      throwIfAborted(request.signal)
      const consumerAbort = new AbortController()
      request = { ...request, signal: AbortSignal.any([request.signal, consumerAbort.signal]) }
      let turn!: { abort: AbortController; close(): Promise<unknown> }
      const stream = (async function* () {
        const preceding = tail
        let release!: () => void
        tail = new Promise<void>((resolve) => { release = resolve })
        try {
          await preceding
          throwIfAborted(request.signal)
          const session = await abortable(deps.ensureSession(), request.signal)
          throwIfAborted(request.signal)
          if (quarantined.has(session.id)) throw new Error('Artist Manager voice session did not stop safely. Start a new conversation.')
          yield* streamManagerReply(deps, session.id, request, () => quarantined.add(session.id))
        } finally {
          active.delete(turn)
          release()
        }
      })()
      turn = { abort: consumerAbort, close: () => stream.return(undefined) }
      active.add(turn)
      // Async-generator return alone waits behind a pending next(). Abort that
      // wait first so closing the consumer also cancels an active tool turn.
      return {
        [Symbol.asyncIterator]() {
          return {
            next: () => stream.next(),
            return: async () => {
              consumerAbort.abort(new Error('Artist Manager voice consumer closed'))
              active.delete(turn)
              return stream.return(undefined)
            },
            throw: async (error?: unknown) => {
              consumerAbort.abort(error)
              active.delete(turn)
              return stream.throw(error)
            },
          }
        },
      }
    },
  }
}

async function* streamManagerReply(
  deps: ArtistManagerVoiceTransportDeps,
  sessionId: string,
  request: LlmGenerateRequest,
  quarantine: () => void,
): AsyncIterable<LlmTokenEvent> {
  const queue = createEventQueue<LlmTokenEvent>()
  let completeText = ''
  let completed = false
  let dispatched = false
  let stopped!: () => void
  const drained = new Promise<void>((resolve) => { stopped = resolve })
  let ended = false

  const finish = () => {
    if (ended) return
    ended = true
    const answer = completeText.trim() || 'The manager finished this turn without a spoken summary. No completion was confirmed.'
    if (answer) {
      queue.push({ text: answer })
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
  let responseTimeout: ReturnType<typeof setTimeout> | undefined
  const resetInactivity = () => {
    clearTimeout(responseTimeout)
    if (!ended) responseTimeout = setTimeout(() => {
      fail(new Error('Artist Manager voice response timed out after no activity'))
    }, deps.responseTimeoutMs ?? 120_000)
  }
  resetInactivity()
  const totalTimeout = setTimeout(() => {
    fail(new Error('Artist Manager voice turn reached its total time limit; completion is not confirmed'))
  }, deps.totalTimeoutMs ?? 30 * 60_000)

  const unsubscribe = deps.onSessionEvent((event) => {
    if (!('sessionId' in event) || event.sessionId !== sessionId || !dispatched) return
    if (event.type === 'permission_request' || event.type === 'credential_request' || event.type === 'auth_request') {
      clearTimeout(responseTimeout)
    } else if (event.type === 'text_delta' || event.type === 'text_complete' || event.type === 'tool_start'
      || event.type === 'tool_result' || event.type === 'status' || event.type === 'auth_completed') {
      resetInactivity()
    }
    // Deltas include tool commentary; they cannot be retracted after speaking.
    if (event.type === 'text_complete' && !event.isIntermediate && !event.parentToolUseId) {
      completeText = event.text
    } else if (event.type === 'model_attempt_reset') {
      completeText = ''
    } else if (event.type === 'complete') {
      completed = true
      stopped()
      if (event.stopReason === 'timeout') {
        quarantine()
        fail(new Error('Artist Manager shutdown could not be confirmed. Tools may still be running; do not start another voice conversation yet.'))
      } else if (event.handoff === 'auth') {
        fail(new Error('Connect the requested account in this conversation’s chat, then continue there.'))
      } else {
        finish()
      }
    } else if (event.type === 'auth_request') {
      fail(new Error('Connect the requested account in this conversation’s chat, then continue there.'))
    } else if (event.type === 'source_activated') {
      // Source activation aborts the backend attempt. Never replay an action
      // automatically; a dedicated continuation protocol is still required.
      fail(new Error('The source is connected. Open this conversation in chat to continue.'))
    } else if (event.type === 'error') {
      fail(new Error(event.error))
    } else if (event.type === 'typed_error') {
      fail(new Error(event.error.message || event.error.title || 'Artist Manager failed'))
    } else if (event.type === 'interrupted') {
      fail(new Error('Artist Manager response interrupted'))
    }
  })

  const handleAbort = () => {
    fail(abortError(request.signal))
  }
  request.signal.addEventListener('abort', handleAbort, { once: true })

  let send: Promise<void> | undefined
  try {
    throwIfAborted(request.signal)
    deps.onUserText?.(request.userText)
    throwIfAborted(request.signal)
    send = Promise.resolve().then(() => {
      throwIfAborted(request.signal)
      dispatched = true
      return deps.sendMessage(sessionId, request.userText)
    })
    void send.catch((error) => fail(error instanceof Error ? error : new Error(String(error))))
    for await (const event of queue.iterable) {
      throwIfAborted(request.signal)
      yield event
    }
  } finally {
    globalThis.clearTimeout(responseTimeout)
    globalThis.clearTimeout(totalTimeout)
    request.signal.removeEventListener('abort', handleAbort)
    if (dispatched && !completed) {
      // `interrupted` and the cancel RPC acknowledgement precede actual drain.
      // Admission must settle first or cancellation can miss the new turn.
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([
          (async () => {
            await send?.catch(() => undefined)
            await deps.cancelProcessing(sessionId)
            if (!completed) await drained
          })(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('Cancellation did not drain')), deps.cancellationTimeoutMs ?? 15_000)
          }),
        ])
      } catch {
        quarantine()
      } finally {
        clearTimeout(timer)
      }
    }
    unsubscribe()
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError(signal)
}

async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  throwIfAborted(signal)
  let abort!: () => void
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        abort = () => reject(abortError(signal))
        signal.addEventListener('abort', abort, { once: true })
      }),
    ])
  } finally {
    signal.removeEventListener('abort', abort)
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
      values.length = 0
      error = nextError
      wake()
    },
  }
}
