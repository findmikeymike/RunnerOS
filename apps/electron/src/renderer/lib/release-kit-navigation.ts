export interface PendingReleaseKitOutput {
  outputId: string
  assetId?: string
  sourceWorkspaceId?: string
  socialVariantId?: string
}

let pendingOutput: PendingReleaseKitOutput | null = null

export function setPendingReleaseKitOutput(outputId: string, assetId?: string, options?: { sourceWorkspaceId?: string; socialVariantId?: string }): void {
  const normalized = outputId.trim()
  pendingOutput = normalized ? {
    outputId: normalized,
    ...(assetId?.trim() ? { assetId: assetId.trim() } : {}),
    ...(options?.sourceWorkspaceId?.trim() ? { sourceWorkspaceId: options.sourceWorkspaceId.trim() } : {}),
    ...(options?.socialVariantId?.trim() ? { socialVariantId: options.socialVariantId.trim() } : {}),
  } : null
}

export function consumePendingReleaseKitOutput(): PendingReleaseKitOutput | null {
  const value = pendingOutput
  pendingOutput = null
  return value
}
