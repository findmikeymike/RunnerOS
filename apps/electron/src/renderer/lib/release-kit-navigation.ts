export interface PendingReleaseKitOutput {
  outputId: string
  assetId?: string
}

let pendingOutput: PendingReleaseKitOutput | null = null

export function setPendingReleaseKitOutput(outputId: string, assetId?: string): void {
  const normalized = outputId.trim()
  pendingOutput = normalized ? { outputId: normalized, ...(assetId?.trim() ? { assetId: assetId.trim() } : {}) } : null
}

export function consumePendingReleaseKitOutput(): PendingReleaseKitOutput | null {
  const value = pendingOutput
  pendingOutput = null
  return value
}
