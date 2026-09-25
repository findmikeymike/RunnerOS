import type { MissionAssetKindHint, MissionAssetRecord } from '@craft-agent/shared/mission-assets'
import type { PromoteToReleaseKitInput, ReleaseKitItem, ReleaseKitManifest } from '@craft-agent/shared/release-kit'

type Promotion = { manifest: ReleaseKitManifest; item: ReleaseKitItem }
export type CampaignMasterReleaseKitResult =
  | { status: 'skipped' }
  | { status: 'requires-selection' }
  | ({ status: 'promoted' } & Promotion)

/** Only the board's explicit Master File action selects final audio automatically. */
export async function promoteCampaignMasterToReleaseKit(input: {
  workspaceId: string
  kindHint: MissionAssetKindHint
  imported: readonly MissionAssetRecord[]
  promote: (workspaceId: string, input: PromoteToReleaseKitInput) => Promise<Promotion>
}): Promise<CampaignMasterReleaseKitResult> {
  if (input.kindHint !== 'master') return { status: 'skipped' }
  const masters = input.imported.filter(asset => asset.kind === 'master')
  if (masters.length === 0) return { status: 'skipped' }
  if (masters.length > 1) return { status: 'requires-selection' }
  const master = masters[0]!
  const promotion = await input.promote(input.workspaceId, {
    source: { type: 'campaign-asset', assetId: master.id },
    category: 'audio',
    subtype: 'master',
    title: master.label,
    makePrimary: true,
  })
  return { status: 'promoted', ...promotion }
}
