import { describe, expect, it } from 'bun:test'
import { createPushableInputStream, resolveKeepBackgroundTasksAlive } from './persistent-input.ts'

describe('resolveKeepBackgroundTasksAlive', () => {
  it('defaults on and supports an explicit kill switch', () => {
    expect(resolveKeepBackgroundTasksAlive({})).toBe(true)
    expect(resolveKeepBackgroundTasksAlive({ CRAFT_KEEP_BG_AGENTS_ALIVE: '1' })).toBe(true)
    expect(resolveKeepBackgroundTasksAlive({ CRAFT_KEEP_BG_AGENTS_ALIVE: '0' })).toBe(false)
  })
})

describe('createPushableInputStream', () => {
  it('delivers queued values in FIFO order then ends', async () => {
    const input = createPushableInputStream<number>()
    input.push(1)
    input.push(2)
    input.end()
    const values: number[] = []
    for await (const value of input.stream) values.push(value)
    expect(values).toEqual([1, 2])
  })

  it('wakes a suspended consumer', async () => {
    const input = createPushableInputStream<string>()
    const result = (async () => {
      for await (const value of input.stream) return value
      return null
    })()
    await Promise.resolve()
    input.push('ready')
    expect(await result).toBe('ready')
  })

  it('rejects pushes after end and makes end idempotent', () => {
    const input = createPushableInputStream<number>()
    input.end()
    expect(() => input.end()).not.toThrow()
    expect(() => input.push(1)).toThrow(/after end/)
  })
})
