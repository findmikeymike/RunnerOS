import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  readOutputManifest,
  resolveOutputAssetPath,
} from '@craft-agent/shared/outputs'
import { assertReleaseKitSocialUseAllowed, loadReleaseKitManifest, resolveVerifiedReleaseKitItemPath } from '@craft-agent/shared/release-kit'
import type {
  CampaignCalendarItem,
  CampaignScheduledJob,
} from '@craft-agent/shared/campaign-calendar'
import type { ScheduledWorkOrder, ScheduledSocialActionPreview, ScheduledSocialApproval } from '@craft-agent/shared/scheduled-work'

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
    mediaDigest,
    dryRun: result as Record<string, unknown>,
  }
}

export async function prepareScheduledSocialWork(input: {
  workspaceRootPath: string
  order: ScheduledWorkOrder
}, deps: Pick<PrepareDeps, 'runSocialJson'>): Promise<ScheduledSocialActionPreview> {
  if (input.order.execution.type !== 'social-publish') throw new Error('Scheduled work is not a social publish action.')
  const mediaPath = resolveScheduledSocialMediaPath(input.workspaceRootPath, input.order)
  if (!mediaPath && input.order.execution.platform !== 'x') throw new Error(`${input.order.execution.platform} post requires one resolvable media asset.`)
  const actionId = `act_${input.order.id}`
  const raw = await deps.runSocialJson([
    'post', input.order.execution.platform,
    '--profile', input.order.execution.profileId,
    '--text', input.order.execution.caption,
    ...(mediaPath ? ['--media', mediaPath] : []),
    ...platformFlags(input.order.execution.platform, input.order.execution.platformOptions ?? {}),
    '--action-id', actionId,
    '--idempotency-key', input.order.executionKey.idempotencyKey,
    '--dry-run', '--json',
  ]) as SocialDryRunResult
  if (raw.ok !== true || raw.status !== 'dry_run' || raw.actionId !== actionId || !raw.action || typeof raw.action !== 'object') {
    throw new Error('Printing Press Social did not return the exact scheduled dry-run action.')
  }
  if (raw.platform !== input.order.execution.platform || raw.profile !== input.order.execution.profileId) throw new Error('Social dry-run profile mismatch.')
  assertScheduledDryRunMatchesOrder(raw as Record<string, unknown>, input.order)
  if (raw.browserPlan?.accountVerification?.verificationTargetKnown !== true) throw new Error('Social profile has no known account verification target.')
  const mediaDigest = mediaPath ? fingerprintCampaignSocialMediaPath(mediaPath) : undefined
  const actionDigest = socialActionDigest(raw as Record<string, unknown>, mediaDigest)
  return {
    actionId,
    actionDigest,
    mediaDigest,
    platform: input.order.execution.platform,
    profileId: input.order.execution.profileId,
    preparedAt: new Date().toISOString(),
    payloadDigest: input.order.executionKey.payloadDigest,
    summary: `${input.order.execution.platform} post for ${input.order.execution.profileId} is ready for exact approval.`,
    dryRun: raw as Record<string, unknown>,
  }
}

export async function executeScheduledSocialWork(input: {
  workspaceRootPath: string
  order: ScheduledWorkOrder
  preview: ScheduledSocialActionPreview
  approval: ScheduledSocialApproval
}, deps: Pick<PrepareDeps, 'runSocialJson'>): Promise<{ receiptId: string; externalUrl?: string; summary: string }> {
  if (input.order.execution.type !== 'social-publish') throw new Error('Scheduled work is not social publish work.')
  const mediaPath = resolveScheduledSocialMediaPath(input.workspaceRootPath, input.order)
  const mediaDigest = mediaPath ? fingerprintCampaignSocialMediaPath(mediaPath) : undefined
  assertScheduledDryRunMatchesOrder(input.preview.dryRun, input.order)
  const actionDigest = socialActionDigest(input.preview.dryRun, mediaDigest)
  if (input.approval.expiresAt <= new Date().toISOString()) throw new Error('Social approval expired before execution.')
  if (input.approval.actionId !== input.preview.actionId
    || input.approval.actionDigest !== actionDigest
    || input.approval.mediaDigest !== mediaDigest
    || input.approval.payloadDigest !== input.order.executionKey.payloadDigest
    || input.approval.platform !== input.order.execution.platform
    || input.approval.profileId !== input.order.execution.profileId) {
    throw new Error('Social action changed after approval.')
  }
  const directory = mkdtempSync(join(tmpdir(), 'runneros-social-action-'))
  const actionFile = join(directory, 'action.json')
  try {
    writeFileSync(actionFile, JSON.stringify(input.preview.dryRun), { mode: 0o600 })
    const result = await deps.runSocialJson(['execute', '--action-file', actionFile, '--expected-action-id', input.preview.actionId, '--confirm', 'yes', '--engine', 'runner-cdp', '--json']) as Record<string, unknown>
    if (result.code === 'RUNNER_CDP_DELEGATED') {
      throw new Error('Approved social action needs visible-account verification and confirmed browser execution before a receipt can be recorded.')
    }
    if (result.ok !== true || (result.status !== 'succeeded' && result.status !== 'duplicate')) {
      throw new Error('Printing Press Social did not return a successful publication receipt.')
    }
    return {
      receiptId: input.preview.actionId,
      externalUrl: typeof result.externalUrl === 'string' ? result.externalUrl : typeof result.url === 'string' ? result.url : undefined,
      summary: result.status === 'duplicate' ? 'Already published by this exact approved action.' : `Published to ${input.preview.platform}/${input.preview.profileId}.`,
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

export function fingerprintCampaignSocialMediaPath(path: string): string {
  return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`
}

export function resolveCampaignSocialMediaPath(input: PrepareInput): string | undefined {
  if (input.item.releaseKitRefs.length > 1) throw new Error('Social post has multiple Release Kit media references.')
  const releaseKitRef = input.item.releaseKitRefs[0]
  if (releaseKitRef) {
    assertCurrentReleaseKitSocialUseAllowed(input.workspaceRootPath, input.workspaceId, input.workspaceId, releaseKitRef.itemId)
    return resolveVerifiedReleaseKitItemPath(
      input.workspaceRootPath,
      input.workspaceId,
      input.workspaceId,
      releaseKitRef.itemId,
      releaseKitRef.sha256,
    )
  }
  // Legacy schedules remain executable during migration, but new schedules require Release Kit refs.
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

function resolveScheduledSocialMediaPath(workspaceRootPath: string, order: ScheduledWorkOrder): string | undefined {
  const releaseKitRefs = order.inputRefs.filter((ref) => ref.kind === 'release-kit')
  if (releaseKitRefs.length > 1) throw new Error('Social work has multiple Release Kit media references.')
  const releaseKitRef = releaseKitRefs[0]
  if (releaseKitRef) {
    assertCurrentReleaseKitSocialUseAllowed(
      workspaceRootPath,
      order.owner.workspaceId,
      order.owner.campaignId ?? order.owner.workspaceId,
      releaseKitRef.itemId,
    )
    return resolveVerifiedReleaseKitItemPath(
      workspaceRootPath,
      order.owner.workspaceId,
      order.owner.campaignId ?? order.owner.workspaceId,
      releaseKitRef.itemId,
      releaseKitRef.sha256,
    )
  }
  // Legacy schedules remain executable during migration, but new schedules require Release Kit refs.
  for (const ref of order.inputRefs) {
    if (ref.kind !== 'final' && ref.kind !== 'output') continue
    const manifest = readOutputManifest(workspaceRootPath, ref.outputId)
    if (!manifest) continue
    const assets = [...manifest.assets, ...(manifest.primary ? [manifest.primary] : [])]
    const asset = ref.kind === 'final' && ref.assetId ? assets.find((candidate) => candidate.id === ref.assetId) : manifest.primary
    if (!asset) continue
    const resolved = resolveOutputAssetPath(workspaceRootPath, ref.outputId, asset.path)
    if (resolved) return resolved
  }
  return undefined
}

function assertCurrentReleaseKitSocialUseAllowed(workspaceRootPath: string, workspaceId: string, campaignId: string, itemId: string): void {
  const item = loadReleaseKitManifest(workspaceRootPath, workspaceId, campaignId).items.find((candidate) => candidate.id === itemId)
  if (!item) throw new Error(`Release Kit item not found: ${itemId}`)
  assertReleaseKitSocialUseAllowed(item)
}

function socialActionDigest(dryRun: Record<string, unknown>, mediaDigest?: string): string {
  const digest = createHash('sha256').update(stableStringify({ action: dryRun.action, browserPlan: dryRun.browserPlan, mediaDigest })).digest('hex')
  return `sha256:${digest}`
}

function assertScheduledDryRunMatchesOrder(dryRun: Record<string, unknown>, order: ScheduledWorkOrder): void {
  if (order.execution.type !== 'social-publish') throw new Error('Scheduled work is not social publish work.')
  const action = dryRun.action
  if (!action || typeof action !== 'object' || Array.isArray(action)) throw new Error('Social dry-run action is missing.')
  const record = action as Record<string, unknown>
  const payload = record.payload && typeof record.payload === 'object' && !Array.isArray(record.payload) ? record.payload as Record<string, unknown> : {}
  const options = record.options && typeof record.options === 'object' && !Array.isArray(record.options) ? record.options as Record<string, unknown> : {}
  if (record.actionId !== `act_${order.id}`
    || record.platform !== order.execution.platform
    || record.profile !== order.execution.profileId
    || payload.text !== order.execution.caption
    || options.idempotencyKey !== order.executionKey.idempotencyKey
    || options.dryRun !== true) {
    throw new Error('Social dry-run does not match the authoritative work order.')
  }
  if (order.execution.platform === 'youtube') {
    const platformOptions = order.execution.platformOptions ?? {}
    const postType = readPayloadString(platformOptions, 'postType') ?? 'video'
    const visibility = readPayloadString(platformOptions, 'visibility') ?? 'private'
    const madeForKids = readPayloadString(platformOptions, 'madeForKids') ?? 'no'
    if (payload.postType !== postType || payload.visibility !== visibility || payload.madeForKids !== madeForKids) {
      throw new Error('YouTube dry-run settings do not match the authoritative work order.')
    }
  }
}

function resolveExactProfile(item: CampaignCalendarItem): { platform: string; profileId: string } {
  const profiles = (item.socialProfileRefs ?? []).filter((ref) => ref.platform && ref.profileId)
  if (profiles.length !== 1) throw new Error('Social post requires exactly one platform/profile reference.')
  return { platform: profiles[0]!.platform, profileId: profiles[0]!.profileId! }
}

function platformFlags(platform: string, payload: Record<string, unknown>): string[] {
  if (platform !== 'youtube') return []
  const postType = readPayloadString(payload, 'postType') ?? 'video'
  const visibility = readPayloadString(payload, 'visibility') ?? 'private'
  const madeForKids = readPayloadString(payload, 'madeForKids') ?? 'no'
  return ['--post-type', postType, '--visibility', visibility, '--made-for-kids', madeForKids]
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
