import { afterEach, expect, mock, test } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import * as actualRefresh from '../../hq-state/refresh'
import * as actualConfig from '@craft-agent/shared/config'
import * as actualWorkspaces from '@craft-agent/shared/workspaces'
import { importMissionAssets } from '@craft-agent/shared/mission-assets'
import { importArtistVaultAssets } from '@craft-agent/shared/artist-vault'
import { hashFileSha256 } from '@craft-agent/shared/release-kit'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'

const roots: string[] = []
const workspaces = new Map<string, { id: string; rootPath: string }>()
const transcriber = mock(async ({ audioFile }: { audioFile: string }) => ({
  ok: true, lyricsText: 'One actual lyric', lyricLines: [{ text: 'One actual lyric', start_time: 0, end_time: 1 }],
  engine: 'fixture', sourceSha256: hashFileSha256(audioFile),
}))
mock.module('@craft-agent/shared/config', () => ({ ...actualConfig, getWorkspaceByNameOrId: (id: string) => workspaces.get(id), getWorkspaces: () => [] }))
mock.module('@craft-agent/shared/workspaces', () => ({ ...actualWorkspaces, assertTeamPermission: () => {} }))
mock.module('../../track-intelligence/LyricsTranscriptionService', () => ({ transcribeLyricsLocally: transcriber }))
mock.module('../../hq-state/refresh', () => ({ ...actualRefresh, refreshArtistManagerStateForWorkspaceBestEffort: () => {}, refreshHqStateContextDocBestEffort: () => {} }))
const { registerMissionAssetsHandlers } = await import('./mission-assets')
const { registerArtistVaultHandlers } = await import('./artist-vault')

afterEach(() => { roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })); transcriber.mockClear(); workspaces.clear() })

for (const vault of [false, true]) {
  test(`${vault ? 'HQ Vault' : 'campaign'} queued transcription reuses the draft and preserves reviewed lyrics`, async () => {
    const root = mkdtempSync(join(tmpdir(), 'release-lyrics-rpc-'))
    roots.push(root)
    workspaces.set('fixture', { id: 'fixture', rootPath: root })
    const path = join(root, 'master.wav')
    writeFileSync(path, 'local audio fixture')
    const id = vault
      ? importArtistVaultAssets(root, 'fixture', [path], { kindHint: 'master-final' }).imported[0]!.id
      : importMissionAssets(root, 'fixture', [path], { kindHint: 'master' }).imported[0]!.id
    const handlers = new Map<string, (...args: any[]) => Promise<any>>()
    const server = { handle: (channel: string, handler: (...args: any[]) => Promise<any>) => handlers.set(channel, handler) }
    ;(vault ? registerArtistVaultHandlers : registerMissionAssetsHandlers)(server as never, {} as never)
    const transcribe = handlers.get(vault ? RPC_CHANNELS.artistVault.TRANSCRIBE_TRACK : RPC_CHANNELS.missionAssets.TRANSCRIBE_LYRICS)!
    const options = vault ? { assetId: id } : { audioAssetId: id }
    const [first, second] = await Promise.all([transcribe({}, 'fixture', options), transcribe({}, 'fixture', options)])
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    expect(transcriber).toHaveBeenCalledTimes(1)
    const asset = vault ? second.asset : second.manifest.files.find((a: any) => a.id === id)
    const draft = asset.trackIntelligence.draft
    expect(draft).toBeDefined()
    const approve = handlers.get(vault ? RPC_CHANNELS.artistVault.REVIEW_TRACK : RPC_CHANNELS.missionAssets.SAVE_LYRICS)!
    await approve({ clientId: 'artist' }, 'fixture', vault
      ? { assetId: id, draftId: draft.id, lyrics: draft.lyrics }
      : { sourceAudioAssetId: id, draftId: draft.id, assetId: second.lyricsAsset.id, lyricsText: 'Artist corrected lyric' })
    const third = await transcribe({}, 'fixture', options)
    expect(third.ok).toBe(false)
    expect(third.error).toMatch(/approved|reviewed/i)
    expect(transcriber).toHaveBeenCalledTimes(1)
  })
}
