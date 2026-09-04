import { getCredentialManager } from '@craft-agent/shared/credentials'
import {
  approveEmailJob,
  cancelEmailJob,
  listDeliveries,
  markJobFailed,
  markJobSending,
  markJobSent,
  readEmailJob,
  resolveSendAudience,
  writeDeliveries,
  type CommunityEmailJobRecord,
} from '@craft-agent/shared/community'
import { writeChangeReceipt, type ChangeReceiptOrigin } from '@craft-agent/shared/website'
import { ResendMailer, type MailRecipient } from './ResendMailer'

export interface CommunityMailResult {
  ok: boolean
  error?: string
  [key: string]: unknown
}

export interface MailProviderConfig {
  from: string
  replyTo?: string
  unsubscribeUrl: string
  postalAddress?: string
}

/**
 * Sends the artist's fan email.
 *
 * The rules that make a send legitimate live here rather than in any caller:
 * the audience is the frozen list minus anyone who left, an approval covers
 * one job, and nothing goes out without a verified sending domain.
 */
export class CommunityMailService {
  /**
   * `mailer` is an explicit override used by tests and by any caller that
   * already holds a configured client. When absent the key is read from the
   * encrypted store at call time, so a rotated key takes effect immediately.
   */
  constructor(private readonly mailer?: ResendMailer) {}

  private async resolveMailer(): Promise<ResendMailer | { error: string }> {
    if (this.mailer) return this.mailer
    const apiKey = await getCredentialManager().getUserSecret('RESEND_API_KEY')
    if (!apiKey) return { error: 'Save RESEND_API_KEY in Settings before sending fan email.' }
    return new ResendMailer({ apiKey })
  }

  /** The artist's one decision. Refused rather than coerced when not ready. */
  approve(
    workspaceRootPath: string,
    machineId: string,
    jobId: string,
  ): CommunityMailResult {
    const job = readEmailJob(workspaceRootPath, jobId)
    if (!job) return { ok: false, error: 'That email no longer exists.' }

    const result = approveEmailJob(workspaceRootPath, machineId, job)
    if ('ok' in result && result.ok === false) {
      return { ok: false, error: result.message, failure: result.failure }
    }
    return { ok: true, job: result }
  }

  cancel(workspaceRootPath: string, machineId: string, jobId: string): CommunityMailResult {
    const job = readEmailJob(workspaceRootPath, jobId)
    if (!job) return { ok: false, error: 'That email no longer exists.' }
    const result = cancelEmailJob(workspaceRootPath, machineId, job)
    if ('ok' in result && result.ok === false) {
      return { ok: false, error: result.message, failure: result.failure }
    }
    return { ok: true, job: result }
  }

  /**
   * Send an approved job.
   *
   * Deliberately refuses an unapproved job rather than approving it in
   * passing: sending to real people is the one thing that must never happen
   * as a side effect of asking for something else.
   */
  async send(
    workspaceRootPath: string,
    machineId: string,
    jobId: string,
    provider: MailProviderConfig,
    origin: ChangeReceiptOrigin,
  ): Promise<CommunityMailResult> {
    const job = readEmailJob(workspaceRootPath, jobId)
    if (!job) return { ok: false, error: 'That email no longer exists.' }
    if (job.status === 'sent') return { ok: false, error: 'That email already went out.', failure: 'already-sent' }
    if (job.status !== 'approved' && job.status !== 'queued') {
      return { ok: false, error: 'Approve the email before sending it.', failure: 'not-approved' }
    }

    const mailer = await this.resolveMailer()
    if ('error' in mailer) return { ok: false, error: mailer.error }

    const sender = await mailer.verifySender(provider.from)
    if (!sender.ok) return { ok: false, error: sender.error, failure: 'no-provider' }

    // Consent at send time is what counts, not consent when the draft was
    // written, so anyone who left in between is dropped here.
    const audience = resolveSendAudience(workspaceRootPath, job)
    if (audience.members.length === 0) {
      return {
        ok: false,
        error: audience.droppedSinceFreeze > 0
          ? 'Everyone in this audience has unsubscribed since the draft.'
          : 'Nobody is in this audience.',
        failure: 'empty-audience',
      }
    }

    const started = markJobSending(workspaceRootPath, machineId, job)
    if ('ok' in started && started.ok === false) {
      return { ok: false, error: started.message, failure: started.failure }
    }

    const recipients: MailRecipient[] = audience.members.map(member => ({
      email: member.email,
      firstName: member.firstName,
      contactId: member.contactId,
      emailHash: member.emailHash,
    }))

    try {
      const result = await mailer.sendBroadcast({
        from: provider.from,
        replyTo: provider.replyTo,
        subject: job.content.subject,
        html: renderHtml(job, provider),
        text: renderText(job, provider),
        recipients,
        idempotencyKey: job.idempotencyKey,
        unsubscribeUrl: provider.unsubscribeUrl,
      })

      writeDeliveries(workspaceRootPath, machineId, job.id, [
        ...result.sent.map(message => ({
          contactId: message.contactId,
          emailHash: message.emailHash,
          providerMessageId: message.providerMessageId,
        })),
        ...result.failed.map(message => ({
          contactId: message.contactId,
          emailHash: message.emailHash,
          error: message.error,
        })),
      ])

      const sentJob = markJobSent(workspaceRootPath, machineId, started as CommunityEmailJobRecord, {
        sentCount: result.sent.length,
        failedCount: result.failed.length,
      })

      const receipt = writeChangeReceipt(workspaceRootPath, machineId, {
        kind: 'email-send',
        origin,
        approval: {
          tier: 'one-click',
          approvedAt: job.approval?.approvedAt,
          approvedBy: 'user',
          boundTo: job.id,
        },
        summary: `Sent "${job.content.subject}" to ${result.sent.length} ${result.sent.length === 1 ? 'fan' : 'fans'}.`,
        why: ['The artist approved this exact email.'],
        changes: audience.droppedSinceFreeze > 0
          ? [`${audience.droppedSinceFreeze} recipients were dropped because they unsubscribed after the draft.`]
          : [],
        after: { jobId: job.id, sentCount: result.sent.length },
        counts: { recipients: result.sent.length },
      })

      return {
        ok: result.sent.length > 0,
        jobId: job.id,
        sent: result.sent.length,
        failed: result.failed.length,
        droppedSinceFreeze: audience.droppedSinceFreeze,
        receiptId: receipt.id,
        status: sentJob.status,
        ...(result.sent.length === 0 ? { error: 'Every message was rejected by the provider.' } : {}),
      }
    } catch (error) {
      markJobFailed(workspaceRootPath, machineId, started as CommunityEmailJobRecord)
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  deliveries(workspaceRootPath: string, jobId: string): CommunityMailResult {
    return { ok: true, deliveries: listDeliveries(workspaceRootPath, jobId) }
  }
}

/**
 * Every bulk email carries the artist's postal address and a way out.
 *
 * Both are legal requirements for commercial mail, and the unsubscribe link
 * is also simply the decent thing: a fan who wants to leave should not have
 * to hunt.
 */
function footer(provider: MailProviderConfig): { html: string; text: string } {
  const address = provider.postalAddress ? `${provider.postalAddress}<br>` : ''
  return {
    html: `<hr><p style="font-size:12px;color:#666">${address}<a href="${provider.unsubscribeUrl}">Unsubscribe</a></p>`,
    text: `\n\n---\n${provider.postalAddress ? `${provider.postalAddress}\n` : ''}Unsubscribe: ${provider.unsubscribeUrl}`,
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

/** Small markdown subset: paragraphs, bold, italics, links. */
function renderHtml(job: CommunityEmailJobRecord, provider: MailProviderConfig): string {
  const body = job.content.bodyMarkdown
    .split(/\n{2,}/)
    .map(block => escapeHtml(block.trim()))
    .filter(Boolean)
    .map(block => `<p>${block
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replaceAll('\n', '<br>')}</p>`)
    .join('\n')

  return `<div style="font-family:system-ui,-apple-system,sans-serif;font-size:16px;line-height:1.6;max-width:600px">
${body}
${footer(provider).html}
</div>`
}

function renderText(job: CommunityEmailJobRecord, provider: MailProviderConfig): string {
  return `${job.content.bodyMarkdown.trim()}${footer(provider).text}`
}
