import type { ReleaseKitItem } from './types.ts'

export function releaseKitSocialUseRestriction(item: ReleaseKitItem): string | undefined {
  if (item.status !== 'ready') return 'Release Kit item is not ready for social publishing.'
  if (item.usage.restrictions.blockedFromUse) return 'This final is blocked from use.'
  if (item.usage.restrictions.needsRightsClearance) return 'This final still needs rights clearance.'
  if (item.usage.restrictions.artistLikenessRestricted) return 'This final has an artist-likeness restriction.'
  return undefined
}

export function assertReleaseKitSocialUseAllowed(item: ReleaseKitItem): void {
  const restriction = releaseKitSocialUseRestriction(item)
  if (restriction) throw new Error(restriction)
}
