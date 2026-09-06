import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'

export const DISCORD_SOURCE_SCHEMA_VERSION = 'discord-source@1'

const identifierSchema = z.string().trim().min(1).max(80)

export const discordSourceSchema = z.object({
  source_schema_version: z.literal(DISCORD_SOURCE_SCHEMA_VERSION),
  source_id: z.string().trim().min(1).max(160),
  display_name: z.string().trim().min(1).max(120),
  guild_id: identifierSchema,
  channel_id: identifierSchema,
  thread_id: identifierSchema.nullable(),
  author_id: identifierSchema,
  state: z.enum(['active', 'archived']),
  origin: z.enum(['manual', 'legacy-route']),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
}).strict()

export const saveDiscordSourceInputSchema = z.object({
  source_id: z.string().trim().min(1).max(160).optional(),
  display_name: z.string().trim().min(1).max(120),
  channel_url: z.string().trim().min(1).max(500),
  author_id: identifierSchema,
  thread_id: identifierSchema.nullish(),
}).strict()

export type DiscordSource = z.infer<typeof discordSourceSchema>
export type SaveDiscordSourceInput = z.infer<typeof saveDiscordSourceInputSchema>
export type DiscordSourceProjection = Pick<DiscordSource, 'display_name' | 'guild_id' | 'channel_id' | 'thread_id' | 'author_id'>

export class DiscordSourceStore {
  private readonly file: string
  private queue: Promise<void> = Promise.resolve()

  constructor(root: string, private readonly now = () => new Date().toISOString()) {
    this.file = path.join(root, 'discord-sources.json')
  }

  async list(): Promise<DiscordSource[]> {
    return this.withLock(async () => (await this.read())
      .sort((left, right) => left.display_name.localeCompare(right.display_name)))
  }

  async save(input: SaveDiscordSourceInput): Promise<DiscordSource> {
    const parsed = saveDiscordSourceInputSchema.parse(input)
    const identity = parseDiscordChannelUrl(parsed.channel_url)
    return this.withLock(async () => {
      const current = await this.read()
      const existing = parsed.source_id
        ? current.find((source) => source.source_id === parsed.source_id)
        : undefined
      if (parsed.source_id && !existing) throw new Error('That saved Discord source no longer exists.')
      const nextIdentity = {
        guild_id: identity.guild_id,
        channel_id: identity.channel_id,
        thread_id: parsed.thread_id?.trim() || identity.thread_id,
        author_id: parsed.author_id.trim(),
      }
      if (existing && discordSourceIdentityKey(existing) !== discordSourceIdentityKey(nextIdentity)) {
        throw new Error('Discord server, channel, thread, and trader identity cannot be changed. Add a replacement Discord instead.')
      }
      const collision = current.find((source) => source.source_id !== existing?.source_id
        && source.state === 'active'
        && discordSourceIdentityKey(source) === discordSourceIdentityKey(nextIdentity))
      if (collision) throw new Error(`That Discord trader is already saved as ${collision.display_name}.`)
      const timestamp = this.now()
      const saved = discordSourceSchema.parse({
        source_schema_version: DISCORD_SOURCE_SCHEMA_VERSION,
        source_id: existing?.source_id ?? `discord-source-${randomUUID()}`,
        display_name: parsed.display_name,
        ...nextIdentity,
        state: 'active',
        origin: existing?.origin ?? 'manual',
        created_at: existing?.created_at ?? timestamp,
        updated_at: timestamp,
      })
      await this.write([...current.filter((source) => source.source_id !== saved.source_id), saved])
      return structuredClone(saved)
    })
  }

  async ensureProjection(input: DiscordSourceProjection): Promise<DiscordSource> {
    const projection = discordSourceSchema.pick({
      display_name: true,
      guild_id: true,
      channel_id: true,
      thread_id: true,
      author_id: true,
    }).parse(input)
    return this.withLock(async () => {
      const current = await this.read()
      const existing = current.find((source) => discordSourceIdentityKey(source) === discordSourceIdentityKey(projection))
      if (existing) {
        if (existing.state === 'active') return structuredClone(existing)
        const restored = discordSourceSchema.parse({ ...existing, state: 'active', updated_at: this.now() })
        await this.write([...current.filter((source) => source.source_id !== restored.source_id), restored])
        return structuredClone(restored)
      }
      const timestamp = this.now()
      const created = discordSourceSchema.parse({
        source_schema_version: DISCORD_SOURCE_SCHEMA_VERSION,
        source_id: projectedDiscordSourceId(projection),
        ...projection,
        state: 'active',
        origin: 'legacy-route',
        created_at: timestamp,
        updated_at: timestamp,
      })
      await this.write([...current, created])
      return structuredClone(created)
    })
  }

  async archive(sourceId: string): Promise<DiscordSource> {
    return this.withLock(async () => {
      const current = await this.read()
      const existing = current.find((source) => source.source_id === sourceId)
      if (!existing) throw new Error('That Discord source no longer exists.')
      if (existing.state === 'archived') return structuredClone(existing)
      const archived = discordSourceSchema.parse({ ...existing, state: 'archived', updated_at: this.now() })
      await this.write([...current.filter((source) => source.source_id !== sourceId), archived])
      return structuredClone(archived)
    })
  }

  private async read(): Promise<DiscordSource[]> {
    try {
      const parsed = z.array(z.unknown()).parse(JSON.parse(await readFile(this.file, 'utf8')))
      return parsed.map((source) => discordSourceSchema.parse(source))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  }

  private async write(sources: DiscordSource[]): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true })
    const temporary = `${this.file}.${process.pid}.${randomUUID()}.tmp`
    await writeFile(temporary, `${JSON.stringify(sources, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
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

export function parseDiscordChannelUrl(value: string): { guild_id: string; channel_id: string; thread_id: string | null } {
  let parsed: URL
  try { parsed = new URL(value.trim()) } catch { throw new Error('Paste a Discord channel link, such as discord.com/channels/server/channel.') }
  if (!['discord.com', 'www.discord.com', 'canary.discord.com', 'ptb.discord.com'].includes(parsed.hostname.toLowerCase())) {
    throw new Error('Only a Discord channel link is accepted.')
  }
  const match = /^\/channels\/([^/]+)\/([^/]+)(?:\/([^/]+))?\/?$/.exec(parsed.pathname)
  if (!match) throw new Error('This Discord link does not identify one server and channel.')
  return { guild_id: match[1]!, channel_id: match[2]!, thread_id: match[3] ?? null }
}

export function discordSourceIdentityKey(source: Pick<DiscordSource, 'guild_id' | 'channel_id' | 'thread_id' | 'author_id'>): string {
  return [source.guild_id, source.channel_id, source.thread_id ?? '', source.author_id].join(':')
}

function projectedDiscordSourceId(source: DiscordSourceProjection): string {
  const digest = createHash('sha256').update(discordSourceIdentityKey(source)).digest('hex').slice(0, 24)
  return `discord-source-legacy-${digest}`
}
