import { describe, expect, test } from 'bun:test'
import type { LabSpark } from '@craft-agent/shared/lab'
import { filterLabSparks, parseSparkTags } from './lab-sparks'

describe('Lab sparks', () => {
  test('parses comma and hash tags without duplicates', () => {
    expect(parseSparkTags('night, #hook, Night')).toEqual(['night', 'hook'])
  })

  test('searches text and tags while keeping pinned sparks first', () => {
    const filtered = filterLabSparks([
      spark('one', 'Headlights know my name', 'line', ['night']),
      spark('two', 'Night-drive world', 'concept', ['cinematic'], true),
      spark('three', 'Summer title', 'title', ['bright']),
    ], { query: 'night', kind: 'all', tag: 'all' })

    expect(filtered.map((item) => item.id)).toEqual(['two', 'one'])
  })

  test('filters by kind and tag together', () => {
    const filtered = filterLabSparks([
      spark('one', 'First', 'line', ['hook']),
      spark('two', 'Second', 'concept', ['hook']),
    ], { query: '', kind: 'line', tag: 'hook' })

    expect(filtered.map((item) => item.id)).toEqual(['one'])
  })
})

function spark(
  id: string,
  text: string,
  kind: LabSpark['kind'],
  tags: string[],
  pinned = false,
): LabSpark {
  return {
    id,
    text,
    kind,
    tags,
    pinned,
    createdAt: `2026-08-29T00:00:0${id.length}.000Z`,
    updatedAt: `2026-08-29T00:00:0${id.length}.000Z`,
  }
}
