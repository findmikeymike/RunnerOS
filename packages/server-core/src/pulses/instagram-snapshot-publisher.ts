import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  ARTIST_INSTAGRAM_SNAPSHOT_CONTEXT_SLUG,
  artistInstagramSnapshotMetadata,
  parseArtistInstagramSnapshotJsonResult,
} from '@craft-agent/shared/artist-context'
import { loadContextDoc, upsertContextDoc, type LoadedContextDoc } from '@craft-agent/shared/workspace-context'

export { ARTIST_INSTAGRAM_SNAPSHOT_CONTEXT_SLUG }

export interface PublishInstagramSnapshotResult {
  published: boolean
  doc?: LoadedContextDoc
  snapshotPath?: string
  reason?: 'missing' | 'stale' | 'unchanged' | 'invalid'
}

export function listInstagramSnapshotPaths(workspaceRootPath: string): string[] {
  const directory = join(workspaceRootPath, 'data', 'instagram', 'snapshots')
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
    .map(entry => join(directory, entry.name))
}

/** Publish only this run's fresh, usable capture; failed runs retain the prior context. */
export function publishLatestInstagramSnapshotContext(
  workspaceRootPath: string,
  options: { minimumModifiedAt?: number; excludePaths?: readonly string[] } = {},
): PublishInstagramSnapshotResult {
  const excluded = new Set(options.excludePaths ?? [])
  const candidates = listInstagramSnapshotPaths(workspaceRootPath)
    .filter(filePath => !excluded.has(filePath))
    .flatMap(filePath => {
      try { return [{ filePath, modifiedAt: statSync(filePath).mtimeMs }] }
      catch { return [] } // A file removed while collecting candidates is not a capture.
    })
    .sort((left, right) => right.modifiedAt - left.modifiedAt)
  if (!candidates.length) return { published: false, reason: 'missing' }
  const fresh = candidates.filter(candidate => options.minimumModifiedAt === undefined
    || candidate.modifiedAt >= options.minimumModifiedAt)
  if (!fresh.length) return { published: false, reason: 'stale' }

  for (const candidate of fresh) {
    let snapshot: Record<string, unknown>
    try {
      const raw = readFileSync(candidate.filePath, 'utf8')
      const value = JSON.parse(raw)
      const parsed = parseArtistInstagramSnapshotJsonResult(raw)
      if (!parsed.ok || !parsed.snapshot || Array.isArray(value?.metrics)) continue
      // Check original values too: unknown/null/string values must never turn into zero.
      const metrics = value.metrics as Record<string, unknown>
      const useful = Object.keys(parsed.snapshot.metrics).some(key => {
        const metric = metrics[key]
        return typeof metric === 'number' && Number.isFinite(metric)
          && (key === 'followerDelta' || metric >= 0)
      })
      if (!useful) continue
      snapshot = value
    } catch { continue } // Skip an incomplete newest file and consider an earlier valid capture.

    const body = [
      'This is the latest read-only Instagram Insights snapshot. Treat it as dated performance context.',
      '', '```json', JSON.stringify(snapshot, null, 2), '```',
    ].join('\n')
    const existing = loadContextDoc(workspaceRootPath, ARTIST_INSTAGRAM_SNAPSHOT_CONTEXT_SLUG)
    if (existing?.body === body) {
      return { published: false, doc: existing, snapshotPath: candidate.filePath, reason: 'unchanged' }
    }
    const doc = upsertContextDoc(workspaceRootPath, {
      slug: ARTIST_INSTAGRAM_SNAPSHOT_CONTEXT_SLUG,
      metadata: artistInstagramSnapshotMetadata(),
      body,
    })
    return { published: true, doc, snapshotPath: candidate.filePath }
  }
  return { published: false, reason: 'invalid' }
}
