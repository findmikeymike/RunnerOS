import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readFileSync, readlinkSync, renameSync, rmSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

export interface BuildProvenance {
  component: 'main' | 'preload' | 'renderer'
  commit: string | null
  sourceHash: string
  dirty: boolean
  builtAt: string
  product: string
}

/** Files consumed by builds, including new local code and checked-in vendor bundles.
 * Never read credentials, local env files, dependency trees, or build outputs. */
export function isBuildInput(path: string): boolean {
  const parts = path.split('/')
  if (parts[0] === 'apps' && parts[1] === 'electron' && /^release(?:-|$)/.test(parts[2] ?? '')) return false
  if (parts.some(part => /^(?:\.git|node_modules|\.cache|coverage|\.worktrees|\.renderer-|renderer\.(?:staging|previous)-)/.test(part))) return false
  if (parts.some(part => /^\.env(?:\.|$)/i.test(part) || part === '.secrets')) return false
  if (/^(?:secrets?|credentials?)(?:\.(?:json|ya?ml|toml|enc)|$)/i.test(basename(path))) return false
  if (/\.(?:pem|key|p12|pfx|keystore|jks)$/i.test(path) || /(?:^|\/)(?:auth|credentials)\.json$/i.test(path)) return false
  if (parts.includes('dist') && parts[0] !== 'vendor') return false
  if (parts.some(part => ['out', '.vite', '.turbo'].includes(part))) return false
  if (['apps', 'packages', 'scripts', 'vendor', 'resources', 'patches', 'tools'].includes(parts[0]!)) return true
  return parts.length === 1 && /^(?:package\.json|bun\.lockb?|tsconfig[^/]*\.json|vite\.config\.[cm]?[jt]s|electron-builder[^/]*|\.bunfig\.toml|bunfig\.toml)$/.test(path)
}

export function createBuildProvenance(options: {
  rootDir: string
  component: BuildProvenance['component']
  product?: string
  now?: Date
}): BuildProvenance {
  const rootDir = resolve(options.rootDir)
  const git = (args: string[]) => execFileSync('git', ['-C', rootDir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  let commit: string | null = null
  try { commit = git(['rev-parse', '--verify', 'HEAD']).trim() || null } catch { /* Uncommitted repositories have no HEAD. */ }
  // Fail explicitly if this is not a source checkout: an invented empty fingerprint
  // would make unrelated builds appear identical.
  const paths = [...new Set(git(['ls-files', '-z', '--cached', '--others', '--exclude-standard']).split('\0').filter(path => path && isBuildInput(path)))].sort()
  const hash = createHash('sha256')
  for (const path of paths) {
    const absolute = join(rootDir, path)
    hash.update(JSON.stringify(path) + '\0')
    if (!existsSync(absolute)) { hash.update('missing\0'); continue }
    const stat = lstatSync(absolute)
    if (stat.isSymbolicLink()) hash.update('symlink\0' + readlinkSync(absolute) + '\0')
    else if (stat.isFile()) {
      hash.update(`file:${stat.mode & 0o111}:${stat.size}\0`)
      hash.update(readFileSync(absolute))
      hash.update('\0')
    }
  }
  return {
    component: options.component,
    commit,
    sourceHash: hash.digest('hex'),
    dirty: git(['status', '--porcelain=v1', '-z', '--untracked-files=all']).length > 0,
    builtAt: (options.now ?? new Date()).toISOString(),
    product: options.product ?? process.env.CRAFT_PRODUCT_VARIANT ?? 'runner',
  }
}

export function rendererStagingDirectory(destination: string): string {
  return join(dirname(destination), `${basename(destination)}.staging-${randomUUID()}`)
}

/** Publication is reversible until the new complete directory occupies destination.
 * Leave the previous build intact if compilation or the publishing rename fails. */
export function publishRendererBuild(staged: string, destination: string, operations = { exists: existsSync, rename: renameSync, remove: rmSync }): void {
  if (!operations.exists(join(staged, 'index.html'))) throw new Error('Renderer build produced no index.html; previous build retained')
  const previous = join(dirname(destination), `${basename(destination)}.previous-${randomUUID()}`)
  const hadPrevious = operations.exists(destination)
  if (hadPrevious) operations.rename(destination, previous)
  try { operations.rename(staged, destination) }
  catch (error) {
    if (hadPrevious) operations.rename(previous, destination)
    throw error
  }
  if (hadPrevious) {
    try { operations.remove(previous, { recursive: true, force: true }) }
    catch (error) { console.warn('Renderer published; previous build cleanup deferred:', error instanceof Error ? error.message : String(error)) }
  }
}
