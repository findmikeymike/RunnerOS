import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { TradingSignalRouteStore, type TradingSignalRoute } from '../trading-signal-route-store.ts'

const roots: string[] = []
const NOW = '2026-07-31T18:00:00.000Z'
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

const route = (overrides: Partial<TradingSignalRoute> = {}): TradingSignalRoute => ({
  route_id: 'route-one', display_name: 'Trader one', source_type: 'discord',
  server_id: '111', channel_id: '222', trader_author_id: '333',
  connection_id: 'connection-one', enabled: true, created_at: NOW, updated_at: NOW,
  ...overrides,
})

describe('trading signal route store', () => {
  test('persists and resolves an exact Discord channel and immutable trader id', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'trade-routes-')); roots.push(root)
    const store = new TradingSignalRouteStore(root, () => NOW)
    await store.save(route())
    expect(await store.resolve('https://discord.com/channels/111/222', '333')).toMatchObject({ connection_id: 'connection-one' })
    expect(await store.resolve('https://canary.discord.com/channels/111/222/444', '333')).toMatchObject({ connection_id: 'connection-one' })
    expect(await store.resolve('https://evil.example/channels/111/222', '333')).toBeNull()
    expect(await store.resolve('https://discord.com/channels/111/222', '334')).toBeNull()
  })

  test('refuses two enabled routes for the same Discord identity', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'trade-routes-')); roots.push(root)
    const store = new TradingSignalRouteStore(root, () => NOW)
    await store.save(route())
    await expect(store.save(route({ route_id: 'route-two', connection_id: 'connection-two' })))
      .rejects.toThrow('already routed')
  })

  test('requires explicit confirmation before moving a Discord identity to another account', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'trade-routes-')); roots.push(root)
    const store = new TradingSignalRouteStore(root, () => NOW)
    await store.save(route())

    await expect(store.save(route({ connection_id: 'connection-two' })))
      .rejects.toThrow('Confirm reassignment')
    expect((await store.list())[0]?.connection_id).toBe('connection-one')

    await expect(store.save(
      route({ connection_id: 'connection-two' }),
      { expected_previous_connection_id: 'wrong-connection' },
    )).rejects.toThrow('Confirm reassignment')

    const moved = await store.save(
      route({
        connection_id: 'connection-two',
        created_at: '2026-08-01T18:00:00.000Z',
        updated_at: '2026-08-01T18:00:00.000Z',
      }),
      { expected_previous_connection_id: 'connection-one' },
    )
    expect(moved.connection_id).toBe('connection-two')
    expect(moved.created_at).toBe(NOW)
  })

  test('keeps Discord identity immutable for an existing route id', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'trade-routes-')); roots.push(root)
    const store = new TradingSignalRouteStore(root, () => NOW)
    await store.save(route())
    await expect(store.save(route({ channel_id: '999' }))).rejects.toThrow('identity are immutable')
  })
})
