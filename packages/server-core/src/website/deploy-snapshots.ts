import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { websiteRoot } from '@craft-agent/shared/website'

/**
 * Retained build output, one directory per production deploy.
 *
 * Rollback is implemented here rather than per adapter. Every host has a
 * different notion of a version, and some have none, so the reliable way to
 * restore exactly what was live is to keep the bytes and re-deploy them.
 * An artist site is small, and hosts dedupe uploads by content hash, so the
 * cost is a few hundred KB and a repeat upload that mostly no-ops.
 */
const SNAPSHOT_DIR = '.deploys'

/** Enough history for the rollback the artist actually reaches for. */
export const MAX_RETAINED_SNAPSHOTS = 5

export function deploySnapshotsRoot(workspaceRootPath: string): string {
  return join(websiteRoot(workspaceRootPath), SNAPSHOT_DIR)
}

export function deploySnapshotDir(workspaceRootPath: string, deployId: string): string {
  return join(deploySnapshotsRoot(workspaceRootPath), safeId(deployId))
}

export function hasDeploySnapshot(workspaceRootPath: string, deployId: string): boolean {
  const dir = deploySnapshotDir(workspaceRootPath, deployId)
  return existsSync(dir) && statSync(dir).isDirectory() && readdirSync(dir).length > 0
}

/** Deploy ids come from hosts, so never let one escape the snapshot folder. */
function safeId(deployId: string): string {
  const cleaned = deployId.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[.-]+/, '').slice(0, 120)
  if (!cleaned) throw new Error(`Unusable deploy id: ${deployId}`)
  return cleaned
}

export function retainDeploySnapshot(
  workspaceRootPath: string,
  deployId: string,
  distDir: string,
): string {
  if (!existsSync(distDir)) throw new Error(`No build to retain at ${distDir}`)
  const target = deploySnapshotDir(workspaceRootPath, deployId)
  mkdirSync(deploySnapshotsRoot(workspaceRootPath), { recursive: true })
  rmSync(target, { recursive: true, force: true })
  cpSync(distDir, target, { recursive: true, dereference: true })
  pruneDeploySnapshots(workspaceRootPath)
  return target
}

/** Drop the oldest snapshots past the retention cap. */
export function pruneDeploySnapshots(
  workspaceRootPath: string,
  keep = MAX_RETAINED_SNAPSHOTS,
): string[] {
  const root = deploySnapshotsRoot(workspaceRootPath)
  if (!existsSync(root)) return []

  const entries = readdirSync(root)
    .map(name => ({ name, path: join(root, name) }))
    .filter(entry => existsSync(entry.path) && statSync(entry.path).isDirectory())
    .sort((a, b) => statSync(b.path).mtimeMs - statSync(a.path).mtimeMs)

  const removed: string[] = []
  for (const entry of entries.slice(keep)) {
    rmSync(entry.path, { recursive: true, force: true })
    removed.push(entry.name)
  }
  return removed
}
