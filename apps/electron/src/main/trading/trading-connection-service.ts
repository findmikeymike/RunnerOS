import { createHash } from 'node:crypto'

import {
  tradingConnectionSchema,
  type TradingConnection,
} from '@trade-god/contracts'
import { FileTradingConnectionStore } from '@trade-god/execution'

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
}

export class TradingConnectionService {
  constructor(
    private readonly store: FileTradingConnectionStore,
    private readonly vault: TradingCredentialVault,
    private readonly browser: TradingBrowserSessionLauncher,
  ) {}

  async list(): Promise<TradingConnectionStatus[]> {
    return Promise.all((await this.store.list()).map((connection) => this.status(connection)))
  }

  async save(input: SaveTradingConnectionInput): Promise<TradingConnectionStatus> {
    const suppliedSecret = input.api_secret?.trim()
    const expectedCredentialRef = credentialRef(input.connection.connection_id)
    const expectedSessionRef = browserSessionRef(input.connection.connection_id)
    const connection = tradingConnectionSchema.parse({
      ...input.connection,
      ...(
        input.connection.transport_preference !== 'browser'
          ? { credential_ref: expectedCredentialRef }
          : { credential_ref: undefined }
      ),
      ...(
        input.connection.transport_preference !== 'api'
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
