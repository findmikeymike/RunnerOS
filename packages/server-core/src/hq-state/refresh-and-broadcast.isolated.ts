import { beforeEach, expect, mock, test } from 'bun:test'
import type { LoadedContextDoc } from '@craft-agent/shared/workspace-context'

const workspaces = [
  { id: 'hq', rootPath: '/fixture/hq', artistWorkspaceScope: 'hq' },
  { id: 'campaign', rootPath: '/fixture/campaign', artistWorkspaceScope: 'campaign' },
  { id: 'other-campaign', rootPath: '/fixture/other-campaign', artistWorkspaceScope: 'campaign' },
  { id: 'unrelated', rootPath: '/fixture/unrelated' },
]
let refreshed = false
const refresh = mock(() => { refreshed = true; return { hq: null, campaigns: [] } })
mock.module('@craft-agent/shared/config', () => ({ getWorkspaces: () => workspaces }))
mock.module('@craft-agent/shared/workspace-context', () => ({
  loadAllContextDocs: (root: string) => [{ slug: 'brief', body: `${root}:${refreshed ? 'fresh' : 'stale'}` }],
}))
mock.module('./refresh', () => ({ refreshArtistManagerStateForWorkspaceBestEffort: refresh }))
const { refreshAndBroadcastArtistManagerState } = await import('./refresh-and-broadcast')

beforeEach(() => { refreshed = false; refresh.mockClear() })

test('campaign mutations publish fresh campaign and HQ context without touching other campaigns', () => {
  const broadcast = mock((_workspaceId: string, _docs: Pick<LoadedContextDoc, 'slug' | 'body'>[]) => {})
  refreshAndBroadcastArtistManagerState('/fixture/campaign', broadcast)
  expect(refresh).toHaveBeenCalledWith('/fixture/campaign')
  expect(broadcast.mock.calls).toEqual([
    ['hq', [{ slug: 'brief', body: '/fixture/hq:fresh' }]],
    ['campaign', [{ slug: 'brief', body: '/fixture/campaign:fresh' }]],
  ])
})

test('HQ mutations publish every dependent campaign after refreshing', () => {
  const ids: string[] = []
  refreshAndBroadcastArtistManagerState('/fixture/hq', id => { ids.push(id) })
  expect(ids).toEqual(['hq', 'campaign', 'other-campaign'])
  expect(refresh).toHaveBeenCalledTimes(1)
})

test('one renderer notification failure does not lose the remaining updates or fail the mutation', () => {
  const ids: string[] = []
  expect(() => refreshAndBroadcastArtistManagerState('/fixture/campaign', id => {
    ids.push(id)
    if (id === 'hq') throw new Error('disconnected')
  })).not.toThrow()
  expect(ids).toEqual(['hq', 'campaign'])
})
