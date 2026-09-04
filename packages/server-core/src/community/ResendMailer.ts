import type { FetchLike } from '../website/adapters/types'

const API = 'https://api.resend.com'

/** Resend accepts up to 100 messages per batch call. */
export const BATCH_SIZE = 100

/** Ten requests per second per team; stay under it. */
const MIN_CALL_GAP_MS = 130

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
}

export interface SentMessage {
  contactId: string
  emailHash: string
  providerMessageId?: string
  error?: string
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
 * Every message carries one-click unsubscribe headers. Gmail and Yahoo
 * require them of bulk senders, and more to the point a fan who wants out
 * should get out in one click rather than hunting for a link.
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

      try {
        await this.throttle()
        const response = await this.fetchImpl(`${API}/emails/batch`, {
          method: 'POST',
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
              'List-Unsubscribe': `<${unsubscribeFor(input.unsubscribeUrl, recipient)}>`,
              'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
            },
          }))),
        })

        if (!response.ok) {
          const detail = await readError(response)
          const retryable = response.status === 429 || response.status >= 500
          for (const recipient of batch) {
            failed.push({ ...identity(recipient), error: detail })
          }
          if (!retryable && response.status === 401) {
            throw new MailerError(`${detail} Check the Resend API key in Settings.`)
          }
          continue
        }

        const payload = await response.json().catch(() => undefined) as { data?: Array<{ id?: string }> } | undefined
        const ids = payload?.data ?? []
        batch.forEach((recipient, position) => {
          sent.push({ ...identity(recipient), providerMessageId: ids[position]?.id })
        })
      } catch (error) {
        if (error instanceof MailerError) throw error
        const message = error instanceof Error ? error.message : String(error)
        for (const recipient of batch) failed.push({ ...identity(recipient), error: message })
      }
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

/** One-click unsubscribe has to identify who is leaving. */
function unsubscribeFor(base: string, recipient: MailRecipient): string {
  const url = new URL(base)
  url.searchParams.set('c', recipient.emailHash)
  return url.toString()
}

async function readError(response: { json: () => Promise<unknown>; status: number }): Promise<string> {
  const payload = await response.json().catch(() => undefined) as { message?: string; name?: string } | undefined
  return payload?.message ?? payload?.name ?? `Resend returned ${response.status}.`
}
