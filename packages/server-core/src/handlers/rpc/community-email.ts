import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
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

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.community.SEND_RESEND_EMAIL,
] as const

export function registerCommunityEmailHandlers(server: RpcServer, _deps: HandlerDeps): void {
  server.handle(RPC_CHANNELS.community.SEND_RESEND_EMAIL, async (_ctx, _input: CommunityEmailSendInput): Promise<CommunityEmailSendResult> => {
    return {
      ok: false,
      error: 'Direct email sending is disabled until the request is bound to an Owner-approved workspace job and runner receipt.',
    }
  })
}
