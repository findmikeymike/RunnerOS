import { createHash, randomUUID } from 'node:crypto'
import WebSocket from 'ws'

import {
  PROVIDER_READ_VERIFICATION_SCHEMA_VERSION,
  providerReadVerificationSchema,
  type ProviderReadVerification,
  type TradingConnection,
} from '@trade-god/contracts'

import {
  ExecutionGatewayError,
  TradovateApiAdapter,
  TradovateFetchClient,
  TradovateSessionManager,
  TradovateUserSyncClient,
  parseTradovateCredential,
  serializeTradovateCredential,
  sha256,
  tokenFingerprint,
  type FileTradingConnectionStore,
  type TradovateFetch,
  type TradovateUserSyncGap,
  type TradovateUserSyncHealth,
  type TradovateUserSyncHint,
  type TradovateUserSyncSocket,
} from '@trade-god/execution'

import {
  credentialRef,
  secretName,
  type TradingAdapterCertificationRegistry,
  type TradingCredentialVault,
} from './trading-connection-service.ts'

export interface TradovatePaperRuntime {
  adapter: TradovateApiAdapter
  certificationRegistry: TradingAdapterCertificationRegistry
  verifyReadOnly(connection: TradingConnection): Promise<ProviderReadVerification>
  refreshUserSync(
    connections: TradingConnection[],
    callbacks: {
      onHint(hint: TradovateUserSyncHint): void | Promise<void>
      onGap(gap: TradovateUserSyncGap): void | Promise<void>
    },
  ): Promise<void>
  userSyncHealth(): TradovateUserSyncHealth[]
  stop(): void
}

/** One vault-backed renewable Tradovate demo session and one gateway adapter authority. */
export const createTradovatePaperRuntime = (options: {
  connectionStore: FileTradingConnectionStore
  vault: TradingCredentialVault
  now: () => string
  fetch?: TradovateFetch
  socketFactory?: (url: string) => TradovateUserSyncSocket
}): TradovatePaperRuntime => {
  const connectionForCredentialRef = async (reference: string) => {
    const matches = (await options.connectionStore.list()).filter((connection) => (
      connection.platform.slug === 'tradovate'
      && connection.environment === 'paper'
      && connection.credential_ref === reference
      && credentialRef(connection.connection_id) === reference
    ))
    if (matches.length !== 1) {
      throw new ExecutionGatewayError(
        'CONNECTION_UNAVAILABLE',
        'Tradovate credential reference does not resolve to exactly one paper account.',
      )
    }
    return matches[0]!
  }
  const sessionManager = new TradovateSessionManager({
    now: options.now,
    ...(options.fetch ? { fetch: options.fetch } : {}),
    resolveCredential: async (reference) => {
      const connection = await connectionForCredentialRef(reference)
      const raw = await options.vault.getSecret(secretName(connection.connection_id))
      return raw ? parseTradovateCredential(raw) : null
    },
    rotateCredential: async ({ credentialRef: reference, expectedTokenFingerprint, credential }) => {
      const connection = await connectionForCredentialRef(reference)
      const vaultName = secretName(connection.connection_id)
      const currentRaw = await options.vault.getSecret(vaultName)
      if (!currentRaw) {
        throw new ExecutionGatewayError('CONNECTION_UNAVAILABLE', 'Tradovate credential disappeared during rotation.')
      }
      const current = parseTradovateCredential(currentRaw)
      if (tokenFingerprint(current.access_token) !== expectedTokenFingerprint) {
        throw new ExecutionGatewayError(
          'RECORD_INTEGRITY_FAILURE',
          'Tradovate credential changed during token rotation.',
        )
      }
      const rotated = await options.vault.compareAndSetSecret(
        vaultName,
        createHash('sha256').update(currentRaw).digest('hex'),
        serializeTradovateCredential(credential),
      )
      if (!rotated) {
        throw new ExecutionGatewayError(
          'RECORD_INTEGRITY_FAILURE',
          'Tradovate credential changed before encrypted rotation completed.',
        )
      }
    },
  })
  const adapter = new TradovateApiAdapter(
    new TradovateFetchClient({
      sessionManager,
      now: options.now,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    }),
    options.now,
    { userSyncAvailable: true },
  )
  const feeds = new Map<string, { updatedAt: string; client: TradovateUserSyncClient }>()
  let feedQueue: Promise<void> = Promise.resolve()
  let stopped = false
  return {
    adapter,
    certificationRegistry: {
      resolve: (connection) => adapter.supports(connection) ? {
        adapter_id: adapter.descriptor.adapter_id,
        adapter_version: adapter.descriptor.adapter_version,
        provider_contract_version: adapter.descriptor.provider_contract_version,
        capabilities: adapter.descriptor.capabilities,
      } : null,
    },
    verifyReadOnly: async (connection) => {
      if (!adapter.supports(connection)) {
        throw new ExecutionGatewayError(
          'CONNECTION_UNAVAILABLE',
          'Read-only verification requires the attached Tradovate paper adapter.',
        )
      }
      await adapter.connect(connection)
      const snapshot = await adapter.snapshotAccount(connection)
      if (
        snapshot.connection_id !== connection.connection_id
        || snapshot.account_ref !== connection.account_ref
        || snapshot.environment !== connection.environment
        || !snapshot.can_trade
      ) {
        throw new ExecutionGatewayError(
          'ACCOUNT_MISMATCH',
          'Tradovate read-only verification did not prove the exact tradable paper account.',
        )
      }
      const unsigned = {
        verification_schema_version: PROVIDER_READ_VERIFICATION_SCHEMA_VERSION,
        verification_id: `provider-read-${randomUUID()}`,
        connection_id: connection.connection_id,
        account_ref: connection.account_ref,
        provider_slug: connection.platform.slug,
        environment: connection.environment,
        adapter_id: adapter.descriptor.adapter_id,
        adapter_version: adapter.descriptor.adapter_version,
        provider_contract_version: adapter.descriptor.provider_contract_version,
        capabilities_checksum: sha256(adapter.descriptor.capabilities),
        account_snapshot_id: snapshot.account_snapshot_id,
        account_snapshot_checksum: sha256(snapshot),
        captured_at: snapshot.captured_at,
        can_trade: true as const,
        position_count: snapshot.positions.length,
        working_order_count: snapshot.working_orders.length,
        verified_at: options.now(),
      }
      return providerReadVerificationSchema.parse({
        ...unsigned,
        content_checksum: sha256(unsigned),
      })
    },
    refreshUserSync: async (connections, callbacks) => {
      const operation = feedQueue.then(async () => {
        if (stopped) return
        const eligible = new Map(connections.filter((connection) => (
          connection.platform.slug === 'tradovate'
          && connection.environment === 'paper'
          && connection.transport_preference === 'api'
          && Boolean(connection.credential_ref)
        )).map((connection) => [connection.connection_id, connection]))
        for (const [connectionId, feed] of feeds) {
          const current = eligible.get(connectionId)
          if (current && current.updated_at === feed.updatedAt) continue
          feed.client.stop()
          feeds.delete(connectionId)
        }
        for (const connection of eligible.values()) {
          if (feeds.has(connection.connection_id)) continue
          const client = new TradovateUserSyncClient({
            connection,
            sessionManager,
            socketFactory: options.socketFactory ?? ((url) => (
              new WebSocket(url) as unknown as TradovateUserSyncSocket
            )),
            onHint: callbacks.onHint,
            onGap: callbacks.onGap,
            now: options.now,
          })
          feeds.set(connection.connection_id, { updatedAt: connection.updated_at, client })
          await client.start()
        }
      })
      feedQueue = operation.catch(() => undefined)
      return operation
    },
    userSyncHealth: () => [...feeds.values()]
      .map((feed) => feed.client.health())
      .sort((left, right) => left.connection_id.localeCompare(right.connection_id)),
    stop: () => {
      stopped = true
      for (const feed of feeds.values()) feed.client.stop()
      feeds.clear()
      sessionManager.stop()
    },
  }
}
