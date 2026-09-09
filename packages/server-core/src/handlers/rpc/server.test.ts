import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { nextAvailableWorkspaceRoot } from './server'

describe('workspace root allocation', () => {
  test('never reuses a deleted root still fenced by this process', () => {
    const base = '/workspaces'
    const retired = new Set([join(base, 'summer-ep')])
    expect(nextAvailableWorkspaceRoot(base, 'summer-ep', path => retired.has(path)))
      .toBe(join(base, 'summer-ep-1'))
  })

  test('skips both existing and retired numbered roots', () => {
    const base = '/workspaces'
    const unavailable = new Set([join(base, 'summer-ep'), join(base, 'summer-ep-1')])
    expect(nextAvailableWorkspaceRoot(base, 'summer-ep', path => unavailable.has(path)))
      .toBe(join(base, 'summer-ep-2'))
  })
})
