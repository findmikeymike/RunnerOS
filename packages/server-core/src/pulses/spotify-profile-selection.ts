/** Pure selection: saved identity is a prerequisite, never proof of a live login. */
export function selectSpotifyPulseProfile(catalog: unknown): string {
  const rows = catalog && typeof catalog === 'object' && 'profiles' in catalog
    ? (catalog as { profiles?: unknown }).profiles : undefined
  const profiles = new Set<string>()
  if (Array.isArray(rows)) {
    for (const row of rows) {
      if (!row || typeof row !== 'object' || row.platform !== 'spotify'
        || typeof row.profile !== 'string' || !row.profile.trim()
        || typeof row.accountUrl !== 'string') continue
      try {
        const url = new URL(row.accountUrl)
        if (url.protocol !== 'https:' || url.hostname !== 'open.spotify.com'
          || url.username || url.password || url.port
          || !/^\/(?:user\/[^/]+|artist\/[A-Za-z0-9]{22})\/?$/.test(url.pathname)) continue
        profiles.add(row.profile.trim())
      } catch { /* Invalid saved URLs cannot select an account. */ }
    }
  }
  if (profiles.size === 0) throw new Error('Connect and verify a Spotify account in Settings → Spotify before running Spotify Pulse.')
  if (profiles.size > 1) throw new Error('Multiple saved Spotify profiles are available. Choose the intended Spotify profile before running Spotify Pulse.')
  return [...profiles][0]!
}

function artistIds(text: string | undefined): Set<string> {
  const ids = new Set<string>()
  if (!text) return ids
  for (const match of text.matchAll(/(?:^|[\s(<])spotify:artist:([A-Za-z0-9]{22})(?=$|[\s)>.,;])/g)) ids.add(match[1]!)
  for (const match of text.matchAll(/https?:\/\/[^\s<>"'`()]+/g)) {
    try {
      const url = new URL(match[0].replace(/[.,;]+$/, ''))
      if (url.protocol !== 'https:' || url.hostname !== 'open.spotify.com' || url.username || url.password || url.port) continue
      const id = url.pathname.match(/^\/artist\/([A-Za-z0-9]{22})\/?$/)?.[1]
      if (id) ids.add(id)
    } catch { /* Ignore unrelated or malformed social links. */ }
  }
  return ids
}

export function spotifyArtistIdFromProfile(profile: { spotifyProfile?: string; socialLinks?: string }): string {
  const primary = artistIds(profile.spotifyProfile)
  const ids = primary.size ? primary : artistIds(profile.socialLinks)
  if (ids.size > 1) throw new Error('Artist Profile contains multiple Spotify artists. Set one exact artist URL in the Spotify artist field before running Spotify Pulse.')
  if (ids.size === 0) throw new Error('Add the artist’s Spotify artist URL to Artist HQ Profile before running Spotify Pulse.')
  return [...ids][0]!
}
