import { expect, test } from 'bun:test'
import type { VoiceHandoffProposal } from '../../shared/artist-manager-voice-handoff'
import { createVoiceHandoffCoordinator } from './artist-manager-voice-handoff'

function proposal(id = 'proposal-1'): VoiceHandoffProposal {
  return { id, agentSlug: 'content', agentName: 'Content', taskTitle: 'Plan content', brief: 'Prepare a plan.' }
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

test('opens once after cleanup, despite duplicate ready and concurrent completion events', async () => {
  const cleanup = deferred()
  const order: string[] = []
  const coordinator = createVoiceHandoffCoordinator({
    isCurrent: () => true,
    stop: async () => { order.push('stop'); await cleanup.promise; order.push('stopped') },
    open: async value => { order.push(`open:${value.id}`) },
  })
  coordinator.ready(proposal())
  coordinator.ready(proposal())
  const first = coordinator.finish()
  coordinator.ready(proposal())
  await coordinator.finish()
  expect(order).toEqual(['stop'])
  cleanup.resolve()
  await first
  coordinator.ready(proposal())
  await coordinator.finish()
  expect(order).toEqual(['stop', 'stopped', 'open:proposal-1'])
})

test('cleanup failure propagates and cannot open or replay the proposal', async () => {
  let opens = 0
  let stops = 0
  const coordinator = createVoiceHandoffCoordinator({
    isCurrent: () => true,
    stop: async () => { stops++; throw new Error('cleanup failed') },
    open: async () => { opens++ },
  })
  coordinator.ready(proposal())
  await expect(coordinator.finish()).rejects.toThrow('cleanup failed')
  coordinator.ready(proposal())
  await coordinator.finish()
  expect(stops).toBe(1)
  expect(opens).toBe(0)
})

test('external cancellation during cleanup prevents opening', async () => {
  const cleanup = deferred()
  let opens = 0
  const coordinator = createVoiceHandoffCoordinator({
    isCurrent: () => true,
    stop: () => cleanup.promise,
    open: async () => { opens++ },
  })
  coordinator.ready(proposal())
  const finishing = coordinator.finish()
  coordinator.cancel()
  cleanup.resolve()
  await finishing
  expect(opens).toBe(0)
})

test('barge-in cancellation before speech-complete cannot trigger or rearm the handoff', async () => {
  const actions: string[] = []
  const coordinator = createVoiceHandoffCoordinator({
    isCurrent: () => true,
    stop: async () => { actions.push('stop') },
    open: async () => { actions.push('open') },
  })
  coordinator.ready(proposal())
  // Runtime emits bargeIn before assistantAudioStop / agentSpeechComplete.
  coordinator.cancel()
  await coordinator.finish()
  coordinator.ready(proposal())
  await coordinator.finish()
  expect(actions).toEqual([])
})

test('workspace becoming stale during cleanup prevents opening', async () => {
  const cleanup = deferred()
  let current = true
  let opens = 0
  const coordinator = createVoiceHandoffCoordinator({
    isCurrent: () => current,
    stop: () => cleanup.promise,
    open: async () => { opens++ },
  })
  coordinator.ready(proposal())
  const finishing = coordinator.finish()
  current = false
  cleanup.resolve()
  await finishing
  expect(opens).toBe(0)
})

test('already stale or cancelled proposals cannot stop another voice session', async () => {
  let current = false
  let stops = 0
  const coordinator = createVoiceHandoffCoordinator({
    isCurrent: () => current,
    stop: async () => { stops++ },
    open: async () => { throw new Error('must not open') },
  })
  coordinator.ready(proposal())
  await coordinator.finish()
  current = true
  coordinator.ready(proposal('proposal-2'))
  coordinator.cancel()
  await coordinator.finish()
  expect(stops).toBe(0)
})

test('a newer proposal invalidates an older cleanup continuation', async () => {
  const cleanup = deferred()
  const opened: string[] = []
  const coordinator = createVoiceHandoffCoordinator({
    isCurrent: () => true,
    stop: () => cleanup.promise,
    open: async value => { opened.push(value.id) },
  })
  coordinator.ready(proposal())
  const first = coordinator.finish()
  coordinator.ready(proposal('proposal-2'))
  cleanup.resolve()
  await first
  expect(opened).toEqual([])
  await coordinator.finish()
  expect(opened).toEqual(['proposal-2'])
})

test('opening failure propagates without replaying a consumed proposal', async () => {
  let opens = 0
  const coordinator = createVoiceHandoffCoordinator({
    isCurrent: () => true,
    stop: async () => {},
    open: async () => { opens++; throw new Error('open failed') },
  })
  coordinator.ready(proposal())
  await expect(coordinator.finish()).rejects.toThrow('open failed')
  coordinator.ready(proposal())
  await coordinator.finish()
  expect(opens).toBe(1)
})
