/** Only the explicit Builder no-op result suppresses a completion notification. */
export function isQuietBuilderReview(session: {
  spawnedFromAgent?: { agentSlug: string }
  messages: Array<{ role: string; content?: string; isIntermediate?: boolean }>
}): boolean {
  if (session.spawnedFromAgent?.agentSlug !== 'builder') return false
  const final = session.messages.findLast(message => (message.role === 'assistant' || message.role === 'plan') && !message.isIntermediate)
  return final?.content?.trim() === 'NO_USEFUL_CAPABILITY'
}
