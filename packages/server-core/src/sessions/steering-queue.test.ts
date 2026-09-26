import { describe, expect, test } from 'bun:test'
import type { Message, StoredAttachment } from '@craft-agent/core/types'
import type { FileAttachment } from '@craft-agent/shared/protocol'
import { mergeQueuedMessages, recoverQueuedMessage, type QueuedSessionMessage } from './steering-queue'

const user = (id: string, content = 'Use the second version.', timestamp = 1): Message => ({ id, content, timestamp, role: 'user' })

describe('steering queue recovery', () => {
  test('puts undelivered earlier updates before later queued messages using transcript order, not timestamps', () => {
    const earlier = user('earlier', 'Keep the chorus.', 900)
    const later = user('later', 'Change the verse.', 1)
    const transcript = [user('initial'), earlier, { id: 'reply', role: 'assistant' as const, content: 'Working', timestamp: 2 }, later]
    const queued = [recoverQueuedMessage(later)]
    const recovered = [recoverQueuedMessage(earlier)]
    expect(mergeQueuedMessages(transcript, queued, recovered).map(entry => entry.messageId)).toEqual(['earlier', 'later'])
    expect(queued.map(entry => entry.messageId)).toEqual(['later'])
    expect(recovered.map(entry => entry.messageId)).toEqual(['earlier'])
  })

  test('retains distinct identical-text updates and deduplicates repeated recovery only by message id', () => {
    const transcript = [user('one'), user('two'), user('three')]
    const recovered = transcript.map(recoverQueuedMessage)
    const first = mergeQueuedMessages(transcript, [recovered[2]!], [recovered[1]!, recovered[0]!, recovered[1]!])
    const second = mergeQueuedMessages(transcript, first, recovered)
    expect(second.map(entry => entry.messageId)).toEqual(['one', 'two', 'three'])
    expect(second.map(entry => entry.message)).toEqual(Array(3).fill('Use the second version.'))
  })

  test('preserves durable attachment and replay options after JSON persistence', () => {
    const stored: StoredAttachment = {
      id: 'attachment', type: 'text', name: 'notes.txt', mimeType: 'text/plain', size: 12,
      storedPath: '/fixture/session/attachments/notes.txt', markdownPath: '/fixture/session/attachments/notes.md',
    }
    const accepted: Message = {
      ...user('accepted', '@songwriter keep this'),
      hidden: true, displayIntent: 'agent-delegation-task', inputOrigin: 'agent', attachments: [stored],
      badges: [{ type: 'skill', label: 'Songwriter', rawText: '@songwriter', start: 0, end: 11 }],
      queuedOptions: { skillSlugs: ['workspace/songwriter'], legacySkillReferences: ['global/legacy-writer'], optimisticMessageId: 'optimistic-1' },
    }
    const restored = JSON.parse(JSON.stringify(accepted)) as Message
    const recovered = recoverQueuedMessage(restored)
    expect(recovered).toEqual({
      message: accepted.content, messageId: 'accepted', storedAttachments: [stored], optimisticMessageId: 'optimistic-1',
      options: { ...accepted.queuedOptions, hidden: true, displayIntent: 'agent-delegation-task', inputOrigin: 'agent', badges: accepted.badges },
    })
    expect(mergeQueuedMessages([restored], [], [recovered])[0]).toEqual(recovered)
  })

  test('existing queue entry keeps hydrated attachments and caller choices when recovery overlaps', () => {
    const message = user('accepted')
    const attachment: FileAttachment = { type: 'text', path: '/fixture/notes.txt', name: 'notes.txt', mimeType: 'text/plain', size: 4, text: 'Keep' }
    const queued: QueuedSessionMessage = {
      message: message.content, messageId: message.id, optimisticMessageId: 'optimistic-live', attachments: [attachment],
      options: { inputOrigin: 'human', hidden: false, skillSlugs: ['chosen-skill'], legacySkillReferences: ['frozen-skill'] },
    }
    const result = mergeQueuedMessages([message], [queued], [recoverQueuedMessage(message)])
    expect(result).toEqual([queued])
    expect(result[0]!.attachments).toEqual([attachment])
    expect(result[0]!.optimisticMessageId).toBe('optimistic-live')
  })

  test('does not elevate unknown legacy origin to human or discard hidden false', () => {
    const recovered = recoverQueuedMessage({ ...user('legacy'), hidden: false })
    expect(recovered.options?.inputOrigin).toBe('system')
    expect(recovered.options?.hidden).toBe(false)
  })

  test('does not collapse idless queue entries or drop entries outside the loaded transcript', () => {
    const transcript = [user('known')]
    const unknown = { message: 'outside', messageId: 'unknown' }
    const result = mergeQueuedMessages(transcript, [unknown, { message: 'same' }, { message: 'same' }], [recoverQueuedMessage(transcript[0]!)])
    expect(result.map(entry => entry.messageId)).toEqual(['known', 'unknown', undefined, undefined])
    expect(result.map(entry => entry.message)).toEqual(['Use the second version.', 'outside', 'same', 'same'])
  })
})
