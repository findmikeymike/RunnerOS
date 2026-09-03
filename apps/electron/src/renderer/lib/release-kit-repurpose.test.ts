import { describe, expect, test } from 'bun:test'
import type { ReleaseKitItem } from '@craft-agent/shared/release-kit'
import type { VaultAssetRecord } from '@craft-agent/shared/artist-vault'
import {
  buildReleaseKitRepurposeKickoff,
  buildVaultRepurposeKickoff,
  buildSocialVariantSetKickoff,
  buildSocialVariantSetContinuePrompt,
  releaseKitRepurposeRestriction,
  vaultRepurposeRestriction,
} from './release-kit-repurpose'

function videoItem(overrides: Partial<ReleaseKitItem> = {}): ReleaseKitItem {
  return {
    id: 'video-1',
    campaignId: 'campaign-1',
    category: 'video',
    subtype: 'final-video',
    title: 'Angelina performance',
    source: { type: 'upload', originalFileName: 'angelina.mp4' },
    relativePath: 'video/angelina.mp4',
    sha256: 'a'.repeat(64),
    status: 'ready',
    isPrimary: true,
    promotedAt: '2026-09-02T00:00:00.000Z',
    promotedBy: 'user',
    usage: {
      bestFor: ['social'],
      contentRating: 'clean',
      restrictions: { blockedFromUse: false, needsRightsClearance: false, artistLikenessRestricted: false },
      updatedAt: '2026-09-02T00:00:00.000Z',
      updatedBy: 'user',
    },
    ...overrides,
  }
}

describe('Release Kit repurposing kickoff', () => {
  test('allows only a resolved verified unrestricted video', () => {
    expect(releaseKitRepurposeRestriction(videoItem(), '/campaign/release-kit/video.mp4')).toBeUndefined()
    expect(releaseKitRepurposeRestriction(videoItem({ status: 'needs-review' }), '/campaign/release-kit/video.mp4')).toContain('Verify')
    expect(releaseKitRepurposeRestriction(videoItem({ category: 'audio' }), '/campaign/release-kit/master.wav')).toContain('video')
    expect(releaseKitRepurposeRestriction(videoItem(), undefined)).toContain('could not be resolved')
  })

  test('fails closed on every usage restriction', () => {
    for (const restriction of ['blockedFromUse', 'needsRightsClearance', 'artistLikenessRestricted'] as const) {
      const item = videoItem({
        usage: {
          ...videoItem().usage,
          restrictions: { ...videoItem().usage.restrictions, [restriction]: true },
        },
      })
      expect(releaseKitRepurposeRestriction(item, '/campaign/release-kit/video.mp4')).toBeTruthy()
    }
  })

  test('starts a planning conversation without authorizing publishing or Trial', () => {
    const prompt = buildReleaseKitRepurposeKickoff(videoItem(), '/campaign/release-kit/angelina.mp4')
    expect(prompt).toContain('about two strong variants')
    expect(prompt).toContain('Ask only')
    expect(prompt).toContain('Do not wait for a separate plan approval')
    expect(prompt).toContain('Do not publish or schedule anything')
    expect(prompt).toContain('only if I explicitly ask')
    expect(prompt).toContain('a'.repeat(64))
  })

  test('allows only agent-usable rights-cleared approved Vault video', () => {
    const asset: VaultAssetRecord = {
      id: 'vault-video-1',
      category: 'video',
      kind: 'final-video',
      label: 'Tour diary',
      absolutePath: '/vault/tour-diary.mp4',
      sha256: 'b'.repeat(64),
      source: 'copy',
      status: 'final',
      rightsStatus: 'safe-to-use',
      usableByAgents: true,
      createdAt: '2026-09-02T00:00:00.000Z',
      updatedAt: '2026-09-02T00:00:00.000Z',
    }
    expect(vaultRepurposeRestriction(asset)).toBeUndefined()
    expect(buildVaultRepurposeKickoff(asset)).toContain('/vault/tour-diary.mp4')
    expect(vaultRepurposeRestriction({ ...asset, rightsStatus: 'unknown' })).toContain('safe to use')
    expect(vaultRepurposeRestriction({ ...asset, status: 'review' })).toContain('approved or final')
    expect(vaultRepurposeRestriction({ ...asset, usableByAgents: false })).toContain('Allow agents')
  })

  test('builds a bounded conversational kickoff with render and posting boundaries', () => {
    const prompt = buildSocialVariantSetKickoff({
      outputId: 'variant-set-1',
      sources: [{ title: 'Tour diary', absolutePath: '/vault/tour.mp4', sha256: 'b'.repeat(64) }],
      variantsPerSource: 2,
      destination: { platform: 'instagram', accountRole: 'secondary', mode: 'standard' },
      direction: 'Favor two different opening moments.',
    })
    expect(prompt).toContain('Let\'s get the direction right and begin')
    expect(prompt).toContain('Variant Set Output: variant-set-1')
    expect(prompt).toContain('do not pause for a separate plan approval')
    expect(prompt).toContain('Do not publish, schedule, or spend money')
    expect(prompt).toContain('Posting approval comes later')
    expect(prompt).not.toContain('Trial requested')
  })

  test('resumes the exact durable set without repeating approval or completed work', () => {
    const prompt = buildSocialVariantSetContinuePrompt({ outputId: 'variant-set-1', revision: 7 })
    expect(prompt).toContain('Continue Variant Set variant-set-1 at revision 7')
    expect(prompt).toContain('preserve every ready version')
    expect(prompt).toContain('finish only missing or failed versions')
    expect(prompt).toContain('cosmetic-only or effectively duplicate edits do not pass')
    expect(prompt).toContain('Do not ask for another plan approval')
    expect(prompt).toContain('do not post or schedule anything')
  })
})
