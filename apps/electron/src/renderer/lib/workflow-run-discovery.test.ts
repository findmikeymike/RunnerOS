import { expect, test } from 'bun:test'
import { refreshAfterUncertainWorkflowStart, startWorkflowRunDiscovery } from './workflow-run-discovery'

function harness(refresh: () => Promise<void>) {
  const listeners = new Map<string, EventListenerOrEventListenerObject>()
  let tick!: () => void, cancelled = false
  const target = { addEventListener(name: string, fn: EventListenerOrEventListenerObject) { listeners.set(name, fn) }, removeEventListener(name: string) { listeners.delete(name) } } as Pick<Window, 'addEventListener' | 'removeEventListener'>
  const dispose = startWorkflowRunDiscovery({ refresh, target, schedule: callback => { tick = callback; return () => { cancelled = true } } })
  return { tick: () => tick(), fire: (name: string) => (listeners.get(name) as (() => void) | undefined)?.(), dispose, listeners, cancelled: () => cancelled }
}
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

test('empty history discovers a run committed without a delivered Start reply, and remount refreshes', async () => {
  let saved: string[] = [], visible: string[] = [], calls = 0
  const refresh = async () => { calls++; visible = [...saved] }
  const first = harness(refresh); await settle(); expect(visible).toEqual([])
  saved = ['committed']; first.tick(); await settle(); expect(visible).toEqual(['committed'])
  first.dispose(); saved = ['another-window']; const second = harness(refresh); await settle()
  expect(visible).toEqual(['another-window']); expect(calls).toBe(3); second.dispose()
})

test('reconnect and focus refresh; invalidations during a stale request trail it without parallel reads', async () => {
  let release!: () => void, calls = 0, active = 0, maximum = 0
  const gate = new Promise<void>(resolve => release = resolve)
  const h = harness(async () => { calls++; active++; maximum = Math.max(maximum, active); if (calls === 1) await gate; active-- })
  h.fire('online'); h.fire('focus'); h.tick(); expect(calls).toBe(1)
  release(); await settle(); expect(calls).toBe(2); expect(maximum).toBe(1)
  h.fire('online'); await settle(); expect(calls).toBe(3); h.dispose()
})

test('failed discovery retries and disposal removes timers/listeners and queued refreshes', async () => {
  let calls = 0, release!: () => void
  const gate = new Promise<void>(resolve => release = resolve)
  const h = harness(async () => { calls++; if (calls === 1) throw new Error('offline'); await gate })
  await settle(); h.tick(); expect(calls).toBe(2); h.tick(); h.dispose(); release(); await settle(); h.tick()
  expect(calls).toBe(2); expect(h.listeners.size).toBe(0); expect(h.cancelled()).toBe(true)
})

test('uncertain Start trails a pre-admission list without retrying Start itself', async () => {
  let release!: () => void, calls = 0, visible: string[] = []
  const beforeAdmission = new Promise<void>(resolve => release = resolve)
  const recovering = refreshAfterUncertainWorkflowStart(async () => { calls++; if (calls === 1) await beforeAdmission; else visible = ['saved-run'] })
  expect(calls).toBe(1); release(); await recovering
  expect(calls).toBe(2); expect(visible).toEqual(['saved-run'])
  await expect(refreshAfterUncertainWorkflowStart(async () => { throw new Error('offline') })).resolves.toBeUndefined()
})
