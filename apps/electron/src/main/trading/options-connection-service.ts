import { createHash, createHmac, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  OPTIONS_CONNECTION_SCHEMA_VERSION,
  OPTIONS_PROVIDER_READ_PROOF_SCHEMA_VERSION,
  optionsConnectionSchema,
  optionsProviderReadProofSchema,
  type OptionsConnection,
  type OptionsProvider,
  type OptionsProviderReadProof,
} from '@trade-god/contracts'
import { canonicalJson, sha256 } from '@trade-god/execution'

import type { TradingCredentialVault } from './trading-connection-service.ts'

const IBKR_ENDPOINT = 'https://api.ibkr.com/v1/api'
const WEBULL_ENDPOINT = 'https://api.sandbox.webull.com'
const PROOF_TTL_MS = 10 * 60 * 1000
const ADAPTER_VERSION = '1.0.0'

const providerContract = (provider: OptionsProvider): { adapterId: string; contractVersion: string } => provider === 'ibkr'
  ? { adapterId: 'ibkr-options-api', contractVersion: 'ibkr-web-api-options-paper-2026-08-26' }
  : { adapterId: 'webull-options-api', contractVersion: 'webull-trading-api-options-sandbox-2026-08-26' }

export interface SaveOptionsConnectionInput {
  connection_id?: string
  provider: OptionsProvider
  account_ref: string
  account_label: string
  credential: string
}

export interface OptionsConnectionStatus {
  connection: OptionsConnection
  credential_configured: boolean
  provider_read_proof?: OptionsProviderReadProof
  provider_read_verified: boolean
  provider_read_fresh: boolean
}

export interface OptionsProviderReadVerifier {
  verify(connection: OptionsConnection, credential: string): Promise<OptionsProviderReadProof>
}

interface FetchResponseLike {
  ok: boolean
  status: number
  json(): Promise<unknown>
}

type FetchLike = (input: string, init?: RequestInit) => Promise<FetchResponseLike>

const checksumRecord = <T extends { content_checksum: string }>(value: T): string => {
  const { content_checksum: _checksum, ...unsigned } = value
  return sha256(unsigned)
}

const seal = <T extends { content_checksum: string }>(value: T): T => ({
  ...value,
  content_checksum: checksumRecord(value),
})

const assertSealed = <T extends { content_checksum: string }>(value: T, label: string): T => {
  if (checksumRecord(value) !== value.content_checksum) throw new Error(`${label} checksum is invalid.`)
  return value
}

const credentialName = (connectionId: string): string => `options-connection-${connectionId}`
const credentialRef = (connectionId: string): string => `vault-options-${connectionId}`

const normalizeId = (value: string): string => {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
  if (!normalized) throw new Error('Connection name is invalid.')
  return normalized.slice(0, 80)
}

const parseCredential = (provider: OptionsProvider, raw: string): Record<string, string> => {
  let value: unknown
  try { value = JSON.parse(raw) } catch { throw new Error(`${provider === 'ibkr' ? 'IBKR' : 'Webull'} credentials must be valid JSON.`) }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Credential bundle must be an object.')
  const record = value as Record<string, unknown>
  if (provider === 'ibkr') {
    if (typeof record.access_token !== 'string' || record.access_token.trim().length < 16) {
      throw new Error('IBKR OAuth access token is required.')
    }
    return { access_token: record.access_token.trim() }
  }
  if (typeof record.app_key !== 'string' || record.app_key.trim().length < 8) throw new Error('Webull App Key is required.')
  if (typeof record.app_secret !== 'string' || record.app_secret.trim().length < 16) throw new Error('Webull App Secret is required.')
  if (record.access_token !== undefined && (typeof record.access_token !== 'string' || record.access_token.trim().length < 8)) {
    throw new Error('Webull access token is invalid.')
  }
  return {
    app_key: record.app_key.trim(),
    app_secret: record.app_secret.trim(),
    ...(typeof record.access_token === 'string' ? { access_token: record.access_token.trim() } : {}),
  }
}

class FileOptionsConnectionStore {
  private readonly connectionsDirectory: string
  private readonly proofsDirectory: string

  constructor(private readonly rootDirectory: string) {
    this.connectionsDirectory = path.join(rootDirectory, 'connections')
    this.proofsDirectory = path.join(rootDirectory, 'read-proofs')
  }

  async list(): Promise<OptionsConnection[]> {
    await mkdir(this.connectionsDirectory, { recursive: true })
    const names = (await readdir(this.connectionsDirectory)).filter((name) => name.endsWith('.json')).sort()
    return Promise.all(names.map(async (name) => {
      const parsed = optionsConnectionSchema.parse(JSON.parse(await readFile(path.join(this.connectionsDirectory, name), 'utf8')))
      if (name !== `${parsed.connection_id}.json`) throw new Error('Options connection filename does not match its identity.')
      return assertSealed(parsed, 'Options connection')
    }))
  }

  async get(connectionId: string): Promise<OptionsConnection> {
    const parsed = optionsConnectionSchema.parse(JSON.parse(await readFile(this.connectionPath(connectionId), 'utf8')))
    if (parsed.connection_id !== connectionId) throw new Error('Options connection identity does not match its file.')
    return assertSealed(parsed, 'Options connection')
  }

  async save(connection: OptionsConnection): Promise<OptionsConnection> {
    const parsed = assertSealed(optionsConnectionSchema.parse(connection), 'Options connection')
    await this.writeAtomic(this.connectionPath(parsed.connection_id), parsed)
    return parsed
  }

  async remove(connectionId: string): Promise<boolean> {
    let removed = false
    for (const file of [this.connectionPath(connectionId), this.activeProofPath(connectionId)]) {
      try { await unlink(file); removed = true } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
    return removed
  }

  async getProof(connectionId: string): Promise<OptionsProviderReadProof | undefined> {
    try {
      const pointer = JSON.parse(await readFile(this.activeProofPath(connectionId), 'utf8')) as Record<string, unknown>
      if (
        pointer.connection_id !== connectionId
        || typeof pointer.proof_id !== 'string'
        || typeof pointer.proof_checksum !== 'string'
        || typeof pointer.content_checksum !== 'string'
        || sha256({ connection_id: pointer.connection_id, proof_id: pointer.proof_id, proof_checksum: pointer.proof_checksum }) !== pointer.content_checksum
      ) throw new Error('Options provider proof pointer is invalid.')
      const parsed = optionsProviderReadProofSchema.parse(JSON.parse(await readFile(this.proofPath(connectionId, pointer.proof_id), 'utf8')))
      if (parsed.connection_id !== connectionId) throw new Error('Options provider proof identity does not match its file.')
      assertSealed(parsed, 'Options provider proof')
      if (parsed.proof_id !== pointer.proof_id || parsed.content_checksum !== pointer.proof_checksum) {
        throw new Error('Options provider proof pointer does not match immutable evidence.')
      }
      return parsed
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  }

  async saveProof(proof: OptionsProviderReadProof): Promise<OptionsProviderReadProof> {
    const parsed = assertSealed(optionsProviderReadProofSchema.parse(proof), 'Options provider proof')
    const proofPath = this.proofPath(parsed.connection_id, parsed.proof_id)
    await mkdir(path.dirname(proofPath), { recursive: true })
    try {
      await writeFile(proofPath, `${canonicalJson(parsed)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const existing = optionsProviderReadProofSchema.parse(JSON.parse(await readFile(proofPath, 'utf8')))
      if (canonicalJson(existing) !== canonicalJson(parsed)) throw new Error('Immutable options proof ID collision.')
    }
    const pointerBody = {
      connection_id: parsed.connection_id,
      proof_id: parsed.proof_id,
      proof_checksum: parsed.content_checksum,
    }
    await this.writeAtomic(this.activeProofPath(parsed.connection_id), {
      ...pointerBody,
      content_checksum: sha256(pointerBody),
    })
    return parsed
  }

  async removeProof(connectionId: string): Promise<void> {
    try { await unlink(this.activeProofPath(connectionId)) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  private connectionPath(connectionId: string): string {
    return path.join(this.connectionsDirectory, `${normalizeId(connectionId)}.json`)
  }

  private proofPath(connectionId: string, proofId: string): string {
    return path.join(this.proofsDirectory, normalizeId(connectionId), `${normalizeId(proofId)}.json`)
  }

  private activeProofPath(connectionId: string): string {
    return path.join(this.proofsDirectory, normalizeId(connectionId), 'active.json')
  }

  private async writeAtomic(filePath: string, value: unknown): Promise<void> {
    await mkdir(path.dirname(filePath), { recursive: true })
    const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`
    await writeFile(temporary, `${canonicalJson(value)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    await rename(temporary, filePath)
  }
}

export class OptionsConnectionService {
  private readonly store: FileOptionsConnectionStore
  private mutationQueue: Promise<void> = Promise.resolve()

  constructor(
    rootDirectory: string,
    private readonly vault: TradingCredentialVault,
    private readonly verifier: OptionsProviderReadVerifier,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    this.store = new FileOptionsConnectionStore(rootDirectory)
  }

  async list(): Promise<OptionsConnectionStatus[]> {
    return Promise.all((await this.store.list()).map((connection) => this.status(connection)))
  }

  async save(input: SaveOptionsConnectionInput): Promise<OptionsConnectionStatus> {
    return this.withMutationLock(async () => {
      const provider = input.provider
      const connectionId = normalizeId(input.connection_id ?? `${provider}-${input.account_ref}`)
      const credential = canonicalJson(parseCredential(provider, input.credential.trim()))
      const generation = createHash('sha256').update(randomUUID()).digest('hex')
      let existing: OptionsConnection | undefined
      try { existing = await this.store.get(connectionId) } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      if (existing && (existing.provider !== provider || existing.account_ref !== input.account_ref.trim())) {
        throw new Error('Provider and account identity cannot be changed. Remove this connection first.')
      }
      const now = this.now()
      const adapter = providerContract(provider)
      const connection = seal(optionsConnectionSchema.parse({
        connection_schema_version: OPTIONS_CONNECTION_SCHEMA_VERSION,
        connection_id: connectionId,
        provider,
        environment: provider === 'ibkr' ? 'paper' : 'sandbox',
        auth_profile: provider === 'ibkr' ? 'ibkr-oauth-access-token' : 'webull-individual-hmac',
        adapter_id: adapter.adapterId,
        adapter_version: ADAPTER_VERSION,
        provider_contract_version: adapter.contractVersion,
        account_ref: input.account_ref.trim(),
        account_label: input.account_label.trim(),
        endpoint: provider === 'ibkr' ? IBKR_ENDPOINT : WEBULL_ENDPOINT,
        credential_ref: credentialRef(connectionId),
        credential_generation: generation,
        state: 'credentials-saved',
        read_only: true,
        execution_enabled: false,
        created_at: existing?.created_at ?? now,
        updated_at: now,
        content_checksum: '0'.repeat(64),
      }))
      await this.store.removeProof(connectionId)
      await this.vault.setSecret(credentialName(connectionId), credential)
      await this.store.save(connection)
      return this.status(connection)
    })
  }

  async verify(connectionId: string): Promise<OptionsConnectionStatus> {
    return this.withMutationLock(async () => {
      const connection = await this.store.get(connectionId)
      await this.store.removeProof(connectionId)
      const credential = await this.vault.getSecret(credentialName(connectionId))
      if (!credential) throw new Error('Saved provider credentials are missing.')
      const proof = await this.verifier.verify(connection, credential)
      const current = await this.store.get(connectionId)
      if (current.content_checksum !== connection.content_checksum) throw new Error('Account changed during verification. Try again.')
      if (
        proof.connection_id !== connection.connection_id
        || proof.connection_checksum !== connection.content_checksum
        || proof.credential_generation !== connection.credential_generation
        || proof.adapter_id !== connection.adapter_id
        || proof.adapter_version !== connection.adapter_version
        || proof.provider_contract_version !== connection.provider_contract_version
        || proof.account_ref !== connection.account_ref
        || proof.provider !== connection.provider
      ) throw new Error('Provider proof does not match this account.')
      const updated = seal({ ...connection, state: 'read-only-verified' as const, updated_at: this.now(), content_checksum: connection.content_checksum })
      await this.store.save(updated)
      await this.store.saveProof(seal({
        ...proof,
        connection_checksum: updated.content_checksum,
        content_checksum: proof.content_checksum,
      }))
      return this.status(updated)
    })
  }

  async remove(connectionId: string): Promise<boolean> {
    return this.withMutationLock(async () => {
      const removed = await this.store.remove(connectionId)
      await this.vault.deleteSecret(credentialName(connectionId))
      return removed
    })
  }

  private async status(connection: OptionsConnection): Promise<OptionsConnectionStatus> {
    const [credential, proof] = await Promise.all([
      this.vault.getSecret(credentialName(connection.connection_id)),
      this.store.getProof(connection.connection_id),
    ])
    const proofMatches = Boolean(
      proof
      && proof.connection_checksum === connection.content_checksum
      && proof.credential_generation === connection.credential_generation
      && proof.adapter_id === connection.adapter_id
      && proof.adapter_version === connection.adapter_version
      && proof.provider_contract_version === connection.provider_contract_version
    )
    return {
      connection,
      credential_configured: Boolean(credential),
      ...(proofMatches ? { provider_read_proof: proof } : {}),
      provider_read_verified: proofMatches,
      provider_read_fresh: proofMatches && Date.parse(proof!.expires_at) > Date.parse(this.now()),
    }
  }

  private async withMutationLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.mutationQueue
    let release!: () => void
    this.mutationQueue = new Promise<void>((resolve) => { release = resolve })
    await previous
    try { return await operation() } finally { release() }
  }
}

export class ReadOnlyOptionsProviderVerifier implements OptionsProviderReadVerifier {
  constructor(
    private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async verify(connection: OptionsConnection, credentialRaw: string): Promise<OptionsProviderReadProof> {
    const credential = parseCredential(connection.provider, credentialRaw)
    return connection.provider === 'ibkr'
      ? this.verifyIbkr(connection, credential)
      : this.verifyWebull(connection, credential)
  }

  private async verifyIbkr(connection: OptionsConnection, credential: Record<string, string>): Promise<OptionsProviderReadProof> {
    if (connection.endpoint !== IBKR_ENDPOINT || !/^DU\d+$/i.test(connection.account_ref)) {
      throw new Error('IBKR read-only enrollment requires an exact paper account and official API endpoint.')
    }
    const headers = { Authorization: `Bearer ${credential.access_token}`, Accept: 'application/json' }
    const auth = await this.json(`${IBKR_ENDPOINT}/iserver/auth/status`, { method: 'POST', headers }) as Record<string, unknown>
    if (auth.authenticated !== true || auth.connected !== true || auth.competing === true) {
      throw new Error('IBKR paper session is not authenticated or another session is competing.')
    }
    const accounts = await this.json(`${IBKR_ENDPOINT}/portfolio/accounts`, { headers })
    const account = asArray(accounts).find((item) => stringField(item, ['accountId', 'id']) === connection.account_ref)
    if (!account) throw new Error('IBKR did not return the exact configured paper account.')
    const [positions, orders, summary] = await Promise.all([
      this.json(`${IBKR_ENDPOINT}/portfolio/${encodeURIComponent(connection.account_ref)}/positions/0`, { headers }),
      this.json(`${IBKR_ENDPOINT}/iserver/account/orders`, { headers }),
      this.json(`${IBKR_ENDPOINT}/portfolio/${encodeURIComponent(connection.account_ref)}/summary`, { headers }),
    ])
    const orderList = asArray((orders as Record<string, unknown>)?.orders ?? orders)
      .filter((item) => !stringField(item, ['acct', 'account', 'accountId']) || stringField(item, ['acct', 'account', 'accountId']) === connection.account_ref)
    return this.proof(connection, {
      positionCount: asArray(positions).length,
      openOrderCount: orderList.length,
      currency: stringField(account, ['currency']) || 'USD',
      netLiquidation: decimalField(summary, ['netliquidation', 'netLiquidation']),
      buyingPower: decimalField(summary, ['buyingpower', 'buyingPower']),
      optionContractsReadable: false,
      optionQuotesReadable: false,
      optionQuotesRealtime: false,
      evidence: ['Authenticated IBKR brokerage session', 'Exact paper account matched', 'Balances, positions, and open orders readable', 'Options quote entitlement still needs a live contract check'],
    })
  }

  private async verifyWebull(connection: OptionsConnection, credential: Record<string, string>): Promise<OptionsProviderReadProof> {
    if (connection.endpoint !== WEBULL_ENDPOINT) throw new Error('Webull read-only enrollment is restricted to the official sandbox endpoint.')
    const accounts = await this.webullGet('/trading/accounts/list', credential)
    const account = asArray((accounts as Record<string, unknown>)?.data ?? accounts)
      .find((item) => stringField(item, ['account_id', 'accountId']) === connection.account_ref)
    if (!account) throw new Error('Webull did not return the exact configured sandbox account.')
    const query = { account_id: connection.account_ref }
    const [balance, positions, orders] = await Promise.all([
      this.webullGet('/trading/assets/balances/get', credential, query),
      this.webullGet('/trading/assets/positions/list', credential, query),
      this.webullGet('/trading/orders/open-orders/list', credential, query),
    ])
    return this.proof(connection, {
      positionCount: asArray((positions as Record<string, unknown>)?.data ?? positions).length,
      openOrderCount: asArray((orders as Record<string, unknown>)?.data ?? orders).length,
      currency: stringField(balance, ['currency']) || 'USD',
      netLiquidation: decimalField(balance, ['net_liquidation', 'netLiquidation', 'total_asset']),
      buyingPower: decimalField(balance, ['buying_power', 'buyingPower']),
      optionContractsReadable: false,
      optionQuotesReadable: false,
      optionQuotesRealtime: false,
      evidence: ['Signed Webull sandbox request accepted', 'Exact sandbox account matched', 'Balances, positions, and open orders readable', 'OPRA option quote entitlement still needs a live contract check'],
    })
  }

  private proof(connection: OptionsConnection, evidence: {
    positionCount: number
    openOrderCount: number
    currency: string
    netLiquidation?: string
    buyingPower?: string
    optionContractsReadable: boolean
    optionQuotesReadable: boolean
    optionQuotesRealtime: boolean
    evidence: string[]
  }): OptionsProviderReadProof {
    const verifiedAt = this.now()
    return seal(optionsProviderReadProofSchema.parse({
      proof_schema_version: OPTIONS_PROVIDER_READ_PROOF_SCHEMA_VERSION,
      proof_id: `proof-${randomUUID()}`,
      connection_id: connection.connection_id,
      connection_checksum: connection.content_checksum,
      credential_generation: connection.credential_generation,
      adapter_id: connection.adapter_id,
      adapter_version: connection.adapter_version,
      provider_contract_version: connection.provider_contract_version,
      provider: connection.provider,
      environment: connection.environment,
      account_ref: connection.account_ref,
      account_label: connection.account_label,
      authenticated: true,
      account_matched: true,
      balances_readable: true,
      positions_readable: true,
      open_orders_readable: true,
      option_contracts_readable: evidence.optionContractsReadable,
      option_quotes_readable: evidence.optionQuotesReadable,
      option_quotes_realtime: evidence.optionQuotesRealtime,
      position_count: evidence.positionCount,
      open_order_count: evidence.openOrderCount,
      currency: evidence.currency,
      ...(evidence.netLiquidation ? { net_liquidation: evidence.netLiquidation } : {}),
      ...(evidence.buyingPower ? { buying_power: evidence.buyingPower } : {}),
      verified_at: verifiedAt,
      expires_at: new Date(Date.parse(verifiedAt) + PROOF_TTL_MS).toISOString(),
      safe_evidence: evidence.evidence,
      content_checksum: '0'.repeat(64),
    }))
  }

  private async webullGet(pathname: string, credential: Record<string, string>, query: Record<string, string> = {}): Promise<unknown> {
    const url = new URL(`${WEBULL_ENDPOINT}${pathname}`)
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
    const timestamp = this.now().replace(/\.\d{3}Z$/, 'Z')
    const nonce = randomUUID().replaceAll('-', '')
    const signature = createWebullSignature({
      pathname,
      query,
      appKey: credential.app_key!,
      appSecret: credential.app_secret!,
      host: url.host,
      timestamp,
      nonce,
    })
    return this.json(url.toString(), {
      headers: {
        Accept: 'application/json',
        'x-app-key': credential.app_key!,
        'x-timestamp': timestamp,
        'x-signature': signature,
        'x-signature-algorithm': 'HMAC-SHA1',
        'x-signature-version': '1.0',
        'x-signature-nonce': nonce,
        'x-version': 'v2',
        ...(credential.access_token ? { 'x-access-token': credential.access_token } : {}),
      },
    })
  }

  private async json(url: string, init?: RequestInit): Promise<unknown> {
    const response = await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(10_000) })
    if (!response.ok) throw new Error(`Provider read failed with HTTP ${response.status}.`)
    return response.json()
  }
}

const encodeRfc3986 = (value: string): string => encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)

export function createWebullSignature(input: {
  pathname: string
  query?: Record<string, string>
  body?: string
  appKey: string
  appSecret: string
  host: string
  timestamp: string
  nonce: string
}): string {
  const signing: Record<string, string> = {
    ...(input.query ?? {}),
    host: input.host,
    'x-app-key': input.appKey,
    'x-signature-algorithm': 'HMAC-SHA1',
    'x-signature-nonce': input.nonce,
    'x-signature-version': '1.0',
    'x-timestamp': input.timestamp,
  }
  const joined = Object.keys(signing).sort().map((key) => `${key}=${signing[key]}`).join('&')
  const bodyHash = input.body
    ? `&${createHash('md5').update(input.body).digest('hex').toUpperCase()}`
    : ''
  const encoded = encodeRfc3986(`${input.pathname}&${joined}${bodyHash}`)
  return createHmac('sha1', `${input.appSecret}&`).update(encoded).digest('base64')
}

const asArray = (value: unknown): Array<Record<string, unknown>> => Array.isArray(value)
  ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
  : []

const stringField = (value: unknown, keys: string[]): string | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  for (const key of keys) {
    const candidate = (value as Record<string, unknown>)[key]
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
    if (typeof candidate === 'number' && Number.isFinite(candidate)) return String(candidate)
  }
  return undefined
}

const decimalField = (value: unknown, keys: string[]): string | undefined => {
  const direct = stringField(value, keys)
  if (direct && /^\d+(?:\.\d+)?$/.test(direct)) return direct
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  for (const nested of Object.values(value as Record<string, unknown>)) {
    const candidate = stringField(nested, ['amount', 'value'])
    if (candidate && /^\d+(?:\.\d+)?$/.test(candidate)) return candidate
  }
  return undefined
}
