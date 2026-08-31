import type { ReleaseKitItem } from '@craft-agent/shared/release-kit'

/**
 * A Release Kit item is approved canon only while its bytes still match the SHA-256
 * recorded at promotion. `needs-review` means that check failed and `missing` means the
 * snapshot is gone, so neither may read as trustworthy in any surface that offers the
 * asset for use, agent hand-off, or scheduling.
 */
export function isUnverifiedReleaseKitItem(item: Pick<ReleaseKitItem, 'status'>): boolean {
  return item.status !== 'ready'
}

/**
 * The Primary marker means "this is the approved one to use". An unverified file has
 * failed its integrity check, so it must never wear that marker regardless of the
 * `isPrimary` flag stored in the manifest.
 */
export function shouldShowPrimaryBadge(item: Pick<ReleaseKitItem, 'status' | 'isPrimary'>): boolean {
  return Boolean(item.isPrimary) && !isUnverifiedReleaseKitItem(item)
}

/**
 * Choose the item for a category's hero slot.
 *
 * Verified items win, preferring the Primary among them. A drifted item is still shown
 * when it is the only candidate — silently hiding an asset the user promoted would be
 * worse than surfacing it with a warning — but it never displaces a verified item.
 */
export function featuredReleaseKitItem<T extends Pick<ReleaseKitItem, 'status' | 'isPrimary'>>(
  items: T[],
): T | undefined {
  const verified = items.filter((item) => !isUnverifiedReleaseKitItem(item))
  return verified.find((item) => item.isPrimary)
    ?? verified[0]
    ?? items.find((item) => item.isPrimary)
    ?? items[0]
}

/** Amber ring applied to unverified cards so drift is visible without opening the item. */
export function releaseKitStatusRingClass(item: Pick<ReleaseKitItem, 'status'>): string {
  return isUnverifiedReleaseKitItem(item)
    ? 'border-amber-400/45 ring-1 ring-amber-400/25'
    : 'border-white/[0.08]'
}

/** User-facing label for a non-ready item. */
export function releaseKitStatusLabel(item: Pick<ReleaseKitItem, 'status'>): string {
  return item.status === 'missing' ? 'File missing' : 'Needs review'
}

/** Plain-language explanation of why the item is not usable as approved canon. */
export function releaseKitStatusExplanation(item: Pick<ReleaseKitItem, 'status'>): string {
  return item.status === 'missing'
    ? 'The approved snapshot file is missing from disk. Re-add it before using this asset.'
    : 'This file no longer matches the hash approved at promotion. Verify it before using this asset.'
}
