import { describe, expect, test } from 'bun:test'
import { buildProsodyQuery } from './prosody-query'

describe('Pad rhyme lookup', () => {
  test('word and phrase selections use the same unrestricted final-word lookup', () => {
    const word = buildProsodyQuery({ selection: 'enough', line: 'Not enough' })
    const phrase = buildProsodyQuery({ selection: 'bad enough', line: 'You want it bad enough' })
    expect(phrase.target).toBe('enough')
    expect(phrase.args).toEqual(word.args)
    expect(word.args).not.toContain('--syllables')
    expect(phrase.selection).toBe('bad enough')
  })
  test('keeps punctuation out of targets and bounds input', () => {
    expect(buildProsodyQuery({ selection: 'leaving town!', line: '' }).target).toBe('town')
    expect(buildProsodyQuery({ selection: '!!!', line: '' }).target).toBe('')
    const bounded = buildProsodyQuery({ selection: 'a'.repeat(200), line: 'b'.repeat(600) })
    expect(bounded.selection.length).toBe(120)
    expect(bounded.line.length).toBe(500)
  })
})
