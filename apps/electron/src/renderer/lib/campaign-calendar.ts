export * from '@craft-agent/shared/campaign-calendar'

import type { CampaignExternalExecutionReceipt } from '@craft-agent/shared/campaign-calendar'

export function formatCampaignExternalReceiptLabel(receipt: CampaignExternalExecutionReceipt): string {
  const platform = receipt.platform
    ? `${receipt.platform.charAt(0).toUpperCase()}${receipt.platform.slice(1)}`
    : receipt.actionType.replace(/-/g, ' ')
  return [platform, receipt.profileId, receipt.id].filter(Boolean).join(' · ')
}
