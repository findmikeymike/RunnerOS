import { expect, test } from 'bun:test'
import { createWorkflowRequestLifecycle } from './workflow-request-lifecycle'
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }

test('a fresh authorization request recovers after transient failure', async () => {
  const owner = createWorkflowRequestLifecycle(); let state = 'loading'
  await owner.run(async () => { throw new Error('offline') }, value => { state = value }, () => { state = 'error' })
  expect(state).toBe('error')
  await owner.run(async () => 'authorized current run', value => { state = value }, () => { state = 'error' })
  expect(state).toBe('authorized current run')
})
test('late responses and errors from the prior route cannot replace current authorized state', async () => {
  const prior = createWorkflowRequestLifecycle(), current = createWorkflowRequestLifecycle(), old = deferred<string>(); let visible = ''
  const oldRequest = prior.run(() => old.promise, value => { visible = value }, () => { visible = 'old error' })
  prior.dispose(); await current.run(async () => 'new route', value => { visible = value }, () => {})
  old.resolve('private old route'); await oldRequest; expect(visible).toBe('new route')
})
test('new progress response wins over older pending approval response', async () => {
  const owner = createWorkflowRequestLifecycle(), old = deferred<string[]>(); let visible: string[] = []
  const first = owner.run(() => old.promise, value => { visible = value }, () => {})
  await owner.run(async () => [], value => { visible = value }, () => {})
  old.resolve(['already resolved approval']); await first; expect(visible).toEqual([])
})
test('a decision invalidates an outstanding approval list and unmount rejects late updates', async () => {
  const owner = createWorkflowRequestLifecycle(), old = deferred<string[]>(); let updates = 0
  const request = owner.run(() => old.promise, () => updates++, () => updates++)
  owner.invalidate(); old.resolve(['stale']); await request; expect(updates).toBe(0)
  const late = deferred<string[]>(); const pending = owner.run(() => late.promise, () => updates++, () => updates++)
  owner.dispose(); late.reject(new Error('offline')); await pending; expect(updates).toBe(0)
})

test('slow load survives multiple poll revisions and coalesces exactly one trailing read', async () => {
  const { createWorkflowRefreshLifecycle } = await import('./workflow-request-lifecycle')
  const first = deferred<string>(), second = deferred<string>(); const visible: string[] = []; let calls = 0
  const owner = createWorkflowRefreshLifecycle(() => ++calls === 1 ? first.promise : second.promise, value => visible.push(value), () => {})
  const active = owner.refresh(); owner.refresh(); owner.refresh(); owner.refresh()
  expect(calls).toBe(1)
  first.resolve('first authorized result')
  for (let i = 0; i < 4; i++) await Promise.resolve()
  expect(visible).toEqual(['first authorized result']); expect(calls).toBe(2)
  second.resolve('current result'); await active
  expect(visible).toEqual(['first authorized result', 'current result']); expect(calls).toBe(2)
  owner.dispose()
})
test('decision invalidates slow result but schedules a current read, and key disposal prevents its delivery', async () => {
  const { createWorkflowRefreshLifecycle } = await import('./workflow-request-lifecycle')
  const first = deferred<string>(), second = deferred<string>(); const visible: string[] = []; let calls = 0
  const owner = createWorkflowRefreshLifecycle(() => ++calls === 1 ? first.promise : second.promise, value => visible.push(value), () => {})
  const active = owner.refresh(); owner.invalidate(); owner.refresh()
  first.resolve('old pending approval')
  for (let i = 0; i < 4; i++) await Promise.resolve()
  expect(visible).toEqual([]); expect(calls).toBe(2)
  owner.dispose(); second.resolve('different workspace must not receive this'); await active
  expect(visible).toEqual([])
})
