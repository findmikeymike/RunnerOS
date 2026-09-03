import type { SessionToolContext } from '../context.ts'
import { errorResponse } from '../response.ts'
import type { ToolResult } from '../types.ts'

export interface GetSocialVariantSetToolInput {
  outputId: string
}

export interface RecordSocialVariantResultToolInput {
  outputId: string
  expectedRevision: number
  sourceId: string
  destinationIndex: number
  title: string
  hook: string
  editorialMode: string
  editorialIntent: string
  filePath?: string
  failureReason?: string
  durationSeconds?: number
  aspectRatio?: string
  replaceVariantId?: string
}

export interface ListUsableSocialVariantsToolInput {
  campaignId: string
  platform: 'instagram' | 'tiktok' | 'x' | 'youtube'
  profileId: string
  accountRole: 'primary' | 'secondary' | 'fan-page'
  unscheduledOnly?: boolean
}

export interface SocialVariantToolResult {
  ok: boolean
  data?: unknown
  error?: string
}

export async function handleGetSocialVariantSet(
  ctx: SessionToolContext,
  args: GetSocialVariantSetToolInput,
): Promise<ToolResult> {
  const outputId = args.outputId?.trim()
  if (!outputId) return errorResponse('outputId is required.')
  return callCapability('get_social_variant_set', ctx.getSocialVariantSet, { outputId })
}

export async function handleRecordSocialVariantResult(
  ctx: SessionToolContext,
  args: RecordSocialVariantResultToolInput,
): Promise<ToolResult> {
  const outputId = args.outputId?.trim()
  if (!outputId) return errorResponse('outputId is required.')
  if (!Number.isInteger(args.expectedRevision) || args.expectedRevision < 1) {
    return errorResponse('expectedRevision must be a positive integer from get_social_variant_set.')
  }
  if (!args.sourceId?.trim()) return errorResponse('sourceId is required.')
  if (!Number.isInteger(args.destinationIndex) || args.destinationIndex < 0) {
    return errorResponse('destinationIndex must be a non-negative integer.')
  }
  const filePath = args.filePath?.trim()
  const failureReason = args.failureReason?.trim()
  if ((filePath ? 1 : 0) + (failureReason ? 1 : 0) !== 1) {
    return errorResponse('Provide exactly one of filePath or failureReason.')
  }

  return callCapability('record_social_variant_result', ctx.recordSocialVariantResult, {
    ...args,
    outputId,
    sourceId: args.sourceId.trim(),
    title: args.title.trim(),
    hook: args.hook.trim(),
    editorialMode: args.editorialMode.trim(),
    editorialIntent: args.editorialIntent.trim(),
    filePath,
    failureReason,
    aspectRatio: args.aspectRatio?.trim(),
    replaceVariantId: args.replaceVariantId?.trim(),
  })
}

export async function handleListUsableSocialVariants(
  ctx: SessionToolContext,
  args: ListUsableSocialVariantsToolInput,
): Promise<ToolResult> {
  const campaignId = args.campaignId?.trim()
  const profileId = args.profileId?.trim()
  if (!campaignId) return errorResponse('campaignId is required.')
  if (!profileId) return errorResponse('profileId is required.')
  return callCapability('list_usable_social_variants', ctx.listUsableSocialVariants, {
    ...args,
    campaignId,
    profileId,
    unscheduledOnly: args.unscheduledOnly !== false,
  })
}

async function callCapability<TInput>(
  name: string,
  capability: ((input: TInput) => Promise<SocialVariantToolResult>) | undefined,
  input: TInput,
): Promise<ToolResult> {
  if (!capability) return errorResponse(`${name} is not available in this session.`)
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
