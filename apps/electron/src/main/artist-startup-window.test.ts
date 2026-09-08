import { expect, test } from 'bun:test'
import { artistStartupWindow } from './artist-startup-window'

const workspaces = [
  { id: 'release', artistWorkspaceScope: 'campaign' },
  { id: 'lab', artistWorkspaceScope: 'lab' },
  { id: 'artist', artistWorkspaceScope: 'hq' },
]
test('normal Artist OS startup selects HQ even when a campaign is first', () => {
  expect(artistStartupWindow('artist-os', workspaces)).toEqual({ workspaceId: 'artist', initialPage: 'hq-overview' })
})
test('startup does not guess that a campaign is HQ when HQ is unavailable', () => {
  expect(artistStartupWindow('artist-os', workspaces.slice(0, 2))).toBeNull()
  expect(artistStartupWindow('artist-os', [])).toBeNull()
})
test('other products retain their own window restoration policy', () => {
  expect(artistStartupWindow('launch-os', workspaces)).toBeNull()
})
