import type { ContextDocDTO, ContextDocMetadata } from '../../shared/types'

export const ARTIST_PROFILE_CONTEXT_SLUG = 'artist-profile'

export interface ArtistProfile {
  version: 1
  artistName?: string
  mission?: string
  aliases?: string
  bio?: string
  themes?: string
  sound?: string
  visualWorld?: string
  bannerImagePath?: string
  brandWords?: string
  audience?: string
  similarArtists?: string
  priorityMarkets?: string
  socialLinks?: string
  spotifyProfile?: string
  team?: string
  promoBudget?: string
  rules?: string
  updatedAt: string
}

export type ArtistProfileParseResult =
  | { ok: true; profile: ArtistProfile }
  | { ok: false; profile: ArtistProfile; error: string }

export function artistProfileMetadata(): ContextDocMetadata {
  return {
    name: 'Artist Profile',
    description: 'Global artist identity, audience, brand, music, and operating context for workers.',
    routing: { mode: 'broadcast' },
    enabled: true,
  }
}

export function emptyArtistProfile(): ArtistProfile {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
  }
}

export function parseArtistProfileDocResult(doc: ContextDocDTO | undefined): ArtistProfileParseResult {
  if (!doc?.body.trim()) return { ok: true, profile: emptyArtistProfile() }
  const json = extractJson(doc.body)
  if (!json) {
    const markdownProfile = parseMarkdownProfileIntake(doc.body)
    if (markdownProfile) {
      return {
        ok: true,
        profile: normalizeProfile(markdownProfile),
      }
    }
    return {
      ok: false,
      profile: emptyArtistProfile(),
      error: 'Artist Profile exists, but no JSON block could be read.',
    }
  }
  try {
    const parsed = JSON.parse(json) as Partial<ArtistProfile>
    if (parsed.version !== 1) {
      return {
        ok: false,
        profile: emptyArtistProfile(),
        error: 'Artist Profile JSON has an unsupported shape.',
      }
    }
    return {
      ok: true,
      profile: normalizeProfile(parsed),
    }
  } catch {
    return {
      ok: false,
      profile: emptyArtistProfile(),
      error: 'Artist Profile JSON is malformed.',
    }
  }
}

export function serializeArtistProfileBody(profile: ArtistProfile): string {
  const normalized = normalizeProfile(profile)
  return [
    'This is global artist profile context. Treat it as long-term creator context, not one-campaign context.',
    '',
    '```json',
    JSON.stringify(normalized, null, 2),
    '```',
  ].join('\n')
}

export function profileCompletion(profile: ArtistProfile): number {
  const fields: Array<keyof ArtistProfile> = [
    'artistName',
    'mission',
    'bio',
    'themes',
    'sound',
    'visualWorld',
    'brandWords',
    'audience',
    'similarArtists',
    'priorityMarkets',
    'socialLinks',
    'spotifyProfile',
    'promoBudget',
    'rules',
  ]
  const filled = fields.filter((field) => Boolean(clean(profile[field]))).length
  return Math.round((filled / fields.length) * 100)
}

function normalizeProfile(profile: Partial<ArtistProfile>): ArtistProfile {
  return {
    version: 1,
    artistName: clean(profile.artistName),
    mission: clean(profile.mission),
    aliases: clean(profile.aliases),
    bio: clean(profile.bio),
    themes: clean(profile.themes),
    sound: clean(profile.sound),
    visualWorld: clean(profile.visualWorld),
    bannerImagePath: clean(profile.bannerImagePath),
    brandWords: clean(profile.brandWords),
    audience: clean(profile.audience),
    similarArtists: clean(profile.similarArtists),
    priorityMarkets: clean(profile.priorityMarkets),
    socialLinks: clean(profile.socialLinks),
    spotifyProfile: clean(profile.spotifyProfile),
    team: clean(profile.team),
    promoBudget: clean(profile.promoBudget),
    rules: clean(profile.rules),
    updatedAt: new Date().toISOString(),
  }
}

function extractJson(body: string): string | null {
  const fenced = body.match(/```json\s*([\s\S]*?)```/i)
  if (fenced?.[1]) return fenced[1]
  const firstBrace = body.indexOf('{')
  const lastBrace = body.lastIndexOf('}')
  if (firstBrace === -1 || lastBrace <= firstBrace) return null
  return body.slice(firstBrace, lastBrace + 1)
}

function parseMarkdownProfileIntake(body: string): Partial<ArtistProfile> | null {
  if (!body.includes('## Basics') || !body.includes('- Artist name:')) {
    return null
  }

  const field = (label: string) => extractMarkdownField(body, label)
  const combined = (...values: Array<string | undefined>) => values.filter(Boolean).join('\n')

  return {
    version: 1,
    artistName: field('Artist name'),
    aliases: combined(field('Stage name (if different)'), field('Location / origin')),
    bio: combined(
      field('What do fans (or friends) say about your music'),
      field('A lyric, line, or idea that feels like "you"'),
      field('Recent releases, demos, or works in progress'),
      field("What's already been tried (content, ads, playlisting, shows)"),
      field('Anything else the HQ brain should know before making worker recommendations'),
    ),
    themes: combined(
      field('What emotional territory does your music live in'),
      field('What are you actively promoting right now'),
      field("What's your next 60-day goal"),
      field('Cultural references (cities, subcultures, movements, moments)'),
    ),
    sound: combined(
      field('Primary genre or lane'),
      field('One-sentence sound description'),
      field('Sonic references (producers, albums, textures, moods)'),
    ),
    visualWorld: field('Visual references (films, fashion, photographers, eras, aesthetics)'),
    audience: combined(
      field('Who feels seen by this? (Psychographic, not demographic — e.g., "people who...")'),
      field('Where do they hang out online'),
      field('What are they already fans of (music, shows, brands, subcultures)'),
    ),
    similarArtists: combined(
      field('3 artists you actually sound like'),
      field('3 artists you want to be compared to'),
    ),
    socialLinks: combined(
      field('Social handles and current follower counts (if known)'),
      field('Link to best existing content (song, video, post)'),
    ),
    rules: field('One thing you refuse to be in your branding'),
  }
}

function extractMarkdownField(body: string, label: string): string | undefined {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = body.match(new RegExp(`^-\\s*${escaped}:[ \\t]*(.*)$`, 'im'))
  return clean(match?.[1])
}

function clean(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
  return trimmed || undefined
}
