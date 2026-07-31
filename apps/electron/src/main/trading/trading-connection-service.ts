import { createHash } from 'node:crypto'

import {
  type AdapterCertificationEvidence,
  tradingConnectionSchema,
  type TradingConnection,
} from '@trade-god/contracts'
import {
  FileAdapterCertificationStore,
  FileTradingConnectionStore,
} from '@trade-god/execution'

export interface TradingCredentialVault {
  getSecret(name: string): Promise<string | null>
  setSecret(name: string, value: string): Promise<void>
  deleteSecret(name: string): Promise<boolean>
}

export interface TradingBrowserSessionLauncher {
  open(input: {
    connectionId: string
    sessionRef: string
    partition: string
    url: string
  }): Promise<{ browser_instance_id: string; session_ref: string }>
}

export interface SaveTradingConnectionInput {
  connection: TradingConnection
  api_secret?: string
}

export interface TradingConnectionStatus {
  connection: TradingConnection
  credential_configured: boolean
  browser_session_configured: boolean
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
    if (
      connection.transport_preference !== 'browser'
      && !suppliedSecret
      && !(await this.vault.getSecret(secretName(connection.connection_id)))
    ) {
        throw new Error('API transport requires credentials before the connection can be saved.')
    }
    const saved = await this.store.save(connection)
    if (suppliedSecret) {
      await this.vault.setSecret(secretName(connection.connection_id), suppliedSecret)
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
    const removed = await this.store.remove(connectionId)
    if (removed) await this.vault.deleteSecret(secretName(connectionId))
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

  async resolveCredential(connection: TradingConnection): Promise<string | null> {
    if (!connection.credential_ref || connection.credential_ref !== credentialRef(connection.connection_id)) {
      return null
    }
    return this.vault.getSecret(secretName(connection.connection_id))
  }

  private async status(connection: TradingConnection): Promise<TradingConnectionStatus> {
    const credentialConfigured = connection.credential_ref
      ? Boolean(await this.resolveCredential(connection))
      : false
    return {
      connection,
      credential_configured: credentialConfigured,
      browser_session_configured: Boolean(connection.browser_session_ref),
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
