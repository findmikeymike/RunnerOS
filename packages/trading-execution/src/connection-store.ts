import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  tradingConnectionSchema,
  type TradingConnection,
} from '@trade-god/contracts'

import { ExecutionGatewayError } from './errors.ts'

interface TradingConnectionFile {
  connection_store_schema_version: 'trading-connection-store@1'
  connections: TradingConnection[]
  updated_at: string
}

const emptyStore = (now: string): TradingConnectionFile => ({
  connection_store_schema_version: 'trading-connection-store@1',
  connections: [],
  updated_at: now,
})

export class FileTradingConnectionStore {
  private readonly file: string
  private queue: Promise<void> = Promise.resolve()

  constructor(
    root: string,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    this.file = path.join(root, 'connections.json')
  }

  async list(): Promise<TradingConnection[]> {
    return (await this.read()).connections
      .map((connection) => structuredClone(connection))
      .sort((left, right) => left.display_name.localeCompare(right.display_name))
  }

  async get(connectionId: string): Promise<TradingConnection> {
    const connection = (await this.read()).connections.find(
      (candidate) => candidate.connection_id === connectionId,
    )
    if (!connection) {
      throw new ExecutionGatewayError(
        'CONNECTION_UNAVAILABLE',
        `Trading connection ${connectionId} was not found.`,
      )
    }
    return structuredClone(connection)
  }

  async save(input: TradingConnection): Promise<TradingConnection> {
    const connection = tradingConnectionSchema.parse(input)
    return this.withLock(async () => {
      const current = await this.read()
      const existing = current.connections.find(
        (candidate) => candidate.connection_id === connection.connection_id,
      )
      if (
        existing
        && (
          existing.account_ref !== connection.account_ref
          || existing.environment !== connection.environment
          || existing.firm.slug !== connection.firm.slug
          || existing.platform.slug !== connection.platform.slug
          || existing.transport_preference !== connection.transport_preference
        )
      ) {
        throw new ExecutionGatewayError(
          'CONNECTION_UNAVAILABLE',
          'Firm, platform, transport, account, and environment identity are immutable; create a new connection.',
        )
      }
      const next = {
        ...current,
        connections: [
          ...current.connections.filter(
            (candidate) => candidate.connection_id !== connection.connection_id,
          ),
          connection,
        ],
        updated_at: this.now(),
      }
      await this.write(next)
      return structuredClone(connection)
    })
  }

  async remove(connectionId: string): Promise<boolean> {
    return this.withLock(async () => {
      const current = await this.read()
      const nextConnections = current.connections.filter(
        (connection) => connection.connection_id !== connectionId,
      )
      if (nextConnections.length === current.connections.length) return false
      await this.write({
        ...current,
        connections: nextConnections,
        updated_at: this.now(),
      })
      return true
    })
  }

  private async read(): Promise<TradingConnectionFile> {
    try {
      const parsed = JSON.parse(await readFile(this.file, 'utf8')) as unknown
      return parseStore(parsed)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyStore(this.now())
      throw error
    }
  }

  private async write(store: TradingConnectionFile): Promise<void> {
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

const parseStore = (input: unknown): TradingConnectionFile => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Trading connection store is invalid.')
  }
  const value = input as Partial<TradingConnectionFile>
  if (
    value.connection_store_schema_version !== 'trading-connection-store@1'
    || !Array.isArray(value.connections)
    || typeof value.updated_at !== 'string'
    || !Number.isFinite(Date.parse(value.updated_at))
  ) {
    throw new Error('Trading connection store is invalid.')
  }
  return {
    connection_store_schema_version: value.connection_store_schema_version,
    connections: value.connections.map((connection) => tradingConnectionSchema.parse(connection)),
    updated_at: value.updated_at,
  }
}
