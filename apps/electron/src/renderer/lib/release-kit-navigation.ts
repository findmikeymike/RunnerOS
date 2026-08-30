let pendingOutputId: string | null = null

export function setPendingReleaseKitOutput(outputId: string): void {
  pendingOutputId = outputId.trim() || null
}

export function consumePendingReleaseKitOutput(): string | null {
  const outputId = pendingOutputId
  pendingOutputId = null
  return outputId
}
