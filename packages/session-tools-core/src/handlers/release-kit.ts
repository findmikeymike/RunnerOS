import type { SessionToolContext } from '../context.ts'
import { errorResponse } from '../response.ts'
import type { ToolResult } from '../types.ts'

export type ReleaseKitCategory = 'audio' | 'artwork' | 'video' | 'images' | 'copy' | 'plans' | 'merch' | 'documents' | 'references'

export interface PromoteToReleaseKitToolInput {
  campaignWorkspaceId?: string
  sourceType: 'campaign-asset' | 'vault-asset' | 'output'
  sourceId: string
  assetId?: string
  vaultWorkspaceId?: string
  category: ReleaseKitCategory
  subtype: string
  title?: string
  makePrimary?: boolean
  note?: string
}

export interface CampaignReleaseKitToolInput { campaignWorkspaceId?: string }
export interface ReleaseKitItemToolInput extends CampaignReleaseKitToolInput { itemId: string }
export interface GetCampaignOutputToolInput extends CampaignReleaseKitToolInput { outputId: string }
export interface GetAssetRecordToolInput {
  sourceType: 'campaign-asset' | 'vault-asset'
  assetId: string
  campaignWorkspaceId?: string
  vaultWorkspaceId?: string
}

export interface ReleaseKitToolResult {
  ok: boolean
  data?: unknown
  error?: string
}

export async function handleListReleaseKit(ctx: SessionToolContext, args: CampaignReleaseKitToolInput): Promise<ToolResult> {
  return callCapability('list_release_kit', ctx.listReleaseKit, { campaignWorkspaceId: args.campaignWorkspaceId?.trim() })
}

export async function handleGetReleaseKitItem(ctx: SessionToolContext, args: ReleaseKitItemToolInput): Promise<ToolResult> {
  const error = required(args.itemId, 'itemId')
  if (error) return errorResponse(error)
  return callCapability('get_release_kit_item', ctx.getReleaseKitItem, { itemId: args.itemId.trim(), campaignWorkspaceId: args.campaignWorkspaceId?.trim() })
}

export async function handlePromoteToReleaseKit(ctx: SessionToolContext, args: PromoteToReleaseKitToolInput): Promise<ToolResult> {
  const sourceError = required(args.sourceId, 'sourceId')
  if (sourceError) return errorResponse(sourceError)
  const subtypeError = required(args.subtype, 'subtype')
  if (subtypeError) return errorResponse(subtypeError)
  if (args.sourceType === 'vault-asset' && !args.vaultWorkspaceId?.trim()) {
    return errorResponse('vaultWorkspaceId is required for an HQ Vault asset.')
  }
  if (args.sourceType !== 'output' && args.assetId !== undefined) {
    return errorResponse('assetId is only valid when sourceType is output.')
  }
  if (args.sourceType === 'output' && !args.assetId?.trim()) {
    return errorResponse('assetId is required for an Output. Choose the exact Output asset to promote.')
  }
  return callCapability('promote_to_release_kit', ctx.promoteToReleaseKit, {
    ...args,
    campaignWorkspaceId: args.campaignWorkspaceId?.trim(),
    sourceId: args.sourceId.trim(),
    assetId: args.assetId?.trim(),
    vaultWorkspaceId: args.vaultWorkspaceId?.trim(),
    subtype: args.subtype.trim(),
    title: args.title?.trim(),
    note: args.note?.trim(),
  })
}

export async function handleRemoveFromReleaseKit(ctx: SessionToolContext, args: ReleaseKitItemToolInput): Promise<ToolResult> {
  const error = required(args.itemId, 'itemId')
  if (error) return errorResponse(error)
  return callCapability('remove_from_release_kit', ctx.removeFromReleaseKit, { itemId: args.itemId.trim(), campaignWorkspaceId: args.campaignWorkspaceId?.trim() })
}

export async function handleSetReleaseKitPrimary(ctx: SessionToolContext, args: ReleaseKitItemToolInput): Promise<ToolResult> {
  const error = required(args.itemId, 'itemId')
  if (error) return errorResponse(error)
  return callCapability('set_release_kit_primary', ctx.setReleaseKitPrimary, { itemId: args.itemId.trim(), campaignWorkspaceId: args.campaignWorkspaceId?.trim() })
}

export async function handleListCampaignAssets(ctx: SessionToolContext, args: CampaignReleaseKitToolInput): Promise<ToolResult> {
  return callCapability('list_campaign_assets', ctx.listCampaignAssets, { campaignWorkspaceId: args.campaignWorkspaceId?.trim() })
}

export async function handleListArtistVault(ctx: SessionToolContext): Promise<ToolResult> {
  return callCapability('list_artist_vault', ctx.listArtistVault, undefined)
}

export async function handleListCampaignOutputs(ctx: SessionToolContext, args: CampaignReleaseKitToolInput): Promise<ToolResult> {
  return callCapability('list_campaign_outputs', ctx.listCampaignOutputs, { campaignWorkspaceId: args.campaignWorkspaceId?.trim() })
}

export async function handleGetCampaignOutput(ctx: SessionToolContext, args: GetCampaignOutputToolInput): Promise<ToolResult> {
  const error = required(args.outputId, 'outputId')
  if (error) return errorResponse(error)
  return callCapability('get_campaign_output', ctx.getCampaignOutput, {
    campaignWorkspaceId: args.campaignWorkspaceId?.trim(),
    outputId: args.outputId.trim(),
  })
}

export async function handleGetAssetRecord(ctx: SessionToolContext, args: GetAssetRecordToolInput): Promise<ToolResult> {
  const error = required(args.assetId, 'assetId')
  if (error) return errorResponse(error)
  if (args.sourceType === 'vault-asset' && !args.vaultWorkspaceId?.trim()) {
    return errorResponse('vaultWorkspaceId is required for an HQ Vault asset.')
  }
  return callCapability('get_asset_record', ctx.getAssetRecord, {
    sourceType: args.sourceType,
    assetId: args.assetId.trim(),
    campaignWorkspaceId: args.campaignWorkspaceId?.trim(),
    vaultWorkspaceId: args.vaultWorkspaceId?.trim(),
  })
}

function required(value: unknown, field: string): string | null {
  return typeof value === 'string' && value.trim() ? null : `${field} is required.`
}

async function callCapability<TInput>(
  name: string,
  capability: ((input: TInput) => Promise<ReleaseKitToolResult>) | undefined,
  input: TInput,
): Promise<ToolResult> {
  if (!capability) return errorResponse(`${name} is not available in this workspace.`)
  try {
    const result = await capability(input)
    if (!result.ok) return errorResponse(result.error ?? `${name} failed.`)
    return {
      content: [{ type: 'text', text: JSON.stringify(result.data ?? { ok: true }, null, 2) }],
      structuredContent: { ok: true, data: result.data },
      isError: false,
    }
  } catch (error) {
    return errorResponse(`${name} failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}
