import { describe, expect, test } from 'bun:test'
import { inferScheduledWorkScope } from './HnicScheduledWork'

describe('inferScheduledWorkScope', () => {
  test('uses persisted workspace scope regardless of its label', () => {
    expect(inferScheduledWorkScope({ artistWorkspaceScope: 'campaign' })).toBe('campaign')
    expect(inferScheduledWorkScope({ artistWorkspaceScope: 'hq' })).toBe('hq')
  })

  test('fails closed when workspace metadata has not been migrated', () => {
    expect(() => inferScheduledWorkScope({})).toThrow(/missing its persisted artist calendar scope/)
    expect(() => inferScheduledWorkScope({ artistWorkspaceScope: 'general' })).toThrow(/Artist HQ or a Campaign/)
    expect(() => inferScheduledWorkScope({ artistWorkspaceScope: 'lab' })).toThrow(/Artist HQ or a Campaign/)
  })
})
