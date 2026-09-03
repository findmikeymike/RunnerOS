import { describe, expect, test } from 'bun:test'
import { withAutomaticSchedulePlacementLock } from './AutomaticSchedulePlacementLock'

describe('automatic schedule placement lock', () => {
  test('holds the next placement until the current reservation has persisted', async () => {
    let release!: () => void
    const first = withAutomaticSchedulePlacementLock(async () => {
      await new Promise<void>((resolve) => { release = resolve })
      return 'first'
    })
    let secondStarted = false
    const second = withAutomaticSchedulePlacementLock(async () => {
      secondStarted = true
      return 'second'
    })

    await Promise.resolve()
    expect(secondStarted).toBe(false)
    release()
    await expect(first).resolves.toBe('first')
    await expect(second).resolves.toBe('second')
  })
})
