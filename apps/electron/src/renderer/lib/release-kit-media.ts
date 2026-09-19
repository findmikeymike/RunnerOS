/** Stream original media without a thumbnail or data-URL size limit. */
export function releaseKitMediaUrl(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  if (/^[A-Za-z]:\//.test(normalized)) return `file:///${normalized.slice(0, 2)}/${normalized.slice(3).split('/').map(encodeURIComponent).join('/')}`
  if (!normalized.startsWith('/')) throw new Error('Media requires an absolute file path')
  return `file://${normalized.split('/').map(encodeURIComponent).join('/')}`
}
export function supportsReleaseKitSocialPost(category: string): boolean {
  return category === 'images' || category === 'artwork' || category === 'video'
}

/** Use the file type, never words in a document title or a Vault category. */
export function isReleaseKitAudioAsset(asset: { mimeType?: string; relativePath?: string; absolutePath?: string }): boolean {
  const mime = asset.mimeType?.split(';')[0]?.trim().toLowerCase()
  if (mime && mime !== 'application/octet-stream') return mime.startsWith('audio/')
  return /\.(wav|wave|aif|aiff|flac|mp3|m4a|aac|ogg|oga|opus)$/i.test(asset.relativePath ?? asset.absolutePath ?? '')
}

/** Compatibility for the existing audio player. */
export const releaseKitAudioUrl = releaseKitMediaUrl
