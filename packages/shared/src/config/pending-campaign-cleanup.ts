/** Leaf filesystem guard: config reads must not recreate a staged campaign. */
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

export interface PendingCampaignCleanup {
  blockAllWorkspaceInitialization: boolean
  protectedRootPaths: ReadonlySet<string>
}
function present(path: string): boolean {
  try { lstatSync(path); return true }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error }
}
function canonicalPath(path: string): string {
  let cursor = resolve(path)
  const suffix: string[] = []
  while (!present(cursor)) {
    const parent = dirname(cursor)
    if (parent === cursor) throw new Error('Unresolvable cleanup path')
    suffix.unshift(basename(cursor)); cursor = parent
  }
  return join(realpathSync(cursor), ...suffix)
}
function validIdentity(value: unknown): boolean {
  const v = value as { dev?: number; ino?: number } | undefined
  return !!v && Number.isSafeInteger(v.dev) && v.dev! >= 0 && Number.isSafeInteger(v.ino) && v.ino! > 0
}

/** Unknown/unreadable journals suppress mkdir only; config remains readable. */
export function readPendingCampaignCleanup(configDir: string): PendingCampaignCleanup {
  const protectedRootPaths = new Set<string>()
  const blocked = (): PendingCampaignCleanup => ({ blockAllWorkspaceInitialization: true, protectedRootPaths })
  try {
    const directory = join(canonicalPath(configDir), 'campaign-cleanup-transactions')
    if (!present(directory)) return { blockAllWorkspaceInitialization: false, protectedRootPaths }
    const directoryStat = lstatSync(directory)
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) return blocked()
    for (const filename of readdirSync(directory)) {
      if (!/^[0-9a-f-]{36}\.json$/.test(filename)) return blocked()
      const file = join(directory, filename)
      const stat = lstatSync(file)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32_768) return blocked()
      const journal = JSON.parse(readFileSync(file, 'utf8'))
      if (journal?.version !== 1 || `${journal.transactionId}.json` !== filename
        || !journal.campaign || typeof journal.campaign.id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(journal.campaign.id)
        || typeof journal.campaign.rootPath !== 'string' || !isAbsolute(journal.campaign.rootPath)
        || !Number.isFinite(journal.campaign.createdAt) || !Array.isArray(journal.roots)
        || journal.roots.length < 1 || journal.roots.length > 2) return blocked()
      let hasCampaignRoot = false
      for (const root of journal.roots) {
        if (!root || typeof root.source !== 'string' || !isAbsolute(root.source) || resolve(root.source) !== root.source
          || root.staged !== join(dirname(root.source), `.${basename(root.source)}.artist-os-delete-${journal.transactionId}`)
          || !validIdentity(root.identity) || !validIdentity(root.parentIdentity)) return blocked()
        protectedRootPaths.add(canonicalPath(root.source))
        if (root.source === journal.campaign.rootPath) hasCampaignRoot = true
      }
      if (!hasCampaignRoot) return blocked()
    }
    return { blockAllWorkspaceInitialization: false, protectedRootPaths }
  } catch { return blocked() }
}

export function isWorkspaceInitializationBlockedByCampaignCleanup(rootPath: string, pending: PendingCampaignCleanup): boolean {
  if (pending.blockAllWorkspaceInitialization) return true
  if (!pending.protectedRootPaths.size) return false
  try {
    const target = canonicalPath(rootPath)
    const contains = (parent: string, child: string) => {
      const rel = relative(parent, child)
      return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
    }
    return [...pending.protectedRootPaths].some(root => contains(root, target) || contains(target, root))
  }
  catch { return true }
}
