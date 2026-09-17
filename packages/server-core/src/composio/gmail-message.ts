import { objectValue } from './client.ts'

const BODY_LIMIT = 20_000
const PART_LIMIT = 64
const DEPTH_LIMIT = 8

/** Return readable email text without forwarding encoded MIME or attachment bodies to the model. */
export function normalizeGmailMessage(value: unknown, fallbackId: string) {
  const outer = objectValue(value)
  const message = Object.keys(objectValue(outer.message)).length ? objectValue(outer.message) : outer
  const payload = objectValue(message.payload)
  let truncated = false
  const bounded = (value: unknown, limit: number): string | undefined => {
    if (typeof value !== 'string') return undefined
    if (value.length > limit) truncated = true
    return value.slice(0, limit)
  }
  const headers: Record<string, string> = {}
  const rawHeaders = Array.isArray(payload.headers) ? payload.headers : Array.isArray(message.headers) ? message.headers : []
  if (rawHeaders.length > 100) truncated = true
  for (const entry of rawHeaders.slice(0, 100)) {
    const header = objectValue(entry)
    const name = typeof header.name === 'string' ? header.name.toLowerCase() : ''
    if (['from', 'to', 'date', 'subject'].includes(name) && !headers[name]) {
      const text = bounded(header.value, 2000)
      if (text !== undefined) headers[name] = text
    }
  }
  for (const [name, field] of Object.entries({ from: message.sender ?? message.from, to: message.to, date: message.date, subject: message.subject })) {
    const text = bounded(field, 2000)
    if (!headers[name] && text !== undefined) headers[name] = text
  }
  const attachments: Array<{ filename?: string; mimeType?: string }> = []
  const plain: string[] = [], html: string[] = []
  let partsSeen = 0, plainLength = 0, htmlLength = 0
  const walk = (value: unknown, depth: number): void => {
    if (depth > DEPTH_LIMIT || partsSeen >= PART_LIMIT) { truncated = true; return }
    partsSeen++
    const part = objectValue(value)
    const body = objectValue(part.body)
    const mime = typeof part.mimeType === 'string' ? part.mimeType.toLowerCase() : ''
    const filename = bounded(part.filename, 256)
    if (filename || typeof body.attachmentId === 'string') {
      if (attachments.length < 20) attachments.push({ ...(filename ? { filename } : {}), ...(mime ? { mimeType: mime.slice(0, 100) } : {}) })
      else truncated = true
      return
    }
    if ((mime === 'text/plain' || mime === 'text/html') && typeof body.data === 'string') {
      const textLength = mime === 'text/plain' ? plainLength : htmlLength
      if (textLength < BODY_LIMIT * 2) {
        // Decode only textual MIME parts. Bound encoded input as well as decoded output.
        const encoded = body.data
        if (encoded.length > BODY_LIMIT * 8) truncated = true
        const prefix = encoded.slice(0, BODY_LIMIT * 8)
        if (/^[A-Za-z0-9_+/=-]*$/.test(prefix)) {
          const decoded = Buffer.from(prefix, 'base64url').toString('utf8')
          const remaining = BODY_LIMIT * 2 - textLength
          if (decoded.length > remaining) truncated = true
          const text = decoded.slice(0, remaining)
          if (mime === 'text/plain') plainLength += text.length
          else htmlLength += text.length
          ;(mime === 'text/plain' ? plain : html).push(text)
        }
      } else truncated = true
    }
    if (Array.isArray(part.parts)) {
      for (const child of part.parts) {
        if (partsSeen >= PART_LIMIT) { truncated = true; break }
        walk(child, depth + 1)
      }
    }
  }
  walk(payload, 0)
  // Some Composio versions already return extracted readable text rather than raw MIME.
  const extracted = message.messageText ?? message.textPlain ?? message.text ?? (typeof message.body === 'string' ? message.body : undefined)
    ?? (typeof value === 'string' ? value : undefined)
  let body = plain.length ? plain.join('\n\n') : typeof extracted === 'string' ? extracted : html.join('\n\n')
  const bodyFormat = plain.length || typeof extracted === 'string' ? 'text' : html.length ? 'html' : 'unavailable'
  if (body.length > BODY_LIMIT) { body = body.slice(0, BODY_LIMIT); truncated = true }
  const id = bounded(message.id ?? message.messageId, 200) ?? fallbackId
  const threadId = bounded(message.threadId, 200)
  const snippet = bounded(message.snippet, 1000)
  return { id, ...(threadId ? { threadId } : {}), headers, ...(snippet ? { snippet } : {}), body, bodyFormat, attachments, truncated }
}
