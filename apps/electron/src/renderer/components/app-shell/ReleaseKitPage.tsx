import * as React from 'react'
import {
  Archive,
  ArrowLeft,
  Bot,
  Check,
  File,
  FolderOpen,
  Image,
  Loader2,
  Music2,
  PackageCheck,
  Plus,
  Star,
  Trash2,
  Upload,
  Video,
} from 'lucide-react'
import type { MissionAssetRecord } from '@craft-agent/shared/mission-assets'
import type { VaultAssetRecord } from '@craft-agent/shared/artist-vault'
import type {
  PromoteToReleaseKitInput,
  ReleaseKitCategory,
  ReleaseKitItem,
  ReleaseKitManifest,
  ReleaseKitSource,
} from '@craft-agent/shared/release-kit'
import type { OutputSummaryDTO } from '@/hooks/useOutputs'
import type { OutputAsset, OutputManifest } from '@craft-agent/shared/outputs'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { consumePendingReleaseKitOutput } from '@/lib/release-kit-navigation'
import { toast } from 'sonner'

interface ReleaseKitPageProps {
  workspaceId: string
  hqWorkspaceId?: string
  outputs: OutputSummaryDTO[]
  outputsLoading: boolean
  outputsError: string | null
  onOutputClick: (outputId: string) => void
}

type AddStage = 'source' | 'item' | 'details'
type SourceKind = 'upload' | 'campaign-asset' | 'vault-asset' | 'output'

interface SelectedSource {
  source: ReleaseKitSource
  uploadPath?: string
  label: string
  mimeType?: string
  suggested: { category: ReleaseKitCategory; subtype: string }
}

const CATEGORY_ORDER: ReleaseKitCategory[] = ['audio', 'artwork', 'video', 'images', 'copy', 'plans', 'merch', 'documents', 'references']
const CORE_CATEGORIES = new Set<ReleaseKitCategory>(['audio', 'artwork', 'video', 'images', 'plans'])

export function ReleaseKitPage({
  workspaceId,
  hqWorkspaceId,
  outputs,
  outputsLoading,
  outputsError,
  onOutputClick,
}: ReleaseKitPageProps) {
  const [manifest, setManifest] = React.useState<ReleaseKitManifest | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [tab, setTab] = React.useState<'finals' | 'outputs'>('finals')
  const [addOpen, setAddOpen] = React.useState(false)
  const [prefillOutput, setPrefillOutput] = React.useState<OutputSummaryDTO | null>(null)

  const refresh = React.useCallback(async () => {
    if (!workspaceId) return
    setError(null)
    try {
      const current = await window.electronAPI.getReleaseKit(workspaceId)
      setManifest(current)
      try {
        await window.electronAPI.migrateLegacyFinalsToReleaseKit(workspaceId)
        const verified = await window.electronAPI.verifyReleaseKit(workspaceId)
        setManifest(verified.manifest)
      } catch {
        // Read-only team members can still inspect the canonical manifest.
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  React.useEffect(() => {
    setLoading(true)
    void refresh()
    return window.electronAPI.onReleaseKitChanged((changedWorkspaceId, next) => {
      if (changedWorkspaceId === workspaceId) setManifest(next)
    })
  }, [refresh, workspaceId])

  React.useEffect(() => {
    if (outputsLoading) return
    const pendingOutputId = consumePendingReleaseKitOutput()
    if (!pendingOutputId) return
    const output = outputs.find((candidate) => candidate.id === pendingOutputId)
    if (!output) return
    setTab('outputs')
    setPrefillOutput(output)
    setAddOpen(true)
  }, [outputs, outputsLoading, workspaceId])

  const visibleCategories = React.useMemo(() => CATEGORY_ORDER.filter((category) => (
    CORE_CATEGORIES.has(category) || manifest?.items.some((item) => item.category === category)
  )), [manifest])

  if (loading) {
    return <div className="flex h-full items-center justify-center bg-[#070708] text-sm text-white/45"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading Release Kit</div>
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#070708] text-white">
      <header className="flex shrink-0 items-center justify-between border-b border-white/[0.08] px-7 py-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#fb923c]">
            <PackageCheck className="h-3.5 w-3.5" /> Campaign canon
          </div>
          <h1 className="mt-1 text-2xl font-semibold text-white/92">Release Kit</h1>
          <p className="mt-1 text-sm text-white/42">Approved masters, artwork, content, plans, and launch-ready documents.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="border-white/10 bg-white/[0.025] text-white/65 hover:bg-white/[0.06] hover:text-white" onClick={() => void window.electronAPI.openReleaseKitFolder(workspaceId)}>
            <FolderOpen className="mr-1.5 h-3.5 w-3.5" /> Folder
          </Button>
          <Button size="sm" className="bg-[#f97316] text-black hover:bg-[#fb923c]" onClick={() => { setPrefillOutput(null); setAddOpen(true) }}>
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Add final
          </Button>
        </div>
      </header>

      <div className="flex shrink-0 items-center justify-between border-b border-white/[0.06] px-7 py-3">
        <div className="inline-flex rounded-[6px] border border-white/[0.08] bg-black/25 p-0.5">
          <TabButton active={tab === 'finals'} onClick={() => setTab('finals')}>Finals</TabButton>
          <TabButton active={tab === 'outputs'} onClick={() => setTab('outputs')}>Outputs</TabButton>
        </div>
        <span className="text-xs text-white/35">{manifest?.items.filter((item) => item.status === 'ready').length ?? 0} approved</span>
      </div>

      {error ? <div className="mx-7 mt-4 rounded-[6px] border border-red-500/25 bg-red-500/[0.06] px-3 py-2 text-xs text-red-200">{error}</div> : null}

      <main className="min-h-0 flex-1 overflow-y-auto px-7 py-5">
        {tab === 'finals' ? (
          <div className="mx-auto max-w-[1180px] space-y-7">
            <ReadinessStrip manifest={manifest} />
            {visibleCategories.map((category) => (
              <FinalCategory
                key={category}
                category={category}
                items={manifest?.items.filter((item) => item.category === category) ?? []}
                workspaceId={workspaceId}
                onChanged={setManifest}
                onAdd={() => setAddOpen(true)}
              />
            ))}
          </div>
        ) : (
          <OutputsTab
            outputs={outputs}
            loading={outputsLoading}
            error={outputsError}
            onOpen={onOutputClick}
            onPromote={(output) => {
              setPrefillOutput(output)
              setAddOpen(true)
            }}
          />
        )}
      </main>

      <AddFinalDialog
        open={addOpen}
        onOpenChange={(next) => { setAddOpen(next); if (!next) setPrefillOutput(null) }}
        workspaceId={workspaceId}
        hqWorkspaceId={hqWorkspaceId}
        outputs={outputs}
        prefillOutput={prefillOutput}
        onAdded={(next) => {
          setManifest(next)
          setTab('finals')
        }}
      />
    </div>
  )
}

function ReadinessStrip({ manifest }: { manifest: ReleaseKitManifest | null }) {
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[7px] border border-white/[0.08] bg-white/[0.08] sm:grid-cols-5">
      {(['audio', 'artwork', 'video', 'images', 'plans'] as ReleaseKitCategory[]).map((category) => {
        const ready = manifest?.items.filter((item) => item.category === category && item.status === 'ready').length ?? 0
        return (
          <div key={category} className="flex items-center justify-between bg-[#0d0d0f] px-3 py-2.5">
            <span className="text-xs capitalize text-white/48">{category}</span>
            <span className={cn('text-xs font-semibold', ready ? 'text-emerald-300' : 'text-white/24')}>{ready || '—'}</span>
          </div>
        )
      })}
    </div>
  )
}

function FinalCategory({ category, items, workspaceId, onChanged, onAdd }: {
  category: ReleaseKitCategory
  items: ReleaseKitItem[]
  workspaceId: string
  onChanged: (manifest: ReleaseKitManifest) => void
  onAdd: () => void
}) {
  return (
    <section>
      <div className="mb-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CategoryIcon category={category} className="h-4 w-4 text-white/40" />
          <h2 className="text-sm font-semibold capitalize text-white/78">{category}</h2>
          <span className="text-xs text-white/28">{items.length}</span>
        </div>
        <button type="button" onClick={onAdd} className="text-xs text-white/38 hover:text-white/75">Add</button>
      </div>
      {items.length === 0 ? (
        <button type="button" onClick={onAdd} className="flex h-16 w-full items-center justify-center rounded-[7px] border border-dashed border-white/[0.09] bg-white/[0.018] text-xs text-white/28 hover:border-white/[0.16] hover:text-white/55">
          <Plus className="mr-1.5 h-3.5 w-3.5" /> Add approved {category}
        </button>
      ) : (
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => <FinalItem key={item.id} item={item} workspaceId={workspaceId} onChanged={onChanged} />)}
        </div>
      )}
    </section>
  )
}

function FinalItem({ item, workspaceId, onChanged }: { item: ReleaseKitItem; workspaceId: string; onChanged: (manifest: ReleaseKitManifest) => void }) {
  const open = async () => {
    try {
      const detail = await window.electronAPI.getReleaseKitItem(workspaceId, item.id)
      await window.electronAPI.openFile(detail.absolutePath)
    } catch (error) {
      toast.error('Could not open final', { description: error instanceof Error ? error.message : String(error) })
    }
  }
  return (
    <div className="group flex min-w-0 items-center gap-3 rounded-[7px] border border-white/[0.08] bg-[#111114] p-3 hover:border-white/[0.14] hover:bg-[#141417]">
      <button type="button" onClick={() => void open()} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[6px] bg-white/[0.045] text-white/45 hover:text-white/80" title="Open final">
        <CategoryIcon category={item.category} className="h-4 w-4" />
      </button>
      <button type="button" onClick={() => void open()} className="min-w-0 flex-1 text-left">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium text-white/82">{item.title}</span>
          {item.isPrimary ? <span className="rounded-[4px] bg-[#f97316]/14 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-[#fb923c]">Primary</span> : null}
        </div>
        <div className="mt-1 flex items-center gap-1.5 text-[11px] text-white/34">
          <span>{displaySubtype(item.subtype)}</span><span>·</span><span>{displaySource(item.source)}</span>
          {item.status !== 'ready' ? <span className="text-amber-300">· {displaySubtype(item.status)}</span> : null}
        </div>
      </button>
      <div className="flex shrink-0 items-center opacity-50 transition-opacity group-hover:opacity-100">
        {!item.isPrimary && item.status === 'ready' ? (
          <IconButton title="Set Primary" onClick={async () => onChanged(await window.electronAPI.setReleaseKitPrimary(workspaceId, item.id))}><Star className="h-3.5 w-3.5" /></IconButton>
        ) : null}
        <IconButton title="Remove final" danger onClick={async () => {
          if (!window.confirm(`Remove “${item.title}” from the Release Kit? The source file will stay untouched.`)) return
          onChanged(await window.electronAPI.removeFromReleaseKit(workspaceId, item.id))
        }}><Trash2 className="h-3.5 w-3.5" /></IconButton>
      </div>
    </div>
  )
}

function OutputsTab({ outputs, loading, error, onOpen, onPromote }: {
  outputs: OutputSummaryDTO[]
  loading: boolean
  error: string | null
  onOpen: (id: string) => void
  onPromote: (output: OutputSummaryDTO) => void
}) {
  if (loading) return <Centered><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading Outputs</Centered>
  if (error) return <Centered>{error}</Centered>
  if (!outputs.length) return <Centered>No Outputs yet. Agent work products will appear here.</Centered>
  return (
    <div className="mx-auto max-w-[980px] divide-y divide-white/[0.06] border-y border-white/[0.07]">
      {outputs.map((output) => (
        <div key={output.id} className="flex items-center gap-3 px-2 py-3 hover:bg-white/[0.02]">
          <button type="button" onClick={() => onOpen(output.id)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px] bg-white/[0.04] text-white/38"><File className="h-4 w-4" /></button>
          <button type="button" onClick={() => onOpen(output.id)} className="min-w-0 flex-1 text-left">
            <div className="truncate text-sm font-medium text-white/78">{output.title}</div>
            <div className="mt-0.5 truncate text-xs text-white/32">{output.summary || output.kind}</div>
          </button>
          <Button variant="outline" size="sm" className="h-8 border-white/10 bg-transparent text-xs text-white/55 hover:bg-white/[0.05] hover:text-white" onClick={() => onPromote(output)}>
            <PackageCheck className="mr-1.5 h-3.5 w-3.5" /> Promote
          </Button>
        </div>
      ))}
    </div>
  )
}

function AddFinalDialog({ open, onOpenChange, workspaceId, hqWorkspaceId, outputs, prefillOutput, onAdded }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  hqWorkspaceId?: string
  outputs: OutputSummaryDTO[]
  prefillOutput: OutputSummaryDTO | null
  onAdded: (manifest: ReleaseKitManifest) => void
}) {
  const [stage, setStage] = React.useState<AddStage>('source')
  const [sourceKind, setSourceKind] = React.useState<SourceKind | null>(null)
  const [campaignAssets, setCampaignAssets] = React.useState<MissionAssetRecord[]>([])
  const [vaultAssets, setVaultAssets] = React.useState<VaultAssetRecord[]>([])
  const [outputChoices, setOutputChoices] = React.useState<SelectedSource[]>([])
  const [selected, setSelected] = React.useState<SelectedSource | null>(null)
  const [category, setCategory] = React.useState<ReleaseKitCategory>('documents')
  const [subtype, setSubtype] = React.useState('final-document')
  const [title, setTitle] = React.useState('')
  const [makePrimary, setMakePrimary] = React.useState(false)
  const [busy, setBusy] = React.useState(false)

  const reset = React.useCallback(() => {
    setStage('source'); setSourceKind(null); setSelected(null); setTitle(''); setMakePrimary(false)
  }, [])

  React.useEffect(() => {
    if (!open) reset()
  }, [open, reset])

  const selectSource = (next: SelectedSource) => {
    setSelected(next)
    setCategory(next.suggested.category)
    setSubtype(next.suggested.subtype)
    setTitle(next.label)
    setStage('details')
  }

  React.useEffect(() => {
    if (!open || !prefillOutput) return
    let cancelled = false
    setBusy(true)
    void window.electronAPI.getOutput(workspaceId, prefillOutput.id).then((output) => {
      if (cancelled) return
      const choices = output ? sourceChoicesFromOutput(output) : []
      setSourceKind('output')
      setOutputChoices(choices)
      if (choices.length === 1) selectSource(choices[0]!)
      else setStage('item')
    }).catch((error) => {
      if (!cancelled) toast.error('Could not load Output files', { description: error instanceof Error ? error.message : String(error) })
    }).finally(() => {
      if (!cancelled) setBusy(false)
    })
    return () => { cancelled = true }
  }, [open, prefillOutput, workspaceId])

  const chooseKind = async (kind: SourceKind) => {
    setSourceKind(kind)
    if (kind === 'upload') {
      const upload = await window.electronAPI.chooseReleaseKitUpload(workspaceId)
      if (!upload) return
      selectSource(sourceFromUpload(upload.path, upload.originalFileName))
      return
    }
    setBusy(true)
    try {
      if (kind === 'campaign-asset') {
        const manifest = await window.electronAPI.getMissionAssetManifest(workspaceId)
        setCampaignAssets(manifest.files.filter((asset) => asset.status === 'available' && asset.usableByAgents))
      } else if (kind === 'vault-asset') {
        if (!hqWorkspaceId) throw new Error('Artist HQ Vault is not configured.')
        const manifest = await window.electronAPI.getArtistVaultManifest(hqWorkspaceId)
        setVaultAssets(manifest.assets.filter((asset) => asset.usableByAgents && asset.rightsStatus !== 'private' && asset.status !== 'missing' && asset.status !== 'archived'))
      } else if (kind === 'output') {
        const manifests = await Promise.all(outputs.map((output) => window.electronAPI.getOutput(workspaceId, output.id)))
        setOutputChoices(manifests.flatMap((output) => output ? sourceChoicesFromOutput(output) : []))
      }
      setStage('item')
    } catch (error) {
      toast.error('Could not load source files', { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(false)
    }
  }

  const submit = async () => {
    if (!selected || !subtype.trim() || !title.trim()) return
    setBusy(true)
    try {
      const input: PromoteToReleaseKitInput = {
        source: selected.source,
        uploadPath: selected.uploadPath,
        category,
        subtype: subtype.trim(),
        title: title.trim(),
        mimeType: selected.mimeType,
        makePrimary,
      }
      const result = await window.electronAPI.promoteToReleaseKit(workspaceId, input)
      onAdded(result.manifest)
      onOpenChange(false)
      toast.success('Added to Release Kit')
    } catch (error) {
      toast.error('Could not add final', { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(false)
    }
  }

  const choices = sourceKind === 'campaign-asset'
    ? campaignAssets.map(sourceFromCampaignAsset)
    : sourceKind === 'vault-asset' && hqWorkspaceId
      ? vaultAssets.map((asset) => sourceFromVaultAsset(asset, hqWorkspaceId))
      : sourceKind === 'output'
        ? outputChoices
        : []

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="border-white/10 bg-[#0b0b0d] text-white sm:max-w-[560px]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            {stage !== 'source' ? <button type="button" onClick={() => setStage(stage === 'details' && sourceKind !== 'upload' ? 'item' : 'source')} className="rounded-[5px] p-1 text-white/45 hover:bg-white/[0.06] hover:text-white"><ArrowLeft className="h-4 w-4" /></button> : null}
            <DialogTitle>{stage === 'source' ? 'Add a final' : stage === 'item' ? 'Choose the exact item' : 'Final details'}</DialogTitle>
          </div>
        </DialogHeader>

        {stage === 'source' ? (
          <div className="divide-y divide-white/[0.07] border-y border-white/[0.07]">
            <SourceChoice icon={Upload} title="Upload a file" detail="Add a finished file from your computer" onClick={() => void chooseKind('upload')} />
            <SourceChoice icon={Archive} title="Campaign Asset" detail="Promote an approved source file from this campaign" onClick={() => void chooseKind('campaign-asset')} />
            <SourceChoice icon={Bot} title="Agent Output" detail="Promote a durable work product created in Artist OS" onClick={() => void chooseKind('output')} />
            <SourceChoice icon={FolderOpen} title="HQ Vault" detail="Reuse approved material from the artist’s career library" onClick={() => void chooseKind('vault-asset')} />
          </div>
        ) : stage === 'item' ? (
          <div className="max-h-[420px] overflow-y-auto border-y border-white/[0.07]">
            {busy ? <Centered><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading</Centered> : choices.length ? choices.map((choice) => (
              <button key={sourceKey(choice.source)} type="button" onClick={() => selectSource(choice)} className="flex w-full items-center gap-3 border-b border-white/[0.06] px-2 py-3 text-left last:border-0 hover:bg-white/[0.035]">
                <File className="h-4 w-4 shrink-0 text-white/35" />
                <span className="min-w-0 flex-1 truncate text-sm text-white/74">{choice.label}</span>
                <span className="text-[11px] capitalize text-white/28">{displaySubtype(choice.suggested.subtype)}</span>
              </button>
            )) : <Centered>No eligible items found.</Centered>}
          </div>
        ) : selected ? (
          <div className="space-y-4">
            <div className="rounded-[6px] border border-white/[0.08] bg-white/[0.025] px-3 py-2.5">
              <div className="text-[10px] uppercase tracking-[0.14em] text-white/28">Source</div>
              <div className="mt-1 truncate text-sm text-white/70">{selected.label}</div>
            </div>
            <label className="block space-y-1.5 text-xs text-white/42">
              <span>Title</span>
              <input value={title} onChange={(event) => setTitle(event.target.value)} className={INPUT_CLASS} />
            </label>
            <div className="grid grid-cols-[1fr_1.15fr] gap-3">
              <label className="block space-y-1.5 text-xs text-white/42">
                <span>Category</span>
                <select value={category} onChange={(event) => setCategory(event.target.value as ReleaseKitCategory)} className={INPUT_CLASS}>
                  {CATEGORY_ORDER.map((option) => <option key={option} value={option}>{displaySubtype(option)}</option>)}
                </select>
              </label>
              <label className="block space-y-1.5 text-xs text-white/42">
                <span>Type</span>
                <input value={subtype} onChange={(event) => setSubtype(event.target.value)} placeholder="master, cover-art, lyric-video…" className={INPUT_CLASS} />
              </label>
            </div>
            <label className="flex cursor-pointer items-center gap-2.5 rounded-[6px] border border-white/[0.07] px-3 py-2.5 text-sm text-white/62">
              <input type="checkbox" checked={makePrimary} onChange={(event) => setMakePrimary(event.target.checked)} className="accent-[#f97316]" />
              Make this the Primary {displaySubtype(subtype)}
            </label>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button disabled={busy || !title.trim() || !subtype.trim()} className="bg-[#f97316] text-black hover:bg-[#fb923c]" onClick={() => void submit()}>
                {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />} Add final
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} className={cn('rounded-[4px] px-3 py-1.5 text-xs font-medium', active ? 'bg-white text-black' : 'text-white/42 hover:text-white/70')}>{children}</button>
}

function SourceChoice({ icon: Icon, title, detail, onClick }: { icon: React.ComponentType<{ className?: string }>; title: string; detail: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 px-2 py-3.5 text-left hover:bg-white/[0.035]">
      <span className="flex h-9 w-9 items-center justify-center rounded-[6px] bg-white/[0.045] text-white/45"><Icon className="h-4 w-4" /></span>
      <span><span className="block text-sm font-medium text-white/78">{title}</span><span className="mt-0.5 block text-xs text-white/34">{detail}</span></span>
    </button>
  )
}

function IconButton({ title, danger, onClick, children }: { title: string; danger?: boolean; onClick: () => void | Promise<void>; children: React.ReactNode }) {
  return <button type="button" title={title} onClick={() => void onClick()} className={cn('rounded-[5px] p-1.5 text-white/35 hover:bg-white/[0.06] hover:text-white/75', danger && 'hover:bg-red-500/10 hover:text-red-300')}>{children}</button>
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-32 items-center justify-center text-sm text-white/35">{children}</div>
}

function CategoryIcon({ category, className }: { category: ReleaseKitCategory; className?: string }) {
  if (category === 'audio') return <Music2 className={className} />
  if (category === 'artwork' || category === 'images') return <Image className={className} />
  if (category === 'video') return <Video className={className} />
  return <File className={className} />
}

function sourceFromCampaignAsset(asset: MissionAssetRecord): SelectedSource {
  return { source: { type: 'campaign-asset', assetId: asset.id }, label: asset.label, mimeType: asset.mimeType, suggested: placementForKind(asset.kind) }
}

function sourceFromVaultAsset(asset: VaultAssetRecord, vaultWorkspaceId: string): SelectedSource {
  return { source: { type: 'vault-asset', assetId: asset.id, vaultWorkspaceId }, label: asset.label, mimeType: asset.mimeType, suggested: placementForKind(asset.kind) }
}

function sourceChoicesFromOutput(output: OutputManifest): SelectedSource[] {
  const assets = [...output.assets]
  if (output.primary && !assets.some((asset) => asset.id === output.primary?.id)) assets.unshift(output.primary)
  return assets.map((asset) => sourceFromOutputAsset(output, asset))
}

function sourceFromOutputAsset(output: OutputManifest, asset: OutputAsset): SelectedSource {
  const fileName = asset.path.split(/[\\/]/).pop() ?? asset.label
  return {
    source: { type: 'output', outputId: output.id, assetId: asset.id },
    label: `${output.title} · ${asset.label || fileName}`,
    mimeType: asset.mimeType,
    suggested: placementForKind(`${output.kind} ${asset.label} ${fileName}`),
  }
}

function sourceFromUpload(path: string, originalFileName: string): SelectedSource {
  return { source: { type: 'upload', originalFileName }, uploadPath: path, label: originalFileName, suggested: placementForKind(originalFileName.split('.').pop() ?? '') }
}

function placementForKind(kind: string): { category: ReleaseKitCategory; subtype: string } {
  const value = kind.toLowerCase()
  if (/master|demo|stem|audio|wav|aiff|flac|mp3|m4a/.test(value)) return { category: 'audio', subtype: value.includes('clean') ? 'clean-version' : 'master' }
  if (/cover-art|artwork|psd|ai$/.test(value)) return { category: 'artwork', subtype: 'cover-art' }
  if (/video|mov|mp4|m4v|webm/.test(value)) return { category: 'video', subtype: value.includes('lyric') ? 'lyric-video' : 'final-video' }
  if (/image|photo|png|jpe?g|webp|gif|tiff?/.test(value)) return { category: 'images', subtype: value.includes('press') ? 'press-photo' : 'social-image' }
  if (/plan|strategy|report/.test(value)) return { category: 'plans', subtype: 'marketing-plan' }
  if (/merch/.test(value)) return { category: 'merch', subtype: 'design' }
  if (/caption|copy|bio|press/.test(value)) return { category: 'copy', subtype: 'campaign-copy' }
  return { category: 'documents', subtype: 'final-document' }
}

function sourceKey(source: ReleaseKitSource): string {
  if (source.type === 'upload') return `upload:${source.originalFileName}`
  if (source.type === 'output' || source.type === 'legacy-final') return `${source.type}:${source.outputId}:${source.assetId ?? ''}`
  return `${source.type}:${source.assetId}`
}

function displaySubtype(value: string): string {
  return value.replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function displaySource(source: ReleaseKitSource): string {
  if (source.type === 'campaign-asset') return 'Campaign Asset'
  if (source.type === 'vault-asset') return 'HQ Vault'
  if (source.type === 'output' || source.type === 'legacy-final') return 'Output'
  return 'Upload'
}

const INPUT_CLASS = 'h-10 w-full rounded-[6px] border border-white/[0.1] bg-[#111114] px-3 text-sm text-white/78 outline-none focus:border-[#f97316]/55'
