import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'

export const TRADING_SIGNAL_ROUTE_SCHEMA_VERSION = 'trading-signal-route@2'

export const tradingSignalTargetSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('connection'),
    connection_id: z.string().trim().min(1).max(160),
  }).strict(),
  z.object({
    type: z.literal('mirror-group'),
    mirror_group_id: z.string().trim().min(1).max(160),
  }).strict(),
])

export const tradingSignalRouteSchema = z.object({
  route_schema_version: z.literal(TRADING_SIGNAL_ROUTE_SCHEMA_VERSION),
  route_id: z.string().trim().min(1).max(160),
  display_name: z.string().trim().min(1).max(120),
  source_type: z.literal('discord'),
  server_id: z.string().regex(/^\d{1,25}$/),
  channel_id: z.string().regex(/^\d{1,25}$/),
  trader_author_id: z.string().regex(/^\d{1,25}$/),
  target: tradingSignalTargetSchema,
  enabled: z.boolean(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
}).strict()

const legacyTradingSignalRouteSchema = tradingSignalRouteSchema
  .omit({ route_schema_version: true, target: true })
  .extend({ connection_id: z.string().trim().min(1).max(160) })
  .strict()

export type TradingSignalTarget = z.infer<typeof tradingSignalTargetSchema>
export type TradingSignalRoute = z.infer<typeof tradingSignalRouteSchema>

export interface SaveTradingSignalRouteOptions {
  expected_previous_target_key?: string
}

export class TradingSignalRouteStore {
  private readonly file: string
  private queue: Promise<void> = Promise.resolve()

  constructor(root: string, private readonly now = () => new Date().toISOString()) {
    this.file = path.join(root, 'signal-routes.json')
  }

  async list(): Promise<TradingSignalRoute[]> {
    return this.withLock(async () => {
      const { routes, migrated } = await this.read()
      if (migrated) await this.write(routes)
      return routes.sort((a, b) => a.display_name.localeCompare(b.display_name))
    })
  }

  async save(
    input: TradingSignalRoute,
    options: SaveTradingSignalRouteOptions = {},
  ): Promise<TradingSignalRoute> {
    const route = tradingSignalRouteSchema.parse(input)
    return this.withLock(async () => {
      const { routes: current } = await this.read()
      const existingById = current.find((candidate) => candidate.route_id === route.route_id)
      if (existingById && (
        existingById.server_id !== route.server_id
        || existingById.channel_id !== route.channel_id
        || existingById.trader_author_id !== route.trader_author_id
      )) {
        throw new Error('Discord server, channel, and trader identity are immutable; create a new route.')
      }
      const collision = current.find((candidate) => candidate.route_id !== route.route_id
        && candidate.server_id === route.server_id
        && candidate.channel_id === route.channel_id
        && candidate.trader_author_id === route.trader_author_id)
      if (collision) throw new Error(`That Discord trader is already routed by ${collision.display_name}.`)
      if (
        existingById
        && tradingSignalTargetKey(existingById.target) !== tradingSignalTargetKey(route.target)
        && options.expected_previous_target_key !== tradingSignalTargetKey(existingById.target)
      ) {
        throw new Error(
          `That Discord trader is already routed to ${describeTradingSignalTarget(existingById.target)}. Confirm reassignment before changing targets.`,
        )
      }
      const saved = existingById ? { ...route, created_at: existingById.created_at } : route
      await this.write([...current.filter((item) => item.route_id !== route.route_id), saved])
      return structuredClone(saved)
    })
  }

  async remove(routeId: string): Promise<boolean> {
    return this.withLock(async () => {
      const { routes: current } = await this.read()
      const next = current.filter((item) => item.route_id !== routeId)
      if (next.length === current.length) return false
      await this.write(next)
      return true
    })
  }

  async resolve(channelUrl: string, authorId?: string): Promise<TradingSignalRoute | null> {
    if (!authorId) return null
    let url: URL
    try { url = new URL(channelUrl) } catch { return null }
    if (url.protocol !== 'https:' || ![
      'discord.com',
      'www.discord.com',
      'canary.discord.com',
      'ptb.discord.com',
    ].includes(url.hostname)) return null
    const match = /^\/channels\/(\d{1,25})\/(\d{1,25})(?:\/|$)/.exec(url.pathname)
    if (!match) return null
    return this.withLock(async () => {
      const { routes, migrated } = await this.read()
      if (migrated) await this.write(routes)
      const candidates = routes.filter((route) => route.enabled
        && route.server_id === match[1]
        && route.channel_id === match[2]
        && route.trader_author_id === authorId)
      if (candidates.length > 1) throw new Error('Discord signal route is ambiguous.')
      return candidates[0] ?? null
    })
  }

  async resolveIdentity(input: {
    server_id?: string
    channel_id: string
    author_id: string
  }): Promise<TradingSignalRoute | null> {
    return this.withLock(async () => {
      const { routes, migrated } = await this.read()
      if (migrated) await this.write(routes)
      const candidates = routes.filter((route) => route.enabled
        && (!input.server_id || route.server_id === input.server_id)
        && route.channel_id === input.channel_id
        && route.trader_author_id === input.author_id)
      if (candidates.length > 1) throw new Error('Discord signal route is ambiguous.')
      return candidates[0] ?? null
    })
  }

  private async read(): Promise<{ routes: TradingSignalRoute[]; migrated: boolean }> {
    try {
      const parsed = z.array(z.unknown()).parse(JSON.parse(await readFile(this.file, 'utf8')))
      let migrated = false
      const routes = parsed.map((value) => {
        const canonical = tradingSignalRouteSchema.safeParse(value)
        if (canonical.success) return canonical.data
        const legacy = legacyTradingSignalRouteSchema.parse(value)
        migrated = true
        return tradingSignalRouteSchema.parse({
          route_schema_version: TRADING_SIGNAL_ROUTE_SCHEMA_VERSION,
          route_id: legacy.route_id,
          display_name: legacy.display_name,
          source_type: legacy.source_type,
          server_id: legacy.server_id,
          channel_id: legacy.channel_id,
          trader_author_id: legacy.trader_author_id,
          target: { type: 'connection', connection_id: legacy.connection_id },
          enabled: legacy.enabled,
          created_at: legacy.created_at,
          updated_at: legacy.updated_at,
        })
      })
      return { routes, migrated }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { routes: [], migrated: false }
      throw error
    }
  }

  private async write(routes: TradingSignalRoute[]): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true })
    const temporary = `${this.file}.${process.pid}.${randomUUID()}.tmp`
    await writeFile(temporary, `${JSON.stringify(routes, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, this.file)
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.queue
    let release!: () => void
    this.queue = previous.catch(() => undefined).then(() => new Promise<void>((resolve) => { release = resolve }))
    await previous.catch(() => undefined)
    try { return await operation() } finally { release() }
  }
}

export const tradingSignalTargetKey = (target: TradingSignalTarget): string => target.type === 'connection'
  ? `connection:${target.connection_id}`
  : `mirror-group:${target.mirror_group_id}`

const describeTradingSignalTarget = (target: TradingSignalTarget): string => target.type === 'connection'
  ? `account ${target.connection_id}`
  : `Mirror Group ${target.mirror_group_id}`
