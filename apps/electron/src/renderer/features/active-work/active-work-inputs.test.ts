import { describe, expect, test } from 'bun:test'
import { coerceSupplyValues } from './active-work-inputs'

describe('active work input supply', () => {
  test('coerces every requested value using the workflow input types', () => {
    expect(coerceSupplyValues(
      ['brief', 'count', 'approved'],
      [
        { name: 'brief', type: 'string' },
        { name: 'count', type: 'number' },
        { name: 'approved', type: 'boolean' },
      ],
      { brief: 'Night drive', count: '3', approved: 'false' },
    )).toEqual({ values: { brief: 'Night drive', count: 3, approved: false } })
  })

  test('rejects missing, malformed numeric, and malformed boolean values', () => {
    expect(coerceSupplyValues(['brief'], [], { brief: '' })).toEqual({ error: 'Add brief.' })
    expect(coerceSupplyValues(['count'], [{ name: 'count', type: 'number' }], { count: 'many' })).toEqual({ error: 'count must be a number.' })
    expect(coerceSupplyValues(['ready'], [{ name: 'ready', type: 'boolean' }], { ready: 'maybe' })).toEqual({ error: 'Choose yes or no for ready.' })
  })
})
