export type SpotifyLoginSurface = 'artists' | 'web-player' | 'ads-manager'

const SPOTIFY_ARTISTS_URL = 'https://artists.spotify.com/'
const SPOTIFY_WEB_PLAYER_URL = 'https://open.spotify.com/collection/playlists'
const SPOTIFY_ADS_MANAGER_URL = 'https://adsmanager.spotify.com/campaigns'

export function socialLoginUrl(platform: string, spotifySurface: SpotifyLoginSurface = 'artists'): string {
  if (platform === 'instagram') return 'https://www.instagram.com/'
  if (platform === 'tiktok') return 'https://www.tiktok.com/'
  if (platform === 'x') return 'https://x.com/'
  if (platform === 'youtube') return 'https://www.youtube.com/'
  if (platform === 'spotify') {
    if (spotifySurface === 'web-player') return SPOTIFY_WEB_PLAYER_URL
    if (spotifySurface === 'ads-manager') return SPOTIFY_ADS_MANAGER_URL
    return SPOTIFY_ARTISTS_URL
  }
  return 'https://www.google.com/'
}

export function findSpotifyUserAccountUrl(links: readonly string[]): string | null {
  for (const value of links) {
    try {
      const url = new URL(value)
      if (url.protocol !== 'https:' || url.hostname !== 'open.spotify.com') continue
      const match = url.pathname.match(/^\/user\/([^/?#]+)\/?$/i)
      if (!match?.[1]) continue
      return `https://open.spotify.com/user/${match[1]}`
    } catch {
      // Ignore malformed and non-URL hrefs.
    }
  }
  return null
}

export function findSpotifyAdsManagerAccountId(values: {
  currentUrl?: string
  links?: readonly string[]
  text?: string
}): string | null {
  const urls = [values.currentUrl, ...(values.links ?? [])].filter((value): value is string => Boolean(value))
  for (const value of urls) {
    try {
      const url = new URL(value)
      if (!['adsmanager.spotify.com', 'adstudio.spotify.com'].includes(url.hostname)) continue
      for (const key of ['adAccountId', 'ad_account_id', 'accountId', 'account_id', 'advertiserId', 'advertiser_id']) {
        const candidate = normalizeSpotifyAdsAccountId(url.searchParams.get(key))
        if (candidate) return candidate
      }
      const pathMatch = url.pathname.match(/\/(?:ad-?accounts?|accounts?|advertisers?)\/([^/?#]+)/i)
      const candidate = normalizeSpotifyAdsAccountId(pathMatch?.[1])
      if (candidate) return candidate
    } catch {
      // Ignore malformed and non-URL values.
    }
  }

  const textMatch = String(values.text || '').match(/\b(?:ad account|advertiser)\s*(?:id)?\s*[:#]\s*([a-z0-9][a-z0-9_-]{3,127})\b/i)
  return normalizeSpotifyAdsAccountId(textMatch?.[1])
}

function normalizeSpotifyAdsAccountId(value: string | null | undefined): string | null {
  const candidate = String(value || '').trim()
  return /^[a-z0-9][a-z0-9_-]{3,127}$/i.test(candidate) ? candidate : null
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
    // Spotify briefly renders /home before redirecting unauthenticated users
    // to accounts.spotify.com. Only the private /c workspace is durable proof
    // that Spotify for Artists authentication completed.
    return url.hostname === 'artists.spotify.com' && /^\/c(?:[/?#]|$)/i.test(pathname)
      || url.hostname === 'open.spotify.com' && /^\/collection(?:[/?#]|$)/i.test(pathname)
      || url.hostname === 'adsmanager.spotify.com' && /^\/(campaigns|dashboard|advertiser)(?:[/?#]|$)/i.test(pathname)
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

const SPOTIFY_HOSTS = new Set(['spotify.com', 'www.spotify.com', 'open.spotify.com', 'artists.spotify.com', 'accounts.spotify.com', 'adstudio.spotify.com', 'adsmanager.spotify.com'])

function parseHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null
  } catch {
    return null
  }
}
