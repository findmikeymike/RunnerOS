import { describe, expect, test } from 'bun:test'
import { describeBuildAgreement, getEmbeddedBuildInfo, type BuildInfo } from '../build-info'

const main: BuildInfo = { component: 'main', commit: 'abc123', sourceHash: 'source-a', dirty: false, builtAt: '2026-09-10T00:00:00Z', product: 'artist-os' }
describe('loaded build provenance', () => {
  test('unembedded runtime does not invent checkout identity', () => {
    expect(getEmbeddedBuildInfo()).toBeNull()
    expect(describeBuildAgreement([null, null, null])).toContain('unavailable')
    expect(describeBuildAgreement([main, null, { ...main, component: 'renderer' }])).toContain('unavailable')
  })
  test('component build times can differ for identical sources', () => {
    expect(describeBuildAgreement([main, { ...main, component: 'preload', builtAt: '2026-09-10T00:00:10Z' }, { ...main, component: 'renderer' }])).toContain('same source')
  })
  test.each([
    { sourceHash: 'source-b' }, { commit: 'def456' }, { dirty: true }, { product: 'runner' },
  ])('reports mixed source identity %j', change => {
    expect(describeBuildAgreement([main, { ...main, ...change, component: 'renderer' }, null])).toContain('different source')
  })
})
