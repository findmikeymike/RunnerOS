/** Only the explicit Builder no-op result suppresses a completion notification. */
export function isQuietBuilderReview(session: {
  spawnedFromAgent?: { agentSlug: string }
  messages: Array<{ role: string; content?: string; isIntermediate?: boolean }>
}): boolean {
  if (session.spawnedFromAgent?.agentSlug !== 'builder') return false
  const final = session.messages.findLast(message => (message.role === 'assistant' || message.role === 'plan') && !message.isIntermediate)
  // Providers sometimes append an explanation to the explicit status line.
  // Recognize that line, not arbitrary mentions/quotes of the token in prose.
  const firstLine = final?.content?.trim().split(/\r?\n/, 1)[0]?.trim()
  return firstLine === 'NO_USEFUL_CAPABILITY'
}
