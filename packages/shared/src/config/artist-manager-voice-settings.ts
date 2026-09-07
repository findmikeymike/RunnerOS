/** Non-secret, profile-level settings for conversation voice, separate from Command. */
export type ArtistManagerVoiceSettings = {
  version: 1
  connectionSlug: string | null
  model: string | null
  thinking: 'off' | 'low'
  style: 'sharp' | 'high-energy' | 'laid-back'
  sttSelection: string
}

export const ARTIST_MANAGER_VOICE_STT_SELECTIONS = [
  'moonshine-tiny-streaming-en',
  'moonshine-small-streaming-en',
  'moonshine-medium-streaming-en',
  'assembly_ai',
] as const

export const DEFAULT_ARTIST_MANAGER_VOICE_SETTINGS: Readonly<ArtistManagerVoiceSettings> = Object.freeze({
  version: 1, connectionSlug: null, model: null, thinking: 'low', style: 'sharp',
  sttSelection: 'moonshine-small-streaming-en',
})

const FIELDS = ['version', 'connectionSlug', 'model', 'thinking', 'style', 'sttSelection'] as const

/** Fail closed instead of silently repairing an invalid saved route or preference. */
export function parseArtistManagerVoiceSettings(value: unknown): ArtistManagerVoiceSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid conversation voice settings')
  const input = value as Record<string, unknown>
  if (Object.keys(input).length !== FIELDS.length || FIELDS.some(key => !Object.hasOwn(input, key))) {
    throw new Error('Conversation voice settings contain missing or unknown fields')
  }
  if (input.version !== 1) throw new Error('Unsupported conversation voice settings version')
  if (input.connectionSlug !== null && (typeof input.connectionSlug !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,99}$/.test(input.connectionSlug))) {
    throw new Error('Invalid conversation voice connection')
  }
  if (input.model !== null && (typeof input.model !== 'string' || !input.model.trim() || input.model !== input.model.trim() || input.model.length > 200 || /[\u0000-\u0020\u007f]/.test(input.model) || ['fast', 'default'].includes(input.model))) {
    throw new Error('Choose an exact conversation voice model')
  }
  if ((input.connectionSlug === null) !== (input.model === null)) throw new Error('Choose both a conversation voice connection and model, or clear both')
  if (input.thinking !== 'off' && input.thinking !== 'low') throw new Error('Invalid conversation voice reasoning level')
  if (!['sharp', 'high-energy', 'laid-back'].includes(input.style as string)) throw new Error('Invalid conversation voice style')
  if (!ARTIST_MANAGER_VOICE_STT_SELECTIONS.includes(input.sttSelection as typeof ARTIST_MANAGER_VOICE_STT_SELECTIONS[number])) throw new Error('Invalid conversation voice transcription model')
  return {
    version: 1, connectionSlug: input.connectionSlug as string | null, model: input.model as string | null,
    thinking: input.thinking, style: input.style as ArtistManagerVoiceSettings['style'], sttSelection: input.sttSelection as string,
  }
}
