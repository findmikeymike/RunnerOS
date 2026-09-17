import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { RpcServer } from '../../transport/types'
import type { HandlerDeps } from '../handler-deps'
import { getComposioService } from '../../composio/service'
import { assertGlobalSecretVaultPermission } from './team-permission-helpers'

export const HANDLED_CHANNELS = Object.values(RPC_CHANNELS.composio)

/** Settings only. Email execution is exclusively exposed through permission-checked session tools. */
export function registerComposioHandlers(server: RpcServer, _deps: HandlerDeps): void {
  const authorize = (workspaceId: unknown): void => {
    if (typeof workspaceId !== 'string' || !workspaceId.trim()) {
      throw new Error('Select an active workspace before managing Composio.')
    }
    // This connection is shared across workspaces on the host, like the secret vault.
    assertGlobalSecretVaultPermission(workspaceId, 'Composio connection access')
  }
  server.handle(RPC_CHANNELS.composio.STATUS, async (_ctx, workspaceId: string) => {
    authorize(workspaceId)
    return getComposioService().status()
  })
  server.handle(RPC_CHANNELS.composio.SAVE_KEY, async (_ctx, workspaceId: string, key: string) => {
    authorize(workspaceId)
    return getComposioService().saveKey(key)
  })
  server.handle(RPC_CHANNELS.composio.CONNECT, async (_ctx, workspaceId: string) => {
    authorize(workspaceId)
    return getComposioService().connect()
  })
  server.handle(RPC_CHANNELS.composio.REFRESH, async (_ctx, workspaceId: string) => {
    authorize(workspaceId)
    return getComposioService().refresh()
  })
  server.handle(RPC_CHANNELS.composio.DISCONNECT, async (_ctx, workspaceId: string) => {
    authorize(workspaceId)
    return getComposioService().disconnect()
  })
}
