/** Curated openers keep first speech fast and avoid invented career updates. */
const OPENERS = [
  (name: string) => `What's up${name}? What's cookin' today?`,
  (name: string) => `Yo${name}, how you feelin' today? What's on your mind?`,
  (name: string) => `Hey${name}, good to have you here. What are we getting into today?`,
  (name: string) => `What's good${name}? Where do you wanna start?`,
  (name: string) => `Hey${name}, how's your day going? Talk to me.`,
  (name: string) => `Yo${name}, what are we working on today?`,
  (name: string) => `Hey${name}, what's been on your mind?`,
  (name: string) => `What's happening${name}? Got something brewing?`,
] as const

export function voiceArtistName(value: unknown): string {
  if (typeof value !== 'string') return ''
  const name = value.trim().replace(/\s+/g, ' ')
  // A profile field is data, never a prompt or speech markup. Fail to a nameless greeting.
  if (!name || name.length > 80 || /[<>\[\]{}\r\n\u0000-\u001f]/u.test(value)) return ''
  return name
}

export function selectVoiceOpener(artistName: unknown, previous = -1, random = Math.random) {
  const validPrevious = Number.isInteger(previous) && previous >= 0 && previous < OPENERS.length
  const choices = OPENERS.map((_, index) => index).filter(index => !validPrevious || index !== previous)
  const value = random()
  const index = choices[Math.floor(Math.min(0.999999999, Math.max(0, Number.isFinite(value) ? value : 0)) * choices.length)]!
  const name = voiceArtistName(artistName)
  return { index, text: OPENERS[index]!(name ? `, ${name}` : '') }
}
