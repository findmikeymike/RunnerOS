import * as React from 'react'
import {
  CheckCircle2,
  FileArchive,
  FileText,
  FolderOpen,
  FolderPlus,
  Image,
  Layers,
  Loader2,
  Lock,
  Music2,
  Plus,
  RefreshCw,
  Search,
  Scissors,
  ShieldCheck,
  Tags,
  Trash2,
  Upload,
  Video,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { CompactPageHeader } from './CompactPageHeader'
import { TrackIntelligenceReviewDialog, type TrackIntelligenceReviewValue } from './TrackIntelligenceReviewDialog'
import { useWorkspaceSyncRefresh } from '@/hooks/useWorkspaceSyncRefresh'
import type {
  VaultAssetKind,
  VaultAssetRecord,
  VaultAssetUpdatePatch,
  VaultCategory,
  VaultKindHint,
  VaultManifest,
  TrackIntelligence,
} from '@craft-agent/shared/artist-vault'
import { vaultRepurposeRestriction } from '@/lib/release-kit-repurpose'
import { SocialVariantSetupDrawer, type SocialVariantSetupSource } from '@/components/social-variants/SocialVariantSetupDrawer'

interface VaultPageProps {
  workspaceId: string
  workspaceName?: string
}

type AssetPurpose = 'final' | 'seed'
type ImportDraft = {
  open: boolean
  kindHint: VaultKindHint
  paths: string[]
  plan: Awaited<ReturnType<typeof window.electronAPI.planArtistVaultImports>> | null
  details: Array<{ sourcePath: string; label: string; notes: string }>
}

const CATEGORIES: Array<{
  id: VaultCategory
  label: string
  icon: React.ElementType
  hint: VaultKindHint
}> = [
  { id: 'music', label: 'Music', icon: Music2, hint: 'master-final' },
  { id: 'video', label: 'Video', icon: Video, hint: 'raw-footage' },
  { id: 'visuals', label: 'Visuals', icon: Image, hint: 'cover-art' },
  { id: 'campaigns', label: 'Campaigns', icon: FileArchive, hint: 'ad-asset' },
  { id: 'business', label: 'Business', icon: Lock, hint: 'contract' },
  { id: 'references', label: 'References', icon: Layers, hint: 'any' },
]

const CATEGORY_KIND_LABELS: Record<VaultCategory, Array<{ kind: VaultAssetKind; label: string }>> = {
  music: [
    { kind: 'master-final', label: 'Masters' },
    { kind: 'demo', label: 'Demos' },
    { kind: 'stem', label: 'Stems' },
    { kind: 'beat-instrumental', label: 'Beats' },
    { kind: 'mix-reference', label: 'Refs' },
    { kind: 'lyrics-note', label: 'Lyrics' },
  ],
  video: [
    { kind: 'final-video', label: 'Finals' },
    { kind: 'raw-footage', label: 'Raw' },
    { kind: 'content-clip', label: 'Clips' },
    { kind: 'b-roll', label: 'B-roll' },
    { kind: 'live-performance', label: 'Live' },
    { kind: 'video-project', label: 'Projects' },
  ],
  visuals: [
    { kind: 'cover-art', label: 'Cover Art' },
    { kind: 'artist-photo', label: 'Photos' },
    { kind: 'face-reference', label: 'Face Refs' },
    { kind: 'logo-mark', label: 'Logos' },
    { kind: 'brand-asset', label: 'Brand' },
    { kind: 'poster-flyer', label: 'Posters' },
    { kind: 'merch-design', label: 'Merch' },
  ],
  campaigns: [
    { kind: 'release-asset', label: 'Release' },
    { kind: 'ad-asset', label: 'Ads' },
    { kind: 'press-asset', label: 'Press' },
    { kind: 'social-pack', label: 'Social' },
  ],
  business: [
    { kind: 'contract', label: 'Contracts' },
    { kind: 'split-sheet', label: 'Splits' },
    { kind: 'invoice', label: 'Invoices' },
    { kind: 'one-sheet', label: 'One-sheets' },
    { kind: 'epk', label: 'EPK' },
  ],
  references: [
    { kind: 'moodboard', label: 'Moodboards' },
    { kind: 'inspiration', label: 'Inspiration' },
    { kind: 'similar-artist-reference', label: 'Similar Artists' },
    { kind: 'swipe-file', label: 'Swipe Files' },
    { kind: 'other', label: 'Other' },
  ],
}

const emptyImportDraft: ImportDraft = { open: false, kindHint: 'any', paths: [], plan: null, details: [] }
const INPUT_CLASS = 'h-9 w-full rounded-[10px] border border-white/[0.06] bg-[#0b0b0b] px-3 text-sm text-white/76 outline-none placeholder:text-white/26 focus:border-[#f97316]/35'
const QUICK_TAGS: Record<VaultCategory, string[]> = {
  music: ['master', 'demo', 'stem', 'clean-version', 'lyrics', 'mix-ref'],
  video: ['final-video', 'raw-footage', 'clip', 'b-roll', 'vertical', 'captioned'],
  visuals: ['cover-art', 'press-shot', 'face-ref', 'logo', 'moodboard', 'reference'],
  campaigns: ['social-pack', 'ad-asset', 'press', 'release', 'approved'],
  business: ['contract', 'split-sheet', 'invoice', 'private', 'approved'],
  references: ['inspiration', 'swipe-file', 'similar-artist', 'moodboard', 'reference'],
}

export function VaultPage({ workspaceId, workspaceName }: VaultPageProps) {
  const [deleteTarget, setDeleteTarget] = React.useState<VaultAssetRecord | null>(null)
  const deleting = React.useRef(false)
  const [manifest, setManifest] = React.useState<VaultManifest | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [busy, setBusy] = React.useState<string | null>(null)
  const [analyzingTrackId, setAnalyzingTrackId] = React.useState<string | null>(null)
  const analysisInFlight = React.useRef(false)
  const [selectedCategory, setSelectedCategory] = React.useState<VaultCategory>('music')
  const [pastReleases, setPastReleases] = React.useState(false)
  const [pastReleaseId, setPastReleaseId] = React.useState('all')
  const [selectedKind, setSelectedKind] = React.useState<VaultAssetKind | 'all'>('all')
  const [selectedAssetId, setSelectedAssetId] = React.useState<string | null>(null)
  const [query, setQuery] = React.useState('')
  const [importDraft, setImportDraft] = React.useState<ImportDraft>(emptyImportDraft)
  const [dragActive, setDragActive] = React.useState(false)
  const [trackReviewAssetId, setTrackReviewAssetId] = React.useState<string | null>(null)
  const [variantSetupSourceId, setVariantSetupSourceId] = React.useState<string | null>(null)

  const refresh = React.useCallback(async (foreground = true) => {
    if (!workspaceId) return
    if (foreground) setLoading(true)
    try {
      const next = await window.electronAPI.getArtistVaultManifest(workspaceId)
      setManifest(next)
      setSelectedAssetId((current) => current && next.assets.some((asset) => asset.id === current && asset.status !== 'archived') ? current : next.assets.find((asset) => asset.status !== 'archived')?.id ?? null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      if (foreground) setLoading(false)
    }
  }, [workspaceId])

  React.useEffect(() => {
    void refresh()
  }, [refresh])
  useWorkspaceSyncRefresh(workspaceId, ['vault', 'context'], () => refresh(false))

  const assets = React.useMemo(() => manifest?.assets.filter((asset) => asset.status !== 'archived') ?? [], [manifest])
  const selectedAsset = React.useMemo(
    () => assets.find((asset) => asset.id === selectedAssetId) ?? null,
    [assets, selectedAssetId],
  )
  const categoryAssets = React.useMemo(
    () => assets.filter((asset) => pastReleases
      ? asset.tags?.includes('past-release') && (pastReleaseId === 'all' || asset.campaigns?.includes(pastReleaseId))
      : asset.category === selectedCategory),
    [assets, selectedCategory, pastReleases, pastReleaseId],
  )
  const pastReleaseOptions = React.useMemo(() => {
    const releases = new Map<string, string>()
    for (const asset of assets) {
      if (!asset.tags?.includes('past-release')) continue
      const name = asset.tags.find(tag => tag.startsWith('release:'))?.slice(8)
      for (const id of asset.campaigns ?? []) releases.set(id, name || id)
    }
    return [...releases].sort((a, b) => a[1].localeCompare(b[1]))
  }, [assets])
  const filteredAssets = React.useMemo(() => {
    const needle = query.trim().toLowerCase()
    return categoryAssets.filter((asset) => {
      if (selectedKind !== 'all' && asset.kind !== selectedKind) return false
      if (!needle) return true
      const haystack = [
        asset.label,
        asset.kind,
        asset.relativePath,
        asset.absolutePath,
        asset.notes,
        ...(asset.tags ?? []),
        ...(asset.campaigns ?? []),
        ...(asset.genre ?? []),
        ...(asset.moods ?? []),
        ...(asset.similarSongs ?? []),
        asset.bpm?.toString(),
      ].join(' ').toLowerCase()
      return haystack.includes(needle)
    })
  }, [categoryAssets, query, selectedKind])
  const trackReviewAsset = React.useMemo(
    () => assets.find((asset) => asset.id === trackReviewAssetId) ?? null,
    [assets, trackReviewAssetId],
  )
  const variantSources = React.useMemo<SocialVariantSetupSource[]>(() => assets
    .filter((asset) => asset.category === 'video')
    .map((asset) => ({
      id: asset.id,
      title: asset.label,
      detail: formatKind(asset.kind),
      selection: { origin: 'vault' as const, sourceId: asset.id },
      absolutePath: asset.absolutePath,
      sha256: asset.sha256,
      restriction: vaultRepurposeRestriction(asset),
    })), [assets])
  const selectKind = React.useCallback((kind: VaultAssetKind | 'all') => {
    setSelectedKind(kind)
    setSelectedAssetId(categoryAssets.find((asset) => kind === 'all' || asset.kind === kind)?.id ?? null)
  }, [categoryAssets])

  const planImportPaths = React.useCallback(async (paths: string[], kindHint: VaultKindHint) => {
    if (!workspaceId) return
    if (!paths.length) return
    const plan = await window.electronAPI.planArtistVaultImports(workspaceId, paths, { kindHint })
    setImportDraft({
      open: true,
      kindHint,
      paths,
      plan,
      details: plan.candidates.map((candidate) => ({
        sourcePath: candidate.sourcePath,
        label: displayFileName(candidate.fileName),
        notes: '',
      })),
    })
  }, [workspaceId])

  const startImport = React.useCallback(async (kindHint: VaultKindHint) => {
    if (!workspaceId) return
    setBusy(`choose:${kindHint}`)
    try {
      const paths = await window.electronAPI.chooseArtistVaultAssetFiles(workspaceId, kindHint)
      await planImportPaths(paths, kindHint)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(null)
    }
  }, [planImportPaths, workspaceId])

  const handleDrop = React.useCallback(async (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setDragActive(false)
    const paths = Array.from(event.dataTransfer.files)
      .map((file) => (file as File & { path?: string }).path)
      .filter((path): path is string => Boolean(path))
    if (!paths.length) {
      toast.error('Drop files from your computer to add them to Vault.')
      return
    }
    setBusy('drop')
    try {
      await planImportPaths(paths, addHintForSelection(selectedCategory, selectedKind))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(null)
    }
  }, [planImportPaths, selectedCategory, selectedKind])

  const analyzeTrack = React.useCallback(async (asset: VaultAssetRecord, force = false, openReview = true): Promise<boolean> => {
    if (!workspaceId || analysisInFlight.current) return false
    analysisInFlight.current = true
    setAnalyzingTrackId(asset.id)
    setBusy(`track:${asset.id}`)
    try {
      const result = await window.electronAPI.transcribeArtistVaultTrack(workspaceId, { assetId: asset.id, force })
      setManifest(result.manifest)
      if (!result.ok || !result.asset?.trackIntelligence?.draft) {
        toast.error(result.error ?? 'Track transcription failed', {
          description: result.blockers?.map((blocker) => blocker.message).join(' '),
        })
        return false
      }
      if (openReview) {
        setTrackReviewAssetId(asset.id)
        toast.success('Lyrics are ready to review')
      }
      return true
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
      return false
    } finally {
      analysisInFlight.current = false
      setAnalyzingTrackId(null)
      setBusy(null)
    }
  }, [workspaceId])

  const confirmImport = React.useCallback(async () => {
    if (!workspaceId || !importDraft.paths.length) return
    setBusy('import')
    try {
      const result = await window.electronAPI.importArtistVaultAssets(workspaceId, importDraft.paths, {
        kindHint: importDraft.kindHint,
        details: importDraft.details,
      })
      setManifest(result.manifest)
      const firstImported = result.imported[0]
      setSelectedAssetId(firstImported?.id ?? selectedAssetId)
      setImportDraft(emptyImportDraft)
      toast.success(`Added ${result.imported.length} Vault asset${result.imported.length === 1 ? '' : 's'}`)
      const tracks = result.imported.filter((asset) => asset.kind === 'master-final' || asset.kind === 'demo')
      let firstReadyTrackId: string | null = null
      for (const track of tracks) {
        if (await analyzeTrack(track, false, false) && !firstReadyTrackId) firstReadyTrackId = track.id
      }
      if (firstReadyTrackId) {
        setTrackReviewAssetId(firstReadyTrackId)
        toast.success(tracks.length === 1 ? 'Lyrics are ready to review' : `${tracks.length} track drafts are ready to review`)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(null)
    }
  }, [analyzeTrack, importDraft, selectedAssetId, workspaceId])

  const linkFolder = React.useCallback(async () => {
    if (!workspaceId) return
    setBusy('link-folder')
    try {
      const folder = await window.electronAPI.openFolderDialog()
      if (!folder) return
      const result = await window.electronAPI.linkArtistVaultFolder(workspaceId, folder)
      setManifest(result.manifest)
      setSelectedAssetId(result.linked[0]?.id ?? selectedAssetId)
      toast.success(result.linked.length ? `Linked ${result.linked.length} asset${result.linked.length === 1 ? '' : 's'}` : 'No new files found')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(null)
    }
  }, [selectedAssetId, workspaceId])

  const scanFolder = React.useCallback(async () => {
    if (!workspaceId) return
    setBusy('scan')
    try {
      const result = await window.electronAPI.scanArtistVault(workspaceId)
      setManifest(result.manifest)
      setSelectedAssetId(result.added[0]?.id ?? selectedAssetId)
      toast.success(result.added.length ? `Indexed ${result.added.length} file${result.added.length === 1 ? '' : 's'}` : 'Vault is already indexed')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(null)
    }
  }, [selectedAssetId, workspaceId])

  const openFolder = React.useCallback(async () => {
    if (!workspaceId) return
    const opened = await window.electronAPI.openArtistVaultFolder(workspaceId)
    if (!opened) toast.error('Could not open Artist Vault folder')
  }, [workspaceId])

  const confirmDelete = async () => {
    if (!deleteTarget || deleting.current || busy !== null || analysisInFlight.current) return
    deleting.current = true
    setBusy('delete')
    try {
      const next = await window.electronAPI.deleteArtistVaultAsset(workspaceId, deleteTarget.id)
      setManifest(next)
      setSelectedAssetId((current) => current === deleteTarget.id ? null : current)
      setTrackReviewAssetId((current) => current === deleteTarget.id ? null : current)
      setDeleteTarget(null)
      toast.success('Removed from Vault')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      deleting.current = false
      setBusy(null)
    }
  }

  const updateAsset = React.useCallback(async (assetId: string, patch: VaultAssetUpdatePatch) => {
    if (!workspaceId) return
    setBusy(`asset:${assetId}`)
    try {
      const next = await window.electronAPI.updateArtistVaultAsset(workspaceId, assetId, {
        kind: patch.kind,
        label: patch.label,
        status: patch.status,
        rightsStatus: patch.rightsStatus,
        usableByAgents: patch.usableByAgents,
        campaigns: patch.campaigns,
        tags: patch.tags,
        genre: patch.genre,
        moods: patch.moods,
        bpm: patch.bpm,
        similarSongs: patch.similarSongs,
        notes: patch.notes,
      })
      setManifest(next)
      toast.success('Vault asset updated')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(null)
    }
  }, [workspaceId])

  const saveTrackReview = React.useCallback(async (value: TrackIntelligenceReviewValue) => {
    if (!workspaceId || !trackReviewAsset) return
    setBusy(`track:${trackReviewAsset.id}`)
    try {
      const next = await window.electronAPI.reviewArtistVaultTrack(workspaceId, {
        assetId: trackReviewAsset.id,
        draftId: value.revisionId,
        lyrics: value.lyrics,
        character: value.character,
      })
      setManifest(next)
      setTrackReviewAssetId(null)
      toast.success('Track package approved for agents')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(null)
    }
  }, [trackReviewAsset, workspaceId])

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-[#050505] text-sm text-white/45">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading Vault
      </div>
    )
  }

  return (
    <div className="h-full overflow-hidden bg-[#050505] text-white">
      <div className="flex h-full flex-col px-5 py-4 xl:px-7">
        <CompactPageHeader
          eyebrow={workspaceName || 'Artist Library'}
          title="Vault"
          tone="orange"
          className="mb-4 shrink-0"
          actions={
            <>
              {!pastReleases ? <ToolbarButton disabled={busy !== null} onClick={() => void startImport('any')} icon={Upload} label="Import" active={busy === 'choose:any'} /> : null}
              {!pastReleases ? <ToolbarButton disabled={busy !== null} onClick={() => void linkFolder()} icon={FolderPlus} label="Link Folder" active={busy === 'link-folder'} /> : null}
              <ToolbarButton disabled={busy !== null} onClick={() => void scanFolder()} icon={RefreshCw} label="Scan" active={busy === 'scan'} />
              <ToolbarButton onClick={openFolder} icon={FolderOpen} label="Open Folder" />
            </>
          }
        />

        <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
          <main
            onDragEnter={(event) => {
              event.preventDefault()
              setDragActive(true)
            }}
            onDragOver={(event) => {
              event.preventDefault()
              setDragActive(true)
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragActive(false)
            }}
            onDrop={(event) => void handleDrop(event)}
            className={cn(
              'relative min-h-0 overflow-hidden rounded-[18px] border bg-[#080808] transition-colors',
              dragActive ? 'border-[#f97316]/55 bg-[#140a04] shadow-tinted' : 'border-white/[0.055]',
            )}
          >
            {dragActive && (
              <div className="pointer-events-none absolute inset-3 z-10 flex items-center justify-center rounded-[14px] border border-[#f97316]/35 bg-black/70">
                <div className="text-center">
                  <Upload className="mx-auto mb-3 h-7 w-7 text-[#fb923c]" />
                  <div className="text-sm font-semibold text-white/86">Drop files into Vault</div>
                  <div className="mt-1 text-xs text-white/42">They will be staged before import.</div>
                </div>
              </div>
            )}
            <div className="border-b border-white/[0.055] bg-white/[0.012] p-4">
              <div className="mb-4 flex gap-2 overflow-x-auto pb-0.5">
                {CATEGORIES.map((category) => {
                  const Icon = category.icon
                  const active = !pastReleases && selectedCategory === category.id
                  return (
                    <button
                      key={category.id}
                      type="button"
                      onClick={() => {
                        setSelectedCategory(category.id)
                        setPastReleases(false)
                        setSelectedKind('all')
                        setSelectedAssetId(assets.find((asset) => asset.category === category.id)?.id ?? null)
                      }}
                      className={cn(
                        'inline-flex h-9 shrink-0 items-center gap-2 rounded-[10px] border px-3 text-xs font-medium transition-colors',
                        active ? 'border-[#f97316]/45 bg-[#2a1206]/80 text-white shadow-tinted' : 'border-transparent bg-transparent text-white/48 hover:bg-white/[0.035] hover:text-white/82',
                      )}
                    >
                      <Icon className={cn('h-3.5 w-3.5', active ? 'text-[#fb923c]' : 'text-white/42')} />
                      {category.label}
                    </button>
                  )
                })}
                <button type="button" onClick={() => {
                  setPastReleases(true)
                  setSelectedKind('all')
                  setSelectedAssetId(null)
                }} className={cn('inline-flex h-9 shrink-0 items-center gap-2 rounded-[10px] border px-3 text-xs font-medium transition-colors',
                  pastReleases ? 'border-[#f97316]/45 bg-[#2a1206]/80 text-white' : 'border-transparent text-white/48 hover:text-white/82')}>
                  <FileArchive className="h-3.5 w-3.5" />Past Releases
                </button>
              </div>
              <div className="flex justify-end">
                <label className="flex h-8 w-[220px] items-center gap-2 rounded-full border border-white/[0.025] bg-black/12 px-3">
                  <Search className="h-3.5 w-3.5 text-white/26" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search"
                    className="min-w-0 flex-1 bg-transparent text-xs text-white/66 outline-none placeholder:text-white/24"
                  />
                </label>
              </div>

              {pastReleases ? (
                <div className="mt-3 flex items-center gap-3">
                  <label htmlFor="past-release-filter" className="text-xs text-white/50">Release</label>
                  <select id="past-release-filter" className={cn(INPUT_CLASS, 'max-w-xs')} value={pastReleaseId} onChange={event => {
                    setPastReleaseId(event.target.value)
                    setSelectedAssetId(null)
                  }}>
                    <option value="all">All past releases</option>
                    {pastReleaseOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                  </select>
                </div>
              ) : <div className="mt-3 flex items-center gap-2 overflow-x-auto pb-0.5">
                <span className="shrink-0 text-[10px] font-medium uppercase tracking-[0.16em] text-white/28">Import as</span>
                <KindChip active={selectedKind === 'all'} label="All" onClick={() => selectKind('all')} />
                {CATEGORY_KIND_LABELS[selectedCategory].map((item) => (
                  <KindChip
                    key={item.kind}
                    active={selectedKind === item.kind}
                    label={item.label}
                    onClick={() => selectKind(item.kind)}
                  />
                ))}
              </div>}
            </div>

            <div className="h-full min-h-0 overflow-y-auto bg-[#060606] p-4 pb-28">
              {!pastReleases ? <div className="mb-3 flex justify-end">
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void startImport(addHintForSelection(selectedCategory, selectedKind))}
                  className="inline-flex h-8 items-center gap-1.5 rounded-full border border-white/[0.06] bg-white/[0.035] px-3 text-xs font-medium text-white/68 hover:bg-white/[0.06] hover:text-white disabled:cursor-wait disabled:opacity-50"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add
                </button>
              </div> : null}
              {filteredAssets.length === 0 ? (
                pastReleases ? <p className="py-12 text-center text-sm text-white/45">Files kept when you delete a campaign appear here.</p> : <EmptyState kind={selectedKind} />
              ) : (
                <div className="overflow-hidden rounded-[12px] border border-white/[0.055]">
                  {filteredAssets.map((asset) => (
                    <AssetRow key={asset.id} asset={asset} selected={asset.id === selectedAssetId} onSelect={() => setSelectedAssetId(asset.id)} />
                  ))}
                </div>
              )}
            </div>
          </main>

          <AssetDetailPanel
            workspaceId={workspaceId}
            asset={selectedAsset}
            busy={busy === `asset:${selectedAsset?.id}`}
            onUpdate={updateAsset}
            onDelete={(asset) => { if (busy === null) setDeleteTarget(asset) }}
            deleteDisabled={busy !== null}
            onAnalyze={analyzeTrack}
            analyzingTrackId={analyzingTrackId}
            onReviewTrack={(assetId) => setTrackReviewAssetId(assetId)}
            onCreateVariants={(assetId) => setVariantSetupSourceId(assetId)}
          />
        </div>
      </div>

      <Dialog open={Boolean(deleteTarget)} onOpenChange={(open) => { if (!open && !deleting.current) setDeleteTarget(null) }}>
        <DialogContent>
          <DialogTitle>Delete from Vault?</DialogTitle>
          <DialogDescription>
            {deleteTarget?.relativePath
              ? `Permanently delete the Vault copy of “${deleteTarget.label}”? Your original import file and existing copies elsewhere are unaffected.`
              : `Remove “${deleteTarget?.label}” from Vault? The linked original file will stay where it is.`}
          </DialogDescription>
          <div className="flex justify-end gap-2">
            <button type="button" disabled={busy === 'delete'} onClick={() => setDeleteTarget(null)} className="rounded-lg px-4 py-2 text-sm">Cancel</button>
            <button type="button" disabled={busy !== null} onClick={() => void confirmDelete()} className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm text-white disabled:opacity-50">
              {busy === 'delete' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              {busy === 'delete' ? 'Deleting…' : 'Delete from Vault'}
            </button>
          </div>
        </DialogContent>
      </Dialog>
      <ImportModal
        draft={importDraft}
        busy={busy === 'import'}
        onClose={() => setImportDraft(emptyImportDraft)}
        onChangeDetail={(sourcePath, patch) => setImportDraft((current) => ({
          ...current,
          details: current.details.map((detail) => detail.sourcePath === sourcePath ? { ...detail, ...patch } : detail),
        }))}
        onConfirm={confirmImport}
      />
      <TrackIntelligenceReviewDialog
        open={Boolean(trackReviewAsset)}
        title={trackReviewAsset?.label ?? 'Track'}
        intelligence={trackReviewAsset?.trackIntelligence}
        busy={busy === `track:${trackReviewAsset?.id}`}
        onClose={() => setTrackReviewAssetId(null)}
        onSave={saveTrackReview}
      />
      <SocialVariantSetupDrawer
        open={Boolean(variantSetupSourceId)}
        workspaceId={workspaceId}
        sources={variantSources}
        initialSourceId={variantSetupSourceId ?? undefined}
        onOpenChange={(open) => { if (!open) setVariantSetupSourceId(null) }}
      />
    </div>
  )
}

function AssetDetailPanel({
  workspaceId,
  asset,
  busy,
  onUpdate,
  onDelete,
  deleteDisabled,
  onAnalyze,
  analyzingTrackId,
  onReviewTrack,
  onCreateVariants,
}: {
  workspaceId: string
  asset: VaultAssetRecord | null
  busy: boolean
  onDelete: (asset: VaultAssetRecord) => void
  deleteDisabled: boolean
  onUpdate: (assetId: string, patch: VaultAssetUpdatePatch) => Promise<void>
  onAnalyze: (asset: VaultAssetRecord, force?: boolean) => Promise<boolean>
  analyzingTrackId: string | null
  onReviewTrack: (assetId: string) => void
  onCreateVariants: (assetId: string) => void
}) {
  const [label, setLabel] = React.useState('')
  const [kind, setKind] = React.useState<VaultAssetKind>('other')
  const [purpose, setPurpose] = React.useState<AssetPurpose>('seed')
  const [internalOnly, setInternalOnly] = React.useState(false)
  const [campaigns, setCampaigns] = React.useState('')
  const [tags, setTags] = React.useState('')
  const [genre, setGenre] = React.useState('')
  const [moods, setMoods] = React.useState('')
  const [bpm, setBpm] = React.useState('')
  const [similarSongs, setSimilarSongs] = React.useState('')
  const [notes, setNotes] = React.useState('')

  React.useEffect(() => {
    if (!asset) return
    setLabel(asset.label)
    setKind(asset.kind)
    setPurpose(asset.status === 'final' || asset.status === 'approved' ? 'final' : 'seed')
    setInternalOnly(asset.rightsStatus === 'private')
    setCampaigns((asset.campaigns ?? []).join(', '))
    setTags((asset.tags ?? []).join(', '))
    setGenre((asset.genre ?? []).join(', '))
    setMoods((asset.moods ?? []).join(', '))
    setBpm(asset.bpm ? String(asset.bpm) : '')
    setSimilarSongs((asset.similarSongs ?? []).join(', '))
    setNotes(asset.notes ?? '')
  }, [asset])

  if (!asset) {
    return (
      <aside className="hidden min-h-0 rounded-[18px] border border-white/[0.055] bg-[#080808] p-4 xl:flex xl:flex-col">
        <div className="border-b border-white/[0.055] pb-4">
          <div className="mb-2 inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.16em] text-[#fb923c]/64">
            <Tags className="h-3.5 w-3.5" />
            Inspector
          </div>
          <h2 className="text-xl font-semibold tracking-tight text-white/84">Quick tagger</h2>
          <p className="mt-1 text-sm leading-5 text-white/34">Select an asset to preview, tag, and set its use status.</p>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="max-w-[260px] text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-[18px] border border-white/[0.055] bg-white/[0.025]">
              <Upload className="h-6 w-6 text-white/24" />
            </div>
            <div className="text-sm font-semibold text-white/62">Drop files first</div>
            <div className="mt-1 text-xs leading-5 text-white/30">Then use quick tags like Master, Press Shot, Stem, or Social Pack.</div>
          </div>
        </div>
      </aside>
    )
  }

  const quickTags = QUICK_TAGS[asset.category] ?? QUICK_TAGS.references
  const selectedTags = splitList(tags)
  const save = () => onUpdate(asset.id, {
    kind,
    label,
    status: purpose === 'final' ? 'final' : 'review',
    rightsStatus: internalOnly ? 'private' : 'safe-to-use',
    usableByAgents: true,
    campaigns: splitList(campaigns),
    tags: splitList(tags),
    genre: splitList(genre),
    moods: splitList(moods),
    bpm: parseBpm(bpm),
    similarSongs: splitList(similarSongs),
    notes,
  })

  return (
    <aside className="min-h-0 overflow-y-auto rounded-[18px] border border-white/[0.055] bg-[#080808] p-4">
      <div className="mb-4 border-b border-white/[0.055] pb-4">
        <div className="mb-3 inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.16em] text-[#fb923c]/64">
          <Tags className="h-3.5 w-3.5" />
          Inspector
        </div>
        <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-[10px] bg-white/[0.045]">
            <AssetIcon asset={asset} className="h-5 w-5 text-white/54" />
          </div>
          <h3 className="truncate text-lg font-semibold text-white/88">{asset.label}</h3>
          <p className="mt-1 text-xs uppercase tracking-[0.12em] text-white/34">{formatKind(asset.kind)}</p>
        </div>
        <VisibilityBadge asset={asset} />
        </div>
      </div>

      <AssetPreview workspaceId={workspaceId} asset={asset} />

      {asset.category === 'video' ? (
        <button
          type="button"
          disabled={busy || Boolean(vaultRepurposeRestriction(asset))}
          title={vaultRepurposeRestriction(asset)}
          onClick={() => onCreateVariants(asset.id)}
          className="mb-4 inline-flex h-9 w-full items-center justify-center gap-2 rounded-[10px] bg-white/[0.035] text-xs font-medium text-white/66 ring-1 ring-white/[0.07] hover:bg-white/[0.06] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Scissors className="h-3.5 w-3.5" />
          Create variants
        </button>
      ) : null}

      <div className="space-y-3">
        <Field label="Name">
          <input value={label} onChange={(event) => setLabel(event.target.value)} className={INPUT_CLASS} />
        </Field>

        <Field label="Type">
          <select value={kind} onChange={(event) => setKind(event.target.value as VaultAssetKind)} className={INPUT_CLASS}>
            {CATEGORY_KIND_LABELS[asset.category].map((item) => (
              <option key={item.kind} value={item.kind}>{item.label}</option>
            ))}
          </select>
        </Field>

        <div className="rounded-[12px] border border-white/[0.055] bg-white/[0.018] p-3">
          <div className="mb-2 flex items-center gap-2">
            <Tags className="h-3.5 w-3.5 text-[#fb923c]" />
            <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-white/40">Quick Tags</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {quickTags.map((tag) => (
              <button
                key={tag}
                type="button"
                aria-pressed={selectedTags.includes(tag)}
                onClick={() => setTags((current) => toggleListValue(current, tag))}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-[11px] transition-colors',
                  selectedTags.includes(tag)
                    ? 'border-[#f97316]/40 bg-[#f97316]/12 text-[#fdba74]'
                    : 'border-white/[0.06] bg-white/[0.025] text-white/56 hover:border-[#f97316]/35 hover:text-white/86',
                )}
              >
                {selectedTags.includes(tag) ? <CheckCircle2 className="mr-1 inline h-3 w-3" /> : '+ '}
                {formatTag(tag)}
              </button>
            ))}
          </div>
          <div className="mt-3 border-t border-white/[0.055] pt-3">
            <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-white/32">Selected tags</div>
            {selectedTags.length ? (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {selectedTags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    aria-label={`Remove ${formatTag(tag)} tag`}
                    onClick={() => setTags((current) => removeListValue(current, tag))}
                    className="inline-flex items-center gap-1 rounded-full border border-[#f97316]/25 bg-[#f97316]/8 px-2 py-1 text-[11px] text-[#fdba74]/85 hover:bg-[#f97316]/14"
                  >
                    {formatTag(tag)}
                    <X className="h-3 w-3" />
                  </button>
                ))}
              </div>
            ) : <div className="mb-2 text-xs text-white/28">No tags yet</div>}
            <input
              aria-label="Add custom tags"
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              placeholder="Add custom tags, separated by commas"
              className={INPUT_CLASS}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setPurpose('final')}
            className={cn('rounded-[12px] border px-3 py-2 text-left transition-colors', purpose === 'final' ? 'border-[#f97316]/45 bg-[#2a1206]/55' : 'border-white/[0.06] bg-white/[0.025] hover:bg-white/[0.045]')}
          >
            <span className="block text-sm font-semibold text-white/82">Final / ready</span>
            <span className="mt-0.5 block text-xs text-white/38">Approved for external use.</span>
          </button>
          <button
            type="button"
            onClick={() => setPurpose('seed')}
            className={cn('rounded-[12px] border px-3 py-2 text-left transition-colors', purpose === 'seed' ? 'border-[#f97316]/45 bg-[#2a1206]/55' : 'border-white/[0.06] bg-white/[0.025] hover:bg-white/[0.045]')}
          >
            <span className="block text-sm font-semibold text-white/82">Working / reference</span>
            <span className="mt-0.5 block text-xs text-white/38">A draft, source, idea, or reference.</span>
          </button>
        </div>

        <label className="flex items-center justify-between gap-3 rounded-[12px] border border-white/[0.06] bg-white/[0.025] px-3 py-2">
          <span>
            <span className="block text-sm font-medium text-white/76">Internal only</span>
            <span className="block text-xs text-white/36">Agents can still work with it inside Artist OS. Never send, post, pitch, or publish it.</span>
          </span>
          <input type="checkbox" checked={internalOnly} onChange={(event) => setInternalOnly(event.target.checked)} className="h-4 w-4 accent-[#f97316]" />
        </label>

        {asset.category === 'music' && (
          <div className="rounded-[12px] border border-white/[0.055] bg-white/[0.018] p-3">
            <div className="mb-3 flex items-center justify-between gap-3">
              <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-white/36">Song Package</span>
              <TrackStatus intelligence={asset.trackIntelligence} />
            </div>
            {asset.kind === 'master-final' || asset.kind === 'demo' ? (
              <div className="mb-3 flex gap-2">
                {asset.trackIntelligence?.draft || asset.trackIntelligence?.approved ? (
                  <button type="button" disabled={analyzingTrackId !== null} onClick={() => onReviewTrack(asset.id)} className="h-8 flex-1 rounded-[8px] bg-white/[0.07] px-3 text-xs text-white/70 hover:bg-white/[0.1] hover:text-white">Review lyrics</button>
                ) : null}
                <button type="button" disabled={busy || analyzingTrackId !== null} aria-busy={analyzingTrackId === asset.id} onClick={() => void onAnalyze(asset, Boolean(asset.trackIntelligence?.approved))} className="inline-flex h-8 flex-1 items-center justify-center gap-2 rounded-[8px] bg-[#f97316]/15 px-3 text-xs text-[#fb923c] hover:bg-[#f97316]/22 disabled:cursor-wait disabled:opacity-60">
                  {analyzingTrackId === asset.id ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Analyzing lyrics…</> : asset.trackIntelligence ? 'Re-analyze' : 'Analyze track'}
                </button>
              </div>
            ) : null}
            <div className="grid gap-3">
              <Field label="Genre">
                <input value={genre} onChange={(event) => setGenre(event.target.value)} placeholder="alt-pop, indie rock, r&b" className={INPUT_CLASS} />
              </Field>
              <Field label="Mood">
                <input value={moods} onChange={(event) => setMoods(event.target.value)} placeholder="sad, cinematic, midtempo" className={INPUT_CLASS} />
              </Field>
              <Field label="BPM">
                <input value={bpm} onChange={(event) => setBpm(event.target.value)} inputMode="numeric" placeholder="92" className={INPUT_CLASS} />
              </Field>
              <Field label="Similar Songs">
                <input value={similarSongs} onChange={(event) => setSimilarSongs(event.target.value)} placeholder="artist - song, artist - song" className={INPUT_CLASS} />
              </Field>
            </div>
          </div>
        )}

        <Field label="Campaigns">
          <input value={campaigns} onChange={(event) => setCampaigns(event.target.value)} placeholder="release-one, tour-content" className={INPUT_CLASS} />
        </Field>

        <Field label="Notes">
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={4} className={cn(INPUT_CLASS, 'h-auto resize-none py-2')} />
        </Field>

        <button
          type="button"
          disabled={busy}
          onClick={() => void save()}
          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-[10px] bg-white/90 text-sm font-semibold text-black hover:bg-white disabled:cursor-wait disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          Save Asset
        </button>
        <button type="button" disabled={deleteDisabled || analyzingTrackId !== null} onClick={() => onDelete(asset)} className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg text-sm text-red-400 hover:bg-red-500/10 disabled:opacity-40">
          <Trash2 className="h-4 w-4" /> Delete from Vault
        </button>
      </div>
    </aside>
  )
}

function AssetPreview({ workspaceId, asset }: { workspaceId: string; asset: VaultAssetRecord }) {
  const previewKind = asset.mimeType?.startsWith('image/')
    ? 'image'
    : asset.mimeType?.startsWith('video/')
      ? 'video'
      : asset.mimeType?.startsWith('audio/')
        ? 'audio'
        : null
  const [dataUrl, setDataUrl] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let active = true
    setDataUrl(null)
    setError(null)
    if (!previewKind) return () => { active = false }
    window.electronAPI.readArtistVaultAssetDataUrl(workspaceId, asset.id)
      .then((url) => {
        if (active) setDataUrl(url)
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => { active = false }
  }, [asset.id, previewKind, workspaceId])

  return (
    <div className="mb-4 rounded-[12px] border border-white/[0.055] bg-black/30 p-3">
      <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.16em] text-white/36">Preview</div>
      <div className="flex min-h-36 items-center justify-center overflow-hidden rounded-[10px] border border-white/[0.05] bg-[#050505] text-center">
        {error ? (
          <div className="px-4 text-xs leading-5 text-white/38">{error.includes('too large for inline preview') ? 'This file exceeds the 32 MB inline preview limit. Your full file is still saved in the Vault.' : 'Preview unavailable for this file.'}</div>
        ) : !previewKind ? (
          <div className="px-4">
            <AssetIcon asset={asset} className="mx-auto mb-2 h-8 w-8 text-white/30" />
            <div className="text-xs text-white/38">No inline preview for this file type.</div>
          </div>
        ) : !dataUrl ? (
          <Loader2 className="h-5 w-5 animate-spin text-white/28" />
        ) : previewKind === 'image' ? (
          <img src={dataUrl} alt={asset.label} onError={() => setError('Image preview failed')} className="max-h-52 w-full object-contain" />
        ) : previewKind === 'video' ? (
          <video src={dataUrl} controls preload="metadata" onError={() => setError('Video preview failed')} className="max-h-52 w-full bg-black object-contain" />
        ) : (
          <div className="w-full px-3 py-6">
            <audio src={dataUrl} controls preload="metadata" onError={() => setError('Audio preview failed')} className="w-full" />
          </div>
        )}
      </div>
    </div>
  )
}

function ImportModal({
  draft,
  busy,
  onClose,
  onChangeDetail,
  onConfirm,
}: {
  draft: ImportDraft
  busy: boolean
  onClose: () => void
  onChangeDetail: (sourcePath: string, patch: { label?: string; notes?: string }) => void
  onConfirm: () => void
}) {
  if (!draft.open) return null
  const candidates = draft.plan?.candidates ?? []
  const skipped = draft.plan?.skipped ?? []
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="max-h-[82vh] w-full max-w-3xl overflow-hidden rounded-[18px] border border-white/[0.08] bg-[#080808] shadow-modal-small">
        <div className="flex items-start justify-between gap-4 border-b border-white/[0.06] p-4">
          <div>
            <h2 className="text-xl font-semibold text-white/90">Confirm Vault Import</h2>
            <p className="mt-1 text-sm text-white/46">Name each file and add any context your team should know.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-2 text-white/42 hover:bg-white/[0.06] hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[58vh] overflow-y-auto p-4">
          <div className="space-y-2">
            {candidates.map((candidate) => {
              const detail = draft.details.find((item) => item.sourcePath === candidate.sourcePath)
              return (
                <div key={candidate.sourcePath} className="rounded-[12px] border border-white/[0.055] bg-white/[0.02] p-3">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="truncate text-xs text-white/38">{candidate.fileName}</div>
                    <div className="inline-flex shrink-0 items-center gap-1.5 text-[11px] font-medium text-emerald-300/72">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Ready to import
                    </div>
                  </div>
                  <div className="grid gap-3">
                    <Field label="Name this asset">
                      <input
                        value={detail?.label ?? ''}
                        onChange={(event) => onChangeDetail(candidate.sourcePath, { label: event.target.value })}
                        placeholder="Give it a name you'll recognize"
                        className={INPUT_CLASS}
                      />
                    </Field>
                    <Field label="Add context for agents">
                      <textarea
                        value={detail?.notes ?? ''}
                        onChange={(event) => onChangeDetail(candidate.sourcePath, { notes: event.target.value })}
                        rows={2}
                        placeholder="What's happening, best moment, intended use…"
                        className={cn(INPUT_CLASS, 'h-auto resize-none py-2')}
                      />
                    </Field>
                  </div>
                </div>
              )
            })}
            {skipped.map((item) => (
              <div key={item.path} className="rounded-[12px] border border-red-500/20 bg-red-500/8 p-3 text-sm text-red-200/75">
                <div className="truncate">{displayFileName(item.path)}</div>
                <div className="mt-1 text-xs text-red-200/48">{item.reason}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-white/[0.06] p-4">
          <button type="button" onClick={onClose} className="h-9 rounded-[9px] border border-white/[0.07] px-4 text-sm text-white/60 hover:bg-white/[0.045]">Cancel</button>
          <button type="button" disabled={busy || candidates.length === 0 || draft.details.some((detail) => !detail.label.trim())} onClick={onConfirm} className="inline-flex h-9 items-center gap-2 rounded-[9px] bg-white/90 px-4 text-sm font-semibold text-black hover:bg-white disabled:cursor-wait disabled:opacity-60">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Import
          </button>
        </div>
      </div>
    </div>
  )
}

function ToolbarButton({ icon: Icon, label, active, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon: React.ElementType; label: string; active?: boolean }) {
  return (
    <button {...props} type="button" className="inline-flex h-8 items-center gap-2 rounded-full border border-white/[0.035] bg-white/[0.018] px-3 text-xs font-medium text-white/46 hover:border-white/[0.08] hover:bg-white/[0.04] hover:text-white/76 disabled:cursor-wait disabled:opacity-50">
      {active ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
      {label}
    </button>
  )
}

function KindChip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cn('shrink-0 rounded-full px-3 py-1 text-[11px] transition-colors', active ? 'bg-white/[0.08] text-white/76' : 'text-white/34 hover:bg-white/[0.035] hover:text-white/60')}>
      {label}
    </button>
  )
}

function AssetRow({ asset, selected, onSelect }: { asset: VaultAssetRecord; selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" onClick={onSelect} className={cn('grid w-full grid-cols-[32px_minmax(0,1fr)_130px_110px] items-center gap-3 border-b border-white/[0.055] px-3 py-2 text-left last:border-b-0 hover:bg-white/[0.035]', selected && 'bg-[#2a1206]/50')}>
      <div className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-white/[0.045]"><AssetIcon asset={asset} className="h-4 w-4 text-white/48" /></div>
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-white/78">{asset.label}</div>
        {asset.notes?.trim() ? <div className="truncate text-[11px] text-white/32">{asset.notes}</div> : null}
      </div>
      <div className="truncate text-xs text-white/42">{formatKind(asset.kind)}</div>
      <VisibilityBadge asset={asset} />
    </button>
  )
}

function TrackStatus({ intelligence }: { intelligence?: TrackIntelligence }) {
  if (!intelligence) return <span className="text-[10px] text-white/28">Not analyzed</span>
  if (intelligence.draft) return <span className="text-[10px] text-amber-300/70">Needs review</span>
  if (intelligence.approved) return <span className="text-[10px] text-emerald-300/70">Approved</span>
  if (intelligence.status === 'pending') return <span className="text-[10px] text-white/45">Analyzing</span>
  if (intelligence.status === 'failed') return <span className="text-[10px] text-red-300/70">Needs attention</span>
  return <span className="text-[10px] text-white/32">{intelligence.status}</span>
}

function EmptyState({ kind }: { kind: VaultAssetKind | 'all' }) {
  const target = kind === 'all' ? 'files' : formatKind(kind).toLowerCase()
  return (
    <div className="flex min-h-[420px] flex-col items-center justify-center rounded-[14px] border border-dashed border-white/[0.07] bg-white/[0.01] text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-[16px] border border-white/[0.06] bg-white/[0.025]">
        <Upload className="h-5 w-5 text-white/24" />
      </div>
      <div className="text-sm font-semibold text-white/58">Drop {target} here</div>
      <div className="mt-1 max-w-[300px] text-xs leading-5 text-white/28">Files are staged before import.</div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-medium uppercase tracking-[0.16em] text-white/36">{label}</span>
      {children}
    </label>
  )
}

function AssetIcon({ asset, className }: { asset: VaultAssetRecord; className?: string }) {
  const Icon = asset.category === 'music' ? Music2
    : asset.category === 'video' ? Video
      : asset.category === 'visuals' ? Image
        : asset.category === 'business' ? Lock
          : asset.category === 'campaigns' ? FileArchive
            : FileText
  return <Icon className={className} />
}

function VisibilityBadge({ asset }: { asset: VaultAssetRecord }) {
  const usable = isAgentUsable(asset)
  const internal = asset.rightsStatus === 'private'
  const needsClearance = asset.rightsStatus === 'needs-clearance'
  const label = internal ? 'Internal' : needsClearance ? 'Needs clearance' : usable ? 'Ready' : 'Working'
  return (
    <span className={cn(
      'inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-medium',
      internal || needsClearance
        ? 'border-amber-400/20 bg-amber-400/10 text-amber-200/72'
        : usable
          ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200/72'
          : 'border-white/[0.07] bg-white/[0.025] text-white/40',
    )}>
      {internal || needsClearance ? <Lock className="h-3 w-3" /> : <ShieldCheck className="h-3 w-3" />}
      {label}
    </span>
  )
}

function TinyPill({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-white/[0.06] bg-white/[0.025] px-2 py-0.5 text-[10px] text-white/42">
      <Icon className="h-3 w-3" />
      <span className="truncate">{label}</span>
    </span>
  )
}

function categoryLabel(category: VaultCategory): string {
  return CATEGORIES.find((item) => item.id === category)?.label ?? formatKind(category)
}

function addHintForSelection(category: VaultCategory, kind: VaultAssetKind | 'all'): VaultKindHint {
  if (
    kind === 'master-final'
    || kind === 'demo'
    || kind === 'raw-footage'
    || kind === 'cover-art'
    || kind === 'artist-photo'
    || kind === 'face-reference'
    || kind === 'contract'
    || kind === 'ad-asset'
  ) {
    return kind
  }
  return CATEGORIES.find((item) => item.id === category)?.hint ?? 'any'
}

function formatKind(value: string): string {
  return value.replace(/-/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
}

function formatTag(value: string): string {
  return value.replace(/[-_]/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
}

function splitList(value: string): string[] {
  return [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))]
}

function toggleListValue(current: string, value: string): string {
  const items = splitList(current)
  return items.includes(value)
    ? items.filter((item) => item !== value).join(', ')
    : [...items, value].join(', ')
}

function removeListValue(current: string, value: string): string {
  return splitList(current).filter((item) => item !== value).join(', ')
}

function displayFileName(value: string): string {
  const fileName = value.replace(/\\/g, '/').split('/').pop() ?? value
  const dot = fileName.lastIndexOf('.')
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName
  return stem.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim() || fileName
}

function parseBpm(value: string): number | null {
  const parsed = Number(value.trim())
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function isAgentUsable(asset: VaultAssetRecord): boolean {
  if (!asset.usableByAgents) return false
  if (asset.status === 'draft' || asset.status === 'archived' || asset.status === 'missing') return false
  return Boolean(asset.relativePath || asset.absolutePath)
}
