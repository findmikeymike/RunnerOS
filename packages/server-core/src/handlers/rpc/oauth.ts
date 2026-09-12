import { randomUUID } from 'node:crypto'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId, getWorkspaces } from '@craft-agent/shared/config'
import { loadAllSources, loadGlobalSource, getSourceCredentialManager, getSourcesBySlugs, materializeBuiltinSource, readGlobalSourcesManifest } from '@craft-agent/shared/sources'
import { createPendingFlow, revokeGoogleToken } from '@craft-agent/shared/auth'
import { pushTyped, type RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { syncGoogleAdsCredentialCache } from './google-ads-credential-cache'
import { assertGlobalSourceCredentialPermission } from './team-permission-helpers'

async function reloadSourcesForWorkspace(deps: HandlerDeps, workspaceRootPath: string, log: HandlerDeps['platform']['logger'], label: string): Promise<void> {
  try {
    const reload = (deps.sessionManager as unknown as {
      reloadSourcesForWorkspace?: (rootPath: string) => Promise<void>
    }).reloadSourcesForWorkspace
    if (typeof reload === 'function') {
      await reload.call(deps.sessionManager, workspaceRootPath)
    }
  } catch (err) {
    log.error(`${label}: reloadSourcesForWorkspace failed:`, err)
  }
}

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.oauth.START,
  RPC_CHANNELS.oauth.COMPLETE,
  RPC_CHANNELS.oauth.CANCEL,
  RPC_CHANNELS.oauth.REVOKE,
] as const

/**
 * Complete an OAuth flow: validate state, exchange code for tokens, store credentials.
 *
 * Shared between the `oauth:complete` RPC handler (called by Electron) and the
 * `/api/oauth/callback` HTTP route (called by the relay for WebUI).
 *
 * @param opts.clientId - RPC client ID (for ownership validation). Omit for HTTP callback.
 * @param opts.workspaceId - Workspace ID (for ownership validation). Omit for HTTP callback.
 */
export async function completeOAuthFlow(opts: {
  code: string
  state: string
  flowStore: { getByState(state: string): any; claim?(state: string): any; remove(state: string): void }
  credManager: { exchangeAndStore(...args: any[]): Promise<any> }
  sessionManager: { completeAuthRequest(...args: any[]): Promise<void> }
  pushSourcesChanged: (workspaceId: string) => void
  onSourceCredentialsChanged?: (flow: { workspaceId: string; sourceSlug: string; credentialScope?: 'global' | 'workspace-override' }) => Promise<void>
  logger: { info(msg: string): void; }
  clientId?: string
  workspaceId?: string | null
}): Promise<{ success: boolean; error?: string; email?: string }> {
  const { code, state, flowStore, credManager, sessionManager, pushSourcesChanged, logger } = opts

  const flow = flowStore.getByState(state)
  if (!flow) throw new Error('Unknown or expired OAuth flow')

  // When called via RPC, enforce ownership. HTTP callbacks skip this (state is sufficient auth).
  if (opts.clientId !== undefined) {
    if (flow.ownerClientId !== opts.clientId) throw new Error('OAuth flow owned by different client')
  }
  if (opts.workspaceId != null) {
    if (flow.workspaceId !== opts.workspaceId) throw new Error('Workspace mismatch')
  }
  // Consume the one-time state nonce before network I/O so concurrent/replayed
  // callbacks cannot exchange a second code against the same authorization.
  if (flowStore.claim) {
    if (!flowStore.claim(state)) throw new Error('Unknown or expired OAuth flow')
  } else {
    flowStore.remove(state)
  }
  try {
    const workspace = getWorkspaceByNameOrId(flow.workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${flow.workspaceId}`)
    const { assertTeamPermission } = await import('@craft-agent/shared/workspaces')
    if (flow.credentialScope === 'global') {
      assertGlobalSourceCredentialPermission(flow.workspaceId, flow.sourceSlug)
    } else {
      assertTeamPermission(workspace.rootPath, 'secrets.update')
    }

    const result = await credManager.exchangeAndStore(
      flow.source,
      flow.provider,
      {
        code,
        codeVerifier: flow.codeVerifier,
        tokenEndpoint: flow.tokenEndpoint,
        resource: flow.resource,
        clientId: flow.clientId,
        clientSecret: flow.clientSecret,
        redirectUri: flow.redirectUri,
        expectedScopes: flow.requestedScopes,
        googleService: flow.googleService,
      },
      { override: flow.credentialScope === 'workspace-override', authIntentRevision: flow.authIntentRevision },
    )

    // If this was triggered from a session auth card, complete it
    if (flow.sessionId && flow.authRequestId) {
      await sessionManager.completeAuthRequest(flow.sessionId, {
        requestId: flow.authRequestId,
        sourceSlug: flow.sourceSlug,
        success: result.success,
        email: result.email,
        error: result.error,
      })
    }

    // Push source status update to all clients in this workspace
    pushSourcesChanged(flow.workspaceId)
    if (result.success) {
      await opts.onSourceCredentialsChanged?.({
        workspaceId: flow.workspaceId,
        sourceSlug: flow.sourceSlug,
        credentialScope: flow.credentialScope,
      })
    }

    logger.info(`[OAuth] Flow complete for ${flow.sourceSlug} (success=${result.success})`)
    return result
  } finally {
    flowStore.remove(state)
  }
}

export function registerOAuthHandlers(server: RpcServer, deps: HandlerDeps): void {
  const log = deps.platform.logger
  const flowStore = deps.oauthFlowStore
  const credManager = getSourceCredentialManager()

  // ── oauth:start ──────────────────────────────────────────────
  server.handle(RPC_CHANNELS.oauth.START, async (ctx, args: {
    sourceSlug: string
    callbackPort?: number
    callbackUrl?: string
    sessionId?: string
    authRequestId?: string
    credentialScope?: 'workspace' | 'global' | 'workspace-override'
  }) => {
    const { sourceSlug, callbackPort, callbackUrl, sessionId, authRequestId, credentialScope } = args

    if (!ctx.workspaceId) {
      throw new Error('No workspace bound to this client')
    }

    const workspace = getWorkspaceByNameOrId(ctx.workspaceId)
    if (!workspace) {
      throw new Error(`Workspace not found: ${ctx.workspaceId}`)
    }
    const { assertTeamPermission } = await import('@craft-agent/shared/workspaces')
    if (credentialScope === 'global') {
      assertGlobalSourceCredentialPermission(ctx.workspaceId, sourceSlug)
    } else {
      assertTeamPermission(workspace.rootPath, 'secrets.update')
    }

    const [workspaceSource] = getSourcesBySlugs(workspace.rootPath, [sourceSlug])
    let source = credentialScope === 'global'
      ? loadGlobalSource(sourceSlug)
      : workspaceSource
    if (!source) {
      throw new Error(`Source not found: ${sourceSlug}`)
    }

    // Built-in OAuth sources have no writable config until a user connects.
    // Install a workspace copy so auth state survives reloads and restarts.
    if (source.isBuiltin && credentialScope !== 'global') {
      source = materializeBuiltinSource(source)
    }

    const authIntentRevision = await credManager.beginAuthentication(source)
    const prepared = await credManager.prepareOAuth(source, { callbackPort, callbackUrl })

    const flowId = randomUUID()
    flowStore.store(createPendingFlow({
      flowId,
      authIntentRevision,
      state: prepared.state,
      codeVerifier: prepared.codeVerifier,
      redirectUri: prepared.redirectUri,
      source,
      clientId: prepared.clientId,
      clientSecret: prepared.clientSecret,
      tokenEndpoint: prepared.tokenEndpoint,
      resource: prepared.resource,
      provider: prepared.provider,
      requestedScopes: prepared.requestedScopes,
      googleService: prepared.googleService,
      ownerClientId: ctx.clientId,
      workspaceId: ctx.workspaceId,
      sourceSlug,
      sessionId,
      authRequestId,
      credentialScope: credentialScope === 'global' || credentialScope === 'workspace-override'
        ? credentialScope
        : undefined,
    }))

    log.info(`[OAuth] Flow started for ${sourceSlug} (flow=${flowId})`)
    return { authUrl: prepared.authUrl, state: prepared.state, flowId }
  })

  // ── oauth:complete ───────────────────────────────────────────
  server.handle(RPC_CHANNELS.oauth.COMPLETE, async (ctx, args: {
    flowId: string
    code: string
    state: string
  }) => {
    const { flowId, code, state } = args

    // Validate flowId match before delegating
    const flow = flowStore.getByState(state)
    if (!flow) throw new Error('Unknown or expired OAuth flow')
    if (flow.flowId !== flowId) throw new Error('Flow ID mismatch')

    return completeOAuthFlow({
      code,
      state,
      flowStore,
      credManager,
      sessionManager: deps.sessionManager,
      pushSourcesChanged: (workspaceId) => {
        const ws = getWorkspaceByNameOrId(workspaceId)
        const sources = ws ? loadAllSources(ws.rootPath) : []
        pushTyped(server, RPC_CHANNELS.sources.CHANGED, { to: 'workspace', workspaceId }, workspaceId, sources)
      },
      onSourceCredentialsChanged: async (flow) => {
        if (flow.credentialScope === 'global') {
          pushTyped(server, RPC_CHANNELS.sources.CHANGED_GLOBAL, { to: 'all' }, null)
          for (const workspace of getWorkspaces()) {
            const activatedSlugs = readGlobalSourcesManifest(workspace.rootPath).activatedSlugs
            if (!activatedSlugs.includes(flow.sourceSlug)) continue
            await reloadSourcesForWorkspace(deps, workspace.rootPath, log, 'OAUTH_GLOBAL_CREDENTIALS_CHANGED')
            pushTyped(server, RPC_CHANNELS.sources.CHANGED, { to: 'workspace', workspaceId: workspace.id }, workspace.id, loadAllSources(workspace.rootPath))
          }
          return
        }

        const workspace = getWorkspaceByNameOrId(flow.workspaceId)
        if (!workspace) return
        const [source] = getSourcesBySlugs(workspace.rootPath, [flow.sourceSlug])
        if (source) await syncGoogleAdsCredentialCache(source)
        await reloadSourcesForWorkspace(deps, workspace.rootPath, log, 'OAUTH_SOURCE_CREDENTIALS_CHANGED')
        pushTyped(server, RPC_CHANNELS.sources.CHANGED, { to: 'workspace', workspaceId: flow.workspaceId }, flow.workspaceId, loadAllSources(workspace.rootPath))
      },
      logger: log,
      clientId: ctx.clientId,
      workspaceId: ctx.workspaceId,
    })
  })

  // ── oauth:cancel ─────────────────────────────────────────────
  server.handle(RPC_CHANNELS.oauth.CANCEL, async (ctx, args: {
    flowId: string
    state: string
  }) => {
    const { flowId, state } = args
    const flow = flowStore.getForCancellation?.(state) ?? flowStore.getByState(state)
    if (flow && flow.flowId === flowId && flow.ownerClientId === ctx.clientId) {
      flowStore.remove(state)
      if (flow.authIntentRevision !== undefined) {
        await credManager.cancelAuthentication(flow.source, flow.authIntentRevision)
      }
      log.info(`[OAuth] Flow cancelled for ${flow.sourceSlug}`)
    }
  })

  // ── oauth:revoke ─────────────────────────────────────────────
  server.handle(RPC_CHANNELS.oauth.REVOKE, async (ctx, args: string | {
    sourceSlug: string
  }) => {
    const sourceSlug = typeof args === 'string' ? args : args.sourceSlug

    if (!ctx.workspaceId) {
      throw new Error('No workspace bound to this client')
    }

    const workspace = getWorkspaceByNameOrId(ctx.workspaceId)
    if (!workspace) {
      throw new Error(`Workspace not found: ${ctx.workspaceId}`)
    }
    const { assertTeamPermission } = await import('@craft-agent/shared/workspaces')
    assertTeamPermission(workspace.rootPath, 'secrets.update')

    const [source] = getSourcesBySlugs(workspace.rootPath, [sourceSlug])
    if (!source) {
      throw new Error(`Source not found: ${sourceSlug}`)
    }

    const removal = await credManager.disconnectForRevoke(source)
    if (removal.superseded) {
      return { success: false, error: 'Connection changed while disconnecting. The newer sign-in was kept.' }
    }

    await syncGoogleAdsCredentialCache(source)
    // Shared Google credentials can serve the same source in other workspaces.
    const affectedWorkspaces = source.config.provider === 'google'
      ? [...new Map([workspace, ...getWorkspaces()].map(ws => [ws.id, ws])).values()]
      : [workspace]
    for (const affected of affectedWorkspaces) {
      const [currentSource] = getSourcesBySlugs(affected.rootPath, [sourceSlug])
      if (!currentSource || currentSource.config.provider !== source.config.provider) continue
      await credManager.markSourceNeedsReauthIfDisconnected(currentSource, 'Signed out by user')
      await reloadSourcesForWorkspace(deps, affected.rootPath, log, 'OAUTH_REVOKED')
      pushTyped(server, RPC_CHANNELS.sources.CHANGED, { to: 'workspace', workspaceId: affected.id },
        affected.id, loadAllSources(affected.rootPath))
    }

    let revokedRemotely = true
    let warning: string | undefined
    const remotelyRevoked = new Set<string>()
    for (const credential of removal.credentials) {
      if (source.config.provider === 'google') {
        const token = credential.refreshToken || credential.value
        if (remotelyRevoked.has(token)) continue
        remotelyRevoked.add(token)
        try {
          await revokeGoogleToken(token)
        } catch {
          revokedRemotely = false
          warning = 'Local Google credentials were removed, but Google could not confirm remote revocation. Retry revoke from your Google Account if needed.'
        }
      } else {
        await credManager.revokeRemote(source, credential)
      }
    }

    log.info(`[OAuth] Revoked credentials for ${sourceSlug}`)
    return { success: true, revokedRemotely, warning }
  })
}
