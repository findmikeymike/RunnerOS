import { existsSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const marker = process.env.TRADE_GOD_CRASH_ONCE_MARKER
const realSidecar = process.env.TRADE_GOD_REAL_SIDECAR

if (!marker || !realSidecar) throw new Error('Crash-once fixture requires marker and real-sidecar paths.')

if (!existsSync(marker)) {
  writeFileSync(marker, 'crashed')
  process.exit(17)
}

await import(pathToFileURL(realSidecar).href)
