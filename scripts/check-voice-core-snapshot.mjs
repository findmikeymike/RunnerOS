import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const vendor = path.join(root, 'vendor')
const snapshot = JSON.parse(readFileSync(path.join(vendor, 'voice-core-snapshot.json'), 'utf8'))
if (snapshot.schemaVersion !== 1 || !snapshot.revision || !Object.keys(snapshot.files ?? {}).length) throw new Error('Invalid Voice Core snapshot')
for (const [relative, expected] of Object.entries(snapshot.files)) {
  if (relative.includes('..') || path.isAbsolute(relative)) throw new Error('Unsafe snapshot path')
  const actual = createHash('sha256').update(readFileSync(path.join(vendor, relative))).digest('hex')
  if (actual !== expected) throw new Error('Voice Core snapshot drift: ' + relative)
}
console.log('Voice Core snapshot verified: ' + Object.keys(snapshot.files).length + ' runtime files; source ' + snapshot.revision + (snapshot.sourceDirty ? ' plus recorded SDK edits' : ''))
