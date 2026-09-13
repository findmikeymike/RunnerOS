import type { Message, StoredAttachment } from '@craft-agent/core/types'
import type { FileAttachment, SendMessageOptions } from '@craft-agent/shared/protocol'

export interface QueuedSessionMessage {
  message: string
  attachments?: FileAttachment[]
  storedAttachments?: StoredAttachment[]
  options?: SendMessageOptions & { backgroundFence?: string }
  messageId?: string
  optimisticMessageId?: string
}

export function recoverQueuedMessage(message: Message): QueuedSessionMessage {
  return {
    message: message.content,
    messageId: message.id,
    storedAttachments: message.attachments,
    optimisticMessageId: message.queuedOptions?.optimisticMessageId,
    options: {
      ...message.queuedOptions,
      inputOrigin: message.inputOrigin ?? 'system',
      backgroundFence: message.backgroundFence,
      badges: message.badges,
      displayIntent: message.displayIntent,
      hidden: message.hidden,
    },
  }
}

/** Transcript position is the accepted arrival order, including identical texts. */
export function mergeQueuedMessages(messages: Message[], queued: QueuedSessionMessage[], recovered: QueuedSessionMessage[]): QueuedSessionMessage[] {
  const byId = new Set<string>()
  const positions = new Map(messages.map((message, index) => [message.id, index]))
  return [...queued, ...recovered].filter((entry) => {
    if (!entry.messageId) return true
    if (byId.has(entry.messageId)) return false
    byId.add(entry.messageId)
    return true
  }).sort((a, b) => (positions.get(a.messageId ?? '') ?? Infinity) - (positions.get(b.messageId ?? '') ?? Infinity))
}
