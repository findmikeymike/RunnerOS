import { readFileSync } from 'node:fs'
import { listOutputManifests, resolveOutputAssetPath } from '@craft-agent/shared/outputs'
import { isXEditorialSlateOutput, parseXEditorialSlate } from '@craft-agent/shared/x-editorial'

export function readXEditorialHistory(workspaceRootPath: string, workspaceId: string, requestedLimit = 8) {
  const limit = Math.min(20, Math.max(1, requestedLimit))
  const manifests = listOutputManifests(workspaceRootPath)
    .filter((manifest) => manifest.workspaceId === workspaceId && isXEditorialSlateOutput(manifest))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  const slates = []

  for (const manifest of manifests) {
    if (slates.length >= limit) break
    try {
      const asset = manifest.primary
        ?? (manifest.preview?.assetId ? manifest.assets.find((candidate) => candidate.id === manifest.preview?.assetId) : undefined)
      if (!asset || asset.mimeType !== 'application/json') continue
      const assetPath = resolveOutputAssetPath(workspaceRootPath, manifest.id, asset.path)
      if (!assetPath) continue
      const parsed = parseXEditorialSlate(readFileSync(assetPath, 'utf-8'))
      if (!parsed.ok) continue
      slates.push({
        outputId: manifest.id,
        outputUpdatedAt: manifest.updatedAt,
        slateId: parsed.slate.slateId,
        title: parsed.slate.title,
        createdAt: parsed.slate.createdAt,
        timezone: parsed.slate.timezone,
        context: parsed.slate.context,
        candidates: parsed.slate.candidates.map((candidate) => ({
          id: candidate.id,
          revision: candidate.revision,
          lane: candidate.lane,
          format: candidate.format,
          text: candidate.text,
          scheduledFor: candidate.scheduledFor,
          campaignId: candidate.campaignId,
          status: candidate.status,
          postedAt: candidate.receipt?.completedAt,
        })),
      })
    } catch {
      // One stale Output must not make the artist's entire fatigue ledger unreadable.
    }
  }

  return { workspaceId, slates }
}
