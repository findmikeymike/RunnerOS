import { describe, expect, test } from 'bun:test'
import { assertExpectedContextBody } from './workspace-context'

describe('workspace context compare-and-swap', () => {
  test('accepts the exact body that was read', () => {
    expect(() => assertExpectedContextBody('campaign-calendar', 'current', 'current')).not.toThrow()
    expect(() => assertExpectedContextBody('campaign-calendar', null, null)).not.toThrow()
  })

  test('rejects a stale body before it can overwrite a newer write', () => {
    expect(() => assertExpectedContextBody('campaign-calendar', 'runner update', 'stale renderer copy'))
      .toThrow('CONTEXT_DOC_CONFLICT')
  })
})
