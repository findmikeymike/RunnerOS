import { describe, expect, test } from 'bun:test'
import { defaultWorkerSlugs } from './worker-defaults'

describe('worker page defaults', () => {
  test('uses trading workers instead of legacy music operators', () => {
    expect(defaultWorkerSlugs(false)).toEqual(['researcher', 'triager', 'critic'])
    expect(defaultWorkerSlugs(true)).toEqual(['researcher', 'triager', 'critic', 'writer', 'coder'])
  })

  test('does not silently activate the execution worker', () => {
    expect(defaultWorkerSlugs(false)).not.toContain('trade-desk')
    expect(defaultWorkerSlugs(true)).not.toContain('trade-desk')
  })
})
