import { describe, expect, test } from 'bun:test'
import { assertReleaseKitSocialUseAllowed } from './social-use.ts'
import type { ReleaseKitItem } from './types.ts'

function itemWith(overrides: Partial<ReleaseKitItem> = {}): ReleaseKitItem {
  return {
    id: 'kit-1', campaignId: 'campaign-1', category: 'video', subtype: 'teaser', title: 'Teaser', mimeType: 'video/mp4',
    relativePath: 'release-kit/video/teaser/teaser.mp4', sha256: 'a'.repeat(64), sizeBytes: 10,
    status: 'ready', isPrimary: true, promotedAt: '2026-08-31T00:00:00.000Z', promotedBy: 'user',
    source: { type: 'upload', originalFileName: 'teaser.mp4' },
    usage: {
      bestFor: [], contentRating: 'unknown', notes: undefined,
      restrictions: { blockedFromUse: false, needsRightsClearance: false, artistLikenessRestricted: false },
      updatedAt: '2026-08-31T00:00:00.000Z', updatedBy: 'user',
    },
    ...overrides,
  }
}

describe('Release Kit social use restrictions', () => {
  test('allows a ready unrestricted item', () => {
    expect(() => assertReleaseKitSocialUseAllowed(itemWith())).not.toThrow()
  })

  test.each([
    ['blocked from use', { blockedFromUse: true }],
    ['rights clearance', { needsRightsClearance: true }],
    ['artist-likeness restriction', { artistLikenessRestricted: true }],
  ] as const)('rejects %s', (message, restriction) => {
    const base = itemWith()
    expect(() => assertReleaseKitSocialUseAllowed(itemWith({
      usage: { ...base.usage, restrictions: { ...base.usage.restrictions, ...restriction } },
    }))).toThrow(new RegExp(message, 'i'))
  })

  test('rejects an item that no longer passes integrity status', () => {
    expect(() => assertReleaseKitSocialUseAllowed(itemWith({ status: 'needs-review' }))).toThrow(/not ready/i)
  })
})
