/**
 * Renderer view of the Artist Branding context doc.
 * Schema and parsing live in `@craft-agent/shared/artist-context` so server-side
 * tools read and write the same format. This file only adapts the naming.
 */
import { artistBrandingDoc } from '@craft-agent/shared/artist-context'
import type { ContextDocDTO, ContextDocMetadata } from '../../shared/types'

export {
  ARTIST_BRANDING_CONTEXT_SLUG,
  type ArtistBranding,
} from '@craft-agent/shared/artist-context'
import type { ArtistBranding } from '@craft-agent/shared/artist-context'

export type ArtistBrandingParseResult =
  | { ok: true; branding: ArtistBranding }
  | { ok: false; branding: ArtistBranding; error: string }

export function artistBrandingMetadata(): ContextDocMetadata {
  return artistBrandingDoc.metadata()
}

export function emptyArtistBranding(): ArtistBranding {
  return artistBrandingDoc.empty()
}

export function parseArtistBrandingDocResult(doc: ContextDocDTO | undefined): ArtistBrandingParseResult {
  const result = artistBrandingDoc.parse(doc)
  return result.ok
    ? { ok: true, branding: result.value }
    : { ok: false, branding: result.value, error: result.error }
}

export function serializeArtistBrandingBody(branding: ArtistBranding): string {
  return artistBrandingDoc.serialize(branding)
}

export function brandingCompletion(branding: ArtistBranding): number {
  return artistBrandingDoc.completion(branding)
}
