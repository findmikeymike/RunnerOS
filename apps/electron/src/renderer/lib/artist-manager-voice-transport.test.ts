import { describe, expect, test } from 'bun:test'
import type { SessionEvent } from '../../shared/types'
import { createArtistManagerVoiceTransport } from './artist-manager-voice-transport'

describe('Artist Manager voice transport', () => {
  test('streams one manager session response without a second LLM', async () => {
    let listener: ((event: SessionEvent) => void) | null = null
    const transport = createArtistManagerVoiceTransport({
      ensureSession: async () => ({ id: 'manager-session' }),
      sendMessage: async (sessionId, text) => {
        expect(sessionId).toBe('manager-session')
        expect(text).toBe('What matters this week?')
        queueMicrotask(() => {
          listener?.({ type: 'text_delta', sessionId, delta: 'Protect ' })
          listener?.({ type: 'text_delta', sessionId, delta: 'the release.' })
          listener?.({ type: 'text_complete', sessionId, text: 'Protect the release.' })
          listener?.({ type: 'complete', sessionId })
        })
      },
      cancelProcessing: async () => {},
      onSessionEvent: (handler) => {
        listener = handler
        return () => { listener = null }
      },
    })
    const stream = await transport.generateReply({
      userText: 'What matters this week?',
      contextJson: '[]',
      signal: new AbortController().signal,
    })
    const chunks: string[] = []
    for await (const event of stream) chunks.push(event.text)
    expect(chunks.join('')).toBe('Protect the release.')
  })

  test('cancels the manager turn when voice is interrupted', async () => {
    let cancelled = false
    let listener: ((event: SessionEvent) => void) | null = null
    const controller = new AbortController()
    const transport = createArtistManagerVoiceTransport({
      ensureSession: async () => ({ id: 'manager-session' }),
      sendMessage: async () => queueMicrotask(() => controller.abort(new Error('barge in'))),
      cancelProcessing: async () => { cancelled = true; listener?.({ type: 'complete', sessionId: 'manager-session' }) },
      onSessionEvent: (handler) => { listener = handler; return () => { listener = null } },
    })
    const stream = await transport.generateReply({ userText: 'Stop', contextJson: '[]', signal: controller.signal })
    await expect(async () => {
      for await (const _event of stream) { /* drain */ }
    }).toThrow('barge in')
    expect(cancelled).toBe(true)
  })

  test('discards failed-attempt speech before voicing a fallback response', async () => {
    let listener: ((event: SessionEvent) => void) | null = null
    const transport = createArtistManagerVoiceTransport({
      ensureSession: async () => ({ id: 'manager-session' }),
      sendMessage: async (sessionId) => queueMicrotask(() => {
        listener?.({ type: 'model_fallback_started', sessionId })
        listener?.({ type: 'text_delta', sessionId, delta: 'Failed partial' })
        listener?.({ type: 'model_attempt_reset', sessionId, messageIds: [] })
        listener?.({ type: 'text_delta', sessionId, delta: 'Fallback answer' })
        listener?.({ type: 'text_complete', sessionId, text: 'Fallback answer' })
        listener?.({ type: 'complete', sessionId })
      }),
      cancelProcessing: async () => {},
      onSessionEvent: (handler) => {
        listener = handler
        return () => { listener = null }
      },
    })

    const stream = await transport.generateReply({
      userText: 'Help',
      contextJson: '[]',
      signal: new AbortController().signal,
    })
    const chunks: string[] = []
    for await (const event of stream) chunks.push(event.text)
    expect(chunks.join('')).toBe('Fallback answer')
  })
})

const request = (signal = new AbortController().signal) => ({ userText: 'Act', contextJson: '[]', signal })
async function drain(stream: AsyncIterable<{ text: string }>) {
  const chunks: string[] = []
  for await (const event of stream) chunks.push(event.text)
  return chunks.join('')
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

describe('Artist Manager voice action safety', () => {
  test('auth handoff complete before auth_request never speaks success or dispatches again', async () => {
    let listener!: (event: SessionEvent) => void
    let sends = 0
    const spoken: string[] = []
    const transport = createArtistManagerVoiceTransport({
      ensureSession: async () => ({ id: 's' }),
      sendMessage: async () => {
        sends++
        listener({ type: 'text_complete', sessionId: 's', text: 'Prior partial answer' })
        listener({ type: 'complete', sessionId: 's', handoff: 'auth' })
        listener({ type: 'auth_request', sessionId: 's', message: {}, request: {} } as SessionEvent)
      },
      onAssistantText: (text) => spoken.push(text),
      cancelProcessing: async () => {}, onSessionEvent: (h) => { listener = h; return () => {} },
    })
    await expect(drain(await transport.generateReply(request())))
      .rejects.toThrow('Connect the requested account in this conversation’s chat, then continue there.')
    expect(spoken).toEqual([])
    expect(sends).toBe(1)
  })

  test('auth request without preceding complete fails safely and drains without replay', async () => {
    let listener!: (event: SessionEvent) => void
    let sends = 0
    let cancels = 0
    const transport = createArtistManagerVoiceTransport({
      ensureSession: async () => ({ id: 's' }),
      sendMessage: async () => {
        sends++
        listener({ type: 'auth_request', sessionId: 's', message: {}, request: {} } as SessionEvent)
      },
      cancelProcessing: async () => { cancels++; listener({ type: 'complete', sessionId: 's' }) },
      onSessionEvent: (h) => { listener = h; return () => {} },
    })
    await expect(drain(await transport.generateReply(request())))
      .rejects.toThrow('Connect the requested account in this conversation’s chat, then continue there.')
    expect(sends).toBe(1)
    expect(cancels).toBe(1)
  })

  test('forced backend cleanup is not treated as confirmed completion', async () => {
    let listener!: (event: SessionEvent) => void
    let sends = 0
    const transport = createArtistManagerVoiceTransport({
      ensureSession: async () => ({ id: 's' }),
      sendMessage: async () => {
        sends++
        listener({ type: 'text_complete', sessionId: 's', text: 'Done' })
        listener({ type: 'complete', sessionId: 's', stopReason: 'timeout' })
      },
      cancelProcessing: async () => {}, onSessionEvent: (h) => { listener = h; return () => {} },
    })
    await expect(drain(await transport.generateReply(request()))).rejects.toThrow('shutdown could not be confirmed')
    await expect(drain(await transport.generateReply(request()))).rejects.toThrow('did not stop safely')
    await expect(transport.stop!()).rejects.toThrow('could not be confirmed stopped')
    expect(sends).toBe(1)
  })

  test('source activation requires explicit continuation and never resends', async () => {
    let listener!: (event: SessionEvent) => void
    let sends = 0
    const transport = createArtistManagerVoiceTransport({
      ensureSession: async () => ({ id: 's' }),
      sendMessage: async () => {
        sends++
        listener({ type: 'source_activated', sessionId: 's', sourceSlug: 'calendar', originalMessage: 'Create an event' })
        listener({ type: 'complete', sessionId: 's' })
      },
      cancelProcessing: async () => {}, onSessionEvent: (h) => { listener = h; return () => {} },
    })
    await expect(drain(await transport.generateReply(request())))
      .rejects.toThrow('The source is connected. Open this conversation in chat to continue.')
    expect(sends).toBe(1)
  })

  test('stop awaits backend drain and permanently closes this transport', async () => {
    let listener!: (event: SessionEvent) => void
    const sent = deferred<void>()
    const cancelled = deferred<void>()
    const transport = createArtistManagerVoiceTransport({
      ensureSession: async () => ({ id: 's' }), sendMessage: async () => { sent.resolve() },
      cancelProcessing: async () => { cancelled.resolve() },
      onSessionEvent: (h) => { listener = h; return () => {} },
    })
    const result = drain(await transport.generateReply(request())).catch((e) => e.message)
    await sent.promise
    let stopped = false
    const stop = transport.stop!().then(() => { stopped = true })
    await cancelled.promise
    expect(stopped).toBe(false)
    listener({ type: 'interrupted', sessionId: 's' })
    await Promise.resolve()
    expect(stopped).toBe(false)
    listener({ type: 'complete', sessionId: 's' })
    await stop
    expect(stopped).toBe(true)
    expect(await result).toBe('Artist Manager voice stopped')
    await expect(transport.generateReply(request())).rejects.toThrow('has stopped')
  })

  test('stop rejects if backend drain cannot be confirmed', async () => {
    const sent = deferred<void>()
    const transport = createArtistManagerVoiceTransport({
      ensureSession: async () => ({ id: 's' }), sendMessage: async () => { sent.resolve() },
      cancelProcessing: async () => {}, onSessionEvent: () => () => {}, cancellationTimeoutMs: 5,
    })
    const result = drain(await transport.generateReply(request())).catch((e) => e.message)
    await sent.promise
    await expect(transport.stop!()).rejects.toThrow('could not be confirmed stopped')
    await result
  })

  test('stop aborts unresolved session setup without dispatch', async () => {
    const entered = deferred<void>()
    let sends = 0
    const transport = createArtistManagerVoiceTransport({
      ensureSession: () => { entered.resolve(); return new Promise(() => {}) },
      sendMessage: async () => { sends++ }, cancelProcessing: async () => {}, onSessionEvent: () => () => {},
    })
    const result = drain(await transport.generateReply(request())).catch((e) => e.message)
    await entered.promise
    await transport.stop!()
    expect(await result).toBe('Artist Manager voice stopped')
    expect(sends).toBe(0)
  })

  test('approval pauses inactivity, then final result resumes normally', async () => {
    let listener!: (event: SessionEvent) => void
    const requested = deferred<void>()
    const transport = createArtistManagerVoiceTransport({
      ensureSession: async () => ({ id: 's' }),
      sendMessage: async () => {
        listener({ type: 'permission_request', sessionId: 's', request: {} } as SessionEvent)
        requested.resolve()
      },
      cancelProcessing: async () => { throw new Error('must not cancel pending approval') },
      onSessionEvent: (h) => { listener = h; return () => {} }, responseTimeoutMs: 10, totalTimeoutMs: 1000,
    })
    const result = drain(await transport.generateReply(request()))
    await requested.promise
    await new Promise((r) => setTimeout(r, 30))
    listener({ type: 'text_complete', sessionId: 's', text: 'Approved result' })
    listener({ type: 'complete', sessionId: 's' })
    expect(await result).toBe('Approved result')
  })

  test('real progress resets inactivity but total deadline bounds approval waits', async () => {
    let listener!: (event: SessionEvent) => void
    const requested = deferred<void>()
    const transport = createArtistManagerVoiceTransport({
      ensureSession: async () => ({ id: 's' }),
      sendMessage: async () => {
        listener({ type: 'credential_request', sessionId: 's', request: {} } as SessionEvent)
        requested.resolve()
      },
      cancelProcessing: async () => { listener({ type: 'complete', sessionId: 's' }) },
      onSessionEvent: (h) => { listener = h; return () => {} }, responseTimeoutMs: 5, totalTimeoutMs: 30,
    })
    const result = drain(await transport.generateReply(request()))
    await requested.promise
    await expect(result).rejects.toThrow('total time limit')
  })

  test('tool progress extends the inactivity window', async () => {
    let listener!: (event: SessionEvent) => void
    let interval: ReturnType<typeof setInterval>
    const transport = createArtistManagerVoiceTransport({
      ensureSession: async () => ({ id: 's' }),
      sendMessage: async () => {
        let ticks = 0
        interval = setInterval(() => {
          listener({ type: 'status', sessionId: 's', message: 'Working' })
          if (++ticks === 5) {
            clearInterval(interval)
            listener({ type: 'text_complete', sessionId: 's', text: 'Verified' })
            listener({ type: 'complete', sessionId: 's' })
          }
        }, 5)
      },
      cancelProcessing: async () => { clearInterval(interval); listener({ type: 'complete', sessionId: 's' }) },
      onSessionEvent: (h) => { listener = h; return () => {} }, responseTimeoutMs: 20, totalTimeoutMs: 1000,
    })
    expect(await drain(await transport.generateReply(request()))).toBe('Verified')
  })

  test('empty completion reports uncertainty without replaying the action', async () => {
    let listener!: (event: SessionEvent) => void
    let sends = 0
    const transport = createArtistManagerVoiceTransport({
      ensureSession: async () => ({ id: 's' }),
      sendMessage: async () => {
        sends++
        listener({ type: 'text_complete', sessionId: 's', text: 'Working on it.', isIntermediate: true })
        listener({ type: 'complete', sessionId: 's' })
      },
      cancelProcessing: async () => {}, onSessionEvent: (h) => { listener = h; return () => {} },
    })
    expect(transport.retryEmptyResponse).toBe(false)
    expect(await drain(await transport.generateReply(request())))
      .toBe('The manager finished this turn without a spoken summary. No completion was confirmed.')
    expect(sends).toBe(1)
  })

  test('consumer return cancels a pending next without waiting for agent output', async () => {
    let listener!: (event: SessionEvent) => void
    const sent = deferred<void>()
    let cancelled = 0
    let unsubscribed = 0
    const transport = createArtistManagerVoiceTransport({
      ensureSession: async () => ({ id: 's' }), sendMessage: async () => { sent.resolve() },
      cancelProcessing: async () => { cancelled++; listener({ type: 'complete', sessionId: 's' }) },
      onSessionEvent: (h) => { listener = h; return () => { unsubscribed++ } },
    })
    const iterator = (await transport.generateReply(request()))[Symbol.asyncIterator]()
    const pending = iterator.next().catch((e) => e.message)
    await sent.promise
    await iterator.return?.()
    expect(await pending).toBe('Artist Manager voice consumer closed')
    expect(cancelled).toBe(1)
    expect(unsubscribed).toBe(1)
  })

  test('abort between stream creation and consumption never creates a session', async () => {
    const controller = new AbortController()
    let calls = 0
    const transport = createArtistManagerVoiceTransport({
      ensureSession: async () => { calls++; return { id: 's' } },
      sendMessage: async () => { calls++ }, cancelProcessing: async () => {}, onSessionEvent: () => () => {},
    })
    const stream = await transport.generateReply(request(controller.signal))
    controller.abort(new Error('stopped before consuming'))
    await expect(drain(stream)).rejects.toThrow('stopped before consuming')
    expect(calls).toBe(0)
  })

  test('returning after the answer removes the event subscription and timer', async () => {
    let listener!: (event: SessionEvent) => void
    let unsubscribed = 0
    let cancelled = 0
    const transport = createArtistManagerVoiceTransport({
      ensureSession: async () => ({ id: 's' }),
      sendMessage: async () => {
        listener({ type: 'text_complete', sessionId: 's', text: 'Done' })
        listener({ type: 'complete', sessionId: 's' })
      },
      cancelProcessing: async () => { cancelled++ },
      onSessionEvent: (h) => { listener = h; return () => { unsubscribed++ } },
    })
    const iterator = (await transport.generateReply(request()))[Symbol.asyncIterator]()
    expect((await iterator.next()).value.text).toBe('Done')
    await iterator.return?.()
    expect(unsubscribed).toBe(1)
    expect(cancelled).toBe(0)
  })

  test('rejects pre-aborted requests without creating or sending a session', async () => {
    const controller = new AbortController()
    controller.abort(new Error('already stopped'))
    let calls = 0
    const transport = createArtistManagerVoiceTransport({
      ensureSession: async () => { calls++; return { id: 's' } },
      sendMessage: async () => { calls++ }, cancelProcessing: async () => {}, onSessionEvent: () => () => {},
    })
    await expect(transport.generateReply(request(controller.signal))).rejects.toThrow('already stopped')
    expect(calls).toBe(0)
  })

  test('abort during session creation never dispatches tools', async () => {
    const session = deferred<{ id: string }>()
    const entered = deferred<void>()
    let sends = 0
    const controller = new AbortController()
    const transport = createArtistManagerVoiceTransport({
      ensureSession: () => { entered.resolve(); return session.promise },
      sendMessage: async () => { sends++ }, cancelProcessing: async () => {}, onSessionEvent: () => () => {},
    })
    const result = drain(await transport.generateReply(request(controller.signal)))
    await entered.promise
    controller.abort(new Error('stopped during setup'))
    session.resolve({ id: 's' })
    await expect(result).rejects.toThrow('stopped during setup')
    expect(sends).toBe(0)
  })

  test('speaks final results, not intermediate commentary or subagent text', async () => {
    let listener!: (event: SessionEvent) => void
    const transport = createArtistManagerVoiceTransport({
      ensureSession: async () => ({ id: 's' }),
      sendMessage: async () => {
        listener({ type: 'text_delta', sessionId: 's', delta: 'I will do that.' })
        listener({ type: 'text_complete', sessionId: 's', text: 'I will do that.', isIntermediate: true })
        listener({ type: 'text_complete', sessionId: 's', text: 'Verified result.' })
        listener({ type: 'text_complete', sessionId: 's', text: 'Private worker result.', parentToolUseId: 'tool' })
        listener({ type: 'complete', sessionId: 's' })
      },
      cancelProcessing: async () => {}, onSessionEvent: (h) => { listener = h; return () => {} },
    })
    expect(await drain(await transport.generateReply(request()))).toBe('Verified result.')
  })

  test('waits for cancelled backend drain before sending the next turn', async () => {
    let listener!: (event: SessionEvent) => void
    const sent = deferred<void>()
    const cancelled = deferred<void>()
    let sends = 0
    const controller = new AbortController()
    const transport = createArtistManagerVoiceTransport({
      ensureSession: async () => ({ id: 's' }),
      sendMessage: async () => {
        sends++
        if (sends === 1) sent.resolve()
        else { listener({ type: 'text_complete', sessionId: 's', text: 'New result' }); listener({ type: 'complete', sessionId: 's' }) }
      },
      cancelProcessing: async () => { listener({ type: 'interrupted', sessionId: 's' }); cancelled.resolve() },
      onSessionEvent: (h) => { listener = h; return () => {} },
    })
    const first = drain(await transport.generateReply(request(controller.signal))).catch((e) => e.message)
    await sent.promise
    controller.abort(new Error('cancel first'))
    await cancelled.promise
    const second = drain(await transport.generateReply(request()))
    await Promise.resolve()
    expect(sends).toBe(1)
    listener({ type: 'text_complete', sessionId: 's', text: 'Stale result' })
    listener({ type: 'complete', sessionId: 's' })
    expect(await first).toBe('cancel first')
    expect(await second).toBe('New result')
  })

  test('quarantines sessions whose cancelled backend never drains', async () => {
    let sends = 0
    const transport = createArtistManagerVoiceTransport({
      ensureSession: async () => ({ id: 's' }), sendMessage: async () => { sends++ },
      cancelProcessing: async () => {}, onSessionEvent: () => () => {},
      responseTimeoutMs: 5, cancellationTimeoutMs: 5,
    })
    await expect(drain(await transport.generateReply(request()))).rejects.toThrow('timed out')
    await expect(drain(await transport.generateReply(request()))).rejects.toThrow('did not stop safely')
    expect(sends).toBe(1)
  })
})
