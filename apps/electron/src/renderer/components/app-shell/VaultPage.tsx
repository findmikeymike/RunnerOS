import * as React from 'react'
import {
  CheckCircle2,
  FileArchive,
  FileText,
  FolderOpen,
  FolderPlus,
  Grid3X3,
  Image,
  Layers,
  List,
  Loader2,
  Lock,
  Music2,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Tags,
  Upload,
  Video,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import type {
  VaultAssetKind,
  VaultAssetRecord,
  VaultAssetUpdatePatch,
  VaultCategory,
  VaultKindHint,
  VaultManifest,
} from '@craft-agent/shared/artist-vault'

interface VaultPageProps {
  workspaceId: string
  workspaceName?: string
}

type ViewMode = 'grid' | 'list'
type AssetPurpose = 'final' | 'seed'
type ImportDraft = {
  open: boolean
  kindHint: VaultKindHint
  paths: string[]
  plan: Awaited<ReturnType<typeof window.electronAPI.planArtistVaultImports>> | null
}

const CATEGORIES: Array<{
  id: VaultCategory
  label: string
  icon: React.ElementType
  hint: VaultKindHint
  description: string
}> = [
  { id: 'music', label: 'Music', icon: Music2, hint: 'master-final', description: 'Masters, demos, stems, beats, lyrics.' },
  { id: 'video', label: 'Video', icon: Video, hint: 'raw-footage', description: 'Raw footage, clips, edits, finals.' },
  { id: 'visuals', label: 'Visuals', icon: Image, hint: 'cover-art', description: 'Cover art, photos, logos, merch.' },
  { id: 'campaigns', label: 'Campaigns', icon: FileArchive, hint: 'any', description: 'Release, ad, press, social packs.' },
  { id: 'business', label: 'Business', icon: Lock, hint: 'contract', description: 'Contracts, splits, invoices, one-sheets.' },
  { id: 'references', label: 'References', icon: Layers, hint: 'any', description: 'Moodboards, inspiration, swipe files.' },
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

const emptyImportDraft: ImportDraft = { open: false, kindHint: 'any', paths: [], plan: null }
const INPUT_CLASS = 'h-9 w-full rounded-[10px] border border-white/[0.06] bg-[#0b0b0b] px-3 text-sm text-white/76 outline-none placeholder:text-white/26 focus:border-[#f97316]/35'

export function VaultPage({ workspaceId, workspaceName }: VaultPageProps) {
  const [manifest, setManifest] = React.useState<VaultManifest | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [busy, setBusy] = React.useState<string | null>(null)
  const [selectedCategory, setSelectedCategory] = React.useState<VaultCategory>('music')
  const [selectedKind, setSelectedKind] = React.useState<VaultAssetKind | 'all'>('all')
  const [selectedAssetId, setSelectedAssetId] = React.useState<string | null>(null)
  const [viewMode, setViewMode] = React.useState<ViewMode>('grid')
  const [query, setQuery] = React.useState('')
  const [agentFilter, setAgentFilter] = React.useState<'all' | 'usable' | 'private'>('all')
  const [importDraft, setImportDraft] = React.useState<ImportDraft>(emptyImportDraft)

  const refresh = React.useCallback(async () => {
    if (!workspaceId) return
    setLoading(true)
    try {
      const next = await window.electronAPI.getArtistVaultManifest(workspaceId)
      setManifest(next)
      setSelectedAssetId((current) => current && next.assets.some((asset) => asset.id === current) ? current : next.assets[0]?.id ?? null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  const assets = manifest?.assets ?? []
  const selectedAsset = React.useMemo(
    () => assets.find((asset) => asset.id === selectedAssetId) ?? null,
    [assets, selectedAssetId],
  )
  const categoryAssets = React.useMemo(
    () => assets.filter((asset) => asset.category === selectedCategory),
    [assets, selectedCategory],
  )
  const filteredAssets = React.useMemo(() => {
    const needle = query.trim().toLowerCase()
    return categoryAssets.filter((asset) => {
      if (selectedKind !== 'all' && asset.kind !== selectedKind) return false
      if (agentFilter === 'usable' && !isAgentUsable(asset)) return false
      if (agentFilter === 'private' && isAgentUsable(asset)) return false
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
  }, [agentFilter, categoryAssets, query, selectedKind])
  const selectKind = React.useCallback((kind: VaultAssetKind | 'all') => {
    setSelectedKind(kind)
    setSelectedAssetId(categoryAssets.find((asset) => kind === 'all' || asset.kind === kind)?.id ?? null)
  }, [categoryAssets])

  const startImport = React.useCallback(async (kindHint: VaultKindHint) => {
    if (!workspaceId) return
    setBusy(`choose:${kindHint}`)
    try {
      const paths = await window.electronAPI.chooseArtistVaultAssetFiles(workspaceId, kindHint)
      if (!paths.length) return
      const plan = await window.electronAPI.planArtistVaultImports(workspaceId, paths, { kindHint })
      setImportDraft({ open: true, kindHint, paths, plan })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(null)
    }
  }, [workspaceId])

  const confirmImport = React.useCallback(async () => {
    if (!workspaceId || !importDraft.paths.length) return
    setBusy('import')
    try {
      const result = await window.electronAPI.importArtistVaultAssets(workspaceId, importDraft.paths, { kindHint: importDraft.kindHint })
      setManifest(result.manifest)
      setSelectedAssetId(result.imported[0]?.id ?? selectedAssetId)
      setImportDraft(emptyImportDraft)
      toast.success(`Added ${result.imported.length} Vault asset${result.imported.length === 1 ? '' : 's'}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(null)
    }
  }, [importDraft, selectedAssetId, workspaceId])

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
        <header className="mb-4 shrink-0 rounded-[18px] border border-white/[0.055] bg-[#090909] px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-white/[0.06] bg-white/[0.025] px-3 py-1">
                <FolderOpen className="h-3.5 w-3.5 text-white/48" />
                <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-white/52">Artist Library</span>
              </div>
              <h1 className="text-4xl font-medium tracking-tight text-white/92">Vault</h1>
              <p className="mt-1 max-w-2xl text-sm text-white/46">
                Global artist assets for {workspaceName || 'this workspace'}: final files, references, private docs, and agent-safe material.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <ToolbarButton disabled={busy !== null} onClick={() => void startImport('any')} icon={Upload} label="Import" active={busy === 'choose:any'} />
              <ToolbarButton disabled={busy !== null} onClick={() => void linkFolder()} icon={FolderPlus} label="Link Folder" active={busy === 'link-folder'} />
              <ToolbarButton disabled={busy !== null} onClick={() => void scanFolder()} icon={RefreshCw} label="Scan" active={busy === 'scan'} />
              <ToolbarButton onClick={openFolder} icon={FolderOpen} label="Open Folder" />
            </div>
          </div>
        </header>

        <div className="mb-4 grid shrink-0 grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
          {CATEGORIES.map((category) => {
            const count = assets.filter((asset) => asset.category === category.id).length
            const usable = assets.filter((asset) => asset.category === category.id && isAgentUsable(asset)).length
            const Icon = category.icon
            const active = selectedCategory === category.id
            return (
              <button
                key={category.id}
                type="button"
                onClick={() => {
                  setSelectedCategory(category.id)
                  setSelectedKind('all')
                  setSelectedAssetId(assets.find((asset) => asset.category === category.id)?.id ?? null)
                }}
                className={cn(
                  'group min-h-[116px] rounded-[14px] border p-3 text-left transition-colors',
                  active ? 'border-[#f97316]/45 bg-[#2a1206]/70' : 'border-white/[0.055] bg-[#0b0b0b] hover:border-white/[0.12] hover:bg-white/[0.035]',
                )}
              >
                <div className="mb-3 flex items-center justify-between">
                  <Icon className={cn('h-4 w-4', active ? 'text-[#f97316]' : 'text-white/42')} />
                  <span className="rounded-full border border-white/[0.06] px-2 py-0.5 text-[10px] text-white/48">{count}</span>
                </div>
                <div className="text-sm font-semibold text-white/84">{category.label}</div>
                <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-white/38">{category.description}</div>
                <div className="mt-3 flex items-center gap-1.5 text-[10px] text-white/36">
                  <ShieldCheck className="h-3 w-3 text-emerald-300/55" />
                  {usable} agent-ready
                </div>
              </button>
            )
          })}
        </div>

        <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <main className="min-h-0 overflow-hidden rounded-[18px] border border-white/[0.055] bg-[#080808]">
            <div className="border-b border-white/[0.06] p-3">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-lg font-semibold text-white/88">{categoryLabel(selectedCategory)}</h2>
                  <p className="text-xs text-white/38">{filteredAssets.length} shown · {categoryAssets.length} in category</p>
                </div>
                <div className="flex items-center gap-2">
                  <SegmentedButton active={viewMode === 'grid'} onClick={() => setViewMode('grid')} icon={Grid3X3} label="Grid" />
                  <SegmentedButton active={viewMode === 'list'} onClick={() => setViewMode('list')} icon={List} label="List" />
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void startImport(CATEGORIES.find((item) => item.id === selectedCategory)?.hint ?? 'any')}
                    className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[#f97316]/35 bg-[#f97316]/12 px-3 text-xs font-medium text-white/82 hover:bg-[#f97316]/18 disabled:cursor-wait disabled:opacity-50"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add
                  </button>
                </div>
              </div>

              <div className="grid gap-2 lg:grid-cols-[1fr_auto_auto]">
                <label className="flex h-9 items-center gap-2 rounded-[10px] border border-white/[0.06] bg-white/[0.025] px-3">
                  <Search className="h-4 w-4 text-white/34" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search labels, paths, notes, tags..."
                    className="min-w-0 flex-1 bg-transparent text-sm text-white/76 outline-none placeholder:text-white/28"
                  />
                </label>
                <select value={agentFilter} onChange={(event) => setAgentFilter(event.target.value as typeof agentFilter)} className="h-9 rounded-[10px] border border-white/[0.06] bg-[#0b0b0b] px-3 text-xs text-white/70 outline-none">
                  <option value="all">All visibility</option>
                  <option value="usable">Agent-ready</option>
                  <option value="private">Private / blocked</option>
                </select>
                <button
                  type="button"
                  onClick={() => {
                    setQuery('')
                    setAgentFilter('all')
                    selectKind('all')
                  }}
                  className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-white/[0.06] bg-white/[0.025] px-3 text-xs text-white/56 hover:bg-white/[0.045]"
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  Reset
                </button>
              </div>

              <div className="mt-3 flex gap-1.5 overflow-x-auto pb-0.5">
                <KindChip active={selectedKind === 'all'} label="All" count={categoryAssets.length} onClick={() => selectKind('all')} />
                {CATEGORY_KIND_LABELS[selectedCategory].map((item) => (
                  <KindChip
                    key={item.kind}
                    active={selectedKind === item.kind}
                    label={item.label}
                    count={categoryAssets.filter((asset) => asset.kind === item.kind).length}
                    onClick={() => selectKind(item.kind)}
                  />
                ))}
              </div>
            </div>

            <div className="h-full min-h-0 overflow-y-auto p-3 pb-28">
              {filteredAssets.length === 0 ? (
                <EmptyState category={selectedCategory} onAdd={() => void startImport(CATEGORIES.find((item) => item.id === selectedCategory)?.hint ?? 'any')} />
              ) : viewMode === 'grid' ? (
                <div className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">
                  {filteredAssets.map((asset) => (
                    <AssetCard key={asset.id} asset={asset} selected={asset.id === selectedAssetId} onSelect={() => setSelectedAssetId(asset.id)} />
                  ))}
                </div>
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
            asset={selectedAsset}
            busy={busy === `asset:${selectedAsset?.id}`}
            onUpdate={updateAsset}
          />
        </div>
      </div>

      <ImportModal
        draft={importDraft}
        busy={busy === 'import'}
        onClose={() => setImportDraft(emptyImportDraft)}
        onConfirm={confirmImport}
      />
    </div>
  )
}

function AssetDetailPanel({
  asset,
  busy,
  onUpdate,
}: {
  asset: VaultAssetRecord | null
  busy: boolean
  onUpdate: (assetId: string, patch: VaultAssetUpdatePatch) => Promise<void>
}) {
  const [label, setLabel] = React.useState('')
  const [purpose, setPurpose] = React.useState<AssetPurpose>('seed')
  const [privateAsset, setPrivateAsset] = React.useState(false)
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
    setPurpose(asset.status === 'final' || asset.status === 'approved' ? 'final' : 'seed')
    setPrivateAsset(asset.rightsStatus === 'private' || !asset.usableByAgents)
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
      <aside className="hidden rounded-[18px] border border-white/[0.055] bg-[#080808] p-5 text-sm text-white/42 xl:block">
        Select an asset to edit purpose, privacy, tags, song matching, and notes.
      </aside>
    )
  }

  const save = () => onUpdate(asset.id, {
    label,
    status: purpose === 'final' ? 'final' : 'review',
    rightsStatus: privateAsset ? 'private' : 'safe-to-use',
    usableByAgents: !privateAsset,
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
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-[10px] bg-white/[0.045]">
            <AssetIcon asset={asset} className="h-5 w-5 text-white/54" />
          </div>
          <h3 className="truncate text-lg font-semibold text-white/88">{asset.label}</h3>
          <p className="mt-1 text-xs uppercase tracking-[0.12em] text-white/34">{formatKind(asset.kind)}</p>
        </div>
        <VisibilityBadge asset={asset} />
      </div>

      <div className="mb-4 rounded-[12px] border border-white/[0.055] bg-white/[0.02] p-3">
        <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.16em] text-white/36">Preview</div>
        <div className="flex h-36 flex-col items-center justify-center rounded-[10px] border border-white/[0.05] bg-[#050505] text-center">
          <AssetIcon asset={asset} className="mb-2 h-8 w-8 text-white/30" />
          <div className="max-w-[240px] truncate text-xs text-white/52">{asset.relativePath ?? asset.absolutePath ?? 'No path'}</div>
        </div>
      </div>

      <div className="space-y-3">
        <Field label="Label">
          <input value={label} onChange={(event) => setLabel(event.target.value)} className={INPUT_CLASS} />
        </Field>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setPurpose('final')}
            className={cn('rounded-[12px] border px-3 py-2 text-left transition-colors', purpose === 'final' ? 'border-[#f97316]/45 bg-[#2a1206]/55' : 'border-white/[0.06] bg-white/[0.025] hover:bg-white/[0.045]')}
          >
            <span className="block text-sm font-semibold text-white/82">Final / master</span>
            <span className="mt-0.5 block text-xs text-white/38">Ready to send, pitch, post, or use.</span>
          </button>
          <button
            type="button"
            onClick={() => setPurpose('seed')}
            className={cn('rounded-[12px] border px-3 py-2 text-left transition-colors', purpose === 'seed' ? 'border-[#f97316]/45 bg-[#2a1206]/55' : 'border-white/[0.06] bg-white/[0.025] hover:bg-white/[0.045]')}
          >
            <span className="block text-sm font-semibold text-white/82">Seed / demo</span>
            <span className="mt-0.5 block text-xs text-white/38">Useful reference, draft, idea, or working file.</span>
          </button>
        </div>

        <label className="flex items-center justify-between gap-3 rounded-[12px] border border-white/[0.06] bg-white/[0.025] px-3 py-2">
          <span>
            <span className="block text-sm font-medium text-white/76">Private</span>
            <span className="block text-xs text-white/36">Do not send, post, pitch, or expose path to agents.</span>
          </span>
          <input type="checkbox" checked={privateAsset} onChange={(event) => setPrivateAsset(event.target.checked)} className="h-4 w-4 accent-[#f97316]" />
        </label>

        {asset.category === 'music' && (
          <div className="rounded-[12px] border border-white/[0.055] bg-white/[0.018] p-3">
            <div className="mb-3 text-[10px] font-medium uppercase tracking-[0.16em] text-white/36">Song Matching</div>
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

        <Field label="Tags">
          <input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="final, press, cover" className={INPUT_CLASS} />
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
      </div>
    </aside>
  )
}

function ImportModal({
  draft,
  busy,
  onClose,
  onConfirm,
}: {
  draft: ImportDraft
  busy: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  if (!draft.open) return null
  const candidates = draft.plan?.candidates ?? []
  const skipped = draft.plan?.skipped ?? []
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="max-h-[82vh] w-full max-w-3xl overflow-hidden rounded-[18px] border border-white/[0.08] bg-[#080808] shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-white/[0.06] p-4">
          <div>
            <h2 className="text-xl font-semibold text-white/90">Confirm Vault Import</h2>
            <p className="mt-1 text-sm text-white/46">Review where files will land before they are copied into the Artist Vault.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-2 text-white/42 hover:bg-white/[0.06] hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[58vh] overflow-y-auto p-4">
          <div className="mb-4 grid grid-cols-3 gap-2">
            <Metric label="Selected" value={draft.paths.length} />
            <Metric label="Ready" value={candidates.length} />
            <Metric label="Skipped" value={skipped.length} />
          </div>
          <div className="space-y-2">
            {candidates.map((candidate) => (
              <div key={`${candidate.sourcePath}:${candidate.destinationRelativePath}`} className="rounded-[12px] border border-white/[0.055] bg-white/[0.02] p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-white/78">{candidate.fileName}</div>
                    <div className="mt-1 truncate font-mono text-[11px] text-white/38">{candidate.destinationRelativePath}</div>
                  </div>
                  <span className="shrink-0 rounded-full border border-white/[0.06] px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-white/42">{candidate.kind}</span>
                </div>
              </div>
            ))}
            {skipped.map((item) => (
              <div key={item.path} className="rounded-[12px] border border-red-500/20 bg-red-500/8 p-3 text-sm text-red-200/75">
                <div className="truncate">{item.path}</div>
                <div className="mt-1 text-xs text-red-200/48">{item.reason}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-white/[0.06] p-4">
          <button type="button" onClick={onClose} className="h-9 rounded-[9px] border border-white/[0.07] px-4 text-sm text-white/60 hover:bg-white/[0.045]">Cancel</button>
          <button type="button" disabled={busy || candidates.length === 0} onClick={onConfirm} className="inline-flex h-9 items-center gap-2 rounded-[9px] bg-white/90 px-4 text-sm font-semibold text-black hover:bg-white disabled:cursor-wait disabled:opacity-60">
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
    <button {...props} type="button" className="inline-flex h-9 items-center gap-2 rounded-[9px] border border-white/[0.07] bg-white/[0.035] px-3 text-xs font-medium text-white/64 hover:bg-white/[0.06] hover:text-white disabled:cursor-wait disabled:opacity-50">
      {active ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
      {label}
    </button>
  )
}

function SegmentedButton({ active, icon: Icon, label, onClick }: { active: boolean; icon: React.ElementType; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} title={label} className={cn('flex h-8 w-8 items-center justify-center rounded-[8px] border transition-colors', active ? 'border-white/15 bg-white/12 text-white' : 'border-white/[0.06] bg-white/[0.025] text-white/44 hover:text-white/76')}>
      <Icon className="h-3.5 w-3.5" />
    </button>
  )
}

function KindChip({ active, label, count, onClick }: { active: boolean; label: string; count: number; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cn('shrink-0 rounded-full border px-3 py-1 text-[11px] transition-colors', active ? 'border-[#f97316]/45 bg-[#f97316]/12 text-white/86' : 'border-white/[0.06] bg-white/[0.02] text-white/44 hover:bg-white/[0.045]')}>
      {label} <span className="ml-1 text-white/32">{count}</span>
    </button>
  )
}

function AssetCard({ asset, selected, onSelect }: { asset: VaultAssetRecord; selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" onClick={onSelect} className={cn('min-h-[158px] rounded-[14px] border p-3 text-left transition-colors', selected ? 'border-[#f97316]/45 bg-[#2a1206]/50' : 'border-white/[0.055] bg-[#0d0d0d] hover:border-white/[0.12]')}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-white/[0.045]">
          <AssetIcon asset={asset} className="h-5 w-5 text-white/50" />
        </div>
        <VisibilityBadge asset={asset} />
      </div>
      <div className="truncate text-sm font-semibold text-white/82">{asset.label}</div>
      <div className="mt-1 truncate text-[11px] uppercase tracking-[0.12em] text-white/34">{formatKind(asset.kind)}</div>
      <div className="mt-3 truncate font-mono text-[11px] text-white/32">{asset.relativePath ?? asset.absolutePath ?? 'No file path'}</div>
      <div className="mt-3 flex flex-wrap gap-1">
        {asset.category === 'music' && asset.bpm ? <TinyPill icon={Music2} label={`${asset.bpm} BPM`} /> : null}
        {(asset.genre ?? []).slice(0, 1).map((genre) => <TinyPill key={`genre:${genre}`} icon={Music2} label={genre} />)}
        {(asset.moods ?? []).slice(0, 2).map((mood) => <TinyPill key={`mood:${mood}`} icon={Tags} label={mood} />)}
        {(asset.campaigns ?? []).slice(0, 2).map((campaign) => <TinyPill key={campaign} icon={Tags} label={campaign} />)}
      </div>
    </button>
  )
}

function AssetRow({ asset, selected, onSelect }: { asset: VaultAssetRecord; selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" onClick={onSelect} className={cn('grid w-full grid-cols-[32px_minmax(0,1fr)_130px_110px] items-center gap-3 border-b border-white/[0.055] px-3 py-2 text-left last:border-b-0 hover:bg-white/[0.035]', selected && 'bg-[#2a1206]/50')}>
      <div className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-white/[0.045]"><AssetIcon asset={asset} className="h-4 w-4 text-white/48" /></div>
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-white/78">{asset.label}</div>
        <div className="truncate font-mono text-[11px] text-white/32">
          {asset.category === 'music' && [asset.genre?.[0], asset.moods?.[0], asset.bpm ? `${asset.bpm} BPM` : null].filter(Boolean).length
            ? [asset.genre?.[0], asset.moods?.[0], asset.bpm ? `${asset.bpm} BPM` : null].filter(Boolean).join(' · ')
            : asset.relativePath ?? asset.absolutePath ?? 'No path'}
        </div>
      </div>
      <div className="truncate text-xs text-white/42">{formatKind(asset.kind)}</div>
      <VisibilityBadge asset={asset} />
    </button>
  )
}

function EmptyState({ category, onAdd }: { category: VaultCategory; onAdd: () => void }) {
  const Icon = CATEGORIES.find((item) => item.id === category)?.icon ?? FolderOpen
  return (
    <div className="flex min-h-[280px] flex-col items-center justify-center rounded-[14px] border border-dashed border-white/[0.07] bg-white/[0.015] text-center">
      <Icon className="mb-3 h-9 w-9 text-white/18" />
      <div className="text-sm font-semibold text-white/64">No {categoryLabel(category).toLowerCase()} assets yet</div>
      <button type="button" onClick={onAdd} className="mt-4 inline-flex h-9 items-center gap-2 rounded-[9px] bg-white/90 px-4 text-sm font-semibold text-black hover:bg-white">
        <Plus className="h-4 w-4" />
        Add Assets
      </button>
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

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[12px] border border-white/[0.055] bg-white/[0.02] p-3">
      <div className="text-[10px] uppercase tracking-[0.16em] text-white/34">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-white/82">{value}</div>
    </div>
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
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-medium', usable ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200/72' : 'border-white/[0.07] bg-white/[0.025] text-white/40')}>
      {usable ? <ShieldCheck className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
      {usable ? 'Agent' : 'Private'}
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

function formatKind(value: string): string {
  return value.replace(/-/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
}

function splitList(value: string): string[] {
  return [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))]
}

function parseBpm(value: string): number | null {
  const parsed = Number(value.trim())
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function isAgentUsable(asset: VaultAssetRecord): boolean {
  if (!asset.usableByAgents) return false
  if (asset.rightsStatus === 'private' || asset.rightsStatus === 'needs-clearance') return false
  if (asset.status === 'draft' || asset.status === 'archived' || asset.status === 'missing') return false
  return Boolean(asset.relativePath || asset.absolutePath)
}
