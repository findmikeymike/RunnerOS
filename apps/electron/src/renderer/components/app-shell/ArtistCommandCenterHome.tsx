import * as React from 'react'
import {
  ArrowRight,
  Bot,
  Check,
  CheckCircle2,
  Circle,
  ClipboardCheck,
  Disc3,
  Eye,
  Loader2,
  Megaphone,
  Pencil,
  Play,
  Plus,
  Settings2,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useWorkspaceContext } from '@/hooks/useWorkspaceContext'
import { useAgents } from '@/hooks/useAgents'
import { useWorkflows } from '@/hooks/useWorkflows'
import { useAppShellContext } from '@/context/AppShellContext'
import { openAgentSessionComposer } from '@/lib/run-agent'
import { WorkflowRunInputDialog } from '@/pages/WorkflowRunInputDialog'
import type { MissionAssetKindHint, MissionAssetManifest, WorkflowDTO } from '../../../shared/types'
import {
  ARTIST_PROFILE_CONTEXT_SLUG,
  parseArtistProfileDocResult,
} from '@/lib/artist-profile'
import {
  ARTIST_VOICE_CONTEXT_SLUG,
  parseArtistVoiceDocResult,
} from '@/lib/artist-voice'
import {
  ARTIST_NETWORK_CONTEXT_SLUG,
  artistNetworkMetadata,
  linkNetworkPersonToWorkspace,
  networkPeopleForWorkspace,
  parseArtistNetworkDocResult,
  serializeArtistNetworkBody,
  unlinkNetworkPersonFromWorkspace,
  updateNetworkPerson,
  type ArtistNetwork,
  type ArtistNetworkPerson,
} from '@/lib/artist-network'
import {
  CAMPAIGN_WORKER_CONTEXT_SLUG,
  campaignWorkerContextMetadata,
  getCampaignWorkerReadiness,
  serializeCampaignWorkerContext,
} from '@/lib/campaign-worker-context'
import {
  MISSION_ASSET_CONTEXT_SLUG,
  missionAssetContextMetadata,
  serializeMissionAssetContext,
} from '@/lib/mission-asset-context'
import {
  MISSION_BRIEF_CONTEXT_SLUG,
  emptyMissionBrief,
  parseMissionBriefDoc,
  type MissionBrief,
} from '@/lib/mission-brief'
import {
  RELEASE_BOARD_CONTEXT_SLUG,
  buildReleaseBoardItemActionPrompt,
  buildReleaseBoardWorkflowInputs,
  buildDefaultReleaseBoard,
  getBoardTotals,
  getCategoryProgress,
  getReleaseBoardItemAction,
  mergeReleaseBoardWithAssets,
  parseReleaseBoardDoc,
  releaseBoardMetadata,
  serializeReleaseBoardBody,
  toggleReleaseBoardItem,
  updateReleaseBoardItemStatus,
  type ReleaseBoard,
  type ReleaseBoardCategory,
  type ReleaseBoardItem,
  type ReleaseBoardItemStatus,
} from '@/lib/release-board'
import { MissionBriefDrawer } from './MissionBriefDrawer'

interface ArtistCommandCenterHomeProps {
  workspaceId: string
  artistProfileWorkspaceId?: string
}

function SectionTitle({
  icon: Icon,
  title,
  meta,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  meta?: string
}) {
  return (
    <div className="mb-3 flex items-center justify-between border-b border-white/[0.04] pb-2.5">
      <div className="flex items-center gap-2">
        <Icon className="h-3 w-3 text-white/40" />
        <h3 className="text-[9px] font-medium uppercase tracking-[0.15em] text-white/60">{title}</h3>
      </div>
      {meta ? (
        <span className="text-[8px] font-medium uppercase tracking-widest text-white/30">
          {meta}
        </span>
      ) : null}
    </div>
  )
}

function CommandCard({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <section
      className={cn(
        'rounded-2xl border border-white/[0.04] bg-[#0A0A0A] p-4 shadow-minimal transition-colors hover:bg-white/[0.02]',
        className,
      )}
    >
      {children}
    </section>
  )
}

export function ArtistCommandCenterHome({ workspaceId, artistProfileWorkspaceId }: ArtistCommandCenterHomeProps) {
  const [drawerOpen, setDrawerOpen] = React.useState(false)
  const [assetManifest, setAssetManifest] = React.useState<MissionAssetManifest | null>(null)
  const [assetBusy, setAssetBusy] = React.useState(false)
  const [selectedReleaseCategoryId, setSelectedReleaseCategoryId] = React.useState<ReleaseBoardCategory['id'] | null>(null)
  const [launchingReleaseItemKey, setLaunchingReleaseItemKey] = React.useState<string | null>(null)
  const [pendingReleaseWorkflow, setPendingReleaseWorkflow] = React.useState<{
    workflow: WorkflowDTO
    initialInputs: Record<string, unknown>
  } | null>(null)
  const lastAutoSavedReleaseBoardBody = React.useRef<string | null>(null)
  const lastAutoSavedWorkerContextBody = React.useRef<string | null>(null)
  const { docs, loading, upsert } = useWorkspaceContext(workspaceId)
  const { allAgents } = useAgents(workspaceId)
  const { allWorkflows } = useWorkflows(workspaceId)
  const {
    onCreateSession,
    onInputChange,
    onSendMessage,
    skills = [],
    enabledSources = [],
  } = useAppShellContext()
  const inheritedArtistProfileWorkspaceId = artistProfileWorkspaceId && artistProfileWorkspaceId !== workspaceId
    ? artistProfileWorkspaceId
    : null
  const {
    docs: inheritedArtistProfileDocs,
    loading: inheritedArtistProfileLoading,
    upsert: upsertArtistProfileContext,
  } = useWorkspaceContext(inheritedArtistProfileWorkspaceId)

  const savedMission = React.useMemo(() => {
    const doc = docs.find((item) => item.slug === MISSION_BRIEF_CONTEXT_SLUG)
    return parseMissionBriefDoc(doc)
  }, [docs])
  const artistProfileDocs = inheritedArtistProfileWorkspaceId ? inheritedArtistProfileDocs : docs
  const artistProfile = React.useMemo(
    () => parseArtistProfileDocResult(artistProfileDocs.find((item) => item.slug === ARTIST_PROFILE_CONTEXT_SLUG)).profile,
    [artistProfileDocs],
  )
  const artistVoice = React.useMemo(
    () => parseArtistVoiceDocResult(artistProfileDocs.find((item) => item.slug === ARTIST_VOICE_CONTEXT_SLUG)).voice,
    [artistProfileDocs],
  )
  const artistNetworkResult = React.useMemo(
    () => parseArtistNetworkDocResult(artistProfileDocs.find((item) => item.slug === ARTIST_NETWORK_CONTEXT_SLUG)),
    [artistProfileDocs],
  )
  const artistNetwork = artistNetworkResult.network
  const campaignTeam = React.useMemo(
    () => networkPeopleForWorkspace(artistNetwork.people, workspaceId),
    [artistNetwork.people, workspaceId],
  )

  const [optimisticMission, setOptimisticMission] = React.useState<MissionBrief | null>(null)
  const savedReleaseBoard = React.useMemo(() => {
    const doc = docs.find((item) => item.slug === RELEASE_BOARD_CONTEXT_SLUG)
    return parseReleaseBoardDoc(doc)
  }, [docs])
  const [optimisticReleaseBoard, setOptimisticReleaseBoard] = React.useState<ReleaseBoard | null>(null)
  const [teamPickerOpen, setTeamPickerOpen] = React.useState(false)
  const [editingTeamPerson, setEditingTeamPerson] = React.useState<ArtistNetworkPerson | null>(null)

  React.useEffect(() => {
    if (savedMission) setOptimisticMission(null)
  }, [savedMission])

  React.useEffect(() => {
    if (savedReleaseBoard) setOptimisticReleaseBoard(null)
  }, [savedReleaseBoard])

  const emptyMission = React.useMemo(
    () => emptyMissionBrief(workspaceId || 'workspace'),
    [workspaceId],
  )
  const mission = optimisticMission ?? savedMission ?? emptyMission
  const releaseBoardBase = React.useMemo(
    () => optimisticReleaseBoard ?? savedReleaseBoard ?? buildDefaultReleaseBoard(workspaceId || 'workspace'),
    [optimisticReleaseBoard, savedReleaseBoard, workspaceId],
  )
  const releaseBoard = React.useMemo(() => {
    const merged = mergeReleaseBoardWithAssets(releaseBoardBase, assetManifest)
    return {
      ...merged,
      categories: merged.categories.filter((category) => category.id !== 'team'),
    }
  }, [assetManifest, releaseBoardBase])
  const releaseBoardBody = React.useMemo(
    () => serializeReleaseBoardBody(releaseBoard),
    [releaseBoard],
  )
  const selectedReleaseCategory = React.useMemo(
    () => releaseBoard.categories.find((category) => category.id === selectedReleaseCategoryId) ?? null,
    [releaseBoard.categories, selectedReleaseCategoryId],
  )
  const hasMission = mission.status !== 'empty'
  const workerReadiness = React.useMemo(
    () => getCampaignWorkerReadiness({ mission, artistProfile, assetManifest }),
    [artistProfile, assetManifest, mission],
  )
  const workerContextBody = React.useMemo(
    () => serializeCampaignWorkerContext({ mission, artistProfile, artistVoice, assetManifest }),
    [artistProfile, artistVoice, assetManifest, mission],
  )
  const title = mission.title || 'Untitled Campaign'
  const subtitle = hasMission
    ? mission.goal || mission.mood || 'Campaign brief started. Add more context when ready.'
    : 'Start with a goal, files, or a worker.'
  const focus = mission.timeline || mission.releaseDate || (hasMission ? mission.missionType || 'Campaign active' : 'No brief yet')
  const readinessLabel = hasMission ? `${mission.completeness}% ready` : 'Not started'
  React.useEffect(() => {
    let cancelled = false
    if (!workspaceId) return
    window.electronAPI.getMissionAssetManifest(workspaceId)
      .then((manifest) => {
        if (!cancelled) setAssetManifest(manifest)
      })
      .catch((err) => {
        if (!cancelled) toast.error(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [workspaceId])

  const importAssetPaths = React.useCallback(
    async (filePaths: string[], kindHint: MissionAssetKindHint = 'any') => {
      if (!hasMission) {
        setDrawerOpen(true)
        toast.info('Create the campaign first, then add files.')
        return
      }
      if (filePaths.length === 0) return
      setAssetBusy(true)
      try {
        const result = await window.electronAPI.importMissionAssets(workspaceId, filePaths, { kindHint })
        setAssetManifest(result.manifest)
        await upsert({
          slug: MISSION_ASSET_CONTEXT_SLUG,
          metadata: missionAssetContextMetadata(),
          body: serializeMissionAssetContext(result.manifest),
        })
        const skipped = result.skipped.length ? ` ${result.skipped.length} skipped.` : ''
        if (result.imported.length === 0) {
          toast.warning(`No campaign vault files added.${skipped}`)
          return
        }
        toast.success(`Added ${result.imported.length} campaign vault file${result.imported.length === 1 ? '' : 's'}.${skipped}`)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err))
      } finally {
        setAssetBusy(false)
      }
    },
    [hasMission, upsert, workspaceId],
  )

  const syncMissionAssetContext = React.useCallback(
    async (manifest: MissionAssetManifest) => {
      setAssetManifest(manifest)
      await upsert({
        slug: MISSION_ASSET_CONTEXT_SLUG,
        metadata: missionAssetContextMetadata(),
        body: serializeMissionAssetContext(manifest),
      })
    },
    [upsert],
  )

  const transcribeLyrics = React.useCallback(async () => {
    if (!hasMission) {
      setDrawerOpen(true)
      toast.info('Create the campaign first, then transcribe lyrics.')
      return
    }
    setAssetBusy(true)
    try {
      const result = await window.electronAPI.transcribeMissionAssetLyrics(workspaceId)
      await syncMissionAssetContext(result.manifest)
      if (!result.ok) {
        toast.error(result.error ?? 'Lyrics transcription failed', {
          description: result.blockers?.map((blocker) => blocker.message).join(' '),
        })
        return
      }
      toast.success('Lyrics transcribed. Review and save corrections.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setAssetBusy(false)
    }
  }, [hasMission, syncMissionAssetContext, workspaceId])

  const saveLyrics = React.useCallback(async (lyricsText: string, assetId?: string, sourceAudioAssetId?: string) => {
    if (!lyricsText.trim()) return
    setAssetBusy(true)
    try {
      const result = await window.electronAPI.saveMissionAssetLyrics(workspaceId, {
        lyricsText,
        assetId,
        sourceAudioAssetId,
      })
      await syncMissionAssetContext(result.manifest)
      toast.success('Approved lyrics saved for agents.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setAssetBusy(false)
    }
  }, [syncMissionAssetContext, workspaceId])

  const saveReleaseBoard = React.useCallback(
    async (nextBoard: ReleaseBoard) => {
      setOptimisticReleaseBoard(nextBoard)
      try {
        await upsert({
          slug: RELEASE_BOARD_CONTEXT_SLUG,
          metadata: releaseBoardMetadata(nextBoard),
          body: serializeReleaseBoardBody(nextBoard),
        })
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err))
      }
    },
    [upsert],
  )

  React.useEffect(() => {
    if (!workspaceId || loading) return
    const shouldSeedBoard = !savedReleaseBoard
    const shouldSyncAssetMatches = savedReleaseBoard && releaseBoardBody !== serializeReleaseBoardBody(savedReleaseBoard)
    if (!shouldSeedBoard && !shouldSyncAssetMatches) return
    if (lastAutoSavedReleaseBoardBody.current === releaseBoardBody) return

    lastAutoSavedReleaseBoardBody.current = releaseBoardBody
    void upsert({
      slug: RELEASE_BOARD_CONTEXT_SLUG,
      metadata: releaseBoardMetadata(releaseBoard),
      body: releaseBoardBody,
    }).catch((err) => {
      toast.error(err instanceof Error ? err.message : String(err))
    })
  }, [loading, releaseBoard, releaseBoardBody, savedReleaseBoard, upsert, workspaceId])

  React.useEffect(() => {
    if (!workspaceId || loading || inheritedArtistProfileLoading || !hasMission) return
    if (lastAutoSavedWorkerContextBody.current === workerContextBody) return

    lastAutoSavedWorkerContextBody.current = workerContextBody
    void upsert({
      slug: CAMPAIGN_WORKER_CONTEXT_SLUG,
      metadata: campaignWorkerContextMetadata(workerReadiness),
      body: workerContextBody,
    }).catch((err) => {
      toast.error(err instanceof Error ? err.message : String(err))
    })
  }, [hasMission, inheritedArtistProfileLoading, loading, upsert, workerContextBody, workerReadiness, workspaceId])

  const toggleReleaseItem = React.useCallback(
    (categoryId: ReleaseBoardCategory['id'], itemId: string) => {
      void saveReleaseBoard(toggleReleaseBoardItem(releaseBoard, categoryId, itemId))
    },
    [releaseBoard, saveReleaseBoard],
  )

  const setReleaseItemStatus = React.useCallback(
    (categoryId: ReleaseBoardCategory['id'], itemId: string, status: ReleaseBoardItemStatus) => {
      void saveReleaseBoard(updateReleaseBoardItemStatus(releaseBoard, categoryId, itemId, status))
    },
    [releaseBoard, saveReleaseBoard],
  )

  const launchReleaseItem = React.useCallback(async (
    category: ReleaseBoardCategory,
    item: ReleaseBoardItem,
  ) => {
    const action = getReleaseBoardItemAction(category.id, item.id)
    if (!action) return
    if (!hasMission) {
      setDrawerOpen(true)
      toast.info('Create the campaign first, then start an asset worker.')
      return
    }

    const itemKey = `${category.id}:${item.id}`
    const campaignBrief = buildReleaseBoardItemActionPrompt({
      campaignTitle: mission.title || 'Untitled Campaign',
      categoryLabel: category.label,
      itemLabel: item.label,
      action,
    })
    setLaunchingReleaseItemKey(itemKey)
    try {
      if (action.kind === 'tool') {
        if (action.targetSlug !== 'transcribe-lyrics') {
          throw new Error(`${action.targetName} is not available.`)
        }
        await transcribeLyrics()
        return
      }
      if (action.kind === 'workflow') {
        const workflow = allWorkflows.find((candidate) => candidate.slug === action.targetSlug)
          ?? await window.electronAPI.getWorkflow(action.targetSlug)
        if (!workflow) {
          throw new Error(`${action.targetName} is not installed in the workflow library.`)
        }
        setSelectedReleaseCategoryId(null)
        setPendingReleaseWorkflow({
          workflow,
          initialInputs: buildReleaseBoardWorkflowInputs(action, campaignBrief),
        })
        return
      } else {
        const agent = allAgents.find((candidate) => candidate.slug === action.targetSlug)
          ?? (await window.electronAPI.listAllAgentDefinitions())
            .find((candidate) => candidate.slug === action.targetSlug)
        if (!agent) {
          throw new Error(`${action.targetName} is not installed in the worker library.`)
        }
        await openAgentSessionComposer({
          agent,
          workspaceId,
          onCreateSession,
          onInputChange,
          onSendMessage,
          skills,
          sources: enabledSources,
          draftInput: campaignBrief,
          autoSendDraft: true,
        })
      }
      toast.success(`${action.targetName} started`, {
        description: `Creating ${item.label.toLowerCase()} for this campaign.`,
      })
    } catch (err) {
      toast.error(`Could not start ${action.targetName}`, {
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setLaunchingReleaseItemKey(null)
    }
  }, [
    allAgents,
    allWorkflows,
    enabledSources,
    hasMission,
    mission.title,
    onCreateSession,
    onInputChange,
    onSendMessage,
    skills,
    transcribeLyrics,
    workspaceId,
  ])

  const saveArtistNetwork = React.useCallback(async (nextNetwork: ArtistNetwork) => {
    if (!inheritedArtistProfileWorkspaceId) {
      toast.error('No Artist HQ workspace found for Network.')
      return
    }
    if (!artistNetworkResult.ok) {
      toast.error(`${artistNetworkResult.error} Open HQ Network to recover it before saving.`)
      return
    }
    await upsertArtistProfileContext({
      slug: ARTIST_NETWORK_CONTEXT_SLUG,
      metadata: artistNetworkMetadata(),
      body: serializeArtistNetworkBody(nextNetwork),
    })
  }, [artistNetworkResult, inheritedArtistProfileWorkspaceId, upsertArtistProfileContext])

  const toggleCampaignTeamPerson = React.useCallback(async (person: ArtistNetworkPerson) => {
    const linked = person.workspaceLinks.some((link) => link.workspaceId === workspaceId)
    const nextPeople = artistNetwork.people.map((item) => {
      if (item.id !== person.id) return item
      return linked
        ? unlinkNetworkPersonFromWorkspace(item, workspaceId)
        : linkNetworkPersonToWorkspace(item, {
            workspaceId,
            workspaceName: mission.title || 'Campaign',
            role: item.canHelpWith || item.role || undefined,
          })
    })
    try {
      await saveArtistNetwork({
        version: 1,
        categories: artistNetwork.categories,
        people: nextPeople,
        updatedAt: new Date().toISOString(),
      })
      toast.success(linked ? 'Removed from release team' : 'Added to release team')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }, [artistNetwork.categories, artistNetwork.people, mission.title, saveArtistNetwork, workspaceId])

  const removeCampaignTeamPerson = React.useCallback(async (person: ArtistNetworkPerson) => {
    try {
      await saveArtistNetwork({
        version: 1,
        categories: artistNetwork.categories,
        people: artistNetwork.people.map((item) => (
          item.id === person.id ? unlinkNetworkPersonFromWorkspace(item, workspaceId) : item
        )),
        updatedAt: new Date().toISOString(),
      })
      toast.success('Removed from release team')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }, [artistNetwork.categories, artistNetwork.people, saveArtistNetwork, workspaceId])

  const updateCampaignTeamPerson = React.useCallback(async (person: ArtistNetworkPerson, input: { name: string; canHelpWith: string }) => {
    const name = input.name.replace(/\s+/g, ' ').trim()
    if (!name) {
      toast.error('Name is required.')
      return
    }
    try {
      await saveArtistNetwork({
        version: 1,
        categories: artistNetwork.categories,
        people: artistNetwork.people.map((item) => (
          item.id === person.id
            ? updateNetworkPerson(item, {
                name,
                category: item.category,
                role: item.role,
                contact: item.contact,
                notes: item.notes,
                canHelpWith: input.canHelpWith,
                tags: item.tags.join(', '),
              })
            : item
        )),
        updatedAt: new Date().toISOString(),
      })
      setEditingTeamPerson(null)
      toast.success('Team member updated')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }, [artistNetwork.categories, artistNetwork.people, saveArtistNetwork])

  const chooseAndImport = React.useCallback(
    async (kindHint: MissionAssetKindHint = 'any') => {
      if (!hasMission) {
        setDrawerOpen(true)
        toast.info('Create the campaign first, then add files.')
        return
      }
      setAssetBusy(true)
      try {
        const filePaths = await window.electronAPI.chooseMissionAssetFiles(workspaceId, kindHint)
        await importAssetPaths(filePaths, kindHint)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err))
      } finally {
        setAssetBusy(false)
      }
    },
    [hasMission, importAssetPaths, workspaceId],
  )

  return (
    <div className="h-full overflow-y-auto bg-[#050505] text-foreground">
      <div className="flex min-h-full w-full flex-col gap-3 px-5 py-4 xl:px-8 xl:py-5">
        <section className="relative min-h-[230px] overflow-hidden rounded-[24px] border border-white/[0.05] bg-[#0A0A0A]">
          <div className="absolute -left-[20%] -top-[40%] h-[600px] w-[600px] rounded-full bg-orange-600/10 blur-[120px]" />
          <div className="absolute -bottom-[40%] -right-[10%] h-[600px] w-[600px] rounded-full bg-indigo-600/5 blur-[120px]" />

          <div className="relative z-10 flex min-h-[230px] flex-col justify-between p-6 lg:p-8">
            <div className="flex items-start justify-between gap-4">
              <div className="inline-flex items-center gap-2.5 rounded-full border border-white/[0.05] bg-white/[0.02] px-3 py-1.5 pr-4 backdrop-blur-md">
                <span className={cn('flex h-2 w-2 items-center justify-center rounded-full', hasMission ? 'bg-emerald-500/20' : 'bg-white/10')}>
                  <span className={cn('h-1.5 w-1.5 rounded-full', hasMission ? 'bg-emerald-500' : 'bg-white/35')} />
                </span>
                <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-white/70">
                  {hasMission ? 'Campaign Active' : 'Campaign Empty'}
                </span>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-white/40">Focus</p>
                <p className="mt-1.5 text-xs font-medium capitalize text-white/70">{focus}</p>
              </div>
            </div>

            <div className="my-5 max-w-[760px]">
              <h1 className="text-4xl font-medium tracking-tighter text-white/90 sm:text-5xl md:text-6xl lg:text-[56px] lg:leading-[0.94]">
                {title}
              </h1>
              <p className="mt-3 max-w-2xl text-sm font-light leading-relaxed text-white/50">
                {subtitle}
              </p>
            </div>

            <div className="flex flex-col gap-4 border-t border-white/[0.05] pt-4 md:flex-row md:items-end md:justify-between">
              <div className="flex w-full max-w-2xl flex-col gap-4 md:flex-row md:items-end md:gap-8">
                <div className="shrink-0">
                  <p className="mb-1 text-[9px] font-medium uppercase tracking-[0.18em] text-white/35">Brief</p>
                  <div className="inline-flex items-center gap-2 rounded-full bg-white/[0.035] px-2.5 py-1">
                    <span className={cn('h-1.5 w-1.5 rounded-full', hasMission ? 'bg-emerald-400/80' : 'bg-white/30')} />
                    <span className="text-[10px] font-medium text-white/55">{readinessLabel}</span>
                  </div>
                </div>
              </div>

              <div className="flex shrink-0 flex-wrap gap-2.5">
                <button
                  type="button"
                  onClick={() => setDrawerOpen(true)}
                  className="inline-flex h-9 items-center gap-2 rounded-full bg-white/90 px-5 text-xs font-medium text-black transition-transform hover:scale-[1.02] active:scale-95"
                >
                  {hasMission ? 'Edit Campaign' : 'Create Campaign'}
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        </section>

        <ReleaseBoardRow
          board={releaseBoard}
          onSelectCategory={setSelectedReleaseCategoryId}
        />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <TeamCard
            people={campaignTeam}
            networkPeople={artistNetwork.people}
            disabled={!artistNetworkResult.ok || !inheritedArtistProfileWorkspaceId}
            onOpenPicker={() => setTeamPickerOpen(true)}
            onEditPerson={setEditingTeamPerson}
            onRemovePerson={removeCampaignTeamPerson}
          />

          <CommandCard>
            <SectionTitle icon={Bot} title="Active Workers" meta="Quiet" />

            <div className="rounded-xl border border-white/[0.03] bg-white/[0.012] p-4">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-4 w-4 text-white/32" />
                <div>
                  <p className="text-sm font-medium text-white/75">No background workers running</p>
                  <p className="mt-1 text-xs leading-5 text-white/38">
                    Once a campaign workflow starts, worker runs and handoffs can appear here.
                  </p>
                </div>
              </div>
            </div>
          </CommandCard>

          <CommandCard>
            <SectionTitle icon={ShieldCheck} title="Approvals" meta="None" />
            <EmptyCardLine
              title="No pending approvals"
              detail={hasMission ? 'Approvals will appear when workflows create review points.' : 'Create a campaign before approval workflows matter.'}
            />
          </CommandCard>
        </div>
      </div>

      <MissionBriefDrawer
        open={drawerOpen}
        workspaceId={workspaceId}
        mission={mission}
        onOpenChange={setDrawerOpen}
        onSaved={setOptimisticMission}
        saveMissionBrief={upsert}
        assetManifest={assetManifest}
        assetBusy={assetBusy}
        releaseBoard={releaseBoard}
        onAddAsset={chooseAndImport}
        onImportAssetPaths={importAssetPaths}
        onTranscribeLyrics={transcribeLyrics}
        onSaveLyrics={saveLyrics}
        onOpenAssetsFolder={async () => {
          if (!hasMission) {
            setDrawerOpen(true)
            toast.info('Create the campaign first, then open the vault folder.')
            return
          }
          try {
            const opened = await window.electronAPI.openMissionAssetsFolder(workspaceId)
            if (!opened) toast.error('Could not open campaign vault folder.')
          } catch (err) {
            toast.error(err instanceof Error ? err.message : String(err))
          }
        }}
      />

      <ReleaseBoardDialog
        category={selectedReleaseCategory}
        launchingItemKey={launchingReleaseItemKey}
        onOpenChange={(open) => {
          if (!open) setSelectedReleaseCategoryId(null)
        }}
        onLaunchItem={launchReleaseItem}
        onSetItemStatus={setReleaseItemStatus}
        onToggleItem={toggleReleaseItem}
      />

      {pendingReleaseWorkflow ? (
        <WorkflowRunInputDialog
          open
          onOpenChange={(open) => {
            if (!open) setPendingReleaseWorkflow(null)
          }}
          workflow={pendingReleaseWorkflow.workflow}
          workspaceId={workspaceId}
          initialInputs={pendingReleaseWorkflow.initialInputs}
        />
      ) : null}

      <TeamPickerDialog
        open={teamPickerOpen}
        people={artistNetwork.people}
        campaignPeople={campaignTeam}
        disabled={!artistNetworkResult.ok || !inheritedArtistProfileWorkspaceId}
        onOpenChange={setTeamPickerOpen}
        onTogglePerson={toggleCampaignTeamPerson}
      />

      <TeamPersonEditDialog
        person={editingTeamPerson}
        onOpenChange={(open) => {
          if (!open) setEditingTeamPerson(null)
        }}
        onSave={updateCampaignTeamPerson}
        onRemove={removeCampaignTeamPerson}
      />
    </div>
  )
}

const releaseCategoryIcons: Record<ReleaseBoardCategory['id'], React.ComponentType<{ className?: string }>> = {
  music: Disc3,
  visuals: Eye,
  setup: Settings2,
  content: ClipboardCheck,
  promotion: Megaphone,
  team: CheckCircle2,
}

function ReleaseBoardRow({
  board,
  onSelectCategory,
}: {
  board: ReleaseBoard
  onSelectCategory: (categoryId: ReleaseBoardCategory['id']) => void
}) {
  const totals = getBoardTotals(board)
  const percentComplete = totals.total > 0 ? Math.round((totals.done / totals.total) * 100) : 0

  return (
    <CommandCard className="p-5">
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div>
            <h2 className="text-sm font-medium tracking-wide text-white/90">Release Board</h2>
            <p className="mt-0.5 text-[11px] text-white/40">{totals.done} of {totals.total} handled</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[11px] font-medium text-emerald-300/80">{percentComplete}%</span>
          <div className="h-px w-28 overflow-hidden bg-white/[0.08]">
            <div className="h-full bg-emerald-400 transition-all duration-500" style={{ width: `${percentComplete}%` }} />
          </div>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {board.categories.map((category) => (
          <ReleaseBoardTile
            key={category.id}
            category={category}
            onClick={() => onSelectCategory(category.id)}
          />
        ))}
      </div>
    </CommandCard>
  )
}

function ReleaseBoardTile({
  category,
  onClick,
}: {
  category: ReleaseBoardCategory
  onClick: () => void
}) {
  const Icon = releaseCategoryIcons[category.id] || CheckCircle2
  const progress = getCategoryProgress(category)
  const allDone = progress.total > 0 && progress.done === progress.total

  return (
    <button
      type="button"
      onClick={onClick}
      className="group rounded-xl px-2 py-2 text-left transition-colors hover:bg-white/[0.025]"
    >
      <div className="flex min-h-[68px] flex-col justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <Icon className={cn('h-4 w-4', allDone ? 'text-emerald-300/80' : 'text-white/38 group-hover:text-white/62')} />
            <p className={cn(
              'text-sm font-medium transition-colors',
              allDone ? 'text-white/88' : 'text-white/72 group-hover:text-white/88',
            )}>
              {category.label}
            </p>
          </div>
        </div>

        <div>
          <div className="mb-2 h-px overflow-hidden bg-white/[0.08]">
            <div
              className={cn('h-full transition-all duration-300', allDone ? 'bg-emerald-300/80' : 'bg-emerald-400/70')}
              style={{ width: `${progress.total > 0 ? (progress.done / progress.total) * 100 : 0}%` }}
            />
          </div>
          <p className="text-[10px] text-white/30">
            {progress.done}/{progress.total}
          </p>
        </div>
      </div>
    </button>
  )
}

function ReleaseBoardDialog({
  category,
  launchingItemKey,
  onOpenChange,
  onLaunchItem,
  onSetItemStatus,
  onToggleItem,
}: {
  category: ReleaseBoardCategory | null
  launchingItemKey: string | null
  onOpenChange: (open: boolean) => void
  onLaunchItem: (category: ReleaseBoardCategory, item: ReleaseBoardItem) => void
  onSetItemStatus: (
    categoryId: ReleaseBoardCategory['id'],
    itemId: string,
    status: ReleaseBoardItemStatus,
  ) => void
  onToggleItem: (categoryId: ReleaseBoardCategory['id'], itemId: string) => void
}) {
  const Icon = category ? releaseCategoryIcons[category.id] : CheckCircle2
  const progress = category ? getCategoryProgress(category) : { done: 0, total: 0 }

  return (
    <Dialog open={Boolean(category)} onOpenChange={onOpenChange}>
      <DialogContent className="border-white/[0.08] bg-[#070707] text-white shadow-modal-small sm:max-w-[560px]">
        {category ? (
          <>
            <DialogHeader className="pr-8">
              <div className="mb-1 flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-full border border-white/[0.06] bg-white/[0.025]">
                  <Icon className="h-4 w-4 text-white/58" />
                </span>
                <div>
                  <DialogTitle className="text-base font-medium text-white/88">{category.label}</DialogTitle>
                  <DialogDescription className="mt-1 text-xs text-white/38">
                    {progress.done}/{progress.total} handled
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
              {category.items.map((item) => {
                const done = item.status === 'done'
                const skipped = item.status === 'skipped'
                const action = getReleaseBoardItemAction(category.id, item.id)
                const itemKey = `${category.id}:${item.id}`
                const launching = launchingItemKey === itemKey
                return (
                  <div
                    key={item.id}
                    className="flex items-center gap-3 rounded-xl border border-white/[0.045] bg-white/[0.012] px-3 py-3"
                  >
                    <button
                      type="button"
                      onClick={() => onToggleItem(category.id, item.id)}
                      aria-label={
                        skipped
                          ? `Restore ${item.label} as needed`
                          : done
                            ? `Mark ${item.label} as needed`
                            : `Mark ${item.label} as done`
                      }
                      className={cn(
                        'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-colors',
                        done
                          ? 'border-emerald-400/30 bg-emerald-400/14 text-emerald-300'
                          : skipped
                            ? 'border-white/[0.07] bg-white/[0.012] text-white/24'
                          : 'border-white/[0.10] bg-white/[0.018] text-white/28 hover:border-white/20 hover:text-white/60',
                      )}
                    >
                      {done ? (
                        <Check className="h-3.5 w-3.5" />
                      ) : skipped ? (
                        <X className="h-3.5 w-3.5" />
                      ) : (
                        <Circle className="h-3.5 w-3.5" />
                      )}
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className={cn('truncate text-sm font-medium', done ? 'text-white/78' : 'text-white/84')}>
                        {item.label}
                      </p>
                      {item.linkedAssetId ? (
                        <p className="mt-0.5 truncate text-[10px] text-emerald-300/48">Matched from campaign vault</p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => onSetItemStatus(category.id, item.id, skipped ? 'needed' : 'skipped')}
                      title={skipped ? 'Restore this task' : 'Mark this task not applicable'}
                      aria-label={skipped ? `Restore ${item.label}` : `Mark ${item.label} not applicable`}
                      className={cn(
                        'shrink-0 rounded-full px-2 py-1 text-[9px] font-medium uppercase tracking-[0.14em] transition-colors hover:bg-white/[0.07] hover:text-white/60',
                        done
                          ? 'bg-emerald-400/10 text-emerald-300/75'
                          : skipped
                            ? 'bg-white/[0.025] text-white/22'
                            : 'bg-white/[0.035] text-white/32',
                      )}
                    >
                      {done ? 'Done' : skipped ? 'N/A' : 'Needed'}
                    </button>
                    {action ? (
                      <button
                        type="button"
                        onClick={() => onLaunchItem(category, item)}
                        disabled={launchingItemKey !== null}
                        title={`Create with ${action.targetName}`}
                        aria-label={`Create ${item.label} with ${action.targetName}`}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-orange-300/15 bg-orange-400/[0.08] text-orange-200/80 transition-colors hover:border-orange-300/30 hover:bg-orange-400/[0.14] hover:text-orange-100 disabled:cursor-wait disabled:opacity-40"
                      >
                        {launching ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Play className="h-3.5 w-3.5 fill-current" />
                        )}
                      </button>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function EmptyCardLine({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-xl border border-white/[0.03] bg-white/[0.012] p-4">
      <p className="text-sm font-medium text-white/76">{title}</p>
      <p className="mt-1 text-xs leading-5 text-white/36">{detail}</p>
    </div>
  )
}

function TeamCard({
  people,
  networkPeople,
  disabled,
  onOpenPicker,
  onEditPerson,
  onRemovePerson,
}: {
  people: ArtistNetworkPerson[]
  networkPeople: ArtistNetworkPerson[]
  disabled: boolean
  onOpenPicker: () => void
  onEditPerson: (person: ArtistNetworkPerson) => void
  onRemovePerson: (person: ArtistNetworkPerson) => void
}) {
  return (
    <CommandCard>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="h-3 w-3 text-white/40" />
          <h3 className="text-[9px] font-medium uppercase tracking-[0.15em] text-white/60">Team</h3>
        </div>
        <button
          type="button"
          onClick={onOpenPicker}
          disabled={disabled}
          aria-label="Add people from Network"
          className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/[0.06] bg-white/[0.035] text-white/58 hover:bg-white/[0.07] hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      {people.length === 0 ? (
        <EmptyCardLine
          title="No release team yet"
          detail={networkPeople.length > 0 ? 'Add people from HQ Network who are helping with this release.' : 'Add people in HQ Network, then tag them to this release.'}
        />
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {people.slice(0, 8).map((person) => (
            <span
              key={person.id}
              className="group inline-flex max-w-full items-center gap-1 rounded-full border border-orange-300/15 bg-orange-500/14 px-2 py-1 text-[11px] font-medium text-orange-100/86"
              title={person.canHelpWith || person.role || person.contact || 'Release helper'}
            >
              <span className="max-w-[150px] truncate">{person.name}</span>
              <button
                type="button"
                onClick={() => onEditPerson(person)}
                className="inline-flex h-4 w-4 items-center justify-center rounded-full text-orange-100/45 opacity-70 transition hover:bg-black/20 hover:text-orange-50 group-hover:opacity-100"
                aria-label={`Edit ${person.name}`}
              >
                <Pencil className="h-2.5 w-2.5" />
              </button>
              <button
                type="button"
                onClick={() => onRemovePerson(person)}
                className="inline-flex h-4 w-4 items-center justify-center rounded-full text-orange-100/35 opacity-70 transition hover:bg-black/20 hover:text-red-200 group-hover:opacity-100"
                aria-label={`Remove ${person.name} from campaign team`}
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
          {people.length > 8 ? (
            <span className="inline-flex items-center rounded-full bg-white/[0.035] px-2 py-1 text-[11px] font-medium text-white/36">
              +{people.length - 8}
            </span>
          ) : null}
        </div>
      )}
    </CommandCard>
  )
}

function TeamPersonEditDialog({
  person,
  onOpenChange,
  onSave,
  onRemove,
}: {
  person: ArtistNetworkPerson | null
  onOpenChange: (open: boolean) => void
  onSave: (person: ArtistNetworkPerson, input: { name: string; canHelpWith: string }) => void
  onRemove: (person: ArtistNetworkPerson) => void
}) {
  const [name, setName] = React.useState('')
  const [canHelpWith, setCanHelpWith] = React.useState('')

  React.useEffect(() => {
    setName(person?.name ?? '')
    setCanHelpWith(person?.canHelpWith || person?.role || '')
  }, [person])

  return (
    <Dialog open={Boolean(person)} onOpenChange={onOpenChange}>
      <DialogContent className="border-white/[0.08] bg-[#070707] text-white shadow-modal-small sm:max-w-[420px]">
        {person ? (
          <>
            <DialogHeader className="pr-8">
              <DialogTitle className="text-base font-medium text-white/88">Edit Team Member</DialogTitle>
              <DialogDescription className="text-xs text-white/38">
                Updates this person in HQ Network and this campaign team.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-3">
              <label className="grid gap-1.5">
                <span className="text-[9px] font-medium uppercase tracking-[0.18em] text-white/32">Name</span>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="h-9 rounded-lg border border-white/[0.07] bg-white/[0.025] px-3 text-sm text-white/82 outline-none placeholder:text-white/24 focus:border-orange-300/45"
                  placeholder="Name"
                />
              </label>
              <label className="grid gap-1.5">
                <span className="text-[9px] font-medium uppercase tracking-[0.18em] text-white/32">Helps With</span>
                <input
                  value={canHelpWith}
                  onChange={(event) => setCanHelpWith(event.target.value)}
                  className="h-9 rounded-lg border border-white/[0.07] bg-white/[0.025] px-3 text-sm text-white/82 outline-none placeholder:text-white/24 focus:border-orange-300/45"
                  placeholder="Song placement, PR, approvals..."
                />
              </label>
            </div>

            <div className="flex items-center justify-between gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  onRemove(person)
                  onOpenChange(false)
                }}
                className="inline-flex h-9 items-center gap-2 rounded-full border border-red-300/15 bg-red-500/8 px-3 text-xs font-medium text-red-200/75 hover:bg-red-500/14"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Remove
              </button>
              <button
                type="button"
                onClick={() => onSave(person, { name, canHelpWith })}
                className="inline-flex h-9 items-center rounded-full bg-orange-500 px-4 text-xs font-medium text-black hover:bg-orange-400"
              >
                Save
              </button>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function TeamPickerDialog({
  open,
  people,
  campaignPeople,
  disabled,
  onOpenChange,
  onTogglePerson,
}: {
  open: boolean
  people: ArtistNetworkPerson[]
  campaignPeople: ArtistNetworkPerson[]
  disabled: boolean
  onOpenChange: (open: boolean) => void
  onTogglePerson: (person: ArtistNetworkPerson) => void
}) {
  const campaignPersonIds = React.useMemo(() => new Set(campaignPeople.map((person) => person.id)), [campaignPeople])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[78vh] overflow-hidden border-white/[0.08] bg-[#070707] text-white shadow-modal-small sm:max-w-[620px]">
        <DialogHeader className="pr-8">
          <DialogTitle className="text-base font-medium text-white/88">Add From Network</DialogTitle>
          <DialogDescription className="text-xs text-white/38">
            Tag existing HQ Network people who are helping with this release.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto pr-1">
          {people.length === 0 ? (
            <EmptyCardLine title="No Network people yet" detail="Add people in HQ Network first, then tag them to the release." />
          ) : (
            <div className="space-y-2">
              {people.map((person) => {
                const selected = campaignPersonIds.has(person.id)
                return (
                  <button
                    key={person.id}
                    type="button"
                    onClick={() => onTogglePerson(person)}
                    disabled={disabled}
                    className={cn(
                      'flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                      selected
                        ? 'border-emerald-400/20 bg-emerald-400/10'
                        : 'border-white/[0.045] bg-white/[0.012] hover:bg-white/[0.035]',
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-white/80">{person.name}</span>
                      <span className="mt-0.5 block truncate text-[11px] text-white/38">{person.canHelpWith || person.role || person.contact || 'No role added'}</span>
                    </span>
                    <span className={cn(
                      'shrink-0 rounded-full px-2 py-1 text-[10px] font-medium',
                      selected ? 'bg-emerald-400/14 text-emerald-200' : 'bg-white/[0.04] text-white/42',
                    )}>
                      {selected ? 'Added' : 'Add'}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
