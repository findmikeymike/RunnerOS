import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import path from 'node:path'

const TRADE_GOD_DIR_NAME = '.trade-god'
const RUNNER_DIR_NAME = '.craft-agent'

const resolveStoredPath = (value: string, homeDir: string): string => {
  const expanded = value
    .replace(/^~(?=$|[\\/])/, homeDir)
    .replaceAll('${HOME}', homeDir)
  return path.resolve(expanded)
}

const isInside = (candidate: string, root: string): boolean => {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

const assertNotSymlink = (candidate: string, label: string): void => {
  if (existsSync(candidate) && lstatSync(candidate).isSymbolicLink()) {
    throw new Error(`[trade-god] Refusing ${label}: symbolic links cannot own Trade God runtime state.`)
  }
}

const assertPathContained = (candidate: string, root: string, label: string): void => {
  if (!isInside(candidate, root)) {
    throw new Error(`[trade-god] Refusing ${label} outside the Trade God runtime root.`)
  }

  assertNotSymlink(root, 'runtime root')
  let cursor = candidate
  while (isInside(cursor, root)) {
    assertNotSymlink(cursor, label)
    if (cursor === root) break
    cursor = path.dirname(cursor)
  }

  if (existsSync(root) && existsSync(candidate)) {
    const realRoot = realpathSync(root)
    const realCandidate = realpathSync(candidate)
    if (!isInside(realCandidate, realRoot)) {
      throw new Error(`[trade-god] Refusing ${label}: its real path escapes the Trade God runtime root.`)
    }
  }
}

const assertNoSymlinksBelow = (root: string): void => {
  if (!existsSync(root)) return
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name)
    if (entry.isSymbolicLink()) {
      throw new Error('[trade-god] Refusing workspace registry containing a symbolic-link escape.')
    }
    if (entry.isDirectory()) assertNoSymlinksBelow(entryPath)
  }
}

export const applyPackagedTradeGodRuntimeIdentity = (
  env: NodeJS.ProcessEnv,
  homeDir: string,
  isPackaged = true,
): void => {
  if (!isPackaged) return

  const runtimeRoot = path.join(homeDir, TRADE_GOD_DIR_NAME)
  env.CRAFT_CONFIG_DIR = runtimeRoot
  env.CRAFT_USER_DATA_DIR = path.join(runtimeRoot, 'electron')
  env.CRAFT_APP_NAME = 'Trade God'
  env.CRAFT_DEEPLINK_SCHEME = 'tradegod'
  env.CRAFT_TRIGGER_PORT = '9201'
  env.CRAFT_TRIGGER_HOST = '127.0.0.1'

  // Packaged Trade God is never a thin client for another Runner-family app
  // and never resolves runtime assets from another worktree.
  delete env.CRAFT_SERVER_URL
  delete env.RUNNEROS_ROOT
}

export const assertTradeGodRuntimeBoundary = (
  env: NodeJS.ProcessEnv,
  homeDir: string,
  isPackaged: boolean,
): void => {
  const expectedRoot = path.resolve(homeDir, TRADE_GOD_DIR_NAME)
  const runnerRoot = path.resolve(homeDir, RUNNER_DIR_NAME)
  const configRoot = resolveStoredPath(env.CRAFT_CONFIG_DIR ?? expectedRoot, homeDir)
  const userDataRoot = resolveStoredPath(
    env.CRAFT_USER_DATA_DIR ?? path.join(configRoot, 'electron'),
    homeDir,
  )

  if (isPackaged && configRoot !== expectedRoot) {
    throw new Error('[trade-god] Packaged runtime root must be ~/.trade-god.')
  }
  if (isInside(configRoot, runnerRoot) || isInside(userDataRoot, runnerRoot)) {
    throw new Error('[trade-god] Refusing to use Runner or Artist OS runtime storage.')
  }

  assertPathContained(userDataRoot, configRoot, 'Electron user data')
  assertNotSymlink(configRoot, 'runtime root')

  const configPath = path.join(configRoot, 'config.json')
  if (!existsSync(configPath)) return
  assertNotSymlink(configPath, 'runtime config')

  let stored: unknown
  try {
    stored = JSON.parse(readFileSync(configPath, 'utf8'))
  } catch {
    throw new Error('[trade-god] Refusing unreadable runtime config; workspace isolation cannot be proven.')
  }

  const workspaces = (stored as { workspaces?: unknown })?.workspaces
  if (!Array.isArray(workspaces)) {
    throw new Error('[trade-god] Refusing runtime config without a valid workspace registry.')
  }

  const workspacesRoot = path.join(configRoot, 'workspaces')
  assertNoSymlinksBelow(workspacesRoot)
  for (const workspace of workspaces) {
    const candidate = workspace as { rootPath?: unknown; remoteServer?: unknown }
    if (candidate.remoteServer !== undefined) {
      throw new Error('[trade-god] Refusing a remote Runner workspace; Trade God owns a local isolated runtime.')
    }
    const rootPath = candidate.rootPath
    if (typeof rootPath !== 'string' || rootPath.trim() === '') {
      throw new Error('[trade-god] Refusing workspace without a valid root path.')
    }
    const resolvedRoot = resolveStoredPath(rootPath, homeDir)
    assertPathContained(resolvedRoot, workspacesRoot, 'workspace')
  }
}
