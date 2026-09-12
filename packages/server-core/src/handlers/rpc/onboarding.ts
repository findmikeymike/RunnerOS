/**
 * Onboarding IPC handlers for Electron main process
 *
 * Handles workspace setup and configuration persistence.
 */
import { getAuthState, getSetupNeeds } from '@craft-agent/shared/auth'
import { getCredentialManager } from '@craft-agent/shared/credentials'
import { setSetupDeferred } from '@craft-agent/shared/config'
import { prepareClaudeOAuth, exchangeClaudeCode, hasValidOAuthState, clearOAuthState, prepareMcpOAuth } from '@craft-agent/shared/auth'
import { validateMcpConnection } from '@craft-agent/shared/mcp'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

// ============================================
// IPC Handlers
// ============================================

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.onboarding.GET_AUTH_STATE,
  RPC_CHANNELS.onboarding.VALIDATE_MCP,
  RPC_CHANNELS.onboarding.START_MCP_OAUTH,
  RPC_CHANNELS.onboarding.START_CLAUDE_OAUTH,
  RPC_CHANNELS.onboarding.EXCHANGE_CLAUDE_CODE,
  RPC_CHANNELS.onboarding.HAS_CLAUDE_OAUTH_STATE,
  RPC_CHANNELS.onboarding.CLEAR_CLAUDE_OAUTH_STATE,
  RPC_CHANNELS.onboarding.DEFER_SETUP,
] as const

export function registerOnboardingHandlers(server: RpcServer, deps: HandlerDeps): void {
  const log = deps.platform.logger

  // Get current auth state
  server.handle(RPC_CHANNELS.onboarding.GET_AUTH_STATE, async () => {
    const authState = await getAuthState()
    const setupNeeds = getSetupNeeds(authState)
    // Redact raw credentials — renderer only needs boolean flags (hasCredentials, setupNeeds)
    return {
      authState: {
        ...authState,
        billing: {
          ...authState.billing,
          apiKey: authState.billing.apiKey ? '••••' : null,
          claudeOAuthToken: authState.billing.claudeOAuthToken ? '••••' : null,
        },
      },
      setupNeeds,
    }
  })

  // Validate MCP connection
  server.handle(RPC_CHANNELS.onboarding.VALIDATE_MCP, async (_ctx, mcpUrl: string, accessToken?: string) => {
    try {
      const result = await validateMcpConnection({
        mcpUrl,
        mcpAccessToken: accessToken,
      })
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: message }
    }
  })

  // Prepare MCP server OAuth (server-side only — no browser open).
  // Returns authUrl for the client to open locally.
  // NOTE: Currently unused in renderer. If re-enabled, needs client-side
  // orchestration (callback server + browser open) like performOAuth().
  server.handle(RPC_CHANNELS.onboarding.START_MCP_OAUTH, async (_ctx, mcpUrl: string, callbackPort?: number) => {
    log.info('[Onboarding:Main] ONBOARDING_START_MCP_OAUTH received')
    try {
      if (!callbackPort) {
        throw new Error('callbackPort is required — client must run a local callback server')
      }
      const prepared = await prepareMcpOAuth(mcpUrl, { callbackPort })
      log.info('[Onboarding:Main] MCP OAuth prepared, returning authUrl to client')

      return {
        success: true,
        authUrl: prepared.authUrl,
        state: prepared.state,
        codeVerifier: prepared.codeVerifier,
        tokenEndpoint: prepared.tokenEndpoint,
        clientId: prepared.clientId,
        redirectUri: prepared.redirectUri,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      log.error('[Onboarding:Main] MCP OAuth prepare failed:', message)
      return { success: false, error: message }
    }
  })

  // Prepare Claude OAuth flow (server-side only — no browser open).
  // Returns authUrl for the client to open locally via shell.openExternal.
  server.handle(RPC_CHANNELS.onboarding.START_CLAUDE_OAUTH, async () => {
    try {
      log.info('[Onboarding] Preparing Claude OAuth flow...')

      const authUrl = prepareClaudeOAuth()

      log.info('[Onboarding] Claude OAuth URL generated (client will open browser)')
      return { success: true, authUrl }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      log.error('[Onboarding] Prepare Claude OAuth error:', message)
      return { success: false, error: message }
    }
  })

  // Exchange authorization code for tokens
  server.handle(RPC_CHANNELS.onboarding.EXCHANGE_CLAUDE_CODE, async (_ctx, authorizationCode: string, connectionSlug: string) => {
    try {
      log.info(`[Onboarding] Exchanging Claude authorization code for connection: ${connectionSlug}`)

      if (!hasValidOAuthState()) {
        log.error('[Onboarding] No valid OAuth state found')
        return { success: false, error: 'OAuth session expired. Please start again.' }
      }

      // Mark this exchange's sign-in intent before the network call so a newer
      // sign-in or sign-out that lands during the exchange supersedes it.
      const manager = getCredentialManager()
      const connectionId = { type: 'llm_oauth' as const, connectionSlug }
      const connectionIntent = await manager.beginAuthIntent(connectionId)
      const before = await manager.captureSnapshot(connectionId)
      before.authRevision = connectionIntent
      const globalId = { type: 'claude_oauth' as const }
      const globalIntent = await manager.beginAuthIntent(globalId)
      const globalBefore = await manager.captureSnapshot(globalId)
      globalBefore.authRevision = globalIntent

      const tokens = await exchangeClaudeCode(authorizationCode, (status) => {
        log.info('[Onboarding] Claude code exchange status:', status)
      })

      // The exchange commits only while it still owns the connection.
      const committed = await manager.compareAndSetSnapshot(before, {
        value: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
      }, () => true, true)
      if (!committed) {
        log.warn('[Onboarding] A newer sign-in superseded this Claude exchange; kept the newer credentials')
        return { success: false, error: 'A newer sign-in superseded this authentication. Please start again.' }
      }

      // Legacy global record for validation compatibility, fenced the same way.
      const globalCommitted = await manager.compareAndSetSnapshot(globalBefore, {
        value: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
        source: 'native',
      }, () => true, true)
      if (!globalCommitted) {
        log.warn('[Onboarding] Legacy Claude credentials superseded during exchange; kept the newer credentials')
      }

      const expiresAtDate = tokens.expiresAt ? new Date(tokens.expiresAt).toISOString() : 'never'
      log.info(`[Onboarding] Claude OAuth saved to LLM connection (expires: ${expiresAtDate})`)
      return { success: true, token: tokens.accessToken }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      log.error('[Onboarding] Exchange Claude code error:', message)
      return { success: false, error: message }
    }
  })

  // Check if there's a valid OAuth state in progress
  server.handle(RPC_CHANNELS.onboarding.HAS_CLAUDE_OAUTH_STATE, async () => {
    return hasValidOAuthState()
  })

  // Clear OAuth state (for cancel/reset)
  server.handle(RPC_CHANNELS.onboarding.CLEAR_CLAUDE_OAUTH_STATE, async () => {
    clearOAuthState()
    return { success: true }
  })

  // User chose "Setup later" — persist so onboarding doesn't re-show on next launch
  server.handle(RPC_CHANNELS.onboarding.DEFER_SETUP, async () => {
    setSetupDeferred(true)
    log?.info('[Onboarding] User deferred setup')
    return { success: true }
  })
}
