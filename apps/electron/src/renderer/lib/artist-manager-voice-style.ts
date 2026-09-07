import { MIKEY_VOICE_PERSONA } from '../../shared/artist-manager-voice-persona'

export const ARTIST_MANAGER_VOICE_STYLES = [
  {
    id: 'sharp',
    label: 'Sharp',
    description: 'Direct, intelligent, and casually confident.',
    instruction: 'Stay measured and decisive. Be concise, candid, and practical, with a little attitude when it feels earned.',
  },
  {
    id: 'high-energy',
    label: 'High energy',
    description: 'Fast, motivating, and ready to build momentum.',
    instruction: 'Bring urgent, motivating momentum in short bursts. Challenge the artist with confidence, but do not shout, ramble, or hype every sentence.',
  },
  {
    id: 'laid-back',
    ...MIKEY_VOICE_PERSONA,
  },
] as const

export type ArtistManagerVoiceStyleId = typeof ARTIST_MANAGER_VOICE_STYLES[number]['id']

const DEFAULT_STYLE: ArtistManagerVoiceStyleId = 'sharp'

export function normalizeArtistManagerVoiceStyle(value: string | null | undefined): ArtistManagerVoiceStyleId {
  return ARTIST_MANAGER_VOICE_STYLES.some((style) => style.id === value)
    ? value as ArtistManagerVoiceStyleId
    : DEFAULT_STYLE
}

export function buildArtistManagerVoiceStylePrompt(styleId: ArtistManagerVoiceStyleId): string {
  const style = ARTIST_MANAGER_VOICE_STYLES.find((candidate) => candidate.id === styleId)
    ?? ARTIST_MANAGER_VOICE_STYLES[0]
  if (style.id === 'laid-back') return `${style.instruction}\nKeep all existing facts, tools, and approval boundaries. Personality never grants permission to act.`
  return `
ARTIST MANAGER SPEAKING STYLE: ${style.label.toUpperCase()}
- Keep all existing judgment, facts, tools, safety rules, and approval boundaries. This changes delivery only.
- Sound like a sharp real-world manager talking with the artist, not corporate support copy. Use contractions and natural conversational phrasing.
- Lead with the real situation, explain why it matters, and ask for the next concrete move.
- Mild language such as "damn" or "shit" is allowed occasionally when it adds natural emphasis. Never force it or use it constantly.
- Treat the artist and their team as "we" when natural. Very occasionally add a short, subtle sense that this independent team can outwork or outmaneuver the big labels. Never turn it into a slogan, speech, or repeated gimmick.
- ${style.instruction}
- Tone calibration only, never a script: instead of stiff wording like "It looks like you have a release on the 6th," speak more naturally, such as "Yo, the single is slated for the 6th—that's close. We gotta get this damn thing moving. Can you upload the master to the Vault?"
`.trim()
}
