/**
 * Renderer view of the Artist Profile context doc.
 * Schema, markdown-intake recovery, and parsing live in
 * `@craft-agent/shared/artist-context` so server-side tools read and write the
 * same format. This file only adapts the naming.
 */
import { artistProfileDoc } from '@craft-agent/shared/artist-context'
import type { ContextDocDTO, ContextDocMetadata } from '../../shared/types'

export {
  ARTIST_PROFILE_CONTEXT_SLUG,
  type ArtistProfile,
} from '@craft-agent/shared/artist-context'
import type { ArtistProfile } from '@craft-agent/shared/artist-context'

export type ArtistProfileParseResult =
  | { ok: true; profile: ArtistProfile }
  | { ok: false; profile: ArtistProfile; error: string }

export function artistProfileMetadata(): ContextDocMetadata {
  return artistProfileDoc.metadata()
}

export function emptyArtistProfile(): ArtistProfile {
  return artistProfileDoc.empty()
}

export function parseArtistProfileDocResult(doc: ContextDocDTO | undefined): ArtistProfileParseResult {
  const result = artistProfileDoc.parse(doc)
  return result.ok
    ? { ok: true, profile: result.value }
    : { ok: false, profile: result.value, error: result.error }
}

export function serializeArtistProfileBody(profile: ArtistProfile): string {
  return artistProfileDoc.serialize(profile)
}

export function profileCompletion(profile: ArtistProfile): number {
  return artistProfileDoc.completion(profile)
}
