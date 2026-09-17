import { expect, test } from 'bun:test'
import { normalizeGmailMessage } from './gmail-message.ts'
const part = (mimeType: string, text: string) => ({ mimeType, body: { data: Buffer.from(text).toString('base64url') } })

test('decodes nested multipart, prefers plain text, omits attachment bytes and unrelated headers', () => {
  const message = normalizeGmailMessage({ id: 'abc', threadId: 'thread', snippet: 'preview', payload: {
    mimeType: 'multipart/mixed', headers: [{ name: 'From', value: 'artist@example.com' }, { name: 'Subject', value: 'Show' }, { name: 'Received', value: 'internal trace' }],
    parts: [{ mimeType: 'multipart/alternative', parts: [part('text/html', '<b>Hello</b>'), part('text/plain', 'Hello 🎵')] },
      { filename: 'private.txt', ...part('text/plain', 'ATTACHMENT SECRET') },
      { mimeType: 'application/pdf', filename: 'poster.pdf', body: { attachmentId: 'opaque', data: 'binarysecret' } }],
  } }, 'fallback')
  expect(message.body).toBe('Hello 🎵')
  expect(message.bodyFormat).toBe('text')
  expect(message.headers).toEqual({ from: 'artist@example.com', subject: 'Show' })
  expect(message.attachments).toEqual([{ filename: 'private.txt', mimeType: 'text/plain' }, { filename: 'poster.pdf', mimeType: 'application/pdf' }])
  expect(JSON.stringify(message)).not.toContain('SECRET')
  expect(JSON.stringify(message)).not.toContain('binarysecret')
  expect(JSON.stringify(message)).not.toContain('internal trace')
})

test('HTML fallback is explicitly labeled and text is bounded', () => {
  const message = normalizeGmailMessage({ payload: part('text/html', '<p>' + 'x'.repeat(40_000) + '</p>') }, 'abc')
  expect(message.bodyFormat).toBe('html')
  expect(message.body.length).toBe(20_000)
  expect(message.truncated).toBe(true)
  expect(message.id).toBe('abc')
})

test('already-extracted provider text stays readable and bounded', () => {
  const message = normalizeGmailMessage({ message: { messageText: 'x'.repeat(25_000), sender: 'a@example.com', subject: 'News' } }, 'abc')
  expect(message.bodyFormat).toBe('text')
  expect(message.body.length).toBe(20_000)
  expect(message.truncated).toBe(true)
  expect(message.headers.from).toBe('a@example.com')
  expect(normalizeGmailMessage('Already decoded text', 'abc').body).toBe('Already decoded text')
})

test('a large HTML alternative does not consume the plain text budget', () => {
  const message = normalizeGmailMessage({ payload: { parts: [part('text/html', 'x'.repeat(200_000)), part('text/plain', 'Actual readable text')] } }, 'abc')
  expect(message.bodyFormat).toBe('text')
  expect(message.body).toBe('Actual readable text')
})

test('bounds nested depth and part count; malformed or binary content is never returned', () => {
  let deep: unknown = part('text/plain', 'deep')
  for (let i = 0; i < 12; i++) deep = { mimeType: 'multipart/mixed', parts: [deep] }
  expect(normalizeGmailMessage({ payload: deep }, 'abc').truncated).toBe(true)
  const many = normalizeGmailMessage({ payload: { parts: Array.from({ length: 100 }, () => part('text/plain', 'x')) } }, 'abc')
  expect(many.truncated).toBe(true)
  const malformed = normalizeGmailMessage({ payload: { mimeType: 'text/plain', body: { data: '!invalid' } } }, 'abc')
  expect(malformed.body).toBe('')
  expect(malformed.bodyFormat).toBe('unavailable')
})
