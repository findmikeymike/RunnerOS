import { expect, test } from 'bun:test'
import type { MissionAssetKindHint, MissionAssetRecord } from '@craft-agent/shared/mission-assets'
import type { ReleaseKitItem, ReleaseKitManifest } from '@craft-agent/shared/release-kit'
import { promoteCampaignMasterToReleaseKit } from './campaign-master-release-kit'

const asset = (id: string, kind: MissionAssetRecord['kind'] = 'master'): MissionAssetRecord => ({
  id, kind, label: `Track ${id}`, source: 'copy', status: 'available', usableByAgents: true,
  createdAt: '2026-09-25T00:00:00.000Z', updatedAt: '2026-09-25T00:00:00.000Z',
})

test('explicit Master File import awaits exact campaign asset promotion before reporting success', async () => {
  let finish!: (value: { manifest: ReleaseKitManifest; item: ReleaseKitItem }) => void
  let settled = false
  const calls: unknown[][] = []
  const promotion = new Promise<{ manifest: ReleaseKitManifest; item: ReleaseKitItem }>(resolve => finish = resolve)
  const pending = promoteCampaignMasterToReleaseKit({ workspaceId: 'campaign', kindHint: 'master', imported: [asset('a')],
    promote: (...args) => { calls.push(args); return promotion },
  }).then(result => { settled = true; return result })
  await Promise.resolve()
  expect(settled).toBe(false)
  expect(calls).toEqual([['campaign', {
    source: { type: 'campaign-asset', assetId: 'a' }, category: 'audio', subtype: 'master', title: 'Track a', makePrimary: true,
  }]])
  const saved = { manifest: { campaignId: 'campaign' } as ReleaseKitManifest, item: { id: 'final-a' } as ReleaseKitItem }
  finish(saved)
  expect(await pending).toEqual({ status: 'promoted', ...saved })
})

test.each([
  ['any', [asset('a')]], ['lyrics', [asset('a')]], ['cover-art', [asset('a')]],
  ['master', []], ['master', [asset('demo', 'demo')]],
] as Array<[MissionAssetKindHint, MissionAssetRecord[]]>)('%s imports without an explicit single master do not promote', async (kindHint, imported) => {
  let calls = 0
  expect(await promoteCampaignMasterToReleaseKit({ workspaceId: 'campaign', kindHint, imported,
    promote: async () => { calls++; throw new Error('must not promote') },
  })).toEqual({ status: 'skipped' })
  expect(calls).toBe(0)
})

test('multiple imported masters require selection without replacing final audio', async () => {
  let calls = 0
  expect(await promoteCampaignMasterToReleaseKit({ workspaceId: 'campaign', kindHint: 'master', imported: [asset('a'), asset('b')],
    promote: async () => { calls++; throw new Error('must not select a winner') },
  })).toEqual({ status: 'requires-selection' })
  expect(calls).toBe(0)
})

test('replacement failures propagate so guarded existing final audio is not reported replaced', async () => {
  const failure = new Error('Final audio is referenced by scheduled work')
  await expect(promoteCampaignMasterToReleaseKit({ workspaceId: 'campaign', kindHint: 'master', imported: [asset('a')],
    promote: async () => { throw failure },
  })).rejects.toBe(failure)
})
