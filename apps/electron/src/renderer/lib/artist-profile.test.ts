import { describe, expect, it } from 'bun:test'
import { parseArtistProfileDocResult, profileCompletion, serializeArtistProfileBody } from './artist-profile'
import type { ContextDocDTO } from '../../shared/types'

function doc(body: string): ContextDocDTO {
  return {
    id: 'artist-profile',
    slug: 'artist-profile',
    name: 'Artist Profile',
    body,
    metadata: {},
    path: '/tmp/context/artist-profile/CONTEXT.md',
    workspaceRootPath: '/tmp',
    updatedAt: '2026-07-05T00:00:00.000Z',
    status: 'active',
  } as unknown as ContextDocDTO
}

describe('artist-profile markdown intake parser', () => {
  it('accepts the starter markdown intake template without blocking save', () => {
    const result = parseArtistProfileDocResult(doc(`---
name: Artist Profile
description: Core identity, sound, and audience definition.
agents: all
---

This is the source-of-truth artist profile. Answer what you can; leave blanks for what you haven't figured out yet.

## Basics
- Artist name:
- Stage name (if different):
- Location / origin:
- Primary genre or lane:
- One-sentence sound description:
`))

    expect(result.ok).toBe(true)
    expect(result.profile.version).toBe(1)
    expect(profileCompletion(result.profile)).toBe(0)
  })

  it('maps filled markdown intake answers into the editable profile shape', () => {
    const result = parseArtistProfileDocResult(doc(`## Basics
- Artist name: Nova Saint
- Stage name (if different): Saint
- Location / origin: Nashville
- Primary genre or lane: Alternative R&B
- One-sentence sound description: Velvet vocals over blown-out drums.

## Identity
- 3 artists you actually sound like: SZA, James Blake
- 3 artists you want to be compared to: FKA twigs
- What emotional territory does your music live in? Night-drive longing.
- What do fans (or friends) say about your music? It feels expensive and lonely.
- One thing you refuse to be in your branding: Generic mysterious girl.
- A lyric, line, or idea that feels like "you": I haunt my own good news.

## Audience
- Who feels seen by this? (Psychographic, not demographic — e.g., "people who..."): People rebuilding after a hard exit.
- Where do they hang out online: TikTok, Tumblr, private group chats.
- What are they already fans of (music, shows, brands, subcultures)? A24, alt fashion, sad club playlists.

## References
- Visual references (films, fashion, photographers, eras, aesthetics): Latex black, hotel hallways, red light.
- Sonic references (producers, albums, textures, moods): Arca textures, heavy low end.
`))

    expect(result.ok).toBe(true)
    expect(result.profile.artistName).toBe('Nova Saint')
    expect(result.profile.aliases).toContain('Saint')
    expect(result.profile.aliases).toContain('Nashville')
    expect(result.profile.sound).toContain('Alternative R&B')
    expect(result.profile.visualWorld).toContain('Latex black')
    expect(result.profile.audience).toContain('People rebuilding')
    expect(result.profile.similarArtists).toContain('SZA')
    expect(result.profile.rules).toBe('Generic mysterious girl.')
  })

  it('round trips the Artist North Star and workspace-relative HQ banner reference', () => {
    const body = serializeArtistProfileBody({
      version: 1,
      artistName: 'Nova Saint',
      mission: 'Make outsiders feel understood through emotionally honest music.',
      bannerImagePath: 'assets/images/cover-art/hq-banner.webp',
      updatedAt: '2026-07-30T00:00:00.000Z',
    })

    const result = parseArtistProfileDocResult(doc(body))

    expect(result.ok).toBe(true)
    expect(result.profile.mission).toBe('Make outsiders feel understood through emotionally honest music.')
    expect(result.profile.bannerImagePath).toBe('assets/images/cover-art/hq-banner.webp')
  })
})
