import * as React from 'react'
import { AlertTriangle, Archive, CalendarClock, CheckCircle2, ExternalLink, Eye, FileText, FileVideo, FolderOpen, PanelTopOpen, Star, MoreHorizontal, MessageSquare } from 'lucide-react'
import { useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useAppShellContext } from '@/context/AppShellContext'
import { useNavigation } from '@/contexts/NavigationContext'
import { routes } from '../../shared/routes'
import { StatusPill } from '@/components/outputs/OutputsListPanel'
import { OutputInlinePreview } from '@/components/outputs/OutputInlinePreview'
import { useOutputs, type OutputAssetDTO, type OutputManifestDTO } from '@/hooks/useOutputs'
import { openDemoVisualSurfaceAtom, openOutputVisualSurfaceAtom } from '@/atoms/visual-surfaces'
import { findVideoProjectAsset } from '@/components/outputs/video-project-output'
import { OutputFinalActionDialog } from '@/components/outputs/OutputFinalActionDialog'
import { schedulingFinalForOutput, releaseKitFinalsForOutput, isAdOutput } from '@/lib/output-finals-actions'
import { outputLibraryStatus } from '@/lib/output-library'
import { setPendingReleaseKitOutput } from '@/lib/release-kit-navigation'
import { isArtistCampaignWorkspace } from '@/lib/artist-workspace'
import type { ReleaseKitItem } from '@craft-agent/shared/release-kit'
import type { VaultKindHint } from '@craft-agent/shared/artist-vault'
import { isXEditorialSlateOutput } from '@craft-agent/shared/x-editorial'

interface Props {
  workspaceId: string
  outputId?: string
  currentCampaignId?: string
  remote?: boolean
}

type OutputsElectronAPI = typeof window.electronAPI & {
  openOutputFile?: (workspaceId: string, outputId: string, assetId?: string) => Promise<void>
  showOutputInFolder?: (workspaceId: string, outputId: string, assetId?: string) => Promise<void>
  applyVisualSurfaceEvent?: (
    workspaceId: string,
    sessionId: string,
    input: { action: 'add_image' | 'add_video' | 'pin_output'; outputId: string },
  ) => Promise<{ ok: boolean; receipt?: string; error?: string }>
  saveOutputAssetToVault?: (workspaceId: string, outputId: string, assetId?: string, options?: { kindHint?: VaultKindHint }) => Promise<{ imported: unknown[]; skipped: Array<{ path: string; reason: string }> }>
}

type ImageOutputVaultKindHint = Extract<VaultKindHint, 'cover-art' | 'artist-photo' | 'face-reference'>

const IMAGE_OUTPUT_VAULT_KIND_OPTIONS: Array<{ value: ImageOutputVaultKindHint; label: string }> = [
  { value: 'cover-art', label: 'Cover Art' },
  { value: 'artist-photo', label: 'Artist Photo' },
  { value: 'face-reference', label: 'Face Reference' },
]

export default function OutputDetailPage({ workspaceId, outputId, currentCampaignId, remote = false }: Props) {
  const { navigate } = useNavigation()
  const { workspaces, activeWorkspaceId, onSelectWorkspace, onCreateSession, onInputChange, getDraft } = useAppShellContext()
  const { getOutput, outputs, promoteToFinal, removeFromFinal } = useOutputs(workspaceId)
  const openOutputVisualSurface = useSetAtom(openOutputVisualSurfaceAtom)
  const openDemoVisualSurface = useSetAtom(openDemoVisualSurfaceAtom)
  const [manifest, setManifest] = React.useState<OutputManifestDTO | null>(null)
  const [detailError, setDetailError] = React.useState<string | null>(null)
  const [vaultDialog, setVaultDialog] = React.useState(false)
  const [continuing, setContinuing] = React.useState(false)
  const [loadedOwner, setLoadedOwner] = React.useState<string | null>(null)
  const [savingToVault, setSavingToVault] = React.useState(false)
  const [imageVaultKindHint, setImageVaultKindHint] = React.useState<ImageOutputVaultKindHint>('cover-art')
  const [finalAction, setFinalAction] = React.useState<'promote' | 'primary' | 'remove' | null>(null)
  const [campaignFinals, setCampaignFinals] = React.useState<ReleaseKitItem[]>([])
  const [pendingSchedule, setPendingSchedule] = React.useState(false)
  const [pendingVariantUse, setPendingVariantUse] = React.useState<{ variantId: string; assetId: string } | null>(null)

  const kitWorkspaceIds = JSON.stringify(workspaces.filter((workspace) =>
    isArtistCampaignWorkspace(workspace) && !remote && !workspaces.find((entry) => entry.id === activeWorkspaceId)?.remoteServer && !workspace.remoteServer && (!currentCampaignId || workspace.id === currentCampaignId)
  ).map((workspace) => workspace.id))
  React.useEffect(() => {
    setCampaignFinals([])
    const ids = JSON.parse(kitWorkspaceIds) as string[]
    let active = true
    let revision = 0
    const refresh = async () => {
      const request = ++revision
      const results = await Promise.allSettled(ids.map((id) => window.electronAPI.getReleaseKit(id)))
      if (active && revision === request) setCampaignFinals(results.flatMap((result) => result.status === 'fulfilled' ? result.value.items : []))
    }
    void refresh()
    const unsubscribe = window.electronAPI.onReleaseKitChanged((id) => { if (ids.includes(id)) void refresh() })
    return () => { active = false; unsubscribe() }
  }, [kitWorkspaceIds])

  React.useEffect(() => {
    let mounted = true
    setManifest(null)
    setLoadedOwner(null)
    setDetailError(null)
    if (!outputId) return
    getOutput(outputId).then((loaded) => {
      if (!mounted) return
      if (!loaded || loaded.id !== outputId || (loaded.workspaceId && loaded.workspaceId !== workspaceId)) {
        setDetailError('This Output could not be loaded. Reopen it from the library.')
        return
      }
      setLoadedOwner(workspaceId)
      setManifest({ ...loaded, workspaceId })
    }).catch((err) => {
      if (mounted) setDetailError(err instanceof Error ? err.message : String(err))
    })
    return () => { mounted = false }
  }, [getOutput, outputId, workspaceId, outputs])

  React.useEffect(() => {
    setImageVaultKindHint('cover-art')
  }, [manifest?.id])

  if (!outputId) {
    return (
      <div className="runneros-glass-route flex h-full items-center justify-center text-sm text-white/48">
        Select an output
      </div>
    )
  }

  if (detailError) {
    return (
      <div className="m-5 flex items-center gap-2 rounded-[14px] border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
        <AlertTriangle className="h-4 w-4" />
        <span>{detailError}</span>
      </div>
    )
  }

  if (!manifest || manifest.id !== outputId || loadedOwner !== workspaceId) {
    return <div className="runneros-glass-route flex h-full items-center justify-center text-sm text-white/50">Loading output</div>
  }

  const primary = manifest.primary ?? manifest.assets.find((asset) => asset.role === 'primary') ?? manifest.assets[0]
  const videoProjectAsset = findVideoProjectAsset(manifest)
  const sessionId = manifest.origin.sessionId
  const canSendToCanvas = manifest.kind === 'image' || manifest.kind === 'video' || manifest.kind === 'model' || Boolean(manifest.socialVariantSet)
  const isFinal = Boolean(manifest.finals?.length)
  const canChooseVaultKind = canChooseImageVaultKind(manifest)
  const isXEditorialSlate = isXEditorialSlateOutput(manifest)
  const scheduleFinal = schedulingFinalForOutput(manifest, currentCampaignId)
  const readySnapshots = campaignFinals.filter((item) => releaseKitFinalsForOutput(manifest, item.campaignId, [item]).length > 0)
  const openScheduleInCampaign = async (campaignId: string, snapshot?: ReleaseKitItem) => {
    try {
      if (manifest.kind === 'image' || manifest.kind === 'video') {
        const assetId = snapshot && (snapshot.source.type === 'output' || snapshot.source.type === 'legacy-final') ? snapshot.source.assetId : scheduleFinal?.assetId
        if (!assetId) throw new Error('Choose an exact Final file before scheduling this Output.')
        if (campaignId !== activeWorkspaceId) await onSelectWorkspace(campaignId)
        setPendingReleaseKitOutput(manifest.id, assetId, {
          releaseKitItemId: snapshot?.id,
          sourceWorkspaceId: manifest.workspaceId ?? workspaceId,
          targetCampaignId: campaignId,
          scheduleFinal: true,
        })
        navigate(routes.view.campaign('release-kit'))
      }
      setPendingSchedule(false)
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Could not open scheduling.')
    }
  }
  const campaignWorkspaces = workspaces.filter(isArtistCampaignWorkspace)
  const openVariantInCampaign = async (campaignId: string, variantId: string, assetId: string) => {
    setPendingReleaseKitOutput(manifest.id, assetId, {
      sourceWorkspaceId: manifest.workspaceId,
      socialVariantId: variantId,
      targetCampaignId: campaignId,
    })
    try {
      if (campaignId !== activeWorkspaceId) await onSelectWorkspace(campaignId)
      navigate(routes.view.campaign('release-kit'))
      setPendingVariantUse(null)
    } catch (switchError) {
      toast.error(switchError instanceof Error ? switchError.message : 'Could not open that campaign.')
    }
  }
  const socialVariantActions = manifest.socialVariantSet ? {
    onUse: (variantId: string) => {
      const variant = manifest.socialVariantSet?.variants.find((candidate) => candidate.id === variantId)
      if (!variant?.assetId) return
      if (currentCampaignId) {
        void openVariantInCampaign(currentCampaignId, variant.id, variant.assetId)
        return
      }
      if (campaignWorkspaces.length === 0) {
        toast.error('Create or open a campaign before using this version.')
        return
      }
      if (campaignWorkspaces.length === 1) {
        void openVariantInCampaign(campaignWorkspaces[0]!.id, variant.id, variant.assetId)
        return
      }
      setPendingVariantUse({ variantId: variant.id, assetId: variant.assetId })
    },
    onArchive: (variantId: string) => void archiveSocialVariant(workspaceId, manifest, variantId, setManifest),
    onRevise: (variantId: string) => void reviseSocialVariant(workspaceId, manifest, variantId, setManifest, navigate),
  } : undefined

  const finished = isFinal || readySnapshots.length > 0
  const status = outputLibraryStatus(manifest, finished)
  const canSchedule = !isXEditorialSlate && (manifest.kind === 'image' || manifest.kind === 'video') && finished
  const makeFinal = async () => {
    if (!currentCampaignId) { setFinalAction('promote'); return }
    try {
      if (activeWorkspaceId !== currentCampaignId) await onSelectWorkspace(currentCampaignId)
      setPendingReleaseKitOutput(manifest.id, undefined, { sourceWorkspaceId: workspaceId, targetCampaignId: currentCampaignId })
      navigate(routes.view.campaign('release-kit'))
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : 'Could not open Release Kit.') }
  }
  const openOwnedRoute = async (route: Parameters<typeof navigate>[0]) => {
    try { if (activeWorkspaceId !== workspaceId) await onSelectWorkspace(workspaceId); navigate(route) }
    catch (cause) { toast.error(cause instanceof Error ? cause.message : 'Could not open workspace.') }
  }
  const continueWithAgent = async () => {
    setContinuing(true)
    try {
      const targetSession = sessionId ?? (await onCreateSession(workspaceId, { name: `Continue: ${manifest.title}` })).id
      const prompt = `Continue working with Output "${manifest.title}" (outputId: ${manifest.id}, workspaceId: ${workspaceId}). `
      const draft = getDraft(targetSession)
      onInputChange(targetSession, draft ? `${draft}\n\n${prompt}` : prompt)
      await onSelectWorkspace(workspaceId)
      navigate(routes.view.allSessions(targetSession))
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : 'Could not open the agent.') }
    finally { setContinuing(false) }
  }

  return (
    <div className="h-full overflow-y-auto bg-[#0d0d0e] text-white">
      <div className="mx-auto max-w-4xl space-y-5 px-5 py-5 sm:px-6">
        <header className="space-y-3 pr-8">
          <div className="flex flex-wrap items-center gap-2 text-xs text-white/45">
            <span>{formatKind(manifest.kind)}</span><span aria-hidden="true">·</span>
            <span>{formatOutputDate(manifest.createdAt)}</span><span aria-hidden="true">·</span>
            <span>{originLabel(manifest)}</span>
          </div>
          <h1 className="break-words text-xl font-semibold leading-snug tracking-tight text-white/95">{manifest.title}</h1>
          {status && <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] ${finished ? 'bg-emerald-400/10 text-emerald-300' : 'bg-white/[0.06] text-white/60'}`}>{status}</span>}
        </header>
        <div className="flex flex-wrap items-center gap-2">
          {canSchedule ? <Button size="sm" className="bg-[#f97316] text-black hover:bg-[#fb923c]" onClick={() => {
            if (!currentCampaignId && !scheduleFinal && readySnapshots.length === 0) { toast.error('Choose one Primary Final before scheduling this Output.'); return }
            if (readySnapshots.length === 1) void openScheduleInCampaign(readySnapshots[0]!.campaignId, readySnapshots[0])
            else if (currentCampaignId && readySnapshots.length === 0) void openScheduleInCampaign(currentCampaignId)
            else setPendingSchedule(true)
          }}><CalendarClock className="mr-1.5 h-3.5 w-3.5" />Schedule Final</Button>
          : !isXEditorialSlate && !finished && <Button size="sm" className="bg-[#f97316] text-black hover:bg-[#fb923c]" onClick={() => void makeFinal()}><CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />Make Final</Button>}
          <Button size="sm" variant="outline" disabled={continuing} className="border-white/10 bg-white/[0.035]" onClick={() => void continueWithAgent()}><MessageSquare className="mr-1.5 h-3.5 w-3.5" />Continue with agent</Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button size="sm" variant="ghost" aria-label="More Output actions"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-48">
              {!isXEditorialSlate && finished && <DropdownMenuItem onSelect={() => void makeFinal()}><CheckCircle2 className="mr-2 h-4 w-4" />{currentCampaignId ? 'Open Release Kit' : 'Make another Final'}</DropdownMenuItem>}
              {!currentCampaignId && isFinal && <><DropdownMenuItem onSelect={() => setFinalAction('primary')}><Star className="mr-2 h-4 w-4" />Set Primary Final</DropdownMenuItem><DropdownMenuItem onSelect={() => setFinalAction('remove')}>Remove from Finals</DropdownMenuItem></>}
              {sessionId && <DropdownMenuItem onSelect={() => focusOutputSurface(workspaceId, manifest, sessionId, openOutputVisualSurface)}><Eye className="mr-2 h-4 w-4" />Focus in session</DropdownMenuItem>}
              {sessionId && canSendToCanvas && <DropdownMenuItem onSelect={() => sendOutputToCanvas(workspaceId, manifest, sessionId, openDemoVisualSurface)}><PanelTopOpen className="mr-2 h-4 w-4" />Open Canvas</DropdownMenuItem>}
              {videoProjectAsset && <DropdownMenuItem onSelect={() => void openOwnedRoute(routes.view.videoStudio(manifest.id))}><FileVideo className="mr-2 h-4 w-4" />Open Video Studio</DropdownMenuItem>}
              {!isXEditorialSlate && primary && <><DropdownMenuSeparator /><DropdownMenuItem disabled={savingToVault} onSelect={() => setVaultDialog(true)}><Archive className="mr-2 h-4 w-4" />Save to Vault</DropdownMenuItem><DropdownMenuItem onSelect={() => openAsset(workspaceId, manifest, primary)}><FileText className="mr-2 h-4 w-4" />Open file</DropdownMenuItem><DropdownMenuItem onSelect={() => showAsset(workspaceId, manifest, primary)}><FolderOpen className="mr-2 h-4 w-4" />Show in folder</DropdownMenuItem></>}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <OutputInlinePreview key={`${workspaceId}:${manifest.id}`} workspaceId={workspaceId} manifest={manifest} primary={primary} socialVariantActions={socialVariantActions} onOpenVideoStudio={() => void openOwnedRoute(routes.view.videoStudio(manifest.id))} />
        {!isXEditorialSlate && manifest.summary?.trim() && <p className="text-sm leading-relaxed text-white/60">{manifest.summary}</p>}
        {!isXEditorialSlate && <details className="border-t border-white/[0.07] pt-3">
          <summary className="cursor-pointer text-xs text-white/45 hover:text-white/75">Files, links and history</summary>
          <div className="mt-4 space-y-5">
            {manifest.assets.length > 0 && <Section title="Files"><div className="divide-y divide-white/[0.05]">{manifest.assets.map((asset) => <button key={asset.id} type="button" onClick={() => openAsset(workspaceId, manifest, asset)} className="flex w-full items-center justify-between gap-3 py-2 text-left text-sm hover:text-white"><span className="min-w-0"><span className="block truncate text-white/75">{asset.label}</span><span className="block truncate text-xs text-white/35">{asset.mimeType ?? 'File'} · {asset.path}</span></span><span className="shrink-0 text-xs text-white/40">{formatBytes(asset.sizeBytes)}</span></button>)}</div></Section>}
            {(manifest.receipts.length > 0 || manifest.links.length > 0) && <Section title="Receipts and links"><div className="space-y-3">{manifest.receipts.map((receipt) => <div key={receipt.id} className="text-sm"><div className="flex items-center justify-between gap-2"><span className="text-white/70">{receipt.provider} · {receipt.action}</span><StatusPill status={receipt.status} /></div><p className="text-xs text-white/40">{receipt.displayText || receipt.externalId || formatOutputDate(receipt.occurredAt)}</p>{receipt.url && <ExternalButton url={receipt.url} />}</div>)}{manifest.links.map((link) => <div key={link.id} className="text-sm text-white/70"><span>{link.label}</span><ExternalButton url={link.url} /></div>)}</div></Section>}
            <Section title="Created by"><KeyValueRows rows={[
              ['Source', manifest.origin.source], ['Workflow', manifest.origin.workflowName ?? manifest.origin.workflowSlug], ['Run', manifest.origin.workflowRunId], ['Step', manifest.origin.stepId], ['Session', manifest.origin.sessionId], ['Agent', manifest.origin.agentName ?? manifest.origin.agentSlug], ['Automation', manifest.origin.automationId],
            ]} />{manifest.origin.workflowRunId && <Button size="sm" variant="ghost" onClick={() => void openOwnedRoute(routes.view.workflowRun(manifest.origin.workflowRunId!))}>Open run</Button>}</Section>
          </div>
        </details>}
      <Dialog open={vaultDialog} onOpenChange={setVaultDialog}><DialogContent className="max-w-sm"><DialogHeader><DialogTitle>Save to Vault</DialogTitle><DialogDescription>Keep this file in your artist library.</DialogDescription></DialogHeader>{canChooseVaultKind && <ImageVaultKindSelect value={imageVaultKindHint} disabled={savingToVault} onChange={setImageVaultKindHint} />}<Button disabled={savingToVault || !primary} onClick={() => { if (primary) void saveOutputToVault(workspaceId, manifest, primary, imageVaultKindHint, setSavingToVault) }}>{savingToVault ? 'Saving…' : 'Save to Vault'}</Button></DialogContent></Dialog>
      {!currentCampaignId ? <OutputFinalActionDialog
        open={Boolean(finalAction)}
        action={finalAction ?? 'promote'}
        output={manifest}
        onOpenChange={(open) => {
          if (!open) setFinalAction(null)
        }}
        promoteToFinal={promoteToFinal}
        removeFromFinal={removeFromFinal}
        currentCampaignId={currentCampaignId}
      /> : null}
      <Dialog open={pendingSchedule} onOpenChange={setPendingSchedule}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Schedule this Final</DialogTitle>
            <DialogDescription>{currentCampaignId ? 'Choose the exact finished version. Then choose its destination and timing.' : 'Choose the campaign for this finished version. Then choose its destination and timing.'} Nothing is sent until you authorize scheduling.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            {readySnapshots.length > 0 ? readySnapshots.map((snapshot) => <Button key={snapshot.id} variant="outline" onClick={() => void openScheduleInCampaign(snapshot.campaignId, snapshot)}>{snapshot.title} · {new Date(snapshot.promotedAt).toLocaleString()}</Button>) : campaignWorkspaces.map((campaign) => <Button key={campaign.id} variant="outline" onClick={() => void openScheduleInCampaign(campaign.id)}>{campaign.name}</Button>)}
            {!currentCampaignId && !campaignWorkspaces.length && <p className="text-sm text-muted-foreground">Create a campaign to schedule this Final. It stays ready for use in HQ.</p>}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(pendingVariantUse)} onOpenChange={(open) => {
        if (!open) setPendingVariantUse(null)
      }}>
        <DialogContent className="max-w-md border-white/[0.09] bg-[#0d0d0e] p-5">
          <DialogHeader>
            <DialogTitle className="text-base text-white">Choose the campaign</DialogTitle>
            <DialogDescription className="text-white/52">
              This version will be added to that campaign's Release Kit, then opened for posting approval.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            {campaignWorkspaces.map((campaign) => (
              <button
                key={campaign.id}
                type="button"
                className="rounded-xl bg-white/[0.045] px-3 py-2.5 text-left text-sm text-white/82 transition-colors hover:bg-white/[0.08] hover:text-white"
                onClick={() => {
                  if (!pendingVariantUse) return
                  void openVariantInCampaign(campaign.id, pendingVariantUse.variantId, pendingVariantUse.assetId)
                }}
              >
                {campaign.name}
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
      </div>
    </div>
  )
}

async function archiveSocialVariant(
  workspaceId: string,
  manifest: OutputManifestDTO,
  variantId: string,
  setManifest: React.Dispatch<React.SetStateAction<OutputManifestDTO | null>>,
): Promise<OutputManifestDTO | null> {
  const revision = manifest.socialVariantSet?.revision
  if (!revision) return null
  try {
    const updated = await window.electronAPI.archiveSocialVariant(workspaceId, {
      outputId: manifest.id,
      expectedRevision: revision,
      variantId,
    })
    setManifest(updated)
    toast.success('Variant archived')
    return updated
  } catch (error) {
    toast.error('Could not archive variant', { description: error instanceof Error ? error.message : String(error) })
    return null
  }
}

async function reviseSocialVariant(
  workspaceId: string,
  manifest: OutputManifestDTO,
  variantId: string,
  setManifest: React.Dispatch<React.SetStateAction<OutputManifestDTO | null>>,
  navigate: (route: ReturnType<typeof routes.view.allSessions>) => void,
): Promise<void> {
  const sessionId = manifest.socialVariantSet?.editorSessionId
  const variant = manifest.socialVariantSet?.variants.find((candidate) => candidate.id === variantId)
  if (!sessionId || !variant) return
  const updated = await archiveSocialVariant(workspaceId, manifest, variantId, setManifest)
  if (!updated?.socialVariantSet) return
  const message = [
    `I want to revise the "${variant.title}" version in Variant Set ${manifest.id}.`,
    `The version to replace is ${variant.id}; the set is now revision ${updated.socialVariantSet.revision}.`,
    'Ask me the small number of questions that would materially improve this revision, then create the new cut. Do not post or schedule it.',
  ].join(' ')
  try {
    await window.electronAPI.sendMessage(sessionId, message)
    navigate(routes.view.allSessions(sessionId))
  } catch (error) {
    toast.error('The variant was archived, but the editor could not be reopened', {
      description: error instanceof Error ? error.message : String(error),
    })
  }
}

function focusOutputSurface(
  workspaceId: string,
  manifest: OutputManifestDTO,
  sessionId: string,
  openOutputVisualSurface: (input: {
    workspaceId: string
    sessionId: string
    outputId: string
    title: string
    kind: OutputManifestDTO['kind']
    createdAt: string
    updatedAt?: string
  }) => void,
) {
  openOutputVisualSurface({
    workspaceId,
    sessionId,
    outputId: manifest.id,
    title: manifest.title,
    kind: manifest.kind,
    createdAt: manifest.createdAt,
    updatedAt: manifest.updatedAt,
  })
}

async function sendOutputToCanvas(
  workspaceId: string,
  manifest: OutputManifestDTO,
  sessionId: string,
  openDemoVisualSurface: (input: { workspaceId: string; sessionId: string }) => void,
) {
  const action = manifest.kind === 'image'
    ? 'add_image'
    : manifest.kind === 'video'
      ? 'add_video'
      : 'pin_output'
  const api = window.electronAPI as OutputsElectronAPI
  if (typeof api.applyVisualSurfaceEvent !== 'function') {
    toast.error('Canvas action is unavailable in this window.')
    return
  }
  try {
    const result = await api.applyVisualSurfaceEvent(workspaceId, sessionId, { action, outputId: manifest.id })
    if (!result.ok) {
      toast.error(result.error ?? 'Could not send output to Canvas.')
      return
    }
    openDemoVisualSurface({ workspaceId, sessionId })
    toast.success(result.receipt ?? 'Sent output to Canvas.')
  } catch (err) {
    toast.error(err instanceof Error ? err.message : String(err))
  }
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-white/82">{title}</h2>
      {children}
    </section>
  )
}


function ExternalButton({ url }: { url: string }) {
  return (
    <Button size="sm" variant="outline" className="mt-2 border-white/[0.08] bg-white/[0.045] text-white/72 hover:bg-white/[0.08] hover:text-white" onClick={() => window.electronAPI.openUrl(url)}>
      <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
      Open link
    </Button>
  )
}

function ImageVaultKindSelect({
  value,
  disabled,
  onChange,
}: {
  value: ImageOutputVaultKindHint
  disabled?: boolean
  onChange: (value: ImageOutputVaultKindHint) => void
}) {
  return (
    <label className="flex h-9 min-w-[11.5rem] items-center gap-2 rounded-md border border-white/[0.08] bg-white/[0.045] px-2 text-xs text-white/55">
      <span className="shrink-0">Vault as</span>
      <select
        aria-label="Vault image type"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as ImageOutputVaultKindHint)}
        className="min-w-0 flex-1 bg-transparent text-sm text-white/78 outline-none disabled:cursor-wait disabled:opacity-60"
      >
        {IMAGE_OUTPUT_VAULT_KIND_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  )
}

function KeyValueRows({ rows }: { rows: Array<[string, unknown]> }) {
  return (
    <div className="grid gap-1 text-sm">
      {rows.filter(([, value]) => value !== undefined && value !== null && value !== '').map(([label, value]) => (
        <div key={label} className="grid grid-cols-[120px_1fr] gap-3">
          <div className="text-white/42">{label}</div>
          <div className="min-w-0 break-words font-mono text-xs text-white/68">{String(value)}</div>
        </div>
      ))}
    </div>
  )
}

function openAsset(workspaceId: string, manifest: OutputManifestDTO, asset: OutputAssetDTO) {
  const electronAPI = window.electronAPI as OutputsElectronAPI
  if (typeof electronAPI.openOutputFile !== 'function') {
    reportActionError(new Error('openOutputFile bridge is unavailable; cannot open asset.'))
    return
  }
  electronAPI.openOutputFile(workspaceId, manifest.id, asset.id).catch(reportActionError)
}

function showAsset(workspaceId: string, manifest: OutputManifestDTO, asset: OutputAssetDTO) {
  const electronAPI = window.electronAPI as OutputsElectronAPI
  if (typeof electronAPI.showOutputInFolder !== 'function') {
    reportActionError(new Error('showOutputInFolder bridge is unavailable; cannot reveal asset.'))
    return
  }
  electronAPI.showOutputInFolder(workspaceId, manifest.id, asset.id).catch(reportActionError)
}

async function saveOutputToVault(
  workspaceId: string,
  manifest: OutputManifestDTO,
  asset: OutputAssetDTO,
  imageKindHint: ImageOutputVaultKindHint,
  setSaving: (saving: boolean) => void,
) {
  const electronAPI = window.electronAPI as OutputsElectronAPI
  if (typeof electronAPI.saveOutputAssetToVault !== 'function') {
    toast.error('Save to Vault is unavailable in this window.')
    return
  }
  setSaving(true)
  try {
    const result = await electronAPI.saveOutputAssetToVault(workspaceId, manifest.id, asset.id, {
      kindHint: vaultKindHintForOutput(manifest, imageKindHint),
    })
    if (result.imported.length > 0) {
      toast.success('Saved to Artist Vault.')
    } else {
      toast.warning(result.skipped[0]?.reason ?? 'Nothing was saved to Artist Vault.')
    }
  } catch (err) {
    reportActionError(err)
  } finally {
    setSaving(false)
  }
}

function vaultKindHintForOutput(manifest: OutputManifestDTO, imageKindHint: ImageOutputVaultKindHint = 'cover-art'): VaultKindHint {
  if (isAdOutput(manifest)) return 'ad-asset'
  if (manifest.kind === 'audio') return 'master-final'
  if (manifest.kind === 'video') return 'raw-footage'
  if (manifest.kind === 'image') return imageKindHint
  return 'any'
}

function canChooseImageVaultKind(manifest: OutputManifestDTO): boolean {
  return manifest.kind === 'image' && !isAdOutput(manifest)
}

function reportActionError(err: unknown) {
  toast.error(err instanceof Error ? err.message : String(err))
}

function formatKind(kind: string): string {
  return kind.replace(/-/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
}

function originLabel(manifest: OutputManifestDTO): string {
  return manifest.origin.workflowName
    ?? manifest.origin.agentName
    ?? manifest.origin.workflowSlug
    ?? manifest.origin.agentSlug
    ?? formatKind(manifest.origin.source)
}

function formatBytes(size?: number): string {
  if (!size) return ''
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function formatOutputDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
