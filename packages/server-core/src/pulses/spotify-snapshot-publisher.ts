import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { loadContextDoc, upsertContextDoc, type LoadedContextDoc } from '@craft-agent/shared/workspace-context'

export const ARTIST_SPOTIFY_SNAPSHOT_CONTEXT_SLUG = 'artist-spotify-snapshot'

export interface PublishSpotifySnapshotResult {
  published: boolean
  doc?: LoadedContextDoc
  snapshotPath?: string
  reason?: 'missing' | 'stale' | 'unchanged' | 'invalid'
}

export function listSpotifySnapshotPaths(workspaceRootPath: string): string[] {
  const directory = join(workspaceRootPath, 'data', 'spotify', 'snapshots')
  if (!existsSync(directory)) return []
  return readdirSync(directory).filter(name => name.endsWith('.json')).map(name => join(directory, name))
}

export function publishLatestSpotifySnapshotContext(
  workspaceRootPath: string,
  options: { minimumModifiedAt?: number; excludePaths?: readonly string[] } = {},
): PublishSpotifySnapshotResult {
  const snapshotsDir = join(workspaceRootPath, 'data', 'spotify', 'snapshots')
  if (!existsSync(snapshotsDir)) return { published: false, reason: 'missing' }

  const candidates = readdirSync(snapshotsDir)
    .filter((name) => name.endsWith('.json'))
    .filter((name) => !options.excludePaths?.includes(join(snapshotsDir, name)))
    .map((name) => {
      const filePath = join(snapshotsDir, name)
      return { filePath, modifiedAt: statSync(filePath).mtimeMs }
    })
    .sort((left, right) => right.modifiedAt - left.modifiedAt)

  if (!candidates.length) return { published: false, reason: 'missing' }
  const fresh = candidates.filter((candidate) => !options.minimumModifiedAt
    || candidate.modifiedAt >= options.minimumModifiedAt)
  if (!fresh.length) return { published: false, reason: 'stale' }

  // A partially written or invalid newest file must not hide a valid capture.
  let latest: typeof candidates[number] | undefined
  let snapshot: Record<string, unknown> | undefined
  for (const candidate of fresh) {
    try {
      const value = JSON.parse(readFileSync(candidate.filePath, 'utf8'))
      const metrics = value?.metrics
      const usefulMetric = (metric: unknown) => typeof metric === 'number' && Number.isFinite(metric) && metric >= 0
      if (typeof value?.snapshotDate !== 'string'
        || !/^\d{4}-\d{2}-\d{2}$/.test(value.snapshotDate)
        || !metrics || typeof metrics !== 'object' || Array.isArray(metrics)
        || (!usefulMetric(metrics.streams) && !usefulMetric(metrics.listeners))) continue
      latest = candidate
      snapshot = value
      break
    } catch { /* Atomic writer may still be completing; retry on the next poll. */ }
  }
  if (!latest || !snapshot) return { published: false, reason: 'invalid' }

  const body = [
    'This is the latest global Spotify for Artists analytics snapshot. Treat it as dated performance context.',
    '',
    '```json',
    JSON.stringify(snapshot, null, 2),
    '```',
  ].join('\n')
  const existing = loadContextDoc(workspaceRootPath, ARTIST_SPOTIFY_SNAPSHOT_CONTEXT_SLUG)
  if (existing?.body === body) {
    return { published: false, doc: existing, snapshotPath: latest.filePath, reason: 'unchanged' }
  }

  const doc = upsertContextDoc(workspaceRootPath, {
    slug: ARTIST_SPOTIFY_SNAPSHOT_CONTEXT_SLUG,
    metadata: {
      name: 'Artist Spotify Snapshot',
      description: 'Latest Spotify for Artists analytics snapshot for Artist HQ widgets and workers.',
      routing: { mode: 'broadcast' },
      enabled: true,
    },
    body,
  })
  return { published: true, doc, snapshotPath: latest.filePath }
}
