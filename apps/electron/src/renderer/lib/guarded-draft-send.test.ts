import { expect, test } from 'bun:test'
import { removeRejectedOptimisticMessage, settleGuardedDraft } from './guarded-draft-send'

test('rejected Send removes only its still-pending optimistic bubble, not confirmed or other queued messages', () => {
  const messages = [{ id: 'rejected', isPending: true }, { id: 'queued', isPending: true }, { id: 'confirmed', isPending: false }]
  expect(removeRejectedOptimisticMessage(messages, 'rejected')).toEqual(messages.slice(1))
  expect(removeRejectedOptimisticMessage(messages, 'confirmed')).toEqual(messages)
  expect(removeRejectedOptimisticMessage(messages)).toBe(messages)
})

test('failed, thrown and unconfirmed Send keep the entire guarded draft', async () => {
  for (const result of [false, undefined]) {
    let cleared = 0
    expect(await settleGuardedDraft({ send: async () => result, text: 'research', attachments: [], current: () => ({ text: 'research', attachments: [], sameSession: true }), clearText: () => { cleared++ }, clearAttachments: () => { cleared++ } })).toBe(false)
    expect(cleared).toBe(0)
  }
  await expect(settleGuardedDraft({ send: async () => { throw new Error('stale') }, text: '', attachments: [], current: () => { throw new Error('must not read') }, clearText: () => {}, clearAttachments: () => {} })).rejects.toThrow('stale')
})
test('accepted Send clears only unchanged text and attachment snapshot', async () => {
  const attachment = { name: 'source' }; const calls: string[] = []
  const base = { send: async () => true, text: 'research', attachments: [attachment], clearText: () => calls.push('text'), clearAttachments: () => calls.push('attachments') }
  await settleGuardedDraft({ ...base, current: () => ({ text: 'new typing', attachments: [attachment, { name: 'new' }], sameSession: true }) })
  expect(calls).toEqual([])
  await settleGuardedDraft({ ...base, current: () => ({ text: 'research', attachments: [attachment], sameSession: false }) })
  expect(calls).toEqual([])
  await settleGuardedDraft({ ...base, current: () => ({ text: 'research', attachments: [attachment], sameSession: true }) })
  expect(calls).toEqual(['text', 'attachments'])
})
