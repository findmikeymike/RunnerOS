import type { ScheduledWorkOrder } from '@craft-agent/shared/scheduled-work'

const SAME_SLOT_MS = 60_000
const DUPLICATE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

export interface ArtistSocialWorkEntry {
  workspaceId: string
  workspaceName?: string
  order: ScheduledWorkOrder
}

export type ArtistSocialConflictKind = 'time-slot' | 'copy' | 'asset'

export interface ArtistSocialConflict {
  kind: ArtistSocialConflictKind
  existing: ArtistSocialWorkEntry
}

export function findArtistSocialPublishConflicts(
  proposed: ArtistSocialWorkEntry,
  entries: ArtistSocialWorkEntry[],
): ArtistSocialConflict[] {
  if (proposed.order.execution.type !== 'social-publish'
    || proposed.order.deletedAt
    || !isConflictRelevant(proposed.order)) return []

  const proposedAt = Date.parse(proposed.order.startAt)
  if (!Number.isFinite(proposedAt)) throw new Error('Social publish time is invalid.')
  const proposedCopy = normalizeSocialCopy(proposed.order.execution.caption)
  const proposedAssets = socialAssetKeys(proposed.order)
  const conflicts: ArtistSocialConflict[] = []

  for (const existing of entries) {
    if (sameOrder(existing, proposed)
      || existing.order.deletedAt
      || !isConflictRelevant(existing.order)
      || existing.order.execution.type !== 'social-publish'
      || !sameDestination(existing.order, proposed.order)) continue

    const existingAt = Date.parse(existing.order.startAt)
    if (!Number.isFinite(existingAt)) continue
    const distance = Math.abs(existingAt - proposedAt)
    if (distance < SAME_SLOT_MS) {
      conflicts.push({ kind: 'time-slot', existing })
      continue
    }
    if (distance > DUPLICATE_WINDOW_MS) continue
    if (proposedCopy && normalizeSocialCopy(existing.order.execution.caption) === proposedCopy) {
      conflicts.push({ kind: 'copy', existing })
      continue
    }
    if (proposedAssets.size > 0 && setsOverlap(proposedAssets, socialAssetKeys(existing.order))) {
      conflicts.push({ kind: 'asset', existing })
    }
  }
  return conflicts
}

function isConflictRelevant(order: ScheduledWorkOrder): boolean {
  return order.status === 'scheduled'
    || order.status === 'needs-approval'
    || order.status === 'running'
    || order.status === 'done'
    || order.status === 'needs-attention'
}

export function assertNoArtistSocialScheduleConflict(
  proposed: ArtistSocialWorkEntry,
  entries: ArtistSocialWorkEntry[],
): void {
  const conflict = findArtistSocialPublishConflicts(proposed, entries)[0]
  if (conflict) throw new Error(conflictMessage(conflict))
}

/**
 * Old/stale duplicate schedules can predate the schedule-time guard. At run
 * time, only the earliest-created duplicate may proceed. Any duplicate that
 * is running or may already have published blocks execution regardless of age.
 */
export function assertArtistSocialPublishMayExecute(
  current: ArtistSocialWorkEntry,
  entries: ArtistSocialWorkEntry[],
): void {
  for (const conflict of findArtistSocialPublishConflicts(current, entries)) {
    const existingMayAlreadyHavePublished = conflict.existing.order.status === 'running'
      || conflict.existing.order.status === 'done'
      || conflict.existing.order.result?.type === 'social-publish'
      || conflict.existing.order.runs.some((run) => Boolean(run.externalReceipt))
    if (existingMayAlreadyHavePublished || compareEntryPrecedence(conflict.existing, current) <= 0) {
      throw new Error(`Publish blocked: ${conflictMessage(conflict)}`)
    }
  }
}

function sameOrder(left: ArtistSocialWorkEntry, right: ArtistSocialWorkEntry): boolean {
  return left.workspaceId === right.workspaceId && left.order.id === right.order.id
}

function sameDestination(left: ScheduledWorkOrder, right: ScheduledWorkOrder): boolean {
  if (left.execution.type !== 'social-publish' || right.execution.type !== 'social-publish') return false
  return normalizePart(left.execution.platform) === normalizePart(right.execution.platform)
    && normalizePart(left.execution.profileId) === normalizePart(right.execution.profileId)
}

function socialAssetKeys(order: ScheduledWorkOrder): Set<string> {
  const keys = new Set<string>()
  for (const ref of order.inputRefs) {
    if (ref.kind === 'release-kit') keys.add(`sha256:${normalizePart(ref.sha256)}`)
    else if (ref.kind === 'final') keys.add(`final:${ref.outputId}:${ref.assetId ?? ''}`)
    else if (ref.kind === 'output') keys.add(`output:${ref.outputId}`)
    else if (ref.kind === 'vault') keys.add(`vault:${ref.assetId}`)
    else if (ref.kind === 'produced-output' && ref.resolution) keys.add(`output:${ref.resolution.outputId}`)
  }
  return keys
}

function setsOverlap(left: Set<string>, right: Set<string>): boolean {
  for (const value of left) if (right.has(value)) return true
  return false
}

function normalizeSocialCopy(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/g, ' ').trim()
}

function normalizePart(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en-US').trim()
}

function compareEntryPrecedence(left: ArtistSocialWorkEntry, right: ArtistSocialWorkEntry): number {
  const leftCreated = Date.parse(left.order.createdAt)
  const rightCreated = Date.parse(right.order.createdAt)
  const created = (Number.isFinite(leftCreated) ? leftCreated : Number.MAX_SAFE_INTEGER)
    - (Number.isFinite(rightCreated) ? rightCreated : Number.MAX_SAFE_INTEGER)
  return created
    || left.workspaceId.localeCompare(right.workspaceId)
    || left.order.id.localeCompare(right.order.id)
}

function conflictMessage(conflict: ArtistSocialConflict): string {
  const source = conflict.existing.workspaceName?.trim()
    || (conflict.existing.order.owner.scope === 'hq' ? 'Artist HQ' : 'another campaign')
  if (conflict.kind === 'time-slot') {
    return `Another post for this account is already scheduled in this time slot (the same minute) from ${source}. Choose a different time.`
  }
  if (conflict.kind === 'asset') {
    return `This approved asset is already scheduled or was posted from ${source} within seven days.`
  }
  const platform = conflict.existing.order.execution.type === 'social-publish'
    ? conflict.existing.order.execution.platform.trim().toLocaleLowerCase('en-US')
    : ''
  return `This exact${platform === 'x' ? ' X' : ''} post is already scheduled or was posted from ${source} within seven days.`
}

let artistSocialScheduleQueue: Promise<void> = Promise.resolve()

export function withArtistSocialScheduleLock<T>(fn: () => Promise<T> | T): Promise<T> {
  const run = artistSocialScheduleQueue.then(fn, fn)
  artistSocialScheduleQueue = run.then(() => undefined, () => undefined)
  return run
}
