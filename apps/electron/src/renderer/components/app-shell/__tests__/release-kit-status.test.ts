import { describe, expect, test } from 'bun:test'
import {
  featuredReleaseKitItem,
  isUnverifiedReleaseKitItem,
  releaseKitStatusExplanation,
  releaseKitStatusLabel,
  releaseKitStatusRingClass,
  shouldShowPrimaryBadge,
} from '../release-kit-status'

const ready = (id: string, isPrimary = false) => ({ id, status: 'ready' as const, isPrimary })
const drifted = (id: string, isPrimary = false) => ({ id, status: 'needs-review' as const, isPrimary })
const missing = (id: string, isPrimary = false) => ({ id, status: 'missing' as const, isPrimary })

describe('release kit item verification', () => {
  test('treats only ready items as verified', () => {
    expect(isUnverifiedReleaseKitItem(ready('a'))).toBe(false)
    expect(isUnverifiedReleaseKitItem(drifted('a'))).toBe(true)
    expect(isUnverifiedReleaseKitItem(missing('a'))).toBe(true)
  })
})

describe('primary badge suppression', () => {
  test('shows Primary only on a verified primary item', () => {
    expect(shouldShowPrimaryBadge(ready('a', true))).toBe(true)
  })

  test('never marks an unverified item as Primary even when the manifest flags it', () => {
    expect(shouldShowPrimaryBadge(drifted('a', true))).toBe(false)
    expect(shouldShowPrimaryBadge(missing('a', true))).toBe(false)
  })

  test('shows nothing for a non-primary item', () => {
    expect(shouldShowPrimaryBadge(ready('a', false))).toBe(false)
  })
})

describe('featured item selection', () => {
  test('prefers the verified primary', () => {
    expect(featuredReleaseKitItem([ready('a'), ready('b', true)])?.id).toBe('b')
  })

  test('a drifted primary never displaces a verified item', () => {
    expect(featuredReleaseKitItem([drifted('bad', true), ready('good')])?.id).toBe('good')
  })

  test('prefers any verified item over a drifted one regardless of order', () => {
    expect(featuredReleaseKitItem([drifted('bad'), ready('good')])?.id).toBe('good')
    expect(featuredReleaseKitItem([ready('good'), drifted('bad')])?.id).toBe('good')
  })

  test('still surfaces a drifted item when it is the only candidate', () => {
    // Hiding a promoted asset entirely would be worse than flagging it.
    expect(featuredReleaseKitItem([drifted('only', true)])?.id).toBe('only')
    expect(featuredReleaseKitItem([missing('only')])?.id).toBe('only')
  })

  test('returns undefined for an empty category', () => {
    expect(featuredReleaseKitItem([])).toBeUndefined()
  })
})

describe('drift presentation', () => {
  test('applies the amber ring only to unverified items', () => {
    expect(releaseKitStatusRingClass(drifted('a'))).toContain('amber')
    expect(releaseKitStatusRingClass(missing('a'))).toContain('amber')
    expect(releaseKitStatusRingClass(ready('a'))).not.toContain('amber')
  })

  test('distinguishes a missing file from a hash mismatch', () => {
    expect(releaseKitStatusLabel(missing('a'))).toBe('File missing')
    expect(releaseKitStatusLabel(drifted('a'))).toBe('Needs review')
    expect(releaseKitStatusExplanation(missing('a'))).toContain('missing from disk')
    expect(releaseKitStatusExplanation(drifted('a'))).toContain('no longer matches the hash')
  })
})
