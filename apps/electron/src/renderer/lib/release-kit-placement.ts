import type { ReleaseKitCategory } from '@craft-agent/shared/release-kit'

const DEFAULT_TYPES: Record<ReleaseKitCategory, string> = {
  audio: 'master', artwork: 'cover-art', video: 'final-video', images: 'social-image',
  copy: 'campaign-copy', plans: 'marketing-plan', merch: 'design', documents: 'final-document', references: 'reference',
}

/** Image files can serve as cover art or social imagery; other media retain their inferred category. */
export function releaseKitPlacement(suggested: { category: ReleaseKitCategory; subtype: string }, intended?: ReleaseKitCategory | null) {
  const isImageCategory = (category: ReleaseKitCategory | null | undefined) => category === 'images' || category === 'artwork'
  return intended && intended !== suggested.category && isImageCategory(intended) && isImageCategory(suggested.category)
    ? { category: intended, subtype: DEFAULT_TYPES[intended] }
    : suggested
}

/** Keep a hand-written type; replace only the automatically supplied type. */
export function releaseKitTypeForCategory(category: ReleaseKitCategory, current: string, customized: boolean): string {
  return customized ? current : DEFAULT_TYPES[category]
}
