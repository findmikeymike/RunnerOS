import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrateTradeGodAppData } from './migrate-trade-god-app-data.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value), 'utf8')
}

describe('Trade God app data migration', () => {
  test('copies only the Trading workspace, DiscoTrader trigger, and trading runtime', () => {
    const root = mkdtempSync(join(tmpdir(), 'trade-god-migration-'))
    roots.push(root)
    const legacy = join(root, '.craft-agent')
    const destination = join(root, '.trade-god')
    const trading = join(legacy, 'workspaces', 'trading')
    const legacyElectron = join(root, 'Runner')
    mkdirSync(join(trading, 'skills'), { recursive: true })
    mkdirSync(join(legacyElectron, 'trade-god', 'execution'), { recursive: true })

    writeJson(join(legacy, 'config.json'), {
      workspaces: [
        { id: 'artist', name: 'Artist HQ', slug: 'artist', rootPath: '~/.craft-agent/workspaces/artist', createdAt: 1 },
        { id: 'trading', name: 'Trading', slug: 'trading', rootPath: '~/.craft-agent/workspaces/trading', createdAt: 2 },
      ],
      activeWorkspaceId: 'artist',
      activeSessionId: 'artist-session',
      defaultLlmConnection: 'chatgpt',
    })
    writeJson(join(trading, 'config.json'), { id: 'trading', name: 'Trading', slug: 'trading' })
    writeJson(join(trading, 'automations.json'), {
      version: 2,
      automations: {
        WebhookReceive: [{ id: 'dt', name: 'DiscoTrader receiver', slug: 'discotrader-management' }],
        SchedulerTick: [{ id: 'social', name: 'Daily social comment replies', slug: 'social-replies' }],
      },
    })
    writeFileSync(join(legacy, 'credentials.enc'), 'encrypted', 'utf8')
    writeFileSync(join(legacy, 'credentials.key'), 'key', 'utf8')
    writeFileSync(join(legacyElectron, 'trade-god', 'execution', 'receipt.json'), '{}', 'utf8')

    migrateTradeGodAppData({
      legacyConfigRoot: legacy,
      tradeGodConfigRoot: destination,
      legacyElectronRoot: legacyElectron,
    })

    const config = JSON.parse(readFileSync(join(destination, 'config.json'), 'utf8'))
    const automations = JSON.parse(readFileSync(join(destination, 'workspaces', 'trading', 'automations.json'), 'utf8'))
    expect(config.workspaces).toHaveLength(1)
    expect(config.workspaces[0].rootPath).toBe('~/.trade-god/workspaces/trading')
    expect(config.activeWorkspaceId).toBe('trading')
    expect(config.activeSessionId).toBeNull()
    expect(automations.automations.WebhookReceive.map((receiver: { slug: string }) => receiver.slug))
      .toEqual(['discotrader', 'discotrader-management'])
    expect(automations.automations.SchedulerTick).toBeUndefined()
    expect(existsSync(join(destination, 'electron', 'trade-god', 'execution', 'receipt.json'))).toBe(true)
    expect(existsSync(join(destination, 'credentials.enc'))).toBe(false)
    expect(existsSync(join(destination, 'credentials.key'))).toBe(false)
  })

  test('refuses to overwrite an existing Trade God store', () => {
    const root = mkdtempSync(join(tmpdir(), 'trade-god-migration-existing-'))
    roots.push(root)
    const destination = join(root, '.trade-god')
    mkdirSync(destination)
    writeJson(join(destination, 'config.json'), { workspaces: [] })
    expect(() => migrateTradeGodAppData({
      legacyConfigRoot: join(root, '.craft-agent'),
      tradeGodConfigRoot: destination,
    })).toThrow('Refusing to overwrite')
  })
})
