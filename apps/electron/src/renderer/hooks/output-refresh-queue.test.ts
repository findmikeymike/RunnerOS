import { expect, test } from 'bun:test'
import { createOutputRefreshQueue } from './output-refresh-queue'

test('an output created during a pending stale list read is fetched before refresh completes', async () => {
  const queue = createOutputRefreshQueue()
  let finishFirst!: () => void
  const blocked = new Promise<void>((resolve) => { finishFirst = resolve })
  let stored: string[] = []
  let displayed: string[] = []
  let calls = 0
  const read = async () => {
    const snapshot = [...stored]
    if (++calls === 1) await blocked
    displayed = snapshot
  }
  const first = queue.refresh('campaign', read)
  await Promise.resolve()
  stored = ['new-video']
  // Board write and output publication can announce the same change twice.
  queue.invalidate('campaign')
  expect(queue.refresh('campaign', read)).toBe(first)
  queue.invalidate('campaign')
  expect(queue.refresh('campaign', read)).toBe(first)
  finishFirst()
  await first
  expect(calls).toBe(2)
  expect(displayed).toEqual(['new-video'])
})

test('ordinary parallel consumers share a read without requesting another', async () => {
  const queue = createOutputRefreshQueue()
  let calls = 0
  const read = async () => { calls += 1 }
  await Promise.all([queue.refresh('hq', read), queue.refresh('hq', read)])
  expect(calls).toBe(1)
})

test('re-entry refreshes outputs created while no workspace consumer was listening', async () => {
  const queue = createOutputRefreshQueue()
  let stored: string[] = []
  let displayed: string[] = []
  let calls = 0
  const read = async () => { calls += 1; displayed = [...stored] }
  await queue.refresh('campaign', read)
  // All consumers leave; a background run writes without a received event.
  stored = ['background-video']
  queue.invalidate('campaign')
  await queue.refresh('campaign', read)
  expect(displayed).toEqual(['background-video'])
  expect(calls).toBe(2)
})

test('workspace reads stay independent and failures release their queue', async () => {
  const queue = createOutputRefreshQueue()
  await expect(queue.refresh('hq', async () => { throw new Error('offline') })).rejects.toThrow('offline')
  let calls = 0
  await Promise.all([
    queue.refresh('hq', async () => { calls += 1 }),
    queue.refresh('campaign', async () => { calls += 1 }),
  ])
  expect(calls).toBe(2)
})
