export function isConciergeSessionLike(input: {
  conciergeSlug: string
  spawnedFromAgent?: { agentSlug?: string; agentName?: string }
  launchReceipt?: {
    origin?: string
    summary?: string
    agent?: { slug?: string; name?: string }
    routing?: { mode?: string }
  }
  name?: string
}) {
  const agentSlug = input.spawnedFromAgent?.agentSlug || input.launchReceipt?.agent?.slug
  if (agentSlug === input.conciergeSlug) return true
  if (input.launchReceipt?.origin === 'concierge') return true
  if (input.launchReceipt?.routing?.mode === 'concierge') return true

  const searchable = [
    input.spawnedFromAgent?.agentName,
    input.launchReceipt?.agent?.name,
    input.launchReceipt?.summary,
    input.name,
  ].filter(Boolean).join(' ').toLowerCase()

  return /\b(hnic|concierge)\b/.test(searchable)
}

export function getArtistHqNavActiveState(input: {
  isArtistHQWorkspace: boolean
  isSessionsNavigation: boolean
  artistHqHash: string
  hasSessionRoute: boolean
  isConciergeChat: boolean
}) {
  const artistHqTabActive = input.isArtistHQWorkspace && input.artistHqHash.startsWith('#artist-hq/')
  const hqHomeActive = input.isArtistHQWorkspace
    && input.isSessionsNavigation
    && !input.isConciergeChat
    && (
      input.artistHqHash === '#artist-hq/home'
      || (!artistHqTabActive && !input.hasSessionRoute && !input.isConciergeChat)
    )
  const hqSessionsActive = input.isArtistHQWorkspace
    && input.isSessionsNavigation
    && !input.isConciergeChat
    && !hqHomeActive
    && !artistHqTabActive

  return {
    artistHqTabActive,
    hqHomeActive,
    hqSessionsActive,
  }
}
