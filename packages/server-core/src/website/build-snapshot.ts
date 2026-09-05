import { createHash } from 'node:crypto'
import { cpSync, lstatSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tails = new Map<string, Promise<void>>()

export async function withWebsiteLock<T>(root: string, operation: () => Promise<T>, lane = 'site'): Promise<T> {
  const key = `${realpathSync(root)}:${lane}`
  const previous = tails.get(key) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const tail = previous.catch(() => undefined).then(() => gate)
  tails.set(key, tail)
  await previous.catch(() => undefined)
  try { return await operation() } finally {
    release()
    if (tails.get(key) === tail) tails.delete(key)
  }
}

/** Hash every deployable byte, including worker code; never follow symlinks. */
export function hashBuildDirectory(root: string): string {
  const hash = createHash('sha256')
  function walk(dir: string, prefix = ''): void {
    if (!lstatSync(dir).isDirectory()) throw new Error('Build must be a real directory.')
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name)
      const relative = `${prefix}${name}`
      const stat = lstatSync(path)
      if (stat.isDirectory()) walk(path, `${relative}/`)
      else if (stat.isFile()) hash.update(`${relative}\0${createHash('sha256').update(readFileSync(path)).digest('hex')}\n`)
      else throw new Error('Build contains an unsupported file or symlink. Rebuild the site.')
    }
  }
  walk(root)
  return hash.digest('hex')
}

export function snapshotBuild(root: string, expectedHash: string): { path: string; dispose: () => void } {
  if (hashBuildDirectory(root) !== expectedHash) throw new Error('Build files changed. Rebuild and approve the new preview.')
  const parent = mkdtempSync(join(tmpdir(), 'artist-site-publish-'))
  const path = join(parent, 'dist')
  const dispose = () => rmSync(parent, { recursive: true, force: true })
  try {
    cpSync(root, path, { recursive: true, dereference: false })
    if (hashBuildDirectory(path) !== expectedHash) throw new Error('Build changed while preparing the publish. Rebuild and try again.')
    return { path, dispose }
  } catch (error) { dispose(); throw error }
}
