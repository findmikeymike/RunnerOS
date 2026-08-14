/**
 * Classification of external URLs for `shell.openExternal`-style handlers.
 *
 * Only explicitly allowed schemes may be opened externally. Unknown custom
 * schemes can trigger arbitrary app handlers on the host OS, so keep this
 * surface narrow and route product deep links separately.
 */

export type UrlClassification =
  | { kind: 'dangerous'; reason: string }
  | { kind: 'internal-deeplink' }
  | { kind: 'safe-external' }

const SAFE_EXTERNAL_SCHEMES: ReadonlySet<string> = new Set([
  'http:',
  'https:',
  'mailto:',
  'tel:',
  'sms:',
])

// Treat every first-party product scheme as internal here. Product-specific
// routing performs the stricter current-product check; this shared browser-safe
// classifier only prevents either scheme from escaping to an OS handler.
const INTERNAL_DEEPLINK_SCHEMES: ReadonlySet<string> = new Set([
  'craftagents:',
  'artistos:',
])

export function classifyExternalUrl(rawUrl: string): UrlClassification {
  if (typeof rawUrl !== 'string' || rawUrl.trim() === '') {
    return { kind: 'dangerous', reason: 'empty URL' }
  }

  let parsed: URL
  try {
    parsed = new URL(rawUrl.trim())
  } catch {
    return { kind: 'dangerous', reason: 'malformed URL' }
  }

  const protocol = parsed.protocol.toLowerCase()

  if (INTERNAL_DEEPLINK_SCHEMES.has(protocol)) {
    return { kind: 'internal-deeplink' }
  }

  if (SAFE_EXTERNAL_SCHEMES.has(protocol)) {
    return { kind: 'safe-external' }
  }

  return { kind: 'dangerous', reason: `unsupported scheme "${protocol}"` }
}

export function isSafeExternalUrl(rawUrl: string): boolean {
  return classifyExternalUrl(rawUrl).kind === 'safe-external'
}
