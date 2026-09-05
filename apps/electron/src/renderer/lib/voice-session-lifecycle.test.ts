import { expect, test } from 'bun:test'
import { VoiceSessionLifecycle } from './voice-session-lifecycle'

test('stop invalidates setup before a runtime exists', async () => {
  const lifecycle = new VoiceSessionLifecycle()
  const ticket = lifecycle.begin()
  await lifecycle.stop()
  expect(() => lifecycle.assertOwner(ticket)).toThrow('cancelled')
})
test('double start cannot create two owners and old ticket cannot attach to restart', async () => {
  const lifecycle = new VoiceSessionLifecycle()
  const first = lifecycle.begin()
  expect(() => lifecycle.begin()).toThrow('already')
  await lifecycle.stop()
  const second = lifecycle.begin()
  expect(lifecycle.owns(second)).toBe(true)
  expect(() => lifecycle.attach(first, { destroy: async () => {} })).toThrow('cancelled')
})
test('restart waits for old audio destruction and repeated stop destroys once', async () => {
  const lifecycle = new VoiceSessionLifecycle()
  let release!: () => void
  let destroys = 0
  lifecycle.attach(lifecycle.begin(), { destroy: () => { destroys++; return new Promise<void>(resolve => { release = resolve }) } })
  const stopping = lifecycle.stop()
  void lifecycle.stop()
  const second = lifecycle.begin()
  let ready = false
  const startup = lifecycle.ready(second).then(() => { ready = true })
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
  expect(ready).toBe(false)
  release()
  await stopping; await startup
  expect(destroys).toBe(1)
  expect(ready).toBe(true)
})
