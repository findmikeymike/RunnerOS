/** Guarded drafts only clear on explicit acceptance, and never clear newer edits. */
export function removeRejectedOptimisticMessage<T extends { id: string; isPending?: boolean }>(messages: T[], optimisticId?: string): T[] {
  return optimisticId ? messages.filter(message => message.id !== optimisticId || message.isPending !== true) : messages
}

export async function settleGuardedDraft<T>(options: {
  send: () => boolean | void | Promise<boolean | void>
  text: string; attachments: readonly T[]
  current: () => { text: string; attachments: readonly T[]; sameSession: boolean }
  clearText: () => void; clearAttachments: () => void
}): Promise<boolean> {
  const accepted = await options.send()
  if (accepted !== true) return false
  const current = options.current()
  if (!current.sameSession) return true
  if (current.text === options.text) options.clearText()
  if (current.attachments.length === options.attachments.length
    && current.attachments.every((attachment, index) => attachment === options.attachments[index])) options.clearAttachments()
  return true
}
