import { afterEach, describe, expect, mock, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseHqStateOfPlay, HQ_STATE_CONTEXT_SLUG } from '@craft-agent/shared/hq-state'
import { loadContextDoc, upsertContextDoc } from '@craft-agent/shared/workspace-context'
import {
  refreshHqStateContextDocBestEffort,
  refreshHqStateContextDoc,
  scheduleHqStateContextRefresh,
  cancelScheduledHqStateContextRefresh,
  shouldRefreshHqStateForContextSlug,
} from './refresh'

const workspaces: string[] = []

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { recursive: true, force: true })
  }
})

describe('HQ state refresh', () => {
  test('writes a derived hq-state-of-play context doc from workspace context', () => {
    const workspace = tempWorkspace()
    upsertContextDoc(workspace, {
      slug: 'artist-profile',
      metadata: { name: 'Artist Profile', routing: { mode: 'broadcast' }, enabled: true },
      body: jsonBody({
        version: 1,
        artistName: 'Mikey Mike',
        sound: 'raw soul over strange pop',
        audience: 'cinematic underdog listeners',
        updatedAt: '2026-07-04T00:00:00.000Z',
      }),
    })

    const refreshed = refreshHqStateContextDoc(workspace)
    const loaded = loadContextDoc(workspace, HQ_STATE_CONTEXT_SLUG)
    const state = parseHqStateOfPlay(loaded?.body ?? '')

    expect(refreshed.slug).toBe(HQ_STATE_CONTEXT_SLUG)
    expect(loaded?.metadata.name).toBe('HQ State of Play')
    expect(state?.sources['artist-profile']).toBe('2026-07-04T00:00:00.000Z')
    expect(state?.nextMove.title).toBeTruthy()
  })

  test('does not refresh recursively for the derived doc itself', () => {
    expect(shouldRefreshHqStateForContextSlug(HQ_STATE_CONTEXT_SLUG)).toBe(false)
    expect(shouldRefreshHqStateForContextSlug('artist-profile')).toBe(true)
  })

  test('preserves disabled state on an existing derived context doc', () => {
    const workspace = tempWorkspace()
    upsertContextDoc(workspace, {
      slug: HQ_STATE_CONTEXT_SLUG,
      metadata: {
        name: 'HQ State of Play',
        routing: { mode: 'targeted', agents: ['concierge'] },
        enabled: false,
      },
      body: 'disabled for now',
    })
    upsertContextDoc(workspace, {
      slug: 'artist-profile',
      metadata: { name: 'Artist Profile', routing: { mode: 'broadcast' }, enabled: true },
      body: jsonBody({ version: 1, artistName: 'Mikey Mike', updatedAt: '2026-07-04T00:00:00.000Z' }),
    })

    refreshHqStateContextDoc(workspace)
    const loaded = loadContextDoc(workspace, HQ_STATE_CONTEXT_SLUG)

    expect(loaded?.metadata.enabled).toBe(false)
    expect(loaded?.metadata.routing).toEqual({ mode: 'targeted', agents: ['concierge'] })
    expect(parseHqStateOfPlay(loaded?.body ?? '')?.version).toBe(1)
  })

  test('best-effort refresh swallows invalid workspace failures', () => {
    const originalWarn = console.warn
    const warn = mock(() => {})
    console.warn = warn as typeof console.warn
    try {
      expect(refreshHqStateContextDocBestEffort('/dev/null/not-a-workspace')).toBeNull()
      expect(warn).toHaveBeenCalledWith(
        '[hq-state] Failed to refresh State of Play context doc:',
        expect.stringContaining('not-a-workspace'),
      )
    } finally {
      console.warn = originalWarn
    }
  })

  test('coalesces high-frequency refresh requests by workspace', async () => {
    const workspace = tempWorkspace()
    upsertContextDoc(workspace, {
      slug: 'artist-profile',
      metadata: { name: 'Artist Profile', routing: { mode: 'broadcast' }, enabled: true },
      body: jsonBody({ version: 1, artistName: 'Mikey Mike' }),
    })

    scheduleHqStateContextRefresh(workspace)
    scheduleHqStateContextRefresh(workspace)
    scheduleHqStateContextRefresh(workspace)
    await Bun.sleep(150)

    expect(loadContextDoc(workspace, HQ_STATE_CONTEXT_SLUG)).not.toBeNull()
    cancelScheduledHqStateContextRefresh(workspace)
  })
})

function tempWorkspace(): string {
  const workspace = mkdtempSync(join(tmpdir(), 'runneros-hq-state-'))
  workspaces.push(workspace)
  return workspace
}

function jsonBody(value: unknown): string {
  return ['```json', JSON.stringify(value, null, 2), '```'].join('\n')
}
