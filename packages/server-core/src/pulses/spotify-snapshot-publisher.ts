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

export function publishLatestSpotifySnapshotContext(
  workspaceRootPath: string,
  options: { minimumModifiedAt?: number } = {},
): PublishSpotifySnapshotResult {
  const snapshotsDir = join(workspaceRootPath, 'data', 'spotify', 'snapshots')
  if (!existsSync(snapshotsDir)) return { published: false, reason: 'missing' }

  const candidates = readdirSync(snapshotsDir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      const filePath = join(snapshotsDir, name)
      return { filePath, modifiedAt: statSync(filePath).mtimeMs }
    })
    .sort((left, right) => right.modifiedAt - left.modifiedAt)

  const latest = candidates[0]
  if (!latest) return { published: false, reason: 'missing' }
  if (options.minimumModifiedAt && latest.modifiedAt < options.minimumModifiedAt - 1_000) {
    return { published: false, snapshotPath: latest.filePath, reason: 'stale' }
  }

  let snapshot: Record<string, unknown>
  try {
    snapshot = JSON.parse(readFileSync(latest.filePath, 'utf8')) as Record<string, unknown>
  } catch {
    return { published: false, snapshotPath: latest.filePath, reason: 'invalid' }
  }
  if (
    typeof snapshot.snapshotDate !== 'string'
    || !snapshot.metrics
    || typeof snapshot.metrics !== 'object'
    || Array.isArray(snapshot.metrics)
  ) {
    return { published: false, snapshotPath: latest.filePath, reason: 'invalid' }
  }

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
