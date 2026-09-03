import * as React from 'react'
import {
  Archive,
  ArrowLeft,
  AudioWaveform,
  Bot,
  Check,
  ChevronDown,
  Clock3,
  ExternalLink,
  File,
  FileWarning,
  FolderOpen,
  Image,
  Loader2,
  PackageCheck,
  Play,
  Plus,
  Star,
  Send,
  Scissors,
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
import type { ReleaseKitItemUseSummary } from '@craft-agent/shared/scheduled-work'
import type { OutputSummaryDTO } from '@/hooks/useOutputs'
import type { OutputAsset, OutputManifest, SocialVariantDestinationIntent } from '@craft-agent/shared/outputs'
import { Button } from '@/components/ui/button'
import { CompactPageHeader } from './CompactPageHeader'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { consumePendingReleaseKitOutput } from '@/lib/release-kit-navigation'
import {
  featuredReleaseKitItem,
  isUnverifiedReleaseKitItem,
  releaseKitStatusExplanation,
  releaseKitStatusLabel,
  releaseKitStatusRingClass,
  shouldShowPrimaryBadge,
} from './release-kit-status'
import { toast } from 'sonner'
import { useAppShellContext } from '@/context/AppShellContext'
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { buildSocialVariantSetContinuePrompt, releaseKitRepurposeRestriction } from '@/lib/release-kit-repurpose'
import { SocialVariantSetupDrawer, type SocialVariantSetupSource } from '@/components/social-variants/SocialVariantSetupDrawer'
import { openVideoRepurposeSession } from '@/lib/video-repurpose-launch'
import { sendAgentDraft } from '@/lib/run-agent'
import { navigate, routes } from '@/lib/navigate'

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
type AssetDrawerMode = 'details' | 'where' | 'post' | 'when'
type ReleaseKitSocialProfile = { platform: string; profileId: string; label: string; accountSetId?: string; ready: boolean }
type SocialVariantPostIntent = SocialVariantDestinationIntent & { variantId: string }
type PendingVariantPromotion = {
  sourceWorkspaceId: string
  outputId: string
  variantId: string
  assetId: string
  title: string
  sha256: string
  mimeType?: string
  sizeBytes?: number
  destination: SocialVariantDestinationIntent
}

const ReleaseKitInspectContext = React.createContext<(item: ReleaseKitItem) => void>(() => {})

interface SelectedSource {
  source: ReleaseKitSource
  uploadPath?: string
  label: string
  mimeType?: string
  suggested: { category: ReleaseKitCategory; subtype: string }
}

const CATEGORY_ORDER: ReleaseKitCategory[] = ['audio', 'artwork', 'video', 'images', 'copy', 'plans', 'merch', 'documents', 'references']
const CORE_CATEGORIES = new Set<ReleaseKitCategory>(['audio', 'artwork', 'video', 'images', 'plans'])
const VISUAL_CATEGORIES = new Set<ReleaseKitCategory>(['audio', 'artwork', 'video', 'images'])
const RELEASE_KIT_SURFACE_CLASS = 'group/release-kit relative overflow-hidden rounded-2xl ring-1 ring-white/[0.055]'
const RELEASE_KIT_SURFACE_STYLE: React.CSSProperties = {
  backgroundColor: '#090909',
  backgroundImage: [
    'radial-gradient(at 88% 40%, rgba(20,20,20,0.58) 0px, transparent 78%)',
    'radial-gradient(at 12% 20%, rgba(52,52,52,0.14) 0px, transparent 72%)',
    'radial-gradient(at 0% 82%, rgba(72,72,72,0.10) 0px, transparent 74%)',
    'radial-gradient(at 100% 100%, rgba(255,77,0,0.018) 0px, transparent 64%)',
  ].join(', '),
}

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
  const [tab, setTab] = React.useState<'finals' | 'variants' | 'outputs'>('finals')
  const [addOpen, setAddOpen] = React.useState(false)
  const [prefillOutput, setPrefillOutput] = React.useState<OutputSummaryDTO | null>(null)
  const [itemPaths, setItemPaths] = React.useState<Record<string, string>>({})
  const [selectedItemId, setSelectedItemId] = React.useState<string | null>(null)
  const [selectedVariantPostIntent, setSelectedVariantPostIntent] = React.useState<SocialVariantPostIntent | null>(null)
  const [pendingVariantPromotion, setPendingVariantPromotion] = React.useState<PendingVariantPromotion | null>(null)
  const [variantSetupOpen, setVariantSetupOpen] = React.useState(false)
  const [variantSetupSourceId, setVariantSetupSourceId] = React.useState<string | null>(null)
  const selectedItem = manifest?.items.find((item) => item.id === selectedItemId) ?? null
  const pendingVariantItem = React.useMemo(
    () => pendingVariantPromotion ? pendingVariantAsReleaseKitItem(workspaceId, pendingVariantPromotion) : null,
    [pendingVariantPromotion, workspaceId],
  )
  const { onCreateSession, onInputChange, onSendMessage, skills, enabledSources, activeAgents } = useAppShellContext()
  const variantOutputs = React.useMemo(() => outputs.filter((output) => Boolean(output.socialVariantSetSummary)), [outputs])

  const continueVariantSet = React.useCallback(async (output: OutputSummaryDTO) => {
    const detail = await window.electronAPI.getOutput(workspaceId, output.id)
    const set = detail?.socialVariantSet
    if (!detail || !set) throw new Error('Variant Set is unavailable.')
    const existing = await window.electronAPI.getSessionMessages(set.editorSessionId)
    if (existing) {
      if (!existing.isProcessing && existing.messages.length === 0) {
        await sendAgentDraft(
          onSendMessage,
          set.editorSessionId,
          buildSocialVariantSetContinuePrompt({ outputId: detail.id, revision: set.revision }),
          'Raw Video Editor',
        )
      }
      navigate(routes.view.allSessions(set.editorSessionId))
      return
    }
    const replacement = await openVideoRepurposeSession({
      workspaceId,
      activeAgents,
      skills,
      sources: enabledSources,
      onCreateSession,
      onInputChange,
      onSendMessage,
      autoSendDraft: false,
      navigateOnCreate: false,
    })
    const rebound = await window.electronAPI.rebindSocialVariantSet(workspaceId, {
      outputId: detail.id,
      expectedRevision: set.revision,
      editorSessionId: replacement.id,
    })
    const revision = rebound.socialVariantSet?.revision
    await sendAgentDraft(
      onSendMessage,
      replacement.id,
      buildSocialVariantSetContinuePrompt({ outputId: detail.id, revision }),
      'Raw Video Editor',
    )
    navigate(routes.view.allSessions(replacement.id))
  }, [activeAgents, enabledSources, onCreateSession, onInputChange, onSendMessage, skills, workspaceId])

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
    const pending = consumePendingReleaseKitOutput()
    if (!pending) return
    if (pending.socialVariantId && pending.assetId) {
      if (pending.targetCampaignId && pending.targetCampaignId !== workspaceId) {
        toast.error('Could not open this variant', { description: 'The selected campaign changed before the handoff completed.' })
        return
      }
      const sourceWorkspaceId = pending.sourceWorkspaceId ?? workspaceId
      void (async () => {
        const output = await window.electronAPI.getOutput(sourceWorkspaceId, pending.outputId)
        const variant = output?.socialVariantSet?.variants.find((candidate) => candidate.id === pending.socialVariantId)
        if (!output || !variant || variant.state !== 'ready' || variant.assetId !== pending.assetId || !variant.sha256) {
          throw new Error('This exact variant is no longer ready to use.')
        }
        const variantAssetId = variant.assetId!
        const variantSha256 = variant.sha256!
        const outputAsset = output.assets.find((candidate) => candidate.id === variant.assetId)
        if (!outputAsset?.sha256 || outputAsset.sha256.toLowerCase() !== variant.sha256.toLowerCase()) {
          throw new Error('This version no longer matches its rendered asset record.')
        }
        const current = await window.electronAPI.getReleaseKit(workspaceId)
        const existing = current.items.find((item) => item.source.type === 'output'
          && item.source.outputId === output.id
          && item.source.assetId === variant.assetId
          && (item.source.sourceWorkspaceId ?? workspaceId) === sourceWorkspaceId
          && item.sha256.toLowerCase() === variant.sha256?.toLowerCase())
        setSelectedVariantPostIntent({ ...variant.destination, variantId: variant.id })
        if (existing) {
          setManifest(current)
          setPendingVariantPromotion(null)
          setSelectedItemId(existing.id)
        } else {
          setSelectedItemId(null)
          setPendingVariantPromotion({
            sourceWorkspaceId,
            outputId: output.id,
            variantId: variant.id,
            assetId: variantAssetId,
            title: variant.title,
            sha256: variantSha256,
            mimeType: outputAsset.mimeType,
            sizeBytes: outputAsset.sizeBytes,
            destination: variant.destination,
          })
        }
      })().catch((cause) => toast.error('Could not prepare this version', { description: cause instanceof Error ? cause.message : String(cause) }))
      return
    }
    const output = outputs.find((candidate) => candidate.id === pending.outputId)
    if (!output) return
    setTab('outputs')
    setPrefillOutput({ ...output, ...(pending.assetId ? { primaryAssetId: pending.assetId } : {}) })
    setAddOpen(true)
  }, [outputs, outputsLoading, workspaceId])

  React.useEffect(() => {
    let cancelled = false
    const previewable = manifest?.items.filter((item) => (
      item.status !== 'missing' && (item.category === 'artwork' || item.category === 'video' || item.category === 'images')
    )) ?? []
    if (!previewable.length) {
      setItemPaths({})
      return () => { cancelled = true }
    }
    void Promise.all(previewable.map(async (item) => {
      try {
        const detail = await window.electronAPI.getReleaseKitItem(workspaceId, item.id)
        return [item.id, detail.absolutePath] as const
      } catch {
        return null
      }
    })).then((entries) => {
      if (cancelled) return
      setItemPaths(Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => Boolean(entry))))
    })
    return () => { cancelled = true }
  }, [manifest, workspaceId])

  const visibleCategories = React.useMemo(() => CATEGORY_ORDER.filter((category) => (
    CORE_CATEGORIES.has(category) || manifest?.items.some((item) => item.category === category)
  )), [manifest])
  const variantSources = React.useMemo<SocialVariantSetupSource[]>(() => (manifest?.items ?? [])
    .filter((item) => item.category === 'video')
    .map((item) => ({
      id: item.id,
      title: item.title,
      detail: displaySubtype(item.subtype),
      selection: { origin: 'release-kit' as const, sourceId: item.id },
      absolutePath: itemPaths[item.id],
      sha256: item.sha256,
      restriction: releaseKitRepurposeRestriction(item, itemPaths[item.id]),
    })), [itemPaths, manifest])

  if (loading) {
    return <div className="flex h-full items-center justify-center bg-[#070708] text-sm text-white/45"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading Release Kit</div>
  }

  return (
    <div className="h-full overflow-hidden bg-[#050505] text-white">
      <div className="mx-auto flex h-full min-h-0 w-full max-w-[1600px] flex-col gap-3 px-5 py-4 xl:px-8 xl:py-5">
        <CompactPageHeader
          eyebrow="Campaign Canon"
          title="Release Kit"
          tone="orange"
          actions={
            <>
              <Button variant="outline" size="sm" className="h-9 rounded-full border-white/15 bg-black/15 px-4 text-white/72 backdrop-blur-md hover:bg-white/[0.09] hover:text-white" onClick={() => void window.electronAPI.openReleaseKitFolder(workspaceId)}>
                <FolderOpen className="mr-1.5 h-3.5 w-3.5" /> Folder
              </Button>
              <Button size="sm" className="h-9 rounded-full bg-white/90 px-5 text-black hover:bg-white" onClick={() => { setPrefillOutput(null); setAddOpen(true) }}>
                <Plus className="mr-1.5 h-3.5 w-3.5" /> Add final
              </Button>
            </>
          }
        />

        <div className="flex shrink-0 items-center justify-between border-b border-white/[0.07] px-1 pb-3 pt-1">
          <div className="inline-flex rounded-xl border border-white/[0.07] bg-white/[0.025] p-1 backdrop-blur-md">
            <TabButton active={tab === 'finals'} onClick={() => setTab('finals')}>Finals</TabButton>
            <TabButton active={tab === 'variants'} onClick={() => setTab('variants')}>Variants</TabButton>
            <TabButton active={tab === 'outputs'} onClick={() => setTab('outputs')}>Outputs</TabButton>
          </div>
          <span className="text-xs font-medium text-white/34"><span className="text-white/75">{manifest?.items.filter((item) => item.status === 'ready').length ?? 0}</span> approved</span>
        </div>

        {error ? <div className="rounded-xl border border-red-500/25 bg-red-500/[0.06] px-3 py-2 text-xs text-red-200">{error}</div> : null}

        <main className="min-h-0 flex-1 overflow-y-auto pb-8 pr-1">
          {tab === 'finals' ? (
            <ReleaseKitInspectContext.Provider value={(item) => setSelectedItemId(item.id)}>
              <FinalsGallery
                manifest={manifest}
                visibleCategories={visibleCategories}
                itemPaths={itemPaths}
                workspaceId={workspaceId}
                onChanged={setManifest}
                onAdd={() => setAddOpen(true)}
              />
            </ReleaseKitInspectContext.Provider>
          ) : tab === 'variants' ? (
            <VariantsTab
              outputs={variantOutputs}
              loading={outputsLoading}
              error={outputsError}
              onOpen={onOutputClick}
              onContinue={(output) => void continueVariantSet(output).catch((cause) => toast.error('Could not continue variants', { description: cause instanceof Error ? cause.message : String(cause) }))}
              onCreate={() => {
                setVariantSetupSourceId(null)
                setVariantSetupOpen(true)
              }}
            />
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
      </div>

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
      <ReleaseKitAssetDrawer
        open={Boolean(selectedItem || pendingVariantPromotion)}
        item={selectedItem ?? pendingVariantItem}
        itemPath={selectedItem ? itemPaths[selectedItem.id] : undefined}
        workspaceId={workspaceId}
        initialPostIntent={selectedVariantPostIntent ?? (selectedItem?.socialVariantIntent
          ? { ...selectedItem.socialVariantIntent.destination, variantId: selectedItem.socialVariantIntent.variantId }
          : null)}
        pendingVariantPromotion={pendingVariantPromotion}
        onOpenChange={(open) => { if (!open) { setSelectedItemId(null); setSelectedVariantPostIntent(null); setPendingVariantPromotion(null) } }}
        onChanged={setManifest}
        onCreateVariants={(itemId) => {
          setSelectedItemId(null)
          setVariantSetupSourceId(itemId)
          setVariantSetupOpen(true)
        }}
      />
      <SocialVariantSetupDrawer
        open={variantSetupOpen}
        workspaceId={workspaceId}
        sources={variantSources}
        initialSourceId={variantSetupSourceId ?? undefined}
        onOpenChange={(open) => {
          setVariantSetupOpen(open)
          if (!open) setVariantSetupSourceId(null)
        }}
      />
    </div>
  )
}

function FinalsGallery({ manifest, visibleCategories, itemPaths, workspaceId, onChanged, onAdd }: {
  manifest: ReleaseKitManifest | null
  visibleCategories: ReleaseKitCategory[]
  itemPaths: Record<string, string>
  workspaceId: string
  onChanged: (manifest: ReleaseKitManifest) => void
  onAdd: () => void
}) {
  const itemsFor = (category: ReleaseKitCategory) => manifest?.items.filter((item) => item.category === category) ?? []
  const quieterCategories = visibleCategories.filter((category) => !VISUAL_CATEGORIES.has(category))
  return (
    <div className="mx-auto max-w-[1240px] space-y-4">
      <ReadinessStrip manifest={manifest} />
      <AudioPanel items={itemsFor('audio')} workspaceId={workspaceId} onChanged={onChanged} onAdd={onAdd} />
      <div className="grid items-stretch gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
        <SingleArtPanel items={itemsFor('artwork')} itemPaths={itemPaths} workspaceId={workspaceId} onChanged={onChanged} onAdd={onAdd} />
        <ImagePanel items={itemsFor('images')} itemPaths={itemPaths} workspaceId={workspaceId} onChanged={onChanged} onAdd={onAdd} />
      </div>
      <VideoPanel items={itemsFor('video')} itemPaths={itemPaths} workspaceId={workspaceId} onChanged={onChanged} onAdd={onAdd} />
      {quieterCategories.length ? (
        <div className="grid gap-4 xl:grid-cols-2">
          {quieterCategories.map((category) => (
            <FinalCategory
              key={category}
              category={category}
              items={itemsFor(category)}
              workspaceId={workspaceId}
              onChanged={onChanged}
              onAdd={onAdd}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function ReadinessStrip({ manifest }: { manifest: ReleaseKitManifest | null }) {
  return (
    <div
      className="grid grid-cols-2 overflow-hidden rounded-full bg-[#242426] shadow-minimal sm:grid-cols-5"
      style={{
        backgroundImage: 'radial-gradient(85% 220% at 0% 50%, rgba(249,115,22,0.11) 0%, rgba(249,115,22,0) 70%), radial-gradient(130% 220% at 50% -125%, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 68%)',
      }}
    >
      {(['audio', 'artwork', 'video', 'images', 'plans'] as ReleaseKitCategory[]).map((category) => {
        const ready = manifest?.items.filter((item) => item.category === category && item.status === 'ready').length ?? 0
        return (
          <div key={category} className="flex min-h-6 items-center justify-between bg-[#09090a]/80 px-3 py-1">
            <span className="text-[10px] font-normal text-white/55">{displayCategory(category)}</span>
            {ready ? (
              <span className="inline-flex min-w-5 items-center justify-center gap-1 rounded-full bg-emerald-200/[0.055] px-1 py-0.5 text-[9px] font-medium text-emerald-100/72">
                <span className="h-1 w-1 rounded-full bg-emerald-300/80" />
                {ready}
              </span>
            ) : <span className="h-1 w-1 rounded-full bg-white/14" aria-label="No approved items" />}
          </div>
        )
      })}
    </div>
  )
}

function AudioPanel({ items, workspaceId, onChanged, onAdd }: FinalCategoryProps) {
  const featured = featuredReleaseKitItem(items)
  const openItem = useOpenReleaseKitItem(workspaceId)
  const versionsRef = React.useRef<HTMLDetailsElement>(null)

  React.useEffect(() => {
    const closeVersions = (event: PointerEvent) => {
      const versions = versionsRef.current
      if (!versions?.open || !(event.target instanceof Node) || versions.contains(event.target)) return
      versions.open = false
    }

    document.addEventListener('pointerdown', closeVersions)
    return () => document.removeEventListener('pointerdown', closeVersions)
  }, [])

  return (
    <section className={cn(RELEASE_KIT_SURFACE_CLASS, 'p-3')} style={RELEASE_KIT_SURFACE_STYLE}>
      <ReleaseKitSurfaceGlow />
      <div className="relative flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex shrink-0 items-center gap-2 lg:w-[158px]">
          <CategoryHeaderIcon category="audio" />
          <h2 className="text-[11px] font-medium text-white/90">Final Audio</h2>
          {items.length ? <span className="rounded-md bg-white/[0.07] px-1.5 py-0.5 text-[10px] font-medium text-white/45">{items.length}</span> : null}
        </div>
        {featured ? (
          <div className={cn('flex min-w-0 flex-1 items-center gap-3 rounded-xl border bg-black/25 px-3 py-2', isUnverifiedReleaseKitItem(featured) ? 'border-amber-400/45 ring-1 ring-amber-400/25' : 'border-white/[0.07]')}>
            <button type="button" onClick={() => void openItem(featured)} className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white shadow-tinted transition-transform hover:scale-105', isUnverifiedReleaseKitItem(featured) ? 'bg-white/20' : 'bg-[#f97316]')} title="Open final audio">
              <Play className="ml-0.5 h-3.5 w-3.5 fill-current" />
            </button>
            <button type="button" onClick={() => void openItem(featured)} className="min-w-0 flex-1 text-left">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium text-white/88">{featured.title}</span>
                {shouldShowPrimaryBadge(featured) ? <PrimaryBadge /> : null}
                <StatusBadge item={featured} />
              </div>
              <p className="mt-0.5 truncate text-[11px] text-white/38">{displaySubtype(featured.subtype)} · {displaySource(featured.source)}{featured.sizeBytes ? ` · ${formatFileSize(featured.sizeBytes)}` : ''}</p>
            </button>
            <div className="hidden h-8 items-end gap-[2px] opacity-55 xl:flex" aria-hidden="true">
              {WAVEFORM_HEIGHTS.map((height, index) => <span key={index} className={cn('w-0.5 rounded-full', index < 7 ? 'bg-[#f97316]' : 'bg-white/22')} style={{ height }} />)}
            </div>
            {items.length > 1 ? (
              <details ref={versionsRef} className="group/versions relative shrink-0">
                <summary className="flex h-8 cursor-pointer list-none items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.045] px-2.5 text-[11px] text-white/62 hover:bg-white/[0.07] [&::-webkit-details-marker]:hidden">
                  Versions <span className="text-white/32">{items.length - 1}</span><ChevronDown className="h-3 w-3 transition-transform group-open/versions:rotate-180" />
                </summary>
                <div className="absolute right-0 top-10 z-30 w-72 max-w-[70vw] space-y-1.5 rounded-xl border border-white/[0.1] bg-[#101012]/95 p-2 shadow-modal-small backdrop-blur-xl">
                  {items.filter((item) => item.id !== featured.id).map((item) => <FinalItem key={item.id} item={item} workspaceId={workspaceId} onChanged={onChanged} />)}
                </div>
              </details>
            ) : null}
            <FinalActions item={featured} workspaceId={workspaceId} onChanged={onChanged} />
          </div>
        ) : <VisualEmpty category="audio" label="Add approved audio" onAdd={onAdd} className="min-h-14 flex-1" />}
        <button type="button" onClick={onAdd} aria-label="Add final audio" title="Add final audio" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white/38 transition-colors hover:bg-white/[0.05] hover:text-white/75"><Plus className="h-3.5 w-3.5" /></button>
      </div>
    </section>
  )
}

function SingleArtPanel({ items, itemPaths, workspaceId, onChanged, onAdd }: FinalCategoryProps & { itemPaths: Record<string, string> }) {
  const featured = featuredReleaseKitItem(items)
  const openItem = useOpenReleaseKitItem(workspaceId)
  return (
    <section className={cn(RELEASE_KIT_SURFACE_CLASS, 'h-full p-4')} style={RELEASE_KIT_SURFACE_STYLE}>
      <ReleaseKitSurfaceGlow />
      <div className="relative z-10 flex h-full flex-col">
        <MediaHeader category="artwork" title="Single Art" count={items.length} onAdd={onAdd} />
        {featured ? (
          <>
            <div className={cn('group relative mt-3 aspect-square overflow-hidden rounded-xl border bg-gradient-to-br from-orange-950/80 via-[#171719] to-[#0d0d0f]', releaseKitStatusRingClass(featured))}>
              <button type="button" onClick={() => void openItem(featured)} className="absolute inset-0 h-full w-full text-left" title="Open Single Art">
                {itemPaths[featured.id] ? <img src={thumbnailUrl(itemPaths[featured.id]!)} alt={featured.title} className={cn('h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]', isUnverifiedReleaseKitItem(featured) && 'opacity-45')} /> : <Image className="absolute left-1/2 top-1/2 h-10 w-10 -translate-x-1/2 -translate-y-1/2 text-white/14" />}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent px-4 pb-4 pt-14">
                  <div className="flex items-center gap-2"><span className="truncate text-sm font-medium text-white">{featured.title}</span>{shouldShowPrimaryBadge(featured) ? <PrimaryBadge /> : null}<StatusBadge item={featured} /></div>
                  <p className="mt-1 text-[11px] text-white/48">{featured.sizeBytes ? formatFileSize(featured.sizeBytes) : displaySubtype(featured.subtype)}</p>
                </div>
              </button>
              <div className="absolute right-2 top-2 opacity-60 transition-opacity group-hover:opacity-100"><FinalActions item={featured} workspaceId={workspaceId} onChanged={onChanged} surface /></div>
            </div>
            {items.length > 1 ? <div className="mt-2 space-y-2">{items.filter((item) => item.id !== featured.id).map((item) => <FinalItem key={item.id} item={item} workspaceId={workspaceId} onChanged={onChanged} />)}</div> : null}
          </>
        ) : <VisualEmpty category="artwork" label="Add Single Art" onAdd={onAdd} className="mt-3 aspect-square" />}
      </div>
    </section>
  )
}

function VideoPanel({ items, itemPaths, workspaceId, onChanged, onAdd }: FinalCategoryProps & { itemPaths: Record<string, string> }) {
  const openItem = useOpenReleaseKitItem(workspaceId)
  return (
    <section className={cn(RELEASE_KIT_SURFACE_CLASS, 'p-4')} style={RELEASE_KIT_SURFACE_STYLE}>
      <ReleaseKitSurfaceGlow />
      <div className="relative z-10">
        <MediaHeader category="video" title="Videos" count={items.length} onAdd={onAdd} />
        <div className="mt-3 grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-8">
          {items.map((item) => (
            <div key={item.id} className={cn('group relative aspect-[9/16] overflow-hidden rounded-xl border bg-gradient-to-br from-[#232326] to-[#0b0b0d]', releaseKitStatusRingClass(item))}>
              <button type="button" onClick={() => void openItem(item)} className="absolute inset-0 h-full w-full" title={`Open ${item.title}`}>
                {itemPaths[item.id] ? <img src={thumbnailUrl(itemPaths[item.id]!)} alt={item.title} className={cn('h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]', isUnverifiedReleaseKitItem(item) ? 'opacity-40' : 'opacity-80 group-hover:opacity-95')} /> : null}
                <span className={cn('absolute left-1/2 top-1/2 flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-md transition group-hover:scale-110', !isUnverifiedReleaseKitItem(item) && 'group-hover:bg-[#f97316]')}><Play className="ml-0.5 h-4 w-4 fill-current" /></span>
                <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/65 to-transparent px-3 pb-3 pt-14 text-left">
                  <span className="block truncate text-xs font-medium text-white">{item.title}</span>
                  <span className="mt-1 block text-[10px] text-white/48">{displaySubtype(item.subtype)}</span>
                </span>
              </button>
              {isUnverifiedReleaseKitItem(item) ? <span className="absolute left-1.5 top-1.5 z-10"><StatusBadge item={item} /></span> : null}
              <div className="absolute right-1.5 top-1.5 opacity-0 transition-opacity group-hover:opacity-100"><FinalActions item={item} workspaceId={workspaceId} onChanged={onChanged} surface /></div>
            </div>
          ))}
          <VisualEmpty category="video" label="Upload video" onAdd={onAdd} className="aspect-[9/16]" />
        </div>
      </div>
    </section>
  )
}

function ImagePanel({ items, itemPaths, workspaceId, onChanged, onAdd }: FinalCategoryProps & { itemPaths: Record<string, string> }) {
  const openItem = useOpenReleaseKitItem(workspaceId)
  return (
    <section className={cn(RELEASE_KIT_SURFACE_CLASS, 'h-full min-h-0 p-4')} style={RELEASE_KIT_SURFACE_STYLE}>
      <ReleaseKitSurfaceGlow />
      <div className="relative z-10 flex h-full min-h-0 flex-col">
        <MediaHeader category="images" title="Press & Social Images" count={items.length} onAdd={onAdd} />
        <div className="mt-3 grid min-h-[180px] flex-1 grid-flow-col auto-cols-[minmax(150px,220px)] gap-2.5 overflow-x-auto">
          {items.map((item) => (
            <div key={item.id} className={cn('group relative h-full overflow-hidden rounded-xl border bg-gradient-to-br from-[#242427] to-[#0d0d0f]', releaseKitStatusRingClass(item))}>
              <button type="button" onClick={() => void openItem(item)} className="absolute inset-0 h-full w-full" title={`Open ${item.title}`}>
                {itemPaths[item.id] ? <img src={thumbnailUrl(itemPaths[item.id]!)} alt={item.title} className={cn('h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]', isUnverifiedReleaseKitItem(item) ? 'opacity-40' : 'opacity-80 group-hover:opacity-100')} /> : <Image className="absolute left-1/2 top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2 text-white/12" />}
                <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent px-3 pb-3 pt-10 text-left"><span className="block truncate text-xs font-medium text-white">{item.title}</span></span>
              </button>
              {isUnverifiedReleaseKitItem(item) ? <span className="absolute left-1.5 top-1.5 z-10"><StatusBadge item={item} /></span> : null}
              <div className="absolute right-1.5 top-1.5 opacity-0 transition-opacity group-hover:opacity-100"><FinalActions item={item} workspaceId={workspaceId} onChanged={onChanged} surface /></div>
            </div>
          ))}
          <VisualEmpty category="images" label="Add image" onAdd={onAdd} className="h-full min-h-[180px]" />
        </div>
      </div>
    </section>
  )
}

interface FinalCategoryProps {
  items: ReleaseKitItem[]
  workspaceId: string
  onChanged: (manifest: ReleaseKitManifest) => void
  onAdd: () => void
}

function FinalCategory({ category, items, workspaceId, onChanged, onAdd }: {
  category: ReleaseKitCategory
  items: ReleaseKitItem[]
  workspaceId: string
  onChanged: (manifest: ReleaseKitManifest) => void
  onAdd: () => void
}) {
  return (
    <section className={cn(RELEASE_KIT_SURFACE_CLASS, 'p-5')} style={RELEASE_KIT_SURFACE_STYLE}>
      <ReleaseKitSurfaceGlow />
      <div className="relative z-10 mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CategoryHeaderIcon category={category} />
          <h2 className="text-[11px] font-medium text-white/90">{displayCategory(category)}</h2>
          <span className="text-xs text-white/28">{items.length}</span>
        </div>
        <button type="button" onClick={onAdd} aria-label={`Add ${displayCategory(category)}`} title={`Add ${displayCategory(category)}`} className="flex h-7 w-7 items-center justify-center rounded-lg text-white/38 transition-colors hover:bg-white/[0.05] hover:text-white/75"><Plus className="h-3.5 w-3.5" /></button>
      </div>
      <div className="relative z-10">
        {items.length === 0 ? (
          <button type="button" onClick={onAdd} aria-label={`Add ${displayCategory(category)}`} title={`Add ${displayCategory(category)}`} className="flex h-14 w-full items-center justify-center rounded-xl bg-white/[0.018] text-white/16 transition hover:bg-white/[0.035] hover:text-white/42">
            <CategoryIcon category={category} className="h-4 w-4" />
          </button>
        ) : (
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {items.map((item) => <FinalItem key={item.id} item={item} workspaceId={workspaceId} onChanged={onChanged} />)}
          </div>
        )}
      </div>
    </section>
  )
}

function FinalItem({ item, workspaceId, onChanged }: { item: ReleaseKitItem; workspaceId: string; onChanged: (manifest: ReleaseKitManifest) => void }) {
  const openItem = useOpenReleaseKitItem(workspaceId)
  return (
    <div className={cn('group flex min-w-0 items-center gap-3 rounded-xl border bg-black/20 p-3 hover:bg-white/[0.035]', isUnverifiedReleaseKitItem(item) ? 'border-amber-400/45 ring-1 ring-amber-400/25' : 'border-white/[0.07] hover:border-white/[0.13]')}>
      <button type="button" onClick={() => void openItem(item)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/[0.045] text-white/45 hover:text-white/80" title="Open final">
        <CategoryIcon category={item.category} className="h-4 w-4" />
      </button>
      <button type="button" onClick={() => void openItem(item)} className="min-w-0 flex-1 text-left">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium text-white/82">{item.title}</span>
          {shouldShowPrimaryBadge(item) ? <PrimaryBadge /> : null}
        </div>
        <div className="mt-1 flex items-center gap-1.5 text-[11px] text-white/34">
          <span>{displaySubtype(item.subtype)}</span><span>·</span><span>{displaySource(item.source)}</span>
          {isUnverifiedReleaseKitItem(item) ? <StatusBadge item={item} /> : null}
        </div>
      </button>
      <FinalActions item={item} workspaceId={workspaceId} onChanged={onChanged} />
    </div>
  )
}

function MediaHeader({ category, title, count, onAdd }: { category: ReleaseKitCategory; title: string; count: number; onAdd: () => void }) {
  return (
    <div className="relative z-10 flex items-center justify-between">
      <div className="flex items-center gap-2.5">
        <CategoryHeaderIcon category={category} />
        <h2 className="text-[11px] font-medium text-white/90">{title}</h2>
        {count ? <span className="rounded-md bg-white/[0.07] px-1.5 py-0.5 text-[10px] font-medium text-white/45">{count}</span> : null}
      </div>
      <button type="button" onClick={onAdd} aria-label={`Add ${title}`} title={`Add ${title}`} className="flex h-7 w-7 items-center justify-center rounded-lg text-white/38 transition-colors hover:bg-white/[0.05] hover:text-white/75"><Plus className="h-3.5 w-3.5" /></button>
    </div>
  )
}

function ReleaseKitSurfaceGlow() {
  return (
    <div className="pointer-events-none absolute -inset-10 opacity-0 transition-opacity duration-500 group-hover/release-kit:opacity-100" aria-hidden="true">
      <div className="absolute -inset-12 animate-spin rounded-full bg-gradient-to-r from-transparent via-white/[0.035] to-transparent blur-xl [animation-duration:18s]" />
      <div className="absolute -inset-16 animate-spin rounded-full bg-gradient-to-r from-transparent via-orange-400/[0.022] to-transparent blur-2xl [animation-direction:reverse] [animation-duration:28s]" />
    </div>
  )
}

function VisualEmpty({ category, label, onAdd, className }: { category: ReleaseKitCategory; label: string; onAdd: () => void; className?: string }) {
  return (
    <button type="button" onClick={onAdd} aria-label={label} title={label} className={cn('flex min-h-28 w-full items-center justify-center rounded-xl bg-white/[0.018] text-white/16 transition hover:bg-white/[0.035] hover:text-white/42', className)}>
      <CategoryIcon category={category} className="h-4 w-4" />
    </button>
  )
}

function FinalActions({ item, workspaceId, onChanged, surface = false }: { item: ReleaseKitItem; workspaceId: string; onChanged: (manifest: ReleaseKitManifest) => void; surface?: boolean }) {
  return (
    <div className={cn('flex shrink-0 items-center opacity-55 transition-opacity group-hover:opacity-100', surface && 'rounded-lg bg-black/55 p-0.5 backdrop-blur-md')}>
      {!item.isPrimary && item.status === 'ready' ? (
        <IconButton title="Set Primary" onClick={async () => onChanged(await window.electronAPI.setReleaseKitPrimary(workspaceId, item.id))}><Star className="h-3.5 w-3.5" /></IconButton>
      ) : null}
      <IconButton title="Remove final" danger onClick={async () => {
        if (!window.confirm(`Remove “${item.title}” from the Release Kit? The source file will stay untouched.`)) return
        onChanged(await window.electronAPI.removeFromReleaseKit(workspaceId, item.id))
      }}><Trash2 className="h-3.5 w-3.5" /></IconButton>
    </div>
  )
}

function PrimaryBadge() {
  return <span className="shrink-0 rounded-md bg-[#f97316]/16 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-[#fb923c]">Primary</span>
}

function StatusBadge({ item }: { item: ReleaseKitItem }) {
  if (!isUnverifiedReleaseKitItem(item)) return null
  const label = releaseKitStatusLabel(item)
  return (
    <span
      className="flex shrink-0 items-center gap-1 rounded-md bg-amber-400/16 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-amber-300"
      title={releaseKitStatusExplanation(item)}
    >
      <FileWarning className="h-2.5 w-2.5" aria-hidden="true" />
      {label}
    </span>
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

function VariantsTab({ outputs, loading, error, onOpen, onContinue, onCreate }: {
  outputs: OutputSummaryDTO[]
  loading: boolean
  error: string | null
  onOpen: (id: string) => void
  onContinue: (output: OutputSummaryDTO) => void
  onCreate: () => void
}) {
  if (loading) return <Centered><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading variants</Centered>
  if (error) return <Centered>{error}</Centered>
  if (!outputs.length) return (
    <Centered>
      <div className="flex flex-col items-center gap-3">
        <span>No video variants yet.</span>
        <Button size="sm" className="h-8 bg-[#f97316] px-3 text-xs text-black hover:bg-[#fb923c]" onClick={onCreate}>
          <Scissors className="mr-1.5 h-3.5 w-3.5" />Create variants
        </Button>
      </div>
    </Centered>
  )
  return (
    <div className="mx-auto max-w-[1120px]">
      <div className="mb-3 flex justify-end">
        <Button size="sm" variant="outline" className="h-8 border-white/10 bg-transparent px-3 text-xs text-white/58 hover:bg-white/[0.05] hover:text-white" onClick={onCreate}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />Create variants
        </Button>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {outputs.map((output) => {
        const set = output.socialVariantSetSummary!
        const needsAccount = set.attention?.code === 'account-unavailable'
        const complete = set.readyCount >= set.requestedCount && set.failedCount === 0 && set.requestedCount > 0
        return (
          <article key={output.id} className="rounded-[16px] bg-white/[0.035] p-4 ring-1 ring-white/[0.055]">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-orange-500/[0.09] text-orange-200/75"><Scissors className="h-4 w-4" /></div>
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onOpen(output.id)}>
                <div className="truncate text-sm font-medium text-white/82">{output.title}</div>
                <div className="mt-1 text-xs text-white/38">
                  {set.readyCount} / {set.requestedCount} ready{set.failedCount ? ` · ${set.failedCount} needs attention` : ''} · {set.sourceCount} source{set.sourceCount === 1 ? '' : 's'}
                </div>
              </button>
              <span className={cn(
                'rounded-[6px] px-2 py-1 text-[10px] font-medium',
                complete ? 'bg-emerald-400/10 text-emerald-200/75' : needsAccount ? 'bg-amber-400/10 text-amber-200/80' : 'bg-white/[0.05] text-white/45',
              )}>{complete ? 'Ready' : needsAccount ? 'Needs account' : displayVariantStatus(set.status)}</span>
            </div>
            {set.attention?.message ? <p className="mt-3 line-clamp-2 text-xs leading-5 text-amber-100/48">{set.attention.message}</p> : null}
            <div className="mt-4 flex gap-2">
              <Button size="sm" className="h-8 bg-[#f97316] px-3 text-xs text-black hover:bg-[#fb923c]" onClick={() => onOpen(output.id)}><Play className="mr-1.5 h-3.5 w-3.5" />Review</Button>
              {!complete && set.status !== 'archived' ? <Button size="sm" variant="ghost" className="h-8 px-3 text-xs text-white/55 hover:bg-white/[0.06] hover:text-white" onClick={() => onContinue(output)}>Continue</Button> : null}
            </div>
          </article>
        )
        })}
      </div>
    </div>
  )
}

function displayVariantStatus(status: string): string {
  return status.replace(/-/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase())
}

function ReleaseKitAssetDrawer({ open, item, itemPath, workspaceId, initialPostIntent, pendingVariantPromotion, onOpenChange, onChanged, onCreateVariants }: {
  open: boolean
  item: ReleaseKitItem | null
  itemPath?: string
  workspaceId: string
  initialPostIntent?: SocialVariantPostIntent | null
  pendingVariantPromotion?: PendingVariantPromotion | null
  onOpenChange: (open: boolean) => void
  onChanged: (manifest: ReleaseKitManifest) => void
  onCreateVariants: (itemId: string) => void
}) {
  const { onOpenFile } = useAppShellContext()
  const [mode, setMode] = React.useState<AssetDrawerMode>('details')
  const [uses, setUses] = React.useState<ReleaseKitItemUseSummary[]>([])
  const [profiles, setProfiles] = React.useState<ReleaseKitSocialProfile[]>([])
  const [profileKey, setProfileKey] = React.useState('')
  const [caption, setCaption] = React.useState('')
  const [date, setDate] = React.useState('')
  const [time, setTime] = React.useState('10:00')
  const [notes, setNotes] = React.useState('')
  const [contentRating, setContentRating] = React.useState<ReleaseKitItem['usage']['contentRating']>('unknown')
  const [bestFor, setBestFor] = React.useState<ReleaseKitItem['usage']['bestFor']>([])
  const [restrictions, setRestrictions] = React.useState<ReleaseKitItem['usage']['restrictions']>({ blockedFromUse: false, needsRightsClearance: false, artistLikenessRestricted: false })
  const [busy, setBusy] = React.useState(false)
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  const itemId = item?.id

  const loadUses = React.useCallback(async () => {
    if (!itemId || pendingVariantPromotion) { setUses([]); return }
    setUses(await window.electronAPI.listReleaseKitItemUses(workspaceId, itemId))
  }, [itemId, pendingVariantPromotion, workspaceId])

  React.useEffect(() => {
    if (!open || !item) return
    setMode(initialPostIntent ? 'where' : 'details')
    setNotes(item.usage.notes ?? '')
    setContentRating(item.usage.contentRating)
    setBestFor(item.usage.bestFor)
    setRestrictions(item.usage.restrictions)
    setCaption('')
    setProfileKey('')
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
    setDate(`${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`)
    void loadUses().catch((error) => toast.error('Could not load planned uses', { description: error instanceof Error ? error.message : String(error) }))
  }, [initialPostIntent, item, itemId, loadUses, open])

  React.useEffect(() => {
    if (!open || mode === 'details') return
    let active = true
    void window.electronAPI.listSocialAccounts().then((doctor) => {
      if (!active) return
      setProfiles(doctor.platforms.flatMap((group) => group.profiles.map((profile) => ({
        platform: profile.platform,
        profileId: profile.profile,
        label: `${profile.platform} @${profile.profile}`,
        accountSetId: profile.accountGroup ?? undefined,
        ready: profile.ready || (profile.localSessionExists && Boolean(profile.accountHandle || profile.accountUrl)),
      }))))
    }).catch(() => { if (active) setProfiles([]) })
    return () => { active = false }
  }, [mode, open])

  React.useEffect(() => {
    if (!open || !initialPostIntent?.profileId) return
    const exactProfile = profiles.find((profile) => matchesSocialVariantIntent(profile, initialPostIntent))
    setProfileKey(exactProfile ? socialProfileKey(exactProfile) : '')
  }, [initialPostIntent, open, profiles])

  if (!item) return null
  const selectedProfile = profiles.find((profile) => socialProfileKey(profile) === profileKey)
  const visibleProfiles = initialPostIntent
    ? profiles.filter((profile) => profile.platform === initialPostIntent.platform
      && (!initialPostIntent.profileId || matchesSocialVariantIntent(profile, initialPostIntent)))
    : profiles
  const planned = uses.filter((use) => use.status !== 'done' && use.status !== 'canceled')
  const history = uses.filter((use) => use.status === 'done' || use.status === 'canceled')
  const restrictionMessage = releaseKitScheduleRestriction(item)
  const eligible = (item.category === 'artwork' || item.category === 'images' || item.category === 'video')
    && item.status === 'ready' && !restrictionMessage
  const repurposeRestriction = releaseKitRepurposeRestriction(item, itemPath)

  const saveDetails = async () => {
    setBusy(true)
    try {
      const manifest = await window.electronAPI.updateReleaseKitUsage(workspaceId, item.id, { notes, contentRating, bestFor, restrictions })
      onChanged(manifest)
      toast.success('Asset details saved')
    } catch (error) {
      toast.error('Could not save asset details', { description: error instanceof Error ? error.message : String(error) })
    } finally { setBusy(false) }
  }

  const schedule = async () => {
    if (!selectedProfile || !caption.trim() || !date || !time) return
    if (initialPostIntent?.mode === 'trial') {
      toast.error('Instagram Trial scheduling is not available yet', { description: 'Artist OS will not silently turn a Trial variant into a normal Reel.' })
      return
    }
    setBusy(true)
    let promotedItemId: string | null = null
    try {
      const startAt = new Date(`${date}T${time}:00`).toISOString()
      let scheduledItem = item
      if (pendingVariantPromotion) {
        const promoted = await window.electronAPI.promoteToReleaseKit(workspaceId, {
          source: {
            type: 'output',
            outputId: pendingVariantPromotion.outputId,
            assetId: pendingVariantPromotion.assetId,
            sourceWorkspaceId: pendingVariantPromotion.sourceWorkspaceId,
          },
          category: 'video',
          subtype: 'social-variant',
          title: pendingVariantPromotion.title,
          note: `Social variant ${pendingVariantPromotion.variantId}`,
        })
        promotedItemId = promoted.item.id
        scheduledItem = promoted.item
        onChanged(promoted.manifest)
      }
      await window.electronAPI.authorizeReleaseKitSocial(workspaceId, {
        requestId: `release-kit-${crypto.randomUUID()}`,
        releaseKitItemId: scheduledItem.id,
        platform: selectedProfile.platform,
        profileId: selectedProfile.profileId,
        accountSetId: selectedProfile.accountSetId,
        caption: caption.trim(),
        startAt,
        timezone,
        source: 'release-kit-ui',
      })
      await loadUses()
      setMode('details')
      onOpenChange(false)
      toast.success('Post scheduled')
    } catch (error) {
      if (promotedItemId) {
        try { onChanged(await window.electronAPI.removeFromReleaseKit(workspaceId, promotedItemId)) } catch { /* Authorization remains failed closed; cleanup can be retried manually. */ }
      }
      toast.error('Could not schedule post', { description: error instanceof Error ? error.message : String(error) })
    } finally { setBusy(false) }
  }

  return (
    <Drawer direction="right" open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DrawerContent className="w-[min(480px,94vw)] border-white/[0.07] bg-[#090909] text-white sm:max-w-[480px]">
        <DrawerHeader className="border-b border-white/[0.06]">
          <div className="flex items-center gap-2">
            {mode !== 'details' ? <button type="button" onClick={() => {
              if (mode === 'where' && pendingVariantPromotion) onOpenChange(false)
              else setMode(mode === 'where' ? 'details' : mode === 'post' ? 'where' : 'post')
            }} className="rounded-md p-1 text-white/45 hover:bg-white/[0.06] hover:text-white"><ArrowLeft className="h-4 w-4" /></button> : null}
            <div>
              <DrawerTitle className="text-base text-white/86">{mode === 'details' ? item.title : mode === 'where' ? 'Choose an account' : mode === 'post' ? 'Write the post' : 'Choose when'}</DrawerTitle>
              <DrawerDescription>{mode === 'details' ? `${displaySubtype(item.subtype)}${item.sizeBytes ? ` · ${formatFileSize(item.sizeBytes)}` : ''}` : `Schedule ${item.title}`}</DrawerDescription>
            </div>
          </div>
        </DrawerHeader>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {mode === 'details' ? (
            <div className="space-y-6">
              {(item.category === 'artwork' || item.category === 'images' || item.category === 'video') && itemPath ? (
                <div className="max-h-56 overflow-hidden rounded-lg bg-white/[0.025]"><img src={thumbnailUrl(itemPath)} alt={item.title} className="h-full max-h-56 w-full object-contain" /></div>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {item.category === 'video' ? (
                  <Button variant="outline" className="border-white/10 bg-transparent text-white/65 hover:bg-white/[0.05] hover:text-white" disabled={Boolean(repurposeRestriction) || busy} onClick={() => onCreateVariants(item.id)}><Scissors className="mr-1.5 h-3.5 w-3.5" />Create variants</Button>
                ) : null}
                <Button className="bg-[#f97316] text-black hover:bg-[#fb923c]" disabled={!eligible} onClick={() => setMode('where')}><Send className="mr-1.5 h-3.5 w-3.5" />Schedule social post</Button>
                <Button variant="outline" className="border-white/10 bg-transparent text-white/65" onClick={async () => {
                  const detail = await window.electronAPI.getReleaseKitItem(workspaceId, item.id)
                  onOpenFile(detail.absolutePath)
                }}><ExternalLink className="mr-1.5 h-3.5 w-3.5" />Open file</Button>
              </div>
              {!eligible ? <p className="text-xs text-amber-200/75">{restrictionMessage ?? (item.status !== 'ready' ? releaseKitStatusExplanation(item) : 'Social scheduling supports final images and videos.')}</p> : null}
              {item.category === 'video' && repurposeRestriction && eligible ? <p className="text-xs text-amber-200/75">{repurposeRestriction}</p> : null}

              <DrawerSection title="Details">
                <div className="flex flex-wrap gap-1.5">
                  {(['social', 'ads', 'store', 'press', 'delivery'] as const).map((value) => <button key={value} type="button" onClick={() => setBestFor((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value])} className={cn('rounded-full px-2.5 py-1 text-[11px]', bestFor.includes(value) ? 'bg-orange-500/18 text-orange-200' : 'bg-white/[0.045] text-white/42')}>{displaySubtype(value)}</button>)}
                </div>
                <select value={contentRating} onChange={(event) => setContentRating(event.target.value as ReleaseKitItem['usage']['contentRating'])} className={INPUT_CLASS}><option value="unknown">Content rating unknown</option><option value="clean">Clean</option><option value="explicit">Explicit</option></select>
                <textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={1000} rows={3} placeholder="Notes for agents" className="w-full resize-none rounded-md border border-white/[0.08] bg-white/[0.025] p-3 text-sm text-white/75 outline-none placeholder:text-white/25" />
                <div className="space-y-2 border-t border-white/[0.06] pt-3">
                  <RestrictionToggle label="Block from use" checked={restrictions.blockedFromUse} onChange={(checked) => setRestrictions({ ...restrictions, blockedFromUse: checked })} />
                  <RestrictionToggle label="Needs rights clearance" checked={restrictions.needsRightsClearance} onChange={(checked) => setRestrictions({ ...restrictions, needsRightsClearance: checked })} />
                  <RestrictionToggle label="Artist likeness restricted" checked={restrictions.artistLikenessRestricted} onChange={(checked) => setRestrictions({ ...restrictions, artistLikenessRestricted: checked })} />
                </div>
                <Button size="sm" variant="outline" disabled={busy} className="border-white/10 bg-transparent text-white/65" onClick={() => void saveDetails()}>{busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}Save details</Button>
              </DrawerSection>

              <DrawerSection title="Planned">{planned.length ? planned.map((use) => <AssetUseRow key={use.orderId} use={use} />) : <EmptyDrawerLine>No posts planned.</EmptyDrawerLine>}</DrawerSection>
              <DrawerSection title="History">{history.length ? history.map((use) => <AssetUseRow key={use.orderId} use={use} />) : <EmptyDrawerLine>No posting history.</EmptyDrawerLine>}</DrawerSection>
            </div>
          ) : mode === 'where' ? (
            <div className="divide-y divide-white/[0.06] border-y border-white/[0.06]">
              {initialPostIntent ? <div className="px-2 py-2 text-[11px] text-white/38">Intended for {displaySubtype(initialPostIntent.accountRole)} · {displaySubtype(initialPostIntent.platform)}{initialPostIntent.mode === 'trial' ? ' · Trial' : ''}</div> : null}
              {visibleProfiles.filter((profile) => profile.ready).map((profile) => <button key={socialProfileKey(profile)} type="button" onClick={() => setProfileKey(socialProfileKey(profile))} className={cn('flex w-full items-center justify-between px-2 py-3 text-left', profileKey === socialProfileKey(profile) && 'bg-white/[0.05]')}><span><span className="block text-sm text-white/78">{profile.label}</span><span className="text-xs text-emerald-200/55">Ready</span></span>{profileKey === socialProfileKey(profile) ? <Check className="h-4 w-4 text-orange-300" /> : null}</button>)}
              {!visibleProfiles.some((profile) => profile.ready) ? <EmptyDrawerLine>No ready {initialPostIntent ? displaySubtype(initialPostIntent.platform) : 'social'} accounts.</EmptyDrawerLine> : null}
              {planned.length ? <div className="py-3"><div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-white/30">Already planned</div>{planned.map((use) => <AssetUseRow key={use.orderId} use={use} />)}</div> : null}
              <div className="flex justify-end pt-4"><Button disabled={!selectedProfile} onClick={() => setMode('post')}>Next</Button></div>
            </div>
          ) : mode === 'post' ? (
            <div className="space-y-4">
              <div className="text-xs text-white/42">{selectedProfile?.label}</div>
              <textarea autoFocus value={caption} onChange={(event) => setCaption(event.target.value)} maxLength={5000} rows={7} placeholder="Write the final caption" className="w-full resize-none rounded-md border border-white/[0.1] bg-white/[0.025] p-3 text-sm text-white/82 outline-none placeholder:text-white/25 focus:border-orange-400/45" />
              <div className="flex justify-between text-[11px] text-white/30"><span>Caption must be final before scheduling.</span><span>{caption.length}/5000</span></div>
              <div className="flex justify-end"><Button disabled={!caption.trim()} onClick={() => setMode('when')}>Next</Button></div>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-3"><label className="space-y-1.5 text-xs text-white/42"><span>Date</span><input type="date" value={date} min={new Date().toISOString().slice(0, 10)} onChange={(event) => setDate(event.target.value)} className={INPUT_CLASS} /></label><label className="space-y-1.5 text-xs text-white/42"><span>Time</span><input type="time" value={time} onChange={(event) => setTime(event.target.value)} className={INPUT_CLASS} /></label></div>
              <div className="flex items-center gap-2 text-xs text-white/42"><Clock3 className="h-3.5 w-3.5" />{timezone}</div>
              <div className="space-y-2 border-y border-white/[0.06] py-4 text-sm"><SummaryLine label="Asset" value={item.title} /><SummaryLine label="Account" value={selectedProfile?.label ?? ''} /><SummaryLine label="Caption" value={caption} /><SummaryLine label="When" value={`${date} at ${time} · ${timezone}`} />{initialPostIntent ? <SummaryLine label="Use" value={`${displaySubtype(initialPostIntent.accountRole)}${initialPostIntent.mode === 'trial' ? ' · Instagram Trial' : ''}`} /> : null}</div>
              {initialPostIntent?.mode === 'trial' ? <p className="text-xs text-amber-200/75">Trial was explicitly requested for this variant, but the current publisher cannot guarantee Instagram Trial delivery. Scheduling is blocked instead of silently posting it as a normal Reel.</p> : null}
              <div className="flex justify-end"><Button disabled={busy || !date || !time || initialPostIntent?.mode === 'trial'} className="bg-[#f97316] text-black hover:bg-[#fb923c]" onClick={() => void schedule()}>{busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />}Schedule post</Button></div>
            </div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  )
}

function DrawerSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="space-y-3 border-t border-white/[0.06] pt-4"><h3 className="text-xs font-medium text-white/55">{title}</h3>{children}</section>
}

function RestrictionToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="flex items-center justify-between gap-3 text-xs text-white/55"><span>{label}</span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="accent-[#f97316]" /></label>
}

function AssetUseRow({ use }: { use: ReleaseKitItemUseSummary }) {
  return <div className="flex items-start justify-between gap-3 border-t border-white/[0.05] py-2 first:border-0"><div className="min-w-0"><div className="truncate text-sm text-white/72">{use.title}</div><div className="mt-0.5 text-[11px] text-white/35">{use.platform ? `${use.platform} · ` : ''}{new Date(use.startAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</div>{use.attentionMessage ? <div className="mt-1 text-xs text-orange-200/75">{use.attentionMessage}</div> : null}</div><span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px]', use.status === 'needs-attention' ? 'bg-red-500/12 text-red-200' : use.status === 'done' ? 'bg-emerald-400/10 text-emerald-200' : 'bg-white/[0.05] text-white/45')}>{displaySubtype(use.status)}</span></div>
}

function EmptyDrawerLine({ children }: { children: React.ReactNode }) { return <div className="text-xs text-white/30">{children}</div> }
function SummaryLine({ label, value }: { label: string; value: string }) { return <div className="grid grid-cols-[70px_1fr] gap-3"><span className="text-white/32">{label}</span><span className="break-words text-white/72">{value}</span></div> }

function releaseKitScheduleRestriction(item: ReleaseKitItem): string | undefined {
  if (item.usage.restrictions.blockedFromUse) return 'This final is blocked from use.'
  if (item.usage.restrictions.needsRightsClearance) return 'This final needs rights clearance.'
  if (item.usage.restrictions.artistLikenessRestricted) return 'This final has an artist-likeness restriction.'
  return undefined
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
      const requested = prefillOutput.primaryAssetId
        ? choices.find((choice) => choice.source.type === 'output' && choice.source.assetId === prefillOutput.primaryAssetId)
        : undefined
      if (requested) selectSource(requested)
      else if (choices.length === 1) selectSource(choices[0]!)
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
                  {CATEGORY_ORDER.map((option) => <option key={option} value={option}>{displayCategory(option)}</option>)}
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
  return <button type="button" onClick={onClick} className={cn('rounded-lg px-4 py-1.5 text-xs font-medium transition-colors', active ? 'bg-white/10 text-white shadow-xs' : 'text-white/42 hover:text-white/70')}>{children}</button>
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
  if (category === 'audio') return <AudioWaveform className={className} />
  if (category === 'artwork' || category === 'images') return <Image className={className} />
  if (category === 'video') return <Video className={className} />
  return <File className={className} />
}

function CategoryHeaderIcon({ category }: { category: ReleaseKitCategory }) {
  return (
    <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-red-500/65 to-orange-500/70 text-white shadow-tinted backdrop-blur-md">
      <CategoryIcon category={category} className="h-2.5 w-2.5" />
    </span>
  )
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
  if (source.type === 'output') return `${source.type}:${source.sourceWorkspaceId ?? ''}:${source.outputId}:${source.assetId ?? ''}`
  if (source.type === 'legacy-final') return `${source.type}:${source.outputId}:${source.assetId ?? ''}`
  return `${source.type}:${source.assetId}`
}

function displaySubtype(value: string): string {
  return value.replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function socialProfileKey(profile: { platform: string; profileId?: string; accountSetId?: string }): string {
  return `${profile.platform}/${profile.profileId ?? ''}/${profile.accountSetId ?? ''}`
}

function matchesSocialVariantIntent(
  profile: { platform: string; profileId?: string; accountSetId?: string },
  intent: SocialVariantPostIntent,
): boolean {
  return profile.platform === intent.platform
    && profile.profileId === intent.profileId
    && (!intent.accountSetId || profile.accountSetId === intent.accountSetId)
}

function displayCategory(category: ReleaseKitCategory): string {
  if (category === 'audio') return 'Final Audio'
  if (category === 'artwork') return 'Single Art'
  if (category === 'video') return 'Videos'
  if (category === 'images') return 'Press & Social Images'
  return displaySubtype(category)
}

function displaySource(source: ReleaseKitSource): string {
  if (source.type === 'campaign-asset') return 'Campaign Asset'
  if (source.type === 'vault-asset') return 'HQ Vault'
  if (source.type === 'output' || source.type === 'legacy-final') return 'Output'
  return 'Upload'
}

function useOpenReleaseKitItem(workspaceId: string): (item: ReleaseKitItem) => Promise<void> {
  void workspaceId
  const inspect = React.useContext(ReleaseKitInspectContext)
  return React.useCallback(async (item: ReleaseKitItem) => inspect(item), [inspect])
}


function thumbnailUrl(path: string): string {
  return `thumbnail://thumb/${encodeURIComponent(path)}`
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`
}

const WAVEFORM_HEIGHTS = ['28%', '48%', '72%', '94%', '78%', '58%', '36%', '50%', '82%', '100%', '68%', '42%', '60%', '88%', '54%', '32%', '70%', '46%']

const INPUT_CLASS = 'h-10 w-full rounded-[6px] border border-white/[0.1] bg-[#111114] px-3 text-sm text-white/78 outline-none focus:border-[#f97316]/55'

function pendingVariantAsReleaseKitItem(campaignId: string, pending: PendingVariantPromotion): ReleaseKitItem {
  return {
    id: `pending_${pending.variantId}`,
    campaignId,
    category: 'video',
    subtype: 'social-variant',
    title: pending.title,
    source: { type: 'output', outputId: pending.outputId, assetId: pending.assetId, sourceWorkspaceId: pending.sourceWorkspaceId },
    relativePath: '',
    mimeType: pending.mimeType,
    sizeBytes: pending.sizeBytes,
    sha256: pending.sha256,
    status: 'ready',
    isPrimary: false,
    promotedAt: new Date().toISOString(),
    promotedBy: 'user',
    usage: {
      bestFor: ['social'],
      contentRating: 'unknown',
      restrictions: { blockedFromUse: false, needsRightsClearance: false, artistLikenessRestricted: false },
      updatedAt: new Date().toISOString(),
      updatedBy: 'system',
    },
  }
}
