import { describe, expect, test } from 'bun:test'
import { buildProsodySelection } from './prosody-selection'

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

  test('keeps selected range metadata for non-mutating rhyme lookup', () => {
    const value = 'I set myself on fire'
    const start = value.indexOf('fire')
    const selection = buildProsodySelection(value, start, start + 'fire'.length)

    expect(selection?.start).toBe(start)
    expect(selection?.end).toBe(start + 'fire'.length)
  })
})
