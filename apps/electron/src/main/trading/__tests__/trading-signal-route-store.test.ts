import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  TRADING_SIGNAL_ROUTE_SCHEMA_VERSION,
  TradingSignalRouteStore,
  tradingSignalTargetKey,
  type TradingSignalRoute,
} from '../trading-signal-route-store.ts'

const roots: string[] = []
const NOW = '2026-07-31T18:00:00.000Z'
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

const route = (overrides: Partial<TradingSignalRoute> = {}): TradingSignalRoute => ({
  route_schema_version: TRADING_SIGNAL_ROUTE_SCHEMA_VERSION,
  route_id: 'route-one', display_name: 'Trader one', source_type: 'discord',
  server_id: '111', channel_id: '222', trader_author_id: '333',
  target: { type: 'connection', connection_id: 'connection-one' },
  enabled: true, created_at: NOW, updated_at: NOW,
  ...overrides,
})

describe('trading signal route store', () => {
  test('persists and resolves an exact Discord channel and immutable trader id', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'trade-routes-')); roots.push(root)
    const store = new TradingSignalRouteStore(root, () => NOW)
    await store.save(route())
    expect(await store.resolve('https://discord.com/channels/111/222', '333'))
      .toMatchObject({ target: { type: 'connection', connection_id: 'connection-one' } })
    expect(await store.resolve('https://canary.discord.com/channels/111/222/444', '333'))
      .toMatchObject({ target: { type: 'connection', connection_id: 'connection-one' } })
    expect(await store.resolve('https://evil.example/channels/111/222', '333')).toBeNull()
    expect(await store.resolve('https://discord.com/channels/111/222', '334')).toBeNull()
    expect(await store.resolveIdentity({ server_id: '111', channel_id: '222', author_id: '333' }))
      .toMatchObject({ route_id: 'route-one' })
    expect(await store.resolveIdentity({ server_id: '999', channel_id: '222', author_id: '333' }))
      .toBeNull()
  })

  test('losslessly migrates a legacy single-account route to schema v2 on read', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'trade-routes-')); roots.push(root)
    await writeFile(path.join(root, 'signal-routes.json'), JSON.stringify([{
      route_id: 'legacy', display_name: 'Legacy', source_type: 'discord',
      server_id: '111', channel_id: '222', trader_author_id: '333',
      connection_id: 'connection-original', enabled: true, created_at: NOW, updated_at: NOW,
    }]))
    const store = new TradingSignalRouteStore(root, () => NOW)
    expect(await store.list()).toEqual([expect.objectContaining({
      route_schema_version: TRADING_SIGNAL_ROUTE_SCHEMA_VERSION,
      target: { type: 'connection', connection_id: 'connection-original' },
    })])
    const durable = JSON.parse(await readFile(path.join(root, 'signal-routes.json'), 'utf8'))
    expect(durable[0]).not.toHaveProperty('connection_id')
    expect(durable[0].target).toEqual({ type: 'connection', connection_id: 'connection-original' })
  })

  test('requires explicit confirmation before changing account or group target', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'trade-routes-')); roots.push(root)
    const store = new TradingSignalRouteStore(root, () => NOW)
    await store.save(route())
    const groupRoute = route({ target: { type: 'mirror-group', mirror_group_id: 'group-one' } })

    await expect(store.save(groupRoute)).rejects.toThrow('Confirm reassignment')
    expect((await store.list())[0]?.target).toEqual({ type: 'connection', connection_id: 'connection-one' })
    await expect(store.save(groupRoute, { expected_previous_target_key: 'connection:wrong' }))
      .rejects.toThrow('Confirm reassignment')

    const moved = await store.save(groupRoute, {
      expected_previous_target_key: tradingSignalTargetKey(route().target),
    })
    expect(moved.target).toEqual({ type: 'mirror-group', mirror_group_id: 'group-one' })
    expect(moved.created_at).toBe(NOW)
  })

  test('refuses duplicate source identities and immutable identity edits', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'trade-routes-')); roots.push(root)
    const store = new TradingSignalRouteStore(root, () => NOW)
    await store.save(route())
    await expect(store.save(route({ route_id: 'route-two' }))).rejects.toThrow('already routed')
    await expect(store.save(route({ channel_id: '999' }))).rejects.toThrow('identity are immutable')
  })
})
