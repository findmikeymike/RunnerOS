import { createHash } from 'node:crypto'

import {
  ExecutionGatewayError,
  TradovateApiAdapter,
  TradovateFetchClient,
  TradovateSessionManager,
  parseTradovateCredential,
  serializeTradovateCredential,
  tokenFingerprint,
  type FileTradingConnectionStore,
  type TradovateFetch,
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
  stop(): void
}

/** One vault-backed renewable Tradovate demo session and one gateway adapter authority. */
export const createTradovatePaperRuntime = (options: {
  connectionStore: FileTradingConnectionStore
  vault: TradingCredentialVault
  now: () => string
  fetch?: TradovateFetch
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
  )
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
    stop: () => sessionManager.stop(),
  }
}
