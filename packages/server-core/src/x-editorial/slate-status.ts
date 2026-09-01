import { createHash } from 'node:crypto'
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import {
  readOutputManifest,
  resolveOutputAssetPath,
  writeOutputManifest,
  type OutputAsset,
  type OutputManifest,
} from '@craft-agent/shared/outputs'
import {
  isXEditorialSocialAuthorizationDefinition,
  type ScheduledWorkOrder,
} from '@craft-agent/shared/scheduled-work'
import {
  isXEditorialSlateOutput,
  parseXEditorialSlate,
  type XEditorialCandidate,
} from '@craft-agent/shared/x-editorial'

export interface XEditorialSlateOrderReconcileResult {
  updated: boolean
  outputId?: string
}

/** Mirrors host-owned execution state into the same slate the artist approved. */
export function reconcileXEditorialSlateOrder(
  workspaceRootPath: string,
  order: ScheduledWorkOrder,
): XEditorialSlateOrderReconcileResult {
  const definition = order.authorization?.definition
  if (!definition || !isXEditorialSocialAuthorizationDefinition(definition)) return { updated: false }

  const manifest = readOutputManifest(workspaceRootPath, definition.xEditorialRef.outputId)
  if (!manifest
    || manifest.workspaceId !== order.owner.workspaceId
    || !isXEditorialSlateOutput(manifest)) {
    return { updated: false, outputId: definition.xEditorialRef.outputId }
  }
  const asset = manifest.primary
    ?? (manifest.preview?.assetId ? manifest.assets.find((candidate) => candidate.id === manifest.preview?.assetId) : undefined)
  if (!asset || asset.mimeType !== 'application/json') return { updated: false, outputId: manifest.id }
  const assetPath = resolveOutputAssetPath(workspaceRootPath, manifest.id, asset.path)
  if (!assetPath) return { updated: false, outputId: manifest.id }
  const originalContent = readFileSync(assetPath, 'utf-8')
  const parsed = parseXEditorialSlate(originalContent)
  if (!parsed.ok || parsed.slate.slateId !== definition.xEditorialRef.slateId) {
    return { updated: false, outputId: manifest.id }
  }
  const candidate = parsed.slate.candidates.find((entry) => entry.id === definition.xEditorialRef.candidateId)
  if (!candidate
    || candidate.revision !== definition.xEditorialRef.revision
    || candidate.scheduledWorkId !== order.id) {
    return { updated: false, outputId: manifest.id }
  }

  const replacement = candidateForOrder(candidate, order)
  if (!replacement || JSON.stringify(replacement) === JSON.stringify(candidate)) {
    return { updated: false, outputId: manifest.id }
  }
  const nextSlate = {
    ...parsed.slate,
    candidates: parsed.slate.candidates.map((entry) => entry.id === replacement.id ? replacement : entry),
  }
  const validated = parseXEditorialSlate(nextSlate)
  if (!validated.ok) throw new Error(`Could not reconcile Daily X Slate: ${validated.error}`)

  const content = `${JSON.stringify(validated.slate, null, 2)}\n`
  const now = monotonicIsoAfter(manifest.updatedAt)
  const updatedAsset: OutputAsset = {
    ...asset,
    sizeBytes: Buffer.byteLength(content),
    sha256: createHash('sha256').update(content).digest('hex'),
  }
  const nextManifest: OutputManifest = {
    ...manifest,
    updatedAt: now,
    primary: manifest.primary?.id === updatedAsset.id ? updatedAsset : manifest.primary,
    assets: manifest.assets.map((entry) => entry.id === updatedAsset.id ? updatedAsset : entry),
    approval: slateApproval(validated.slate.candidates, now),
    receipts: replacement.receipt && !manifest.receipts.some((receipt) => receipt.id === replacement.receipt?.id)
      ? [...manifest.receipts, {
          id: replacement.receipt.id,
          provider: 'x',
          action: 'publish',
          status: 'succeeded',
          occurredAt: replacement.receipt.completedAt,
          externalId: replacement.receipt.id,
          url: replacement.receipt.externalUrl,
          displayText: replacement.receipt.summary,
        }]
      : manifest.receipts,
  }

  writeTextAtomically(assetPath, content)
  try {
    writeOutputManifest(workspaceRootPath, nextManifest)
  } catch (error) {
    writeTextAtomically(assetPath, originalContent)
    throw error
  }
  return { updated: true, outputId: manifest.id }
}

function candidateForOrder(
  candidate: XEditorialCandidate,
  order: ScheduledWorkOrder,
): XEditorialCandidate | null {
  if (order.status === 'done' && order.result?.type === 'social-publish') {
    return {
      ...candidate,
      status: 'posted',
      attentionMessage: undefined,
      receipt: {
        id: order.result.receipt.id,
        externalUrl: order.result.receipt.externalUrl,
        summary: order.result.receipt.summary ?? 'Published to X.',
        completedAt: order.result.receipt.completedAt,
      },
    }
  }
  if (order.status === 'needs-attention') {
    return {
      ...candidate,
      status: 'needs-attention',
      receipt: undefined,
      attentionMessage: order.attention?.message ?? 'This scheduled post needs attention.',
    }
  }
  if (order.status === 'canceled') {
    return {
      ...candidate,
      status: 'proposed',
      scheduledWorkId: undefined,
      calendarItemId: undefined,
      receipt: undefined,
      attentionMessage: undefined,
    }
  }
  if (order.status === 'needs-approval' || order.status === 'running') {
    return {
      ...candidate,
      status: 'scheduled',
      receipt: undefined,
      attentionMessage: undefined,
    }
  }
  return null
}

function slateApproval(candidates: XEditorialCandidate[], now: string): OutputManifest['approval'] {
  const proposed = candidates.filter((candidate) => candidate.status === 'proposed').length
  const decisions = candidates.filter((candidate) => candidate.status !== 'proposed' && candidate.status !== 'skipped').length
  return proposed > 0
    ? { state: 'pending', note: `${proposed} X post${proposed === 1 ? '' : 's'} still need review.`, updatedAt: now }
    : decisions > 0
      ? { state: 'approved', note: 'Every current X candidate has been decided.', updatedAt: now }
      : { state: 'none', note: 'Every current X candidate was skipped.', updatedAt: now }
}

function monotonicIsoAfter(previous: string): string {
  const previousMs = Date.parse(previous)
  return new Date(Math.max(Date.now(), Number.isFinite(previousMs) ? previousMs + 1 : 0)).toISOString()
}

function writeTextAtomically(path: string, content: string): void {
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`
  try {
    writeFileSync(tmp, content, 'utf-8')
    renameSync(tmp, path)
  } catch (error) {
    try { rmSync(tmp, { force: true }) } catch { /* best effort */ }
    throw error
  }
}
