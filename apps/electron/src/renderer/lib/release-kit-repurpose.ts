import type { ReleaseKitItem } from '@craft-agent/shared/release-kit'
import type { VaultAssetRecord } from '@craft-agent/shared/artist-vault'

export function releaseKitRepurposeRestriction(item: ReleaseKitItem, absolutePath?: string): string | undefined {
  if (item.category !== 'video') return 'Only approved video finals can be repurposed here.'
  if (item.status !== 'ready') return 'Verify this final before creating variants.'
  if (!absolutePath) return 'The exact Release Kit file could not be resolved.'
  if (item.usage.restrictions.blockedFromUse) return 'This final is blocked from use.'
  if (item.usage.restrictions.needsRightsClearance) return 'Clear the rights restriction before creating variants.'
  if (item.usage.restrictions.artistLikenessRestricted) return 'Clear the artist-likeness restriction before creating variants.'
  return undefined
}

export function buildReleaseKitRepurposeKickoff(item: ReleaseKitItem, absolutePath: string): string {
  return buildVideoRepurposeKickoff({
    title: item.title,
    absolutePath,
    sourceLabel: 'Release Kit item',
    sourceId: item.id,
    expectedSha256: item.sha256,
  })
}

export function vaultRepurposeRestriction(asset: VaultAssetRecord): string | undefined {
  if (asset.category !== 'video') return 'Only video assets can be repurposed.'
  if (asset.status !== 'approved' && asset.status !== 'final') return 'Mark this video approved or final before creating variants.'
  if (asset.rightsStatus !== 'safe-to-use') return 'Mark this video safe to use before creating variants.'
  if (!asset.usableByAgents) return 'Allow agents to use this video before creating variants.'
  if (!asset.absolutePath) return 'The exact Vault file could not be resolved.'
  return undefined
}

export function buildVaultRepurposeKickoff(asset: VaultAssetRecord): string {
  if (!asset.absolutePath) throw new Error('The exact Vault file could not be resolved.')
  return buildVideoRepurposeKickoff({
    title: asset.label,
    absolutePath: asset.absolutePath,
    sourceLabel: 'Vault asset',
    sourceId: asset.id,
    expectedSha256: asset.sha256,
  })
}

function buildVideoRepurposeKickoff(input: {
  title: string
  absolutePath: string
  sourceLabel: string
  sourceId: string
  expectedSha256?: string
}): string {
  return [
    `I want to create a few genuinely different social edits from ${JSON.stringify(input.title)}.`,
    '',
    `Use this exact source: ${JSON.stringify(input.absolutePath)}`,
    `${input.sourceLabel}: ${input.sourceId}`,
    ...(input.expectedSha256 ? [`Indexed source SHA-256: ${input.expectedSha256}`] : []),
    '',
    'Read the existing Artist HQ, campaign, and asset context first. Let’s decide the strongest hooks, angles, destinations, and number of variants before you render anything. Ask me the small set of guidance questions that would materially improve the edits, then give me concise variant plans to approve.',
    '',
    'Each version needs a genuinely different opening, selection, duration, or sequence—not just a new filter, font, crop, or re-encode. Keep every result as a reviewable Output in Canvas. Do not publish or schedule anything. Trial Reel is a secondary option only if I explicitly ask for it.',
  ].join('\n')
}
