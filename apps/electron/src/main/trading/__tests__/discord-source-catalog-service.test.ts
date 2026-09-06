import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

import { DiscordSourceCatalogService } from '../discord-source-catalog-service.ts'
import { DiscordSourceStore } from '../discord-source-store.ts'
import type { TradingSignalRoute } from '../trading-signal-route-store.ts'
import type { OptionsAutomationRoute } from '@trade-god/contracts'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

async function setup(input: { futures?: TradingSignalRoute[]; options?: OptionsAutomationRoute[] } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'discord-source-catalog-'))
  roots.push(root)
  const store = new DiscordSourceStore(root, () => '2026-08-27T12:00:00.000Z')
  const service = new DiscordSourceCatalogService({
    store,
    listFuturesRoutes: async () => input.futures ?? [],
    listOptionsRoutes: async () => input.options ?? [],
  })
  return { service, store }
}

describe('DiscordSourceCatalogService', () => {
  test('projects an existing Futures route without changing the route', async () => {
    const route = {
      route_schema_version: 'trading-signal-route@2', route_id: 'route-1', display_name: 'Austin', source_type: 'discord',
      server_id: '100', channel_id: '200', trader_author_id: '300', target: { type: 'connection', connection_id: 'account-1' },
      enabled: false, created_at: '2026-08-27T12:00:00.000Z', updated_at: '2026-08-27T12:00:00.000Z',
    } satisfies TradingSignalRoute
    const original = structuredClone(route)
    const { service } = await setup({ futures: [route] })

    const [source] = await service.list()
    expect(source?.display_name).toBe('Austin')
    expect(source?.channel_id).toBe('200')
    expect(route).toEqual(original)
  })

  test('does not delete a Discord while a Futures route still references it', async () => {
    const route = {
      route_schema_version: 'trading-signal-route@2', route_id: 'route-1', display_name: 'Austin', source_type: 'discord',
      server_id: '100', channel_id: '200', trader_author_id: '300', target: { type: 'connection', connection_id: 'account-1' },
      enabled: false, created_at: '2026-08-27T12:00:00.000Z', updated_at: '2026-08-27T12:00:00.000Z',
    } satisfies TradingSignalRoute
    const { service } = await setup({ futures: [route] })
    const [source] = await service.list()

    expect(service.archive(source!.source_id)).rejects.toThrow('Remove this Discord from its Futures and Options routes')
  })

  test('archives an unreferenced Discord', async () => {
    const { service } = await setup()
    const source = await service.save({
      display_name: 'Austin', channel_url: 'https://discord.com/channels/100/200', author_id: '300',
    })
    await service.archive(source.source_id)
    expect(await service.list()).toEqual([])
  })
})
