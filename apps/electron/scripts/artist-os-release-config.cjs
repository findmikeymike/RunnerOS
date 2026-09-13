const { isIP } = require('node:net')

const LEGACY_PRIVATE_GITHUB_FEED = 'https://github.com/findmikeymike/ArtistOS/releases/latest/download'

function isPrivateIpv4(hostname) {
  const parts = hostname.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false
  const [a, b] = parts
  return (
    a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || a >= 224
  )
}

function isPrivateIpv6(hostname) {
  const normalized = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  return (
    normalized === '::'
    || normalized === '::1'
    || normalized.startsWith('fc')
    || normalized.startsWith('fd')
    || /^fe[89ab]/.test(normalized)
  )
}

function assertPublicArtistOsUpdateUrl(rawValue) {
  const value = typeof rawValue === 'string' ? rawValue.trim() : ''
  if (!value) {
    throw new Error('ARTIST_OS_UPDATE_URL is required for Artist OS packaging')
  }

  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error('ARTIST_OS_UPDATE_URL must be a valid public HTTPS URL')
  }

  if (url.protocol !== 'https:') {
    throw new Error('ARTIST_OS_UPDATE_URL must use HTTPS')
  }
  if (url.username || url.password) {
    throw new Error('ARTIST_OS_UPDATE_URL must not contain credentials')
  }
  if (url.search || url.hash) {
    throw new Error('ARTIST_OS_UPDATE_URL must not contain a query string or fragment')
  }

  const hostname = url.hostname.toLowerCase()
  const addressFamily = isIP(hostname.replace(/^\[|\]$/g, ''))
  const reservedHostname = (
    hostname === 'localhost'
    || (addressFamily === 0 && !hostname.includes('.'))
    || hostname.endsWith('.localhost')
    || hostname.endsWith('.local')
    || hostname.endsWith('.internal')
    || hostname.endsWith('.test')
    || hostname.endsWith('.example')
  )
  if (
    reservedHostname
    || (addressFamily === 4 && isPrivateIpv4(hostname))
    || (addressFamily === 6 && isPrivateIpv6(hostname))
  ) {
    throw new Error('ARTIST_OS_UPDATE_URL must use a publicly routable host')
  }

  const normalized = url.toString().replace(/\/$/, '')
  if (normalized.toLowerCase() === LEGACY_PRIVATE_GITHUB_FEED.toLowerCase()) {
    throw new Error('ARTIST_OS_UPDATE_URL still points at the unavailable private GitHub release feed')
  }

  return normalized
}

module.exports = {
  LEGACY_PRIVATE_GITHUB_FEED,
  assertPublicArtistOsUpdateUrl,
}
