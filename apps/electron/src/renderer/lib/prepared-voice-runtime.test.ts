import { describe, expect, test } from 'bun:test'
import { createPreparedVoiceRuntime } from './prepared-voice-runtime'
import { VoiceSessionLifecycle } from './voice-session-lifecycle'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(yes => { resolve = yes })
  return { promise, resolve }
}
const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }

describe('prepared voice resource cleanup', () => {
  test('cancels pending local STT preparation immediately before waiting for runtime destruction', async () => {
    const preparation = deferred()
    const order: string[] = []
    const runtime = { async destroy() { order.push('runtime'); await preparation.promise } }
    const wrapper = createPreparedVoiceRuntime({
      runtime,
      stt: {
        cancelStart() { order.push('cancel preparation'); preparation.resolve() },
        async stop() { order.push('stt') },
      },
      focus: { async stop() { order.push('focus') } },
    })
    const stopping = wrapper.destroy()
    expect(order).toEqual(['cancel preparation', 'runtime'])
    expect(wrapper.runtime).toBe(runtime)
    await stopping
    expect(order).toEqual(['cancel preparation', 'runtime', 'stt', 'focus'])
  })

  test('destroy is idempotent and keeps one barrier until every explicit cleanup settles', async () => {
    const runtimeDone = deferred()
    const focusDone = deferred()
    const order: string[] = []
    const wrapper = createPreparedVoiceRuntime({
      runtime: { async destroy() { order.push('runtime'); await runtimeDone.promise } },
      stt: { cancelStart() { order.push('cancel') }, async stop() { order.push('stt') } },
      focus: { async stop() { order.push('focus'); await focusDone.promise } },
    })
    const first = wrapper.destroy()
    expect(wrapper.destroy()).toBe(first)
    await tick()
    expect(order).toEqual(['cancel', 'runtime'])
    let finished = false
    void first.then(() => { finished = true })
    runtimeDone.resolve(); await tick()
    expect(order).toEqual(['cancel', 'runtime', 'stt', 'focus'])
    expect(finished).toBe(false)
    focusDone.resolve(); await first
    expect(wrapper.destroy()).toBe(first)
    expect(order).toEqual(['cancel', 'runtime', 'stt', 'focus'])
  })

  test('aggregates cancellation, runtime and transport failures without skipping cleanup or retrying', async () => {
    const errors = [new Error('cancel failed'), new Error('runtime failed'), new Error('stt failed'), new Error('focus failed')]
    const called: string[] = []
    const wrapper = createPreparedVoiceRuntime({
      runtime: { async destroy() { called.push('runtime'); throw errors[1] } },
      stt: {
        cancelStart() { called.push('cancel'); throw errors[0] },
        stop() { called.push('stt'); throw errors[2] },
      },
      focus: { async stop() { called.push('focus'); throw errors[3] } },
    })
    const stopping = wrapper.destroy()
    let failure: unknown
    try { await stopping } catch (error) { failure = error }
    expect(failure).toBeInstanceOf(AggregateError)
    expect((failure as AggregateError).errors).toEqual(errors)
    expect((failure as AggregateError).message).toContain('stop prepared voice session')
    expect(wrapper.destroy()).toBe(stopping)
    expect(called).toEqual(['cancel', 'runtime', 'stt', 'focus'])
  })

  test('supports cloud STT without a local cleanup dependency and never starts the runtime', async () => {
    let starts = 0
    const called: string[] = []
    const wrapper = createPreparedVoiceRuntime({
      runtime: { async start() { starts++ }, async destroy() { called.push('runtime') } },
      focus: { async stop() { called.push('focus') } },
    })
    await wrapper.destroy()
    expect(starts).toBe(0)
    expect(called).toEqual(['runtime', 'focus'])
  })

  test('lifecycle readiness waits for abandoned warmup cleanup and retains a failed cleanup barrier', async () => {
    const focusDone = deferred()
    const wrapper = createPreparedVoiceRuntime({
      runtime: { async destroy() {} },
      focus: { async stop() { await focusDone.promise; throw new Error('Unconfirmed session shutdown') } },
    })
    const lifecycle = new VoiceSessionLifecycle<typeof wrapper>()
    const first = lifecycle.begin(); lifecycle.attach(first, wrapper)
    const cleanup = lifecycle.stop()
    const next = lifecycle.begin()
    let ready = false
    const waiting = lifecycle.ready(next).then(() => { ready = true }, error => error)
    await tick()
    expect(ready).toBe(false)
    focusDone.resolve()
    await expect(cleanup).rejects.toBeInstanceOf(AggregateError)
    expect(await waiting).toBeInstanceOf(AggregateError)
    expect(ready).toBe(false)
  })
})
