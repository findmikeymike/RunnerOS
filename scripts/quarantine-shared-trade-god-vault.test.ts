import { afterEach, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { quarantineSharedTradeGodVault } from './quarantine-shared-trade-god-vault.ts'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

test('quarantines only exact Trade God duplicates and leaves Artist OS untouched', () => {
  const root = mkdtempSync(join(tmpdir(), 'trade-god-vault-quarantine-'))
  roots.push(root)
  const artist = join(root, '.craft-agent')
  const tradeGod = join(root, '.trade-god')
  mkdirSync(artist)
  mkdirSync(tradeGod)
  for (const name of ['credentials.enc', 'credentials.key']) {
    writeFileSync(join(artist, name), `shared-${name}`)
    writeFileSync(join(tradeGod, name), `shared-${name}`)
  }

  const result = quarantineSharedTradeGodVault({
    artistRoot: artist,
    tradeGodRoot: tradeGod,
    quarantineId: 'test-backup',
  })
  expect(result.quarantined).toEqual(['credentials.enc', 'credentials.key'])
  expect(existsSync(join(artist, 'credentials.enc'))).toBe(true)
  expect(existsSync(join(tradeGod, 'credentials.enc'))).toBe(false)
  expect(existsSync(join(tradeGod, 'isolated-vault-quarantine', 'test-backup', 'credentials.enc'))).toBe(true)
})

test('refuses to quarantine a Trade God vault that has diverged', () => {
  const root = mkdtempSync(join(tmpdir(), 'trade-god-vault-diverged-'))
  roots.push(root)
  const artist = join(root, '.craft-agent')
  const tradeGod = join(root, '.trade-god')
  mkdirSync(artist)
  mkdirSync(tradeGod)
  writeFileSync(join(artist, 'credentials.enc'), 'artist')
  writeFileSync(join(tradeGod, 'credentials.enc'), 'trade-god')
  writeFileSync(join(artist, 'credentials.key'), 'key')
  writeFileSync(join(tradeGod, 'credentials.key'), 'key')

  expect(() => quarantineSharedTradeGodVault({
    artistRoot: artist,
    tradeGodRoot: tradeGod,
  })).toThrow('no longer an exact Artist OS duplicate')
  expect(existsSync(join(tradeGod, 'credentials.enc'))).toBe(true)
})
