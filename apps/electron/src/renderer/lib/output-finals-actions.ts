import type {
  OutputFinalPointerDTO,
  OutputManifestDTO,
  OutputSummaryDTO,
  RemoveOutputFromFinalInputDTO,
} from '@/hooks/useOutputs'

type OutputLike = OutputSummaryDTO | OutputManifestDTO

export function removeInputForFinal(final: OutputFinalPointerDTO): RemoveOutputFromFinalInputDTO {
  return {
    outputId: final.outputId,
    scope: final.scope,
    ...(final.campaignId ? { campaignId: final.campaignId } : {}),
    slot: final.slot,
    ...(final.assetId ? { assetId: final.assetId } : {}),
  }
}

export function resolveCampaignFinalId({
  existing,
  output,
  currentCampaignId,
  fallbackCampaignId,
}: {
  existing?: OutputFinalPointerDTO
  output?: OutputLike | null
  currentCampaignId?: string
  fallbackCampaignId?: string
}): string | undefined {
  const id = existing?.campaignId
    ?? output?.context?.campaignId
    ?? currentCampaignId
    ?? fallbackCampaignId
  const trimmed = id?.trim()
  return trimmed || undefined
}

export function finalPointerLabel(final: OutputFinalPointerDTO): string {
  const scope = final.scope === 'hq' ? 'HQ' : `Campaign${final.campaignId ? ` ${final.campaignId}` : ''}`
  const primary = final.isPrimary ? ' primary' : ''
  return `${formatSlot(final.slot)} · ${scope}${primary}`
}

export function defaultFinalSlotForOutput(output: OutputLike): string {
  if (isAdOutput(output)) return 'Ads'
  if (output.kind === 'image') return 'Cover Art'
  if (output.kind === 'video') return 'Shortform Clips'
  if (output.kind === 'audio') return 'Master'
  if (output.kind === 'receipt' || output.kind === 'external-action') return 'References'
  return output.context?.scope === 'hq' ? 'Brand Copy' : 'Press Copy'
}

export function isAdOutput(output: Pick<OutputLike, 'title' | 'summary' | 'tags'>): boolean {
  const tags = output.tags ?? []
  if (tags.some((tag) => /\b(ad|ads|advertising|meta-ads|google-ads|paid-ads|ad-creative)\b/i.test(tag))) return true
  const text = `${output.title} ${output.summary}`.toLowerCase()
  return /\b(ad|ads|advert|advertising)\b/.test(text)
    || /\b(meta|google|paid)\s+ads?\b/.test(text)
    || /\bad\s+(video|creative|asset|copy|variant|campaign)\b/.test(text)
}

function formatSlot(slot: string): string {
  return slot.replace(/-/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
}
