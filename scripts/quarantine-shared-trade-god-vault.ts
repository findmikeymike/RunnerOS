import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const VAULT_FILES = ['credentials.enc', 'credentials.key'] as const

const digest = (path: string): string => (
  createHash('sha256').update(readFileSync(path)).digest('hex')
)

export function quarantineSharedTradeGodVault(options: {
  artistRoot: string
  tradeGodRoot: string
  quarantineId?: string
}): { quarantined: string[]; quarantineRoot?: string } {
  const pairs = VAULT_FILES.map((name) => ({
    name,
    artist: join(options.artistRoot, name),
    tradeGod: join(options.tradeGodRoot, name),
  }))
  const present = pairs.filter(({ tradeGod }) => existsSync(tradeGod))
  if (present.length === 0) return { quarantined: [] }
  if (present.length !== pairs.length || pairs.some(({ artist }) => !existsSync(artist))) {
    throw new Error('Refusing vault quarantine because the duplicate pair is incomplete.')
  }
  for (const pair of pairs) {
    if (digest(pair.artist) !== digest(pair.tradeGod)) {
      throw new Error(`Refusing vault quarantine because Trade God ${pair.name} is no longer an exact Artist OS duplicate.`)
    }
  }

  const quarantineRoot = join(
    options.tradeGodRoot,
    'isolated-vault-quarantine',
    options.quarantineId ?? new Date().toISOString().replace(/[:.]/g, '-'),
  )
  mkdirSync(quarantineRoot, { recursive: true })
  for (const pair of pairs) renameSync(pair.tradeGod, join(quarantineRoot, pair.name))
  return { quarantined: [...VAULT_FILES], quarantineRoot }
}

if (import.meta.main) {
  const home = homedir()
  const result = quarantineSharedTradeGodVault({
    artistRoot: join(home, '.craft-agent'),
    tradeGodRoot: join(home, '.trade-god'),
  })
  console.log(JSON.stringify(result))
}
