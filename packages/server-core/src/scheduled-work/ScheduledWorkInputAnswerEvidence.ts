export interface ArtistAnswerEvidenceMessage {
  id: string
  role: string
  content: string
  timestamp: number
  hidden?: boolean
  inputOrigin?: 'human' | 'agent' | 'system'
  attachments?: Array<{ name: string; storedPath: string }>
}

export function findArtistAnswerEvidence(
  messages: ArtistAnswerEvidenceMessage[],
  requestedAt: string,
  currentHumanMessageId: string | undefined,
): ArtistAnswerEvidenceMessage {
  const requestTime = Date.parse(requestedAt)
  if (Number.isNaN(requestTime)) throw new Error('The workflow input request has an invalid timestamp.')
  if (!currentHumanMessageId) throw new Error('Ask the artist to answer this input request before supplying values.')
  const message = messages.find((candidate) => candidate.id === currentHumanMessageId)
  if (!message
    || message.role !== 'user'
    || message.hidden
    || message.inputOrigin !== 'human'
    || message.timestamp < requestTime) {
    throw new Error('The current turn is not a valid artist answer to this input request. Use the Needs you form instead.')
  }
  return message
}

export interface ArtistAnswerValueEvidence {
  message: ArtistAnswerEvidenceMessage
  evidenceText: string
  attachments: Array<{ name: string; storedPath: string }>
}

export function findArtistAnswerValueEvidence(
  messages: ArtistAnswerEvidenceMessage[],
  requestedAt: string,
  currentHumanMessageId: string | undefined,
): ArtistAnswerValueEvidence {
  const message = findArtistAnswerEvidence(messages, requestedAt, currentHumanMessageId)
  let evidenceText = message.content
  if (isSimpleAffirmative(message.content)) {
    const requestTime = Date.parse(requestedAt)
    const messageIndex = messages.findIndex((candidate) => candidate.id === message.id)
    const preceding = messages
      .slice(0, messageIndex)
      .reverse()
      .find((candidate) => (
        !candidate.hidden
        && candidate.timestamp <= message.timestamp
      ))
    if (preceding?.role === 'assistant' && preceding.timestamp >= requestTime) {
      evidenceText = `${preceding.content}\n${message.content}`
    }
  }
  return {
    message,
    evidenceText,
    attachments: message.attachments?.map(({ name, storedPath }) => ({ name, storedPath })) ?? [],
  }
}

export function assertArtistAnswerSupportsValues(
  evidenceText: string,
  attachments: Array<{ name: string; storedPath: string }>,
  values: Record<string, unknown>,
): void {
  const unsupported = Object.entries(values)
    .filter(([, value]) => !hasValueEvidence(evidenceText, attachments, value))
    .map(([key]) => key)
  if (unsupported.length > 0) {
    throw new Error(
      `The artist did not explicitly provide or approve values for: ${unsupported.join(', ')}. `
      + 'Ask for those exact values or use the Needs you form.',
    )
  }
}

function isSimpleAffirmative(value: string): boolean {
  const normalized = normalizeText(value).replace(/[.!]+$/g, '').trim()
  return new Set(['yes', 'yes please', 'yep', 'yeah', 'approved', 'confirm', 'confirmed', 'do it', 'go ahead', 'sounds good']).has(normalized)
}

function hasValueEvidence(
  evidenceText: string,
  attachments: Array<{ name: string; storedPath: string }>,
  value: unknown,
): boolean {
  if (typeof value === 'string') {
    const target = normalizeComparable(value)
    if (!target) return false
    if (` ${normalizeComparable(evidenceText)} `.includes(` ${target} `)) return true
    return attachments.some((attachment) => (
      normalizeComparable(attachment.name) === target
      || normalizeComparable(attachment.storedPath) === target
    ))
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const compact = normalizeText(evidenceText).replaceAll(',', '')
    const numeric = String(value).replaceAll(',', '')
    return new RegExp(`(^|[^0-9.])${escapeRegExp(numeric)}(?=$|[^0-9.])`).test(compact)
      || numberWord(value).some((word) => new RegExp(`\\b${word}\\b`).test(compact))
  }
  if (typeof value === 'boolean') {
    const normalized = normalizeText(evidenceText)
    const words = value
      ? ['yes', 'true', 'approved', 'confirmed', 'do it', 'go ahead']
      : ['no', 'false', 'declined', 'do not', "don't"]
    return words.some((word) => new RegExp(`(^|\\b)${escapeRegExp(word)}(?=$|\\b)`).test(normalized))
  }
  return false
}

function normalizeText(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()
}

function normalizeComparable(value: string): string {
  return normalizeText(value).replace(/[^\p{L}\p{N}@._/+:-]+/gu, ' ').trim()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function numberWord(value: number): string[] {
  if (!Number.isInteger(value) || value < 0 || value > 20) return []
  return [
    'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
    'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen',
    'nineteen', 'twenty',
  ].slice(value, value + 1)
}
