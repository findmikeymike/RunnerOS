import { describe, expect, test } from 'bun:test'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { HandlerFn, RpcServer } from '../../transport/types'
import { registerCommunityEmailHandlers } from './community-email'

describe('community email RPC', () => {
  test('blocks raw email payloads until they are bound to an approved workspace job', async () => {
    const handlers = new Map<string, HandlerFn>()
    const server: RpcServer = {
      handle(channel, handler) {
        handlers.set(channel, handler)
      },
      push() {},
      async invokeClient() {
        return undefined
      },
    }
    registerCommunityEmailHandlers(server, {} as never)
    const handler = handlers.get(RPC_CHANNELS.community.SEND_RESEND_EMAIL)
    if (!handler) throw new Error('Community email handler was not registered')

    const result = await handler(
      { clientId: 'client-1', workspaceId: 'workspace-1', webContentsId: 1 },
      { from: 'artist@example.com', to: ['fan@example.com'], subject: 'Hello', text: 'Hi.' },
    ) as { ok: boolean; error?: string }

    expect(result).toEqual({
      ok: false,
      error: 'Direct email sending is disabled until the request is bound to an Owner-approved workspace job and runner receipt.',
    })
  })
})
