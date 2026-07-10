export function socialLoginUrl(platform: string): string {
  if (platform === 'instagram') return 'https://www.instagram.com/'
  if (platform === 'tiktok') return 'https://www.tiktok.com/'
  if (platform === 'x') return 'https://x.com/'
  if (platform === 'youtube') return 'https://www.youtube.com/'
  if (platform === 'spotify') return 'https://artists.spotify.com/'
  return 'https://www.google.com/'
}

export function hasLoggedInSignal(platform: string, text: string, currentUrl: string): boolean {
  const lower = text.toLowerCase()
  const url = parseHttpUrl(currentUrl)
  const pathname = url?.pathname ?? ''
  if (platform === 'instagram') return url?.hostname === 'www.instagram.com' && /\/(direct|accounts\/edit|create)(?:[/?#]|$)/i.test(pathname) || /\b(home|messages|notifications|create|profile)\b/i.test(text)
  if (platform === 'x') return url?.hostname === 'x.com' && /\/(compose|home|messages|notifications|settings)(?:[/?#]|$)/i.test(pathname) || /\b(post|messages|notifications|premium)\b/i.test(text)
  if (platform === 'tiktok') return url?.hostname === 'www.tiktok.com' && /\/(upload|messages|setting|creator-center)(?:[/?#]|$)/i.test(pathname) || /\b(upload|messages|profile|following)\b/i.test(text)
  if (platform === 'youtube') return url?.hostname === 'www.youtube.com' && /\/(feed|account|channel|@|upload|studio)(?:[/?#]|$)/i.test(pathname) || lower.includes('create') || lower.includes('your channel')
  if (platform === 'spotify') {
    if (!url || !SPOTIFY_HOSTS.has(url.hostname)) return false
    return url.hostname === 'artists.spotify.com' && /^\/(c|home|music|audience|profile|roster)(?:[/?#]|$)/i.test(pathname)
      || url.hostname === 'open.spotify.com' && /^\/collection(?:[/?#]|$)/i.test(pathname)
      || lower.includes('log out') || lower.includes('account settings')
  }
  return false
}

export function isSocialPlatformUrl(platform: string, value: string): boolean {
  const url = parseHttpUrl(value)
  if (!url) return false
  if (platform === 'instagram') return url.hostname === 'instagram.com' || url.hostname === 'www.instagram.com'
  if (platform === 'tiktok') return url.hostname === 'tiktok.com' || url.hostname === 'www.tiktok.com'
  if (platform === 'x') return ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(url.hostname)
  if (platform === 'youtube') return url.hostname === 'youtube.com' || url.hostname === 'www.youtube.com'
  if (platform === 'spotify') return SPOTIFY_HOSTS.has(url.hostname)
  return false
}

const SPOTIFY_HOSTS = new Set(['spotify.com', 'www.spotify.com', 'open.spotify.com', 'artists.spotify.com', 'accounts.spotify.com'])

function parseHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null
  } catch {
    return null
  }
}
