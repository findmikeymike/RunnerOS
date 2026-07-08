import { describe, expect, test } from 'bun:test'
import { buildProsodySelection, replaceSelectedRange } from './prosody-selection'

describe('prosody selection helpers', () => {
  test('accepts a selected final word at the end of a line', () => {
    const value = 'I set myself on fire\nNext line'
    const start = value.indexOf('fire')
    const result = buildProsodySelection(value, start, start + 'fire'.length)

    expect(result?.selectedText).toBe('fire')
    expect(result?.line).toBe('I set myself on fire')
  })

  test('accepts trailing punctuation after the selected line-ending word', () => {
    const value = 'I set myself on fire,\nNext line'
    const start = value.indexOf('fire')
    const result = buildProsodySelection(value, start, start + 'fire'.length)

    expect(result?.selectedText).toBe('fire')
    expect(result?.line).toBe('I set myself on fire,')
  })

  test('rejects mid-line selections', () => {
    const value = 'I set myself on fire tonight'
    const start = value.indexOf('fire')

    expect(buildProsodySelection(value, start, start + 'fire'.length)).toBeNull()
  })

  test('replaces only the original selected range', () => {
    const value = 'I set myself on fire'
    const start = value.indexOf('fire')
    const selection = buildProsodySelection(value, start, start + 'fire'.length)

    expect(selection).toBeDefined()
    expect(replaceSelectedRange(value, selection!, 'wire')).toBe('I set myself on wire')
  })
})
