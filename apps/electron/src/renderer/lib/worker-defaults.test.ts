import { describe, expect, test } from 'bun:test'
import { defaultWorkerSlugs } from './worker-defaults'

describe('worker page defaults', () => {
  test('College Radio appears by default in Artist HQ and Campaign workers', () => {
    expect(defaultWorkerSlugs(false)).toContain('college-radio-agent')
    expect(defaultWorkerSlugs(true)).toContain('college-radio-agent')
  })
})
