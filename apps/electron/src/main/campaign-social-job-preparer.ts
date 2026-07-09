import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import {
  readOutputManifest,
  resolveOutputAssetPath,
} from '@craft-agent/shared/outputs'
import type {
  CampaignCalendarItem,
  CampaignScheduledJob,
} from '@craft-agent/shared/campaign-calendar'

type PrepareInput = {
  workspaceId: string
  workspaceRootPath: string
  item: CampaignCalendarItem
  job: CampaignScheduledJob
}

type SocialDryRunResult = {
  ok?: unknown
  status?: unknown
  actionId?: unknown
  platform?: unknown
  profile?: unknown
  action?: unknown
  browserPlan?: {
    accountVerification?: { verificationTargetKnown?: unknown }
  }
}

type PrepareDeps = {
  runSocialJson(args: string[]): Promise<unknown>
  resolveMediaPath(input: PrepareInput): string | undefined
  fingerprintMediaPath?(path: string): string
}

export async function prepareCampaignSocialJob(input: PrepareInput, deps: PrepareDeps) {
  if (input.job.actionType !== 'post-asset') {
    throw new Error(`Scheduled external action ${input.job.actionType} is not supported by Printing Press Social.`)
  }
  const profile = resolveExactProfile(input.item)
  const text = readPayloadString(input.job.payload, 'caption') ?? readPayloadString(input.job.payload, 'text')
  if (!text) throw new Error('Social post payload requires caption or text.')
  const mediaPath = deps.resolveMediaPath(input)
  if (!mediaPath && profile.platform !== 'x') {
    throw new Error(`${profile.platform} post requires one resolvable Final or Output media asset.`)
  }

  const actionId = `act_${input.job.id}`
  const args = [
    'post', profile.platform,
    '--profile', profile.profileId,
    '--text', text,
    ...(mediaPath ? ['--media', mediaPath] : []),
    ...platformFlags(profile.platform, input.job.payload),
    '--action-id', actionId,
    '--idempotency-key', input.job.idempotencyKey,
    '--dry-run',
    '--json',
  ]
  const raw = await deps.runSocialJson(args)
  const result = raw as SocialDryRunResult
  if (result.ok !== true || result.status !== 'dry_run' || !result.action || typeof result.action !== 'object') {
    throw new Error('Printing Press Social did not return a successful dry-run action.')
  }
  if (result.actionId !== actionId) throw new Error('Social dry-run action id mismatch.')
  if (result.platform !== profile.platform || result.profile !== profile.profileId) {
    throw new Error(`Social dry-run profile mismatch: expected ${profile.platform}/${profile.profileId}.`)
  }
  if (result.browserPlan?.accountVerification?.verificationTargetKnown !== true) {
    throw new Error(`Social profile ${profile.platform}/${profile.profileId} has no known account verification target.`)
  }
  const mediaDigest = mediaPath ? deps.fingerprintMediaPath?.(mediaPath) : undefined
  if (mediaPath && !mediaDigest) throw new Error('Social media asset could not be fingerprinted for exact approval.')

  const actionDigest = createHash('sha256')
    .update(stableStringify({ action: result.action, browserPlan: result.browserPlan, mediaDigest }))
    .digest('hex')
  const platformLabel = profile.platform === 'x'
    ? 'X'
    : `${profile.platform.charAt(0).toUpperCase()}${profile.platform.slice(1)}`
  return {
    actionId,
    actionDigest: `sha256:${actionDigest}`,
    platform: profile.platform,
    profileId: profile.profileId,
    summary: `${platformLabel} post for ${profile.profileId} is ready for exact approval.`,
  }
}

export function fingerprintCampaignSocialMediaPath(path: string): string {
  return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`
}

export function resolveCampaignSocialMediaPath(input: PrepareInput): string | undefined {
  const refs = [
    ...input.item.finalRefs.map((ref) => ({ outputId: ref.outputId, assetId: ref.assetId })),
    ...input.item.outputRefs.map((ref) => ({ outputId: ref.outputId, assetId: undefined })),
  ]
  for (const ref of refs) {
    const manifest = readOutputManifest(input.workspaceRootPath, ref.outputId)
    if (!manifest) continue
    const assets = [...manifest.assets, ...(manifest.primary ? [manifest.primary] : [])]
    const asset = ref.assetId
      ? assets.find((candidate) => candidate.id === ref.assetId)
      : manifest.primary
    if (!asset) continue
    const resolved = resolveOutputAssetPath(input.workspaceRootPath, ref.outputId, asset.path)
    if (resolved) return resolved
  }
  return undefined
}

function resolveExactProfile(item: CampaignCalendarItem): { platform: string; profileId: string } {
  const profiles = (item.socialProfileRefs ?? []).filter((ref) => ref.platform && ref.profileId)
  if (profiles.length !== 1) throw new Error('Social post requires exactly one platform/profile reference.')
  return { platform: profiles[0]!.platform, profileId: profiles[0]!.profileId! }
}

function platformFlags(platform: string, payload: Record<string, unknown>): string[] {
  if (platform !== 'youtube') return []
  const postType = readPayloadString(payload, 'postType') ?? 'short'
  const visibility = readPayloadString(payload, 'visibility') ?? 'public'
  return ['--post-type', postType, '--visibility', visibility]
}

function readPayloadString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}
