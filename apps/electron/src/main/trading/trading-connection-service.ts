import { createHash } from 'node:crypto'

import {
  type AdapterCertificationEvidence,
  tradingConnectionSchema,
  type TradingConnection,
} from '@trade-god/contracts'
import {
  FileAdapterCertificationStore,
  FileTradingConnectionStore,
  parseTradovateCredential,
  serializeTradovateCredential,
} from '@trade-god/execution'

export interface TradingCredentialVault {
  getSecret(name: string): Promise<string | null>
  setSecret(name: string, value: string): Promise<void>
  compareAndSetSecret(name: string, expectedValueSha256: string, value: string): Promise<boolean>
  deleteSecret(name: string): Promise<boolean>
}

export interface TradingBrowserSessionLauncher {
  open(input: {
    connectionId: string
    sessionRef: string
    partition: string
    url: string
  }): Promise<{ browser_instance_id: string; session_ref: string }>
  inspect(input: { connectionId: string }): Promise<{ url: string; title: string }>
  clear(input: { connectionId: string; partition: string }): Promise<void>
}

export interface SaveTradingConnectionInput {
  connection: TradingConnection
  api_secret?: string
}

export interface TradingConnectionStatus {
  connection: TradingConnection
  credential_configured: boolean
  browser_session_configured: boolean
  browser_login_confirmed: boolean
  certification_evidence: AdapterCertificationEvidence[]
}

export interface TradingAdapterCertificationBinding {
  adapter_id: string
  adapter_version: string
  provider_contract_version: string
}

export interface TradingAdapterCertificationRegistry {
  resolve(connection: TradingConnection): TradingAdapterCertificationBinding | null
}

const EMPTY_CAPABILITIES: TradingConnection['capabilities'] = {
  read_accounts: false,
  read_orders: false,
  read_positions: false,
  read_executions: false,
  submit_market: false,
  submit_limit: false,
  submit_stop: false,
  submit_stop_limit: false,
  native_bracket: false,
  native_oco: false,
  modify_order: false,
  cancel_order: false,
  partial_close: false,
  flatten: false,
  streaming_events: false,
}

export class TradingConnectionService {
  constructor(
    private readonly store: FileTradingConnectionStore,
    private readonly vault: TradingCredentialVault,
    private readonly browser: TradingBrowserSessionLauncher,
    private readonly certificationStore?: FileAdapterCertificationStore,
    private readonly certificationRegistry?: TradingAdapterCertificationRegistry,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async list(): Promise<TradingConnectionStatus[]> {
    return Promise.all((await this.store.list()).map((connection) => this.status(connection)))
  }

  async save(input: SaveTradingConnectionInput): Promise<TradingConnectionStatus> {
    const suppliedSecret = input.api_secret?.trim()
    const expectedCredentialRef = credentialRef(input.connection.connection_id)
    const expectedSessionRef = browserSessionRef(input.connection.connection_id)
    const existing = await this.store.get(input.connection.connection_id).catch(() => undefined)
    const transportPreference = existing?.transport_preference
      ?? input.connection.transport_preference
    const connection = tradingConnectionSchema.parse({
      ...input.connection,
      transport_preference: transportPreference,
      created_at: existing?.created_at ?? input.connection.created_at,
      risk_policy_ref: existing?.risk_policy_ref ?? input.connection.risk_policy_ref,
      authorization_basis_ref: existing?.authorization_basis_ref
        ?? input.connection.authorization_basis_ref,
      approval_policy_ref: existing?.approval_policy_ref ?? input.connection.approval_policy_ref,
      state: existing?.state ?? 'auth-required',
      capabilities: existing?.capabilities ?? EMPTY_CAPABILITIES,
      certifications: existing?.certifications ?? [],
      adapter_certifications: existing?.adapter_certifications ?? [],
      consequential_enabled_until: existing?.consequential_enabled_until,
      browser_login_confirmed_at: existing?.browser_login_confirmed_at,
      browser_login_origin: existing?.browser_login_origin,
      enabled: existing?.enabled ?? false,
      ...(
        transportPreference !== 'browser'
          ? { credential_ref: expectedCredentialRef }
          : { credential_ref: undefined }
      ),
      ...(
        transportPreference !== 'api'
          ? { browser_session_ref: expectedSessionRef }
          : { browser_session_ref: undefined }
      ),
    })
    const vaultName = secretName(connection.connection_id)
    const existingSecretRaw = connection.transport_preference !== 'browser'
      ? await this.vault.getSecret(vaultName)
      : null
    let canonicalSecretToStore: string | undefined
    if (connection.platform.slug === 'tradovate') {
      if (connection.environment !== 'paper' || connection.transport_preference !== 'api') {
        throw new Error('Tradovate adapter enrollment is restricted to API paper accounts.')
      }
      const raw = suppliedSecret ?? existingSecretRaw
      if (!raw) throw new Error('Tradovate access token bundle is required.')
      const credential = parseTradovateCredential(raw)
      if (
        String(credential.account_id) !== connection.account_ref
        || credential.account_spec !== connection.account_display.label
      ) {
        throw new Error('Tradovate credential account ID and account label must match the connection.')
      }
      if (suppliedSecret) canonicalSecretToStore = serializeTradovateCredential(credential)
    }
    if (
      connection.transport_preference !== 'browser'
      && !suppliedSecret
      && !existingSecretRaw
    ) {
        throw new Error('API transport requires credentials before the connection can be saved.')
    }
    const saved = await this.store.save(connection)
    if (canonicalSecretToStore) {
      if (existingSecretRaw) {
        const replaced = await this.vault.compareAndSetSecret(
          vaultName,
          createHash('sha256').update(existingSecretRaw).digest('hex'),
          canonicalSecretToStore,
        )
        if (!replaced) {
          throw new Error('Tradovate credential changed during account save; reload and try again.')
        }
      } else await this.vault.setSecret(vaultName, canonicalSecretToStore)
    } else if (suppliedSecret) {
      await this.vault.setSecret(vaultName, suppliedSecret)
    }
    return this.status(saved)
  }

  async applyCertification(certificationId: string): Promise<TradingConnectionStatus> {
    if (!this.certificationStore) {
      throw new Error('Adapter certification evidence store is not configured.')
    }
    const evidence = await this.certificationStore.get(certificationId)
    const connection = await this.store.get(evidence.connection_id)
    if (
      connection.account_ref !== evidence.account_ref
      || connection.platform.slug !== evidence.provider_slug
      || connection.environment !== evidence.environment
      || (
        connection.transport_preference !== 'auto'
        && connection.transport_preference !== evidence.transport
      )
    ) {
      throw new Error('Certification evidence does not match the exact connection identity.')
    }
    if (
      evidence.environment !== 'paper'
      || !evidence.eligible_certifications.includes('paper-lifecycle-certified')
    ) {
      throw new Error('Only complete paper lifecycle evidence can certify this connection.')
    }
    const installed = this.certificationRegistry?.resolve(connection)
    if (
      !installed
      || installed.adapter_id !== evidence.adapter_id
      || installed.adapter_version !== evidence.adapter_version
      || installed.provider_contract_version !== evidence.provider_contract_version
    ) {
      throw new Error('Certification evidence does not match the installed adapter contract.')
    }
    const saved = await this.store.save(tradingConnectionSchema.parse({
      ...connection,
      state: 'ready',
      capabilities: evidence.certified_capabilities,
      certifications: evidence.eligible_certifications,
      adapter_certifications: [{
        certification_id: evidence.certification_id,
        adapter_id: evidence.adapter_id,
        adapter_version: evidence.adapter_version,
        provider_contract_version: evidence.provider_contract_version,
        transport: evidence.transport,
        levels: evidence.eligible_certifications,
      }],
      enabled: false,
      consequential_enabled_until: undefined,
      updated_at: this.now(),
    }))
    return this.status(saved)
  }

  async remove(connectionId: string): Promise<boolean> {
    const connection = await this.store.get(connectionId).catch(() => null)
    if (connection?.browser_session_ref) {
      await this.browser.clear({
        connectionId,
        partition: `persist:${connection.browser_session_ref}`,
      })
    }
    const removed = await this.store.remove(connectionId)
    if (removed) {
      await this.vault.deleteSecret(secretName(connectionId))
    }
    return removed
  }

  async openBrowserLogin(connectionId: string): Promise<{
    browser_instance_id: string
    session_ref: string
  }> {
    const connection = await this.store.get(connectionId)
    if (
      connection.transport_preference === 'api'
      || !connection.browser_session_ref
    ) {
      throw new Error('This trading connection does not have a browser route.')
    }
    return this.browser.open({
      connectionId,
      sessionRef: connection.browser_session_ref,
      partition: `persist:${connection.browser_session_ref}`,
      url: loginUrl(connection.platform.slug),
    })
  }

  async confirmBrowserLogin(connectionId: string): Promise<TradingConnectionStatus> {
    const connection = await this.store.get(connectionId)
    if (connection.transport_preference !== 'browser' || !connection.browser_session_ref) {
      throw new Error('This trading connection does not have a browser route.')
    }
    const inspected = await this.browser.inspect({ connectionId })
    const expectedOrigin = loginOrigin(connection.platform.slug)
    const actualOrigin = new URL(inspected.url).origin
    if (actualOrigin !== expectedOrigin) {
      throw new Error(`Provider-page confirmation refused: browser is on ${actualOrigin}, not ${expectedOrigin}.`)
    }
    const saved = await this.store.save(tradingConnectionSchema.parse({
      ...connection,
      browser_login_confirmed_at: this.now(),
      browser_login_origin: actualOrigin,
      updated_at: this.now(),
    }))
    return this.status(saved)
  }

  async resolveCredential(connection: TradingConnection): Promise<string | null> {
    if (!connection.credential_ref || connection.credential_ref !== credentialRef(connection.connection_id)) {
      return null
    }
    return this.vault.getSecret(secretName(connection.connection_id))
  }

  private async status(connection: TradingConnection): Promise<TradingConnectionStatus> {
    let credentialConfigured = false
    if (connection.credential_ref) {
      const raw = await this.resolveCredential(connection)
      if (raw) {
        if (connection.platform.slug === 'tradovate') {
          try {
            const credential = parseTradovateCredential(raw)
            credentialConfigured = (
              String(credential.account_id) === connection.account_ref
              && credential.account_spec === connection.account_display.label
              && Date.parse(credential.expires_at!) > Date.parse(this.now())
            )
          } catch { credentialConfigured = false }
        } else credentialConfigured = true
      }
    }
    return {
      connection,
      credential_configured: credentialConfigured,
      browser_session_configured: Boolean(connection.browser_session_ref),
      browser_login_confirmed: Boolean(
        connection.browser_login_confirmed_at
        && connection.browser_login_origin === loginOriginOrNull(connection.platform.slug),
      ),
      certification_evidence: this.certificationStore
        ? await this.certificationStore.list(connection.connection_id)
        : [],
    }
  }
}

const stableSuffix = (connectionId: string): string => (
  createHash('sha256').update(connectionId).digest('hex').slice(0, 24)
)

export const credentialRef = (connectionId: string): string => (
  `trade-credential-${stableSuffix(connectionId)}`
)

export const browserSessionRef = (connectionId: string): string => (
  `trade-browser-${stableSuffix(connectionId)}`
)

export const secretName = (connectionId: string): string => (
  `TRADE_GOD_CONNECTION_${stableSuffix(connectionId).toUpperCase()}`
)

const loginUrl = (platformSlug: string): string => {
  if (platformSlug === 'wealthcharts') return 'https://www.wealthcharts.com/'
  throw new Error(`No certified browser login origin exists for ${platformSlug}.`)
}

const loginOrigin = (platformSlug: string): string => new URL(loginUrl(platformSlug)).origin

const loginOriginOrNull = (platformSlug: string): string | null => {
  try { return loginOrigin(platformSlug) } catch { return null }
}
