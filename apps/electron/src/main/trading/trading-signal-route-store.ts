import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'

export const tradingSignalRouteSchema = z.object({
  route_id: z.string().trim().min(1).max(160),
  display_name: z.string().trim().min(1).max(120),
  source_type: z.literal('discord'),
  server_id: z.string().regex(/^\d{1,25}$/),
  channel_id: z.string().regex(/^\d{1,25}$/),
  trader_author_id: z.string().regex(/^\d{1,25}$/),
  connection_id: z.string().trim().min(1).max(160),
  enabled: z.boolean(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
}).strict()

export type TradingSignalRoute = z.infer<typeof tradingSignalRouteSchema>

export class TradingSignalRouteStore {
  private readonly file: string
  private queue: Promise<void> = Promise.resolve()

  constructor(root: string, private readonly now = () => new Date().toISOString()) {
    this.file = path.join(root, 'signal-routes.json')
  }

  async list(): Promise<TradingSignalRoute[]> {
    return (await this.read()).sort((a, b) => a.display_name.localeCompare(b.display_name))
  }

  async save(input: TradingSignalRoute): Promise<TradingSignalRoute> {
    const route = tradingSignalRouteSchema.parse(input)
    return this.withLock(async () => {
      const current = await this.read()
      const collision = current.find((candidate) => candidate.route_id !== route.route_id
        && candidate.server_id === route.server_id
        && candidate.channel_id === route.channel_id
        && candidate.trader_author_id === route.trader_author_id
        && candidate.enabled && route.enabled)
      if (collision) throw new Error(`That Discord trader is already routed by ${collision.display_name}.`)
      await this.write([...current.filter((item) => item.route_id !== route.route_id), route])
      return structuredClone(route)
    })
  }

  async remove(routeId: string): Promise<boolean> {
    return this.withLock(async () => {
      const current = await this.read()
      const next = current.filter((item) => item.route_id !== routeId)
      if (next.length === current.length) return false
      await this.write(next)
      return true
    })
  }

  async resolve(channelUrl: string, authorId?: string): Promise<TradingSignalRoute | null> {
    if (!authorId) return null
    const match = /^https:\/\/discord\.com\/channels\/(\d{1,25})\/(\d{1,25})/.exec(channelUrl)
    if (!match) return null
    const candidates = (await this.read()).filter((route) => route.enabled
      && route.server_id === match[1]
      && route.channel_id === match[2]
      && route.trader_author_id === authorId)
    if (candidates.length > 1) throw new Error('Discord signal route is ambiguous.')
    return candidates[0] ?? null
  }

  private async read(): Promise<TradingSignalRoute[]> {
    try {
      const parsed = JSON.parse(await readFile(this.file, 'utf8'))
      return z.array(tradingSignalRouteSchema).parse(parsed)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
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
