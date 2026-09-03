import * as React from 'react'
import { useAtomValue } from 'jotai'
import {
  ArrowRight,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
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
import { RELEASE_MANAGER_AGENT_SLUG, isReleaseManagerDefinition } from '@craft-agent/shared/agent-definitions/defaults'
import { cn } from '@/lib/utils'
import { navigate, routes } from '@/lib/navigate'
import { CompactPageHeader } from './CompactPageHeader'
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
import { WorkflowLaunchDialog } from '@/components/workflows/WorkflowLaunchDialog'
import type { MissionAssetKindHint, MissionAssetManifest, TrackIntelligence, WorkflowDTO } from '../../../shared/types'
import { useWorkspaceSyncRefresh } from '@/hooks/useWorkspaceSyncRefresh'
import { sessionMetaMapAtom } from '@/atoms/sessions'
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
  MISSION_BRIEF_CONTEXT_SLUG,
  emptyMissionBrief,
  missionCampaignWindow,
  parseMissionBriefDoc,
  type MissionBrief,
} from '@/lib/mission-brief'
import {
  RELEASE_BOARD_CONTEXT_SLUG,
  buildReleaseBoardItemActionPrompt,
  buildReleaseBoardWorkflowInputs,
  buildDefaultReleaseBoard,
  getReleaseBoardActionLabel,
  getBoardTotals,
  getCategoryProgress,
  getReleaseBoardItemAction,
  findReleaseBoardWorkerSession,
  isReleaseBoardItemIncluded,
  linkReleaseBoardItemSession,
  linkReleaseBoardItemToolReview,
  linkReleaseBoardItemWorkflowRun,
  mergeReleaseBoardWithAssets,
  parseReleaseBoardDoc,
  releaseBoardMetadata,
  serializeReleaseBoardBody,
  setReleaseBoardItemIncluded,
  updateReleaseBoardItemStatus,
  type ReleaseBoard,
  type ReleaseBoardCategory,
  type ReleaseBoardItem,
  type ReleaseBoardItemStatus,
} from '@/lib/release-board'
import { MissionBriefDrawer } from './MissionBriefDrawer'
import { ReleaseCountdownDial } from './ReleaseCountdownDial'
import { TrackIntelligenceReviewDialog, type TrackIntelligenceReviewValue } from './TrackIntelligenceReviewDialog'

interface ArtistCommandCenterHomeProps {
  workspaceId: string
  artistProfileWorkspaceId?: string
  view?: 'overview' | 'release-board'
}

function SectionTitle({
  icon: Icon,
  title,
  meta,
  iconClassName,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  meta?: string
  iconClassName?: string
}) {
  return (
    <div className="mb-3 flex items-center justify-between border-b border-white/[0.04] pb-2.5">
      <div className="flex items-center gap-2">
        <Icon className={cn('h-3.5 w-3.5', iconClassName ?? 'text-orange-300')} />
        <h3 className="text-[11px] font-medium uppercase tracking-[0.13em] text-white/88">{title}</h3>
      </div>
      {meta ? (
        <span className="text-[9px] font-medium uppercase tracking-widest text-white/46">
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

export function ArtistCommandCenterHome({ workspaceId, artistProfileWorkspaceId, view = 'overview' }: ArtistCommandCenterHomeProps) {
  const [drawerOpen, setDrawerOpen] = React.useState(false)
  const [assetManifest, setAssetManifest] = React.useState<MissionAssetManifest | null>(null)
  const [assetBusy, setAssetBusy] = React.useState(false)
  const [trackReviewAudioAssetId, setTrackReviewAudioAssetId] = React.useState<string | null>(null)
  const [launchingReleaseItemKey, setLaunchingReleaseItemKey] = React.useState<string | null>(null)
  const [pendingReleaseWorkflow, setPendingReleaseWorkflow] = React.useState<{
    workflow: WorkflowDTO
    initialInputs: Record<string, unknown>
    categoryId: ReleaseBoardCategory['id']
    itemId: string
  } | null>(null)
  const lastAutoSavedReleaseBoardBody = React.useRef<string | null>(null)
  const lastAutoSavedWorkerContextBody = React.useRef<string | null>(null)
  const { docs, loading, upsert } = useWorkspaceContext(workspaceId)
  const { allAgents } = useAgents(workspaceId)
  const { allWorkflows } = useWorkflows(workspaceId)
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)
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
  const focus = mission.timeline || mission.releaseDate || (hasMission ? mission.missionType || 'Campaign active' : 'No brief yet')
  const campaignWindow = React.useMemo(() => missionCampaignWindow(mission), [mission])
  const refreshAssetManifest = React.useCallback(async () => {
    if (!workspaceId) return
    const manifest = await window.electronAPI.getMissionAssetManifest(workspaceId)
    setAssetManifest(manifest)
  }, [workspaceId])

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
  useWorkspaceSyncRefresh(workspaceId, ['vault', 'context'], refreshAssetManifest)

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
        const skipped = result.skipped.length ? ` ${result.skipped.length} skipped.` : ''
        if (result.imported.length === 0) {
          toast.warning(`No campaign vault files added.${skipped}`)
          return
        }
        toast.success(`Added ${result.imported.length} campaign vault file${result.imported.length === 1 ? '' : 's'}.${skipped}`)
        const importedAudio = result.imported.filter((asset) => asset.kind === 'master' || asset.kind === 'demo')
        let firstReadyAudioId: string | null = null
        for (const audio of importedAudio) {
          const transcription = await window.electronAPI.transcribeMissionAssetLyrics(workspaceId, { audioAssetId: audio.id })
          setAssetManifest(transcription.manifest)
          if (transcription.ok) {
            firstReadyAudioId ??= audio.id
          } else {
            toast.error(transcription.error ?? 'Lyrics transcription failed', {
              description: transcription.blockers?.map((blocker) => blocker.message).join(' '),
            })
          }
        }
        if (firstReadyAudioId) {
          setTrackReviewAudioAssetId(firstReadyAudioId)
          toast.success(importedAudio.length === 1 ? 'Lyrics are ready to review' : `${importedAudio.length} track drafts are ready to review`)
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err))
      } finally {
        setAssetBusy(false)
      }
    },
    [hasMission, workspaceId],
  )

  const syncMissionAssetContext = React.useCallback(
    async (manifest: MissionAssetManifest) => {
      setAssetManifest(manifest)
    },
    [],
  )

  const transcribeLyrics = React.useCallback(async (audioAssetId?: string, force = false) => {
    if (!hasMission) {
      setDrawerOpen(true)
      toast.info('Create the campaign first, then transcribe lyrics.')
      return null
    }
    setAssetBusy(true)
    try {
      const result = await window.electronAPI.transcribeMissionAssetLyrics(workspaceId, { audioAssetId, force })
      await syncMissionAssetContext(result.manifest)
      if (!result.ok) {
        toast.error(result.error ?? 'Lyrics transcription failed', {
          description: result.blockers?.map((blocker) => blocker.message).join(' '),
        })
        return result
      }
      setTrackReviewAudioAssetId(result.audioAsset?.id ?? audioAssetId ?? null)
      toast.success('Lyrics transcribed. Review and save corrections.')
      return result
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
      return null
    } finally {
      setAssetBusy(false)
    }
  }, [hasMission, syncMissionAssetContext, workspaceId])

  const campaignReviewAudio = React.useMemo(
    () => assetManifest?.files.find((asset) => asset.id === trackReviewAudioAssetId) ?? null,
    [assetManifest, trackReviewAudioAssetId],
  )
  const campaignLyricsAsset = React.useMemo(
    () => {
      const available = assetManifest?.files.filter((asset) => asset.kind === 'lyrics' && asset.status === 'available') ?? []
      return (campaignReviewAudio?.trackIntelligence?.draft
        ? available.find((asset) => asset.lyrics?.reviewRequired && asset.lyrics.sourceAudioAssetId === campaignReviewAudio.id)
        : undefined)
        ?? available.find((asset) => asset.lyrics && !asset.lyrics.reviewRequired && asset.lyrics.sourceAudioAssetId === campaignReviewAudio?.id)
        ?? available.find((asset) => asset.lyrics?.sourceAudioAssetId === campaignReviewAudio?.id)
        ?? available[0]
        ?? null
    },
    [assetManifest, campaignReviewAudio],
  )
  const campaignReviewIntelligence = React.useMemo<TrackIntelligence | undefined>(() => {
    if (campaignReviewAudio?.trackIntelligence) return campaignReviewAudio.trackIntelligence
    if (!campaignLyricsAsset?.lyrics) return undefined
    const lines = campaignLyricsAsset.lyrics.lyricLines?.map((line, index) => ({
      id: `line-${index + 1}`,
      text: line.text,
      startMs: Math.round(line.start_time * 1000),
      endMs: Math.round(line.end_time * 1000),
    })) ?? campaignLyricsAsset.lyrics.text.split(/\r?\n/).map((text, index) => ({ id: `manual-line-${index + 1}`, text }))
    return {
      status: 'draft',
      schemaVersion: 1,
      draft: {
        id: `legacy-${campaignLyricsAsset.id}`,
        lyrics: {
          lines,
          timingSource: campaignLyricsAsset.lyrics.lyricLines?.length ? 'transcription' : 'manual',
          timingStatus: campaignLyricsAsset.lyrics.lyricLines?.length ? 'ready' : 'needs-alignment',
        },
        provenance: {
          engine: campaignLyricsAsset.lyrics.engine,
          analyzedAt: campaignLyricsAsset.lyrics.generatedAt,
          processedLocally: campaignLyricsAsset.lyrics.status === 'machine' ? true : undefined,
        },
      },
    }
  }, [campaignLyricsAsset, campaignReviewAudio])

  const saveTrackReview = React.useCallback(async (value: TrackIntelligenceReviewValue) => {
    if (!campaignReviewAudio) return
    setAssetBusy(true)
    try {
      const result = await window.electronAPI.saveMissionAssetLyrics(workspaceId, {
        lyricsText: value.lyrics.lines.map((line) => line.text).filter(Boolean).join('\n'),
        draftId: value.revisionId,
        lyricLines: value.lyrics.timingStatus === 'ready'
          ? value.lyrics.lines.flatMap((line) => line.startMs !== undefined && line.endMs !== undefined ? [{
            text: line.text,
            start_time: line.startMs / 1000,
            end_time: line.endMs / 1000,
            section: line.section,
          }] : [])
          : undefined,
        lyricSections: value.lyrics.lines.flatMap((line, lineIndex) => line.section ? [{
          lineIndex,
          section: line.section,
        }] : []),
        assetId: campaignLyricsAsset?.id,
        sourceAudioAssetId: campaignReviewAudio.id,
        language: value.lyrics.language,
        timingSource: value.lyrics.timingSource,
        artistSuppliedText: value.lyrics.artistSuppliedText,
        character: value.character,
      })
      await syncMissionAssetContext(result.manifest)
      setTrackReviewAudioAssetId(null)
      toast.success('Track package approved for campaign agents')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setAssetBusy(false)
    }
  }, [campaignLyricsAsset?.id, campaignReviewAudio, syncMissionAssetContext, workspaceId])

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

  const setReleaseItemStatus = React.useCallback(
    (categoryId: ReleaseBoardCategory['id'], itemId: string, status: ReleaseBoardItemStatus) => {
      void saveReleaseBoard(updateReleaseBoardItemStatus(releaseBoard, categoryId, itemId, status))
    },
    [releaseBoard, saveReleaseBoard],
  )

  const linkReleaseItemSession = React.useCallback(
    (categoryId: ReleaseBoardCategory['id'], itemId: string, sessionId: string) => {
      void saveReleaseBoard(linkReleaseBoardItemSession(releaseBoard, categoryId, itemId, sessionId))
    },
    [releaseBoard, saveReleaseBoard],
  )

  const setReleaseItemIncluded = React.useCallback(
    (categoryId: ReleaseBoardCategory['id'], itemId: string, included: boolean) => {
      void saveReleaseBoard(setReleaseBoardItemIncluded(releaseBoard, categoryId, itemId, included))
    },
    [releaseBoard, saveReleaseBoard],
  )

  const launchReleaseItem = React.useCallback(async (
    category: ReleaseBoardCategory,
    item: ReleaseBoardItem,
  ) => {
    if (item.linkedSessionId) {
      if (window.location.hash.startsWith('#artist-hq/')) {
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
      }
      navigate(routes.view.allSessions(item.linkedSessionId))
      return
    }
    if (item.linkedWorkflowRunId) {
      navigate(routes.view.workflowRun(item.linkedWorkflowRunId))
      return
    }
    const action = getReleaseBoardItemAction(category.id, item.id)
    if (!action) return
    if (action.kind === 'tool' && item.linkedToolReviewAssetId) {
      const reviewAssetExists = assetManifest?.files.some((asset) => asset.id === item.linkedToolReviewAssetId)
      if (reviewAssetExists) {
        setTrackReviewAudioAssetId(item.linkedToolReviewAssetId)
        return
      }
    }
    if (item.status === 'in-progress' && action.kind === 'agent') {
      const recoveredSessionId = findReleaseBoardWorkerSession({
        sessions: sessionMetaMap.values(),
        workspaceId,
        agentSlug: action.targetSlug,
        campaignTitle: mission.title || 'Untitled Campaign',
        itemLabel: item.label,
      })
      if (recoveredSessionId) {
        linkReleaseItemSession(category.id, item.id, recoveredSessionId)
        if (window.location.hash.startsWith('#artist-hq/')) {
          window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
        }
        navigate(routes.view.allSessions(recoveredSessionId))
        return
      }
    }
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
        const result = await transcribeLyrics()
        const reviewAssetId = result?.ok ? result.audioAsset?.id : null
        if (reviewAssetId) {
          await saveReleaseBoard(linkReleaseBoardItemToolReview(releaseBoard, category.id, item.id, reviewAssetId))
        }
        return
      }
      if (action.kind === 'workflow') {
        const workflow = allWorkflows.find((candidate) => candidate.slug === action.targetSlug)
          ?? await window.electronAPI.getWorkflow(action.targetSlug)
        if (!workflow) {
          throw new Error(`${action.targetName} is not installed in the workflow library.`)
        }
        setPendingReleaseWorkflow({
          workflow,
          initialInputs: buildReleaseBoardWorkflowInputs(action, campaignBrief),
          categoryId: category.id,
          itemId: item.id,
        })
        return
      } else {
        const agent = allAgents.find((candidate) => candidate.slug === action.targetSlug)
          ?? (await window.electronAPI.listAllAgentDefinitions())
            .find((candidate) => candidate.slug === action.targetSlug)
        if (!agent) {
          throw new Error(`${action.targetName} is not installed in the worker library.`)
        }
        if (action.targetSlug === RELEASE_MANAGER_AGENT_SLUG) {
          if (!isReleaseManagerDefinition(agent)) {
            throw new Error('The reserved Artist OS Release Manager identity is occupied by another worker. Rename that custom worker, then restart Artist OS.')
          }
        }
        const session = await openAgentSessionComposer({
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
        linkReleaseItemSession(category.id, item.id, session.id)
      }
      toast.success(`${action.targetName} opened`, {
        description: `Ready to work through ${item.label.toLowerCase()} for this campaign.`,
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
    assetManifest?.files,
    enabledSources,
    hasMission,
    mission.title,
    onCreateSession,
    onInputChange,
    onSendMessage,
    sessionMetaMap,
    releaseBoard,
    saveReleaseBoard,
    skills,
    linkReleaseItemSession,
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
                email: item.email,
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
        <CompactPageHeader
          eyebrow={view === 'release-board' ? title : hasMission ? 'Campaign Active' : 'Campaign Empty'}
          title={view === 'release-board' ? 'Essentials' : title}
          tone={view === 'release-board' ? 'orange' : 'red'}
          actions={
            view === 'release-board' ? null : (
              <>
                <div className="hidden text-right sm:block">
                  <p className="text-[9px] font-medium uppercase tracking-[0.18em] text-white/38">Focus</p>
                  <p className="mt-1 text-[11px] font-medium capitalize text-white/70">{focus}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setDrawerOpen(true)}
                  className="inline-flex h-9 items-center gap-2 rounded-full bg-white/90 px-5 text-xs font-medium text-black transition-transform hover:scale-[1.02] active:scale-95"
                >
                  {hasMission ? 'Edit Campaign' : 'Create Campaign'}
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </>
            )
          }
        />

        {view === 'release-board' ? (
          <div className="pt-6">
            <ReleaseBoardProgress board={releaseBoard} />
            <div className="mt-5">
              <ReleaseBoardWorkspace
                board={releaseBoard}
                launchingItemKey={launchingReleaseItemKey}
                onLaunchItem={launchReleaseItem}
                onSetItemIncluded={setReleaseItemIncluded}
                onSetItemStatus={setReleaseItemStatus}
                onAddAsset={chooseAndImport}
              />
            </div>
          </div>
        ) : (
          <>
            <div className="grid items-stretch gap-3 md:grid-cols-[minmax(0,1fr)_148px]">
              <ReleaseReadinessSummary
                board={releaseBoard}
                onOpen={() => navigate(routes.view.campaign('release-board'))}
              />
              <div className="flex min-h-[148px] items-center justify-center rounded-2xl border border-white/[0.04] bg-[#0A0A0A]">
                <ReleaseCountdownDial
                  releaseDate={campaignWindow.releaseDate}
                  campaignStartDate={campaignWindow.startDate}
                  onClick={() => setDrawerOpen(true)}
                />
              </div>
            </div>

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
                <SectionTitle icon={Bot} title="Active Workers" meta="Quiet" iconClassName="text-orange-400" />

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
                <SectionTitle icon={ShieldCheck} title="Approvals" meta="None" iconClassName="text-red-400" />
                <EmptyCardLine
                  title="No pending approvals"
                  detail={hasMission ? 'Approvals will appear when workflows create review points.' : 'Create a campaign before approval workflows matter.'}
                />
              </CommandCard>
            </div>
          </>
        )}
      </div>

      <MissionBriefDrawer
        open={drawerOpen}
        backgroundInteractionLocked={Boolean(trackReviewAudioAssetId && campaignReviewIntelligence)}
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
        onTranscribeLyrics={async (...args) => {
          await transcribeLyrics(...args)
        }}
        onReviewLyrics={() => {
          const sourceAudioId = campaignLyricsAsset?.lyrics?.sourceAudioAssetId
          const audio = assetManifest?.files.find((asset) => asset.id === sourceAudioId)
            ?? assetManifest?.files.find((asset) => asset.kind === 'master' || asset.kind === 'demo')
          if (audio) setTrackReviewAudioAssetId(audio.id)
        }}
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

      <TrackIntelligenceReviewDialog
        open={Boolean(trackReviewAudioAssetId && campaignReviewIntelligence)}
        title={campaignReviewAudio?.label ?? mission.title ?? 'Campaign track'}
        intelligence={campaignReviewIntelligence}
        busy={assetBusy}
        onClose={() => setTrackReviewAudioAssetId(null)}
        onSave={saveTrackReview}
      />

      {pendingReleaseWorkflow ? (
        <WorkflowLaunchDialog
          open
          onOpenChange={(open) => {
            if (!open) setPendingReleaseWorkflow(null)
          }}
          workflow={pendingReleaseWorkflow.workflow}
          workspaceId={workspaceId}
          initialInputs={pendingReleaseWorkflow.initialInputs}
          contextHint="This launch came from the campaign essentials board. Use the campaign context and any approved assets already attached before asking me to repeat anything."
          onManagerSessionStarted={(sessionId) => {
            linkReleaseItemSession(
              pendingReleaseWorkflow.categoryId,
              pendingReleaseWorkflow.itemId,
              sessionId,
            )
          }}
          onStarted={async (run) => {
            await saveReleaseBoard(linkReleaseBoardItemWorkflowRun(
              releaseBoard,
              pendingReleaseWorkflow.categoryId,
              pendingReleaseWorkflow.itemId,
              run.id,
            ))
          }}
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

const releaseCategoryIconColors: Record<ReleaseBoardCategory['id'], string> = {
  music: 'text-[#ffd22e]',
  visuals: 'text-[#ffad1f]',
  content: 'text-[#ff7a16]',
  setup: 'text-[#f4511e]',
  promotion: 'text-[#ef2b10]',
  team: 'text-[#ef2b10]',
}

function ReleaseReadinessSummary({
  board,
  onOpen,
}: {
  board: ReleaseBoard
  onOpen: () => void
}) {
  const totals = getBoardTotals(board)
  const percentComplete = totals.total > 0 ? Math.round((totals.done / totals.total) * 100) : 0
  const nextNeeded = board.categories
    .flatMap((category) => category.items.map((item) => ({ category, item })))
    .find(({ item }) => isReleaseBoardItemIncluded(item) && item.status === 'needed')

  return (
    <CommandCard className="flex min-h-[112px] items-center gap-5 p-4 sm:p-5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="h-3.5 w-3.5 text-orange-200/62" />
          <h2 className="text-sm font-medium text-white/82">Release readiness</h2>
          <span className="text-[10px] text-white/32">{totals.done}/{totals.total}</span>
        </div>
        <div className="mt-3 h-px overflow-hidden bg-white/[0.08]">
          <div className="h-full bg-gradient-to-r from-[#ff9700] to-[#ef2b10]" style={{ width: `${percentComplete}%` }} />
        </div>
        <p className="mt-2 truncate text-[10px] text-white/38">
          {nextNeeded ? `Next: ${nextNeeded.item.label} · ${nextNeeded.category.label}` : 'Every release item is handled.'}
        </p>
      </div>
      <button
        type="button"
        onClick={onOpen}
        className="inline-flex h-8 shrink-0 items-center gap-2 rounded-full bg-white/[0.07] px-4 text-[10px] font-medium text-white/72 ring-1 ring-white/[0.10] transition-colors hover:bg-white/[0.11] hover:text-white"
      >
        Open essentials
        <ArrowRight className="h-3 w-3" />
      </button>
    </CommandCard>
  )
}

function ReleaseBoardWorkspace({
  board,
  launchingItemKey,
  onLaunchItem,
  onSetItemIncluded,
  onSetItemStatus,
  onAddAsset,
}: {
  board: ReleaseBoard
  launchingItemKey: string | null
  onLaunchItem: (category: ReleaseBoardCategory, item: ReleaseBoardItem) => void
  onSetItemIncluded: (categoryId: ReleaseBoardCategory['id'], itemId: string, included: boolean) => void
  onSetItemStatus: (categoryId: ReleaseBoardCategory['id'], itemId: string, status: ReleaseBoardItemStatus) => void
  onAddAsset: (kindHint: MissionAssetKindHint) => Promise<void>
}) {
  return (
    <section className="grid gap-3 py-1">
        {[
          { key: 'foundation-visuals', categories: board.categories.slice(0, 2), layout: 'two' as const },
          { key: 'content-setup', categories: board.categories.slice(2, 4), layout: 'two' as const },
          { key: 'promotion', categories: board.categories.slice(4), layout: 'promotion' as const },
        ].map(({ key, categories, layout }) => (
          <ReleaseBoardBand
            key={key}
            categories={categories}
            layout={layout}
            launchingItemKey={launchingItemKey}
            onLaunchItem={onLaunchItem}
            onSetItemIncluded={onSetItemIncluded}
            onSetItemStatus={onSetItemStatus}
            onAddAsset={onAddAsset}
          />
        ))}
    </section>
  )
}

function ReleaseBoardProgress({ board }: { board: ReleaseBoard }) {
  const totals = getBoardTotals(board)
  const remaining = Math.max(0, totals.total - totals.done)
  const percentComplete = totals.total > 0 ? Math.round((totals.done / totals.total) * 100) : 0

  return (
    <div className="flex justify-end">
      <div className="w-full max-w-[360px]">
        <div className="mb-2 flex items-end justify-between gap-4">
          <p className="text-[9px] font-medium uppercase tracking-[0.16em] text-white/34">Overall progress</p>
          <div className="flex items-center gap-3 text-[9px]">
            <span className="text-white/58">{totals.done} done</span>
            <span className="text-white/28">{remaining} left</span>
          </div>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-white/[0.07]">
          <div
            className="h-full rounded-full bg-gradient-to-r from-[#ff8a00] to-[#ef2b10] transition-all duration-500"
            style={{ width: `${percentComplete}%` }}
          />
        </div>
      </div>
    </div>
  )
}

function ReleaseBoardBand({
  categories,
  layout,
  launchingItemKey,
  onLaunchItem,
  onSetItemIncluded,
  onSetItemStatus,
  onAddAsset,
}: {
  categories: ReleaseBoardCategory[]
  layout: 'two' | 'promotion'
  launchingItemKey: string | null
  onLaunchItem: (category: ReleaseBoardCategory, item: ReleaseBoardItem) => void
  onSetItemIncluded: (categoryId: ReleaseBoardCategory['id'], itemId: string, included: boolean) => void
  onSetItemStatus: (categoryId: ReleaseBoardCategory['id'], itemId: string, status: ReleaseBoardItemStatus) => void
  onAddAsset: (kindHint: MissionAssetKindHint) => Promise<void>
}) {
  return (
    <article
      className="group relative overflow-hidden rounded-xl ring-1 ring-white/[0.055]"
      style={{
        backgroundColor: '#090909',
        backgroundImage: [
          'radial-gradient(at 88% 40%, rgba(20,20,20,0.58) 0px, transparent 78%)',
          'radial-gradient(at 12% 20%, rgba(52,52,52,0.14) 0px, transparent 72%)',
          'radial-gradient(at 0% 82%, rgba(72,72,72,0.10) 0px, transparent 74%)',
          'radial-gradient(at 100% 100%, rgba(255,77,0,0.018) 0px, transparent 64%)',
        ].join(', '),
      }}
    >
      <div className="pointer-events-none absolute -inset-10 opacity-0 transition-opacity duration-500 group-hover:opacity-100">
        <div className="absolute -inset-12 animate-spin rounded-full bg-gradient-to-r from-transparent via-white/[0.035] to-transparent blur-xl [animation-duration:18s]" />
        <div className="absolute -inset-16 animate-spin rounded-full bg-gradient-to-r from-transparent via-orange-400/[0.022] to-transparent blur-2xl [animation-direction:reverse] [animation-duration:28s]" />
      </div>
      <div
        className={cn(
          'relative grid divide-y divide-white/[0.07] md:divide-x md:divide-y-0',
          layout === 'two' ? 'md:grid-cols-2' : 'md:grid-cols-1 md:divide-x-0',
        )}
      >
        {categories.map((category) => (
          <ReleaseBoardSection
            key={category.id}
            category={category}
            launchingItemKey={launchingItemKey}
            onLaunchItem={onLaunchItem}
            onSetItemIncluded={onSetItemIncluded}
            onSetItemStatus={onSetItemStatus}
            onAddAsset={onAddAsset}
          />
        ))}
      </div>
    </article>
  )
}

function ReleaseBoardSection({
  category,
  launchingItemKey,
  onLaunchItem,
  onSetItemIncluded,
  onSetItemStatus,
  onAddAsset,
}: {
  category: ReleaseBoardCategory
  launchingItemKey: string | null
  onLaunchItem: (category: ReleaseBoardCategory, item: ReleaseBoardItem) => void
  onSetItemIncluded: (categoryId: ReleaseBoardCategory['id'], itemId: string, included: boolean) => void
  onSetItemStatus: (categoryId: ReleaseBoardCategory['id'], itemId: string, status: ReleaseBoardItemStatus) => void
  onAddAsset: (kindHint: MissionAssetKindHint) => Promise<void>
}) {
  const Icon = releaseCategoryIcons[category.id] || CheckCircle2
  const iconColor = releaseCategoryIconColors[category.id] || 'text-white/58'
  const progress = getCategoryProgress(category)
  const allDone = progress.total > 0 && progress.done === progress.total
  const progressPercent = progress.total > 0 ? (progress.done / progress.total) * 100 : 0
  const [moreOpen, setMoreOpen] = React.useState(false)
  const [actionChoiceItemId, setActionChoiceItemId] = React.useState<string | null>(null)
  const [statusChoiceItemId, setStatusChoiceItemId] = React.useState<string | null>(null)
  const activeItems = category.items.filter(isReleaseBoardItemIncluded)
  const optionalItems = category.items.filter((item) => item.tier !== 'core')
  const actionChoiceItem = activeItems.find((item) => item.id === actionChoiceItemId) ?? null
  const statusChoiceItem = activeItems.find((item) => item.id === statusChoiceItemId) ?? null
  const actionChoice = actionChoiceItem ? getReleaseBoardItemAction(category.id, actionChoiceItem.id) : null
  const actionChoiceUploadHint = actionChoiceItem ? releaseBoardUploadHint(actionChoiceItem) : null

  return (
    <section className="min-w-0 p-3">
      <div>
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/[0.035] ring-1 ring-white/[0.065]">
              <Icon className={cn('h-3.5 w-3.5', allDone ? 'opacity-95' : 'opacity-80', iconColor)} />
            </span>
            <div className="min-w-0">
              <h3 className="truncate text-[13px] font-medium text-white/90">{category.label}</h3>
            </div>
          </div>
          <span className={cn('shrink-0 text-[9px] font-semibold', allDone ? 'text-orange-200/80' : 'text-white/34')}>{progress.done}/{progress.total}</span>
        </div>

        <div className="mt-2 h-px overflow-hidden bg-white/[0.08]">
          <div className="h-full bg-gradient-to-r from-[#ff9700] to-[#ef2b10] transition-all duration-300" style={{ width: `${progressPercent}%` }} />
        </div>
        <div className={cn('mt-2 grid gap-1', category.id === 'promotion' && 'md:grid-cols-2 lg:grid-cols-3')}>
          {activeItems.map((item) => {
            const done = item.status === 'done'
            const skipped = item.status === 'skipped'
            const action = getReleaseBoardItemAction(category.id, item.id)
            const uploadHint = releaseBoardUploadHint(item)
            const canOpenLinkedWork = Boolean(
              item.linkedSessionId
              || item.linkedWorkflowRunId
              || item.linkedToolReviewAssetId
              || (item.status === 'in-progress' && action?.kind === 'agent'),
            )
            const itemKey = `${category.id}:${item.id}`
            const launching = launchingItemKey === itemKey
            const statusLabel = item.status === 'in-progress'
              ? 'In progress'
              : item.status === 'review'
                ? 'Review'
                : done
                  ? item.linkedAssetId ? 'Approved' : 'Done'
                  : skipped
                    ? 'N/A'
                    : 'Missing'
            return (
              <div key={item.id} className="flex min-h-7 items-center gap-1.5 rounded-md bg-black/[0.35] px-2 py-1 ring-1 ring-white/[0.035] transition-colors hover:bg-white/[0.03]">
                <button
                  type="button"
                  onClick={() => {
                    if (done || skipped) {
                      onSetItemStatus(category.id, item.id, 'needed')
                    } else {
                      setStatusChoiceItemId(item.id)
                    }
                  }}
                  aria-label={
                    skipped
                      ? `Restore ${item.label} as needed`
                      : done
                        ? `Mark ${item.label} as needed`
                        : `Review the status of ${item.label}`
                  }
                  className={cn(
                    'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors',
                    done
                      ? 'border-orange-300/30 bg-orange-400/14 text-orange-200'
                      : skipped
                        ? 'border-white/[0.07] bg-white/[0.012] text-white/24'
                        : 'border-white/[0.12] bg-white/[0.018] text-white/30 hover:border-white/25 hover:text-white/65',
                  )}
                >
                  {done ? <Check className="h-2.5 w-2.5" /> : skipped ? <X className="h-2.5 w-2.5" /> : <Circle className="h-2.5 w-2.5" />}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className={cn('truncate text-[11px] font-normal', skipped ? 'text-white/24 line-through' : done ? 'text-white/46' : 'text-white/62')}>{item.label}</p>
                    {item.linkedAssetId ? <span className="h-1 w-1 shrink-0 rounded-full bg-orange-300/80" title="Matched from campaign vault" /> : null}
                  </div>
                </div>
                {canOpenLinkedWork ? (
                  <button
                    type="button"
                    onClick={() => onLaunchItem(category, item)}
                    title={`Open the ${item.label} work`}
                    className={cn(
                      'shrink-0 rounded-sm text-[7px] font-semibold uppercase tracking-[0.08em] transition-colors hover:text-white/78',
                      done ? 'text-orange-200/62' : item.status === 'review' ? 'text-amber-200/70' : 'text-sky-200/60',
                    )}
                  >
                    {statusLabel}
                  </button>
                ) : (
                  <span className={cn(
                    'shrink-0 text-[7px] font-semibold uppercase tracking-[0.08em]',
                    done ? 'text-orange-200/62' : item.status === 'review' ? 'text-amber-200/70' : item.status === 'in-progress' ? 'text-sky-200/60' : 'text-white/24',
                  )}>{statusLabel}</span>
                )}
                {action || uploadHint ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (canOpenLinkedWork) {
                        onLaunchItem(category, item)
                      } else if (action && uploadHint) {
                        setActionChoiceItemId(item.id)
                      } else if (action) {
                        onLaunchItem(category, item)
                      } else if (uploadHint) {
                        void onAddAsset(uploadHint)
                      }
                    }}
                    disabled={launchingItemKey !== null}
                    title={canOpenLinkedWork ? `Open the ${item.label} work` : action && uploadHint ? `Choose how to handle ${item.label}` : action ? `${getReleaseBoardActionLabel(action)}: ${item.label}` : `Add file: ${item.label}`}
                    aria-label={canOpenLinkedWork ? `Open the ${item.label} work` : action && uploadHint ? `Choose an action for ${item.label}` : action ? `${getReleaseBoardActionLabel(action)} for ${item.label}` : `Add file for ${item.label}`}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white/[0.07] text-white/58 ring-1 ring-white/[0.08] transition-colors hover:bg-gradient-to-br hover:from-[#ff7a00] hover:to-[#ef2b10] hover:text-white disabled:cursor-wait disabled:opacity-35"
                  >
                    {launching ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Play className="h-2.5 w-2.5 fill-current" />}
                  </button>
                ) : null}
              </div>
            )
          })}
        </div>
        {optionalItems.length > 0 ? (
          <div className="mt-2 border-t border-white/[0.06] pt-2">
            <button
              type="button"
              onClick={() => setMoreOpen((open) => !open)}
              aria-expanded={moreOpen}
              className="inline-flex items-center gap-1.5 text-[9px] font-medium text-white/34 transition-colors hover:text-white/62"
            >
              <ChevronDown className={cn('h-3 w-3 transition-transform', moreOpen && 'rotate-180')} />
              More options
              <span className="text-white/20">{optionalItems.length}</span>
            </button>
            {moreOpen ? (
              <div className={cn('mt-2 grid gap-1', category.id === 'promotion' && 'md:grid-cols-2')}>
                {optionalItems.map((item) => {
                  const included = isReleaseBoardItemIncluded(item)
                  return (
                    <div key={item.id} className="flex min-h-7 items-center gap-2 rounded-md bg-white/[0.018] px-2 py-1 ring-1 ring-white/[0.035]">
                      <div className="min-w-0 flex-1">
                        <p className={cn('truncate text-[10px] font-normal', included ? 'text-white/58' : 'text-white/44')}>{item.label}</p>
                      </div>
                      <span className="text-[7px] uppercase tracking-[0.08em] text-white/20">
                        {included ? 'Added' : item.tier === 'conditional' ? 'When needed' : 'Optional'}
                      </span>
                      <button
                        type="button"
                        onClick={() => onSetItemIncluded(category.id, item.id, !included)}
                        className="inline-flex h-6 items-center rounded-md bg-white/[0.06] px-2 text-[8px] font-medium text-white/58 ring-1 ring-white/[0.08] hover:bg-white/[0.10] hover:text-white"
                      >
                        {included ? 'Remove' : 'Add'}
                      </button>
                    </div>
                  )
                })}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      <Dialog open={Boolean(actionChoiceItem)} onOpenChange={(open) => !open && setActionChoiceItemId(null)}>
        <DialogContent className="border-white/[0.08] bg-[#070707] text-white shadow-modal-small sm:max-w-[390px]">
          <DialogHeader className="pr-8">
            <DialogTitle className="text-base font-medium text-white/88">{actionChoiceItem?.label}</DialogTitle>
            <DialogDescription className="text-xs text-white/38">
              Use a specialist or add an existing approved file.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 pt-1">
            {actionChoice ? (
              <button
                type="button"
                onClick={() => {
                  if (!actionChoiceItem) return
                  setActionChoiceItemId(null)
                  onLaunchItem(category, actionChoiceItem)
                }}
                className="flex items-center justify-between rounded-lg bg-white/[0.055] px-3 py-2.5 text-left ring-1 ring-white/[0.08] transition-colors hover:bg-white/[0.09]"
              >
                <span>
                  <span className="block text-xs font-medium text-white/82">Use {actionChoice.targetName}</span>
                  <span className="mt-0.5 block text-[10px] text-white/36">Open the right specialist with this campaign already in context.</span>
                </span>
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-white/40" />
              </button>
            ) : null}
            {actionChoiceUploadHint ? (
              <button
                type="button"
                onClick={() => {
                  setActionChoiceItemId(null)
                  void onAddAsset(actionChoiceUploadHint)
                }}
                className="flex items-center justify-between rounded-lg bg-white/[0.035] px-3 py-2.5 text-left ring-1 ring-white/[0.06] transition-colors hover:bg-white/[0.075]"
              >
                <span>
                  <span className="block text-xs font-medium text-white/72">Add existing file</span>
                  <span className="mt-0.5 block text-[10px] text-white/32">Use work that is already finished.</span>
                </span>
                <Plus className="h-3.5 w-3.5 shrink-0 text-white/36" />
              </button>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(statusChoiceItem)} onOpenChange={(open) => !open && setStatusChoiceItemId(null)}>
        <DialogContent className="border-white/[0.08] bg-[#070707] text-white shadow-modal-small sm:max-w-[410px]">
          <DialogHeader className="pr-8">
            <DialogTitle className="text-base font-medium text-white/88">{statusChoiceItem?.label}</DialogTitle>
            <DialogDescription className="text-xs leading-5 text-white/42">
              Use Review while checking the work. Confirm Done only after you have verified the real asset, link, receipt, or manual completion.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 pt-1">
            {statusChoiceItem?.status !== 'review' ? (
              <button
                type="button"
                onClick={() => {
                  if (!statusChoiceItem) return
                  onSetItemStatus(category.id, statusChoiceItem.id, 'review')
                  setStatusChoiceItemId(null)
                }}
                className="rounded-lg bg-white/[0.04] px-3 py-2.5 text-left text-xs font-medium text-white/72 ring-1 ring-white/[0.07] transition-colors hover:bg-white/[0.08]"
              >
                Mark ready for review
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                if (!statusChoiceItem) return
                onSetItemStatus(category.id, statusChoiceItem.id, 'done')
                setStatusChoiceItemId(null)
              }}
              className="rounded-lg bg-gradient-to-r from-[#ff7a00] to-[#ef2b10] px-3 py-2.5 text-left text-xs font-medium text-white transition-opacity hover:opacity-90"
            >
              Confirm done
            </button>
            <button
              type="button"
              onClick={() => {
                if (!statusChoiceItem) return
                onSetItemStatus(category.id, statusChoiceItem.id, 'skipped')
                setStatusChoiceItemId(null)
              }}
              className="px-3 py-2 text-left text-[10px] font-medium text-white/34 transition-colors hover:text-white/62"
            >
              Not applicable to this release
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  )
}

function releaseBoardUploadHint(item: ReleaseBoardItem): MissionAssetKindHint | null {
  if (item.id === 'master') return 'master'
  if (item.id === 'cover-art') return 'cover-art'
  if (item.id === 'press-photos') return 'any'
  return null
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
          <Users className="h-3.5 w-3.5 text-amber-300" />
          <h3 className="text-[11px] font-medium uppercase tracking-[0.13em] text-white/88">Team</h3>
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
              title={person.canHelpWith || person.role || person.email || 'Release helper'}
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
                      <span className="mt-0.5 block truncate text-[11px] text-white/38">{person.canHelpWith || person.role || person.email || 'No role added'}</span>
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
