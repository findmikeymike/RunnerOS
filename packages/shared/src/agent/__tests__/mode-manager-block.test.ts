import { describe, expect, it } from 'bun:test'
import { blockWithReason } from '../mode-manager.ts'

describe('blockWithReason', () => {
  it('blocks the tool while allowing the model turn to recover', () => {
    expect(blockWithReason('Read-only mode')).toEqual({
      continue: true,
      decision: 'block',
      reason: '[ERROR] Read-only mode',
    })
  })
})
