import { describe, expect, test } from 'bun:test'
import { splitDiscoverySpeech } from './useDiscoverySpeech'

describe('discovery speech provider limits', () => {
  test('keeps long findings complete while respecting the per-request limit', () => {
    const text = Array.from({ length: 70 }, (_, i) => `Finding ${i}: The village gathering reveals a tension between belonging and leaving.`).join('\n')
    const sections = splitDiscoverySpeech(text)
    expect(sections.length).toBeGreaterThan(1)
    expect(sections.every(section => section.length <= 1000 && section.length > 0)).toBe(true)
    expect(sections.join(' ').replace(/\s+/g, ' ')).toBe(text.replace(/\s+/g, ' '))
  })

  test('handles empty, exact-limit, and unbroken unicode text without data loss', () => {
    expect(splitDiscoverySpeech(' \n ')).toEqual([])
    expect(splitDiscoverySpeech('a'.repeat(1000))).toEqual(['a'.repeat(1000)])
    const text = 'a' + '🎵'.repeat(1600)
    const sections = splitDiscoverySpeech(text)
    expect(sections.join('')).toBe(text)
    expect(sections.every(section => section.length <= 1000)).toBe(true)
    expect(sections.every(section => !/[\uD800-\uDBFF]$/.test(section))).toBe(true)
  })
})
