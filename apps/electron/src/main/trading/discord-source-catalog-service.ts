import type { OptionsAutomationRoute } from '@trade-god/contracts'

import {
  DiscordSourceStore,
  discordSourceIdentityKey,
  type DiscordSource,
  type SaveDiscordSourceInput,
} from './discord-source-store.ts'
import type { TradingSignalRoute } from './trading-signal-route-store.ts'

type CatalogDependencies = {
  store: DiscordSourceStore
  listFuturesRoutes?: () => Promise<TradingSignalRoute[]>
  listOptionsRoutes?: () => Promise<OptionsAutomationRoute[]>
}

/**
 * Owns the market-neutral Discord catalog without changing either execution
 * domain's routes. Existing routes are projected into the catalog so an
 * upgrade never loses a source the operator already configured.
 */
export class DiscordSourceCatalogService {
  constructor(private readonly dependencies: CatalogDependencies) {}

  async list(): Promise<DiscordSource[]> {
    await this.projectExistingRoutes()
    return (await this.dependencies.store.list()).filter((source) => source.state === 'active')
  }

  save(input: SaveDiscordSourceInput): Promise<DiscordSource> {
    return this.dependencies.store.save(input)
  }

  async archive(sourceId: string): Promise<DiscordSource> {
    await this.projectExistingRoutes()
    const source = (await this.dependencies.store.list()).find((candidate) => candidate.source_id === sourceId)
    if (!source || source.state === 'archived') throw new Error('That Discord source no longer exists.')

    const sourceKey = discordSourceIdentityKey(source)
    const [futures, options] = await Promise.all([
      this.requiredList(this.dependencies.listFuturesRoutes),
      this.requiredList(this.dependencies.listOptionsRoutes),
    ])
    const futuresReferenced = futures.some((route) => discordSourceIdentityKey({
      guild_id: route.server_id,
      channel_id: route.channel_id,
      thread_id: null,
      author_id: route.trader_author_id,
    }) === sourceKey)
    const optionsReferenced = options.some((route) => route.state !== 'archived' && discordSourceIdentityKey(route) === sourceKey)
    if (futuresReferenced || optionsReferenced) {
      throw new Error('Remove this Discord from its Futures and Options routes before deleting it from Connections.')
    }
    return this.dependencies.store.archive(sourceId)
  }

  private async projectExistingRoutes(): Promise<void> {
    const [futures, options] = await Promise.all([
      this.safeList(this.dependencies.listFuturesRoutes),
      this.safeList(this.dependencies.listOptionsRoutes),
    ])
    for (const route of futures) {
      await this.dependencies.store.ensureProjection({
        display_name: route.display_name,
        guild_id: route.server_id,
        channel_id: route.channel_id,
        thread_id: null,
        author_id: route.trader_author_id,
      })
    }
    for (const route of options) {
      if (route.state === 'archived') continue
      await this.dependencies.store.ensureProjection({
        display_name: route.display_name,
        guild_id: route.guild_id,
        channel_id: route.channel_id,
        thread_id: route.thread_id,
        author_id: route.author_id,
      })
    }
  }

  private async safeList<T>(list?: () => Promise<T[]>): Promise<T[]> {
    if (!list) return []
    try { return await list() } catch { return [] }
  }

  private requiredList<T>(list?: () => Promise<T[]>): Promise<T[]> {
    return list ? list() : Promise.resolve([])
  }
}
