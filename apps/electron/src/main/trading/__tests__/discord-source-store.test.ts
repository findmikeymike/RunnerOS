import { expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { DiscordSourceStore } from '../discord-source-store'

const NOW = '2026-08-27T18:00:00.000Z'

test('saves one market-neutral Discord identity without an account', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'discord-source-store-'))
  const store = new DiscordSourceStore(root, () => NOW)
  const saved = await store.save({
    display_name: 'Algo Austin',
    channel_url: 'https://discord.com/channels/111/222',
    author_id: '333',
  })

  expect(saved).toMatchObject({
    display_name: 'Algo Austin', guild_id: '111', channel_id: '222', author_id: '333',
    thread_id: null, state: 'active', origin: 'manual',
  })
  expect((await store.list())[0]?.source_id).toBe(saved.source_id)
})

test('projects an existing route without rewriting or duplicating its identity', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'discord-source-store-'))
  const store = new DiscordSourceStore(root, () => NOW)
  const projection = {
    display_name: 'Existing options trader', guild_id: '111', channel_id: '222', thread_id: null, author_id: '333',
  }
  const first = await store.ensureProjection(projection)
  const second = await store.ensureProjection({ ...projection, display_name: 'Different route label' })

  expect(first.source_id).toBe(second.source_id)
  expect(await store.list()).toHaveLength(1)
})

test('prevents identity mutation and active identity collisions', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'discord-source-store-'))
  const store = new DiscordSourceStore(root, () => NOW)
  const saved = await store.save({ display_name: 'Trader', channel_url: 'https://discord.com/channels/1/2', author_id: '3' })

  await expect(store.save({ source_id: saved.source_id, display_name: 'Trader', channel_url: 'https://discord.com/channels/1/9', author_id: '3' }))
    .rejects.toThrow('cannot be changed')
  await expect(store.save({ display_name: 'Duplicate', channel_url: 'https://discord.com/channels/1/2', author_id: '3' }))
    .rejects.toThrow('already saved')
})
