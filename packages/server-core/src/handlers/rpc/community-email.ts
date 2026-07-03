import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { getCredentialManager } from '@craft-agent/shared/credentials'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

interface CommunityEmailSendInput {
  from: string
  to: string[]
  subject: string
  text: string
  replyTo?: string
}

interface CommunityEmailSendResult {
  ok: boolean
  id?: string
  sent?: number
  error?: string
}

const RESEND_API_URL = 'https://api.resend.com/emails'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.community.SEND_RESEND_EMAIL,
] as const

export function registerCommunityEmailHandlers(server: RpcServer, _deps: HandlerDeps): void {
  server.handle(RPC_CHANNELS.community.SEND_RESEND_EMAIL, async (_ctx, input: CommunityEmailSendInput): Promise<CommunityEmailSendResult> => {
    const validation = validateEmailInput(input)
    if (!validation.ok) return { ok: false, error: validation.error }

    const apiKey = await getCredentialManager().getUserSecret('RESEND_API_KEY') ?? process.env.RESEND_API_KEY
    if (!apiKey?.trim()) {
      return { ok: false, error: 'Connect Resend in Settings > Connections first.' }
    }

    try {
      const response = await fetch(RESEND_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey.trim()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: input.from.trim(),
          to: input.to.map((email) => email.trim()),
          subject: input.subject.trim(),
          text: input.text.trim(),
          reply_to: input.replyTo?.trim() || undefined,
        }),
      })

      const payload = await response.json().catch(() => ({})) as { id?: string; message?: string; error?: string }
      if (!response.ok) {
        return { ok: false, error: payload.message || payload.error || `Resend returned ${response.status}` }
      }

      return { ok: true, id: payload.id, sent: input.to.length }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
}

function validateEmailInput(input: CommunityEmailSendInput): { ok: true } | { ok: false; error: string } {
  if (!input || typeof input !== 'object') return { ok: false, error: 'Email payload is required.' }
  if (!validEmail(input.from)) return { ok: false, error: 'Use a valid From email from a verified Resend domain.' }
  if (!Array.isArray(input.to) || input.to.length === 0) return { ok: false, error: 'Add at least one recipient.' }
  if (input.to.length > 100) return { ok: false, error: 'Send to 100 recipients or fewer at once.' }
  if (input.to.some((email) => !validEmail(email))) return { ok: false, error: 'Recipient list contains an invalid email.' }
  if (!input.subject?.trim()) return { ok: false, error: 'Subject is required.' }
  if (!input.text?.trim()) return { ok: false, error: 'Message body is required.' }
  if (input.replyTo && !validEmail(input.replyTo)) return { ok: false, error: 'Reply-to email is invalid.' }
  return { ok: true }
}

function validEmail(value: string | undefined): boolean {
  return Boolean(value?.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()))
}
