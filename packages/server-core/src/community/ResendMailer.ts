import type { FetchLike } from '../website/adapters/types'

const API = 'https://api.resend.com'

/** Resend accepts up to 100 messages per batch call. */
export const BATCH_SIZE = 100

/** Leave headroom between provider calls. */
const MIN_CALL_GAP_MS = 600

export interface MailRecipient {
  email: string
  firstName?: string
  /** Carried through so a delivery row can be written against the contact. */
  contactId: string
  emailHash: string
}

export interface SendBroadcastInput {
  from: string
  replyTo?: string
  subject: string
  html: string
  text: string
  recipients: MailRecipient[]
  /** Stable per job, so a retry cannot double-send a batch. */
  idempotencyKey: string
  /** Where an unsubscribe click lands. Required for bulk mail. */
  unsubscribeUrl: string
  onBatch?: (result: SendResult) => void
}

export interface SentMessage {
  contactId: string
  emailHash: string
  providerMessageId?: string
  error?: string
  uncertain?: boolean
}

export interface SendResult {
  sent: SentMessage[]
  failed: SentMessage[]
}

export class MailerError extends Error {
  constructor(message: string, readonly retryable = false) {
    super(message)
    this.name = 'MailerError'
  }
}

/**
 * Sends fan email through the artist's own Resend account.
 *
 * Every message links to the verified unsubscribe form. This is not an
 * RFC 8058 one-click endpoint, so do not advertise List-Unsubscribe-Post.
 */
export class ResendMailer {
  private readonly fetchImpl: FetchLike
  private lastCallAt = 0

  constructor(private readonly options: { apiKey: string; fetchImpl?: FetchLike }) {
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init as RequestInit) as never)
  }

  private async throttle(): Promise<void> {
    const wait = MIN_CALL_GAP_MS - (Date.now() - this.lastCallAt)
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait))
    this.lastCallAt = Date.now()
  }

  async preflightUnsubscribe(base: string): Promise<string[]> {
    const url = new URL(base)
    if (url.protocol !== 'https:') throw new Error('Use the HTTPS unsubscribe page from your published Artist OS website.')
    url.searchParams.set('health', '1')
    const health = await this.fetchImpl(url.toString(), { signal: AbortSignal.timeout(15000) })
    const status = await health.json() as { protocol?: string; ready?: boolean }
    if (!health.ok || status.protocol !== 'artist-os-unsubscribe-v1' || !status.ready) {
      throw new Error('Publish the updated Artist OS website and connect Resend before sending. Its unsubscribe page is not ready.')
    }
    const emails: string[] = []
    const cursors = new Set<string>()
    let cursor: string | undefined
    do {
      await this.throttle()
      const params = new URLSearchParams({ limit: '100' })
      if (cursor) params.set('after', cursor)
      const response = await this.fetchImpl(`${API}/contacts?${params}`, { headers: { Authorization: `Bearer ${this.options.apiKey}` }, signal: AbortSignal.timeout(15000) })
      if (!response.ok) throw new Error('Could not check unsubscribes. Nothing was sent; try again shortly.')
      const page = await response.json() as { data?: Array<{ id?: string; email?: string; unsubscribed?: boolean }>; has_more?: boolean }
      if (!Array.isArray(page.data)) throw new Error('Could not read the unsubscribe list. Nothing was sent.')
      for (const contact of page.data) if (contact.unsubscribed && contact.email) emails.push(contact.email)
      cursor = page.has_more ? page.data.at(-1)?.id : undefined
      if (page.has_more && (!cursor || cursors.has(cursor))) throw new Error('Could not finish checking unsubscribes. Nothing was sent.')
      if (cursor) cursors.add(cursor)
    } while (cursor)
    return emails
  }

  /**
   * Send to a frozen list in batches.
   *
   * Batches are independent: one rejected batch does not lose the ones
   * already accepted, and each carries its own idempotency key so a retry
   * resends only what actually failed.
   */
  async sendBroadcast(input: SendBroadcastInput): Promise<SendResult> {
    const sent: SentMessage[] = []
    const failed: SentMessage[] = []

    for (let index = 0; index < input.recipients.length; index += BATCH_SIZE) {
      const batch = input.recipients.slice(index, index + BATCH_SIZE)
      const batchNumber = Math.floor(index / BATCH_SIZE)
      const sentStart = sent.length
      const failedStart = failed.length

      try {
        await this.throttle()
        const response = await this.fetchImpl(`${API}/emails/batch`, {
          method: 'POST',
          signal: AbortSignal.timeout(30000),
          headers: {
            Authorization: `Bearer ${this.options.apiKey}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': `${input.idempotencyKey}-b${batchNumber}`,
          },
          body: JSON.stringify(batch.map(recipient => ({
            from: input.from,
            to: [recipient.email],
            subject: input.subject,
            html: personalize(input.html, recipient),
            text: personalize(input.text, recipient),
            ...(input.replyTo ? { reply_to: input.replyTo } : {}),
            headers: {
              'List-Unsubscribe': `<${input.unsubscribeUrl}>`,
            },
          }))),
        })

        if (!response.ok) {
          const detail = await readError(response)
          for (const recipient of batch) {
            failed.push({ ...identity(recipient), error: detail, uncertain: response.status >= 500 })
          }
        } else {
          const payload = await response.json().catch(() => undefined) as { data?: Array<{ id?: string }> } | undefined
          const ids = payload?.data ?? []
          if (ids.length !== batch.length || ids.some(item => !item.id)) {
            throw new Error('Incomplete message receipts')
          }
          batch.forEach((recipient, position) => {
            sent.push({ ...identity(recipient), providerMessageId: ids[position]?.id })
          })
        }
      } catch (error) {
        if (error instanceof MailerError) throw error
        const message = 'Delivery uncertain. Check Resend before resending.'
        for (const recipient of batch) failed.push({ ...identity(recipient), error: message, uncertain: true })
      }
      input.onBatch?.({ sent: sent.slice(sentStart), failed: failed.slice(failedStart) })
    }

    return { sent, failed }
  }

  /** Confirm the key works and the from-domain is verified before a send. */
  async verifySender(fromEmail: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const domain = fromEmail.split('@')[1]?.toLowerCase()
    if (!domain) return { ok: false, error: `"${fromEmail}" is not a usable from address.` }

    try {
      await this.throttle()
      const response = await this.fetchImpl(`${API}/domains`, {
        signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${this.options.apiKey}` },
      })
      if (!response.ok) {
        return { ok: false, error: `${await readError(response)} Check the Resend API key in Settings.` }
      }
      const payload = await response.json().catch(() => undefined) as
        | { data?: Array<{ name?: string; status?: string }> }
        | undefined
      const match = (payload?.data ?? []).find(entry => entry.name?.toLowerCase() === domain)
      if (!match) {
        return { ok: false, error: `${domain} is not added to Resend yet. Add and verify it there first.` }
      }
      if (match.status !== 'verified') {
        return { ok: false, error: `${domain} is added to Resend but not verified yet (${match.status ?? 'pending'}).` }
      }
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }
}

function identity(recipient: MailRecipient): { contactId: string; emailHash: string } {
  return { contactId: recipient.contactId, emailHash: recipient.emailHash }
}

/**
 * A first name if there is one, and a graceful sentence if there is not.
 *
 * "Hey ," is worse than no greeting at all, so the fallback is substituted
 * rather than left empty.
 */
function personalize(body: string, recipient: MailRecipient): string {
  return body.replaceAll('{{first_name}}', recipient.firstName || 'there')
}

async function readError(response: { json: () => Promise<unknown>; status: number }): Promise<string> {
  const payload = await response.json().catch(() => undefined) as { message?: string; name?: string } | undefined
  return payload?.message ?? payload?.name ?? `Resend returned ${response.status}.`
}
