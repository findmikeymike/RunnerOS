import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { CONFIG_DIR } from '@craft-agent/shared/config/paths'
import { RUNTIME_IDENTITY } from '@craft-agent/shared/config/runtime-identity'
import type { Workspace } from '@craft-agent/core/types'

interface Identity { dev: number; ino: number }
export interface CampaignStagedRoot { source: string; staged: string }
interface JournalRoot extends CampaignStagedRoot { identity: Identity; parentIdentity: Identity }
interface Journal {
  version: 1
  transactionId: string
  campaign: { id: string; rootPath: string; createdAt: number }
  roots: JournalRoot[]
}
export interface CampaignRemovalJournal {
  verifyRoot(root: CampaignStagedRoot, location: 'source' | 'staged'): void
  syncRoot(root: CampaignStagedRoot): void
  finish(): void
  registrationRemoved(): boolean
  syncRegistration(): void
}
interface Registration { id: string; rootPath: string; createdAt: number; artistWorkspaceScope?: string }
export interface CampaignCleanupRecoveryOptions {
  configDir?: string
  /** Raw read only: never use loadStoredConfig, which initializes missing roots. */
  readRegistration?: () => unknown
}

function overlaps(a: string, b: string): boolean {
  const contains = (parent: string, child: string) => {
    const rel = relative(parent, child)
    return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
  }
  return contains(a, b) || contains(b, a)
}
function identity(path: string): Identity {
  const stat = lstatSync(path)
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Expected an unlinked directory')
  return { dev: stat.dev, ino: stat.ino }
}
function same(a: Identity, b: Identity): boolean { return a.dev === b.dev && a.ino === b.ino }
function present(path: string): boolean {
  try { lstatSync(path); return true }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error }
}
/** Check every ancestor; lstat on only the last component misses redirected parents. */
function safeDirectory(path: string): void {
  if (!isAbsolute(path) || resolve(path) !== path) throw new Error('Non-canonical path')
  let cursor = path
  while (true) {
    identity(cursor)
    const parent = dirname(cursor)
    if (parent === cursor) break
    cursor = parent
  }
}
function syncDirectory(path: string): void {
  const fd = openSync(path, 'r')
  try { fsyncSync(fd) } finally { closeSync(fd) }
}
function journalDirectory(configDir: string, create = false): string {
  safeDirectory(configDir)
  const directory = join(configDir, 'campaign-cleanup-transactions')
  if (create && !present(directory)) { mkdirSync(directory, { mode: 0o700 }); syncDirectory(configDir) }
  if (present(directory)) safeDirectory(directory)
  return directory
}
function validIdentity(value: unknown): value is Identity {
  const v = value as Identity | undefined
  return !!v && Number.isSafeInteger(v.dev) && v.dev >= 0 && Number.isSafeInteger(v.ino) && v.ino > 0
}
function parseJournal(value: unknown, filename: string): Journal {
  const j = value as Journal | undefined
  if (!j || j.version !== 1 || typeof j.transactionId !== 'string' || !/^[0-9a-f-]{36}$/.test(j.transactionId)
    || filename !== `${j.transactionId}.json` || !j.campaign || !/^[a-zA-Z0-9_-]+$/.test(j.campaign.id)
    || !Number.isFinite(j.campaign.createdAt) || typeof j.campaign.rootPath !== 'string'
    || !isAbsolute(j.campaign.rootPath) || resolve(j.campaign.rootPath) !== j.campaign.rootPath
    || !Array.isArray(j.roots) || j.roots.length < 1 || j.roots.length > 2) throw new Error('Invalid cleanup journal')
  for (const root of j.roots) {
    if (!root || typeof root.source !== 'string' || !isAbsolute(root.source) || resolve(root.source) !== root.source
      || root.staged !== join(dirname(root.source), `.${basename(root.source)}.artist-os-delete-${j.transactionId}`)
      || !validIdentity(root.identity) || !validIdentity(root.parentIdentity)) throw new Error('Invalid cleanup root')
  }
  if (!j.roots.some(root => root.source === j.campaign.rootPath)) throw new Error('Missing registered cleanup root')
  if (j.roots.length === 2 && overlaps(j.roots[0]!.source, j.roots[1]!.source)) throw new Error('Overlapping cleanup roots')
  return j
}
function canonicalPath(path: string): string {
  let ancestor = resolve(path)
  const suffix: string[] = []
  while (!present(ancestor)) {
    const parent = dirname(ancestor)
    if (parent === ancestor) throw new Error('Unresolvable path')
    suffix.unshift(basename(ancestor))
    ancestor = parent
  }
  return join(realpathSync(ancestor), ...suffix)
}
function registrations(value: unknown): Registration[] {
  const workspaces = (value as { workspaces?: unknown } | null)?.workspaces
  if (!Array.isArray(workspaces)) throw new Error('Campaign registration could not be read')
  const seen = new Set<string>()
  return workspaces.map((raw: unknown) => {
    const item = raw as Registration
    if (!item || typeof item.id !== 'string' || seen.has(item.id) || typeof item.rootPath !== 'string'
      || !Number.isFinite(item.createdAt)) throw new Error('Invalid workspace registration')
    seen.add(item.id)
    let path = item.rootPath
    if (path === '~' || path.startsWith('~/')) path = join(homedir(), path.slice(1))
    path = path.replace(/\$\{HOME\}|\$HOME(?=\/|$)/g, homedir())
    if (!isAbsolute(path)) throw new Error('Ambiguous workspace registration path')
    return { ...item, rootPath: canonicalPath(path) }
  })
}
function validatePaths(journal: Journal, configDir: string, workspaces: Registration[]): void {
  // A second root can only be the exact legacy campaign directory.
  const legacy = resolve(join(RUNTIME_IDENTITY.workspacesRoot, journal.campaign.id))
  for (const root of journal.roots) {
    if (root.source !== journal.campaign.rootPath && root.source !== legacy) throw new Error('Unrecognized campaign root')
    const protectedPaths = [homedir(), tmpdir(), configDir, RUNTIME_IDENTITY.workspacesRoot, process.cwd()].map(path => canonicalPath(path))
    if (protectedPaths.some(path => path === root.source || relative(root.source, path).split(sep)[0] !== '..' && !isAbsolute(relative(root.source, path)))) {
      throw new Error('Cleanup root contains protected data')
    }
    safeDirectory(dirname(root.source))
    if (!same(identity(dirname(root.source)), root.parentIdentity)) throw new Error('Cleanup parent directory changed')
    for (const workspace of workspaces) {
      if (workspace.id === journal.campaign.id && workspace.rootPath === journal.campaign.rootPath) continue
      if (overlaps(root.source, workspace.rootPath) || overlaps(root.staged, workspace.rootPath)) throw new Error('Cleanup overlaps a registered workspace')
    }
  }
}
function verifyRoot(root: JournalRoot, location: 'source' | 'staged'): void {
  if (present(root[location === 'source' ? 'staged' : 'source'])) throw new Error('Cleanup counterpart path already exists')
  safeDirectory(dirname(root.source))
  if (!same(identity(dirname(root.source)), root.parentIdentity) || !same(identity(root[location]), root.identity)) {
    throw new Error('Cleanup directory identity changed')
  }
}

/** Persist intent and ownership before any workspace rename. */
export function beginCampaignRemovalJournal(
  workspace: Workspace,
  roots: readonly string[],
  configWorkspaces: readonly Workspace[],
  configDir = CONFIG_DIR,
): { roots: CampaignStagedRoot[]; journal: CampaignRemovalJournal } {
  configDir = canonicalPath(configDir)
  const transactionId = randomUUID()
  const directory = journalDirectory(configDir, true)
  const path = join(directory, `${transactionId}.json`)
  const journal: Journal = {
    version: 1, transactionId,
    campaign: { id: workspace.id, rootPath: canonicalPath(workspace.rootPath), createdAt: workspace.createdAt },
    roots: roots.map(source => {
      source = canonicalPath(source)
      safeDirectory(source)
      const staged = join(dirname(source), `.${basename(source)}.artist-os-delete-${transactionId}`)
      if (present(staged)) throw new Error('Cleanup staging destination already exists')
      return { source, staged, identity: identity(source), parentIdentity: identity(dirname(source)) }
    }),
  }
  parseJournal(journal, basename(path))
  validatePaths(journal, configDir, registrations({ workspaces: configWorkspaces }))
  const temporary = `${path}.tmp`
  const fd = openSync(temporary, 'wx', 0o600)
  try { writeFileSync(fd, JSON.stringify(journal)); fsyncSync(fd) } finally { closeSync(fd) }
  renameSync(temporary, path)
  syncDirectory(directory)
  const journalIdentity = lstatSync(path)
  return {
    roots: journal.roots.map(({ source, staged }) => ({ source, staged })),
    journal: {
      verifyRoot(root, location) {
        const owned = journal.roots.find(item => item.source === root.source && item.staged === root.staged)
        if (!owned) throw new Error('Unrecognized cleanup root')
        verifyRoot(owned, location)
      },
      syncRoot(root) { syncDirectory(dirname(root.source)) },
      registrationRemoved() {
        const configPath = join(configDir, 'config.json')
        const stat = lstatSync(configPath)
        if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Unsafe config')
        const current = registrations(JSON.parse(readFileSync(configPath, 'utf8'))).find(item => item.id === workspace.id)
        if (!current) return true
        if (current.rootPath !== journal.campaign.rootPath || current.createdAt !== journal.campaign.createdAt) throw new Error('Campaign registration changed')
        return false
      },
      syncRegistration() {
        const configPath = join(configDir, 'config.json')
        const stat = lstatSync(configPath)
        if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Unsafe config')
        const fd = openSync(configPath, 'r')
        try { fsyncSync(fd) } finally { closeSync(fd) }
        syncDirectory(configDir)
      },
      finish() {
        const current = lstatSync(path)
        if (current.isSymbolicLink() || current.dev !== journalIdentity.dev || current.ino !== journalIdentity.ino) throw new Error('Cleanup journal changed')
        rmSync(path)
        syncDirectory(directory)
      },
    },
  }
}

/** Runs before config loaders can recreate registered folders. Never migrates config. */
export function recoverCampaignCleanupTransactions(options: CampaignCleanupRecoveryOptions = {}): string[] {
  const warnings: string[] = []
  let configDir = resolve(options.configDir ?? CONFIG_DIR)
  let directory: string
  let entries: string[]
  try {
    if (!existsSync(configDir)) return warnings
    configDir = canonicalPath(configDir)
    directory = journalDirectory(configDir)
    if (!present(directory)) return warnings
    entries = readdirSync(directory)
  } catch { return ['Campaign cleanup recovery could not safely read its journal folder. Files were left untouched.'] }
  let workspaces: Registration[]
  try {
    const configPath = join(configDir, 'config.json')
    if (!options.readRegistration) {
      const stat = lstatSync(configPath)
      if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Unsafe config')
    }
    workspaces = registrations(options.readRegistration ? options.readRegistration() : JSON.parse(readFileSync(configPath, 'utf8')))
  } catch { return entries.length ? ['Campaign cleanup recovery needs readable workspace registration. Cleanup journals and files were left untouched.'] : warnings }
  for (const filename of entries) {
    if (!/^[0-9a-f-]{36}\.json$/.test(filename)) {
      warnings.push('An incomplete or unrecognized campaign cleanup journal was left untouched.')
      continue
    }
    const path = join(directory, filename)
    try {
      const journalStat = lstatSync(path)
      if (journalStat.isSymbolicLink() || !journalStat.isFile() || journalStat.size > 32_768) throw new Error('Unsafe journal')
      const journal = parseJournal(JSON.parse(readFileSync(path, 'utf8')), filename)
      validatePaths(journal, configDir, workspaces)
      const registered = workspaces.find(workspace => workspace.id === journal.campaign.id)
      if (registered && (registered.rootPath !== journal.campaign.rootPath || registered.createdAt !== journal.campaign.createdAt
        || registered.artistWorkspaceScope !== 'campaign')) throw new Error('Campaign registration changed')
      // Validate the whole transaction before modifying any root.
      for (const root of journal.roots) {
        const sourceExists = present(root.source)
        const stagedExists = present(root.staged)
        if (sourceExists) verifyRoot(root, 'source')
        if (stagedExists) verifyRoot(root, 'staged')
        if (sourceExists && stagedExists) throw new Error('Both cleanup paths exist')
        if (registered && !sourceExists && !stagedExists) throw new Error('Campaign files are missing')
        if (!registered && sourceExists) throw new Error('Unregistered source path still exists')
      }
      if (!registered && !options.readRegistration) {
        const fd = openSync(join(configDir, 'config.json'), 'r')
        try { fsyncSync(fd) } finally { closeSync(fd) }
        syncDirectory(configDir)
      }
      for (const root of [...journal.roots].reverse()) {
        if (!present(root.staged)) continue
        verifyRoot(root, 'staged')
        if (present(root.source)) throw new Error('Cleanup destination appeared')
        if (registered) renameSync(root.staged, root.source)
        else rmSync(root.staged, { recursive: true })
        syncDirectory(dirname(root.source))
      }
      const current = lstatSync(path)
      if (current.isSymbolicLink() || current.dev !== journalStat.dev || current.ino !== journalStat.ino) throw new Error('Cleanup journal changed')
      rmSync(path)
      syncDirectory(directory)
    } catch {
      warnings.push(`Campaign cleanup recovery left ${filename} incomplete. Remaining files and its journal were retained because registration, ownership, or filesystem completion could not be safely confirmed.`)
    }
  }
  return warnings
}
