import { describe, expect, test } from 'bun:test'
import { appendDictationTranscript, DictationOperationFence } from './useChatDictation'

describe('chat dictation draft insertion', () => {
  test('creates a draft from a transcript', () => {
    expect(appendDictationTranscript('', '  hello   world ')).toBe('hello world')
  })

  test('preserves an existing draft and adds readable spacing', () => {
    expect(appendDictationTranscript('Ask the manager:', 'what should I do next?'))
      .toBe('Ask the manager: what should I do next?')
    expect(appendDictationTranscript('Already spaced ', 'continue')).toBe('Already spaced continue')
  })
})

describe('chat dictation operation fence', () => {
  test('rejects a second start while an operation is active', () => {
    const fence = new DictationOperationFence()
    const first = fence.begin()
    expect(typeof first).toBe('number')
    expect(fence.begin()).toBeNull()
    expect(fence.isCurrent(first!)).toBe(true)
  })

  test('invalidates pending work on cleanup and allows a fresh mount to start', () => {
    const fence = new DictationOperationFence()
    const stale = fence.begin()!
    fence.cancel()
    expect(fence.isCurrent(stale)).toBe(false)

    const fresh = fence.begin()!
    expect(fresh).not.toBe(stale)
    expect(fence.isCurrent(fresh)).toBe(true)
    fence.finish(fresh)
    expect(fence.isCurrent(fresh)).toBe(false)
  })
})
