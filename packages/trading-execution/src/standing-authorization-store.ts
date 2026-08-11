import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  executionAuthorizationSchema,
  type ExecutionAuthorization,
} from '@trade-god/contracts'

import { ExecutionGatewayError } from './errors.ts'
import {
  resolveFuturesContractIdentity,
  resolveFuturesEconomicSpec,
} from './futures-contract.ts'

const MAX_MANDATE_DURATION_MS = 4 * 60 * 60 * 1_000
const MAX_MANDATE_CONTRACTS = 10
const ISSUED_AT_TOLERANCE_MS = 5 * 60 * 1_000

interface StandingAuthorizationFile {
  standing_authorization_store_schema_version: 'standing-authorization-store@1'
  authorizations: ExecutionAuthorization[]
  updated_at: string
}

const emptyStore = (now: string): StandingAuthorizationFile => ({
  standing_authorization_store_schema_version: 'standing-authorization-store@1',
  authorizations: [],
  updated_at: now,
})

export class FileStandingAuthorizationStore {
  private readonly file: string
  private queue: Promise<void> = Promise.resolve()

  constructor(
    root: string,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    this.file = path.join(root, 'standing-authorizations.json')
  }

  async list(): Promise<ExecutionAuthorization[]> {
    return (await this.read()).authorizations.map((value) => structuredClone(value))
  }

  async getActive(connectionId: string): Promise<ExecutionAuthorization | null> {
    const now = Date.parse(this.now())
    const authorization = (await this.read()).authorizations.find(
      (value) => value.connection_id === connectionId,
    )
    if (
      !authorization
      || Date.parse(authorization.expires_at) <= now
      || Date.parse(authorization.scope.session_start) > now
      || Date.parse(authorization.scope.session_end) <= now
    ) return null
    return structuredClone(authorization)
  }

  async save(input: ExecutionAuthorization): Promise<ExecutionAuthorization> {
    const authorization = executionAuthorizationSchema.parse(input)
    assertStandingAuthorization(authorization)
    const now = Date.parse(this.now())
    const issuedAt = Date.parse(authorization.issued_at)
    const sessionEnd = Date.parse(authorization.scope.session_end)
    if (
      issuedAt < now - ISSUED_AT_TOLERANCE_MS
      || issuedAt > now + ISSUED_AT_TOLERANCE_MS
      || sessionEnd <= now
    ) {
      throw new ExecutionGatewayError(
        'AUTHORIZATION_MISMATCH',
        'Standing mandates must be issued now and remain unexpired.',
      )
    }
    return this.withLock(async () => {
      const current = await this.read()
      await this.write({
        ...current,
        authorizations: [
          ...current.authorizations.filter(
            (value) => value.connection_id !== authorization.connection_id,
          ),
          authorization,
        ],
        updated_at: this.now(),
      })
      return structuredClone(authorization)
    })
  }

  async revoke(connectionId: string): Promise<boolean> {
    return this.withLock(async () => {
      const current = await this.read()
      const authorizations = current.authorizations.filter(
        (value) => value.connection_id !== connectionId,
      )
      if (authorizations.length === current.authorizations.length) return false
      await this.write({ ...current, authorizations, updated_at: this.now() })
      return true
    })
  }

  private async read(): Promise<StandingAuthorizationFile> {
    try {
      return parseStore(JSON.parse(await readFile(this.file, 'utf8')))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyStore(this.now())
      throw error
    }
  }

  private async write(store: StandingAuthorizationFile): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true })
    const temporary = `${this.file}.${process.pid}.${randomUUID()}.tmp`
    await writeFile(temporary, `${JSON.stringify(parseStore(store), null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    })
    await rename(temporary, this.file)
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.queue
    let release!: () => void
    this.queue = previous.catch(() => undefined).then(() => new Promise<void>((resolve) => {
      release = resolve
    }))
    await previous.catch(() => undefined)
    try {
      return await operation()
    } finally {
      release()
    }
  }
}

const parseStore = (input: unknown): StandingAuthorizationFile => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Standing authorization store is invalid.')
  }
  const value = input as Partial<StandingAuthorizationFile>
  if (
    value.standing_authorization_store_schema_version !== 'standing-authorization-store@1'
    || !Array.isArray(value.authorizations)
    || typeof value.updated_at !== 'string'
    || !Number.isFinite(Date.parse(value.updated_at))
  ) throw new Error('Standing authorization store is invalid.')
  const authorizations = value.authorizations.map((authorization) => {
    const parsed = executionAuthorizationSchema.parse(authorization)
    assertStandingAuthorization(parsed)
    return parsed
  })
  const connectionIds = new Set(authorizations.map((value) => value.connection_id))
  if (connectionIds.size !== authorizations.length) {
    throw new Error('Standing authorization store contains duplicate connection mandates.')
  }
  return {
    standing_authorization_store_schema_version: value.standing_authorization_store_schema_version,
    authorizations,
    updated_at: value.updated_at,
  }
}

const assertStandingAuthorization = (authorization: ExecutionAuthorization): void => {
  if (authorization.mode !== 'standing-mandate') {
    throw new ExecutionGatewayError(
      'AUTHORIZATION_MISMATCH',
      'Only standing mandates can be stored for automatic paper coordination.',
    )
  }
  if (
    Number(authorization.scope.max_daily_loss) <= 0
    || Number(authorization.scope.max_open_risk) <= 0
  ) {
    throw new ExecutionGatewayError(
      'AUTHORIZATION_MISMATCH',
      'Standing mandate monetary limits must be positive.',
    )
  }
  const issuedAt = Date.parse(authorization.issued_at)
  const sessionStart = Date.parse(authorization.scope.session_start)
  const sessionEnd = Date.parse(authorization.scope.session_end)
  const expiresAt = Date.parse(authorization.expires_at)
  if (
    sessionStart < issuedAt
    || sessionStart > issuedAt + ISSUED_AT_TOLERANCE_MS
    || sessionEnd !== expiresAt
    || sessionEnd - sessionStart > MAX_MANDATE_DURATION_MS
    || sessionEnd <= sessionStart
  ) {
    throw new ExecutionGatewayError(
      'AUTHORIZATION_MISMATCH',
      'Standing mandates must start when issued, expire with the session, and last no more than four hours.',
    )
  }
  if (authorization.scope.max_contracts > MAX_MANDATE_CONTRACTS) {
    throw new ExecutionGatewayError(
      'AUTHORIZATION_MISMATCH',
      `Standing mandates cannot authorize more than ${MAX_MANDATE_CONTRACTS} contracts per order.`,
    )
  }
  for (const symbol of authorization.scope.symbols) {
    const identity = resolveFuturesContractIdentity(symbol, authorization.issued_at)
    if (!identity.expiry || identity.active !== true || !resolveFuturesEconomicSpec(identity.root)) {
      throw new ExecutionGatewayError(
        'AUTHORIZATION_MISMATCH',
        `Standing mandate symbol ${symbol} must be an exact active supported futures contract.`,
      )
    }
  }
}
