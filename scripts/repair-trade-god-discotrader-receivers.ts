import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { ensureDiscoTraderReceivers } from './migrate-trade-god-app-data.ts'

const destination = process.argv[2]
  ?? join(homedir(), '.trade-god', 'workspaces', 'trading', 'automations.json')
const current = JSON.parse(readFileSync(destination, 'utf8'))
const repaired = ensureDiscoTraderReceivers(current)
const temporary = `${destination}.${process.pid}.tmp`
writeFileSync(temporary, `${JSON.stringify(repaired, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
renameSync(temporary, destination)
console.log(`Verified DiscoTrader entry and management receivers: ${destination}`)
