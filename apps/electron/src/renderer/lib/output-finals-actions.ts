import type { OutputFinalPointerDTO, RemoveOutputFromFinalInputDTO } from '@/hooks/useOutputs'

export function removeInputForFinal(final: OutputFinalPointerDTO): RemoveOutputFromFinalInputDTO {
  return {
    outputId: final.outputId,
    scope: final.scope,
    ...(final.campaignId ? { campaignId: final.campaignId } : {}),
    slot: final.slot,
    ...(final.assetId ? { assetId: final.assetId } : {}),
  }
}

export function finalPointerLabel(final: OutputFinalPointerDTO): string {
  const scope = final.scope === 'hq' ? 'HQ' : `Campaign${final.campaignId ? ` ${final.campaignId}` : ''}`
  const primary = final.isPrimary ? ' primary' : ''
  return `${formatSlot(final.slot)} · ${scope}${primary}`
}

function formatSlot(slot: string): string {
  return slot.replace(/-/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
}
