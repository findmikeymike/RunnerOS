import * as React from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import type { VaultAssetRecord } from '@craft-agent/shared/artist-vault'
import type { ReleaseKitItem } from '@craft-agent/shared/release-kit'
import type { MissionAssetManifest, MissionAssetRecord } from '@craft-agent/shared/mission-assets'
import { TrackIntelligenceReviewDialog, type TrackIntelligenceReviewValue } from './TrackIntelligenceReviewDialog'

/** Shares the campaign Vault's transcription and artist approval, without approving machine lyrics. */
export function ReleaseKitAudioLyrics({ workspaceId, item, autoAnalyze = false }: {
  workspaceId: string
  item: ReleaseKitItem
  autoAnalyze?: boolean
}) {
  const [manifest, setManifest] = React.useState<MissionAssetManifest | null>(null)
  const [vaultAudio, setVaultAudio] = React.useState<VaultAssetRecord | null>(null)
  const [audioId, setAudioId] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [open, setOpen] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const inFlight = React.useRef(false)
  const autoStarted = React.useRef(false)
  const audio = manifest?.files.find(asset => asset.id === audioId)

  const review = React.useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError(null)
    try {
      if (item.source.type === 'vault-asset') {
        const source = item.source
        const vault = await window.electronAPI.getArtistVaultManifest(source.vaultWorkspaceId)
        let track = vault.assets.find(asset => asset.id === source.assetId && asset.sha256 === item.sha256)
        if (!track) throw new Error('The original Vault audio has changed or is unavailable. Review this final from its saved audio separately.')
        if (!track.trackIntelligence?.draft && !track.trackIntelligence?.approved) {
          const result = await window.electronAPI.transcribeArtistVaultTrack(source.vaultWorkspaceId, { assetId: track.id })
          if (!result.ok || !result.asset) throw new Error(result.error ?? 'Lyrics transcription failed.')
          track = result.asset
        }
        setVaultAudio(track)
        setOpen(true)
        return
      }
      let current = await window.electronAPI.getMissionAssetManifest(workspaceId)
      const source = item.source
      let track: MissionAssetRecord | undefined = current.files.find(asset =>
        asset.status === 'available' && asset.usableByAgents && ['master', 'demo'].includes(asset.kind)
        && asset.sha256 === item.sha256 && (source.type !== 'campaign-asset' || asset.id === source.assetId))
      if (!track) {
        // Older direct uploads gain a campaign review record only when the artist requests it.
        const detail = await window.electronAPI.getReleaseKitItem(workspaceId, item.id)
        const result = await window.electronAPI.importMissionAssets(workspaceId, [detail.absolutePath], { kindHint: 'master' })
        current = result.manifest
        track = result.imported[0]
        if (!track) throw new Error(result.skipped[0]?.reason ?? 'Unable to prepare audio for lyric review.')
      }
      setAudioId(track.id)
      setManifest(current)
      if (!track.trackIntelligence?.draft && !track.trackIntelligence?.approved) {
        const result = await window.electronAPI.transcribeMissionAssetLyrics(workspaceId, { audioAssetId: track.id })
        setManifest(result.manifest)
        if (!result.ok) throw new Error([result.error ?? 'Lyrics transcription failed.', ...(result.blockers?.map(b => b.message) ?? [])].join(' '))
      }
      setOpen(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }, [item, workspaceId])

  React.useEffect(() => {
    if (!autoAnalyze || autoStarted.current) return
    autoStarted.current = true
    void review()
  }, [autoAnalyze, review])

  const save = async (value: TrackIntelligenceReviewValue) => {
    if (!audio && !vaultAudio) return
    setBusy(true)
    try {
      if (item.source.type === 'vault-asset' && vaultAudio) {
        const saved = await window.electronAPI.reviewArtistVaultTrack(item.source.vaultWorkspaceId, {
          assetId: vaultAudio.id, draftId: value.revisionId, lyrics: value.lyrics, character: value.character,
        })
        setVaultAudio(saved.assets.find(asset => asset.id === vaultAudio.id) ?? null)
        setOpen(false)
        toast.success('Lyrics approved for agents')
        return
      }
      if (!audio) return
      const lyrics = manifest?.files.find(asset => asset.kind === 'lyrics' && asset.lyrics?.sourceAudioAssetId === audio.id
        && (audio.trackIntelligence?.draft ? asset.lyrics.reviewRequired : !asset.lyrics.reviewRequired))
      const result = await window.electronAPI.saveMissionAssetLyrics(workspaceId, {
        lyricsText: value.lyrics.lines.map(line => line.text).filter(Boolean).join('\n'),
        draftId: value.revisionId,
        sourceAudioAssetId: audio.id,
        assetId: lyrics?.id,
        lyricLines: value.lyrics.timingStatus === 'ready' ? value.lyrics.lines.flatMap(line =>
          line.startMs !== undefined && line.endMs !== undefined ? [{ text: line.text, start_time: line.startMs / 1000, end_time: line.endMs / 1000, section: line.section }] : []) : undefined,
        lyricSections: value.lyrics.lines.flatMap((line, lineIndex) => line.section ? [{ lineIndex, section: line.section }] : []),
        language: value.lyrics.language,
        timingSource: value.lyrics.timingSource,
        artistSuppliedText: value.lyrics.artistSuppliedText,
        character: value.character,
      })
      setManifest(result.manifest)
      setOpen(false)
      toast.success('Lyrics approved for campaign agents')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally { setBusy(false) }
  }

  return <section className="space-y-2">
    <button type="button" disabled={busy} onClick={() => void review()} className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/15 bg-[#181818] px-3 text-sm text-white/90 transition-colors hover:bg-[#252525] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 disabled:opacity-50">
      {busy && <Loader2 className="h-4 w-4 animate-spin" />}
      {busy ? 'Preparing lyrics…' : (vaultAudio ?? audio)?.trackIntelligence?.approved ? 'View approved lyrics' : 'Review lyrics'}
    </button>
    <p className="text-xs text-muted-foreground">Lyrics stay a draft until you approve them.</p>
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    <TrackIntelligenceReviewDialog open={open} title={item.title} intelligence={(vaultAudio ?? audio)?.trackIntelligence} busy={busy} onClose={() => setOpen(false)} onSave={save} />
  </section>
}
