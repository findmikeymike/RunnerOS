export interface PendingReleaseKitOutput {
  outputId: string
  assetId?: string
  sourceWorkspaceId?: string
  socialVariantId?: string
  releaseKitItemId?: string
  scheduleFinal?: boolean
  targetCampaignId?: string
}

let pendingOutput: PendingReleaseKitOutput | null = null

export function setPendingReleaseKitOutput(outputId: string, assetId?: string, options?: { releaseKitItemId?: string; scheduleFinal?: boolean; sourceWorkspaceId?: string; socialVariantId?: string; targetCampaignId?: string }): void {
  const normalized = outputId.trim()
  pendingOutput = normalized ? {
    outputId: normalized,
    ...(options?.releaseKitItemId ? { releaseKitItemId: options.releaseKitItemId } : {}),
    ...(options?.scheduleFinal ? { scheduleFinal: true } : {}),
    ...(assetId?.trim() ? { assetId: assetId.trim() } : {}),
    ...(options?.sourceWorkspaceId?.trim() ? { sourceWorkspaceId: options.sourceWorkspaceId.trim() } : {}),
    ...(options?.socialVariantId?.trim() ? { socialVariantId: options.socialVariantId.trim() } : {}),
    ...(options?.targetCampaignId?.trim() ? { targetCampaignId: options.targetCampaignId.trim() } : {}),
  } : null
}

export function consumePendingReleaseKitOutput(): PendingReleaseKitOutput | null {
  const value = pendingOutput
  pendingOutput = null
  return value
}
