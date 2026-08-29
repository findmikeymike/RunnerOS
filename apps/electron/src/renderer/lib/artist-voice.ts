/**
 * Renderer view of the Artist Voice context doc.
 * Schema and parsing live in `@craft-agent/shared/artist-context` so server-side
 * tools read and write the same format. This file only adapts the naming.
 */
import { artistVoiceDoc } from '@craft-agent/shared/artist-context'
import type { ContextDocDTO, ContextDocMetadata } from '../../shared/types'

export {
  ARTIST_VOICE_CONTEXT_SLUG,
  ARTIST_VOICE_TARGET_AGENT_SLUGS,
  type ArtistVoice,
} from '@craft-agent/shared/artist-context'
import type { ArtistVoice } from '@craft-agent/shared/artist-context'

export type ArtistVoiceParseResult =
  | { ok: true; voice: ArtistVoice }
  | { ok: false; voice: ArtistVoice; error: string }

export function artistVoiceMetadata(): ContextDocMetadata {
  return artistVoiceDoc.metadata()
}

export function emptyArtistVoice(): ArtistVoice {
  return artistVoiceDoc.empty()
}

export function parseArtistVoiceDocResult(doc: ContextDocDTO | undefined): ArtistVoiceParseResult {
  const result = artistVoiceDoc.parse(doc)
  return result.ok
    ? { ok: true, voice: result.value }
    : { ok: false, voice: result.value, error: result.error }
}

export function serializeArtistVoiceBody(voice: ArtistVoice): string {
  return artistVoiceDoc.serialize(voice)
}

export function voiceCompletion(voice: ArtistVoice): number {
  return artistVoiceDoc.completion(voice)
}
