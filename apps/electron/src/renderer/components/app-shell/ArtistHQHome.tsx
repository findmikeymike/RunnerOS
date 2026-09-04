import * as React from 'react'
import {
  Bot,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Diamond,
  ExternalLink,
  FileText,
  ImagePlus,
  Info,
  Library,
  Maximize2,
  MessageSquareText,
  Mic,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Radio,
  Search,
  Send,
  SlidersHorizontal,
  Sparkles,
  Star,
  Trash2,
  UserRound,
  X,
} from 'lucide-react'
import { useAtomValue } from 'jotai'
import { toast } from 'sonner'
import { DocumentFormattedMarkdownOverlay, Tooltip, TooltipContent, TooltipTrigger } from '@craft-agent/ui'
import { cn } from '@/lib/utils'
import { navigate, routes } from '@/lib/navigate'
import { resolvePulseExecutionTarget, type PulseExecutionTarget } from '@/lib/pulse-execution'
import { openAgentSessionComposer } from '@/lib/run-agent'
import { CONCIERGE_SLUG } from '@craft-agent/shared/agent-definitions/types'
import { appendSignalNugget, formatSignalDate, loadFullSignalOutputText, readableSignalBody, signalDocumentDate, signalFreshness } from '@/lib/artist-signals'
import {
  createWeeklyManagerCheckInMatcher,
  isWeeklyManagerCheckInAutomation,
} from '@/lib/weekly-manager-check-in'
import { useAppShellContext } from '@/context/AppShellContext'
import { useAgents } from '@/hooks/useAgents'
import { useWorkflows } from '@/hooks/useWorkflows'
import { useOutputs, type OutputSummaryDTO } from '@/hooks/useOutputs'
import { useWorkspaceContext } from '@/hooks/useWorkspaceContext'
import { skillsAtom } from '@/atoms/skills'
import { sourcesAtom } from '@/atoms/sources'
import { sessionMetaMapAtom } from '@/atoms/sessions'
import type { SessionMeta } from '@/atoms/sessions'
import {
  dedupeAgentsBySlug,
  resolveHqRecommendationActionState,
  resolveHqRouteReadiness,
  userFacingHqAttention,
} from '@/lib/artist-hq-proactive'
import { parseAutomationsConfig, type AutomationListItem } from '@/components/automations/types'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
} from '@/components/ui/styled-dropdown'
import {
  ContextMenu,
  ContextMenuTrigger,
  StyledContextMenuContent,
  StyledContextMenuItem,
} from '@/components/ui/styled-context-menu'
import { Switch } from '@/components/ui/switch'
import { Info_Markdown } from '@/components/info'
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { ScheduledWorkComposer, type ScheduledWorkComposerEntry } from '@/components/calendar/ScheduledWorkComposer'
import { StateOfPlayRefreshButton } from './StateOfPlayControls'
import { AgendaPage, type AgendaTaskDraft } from './AgendaPage'
import { PeoplePageHeader } from './PeoplePageHeader'
import { CompactPageHeader } from './CompactPageHeader'
import { ReleaseHorizon } from './ReleaseHorizon'
import { ManagerKnowledgePanel, type ManagerSourceSurface } from './ManagerKnowledgePanel'
import { ArtistManagerVoiceDialog } from './ArtistManagerVoiceDialog'
import { useArtistManagerVoice } from '@/hooks/useArtistManagerVoice'
import { buildCampaignSchedulePlanFromComposer, buildHqSchedulePlanFromComposer, composerDefinitionDigest, type ScheduledWorkComposerDraft } from '@/lib/scheduled-work-composer'
import { SCHEDULED_WORK_CONTEXT_SLUG, parseScheduledWorkDocResult, type ScheduledWorkOrder } from '@craft-agent/shared/scheduled-work'
import {
  CalendarMonthGrid,
  parseDateKey,
  toDateKey,
  type CalendarMonthDayMeta,
  type CalendarDayAction,
} from './CalendarMonthGrid'
import {
  HQ_STATE_CONTEXT_SLUG,
  hqNormalizeSemanticIntentId,
  parseHqStateOfPlay,
  type HqStateOfPlay,
  type HqStateAttentionItem,
  type HqStateEntityRef,
  type HqStateRouteHint,
} from '@craft-agent/shared/hq-state'
import {
  ARTIST_CALENDAR_CONTEXT_SLUG,
  artistCalendarMetadata,
  createCalendarEvent,
  parseArtistCalendarDocResult,
  serializeArtistCalendarBody,
  shouldAutoSyncGoogleCalendar,
  type ArtistCalendar,
  type ArtistCalendarEvent,
} from '@/lib/artist-calendar'
import {
  ARTIST_NETWORK_CONTEXT_SLUG,
  createNetworkCategory,
  artistNetworkMetadata,
  createNetworkPerson,
  normalizeArtistNetworkEmail,
  parseArtistNetworkDocResult,
  serializeArtistNetworkBody,
  updateNetworkPerson,
  type ArtistNetwork,
  type ArtistNetworkCategory,
  type ArtistNetworkCategoryDefinition,
  type ArtistNetworkPerson,
} from '@/lib/artist-network'
import {
  ARTIST_PROFILE_CONTEXT_SLUG,
  artistProfileMetadata,
  parseArtistProfileDocResult,
  profileCompletion,
  serializeArtistProfileBody,
  type ArtistProfile,
} from '@/lib/artist-profile'
import {
  ARTIST_BRANDING_CONTEXT_SLUG,
  artistBrandingMetadata,
  brandingCompletion,
  parseArtistBrandingDocResult,
  serializeArtistBrandingBody,
  type ArtistBranding,
} from '@/lib/artist-branding'
import {
  ARTIST_VOICE_CONTEXT_SLUG,
  artistVoiceMetadata,
  parseArtistVoiceDocResult,
  serializeArtistVoiceBody,
  voiceCompletion,
  type ArtistVoice,
} from '@/lib/artist-voice'
import {
  ARTIST_SPOTIFY_SNAPSHOT_CONTEXT_SLUG,
  buildArtistSpotifyStreamHistory,
  calculateArtistSpotifyGrowth,
  parseArtistSpotifySnapshotDocResult,
  parseArtistSpotifySnapshotJsonResult,
  type ArtistSpotifyHistoryPoint,
  type ArtistSpotifySnapshot,
} from '@/lib/artist-spotify'
import {
  ARTIST_INSTAGRAM_SNAPSHOT_CONTEXT_SLUG,
  buildArtistInstagramGrowthHistory,
  parseArtistInstagramSnapshotDocResult,
  parseArtistInstagramSnapshotJsonResult,
  type ArtistInstagramGrowthPoint,
  type ArtistInstagramSnapshot,
} from '@/lib/artist-instagram'
import {
  ARTIST_INTEL_CONFIG_CONTEXT_SLUG,
  ARTIST_INTEL_REPORT_CONTEXT_SLUG,
  artistIntelConfigMetadata,
  createSignalScanQueueWorkAction,
  isValidYouTubeChannelUrl,
  parseArtistIntelConfigDocResult,
  parseArtistIntelReportDocResult,
  saveIntelConfigWithAutomationRollback,
  serializeArtistIntelConfigBody,
  SIGNAL_ANALYST_AGENT_SLUG,
  SIGNAL_SCOUT_AGENT_SLUG,
  type ArtistIntelConfig,
  type ArtistIntelSource,
  WEEKLY_SIGNAL_SCAN_SLUG,
  YOUTUBE_INTELLIGENCE_AGENT_SLUG,
} from '@/lib/artist-intel'
import type { SocialAccountsDoctorResult } from '../../../shared/types'
import {
  buildHqThisWeekItems,
  buildHqWorkerItems,
  hqHeaderNextLabel,
  shouldRefreshHqStateOnOpen,
  type HqCampaignSummary,
  type HqHomeWorkerItem,
} from '@/lib/artist-hq-home-feed'
import { addDaysToDateKey, buildArtistTimeline, CAMPAIGN_STATE_CONTEXT_SLUG, dateKeyInTimezone, dateTimeInReferenceTimezone, type TimelineEntry } from '@craft-agent/shared/hq-state'
import { isSharedIntelContextSlug } from '@craft-agent/shared/shared-intel'
import { CAMPAIGN_CALENDAR_CONTEXT_SLUG, parseCampaignCalendarDocResult } from '@craft-agent/shared/campaign-calendar'
import {
  ARTIST_RELEASE_HORIZON_CONTEXT_SLUG,
  artistReleaseHorizonMetadata,
  parseArtistReleaseHorizon,
  serializeArtistReleaseHorizon,
  type ArtistReleaseMonthPlan,
} from '@/lib/artist-release-horizon'

interface ArtistHQHomeProps {
  workspaceId: string
  workspaceName?: string
  primaryCampaignWorkspaceName?: string
  primaryCampaignWorkspaceId?: string
  campaignWorkspaces?: HqCampaignSummary[]
  onOpenPrimaryCampaignWorkspace?: () => void
  onOpenCampaignWorkspace?: (workspaceId: string) => void
  agendaSessions?: SessionMeta[]
  onCreateAgendaTask?: (task: AgendaTaskDraft) => Promise<string>
  onDeleteAgendaTask?: (sessionId: string, skipConfirmation?: boolean) => Promise<boolean>
}

type ArtistHQTab = 'home' | 'profile' | 'voice' | 'calendar' | 'network' | 'signals' | 'branding'
type NetworkDraft = {
  name: string
  category: ArtistNetworkCategory
  role: string
  email: string
  canHelpWith: string
  tags: string
  notes: string
}
type CalendarDraft = {
  title: string
  time: string
  notes: string
}
type CalendarEditDraft = CalendarDraft & {
  date: string
}
type ProfileDraft = Omit<ArtistProfile, 'version' | 'updatedAt'>
type BrandingDraft = Omit<ArtistBranding, 'version' | 'updatedAt'>
type VoiceDraft = Omit<ArtistVoice, 'version' | 'updatedAt'>
type SignalLibraryItem = {
  key: string
  kind: 'output' | 'context'
  title: string
  summary: string
  date?: string
  output?: OutputSummaryDTO
  body?: string
}

const HQ_HASH_PREFIX = '#artist-hq/'
const SHOW_HQ_BANNER_FILTER = false
const todayKey = toDateKey(new Date())
const SPOTIFY_SYNC_AUTOMATION_NAME = 'Weekly Spotify Snapshot'
const SPOTIFY_SYNC_CRON = '0 9 * * 1'
const INSTAGRAM_SYNC_AUTOMATION_NAME = 'Weekly Instagram Growth Snapshot'
const INSTAGRAM_SYNC_CRON = '20 9 * * 1'
const INTEL_SYNC_AUTOMATION_NAME = 'Weekly Signal Scan'
const LEGACY_INTEL_SYNC_AUTOMATION_NAME = 'Weekly YouTube Intel Pulse'
const INTEL_SYNC_CRON = '0 10 * * 1'
const SIGNAL_NUGGETS_CONTEXT_SLUG = 'artist-signal-nuggets'
const YOUTUBE_RESEARCH_AGENT_SLUG = 'youtube-research-agent'
const GOOGLE_CALENDAR_SOURCE_SLUG = 'google-calendar'
function signalLaneLabel(lane: 'youtube' | 'platform' | 'industry'): string {
  if (lane === 'youtube') return 'YouTube'
  if (lane === 'platform') return 'Platform updates'
  return 'Industry desk'
}
function googleCalendarSyncMessage(result: { synced: number; deleted?: number }): string {
  const deleted = result.deleted ?? 0
  const parts = [
    result.synced > 0 ? `synced ${result.synced}` : '',
    deleted > 0 ? `deleted ${deleted}` : '',
  ].filter(Boolean)
  return parts.length > 0 ? `Google Calendar ${parts.join(', ')}` : 'Google Calendar already up to date'
}

const emptyNetworkDraft: NetworkDraft = {
  name: '',
  category: 'collaborators',
  role: '',
  email: '',
  canHelpWith: '',
  tags: '',
  notes: '',
}
const emptyCalendarEditDraft: CalendarEditDraft = {
  date: '',
  title: '',
  time: '',
  notes: '',
}
const emptyProfileDraft: ProfileDraft = {
  artistName: '',
  mission: '',
  aliases: '',
  bio: '',
  themes: '',
  sound: '',
  visualWorld: '',
  brandWords: '',
  audience: '',
  similarArtists: '',
  priorityMarkets: '',
  socialLinks: '',
  spotifyProfile: '',
  team: '',
  promoBudget: '',
  rules: '',
}
const emptyBrandingDraft: BrandingDraft = {
  creativeDna: '',
  tensions: '',
  fascinations: '',
  reactionHooks: '',
  mythology: '',
  emotionalTerritory: '',
  audienceGravity: '',
  notes: '',
}
const emptyVoiceDraft: VoiceDraft = {
  summary: '',
  speakingStyle: '',
  vocabulary: '',
  avoid: '',
  captionExamples: '',
  commentReplyExamples: '',
  postExamples: '',
  writingExcerpts: '',
}

export function ArtistHQHome({
  workspaceId,
  workspaceName,
  primaryCampaignWorkspaceName,
  primaryCampaignWorkspaceId,
  campaignWorkspaces = [],
  onOpenPrimaryCampaignWorkspace,
  onOpenCampaignWorkspace,
  agendaSessions = [],
  onCreateAgendaTask,
  onDeleteAgendaTask,
}: ArtistHQHomeProps) {
  const {
    activeAgents: shellActiveAgents = [],
    llmConnections,
    workspaceDefaultLlmConnection,
    workspaces,
    onCreateSession,
    onInputChange,
    onSendMessage,
  } = useAppShellContext()
  const {
    activeAgents: workspaceActiveAgents,
    allAgents,
    setActive: setAgentActive,
  } = useAgents(workspaceId)
  const {
    allWorkflows,
    activeSlugs: activeWorkflowSlugs,
    setActive: setWorkflowActive,
  } = useWorkflows(workspaceId)
  const skills = useAtomValue(skillsAtom)
  const sources = useAtomValue(sourcesAtom)
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)
  const [tab, setTab] = React.useState<ArtistHQTab>(() => readTabFromHash())
  const [query, setQuery] = React.useState('')
  const [selectedNetworkCategory, setSelectedNetworkCategory] = React.useState<ArtistNetworkCategory | null>(null)
  const [draftOpen, setDraftOpen] = React.useState(false)
  const [categoryFormOpen, setCategoryFormOpen] = React.useState(false)
  const [editingCategoryId, setEditingCategoryId] = React.useState<string | null>(null)
  const [categoryEditDraft, setCategoryEditDraft] = React.useState('')
  const [intelConfigOpen, setIntelConfigOpen] = React.useState(false)
  const [intelBusy, setIntelBusy] = React.useState(false)
  const [selectedSignalKey, setSelectedSignalKey] = React.useState<string | null>(null)
  const [selectedSignalContent, setSelectedSignalContent] = React.useState('')
  const [selectedSignalText, setSelectedSignalText] = React.useState('')
  const [signalContentLoading, setSignalContentLoading] = React.useState(false)
  const [signalFullscreenOpen, setSignalFullscreenOpen] = React.useState(false)
  const [signalNuggetBusy, setSignalNuggetBusy] = React.useState(false)
  const signalReaderRef = React.useRef<HTMLDivElement | null>(null)
  const [categoryDraft, setCategoryDraft] = React.useState('')
  const [selectedPersonId, setSelectedPersonId] = React.useState<string | null>(null)
  const [selectedDate, setSelectedDate] = React.useState(todayKey)
  const [visibleMonth, setVisibleMonth] = React.useState(() => parseDateKey(todayKey))
  const [draft, setDraft] = React.useState<NetworkDraft>(emptyNetworkDraft)
  const [editDraft, setEditDraft] = React.useState<NetworkDraft>(emptyNetworkDraft)
  const [calendarEditId, setCalendarEditId] = React.useState<string | null>(null)
  const [calendarEditDraft, setCalendarEditDraft] = React.useState<CalendarEditDraft>(emptyCalendarEditDraft)
  const [calendarComposerTarget, setCalendarComposerTarget] = React.useState<'hq' | 'campaign' | null>(null)
  const [calendarComposerType, setCalendarComposerType] = React.useState<ScheduledWorkComposerEntry['suggestedType']>()
  const [profileDraft, setProfileDraft] = React.useState<ProfileDraft>(emptyProfileDraft)
  const [brandingDraft, setBrandingDraft] = React.useState<BrandingDraft>(emptyBrandingDraft)
  const [voiceDraft, setVoiceDraft] = React.useState<VoiceDraft>(emptyVoiceDraft)
  const [automations, setAutomations] = React.useState<AutomationListItem[]>([])
  const [spotifySyncBusy, setSpotifySyncBusy] = React.useState(false)
  const [spotifyHistory, setSpotifyHistory] = React.useState<ArtistSpotifyHistoryPoint[]>([])
  const [instagramSyncBusy, setInstagramSyncBusy] = React.useState(false)
  const [instagramHistory, setInstagramHistory] = React.useState<ArtistInstagramGrowthPoint[]>([])
  const [socialAccounts, setSocialAccounts] = React.useState<SocialAccountsDoctorResult | null>(null)
  const [socialAccountsBusy, setSocialAccountsBusy] = React.useState(false)
  const [socialAccountsError, setSocialAccountsError] = React.useState<string | null>(null)
  const [googleCalendarBusy, setGoogleCalendarBusy] = React.useState(false)
  const [googleCalendarConnected, setGoogleCalendarConnected] = React.useState(false)
  const [bannerImageDataUrl, setBannerImageDataUrl] = React.useState<string | null>(null)
  const [bannerImageBusy, setBannerImageBusy] = React.useState(false)
  const [managerCheckInBusy, setManagerCheckInBusy] = React.useState(false)
  const [hqRouteBusy, setHqRouteBusy] = React.useState(false)
  const [hqRefreshBusy, setHqRefreshBusy] = React.useState(false)
  const googleAutoSyncInFlightRef = React.useRef(false)
  const { docs, loading, upsert, refresh: refreshContext } = useWorkspaceContext(workspaceId)
  const { outputs, loading: outputsLoading, getOutput } = useOutputs(workspaceId)
  const profileResult = React.useMemo(
    () => parseArtistProfileDocResult(docs.find((doc) => doc.slug === ARTIST_PROFILE_CONTEXT_SLUG)),
    [docs],
  )
  const profile = profileResult.profile
  const releaseHorizon = React.useMemo(
    () => parseArtistReleaseHorizon(docs.find((doc) => doc.slug === ARTIST_RELEASE_HORIZON_CONTEXT_SLUG)),
    [docs],
  )
  const workspaceRootPath = React.useMemo(
    () => workspaces.find((workspace) => workspace.id === workspaceId)?.rootPath ?? null,
    [workspaces, workspaceId],
  )
  const profilePercent = profileCompletion(profile)
  const voiceResult = React.useMemo(
    () => parseArtistVoiceDocResult(docs.find((doc) => doc.slug === ARTIST_VOICE_CONTEXT_SLUG)),
    [docs],
  )
  const voice = voiceResult.voice
  const voicePercent = voiceCompletion(voice)
  const brandingResult = React.useMemo(
    () => parseArtistBrandingDocResult(docs.find((doc) => doc.slug === ARTIST_BRANDING_CONTEXT_SLUG)),
    [docs],
  )
  const branding = brandingResult.branding
  const brandingPercent = brandingCompletion(branding)
  const spotifyResult = React.useMemo(
    () => parseArtistSpotifySnapshotDocResult(docs.find((doc) => doc.slug === ARTIST_SPOTIFY_SNAPSHOT_CONTEXT_SLUG)),
    [docs],
  )
  const spotifySnapshot = spotifyResult.ok ? spotifyResult.snapshot : null
  const spotifyIsPublicApi = spotifySnapshot?.dataSource === 'spotify-web-api'
  const spotifySyncAutomation = React.useMemo(
    () => automations.find(isSpotifySyncAutomation) ?? null,
    [automations],
  )
  const hqState = React.useMemo(
    () => parseHqStateOfPlay(docs.find((doc) => doc.slug === HQ_STATE_CONTEXT_SLUG)?.body ?? ''),
    [docs],
  )
  const spotifySyncActive = Boolean(spotifySyncAutomation?.enabled)
  const pulseExecutionTarget = React.useMemo(
    () => resolvePulseExecutionTarget(llmConnections, workspaceDefaultLlmConnection),
    [llmConnections, workspaceDefaultLlmConnection],
  )
  const instagramResult = React.useMemo(
    () => parseArtistInstagramSnapshotDocResult(docs.find((doc) => doc.slug === ARTIST_INSTAGRAM_SNAPSHOT_CONTEXT_SLUG)),
    [docs],
  )
  const instagramSnapshot = instagramResult.ok ? instagramResult.snapshot : null
  const instagramSyncAutomation = React.useMemo(
    () => automations.find(isInstagramSyncAutomation) ?? null,
    [automations],
  )
  const instagramSyncActive = Boolean(instagramSyncAutomation?.enabled)
  const intelSyncAutomation = React.useMemo(
    () => automations.find(isIntelSyncAutomation) ?? null,
    [automations],
  )
  const intelSyncActive = Boolean(intelSyncAutomation?.enabled)
  const managerCheckInAutomation = React.useMemo(
    () => automations.find(isWeeklyManagerCheckInAutomation) ?? null,
    [automations],
  )
  const proactiveMode = Boolean(managerCheckInAutomation?.enabled)
  const calendarResult = React.useMemo(
    () => parseArtistCalendarDocResult(docs.find((doc) => doc.slug === ARTIST_CALENDAR_CONTEXT_SLUG)),
    [docs],
  )
  const calendar = calendarResult.calendar
  const scheduledWorkResult = React.useMemo(
    () => parseScheduledWorkDocResult(docs.find((doc) => doc.slug === SCHEDULED_WORK_CONTEXT_SLUG), workspaceId),
    [docs, workspaceId],
  )
  const scheduledWorkById = React.useMemo(
    () => new Map(scheduledWorkResult.work.items.map((order) => [order.id, order])),
    [scheduledWorkResult.work.items],
  )
  const networkResult = React.useMemo(
    () => parseArtistNetworkDocResult(docs.find((doc) => doc.slug === ARTIST_NETWORK_CONTEXT_SLUG)),
    [docs],
  )
  const network = networkResult.network
  const intelConfigResult = React.useMemo(
    () => parseArtistIntelConfigDocResult(docs.find((doc) => doc.slug === ARTIST_INTEL_CONFIG_CONTEXT_SLUG)),
    [docs],
  )
  const intelConfig = intelConfigResult.config
  const intelReportResult = React.useMemo(
    () => parseArtistIntelReportDocResult(docs.find((doc) => doc.slug === ARTIST_INTEL_REPORT_CONTEXT_SLUG)),
    [docs],
  )
  const intelReport = intelReportResult.report
  const intelReportError = intelReportResult.ok ? undefined : intelReportResult.error
  const latestSignalOrder = React.useMemo(
    () => scheduledWorkResult.work.items
      .filter((order) => !order.deletedAt && hqNormalizeSemanticIntentId(order.intentId) === 'artist-hq-weekly-signal-scan')
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0],
    [scheduledWorkResult.work.items],
  )
  const latestSignalFreshness = React.useMemo(
    () => signalFreshness(intelReport.generatedAt),
    [intelReport.generatedAt],
  )
  const youtubeIntelligenceAgent = React.useMemo(
    () => [...shellActiveAgents, ...workspaceActiveAgents, ...allAgents]
      .find((agent) => agent.slug === YOUTUBE_INTELLIGENCE_AGENT_SLUG),
    [allAgents, shellActiveAgents, workspaceActiveAgents],
  )
  const signalScoutAgent = React.useMemo(
    () => [...shellActiveAgents, ...workspaceActiveAgents, ...allAgents]
      .find((agent) => agent.slug === SIGNAL_SCOUT_AGENT_SLUG),
    [allAgents, shellActiveAgents, workspaceActiveAgents],
  )
  const signalAnalystAgent = React.useMemo(
    () => [...shellActiveAgents, ...workspaceActiveAgents, ...allAgents]
      .find((agent) => agent.slug === SIGNAL_ANALYST_AGENT_SLUG),
    [allAgents, shellActiveAgents, workspaceActiveAgents],
  )
  const signalScanWorkflow = React.useMemo(
    () => allWorkflows.find((workflow) => workflow.slug === WEEKLY_SIGNAL_SCAN_SLUG) ?? null,
    [allWorkflows],
  )
  const signalScanWorkflowDigest = React.useMemo(
    () => signalScanWorkflow
      ? composerDefinitionDigest({ metadata: signalScanWorkflow.metadata, body: signalScanWorkflow.body })
      : '',
    [signalScanWorkflow],
  )
  const signalWorkersReady = Boolean(
    youtubeIntelligenceAgent
    && signalScoutAgent
    && signalAnalystAgent
    && signalScanWorkflow
    && signalScanWorkflowDigest,
  )
  const signalWorkActive = latestSignalOrder?.status === 'scheduled' || latestSignalOrder?.status === 'running'
  const signalRunDisabledReason = !intelConfigResult.ok
    ? 'Signal settings need attention before a scan can run.'
    : signalWorkActive
      ? 'A Signal Scan is already queued or running.'
      : !signalWorkersReady
      ? 'Signal workers or the Weekly Signal Scan workflow are not installed yet. Restart Artist OS to finish the upgrade.'
      : undefined
  const signalNotice = React.useMemo(() => {
    if (!intelReportResult.ok) {
      return { tone: 'error' as const, title: 'Signal status could not be read', detail: intelReportError }
    }
    if (latestSignalOrder?.status === 'needs-attention' || latestSignalOrder?.status === 'needs-setup') {
      return {
        tone: 'error' as const,
        title: 'Latest Signal Scan needs attention',
        detail: latestSignalOrder.attention?.message || 'The scan did not complete. Run it again when the required worker or source is available.',
      }
    }
    if (latestSignalOrder?.status === 'scheduled' || latestSignalOrder?.status === 'running') {
      return {
        tone: 'running' as const,
        title: latestSignalOrder.status === 'running' ? 'Signal Scan is running' : 'Signal Scan is queued',
        detail: 'YouTube, platform, and industry lanes are being collected before one brief is assembled.',
      }
    }
    const unavailable = intelReport.lanes?.filter((lane) => lane.status === 'unavailable') ?? []
    if (intelReport.status === 'failed') {
      return {
        tone: 'error' as const,
        title: 'Latest Signal Scan was unavailable',
        detail: unavailable.map((lane) => `${signalLaneLabel(lane.id)}: ${lane.message || 'collector unavailable'}`).join(' · ') || 'No collector lane returned usable intelligence.',
      }
    }
    if (intelReport.status === 'partial') {
      const ready = intelReport.lanes?.filter((lane) => lane.status === 'ready').length ?? 0
      return {
        tone: 'partial' as const,
        title: `Partial brief · ${ready} of 3 lanes completed`,
        detail: unavailable.map((lane) => `${signalLaneLabel(lane.id)}: ${lane.message || 'collector unavailable'}`).join(' · '),
      }
    }
    if (latestSignalFreshness?.status === 'stale') {
      return {
        tone: 'stale' as const,
        title: `Latest brief is ${latestSignalFreshness.ageDays} days old`,
        detail: 'Run intelligence to refresh the decisions and recommendations on this page.',
      }
    }
    return null
  }, [intelReport.lanes, intelReport.status, intelReportError, intelReportResult.ok, latestSignalFreshness, latestSignalOrder])
  const spotifyAnalyst = React.useMemo(
    () => [...shellActiveAgents, ...workspaceActiveAgents, ...allAgents]
      .find((agent) => agent.slug === 'spotify-analyst'),
    [allAgents, shellActiveAgents, workspaceActiveAgents],
  )
  const socialPublisher = React.useMemo(
    () => [...shellActiveAgents, ...workspaceActiveAgents, ...allAgents]
      .find((agent) => agent.slug === 'social-publisher'),
    [allAgents, shellActiveAgents, workspaceActiveAgents],
  )
  const availableAgents = React.useMemo(
    () => dedupeAgentsBySlug([...shellActiveAgents, ...workspaceActiveAgents, ...allAgents]),
    [allAgents, shellActiveAgents, workspaceActiveAgents],
  )
  const managerVoice = useArtistManagerVoice({
    workspaceId,
    agents: availableAgents,
    skills,
    sources,
  })
  const [managerAskBusy, setManagerAskBusy] = React.useState(false)
  const askManager = React.useCallback(async (text: string) => {
    const draft = text.trim()
    if (!draft) return
    setManagerAskBusy(true)
    try {
      const manager = availableAgents.find((agent) => agent.slug === CONCIERGE_SLUG)
        ?? await window.electronAPI.getAgentDefinition(CONCIERGE_SLUG)
      if (!manager) throw new Error('The Artist Manager agent is not installed')
      await openAgentSessionComposer({
        agent: manager,
        workspaceId,
        onCreateSession,
        onInputChange,
        onSendMessage,
        skills,
        sources,
        agentCatalog: availableAgents.filter((agent) => agent.slug !== manager.slug),
        draftInput: draft,
        autoSendDraft: true,
      })
    } catch (error) {
      toast.error('Could not reach your manager', {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setManagerAskBusy(false)
    }
  }, [availableAgents, onCreateSession, onInputChange, onSendMessage, skills, sources, workspaceId])
  const researchDocs = React.useMemo(
    () => docs.filter((doc) => (
      doc.slug === SIGNAL_NUGGETS_CONTEXT_SLUG
      || (
        doc.slug !== ARTIST_INTEL_CONFIG_CONTEXT_SLUG
        && doc.slug !== ARTIST_INTEL_REPORT_CONTEXT_SLUG
        && /research|report|intel|analysis/i.test(`${doc.slug} ${doc.metadata.name} ${doc.metadata.description ?? ''}`)
      )
    )),
    [docs],
  )
  const researchOutputs = React.useMemo(
    () => outputs.filter(isResearchOutput),
    [outputs],
  )
  const signalLibraryItems = React.useMemo<SignalLibraryItem[]>(() => {
    const outputItems = researchOutputs.map((output) => ({
      key: `output:${output.id}`,
      kind: 'output' as const,
      title: output.title,
      summary: output.summary || output.origin?.agentName || 'Intelligence report',
      date: output.completedAt || output.updatedAt || output.createdAt,
      output,
    }))
    const contextItems = researchDocs.map((doc) => ({
      key: `context:${doc.slug}`,
      kind: 'context' as const,
      title: doc.metadata.name,
      summary: doc.metadata.description || 'Saved intelligence',
      date: signalDocumentDate(doc.body),
      body: readableSignalBody(doc.body),
    }))
    const reportFallback = !intelReport.outputId && (intelReport.title || intelReport.summary)
      ? [{
          key: 'context:latest-intel-summary',
          kind: 'context' as const,
          title: intelReport.title || 'Latest intelligence brief',
          summary: intelReport.summary || 'Latest intelligence brief',
          date: intelReport.generatedAt || intelReport.updatedAt,
          body: `# ${intelReport.title || 'Latest intelligence brief'}\n\n${intelReport.summary || 'The latest run has not produced a written summary yet.'}`,
        }]
      : []
    return [...outputItems, ...reportFallback, ...contextItems]
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
  }, [intelReport.generatedAt, intelReport.outputId, intelReport.summary, intelReport.title, intelReport.updatedAt, researchDocs, researchOutputs])
  const latestSignalDate = signalLibraryItems[0]?.date ?? intelReport.generatedAt
  const selectedSignalItem = React.useMemo(
    () => signalLibraryItems.find((item) => item.key === selectedSignalKey) ?? signalLibraryItems[0] ?? null,
    [selectedSignalKey, signalLibraryItems],
  )
  const activeCalendarEvents = React.useMemo(
    () => calendar.events.filter((event) => !event.deletedAt),
    [calendar.events],
  )
  const thisWeekItems = React.useMemo(
    () => buildHqThisWeekItems(activeCalendarEvents, scheduledWorkResult.work.items),
    [activeCalendarEvents, scheduledWorkResult.work.items],
  )
  // Strategic 12-month timeline for the year view's month pop-outs (spec 20 §9).
  // Campaign day-of items are not merged here; each month dialog fetches the
  // owning campaign's schedule on demand so detail stays campaign-owned.
  const timelineTimezone = React.useMemo(
    () => scheduledWorkResult.work.items.find((order) => order.timezone)?.timezone
      ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    [scheduledWorkResult.work.items],
  )
  const horizonTimelineEntries = React.useMemo<TimelineEntry[]>(() => {
    const timezone = timelineTimezone
    const now = new Date()
    const from = dateKeyInTimezone(now.toISOString(), timezone) ?? now.toISOString().slice(0, 10)
    return buildArtistTimeline({
      now,
      from,
      to: addDaysToDateKey(from, 366),
      timezone,
      hqWorkspaceId: workspaceId,
      hqEvents: activeCalendarEvents,
      hqOrders: scheduledWorkResult.work.items,
      campaigns: campaignWorkspaces.map((campaign) => ({
        workspaceId: campaign.id,
        label: campaign.name,
        startDate: campaign.startDate,
        releaseDate: campaign.releaseDate,
        finishDate: campaign.finishDate,
        dateStatuses: campaign.dateStatuses,
        items: [],
        orders: [],
      })),
      goals: docs
        .filter((doc) =>
          doc.metadata.status !== undefined
          && doc.metadata.status !== 'done'
          && doc.metadata.enabled !== false
          && typeof doc.metadata.deadline === 'string'
          && /^\d{4}-\d{2}-\d{2}$/.test(doc.metadata.deadline)
          && !isSharedIntelContextSlug(doc.slug)
          && doc.slug !== HQ_STATE_CONTEXT_SLUG
          && doc.slug !== CAMPAIGN_STATE_CONTEXT_SLUG)
        .map((doc) => ({
          slug: doc.slug,
          title: doc.metadata.name.trim() || doc.slug,
          deadline: doc.metadata.deadline!,
          workspaceId,
        })),
      tiers: ['strategic'],
    }).entries
  }, [activeCalendarEvents, scheduledWorkResult.work.items, campaignWorkspaces, docs, workspaceId, timelineTimezone])

  const loadCampaignMonthSchedule = React.useCallback(async (campaignWorkspaceId: string, monthKey: string) => {
    const doc = await window.electronAPI.getWorkspaceContextDoc(campaignWorkspaceId, CAMPAIGN_CALENDAR_CONTEXT_SLUG)
    const parsed = parseCampaignCalendarDocResult(doc ?? undefined, campaignWorkspaceId)
    if (!parsed.ok) return []
    return parsed.calendar.items
      .filter((item) => !item.deletedAt && item.status !== 'canceled')
      .map((item) => {
        const converted = item.time
          ? dateTimeInReferenceTimezone(item.date, item.time, item.timezone, timelineTimezone)
          : null
        return {
          ...item,
          date: converted?.date ?? item.date,
          time: converted?.time,
        }
      })
      .filter((item) => item.date.startsWith(`${monthKey}-`))
      .sort((left, right) => `${left.date}T${left.time ?? '00:00'}`.localeCompare(`${right.date}T${right.time ?? '00:00'}`))
      .map((item) => ({ id: item.id, date: item.date, time: item.time, title: item.title, status: item.status, kind: item.kind }))
  }, [timelineTimezone])
  const workspaceWorkerSessions = React.useMemo(
    () => [...sessionMetaMap.values()].filter((session) => session.workspaceId === workspaceId),
    [sessionMetaMap, workspaceId],
  )
  const workerItems = React.useMemo(
    () => buildHqWorkerItems(automations, scheduledWorkResult.work.items, workspaceWorkerSessions, Number.MAX_SAFE_INTEGER),
    [automations, scheduledWorkResult.work.items, workspaceWorkerSessions],
  )
  const selectedDateEvents = React.useMemo(
    () => activeCalendarEvents.filter((event) => event.date === selectedDate),
    [activeCalendarEvents, selectedDate],
  )
  const calendarComposerEntry = React.useMemo<ScheduledWorkComposerEntry>(() => ({
    owner: calendarComposerTarget === 'campaign' && primaryCampaignWorkspaceId
      ? { scope: 'campaign', workspaceId: primaryCampaignWorkspaceId, campaignId: primaryCampaignWorkspaceId }
      : { scope: 'hq', workspaceId },
    date: selectedDate,
    mode: calendarComposerType === 'event' ? 'event' : 'job',
    suggestedType: calendarComposerType,
  }), [calendarComposerTarget, calendarComposerType, primaryCampaignWorkspaceId, selectedDate, workspaceId])
  const selectedPerson = React.useMemo(
    () => network.people.find((person) => person.id === selectedPersonId) ?? null,
    [network.people, selectedPersonId],
  )

  const refreshSocialPulse = React.useCallback(async () => {
    setSocialAccountsBusy(true)
    setSocialAccountsError(null)
    try {
      setSocialAccounts(await window.electronAPI.listSocialAccounts())
    } catch (error) {
      setSocialAccountsError(error instanceof Error ? error.message : 'Could not load social accounts')
    } finally {
      setSocialAccountsBusy(false)
    }
  }, [])

  React.useEffect(() => {
    void refreshSocialPulse()
  }, [refreshSocialPulse])

  React.useEffect(() => {
    let cancelled = false
    if (!workspaceRootPath) {
      setSpotifyHistory([])
      return
    }

    const snapshotsPath = `${workspaceRootPath}/data/spotify/snapshots`
    void window.electronAPI.searchFiles(snapshotsPath, '.json')
      .then(async (files) => {
        const snapshotFiles = files
          .filter((file) => file.type === 'file' && /^\d{4}-\d{2}-\d{2}(?:-(?:s4a|web-api))?\.json$/.test(file.name))
          .sort((left, right) => left.name.localeCompare(right.name))
          .slice(-24)
        const parsed = await Promise.all(snapshotFiles.map(async (file) => {
          try {
            const result = parseArtistSpotifySnapshotJsonResult(await window.electronAPI.readFile(file.path))
            return result.ok ? result.snapshot : null
          } catch {
            return null
          }
        }))
        if (cancelled) return
        const snapshots = parsed.filter((snapshot): snapshot is ArtistSpotifySnapshot => Boolean(snapshot))
        if (spotifySnapshot) snapshots.push(spotifySnapshot)
        setSpotifyHistory(buildArtistSpotifyStreamHistory(snapshots))
      })
      .catch(() => {
        if (!cancelled) {
          setSpotifyHistory(spotifySnapshot ? buildArtistSpotifyStreamHistory([spotifySnapshot]) : [])
        }
      })

    return () => {
      cancelled = true
    }
  }, [spotifySnapshot, workspaceRootPath])

  React.useEffect(() => {
    let cancelled = false
    if (!workspaceRootPath) {
      setInstagramHistory([])
      return
    }

    const snapshotsPath = `${workspaceRootPath}/data/instagram/snapshots`
    void window.electronAPI.searchFiles(snapshotsPath, '.json')
      .then(async (files) => {
        const snapshotFiles = files
          .filter((file) => file.type === 'file' && /^\d{4}-\d{2}-\d{2}-insights\.json$/.test(file.name))
          .sort((left, right) => left.name.localeCompare(right.name))
          .slice(-24)
        const parsed = await Promise.all(snapshotFiles.map(async (file) => {
          try {
            const result = parseArtistInstagramSnapshotJsonResult(await window.electronAPI.readFile(file.path))
            return result.ok ? result.snapshot : null
          } catch {
            return null
          }
        }))
        if (cancelled) return
        const snapshots = parsed.filter((snapshot): snapshot is ArtistInstagramSnapshot => Boolean(snapshot))
        if (instagramSnapshot) snapshots.push(instagramSnapshot)
        setInstagramHistory(buildArtistInstagramGrowthHistory(snapshots))
      })
      .catch(() => {
        if (!cancelled) {
          setInstagramHistory(instagramSnapshot ? buildArtistInstagramGrowthHistory([instagramSnapshot]) : [])
        }
      })

    return () => {
      cancelled = true
    }
  }, [instagramSnapshot, workspaceRootPath])

  const refreshGoogleCalendarStatus = React.useCallback(async () => {
    try {
      const status = await window.electronAPI.getGoogleCalendarStatus(workspaceId)
      setGoogleCalendarConnected(Boolean(status.ok && status.connected))
    } catch {
      setGoogleCalendarConnected(false)
    }
  }, [workspaceId])

  React.useEffect(() => {
    void refreshGoogleCalendarStatus()
  }, [refreshGoogleCalendarStatus])

  const connectGoogleCalendar = React.useCallback(async () => {
    setGoogleCalendarBusy(true)
    try {
      const result = await window.electronAPI.performOAuth({
        sourceSlug: GOOGLE_CALENDAR_SOURCE_SLUG,
        credentialScope: 'workspace',
      })
      if (!result.success) throw new Error(result.error || 'Google Calendar sign-in failed.')
      setGoogleCalendarConnected(true)
      await refreshGoogleCalendarStatus()
      toast.success(result.email ? `Connected Google Calendar as ${result.email}` : 'Connected Google Calendar')
    } catch (error) {
      toast.error('Google Calendar connection failed', {
        description: error instanceof Error ? error.message : undefined,
      })
    } finally {
      setGoogleCalendarBusy(false)
    }
  }, [refreshGoogleCalendarStatus])

  const syncGoogleCalendar = React.useCallback(async () => {
    if (!calendarResult.ok) {
      toast.error('Calendar context needs repair before syncing.')
      return
    }
    setGoogleCalendarBusy(true)
    try {
      const result = await window.electronAPI.syncGoogleCalendar(workspaceId)
      if (!result.ok) {
        if (/not connected/i.test(result.error ?? '')) {
          const auth = await window.electronAPI.performOAuth({
            sourceSlug: GOOGLE_CALENDAR_SOURCE_SLUG,
            credentialScope: 'workspace',
          })
          if (!auth.success) throw new Error(auth.error || result.error || 'Google Calendar sign-in failed.')
          setGoogleCalendarConnected(true)
          const retry = await window.electronAPI.syncGoogleCalendar(workspaceId)
          if (!retry.ok) throw new Error(retry.error || 'Google Calendar sync failed.')
          toast.success(googleCalendarSyncMessage(retry))
        } else {
          throw new Error(result.error || 'Google Calendar sync failed.')
        }
      } else {
        toast.success(googleCalendarSyncMessage(result))
      }
      await refreshContext()
      await refreshGoogleCalendarStatus()
    } catch (error) {
      toast.error('Google Calendar sync failed', {
        description: error instanceof Error ? error.message : undefined,
      })
    } finally {
      setGoogleCalendarBusy(false)
    }
  }, [calendarResult.ok, refreshContext, refreshGoogleCalendarStatus, workspaceId])

  React.useEffect(() => {
    if (!googleCalendarConnected || !calendarResult.ok || googleAutoSyncInFlightRef.current) return
    const storageKey = googleCalendarAutoSyncStorageKey(workspaceId)
    const storedAttempt = Number(window.localStorage.getItem(storageKey))
    const lastAttemptAt = Number.isFinite(storedAttempt) && storedAttempt > 0 ? storedAttempt : null
    if (!shouldAutoSyncGoogleCalendar(calendar, lastAttemptAt)) return

    googleAutoSyncInFlightRef.current = true
    window.localStorage.setItem(storageKey, String(Date.now()))
    void window.electronAPI.syncGoogleCalendar(workspaceId)
      .then(async (result) => {
        if (!result.ok && /not connected/i.test(result.error ?? '')) {
          setGoogleCalendarConnected(false)
          return
        }
        if (result.ok) await refreshContext()
      })
      .catch(() => {
        // Background refresh stays silent; the explicit Sync action reports errors.
      })
      .finally(() => {
        googleAutoSyncInFlightRef.current = false
      })
  }, [calendar, calendarResult.ok, googleCalendarConnected, refreshContext, workspaceId])

  React.useEffect(() => {
    const onHashChange = () => setTab(readTabFromHash())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  React.useEffect(() => {
    if (selectedSignalKey && signalLibraryItems.some((item) => item.key === selectedSignalKey)) return
    setSelectedSignalKey(signalLibraryItems[0]?.key ?? null)
  }, [selectedSignalKey, signalLibraryItems])

  React.useEffect(() => {
    let cancelled = false
    setSelectedSignalText('')
    if (!selectedSignalItem) {
      setSelectedSignalContent('')
      setSignalContentLoading(false)
      return
    }
    if (selectedSignalItem.kind === 'context') {
      setSelectedSignalContent(selectedSignalItem.body || selectedSignalItem.summary)
      setSignalContentLoading(false)
      return
    }

    const output = selectedSignalItem.output
    if (!output) return
    const fallback = output.preview?.inlineText || output.summary || 'This report has no readable text preview.'
    setSelectedSignalContent(fallback)
    setSignalContentLoading(true)
    void loadFullSignalOutputText({
      output,
      getOutput,
      readAssetText: (outputId, assetId) => window.electronAPI.readOutputAssetText(workspaceId, outputId, assetId),
    })
      .then((content) => {
        if (!cancelled && content.trim()) setSelectedSignalContent(content)
      })
      .catch(() => {
        // Keep the manifest summary visible when the primary asset is not text.
      })
      .finally(() => {
        if (!cancelled) setSignalContentLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [getOutput, selectedSignalItem, workspaceId])

  React.useEffect(() => {
    if (!selectedPersonId) return
    if (!selectedPerson) setSelectedPersonId(null)
  }, [selectedPerson, selectedPersonId])

  React.useEffect(() => {
    setProfileDraft(profileToDraft(profile))
  }, [profile])

  React.useEffect(() => {
    let cancelled = false
    setBannerImageDataUrl(null)
    if (!profile.bannerImagePath || !workspaceRootPath) return
    const path = joinWorkspacePath(workspaceRootPath, profile.bannerImagePath)
    window.electronAPI.readFileDataUrl(path)
      .then((dataUrl) => {
        if (!cancelled && dataUrl.startsWith('data:image/')) setBannerImageDataUrl(dataUrl)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [profile.bannerImagePath, workspaceRootPath])

  React.useEffect(() => {
    setVoiceDraft(voiceToDraft(voice))
  }, [voice])

  React.useEffect(() => {
    setBrandingDraft(brandingToDraft(branding))
  }, [branding])

  React.useEffect(() => {
    if (intelReport.status !== 'queued' && !signalWorkActive) return
    const interval = window.setInterval(() => {
      refreshContext()
    }, 10000)
    return () => window.clearInterval(interval)
  }, [intelReport.status, refreshContext, signalWorkActive])

  const refreshAutomations = React.useCallback(async () => {
    try {
      const json = await window.electronAPI.getAutomations(workspaceId)
      setAutomations(json ? parseAutomationsConfig(json) : [])
    } catch {
      setAutomations([])
    }
  }, [workspaceId])

  React.useEffect(() => {
    refreshAutomations()
    const cleanup = window.electronAPI.onAutomationsChanged(() => {
      refreshAutomations()
    })
    return () => cleanup()
  }, [refreshAutomations])

  React.useEffect(() => {
    if (!spotifySyncAutomation || spotifySyncAutomation.permissionMode === 'safe') return
    void window.electronAPI.setAutomationEnabled(
      workspaceId,
      spotifySyncAutomation.event,
      spotifySyncAutomation.matcherIndex,
      spotifySyncAutomation.enabled,
      'safe',
    ).then(refreshAutomations).catch(() => undefined)
  }, [refreshAutomations, spotifySyncAutomation, workspaceId])

  React.useEffect(() => {
    if (!instagramSyncAutomation || instagramSyncAutomation.permissionMode === 'safe') return
    void window.electronAPI.setAutomationEnabled(
      workspaceId,
      instagramSyncAutomation.event,
      instagramSyncAutomation.matcherIndex,
      instagramSyncAutomation.enabled,
      'safe',
    ).then(refreshAutomations).catch(() => undefined)
  }, [instagramSyncAutomation, refreshAutomations, workspaceId])

  const saveNetwork = React.useCallback(
    async (nextNetwork: ArtistNetwork) => {
      if (!networkResult.ok) {
        throw new Error(`${networkResult.error} Open Workspace Context to recover it before saving.`)
      }
      await upsert({
        slug: ARTIST_NETWORK_CONTEXT_SLUG,
        metadata: artistNetworkMetadata(),
        body: serializeArtistNetworkBody(nextNetwork),
      })
    },
    [networkResult, upsert],
  )

  const saveCalendar = React.useCallback(
    async (nextCalendar: ArtistCalendar) => {
      if (!calendarResult.ok) {
        throw new Error(`${calendarResult.error} Open Workspace Context to recover it before saving.`)
      }
      await upsert({
        slug: ARTIST_CALENDAR_CONTEXT_SLUG,
        metadata: artistCalendarMetadata(),
        body: serializeArtistCalendarBody(nextCalendar),
      })
    },
    [calendarResult, upsert],
  )

  const saveProfile = React.useCallback(async () => {
    if (!profileResult.ok) {
      toast.error(`${profileResult.error} Open Workspace Context to recover it before saving.`)
      return
    }
    const nextProfile: ArtistProfile = {
      version: 1,
      ...profileDraft,
      updatedAt: new Date().toISOString(),
    }
    try {
      await upsert({
        slug: ARTIST_PROFILE_CONTEXT_SLUG,
        metadata: artistProfileMetadata(),
        body: serializeArtistProfileBody(nextProfile),
      })
      toast.success('Profile saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }, [profileDraft, profileResult, upsert])

  const saveReleaseMonthPlan = React.useCallback(async (monthKey: string, value: ArtistReleaseMonthPlan | null) => {
    const nextMonths = { ...releaseHorizon.months }
    if (value && (value.title.trim() || value.plan.trim() || value.keyGoal.trim())) nextMonths[monthKey] = value
    else delete nextMonths[monthKey]
    await upsert({
      slug: ARTIST_RELEASE_HORIZON_CONTEXT_SLUG,
      metadata: artistReleaseHorizonMetadata(),
      body: serializeArtistReleaseHorizon({
        version: 2,
        months: nextMonths,
        updatedAt: new Date().toISOString(),
      }),
    })
    toast.success('Month saved')
  }, [releaseHorizon.months, upsert])

  const saveReleaseNorthStar = React.useCallback(async (mission: string) => {
    if (!profileResult.ok) {
      throw new Error(`${profileResult.error} Open Workspace Context to recover it before saving.`)
    }
    await upsert({
      slug: ARTIST_PROFILE_CONTEXT_SLUG,
      metadata: artistProfileMetadata(),
      body: serializeArtistProfileBody({
        ...profile,
        mission: mission.trim() || undefined,
        updatedAt: new Date().toISOString(),
      }),
    })
    toast.success('Direction saved')
  }, [profile, profileResult, upsert])

  const saveBannerImagePath = React.useCallback(async (bannerImagePath?: string) => {
    if (!profileResult.ok) {
      throw new Error(`${profileResult.error} Open Workspace Context to recover it before changing the banner.`)
    }
    await upsert({
      slug: ARTIST_PROFILE_CONTEXT_SLUG,
      metadata: artistProfileMetadata(),
      body: serializeArtistProfileBody({
        ...profile,
        bannerImagePath,
        updatedAt: new Date().toISOString(),
      }),
    })
  }, [profile, profileResult, upsert])

  const chooseBannerImage = React.useCallback(async () => {
    if (!workspaceRootPath) {
      toast.error('This HQ does not have a local workspace folder.')
      return
    }
    setBannerImageBusy(true)
    try {
      const paths = await window.electronAPI.chooseMissionAssetFiles(workspaceId, 'cover-art')
      const sourcePath = paths[0]
      if (!sourcePath) return
      if (!isPreviewableBannerImage(sourcePath)) {
        toast.error('Choose a PNG, JPG, JPEG, or WebP image.')
        return
      }
      const result = await window.electronAPI.importMissionAssets(workspaceId, [sourcePath], { kindHint: 'cover-art' })
      const imported = result.imported[0]
      if (!imported?.relativePath) {
        throw new Error(result.skipped[0]?.reason ?? 'The image could not be copied into this HQ.')
      }
      const dataUrl = await window.electronAPI.readFileDataUrl(joinWorkspacePath(workspaceRootPath, imported.relativePath))
      if (!dataUrl.startsWith('data:image/')) throw new Error('The selected file is not a previewable image.')
      await saveBannerImagePath(imported.relativePath)
      setBannerImageDataUrl(dataUrl)
      toast.success(profile.bannerImagePath ? 'HQ banner replaced' : 'HQ banner added')
    } catch (error) {
      toast.error('Could not update the HQ banner', {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setBannerImageBusy(false)
    }
  }, [profile.bannerImagePath, saveBannerImagePath, workspaceId, workspaceRootPath])

  const removeBannerImage = React.useCallback(async () => {
    setBannerImageBusy(true)
    try {
      await saveBannerImagePath(undefined)
      setBannerImageDataUrl(null)
      toast.success('HQ banner removed')
    } catch (error) {
      toast.error('Could not remove the HQ banner', {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setBannerImageBusy(false)
    }
  }, [saveBannerImagePath])

  const saveVoice = React.useCallback(async () => {
    if (!voiceResult.ok) {
      toast.error(`${voiceResult.error} Open Workspace Context to recover it before saving.`)
      return
    }
    const nextVoice: ArtistVoice = {
      version: 1,
      ...voiceDraft,
      updatedAt: new Date().toISOString(),
    }
    try {
      await upsert({
        slug: ARTIST_VOICE_CONTEXT_SLUG,
        metadata: artistVoiceMetadata(),
        body: serializeArtistVoiceBody(nextVoice),
      })
      toast.success('Artist Voice saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }, [upsert, voiceDraft, voiceResult])

  const saveBranding = React.useCallback(async () => {
    if (!brandingResult.ok) {
      toast.error(`${brandingResult.error} Open Workspace Context to recover it before saving.`)
      return
    }
    const nextBranding: ArtistBranding = {
      version: 1,
      ...brandingDraft,
      updatedAt: new Date().toISOString(),
    }
    try {
      await upsert({
        slug: ARTIST_BRANDING_CONTEXT_SLUG,
        metadata: artistBrandingMetadata(),
        body: serializeArtistBrandingBody(nextBranding),
      })
      toast.success('Branding saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }, [brandingDraft, brandingResult, upsert])

  const saveIntelConfig = React.useCallback(async (nextConfig: ArtistIntelConfig) => {
    const config = {
      ...nextConfig,
      updatedAt: new Date().toISOString(),
    }
    await upsert({
      slug: ARTIST_INTEL_CONFIG_CONTEXT_SLUG,
      metadata: artistIntelConfigMetadata(),
      body: serializeArtistIntelConfigBody(config),
    })
  }, [upsert])

  const ensureSignalScanReady = React.useCallback(async () => {
    if (!signalScanWorkflow || !signalScanWorkflowDigest) {
      throw new Error('Weekly Signal Scan is not installed yet. Restart Artist OS once to finish the upgrade.')
    }
    if (!youtubeIntelligenceAgent || !signalScoutAgent || !signalAnalystAgent) {
      throw new Error('Signal workers are not installed yet. Restart Artist OS once to finish the upgrade.')
    }

    // Workspace manifests are individual files, so activate sequentially to avoid lost updates.
    await setAgentActive(YOUTUBE_INTELLIGENCE_AGENT_SLUG, true)
    await setAgentActive(SIGNAL_SCOUT_AGENT_SLUG, true)
    await setAgentActive(SIGNAL_ANALYST_AGENT_SLUG, true)
    if (!activeWorkflowSlugs.includes(WEEKLY_SIGNAL_SCAN_SLUG)) {
      await setWorkflowActive(WEEKLY_SIGNAL_SCAN_SLUG, true)
    }
  }, [
    activeWorkflowSlugs,
    setAgentActive,
    setWorkflowActive,
    signalAnalystAgent,
    signalScanWorkflow,
    signalScanWorkflowDigest,
    signalScoutAgent,
    youtubeIntelligenceAgent,
  ])

  const toggleIntelPulse = React.useCallback(async () => {
    if (!intelConfigResult.ok) {
      toast.error(intelConfigResult.error)
      return
    }
    setIntelBusy(true)
    try {
      const nextScheduled = !intelSyncActive
      if (nextScheduled) await ensureSignalScanReady()
      const nextConfig = {
        ...intelConfig,
        enabled: nextScheduled,
        cadence: nextScheduled ? 'weekly' : intelConfig.cadence,
      }
      await saveIntelConfigWithAutomationRollback({
        previousConfig: intelConfig,
        nextConfig,
        saveConfig: saveIntelConfig,
        mutateAutomation: async () => {
          const currentMatcher = intelSyncAutomation ? requireAutomationMatcher(intelSyncAutomation) : null
          if (intelSyncAutomation && nextScheduled && isLegacyIntelSyncAutomation(intelSyncAutomation)) {
            await window.electronAPI.replaceAutomation(
              workspaceId,
              intelSyncAutomation.event,
              intelSyncAutomation.id,
              currentMatcher!,
              createIntelSyncMatcher(workspaceName || 'Artist HQ', signalScanWorkflowDigest, nextConfig),
            )
          } else if (intelSyncAutomation) {
            await window.electronAPI.replaceAutomation(
              workspaceId,
              intelSyncAutomation.event,
              intelSyncAutomation.id,
              currentMatcher!,
              { ...currentMatcher!, enabled: nextScheduled },
            )
          } else if (nextScheduled) {
            await window.electronAPI.createAutomationFromTemplate(
              workspaceId,
              'SchedulerTick',
              createIntelSyncMatcher(workspaceName || 'Artist HQ', signalScanWorkflowDigest, nextConfig),
            )
          }
        },
      })
      await refreshAutomations()
      toast.success(nextScheduled ? 'Weekly Intel auto-run enabled' : 'Weekly Intel auto-run paused')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setIntelBusy(false)
    }
  }, [ensureSignalScanReady, intelConfig, intelConfigResult, intelSyncActive, intelSyncAutomation, refreshAutomations, saveIntelConfig, signalScanWorkflowDigest, workspaceId, workspaceName])

  const runIntelPulse = React.useCallback(async () => {
    if (!workspaceId || !intelConfigResult.ok) return
    if (signalWorkActive) {
      toast.info('A Signal Scan is already queued or running')
      return
    }
    if (!signalWorkersReady) {
      toast.error('Signal Scan is not installed in this workspace yet')
      return
    }
    setIntelBusy(true)
    try {
      await ensureSignalScanReady()
      const result = await window.electronAPI.testAutomation({
        workspaceId,
        automationName: 'Manual Signal Scan',
        actions: [createSignalScanQueueWorkAction(workspaceName || 'Artist HQ', signalScanWorkflowDigest, intelConfig)],
        permissionMode: 'safe',
        labels: ['signals', 'intel', 'artist-hq', 'manual'],
      })
      const queued = result.actions.find((action) => action.type === 'queue-work')
      if (!queued || !queued.success || !queued.workOrderIds?.[0]) throw new Error(queued?.error || 'Intel work was not queued.')
      await refreshContext()
      toast.success('Signal Scan started')
    } catch (error) {
      toast.error('Failed to start Signal Scan', {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setIntelBusy(false)
    }
  }, [
    intelConfig,
    intelConfigResult,
    ensureSignalScanReady,
    refreshContext,
    signalScanWorkflowDigest,
    signalWorkersReady,
    signalWorkActive,
    workspaceId,
    workspaceName,
  ])

  const captureSignalSelection = React.useCallback(() => {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      setSelectedSignalText('')
      return
    }
    const range = selection.getRangeAt(0)
    const commonNode = range.commonAncestorContainer
    const commonElement = commonNode.nodeType === Node.ELEMENT_NODE
      ? commonNode as Element
      : commonNode.parentElement
    if (!commonElement || !signalReaderRef.current?.contains(commonElement)) {
      setSelectedSignalText('')
      return
    }
    setSelectedSignalText(selection.toString().trim().slice(0, 4000))
  }, [])

  const saveSignalNugget = React.useCallback(async () => {
    if (!selectedSignalText || !selectedSignalItem || signalNuggetBusy) return
    setSignalNuggetBusy(true)
    try {
      const existing = docs.find((doc) => doc.slug === SIGNAL_NUGGETS_CONTEXT_SLUG)
      const amendedAt = new Date().toISOString()
      await upsert({
        slug: SIGNAL_NUGGETS_CONTEXT_SLUG,
        metadata: {
          name: 'Signal Nuggets',
          description: 'Selected intelligence worth carrying into future artist and campaign work.',
          routing: { mode: 'broadcast' },
          delivery: 'on-demand',
          enabled: true,
        },
        body: appendSignalNugget(existing?.body, {
          text: selectedSignalText,
          sourceTitle: selectedSignalItem.title,
          sourceKey: selectedSignalItem.key,
          amendedAt,
        }),
        expectedBody: existing?.body ?? null,
      })
      setSelectedSignalText('')
      window.getSelection()?.removeAllRanges()
      toast.success('Saved to Signal Nuggets')
    } catch (error) {
      toast.error('Could not save this nugget', {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setSignalNuggetBusy(false)
    }
  }, [docs, selectedSignalItem, selectedSignalText, signalNuggetBusy, upsert])

  const transitionHqRecommendation = React.useCallback(async (
    recommendationId: string,
    to: 'dismissed' | 'snoozed',
  ) => {
    setHqRouteBusy(true)
    try {
      const snoozedUntil = to === 'snoozed' ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() : undefined
      await window.electronAPI.transitionHqRecommendation(workspaceId, {
        recommendationId,
        to,
        snoozedUntil,
        reason: to === 'snoozed' ? 'Snoozed for seven days.' : 'Dismissed from State of Play.',
      })
      toast.success(to === 'snoozed' ? 'Recommendation snoozed' : 'Recommendation dismissed')
    } catch (error) {
      toast.error('Could not update recommendation', { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setHqRouteBusy(false)
    }
  }, [workspaceId])

  const refreshHqState = React.useCallback(async () => {
    setHqRefreshBusy(true)
    try {
      await window.electronAPI.refreshHqState(workspaceId)
      await refreshContext()
      toast.success('State of Play refreshed')
    } catch (error) {
      toast.error('Could not refresh State of Play', { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setHqRefreshBusy(false)
    }
  }, [refreshContext, workspaceId])

  const toggleProactiveMode = React.useCallback(async (enabled: boolean) => {
    setManagerCheckInBusy(true)
    try {
      if (managerCheckInAutomation) {
        await window.electronAPI.setAutomationEnabled(
          workspaceId,
          managerCheckInAutomation.event,
          managerCheckInAutomation.matcherIndex,
          enabled,
        )
      } else if (enabled) {
        await window.electronAPI.createAutomationFromTemplate(
          workspaceId,
          'SchedulerTick',
          createWeeklyManagerCheckInMatcher(pulseExecutionTarget),
        )
      }
      await refreshAutomations()
      toast.success(enabled ? 'Weekly manager check-in enabled' : 'Weekly manager check-in paused')
    } catch (error) {
      toast.error('Could not update the weekly manager check-in', {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setManagerCheckInBusy(false)
    }
  }, [managerCheckInAutomation, pulseExecutionTarget, refreshAutomations, workspaceId])

  const openManagerSource = React.useCallback((surface: ManagerSourceSurface) => {
    if (surface.kind === 'campaign') {
      onOpenCampaignWorkspace?.(surface.workspaceId)
      return
    }
    if (surface.kind === 'vault') {
      navigate(routes.view.vault())
      return
    }
    if (surface.kind === 'outputs') {
      navigate(routes.view.outputs())
      return
    }
    window.location.hash = `${HQ_HASH_PREFIX}${surface.tab}`
  }, [onOpenCampaignWorkspace])

  const refreshedStaleHqStateRef = React.useRef<string | null>(null)
  React.useEffect(() => {
    const refreshKey = `${workspaceId}:${hqState?.generatedAt ?? 'missing'}`
    if (refreshedStaleHqStateRef.current === refreshKey) return
    if (!shouldRefreshHqStateOnOpen(hqState?.generatedAt)) return
    refreshedStaleHqStateRef.current = refreshKey
    void window.electronAPI.refreshHqState(workspaceId).catch(() => undefined)
  }, [hqState?.generatedAt, workspaceId])

  const launchHqRoute = React.useCallback(async (route: HqStateRouteHint, recommendationId?: string) => {
    if (route.target !== 'agent' || !route.agentSlug) {
      toast.error(route.blockedReason ?? 'This recommendation needs review first.')
      return
    }
    if (!availableAgents.some((candidate) => candidate.slug === route.agentSlug)) {
      toast.error(`@${route.agentSlug} is not active in this workspace`)
      return
    }
    if (!recommendationId) {
      toast.error('This recommendation has no durable launch ID.')
      return
    }
    setHqRouteBusy(true)
    try {
      const result = await window.electronAPI.launchHqRecommendation(workspaceId, { recommendationId })
      navigate(routes.view.allSessions(result.sessionId))
      toast.success(`Started @${route.agentSlug}`)
    } catch (error) {
      toast.error('Failed to launch HQ route', {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setHqRouteBusy(false)
    }
  }, [
    availableAgents,
    workspaceId,
  ])

  const toggleSpotifySync = React.useCallback(async () => {
    setSpotifySyncBusy(true)
    try {
      if (spotifySyncAutomation) {
        await window.electronAPI.setAutomationEnabled(
          workspaceId,
          spotifySyncAutomation.event,
          spotifySyncAutomation.matcherIndex,
          !spotifySyncAutomation.enabled,
          'safe',
        )
        toast.success(spotifySyncAutomation.enabled ? 'Spotify sync paused' : 'Spotify sync enabled')
      } else {
        await window.electronAPI.createAutomationFromTemplate(
          workspaceId,
          'SchedulerTick',
          createSpotifySyncMatcher(pulseExecutionTarget),
        )
        toast.success('Weekly Spotify sync enabled')
      }
      await refreshAutomations()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setSpotifySyncBusy(false)
    }
  }, [pulseExecutionTarget, refreshAutomations, spotifySyncAutomation, workspaceId])

  const runSpotifyPulse = React.useCallback(async () => {
    if (!spotifyAnalyst) {
      toast.error('Spotify Analyst is not active in this workspace')
      return
    }
    setSpotifySyncBusy(true)
    try {
      const result = await window.electronAPI.testAutomation({
        workspaceId,
        automationName: 'Manual Spotify Snapshot',
        actions: [{
          type: 'prompt',
          agentSlug: 'spotify-analyst',
          prompt: createSpotifySyncPrompt(),
          ...pulseExecutionTarget,
        }],
        permissionMode: 'safe',
        labels: ['spotify', 'artist-hq', 'manual'],
      })
      const action = result.actions.find((candidate) => candidate.type === 'prompt')
      if (!action?.success) throw new Error(action?.stderr || 'Spotify snapshot did not start.')
      toast.success('Spotify Pulse started')
    } catch (error) {
      toast.error('Failed to start Spotify Pulse', {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setSpotifySyncBusy(false)
    }
  }, [pulseExecutionTarget, spotifyAnalyst, workspaceId])

  const toggleInstagramSync = React.useCallback(async () => {
    setInstagramSyncBusy(true)
    try {
      if (instagramSyncAutomation) {
        await window.electronAPI.setAutomationEnabled(
          workspaceId,
          instagramSyncAutomation.event,
          instagramSyncAutomation.matcherIndex,
          !instagramSyncAutomation.enabled,
          'safe',
        )
        toast.success(instagramSyncAutomation.enabled ? 'Instagram sync paused' : 'Instagram sync enabled')
      } else {
        await window.electronAPI.createAutomationFromTemplate(
          workspaceId,
          'SchedulerTick',
          createInstagramSyncMatcher(pulseExecutionTarget),
        )
        toast.success('Weekly Instagram sync enabled')
      }
      await refreshAutomations()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setInstagramSyncBusy(false)
    }
  }, [instagramSyncAutomation, pulseExecutionTarget, refreshAutomations, workspaceId])

  const runInstagramPulse = React.useCallback(async () => {
    if (!socialPublisher) {
      toast.error('Social Publisher is not active in this workspace')
      return
    }
    setInstagramSyncBusy(true)
    try {
      const result = await window.electronAPI.testAutomation({
        workspaceId,
        automationName: 'Manual Instagram Growth Snapshot',
        actions: [{
          type: 'prompt',
          agentSlug: 'social-publisher',
          prompt: createInstagramSyncPrompt(),
          ...pulseExecutionTarget,
        }],
        permissionMode: 'safe',
        labels: ['instagram', 'insights', 'artist-hq', 'manual'],
      })
      const action = result.actions.find((candidate) => candidate.type === 'prompt')
      if (!action?.success) throw new Error(action?.stderr || 'Instagram snapshot did not start.')
      toast.success('Instagram Pulse started')
    } catch (error) {
      toast.error('Failed to start Instagram Pulse', {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setInstagramSyncBusy(false)
    }
  }, [pulseExecutionTarget, socialPublisher, workspaceId])

  const submitCalendarWork = React.useCallback(async (draft: ScheduledWorkComposerDraft) => {
    if (draft.type === 'event') {
      const event = createCalendarEvent({ date: draft.date, title: draft.title, time: draft.time, notes: draft.notes })
      await saveCalendar({ ...calendar, events: [...calendar.events, event], updatedAt: new Date().toISOString() })
      setSelectedDate(event.date)
      toast.success('Event added')
      return
    }
    if (draft.owner.scope === 'hq') {
      const plan = buildHqSchedulePlanFromComposer(draft)
      await window.electronAPI.scheduleHqWork(workspaceId, plan)
      await refreshContext()
      toast.success(`${draft.title} queued in HQ`)
      return
    }
    const plan = buildCampaignSchedulePlanFromComposer(draft)
    if ('orders' in plan) await window.electronAPI.scheduleCampaignWorkChain(draft.owner.workspaceId, plan)
    else await window.electronAPI.scheduleCampaignWork(draft.owner.workspaceId, plan)
    toast.success(`${draft.title} queued in ${primaryCampaignWorkspaceName ?? 'campaign'}`)
  }, [calendar, primaryCampaignWorkspaceName, refreshContext, saveCalendar, workspaceId])

  const openCalendarEventEdit = React.useCallback((event: ArtistCalendarEvent) => {
    setCalendarEditId(event.id)
    setCalendarEditDraft({
      date: event.date,
      title: event.title,
      time: event.time ?? '',
      notes: event.notes ?? '',
    })
  }, [])

  const cancelCalendarEventEdit = React.useCallback(() => {
    setCalendarEditId(null)
    setCalendarEditDraft(emptyCalendarEditDraft)
  }, [])

  const saveCalendarEventEdit = React.useCallback(async (eventId: string) => {
    if (!calendarEditDraft.title.trim()) {
      toast.error('Add an event title first.')
      return
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(calendarEditDraft.date)) {
      toast.error('Use a valid event date.')
      return
    }
    const now = new Date().toISOString()
    const nextCalendar: ArtistCalendar = {
      version: 1,
      events: calendar.events.map((event) => {
        if (event.id !== eventId) return event
        return {
          ...event,
          date: calendarEditDraft.date,
          title: calendarEditDraft.title.trim(),
          time: calendarEditDraft.time.trim() || undefined,
          notes: calendarEditDraft.notes.trim() || undefined,
          google: event.google?.eventId
            ? { ...event.google, syncStatus: 'local-change' as const, error: undefined }
            : event.google,
          updatedAt: now,
        }
      }),
      updatedAt: now,
    }
    try {
      await saveCalendar(nextCalendar)
      cancelCalendarEventEdit()
      toast.success('Event updated')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }, [calendar.events, calendarEditDraft, cancelCalendarEventEdit, saveCalendar])

  const deleteCalendarEvent = React.useCallback(async (eventId: string) => {
    const now = new Date().toISOString()
    const nextCalendar: ArtistCalendar = {
      version: 1,
      events: calendar.events.flatMap((event) => {
        if (event.id !== eventId) return [event]
        if (!event.google?.eventId) return []
        return [{
          ...event,
          deletedAt: now,
          google: {
            ...event.google,
            syncStatus: 'local-change' as const,
            error: undefined,
          },
          updatedAt: now,
        }]
      }),
      updatedAt: now,
    }
    try {
      await saveCalendar(nextCalendar)
      toast.success('Event removed')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }, [calendar.events, saveCalendar])

  const addPerson = React.useCallback(async () => {
    if (!draft.name.trim()) {
      toast.error('Add a name first.')
      return
    }
    if (!network.categories.some((category) => category.id === draft.category)) {
      toast.error('Add or choose a category first.')
      return
    }
    if (draft.email.trim() && !normalizeArtistNetworkEmail(draft.email)) {
      toast.error('Enter a valid email address.')
      return
    }
    const person = createNetworkPerson(draft)
    const nextNetwork: ArtistNetwork = {
      version: 1,
      categories: network.categories,
      people: [...network.people, person],
      updatedAt: new Date().toISOString(),
    }
    try {
      await saveNetwork(nextNetwork)
      setDraft({ ...emptyNetworkDraft, category: nextNetwork.categories[0]?.id ?? '' })
      setDraftOpen(false)
      toast.success('Person added to Network')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }, [draft, network.categories, network.people, saveNetwork])

  const addCategory = React.useCallback(async () => {
    if (!categoryDraft.trim()) {
      toast.error('Name the category first.')
      return
    }
    const nextCategory = createNetworkCategory(categoryDraft, network.categories)
    const nextNetwork: ArtistNetwork = {
      version: 1,
      categories: [...network.categories, nextCategory],
      people: network.people,
      updatedAt: new Date().toISOString(),
    }
    try {
      await saveNetwork(nextNetwork)
      setCategoryDraft('')
      setCategoryFormOpen(false)
      setDraft((value) => ({ ...value, category: nextCategory.id }))
      toast.success('Category added')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }, [categoryDraft, network.categories, network.people, saveNetwork])

  const saveCategoryEdit = React.useCallback(async (categoryId: string) => {
    const label = categoryEditDraft.replace(/\s+/g, ' ').trim()
    if (!label) {
      toast.error('Name the category first.')
      return
    }
    const duplicate = network.categories.some((category) => (
      category.id !== categoryId && category.label.toLowerCase() === label.toLowerCase()
    ))
    if (duplicate) {
      toast.error('That category already exists.')
      return
    }
    const nextNetwork: ArtistNetwork = {
      version: 1,
      categories: network.categories.map((category) => (
        category.id === categoryId ? { ...category, label } : category
      )),
      people: network.people,
      updatedAt: new Date().toISOString(),
    }
    try {
      await saveNetwork(nextNetwork)
      setEditingCategoryId(null)
      setCategoryEditDraft('')
      toast.success('Category updated')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }, [categoryEditDraft, network.categories, network.people, saveNetwork])

  const deleteCategory = React.useCallback(async (categoryId: string) => {
    const category = network.categories.find((item) => item.id === categoryId)
    if (!category) return

    let nextCategories = network.categories.filter((item) => item.id !== categoryId)
    const assignedCount = network.people.filter((person) => person.category === categoryId).length
    let fallback = nextCategories.find((item) => item.id === 'other') ?? nextCategories[0]
    if (assignedCount > 0 && !fallback) {
      fallback = { id: 'other', label: 'Other' }
      nextCategories = [fallback]
    }
    const nextPeople = fallback
      ? network.people.map((person) => (
          person.category === categoryId
            ? { ...person, category: fallback.id, updatedAt: new Date().toISOString() }
            : person
        ))
      : network.people
    const nextNetwork: ArtistNetwork = {
      version: 1,
      categories: nextCategories,
      people: nextPeople,
      updatedAt: new Date().toISOString(),
    }
    try {
      await saveNetwork(nextNetwork)
      const nextCategoryId = fallback?.id ?? nextCategories[0]?.id ?? ''
      setDraft((value) => value.category === categoryId ? { ...value, category: nextCategoryId } : value)
      setEditDraft((value) => value.category === categoryId ? { ...value, category: nextCategoryId } : value)
      setSelectedNetworkCategory((value) => value === categoryId ? null : value)
      setEditingCategoryId(null)
      setCategoryEditDraft('')
      toast.success(assignedCount > 0
        ? `${category.label} deleted · ${assignedCount} ${assignedCount === 1 ? 'person' : 'people'} moved to ${fallback?.label}`
        : `${category.label} deleted`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }, [network.categories, network.people, saveNetwork])

  const openPerson = React.useCallback((person: ArtistNetworkPerson) => {
    setSelectedPersonId(person.id)
    setEditDraft(personToDraft(person))
  }, [])

  const savePerson = React.useCallback(async () => {
    if (!selectedPerson) return
    if (!editDraft.name.trim()) {
      toast.error('Add a name first.')
      return
    }
    if (editDraft.email.trim() && !normalizeArtistNetworkEmail(editDraft.email)) {
      toast.error('Enter a valid email address.')
      return
    }
    const nextNetwork: ArtistNetwork = {
      version: 1,
      categories: network.categories,
      people: network.people.map((person) =>
        person.id === selectedPerson.id ? updateNetworkPerson(person, editDraft) : person,
      ),
      updatedAt: new Date().toISOString(),
    }
    try {
      await saveNetwork(nextNetwork)
      toast.success('Person updated')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }, [editDraft, network.categories, network.people, saveNetwork, selectedPerson])

  const deletePerson = React.useCallback(async () => {
    if (!selectedPerson) return
    const nextNetwork: ArtistNetwork = {
      version: 1,
      categories: network.categories,
      people: network.people.filter((person) => person.id !== selectedPerson.id),
      updatedAt: new Date().toISOString(),
    }
    try {
      await saveNetwork(nextNetwork)
      setSelectedPersonId(null)
      toast.success('Person removed')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }, [network.categories, network.people, saveNetwork, selectedPerson])

  const togglePersonStar = React.useCallback(async (person: ArtistNetworkPerson) => {
    const starred = !person.starred
    const nextNetwork: ArtistNetwork = {
      version: 1,
      categories: network.categories,
      people: network.people.map((item) => (
        item.id === person.id ? { ...item, starred, updatedAt: new Date().toISOString() } : item
      )),
      updatedAt: new Date().toISOString(),
    }
    try {
      await saveNetwork(nextNetwork)
      toast.success(starred ? `${person.name} starred` : `${person.name} unstarred`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }, [network.categories, network.people, saveNetwork])

  const filteredPeople = React.useMemo(() => {
    const needle = query.trim().toLowerCase()
    return network.people.filter((person) => {
      if (selectedNetworkCategory && person.category !== selectedNetworkCategory) return false
      if (!needle) return true
      return [
        person.name,
        person.role,
        person.email,
        person.location,
        person.canHelpWith,
        person.notes,
        ...person.tags,
      ].filter(Boolean).join(' ').toLowerCase().includes(needle)
    }).sort((left, right) => (
      Number(Boolean(right.starred)) - Number(Boolean(left.starred))
      || left.name.localeCompare(right.name)
    ))
  }, [network.people, query, selectedNetworkCategory])

  const artistName = profile.artistName || workspaceName || 'Artist HQ'
  const nextDate = hqHeaderNextLabel(hqState?.nextMove.title, thisWeekItems)

  // Dynamic header properties based on active tab
  const getHeaderProps = () => {
    switch (tab) {
      case 'calendar':
        return {
          title: 'Calendar',
          label: 'Schedule',
        }
      case 'network':
        return {
          title: 'Network',
          label: 'Contacts',
        }
      case 'signals':
        return {
          title: 'Signals',
          label: 'Intelligence',
        }
      case 'profile':
        return {
          title: 'Profile',
          label: 'Context',
        }
      case 'voice':
        return {
          title: 'Voice',
          label: 'Style',
        }
      case 'branding':
        return {
          title: 'Branding',
          label: 'Brain',
        }
      default:
        return {
          title: artistName,
          label: 'Artist HQ',
        }
    }
  }

  const headerProps = getHeaderProps()
  const headerTone = tab === 'profile' || tab === 'branding' ? 'blue' : tab === 'voice' ? 'red' : 'orange'
  return (
    <div className={cn('h-full bg-[#050505] text-foreground', tab === 'calendar' ? 'overflow-hidden' : 'overflow-y-auto')}>
      <div className={cn(
        'mx-auto flex w-full max-w-[1600px] flex-col gap-3 px-5 py-4 xl:px-8 xl:py-5',
        tab === 'calendar' ? 'h-full min-h-0' : 'min-h-full',
      )}>
        {tab !== 'calendar' && tab !== 'network' ? (
        <CompactPageHeader
          eyebrow={headerProps.label}
          title={headerProps.title}
          tone={headerTone}
          backgroundImage={tab === 'home' ? bannerImageDataUrl : null}
          dimBackgroundImage={SHOW_HQ_BANNER_FILTER}
          borderless={tab === 'home'}
          hero={tab === 'home'}
          titleClassName={tab === 'home' ? 'text-[52px]' : undefined}
          className={tab === 'home' ? "after:pointer-events-none after:absolute after:inset-0 after:z-[9] after:rounded-[inherit] after:ring-2 after:ring-inset after:ring-[#050505] after:content-['']" : undefined}
          actions={
            <>
              {tab !== 'signals' ? (
                <div className="hidden min-w-0 text-right sm:block">
                  <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-white/38">Next</p>
                  <p className="mt-1 max-w-48 truncate text-[11px] font-medium text-white/72">{nextDate}</p>
                </div>
              ) : null}
              {tab === 'home' ? (
                <>
                  {bannerImageDataUrl ? (
                    <button
                      type="button"
                      onClick={removeBannerImage}
                      disabled={bannerImageBusy}
                      aria-label="Remove HQ banner"
                      title="Remove HQ banner"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] border border-white/[0.1] bg-black/35 text-white/48 backdrop-blur-md transition-colors hover:bg-black/55 hover:text-red-100/80 disabled:cursor-wait disabled:opacity-45"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={chooseBannerImage}
                    disabled={bannerImageBusy}
                    aria-label={bannerImageDataUrl ? 'Replace HQ banner' : 'Add HQ banner'}
                    title={bannerImageDataUrl ? 'Replace HQ banner' : 'Add HQ banner'}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] border border-white/[0.1] bg-black/35 text-white/58 backdrop-blur-md transition-colors hover:bg-black/55 hover:text-white/90 disabled:cursor-wait disabled:opacity-45"
                  >
                    <ImagePlus className="h-4 w-4" />
                  </button>
                </>
              ) : null}
            </>
          }
        />
        ) : null}

        <ArtistManagerVoiceDialog voice={managerVoice} />

        {tab === 'home' && (
          <div id="hq-home-operations" className="space-y-3">
            <ManagerAskBar
              busy={managerAskBusy}
              onAsk={askManager}
              onVoice={() => managerVoice.setOpen(true)}
            />

            <div id="hq-home-details">
              <SignalsStrip
                spotifySnapshot={spotifySnapshot}
                spotifyHistory={spotifyHistory}
                spotifyPublicApi={spotifyIsPublicApi}
                spotifyActive={spotifySyncActive}
                spotifyBusy={spotifySyncBusy}
                spotifyRunDisabled={!spotifyAnalyst}
                spotifyError={spotifyResult.ok ? null : spotifyResult.error}
                onToggleSpotify={toggleSpotifySync}
                onRunSpotify={runSpotifyPulse}
                socialDoctor={socialAccounts}
                instagramSnapshot={instagramSnapshot}
                instagramHistory={instagramHistory}
                instagramActive={instagramSyncActive}
                instagramBusy={socialAccountsBusy || instagramSyncBusy}
                instagramRunDisabled={!socialPublisher}
                instagramError={socialAccountsError || (instagramResult.ok ? null : instagramResult.error)}
                onRunInstagram={runInstagramPulse}
                onToggleInstagram={toggleInstagramSync}
                onManageSocial={() => navigate(routes.view.settings('social-accounts'))}
              />
            </div>

            <ReleaseHorizon
              campaigns={campaignWorkspaces}
              northStar={profile.mission}
              plan={releaseHorizon}
              timelineEntries={horizonTimelineEntries}
              timelineTimezone={timelineTimezone}
              loadCampaignMonthSchedule={loadCampaignMonthSchedule}
              onOpenCampaign={onOpenCampaignWorkspace ?? (
                primaryCampaignWorkspaceId && onOpenPrimaryCampaignWorkspace
                  ? () => onOpenPrimaryCampaignWorkspace()
                  : undefined
              )}
              onSaveNorthStar={saveReleaseNorthStar}
              onSaveMonthPlan={saveReleaseMonthPlan}
            />

            <StateOfPlayPanel
              state={hqState}
              workerItems={workerItems}
              recentOutputs={outputs}
              recentLoading={outputsLoading}
              workspaceId={workspaceId}
              proactiveMode={proactiveMode}
              proactiveBusy={managerCheckInBusy}
              routeBusy={hqRouteBusy}
              refreshBusy={hqRefreshBusy}
              availableAgentSlugs={new Set(availableAgents.map((agent) => agent.slug))}
              onToggleProactiveMode={(enabled) => { void toggleProactiveMode(enabled) }}
              onLaunchRoute={launchHqRoute}
              onOpenEntity={openHqStateEntity}
              onTransitionRecommendation={transitionHqRecommendation}
              onRefresh={refreshHqState}
              onOpenManagerSource={openManagerSource}
            />
          </div>
        )}

        {tab === 'profile' && (
          <HQCard>
            <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <SectionTitle icon={UserRound} title="Profile" meta={`${profilePercent}% complete`} compact bright />
                <p className="mt-2 max-w-2xl text-xs leading-5 text-white/42">
                  Global context every worker should know before touching campaigns, content, research, ads, or outreach.
                </p>
              </div>
              <button
                type="button"
                onClick={saveProfile}
                disabled={!profileResult.ok}
                className="h-9 rounded-full bg-white/90 px-5 text-xs font-semibold text-black hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                Save Profile
              </button>
            </div>

            {!profileResult.ok ? (
              <div className="mb-4 rounded-[14px] border border-red-400/20 bg-red-500/10 p-3 text-xs leading-5 text-red-100/80">
                {profileResult.error} Saving is paused so existing artist context is not overwritten.
              </div>
            ) : null}

            <ArtistProfileForm draft={profileDraft} onChange={setProfileDraft} />
          </HQCard>
        )}

        {tab === 'voice' && (
          <HQCard>
            <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <SectionTitle icon={MessageSquareText} title="Voice" meta={`${voicePercent}% complete`} compact bright />
                <p className="mt-2 max-w-2xl text-xs leading-5 text-white/42">
                  This is routed into posting and content workers so captions, hooks, ads, and replies sound like the artist.
                </p>
              </div>
              <button
                type="button"
                onClick={saveVoice}
                disabled={!voiceResult.ok}
                className="h-9 rounded-full bg-white/90 px-5 text-xs font-semibold text-black hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                Save Voice
              </button>
            </div>

            {!voiceResult.ok ? (
              <div className="mb-4 rounded-[14px] border border-red-400/20 bg-red-500/10 p-3 text-xs leading-5 text-red-100/80">
                {voiceResult.error} Saving is paused so existing voice context is not overwritten.
              </div>
            ) : null}

            <ArtistVoiceForm draft={voiceDraft} onChange={setVoiceDraft} />
          </HQCard>
        )}

        {tab === 'calendar' && (
          <>
          <CompactPageHeader
            eyebrow="Artist HQ"
            title="Plan"
            tone="orange"
            actions={
              <>
                <button
                  type="button"
                  onClick={connectGoogleCalendar}
                  disabled={googleCalendarBusy}
                  className="h-7 rounded-[6px] border border-white/[0.10] bg-black/15 px-2.5 text-[9px] font-medium text-white/62 transition-colors hover:bg-white/[0.06] hover:text-white/82 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {googleCalendarConnected ? 'Reconnect Google' : 'Connect Google'}
                </button>
                <button
                  type="button"
                  onClick={syncGoogleCalendar}
                  disabled={!calendarResult.ok || !scheduledWorkResult.ok || googleCalendarBusy}
                  className="inline-flex h-7 items-center gap-1.5 rounded-[6px] bg-white/90 px-2.5 text-[9px] font-medium text-black transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <RefreshCw className={cn('h-3 w-3', googleCalendarBusy && 'animate-spin')} />
                  Sync
                </button>
              </>
            }
          />
          <HQCard className="flex min-h-0 flex-1 flex-col overflow-hidden border-white/[0.08] bg-[#050505] p-0">
            {!calendarResult.ok ? (
              <div className="mx-3 mt-3 rounded-[10px] border border-red-400/20 bg-red-500/10 p-3 text-xs leading-5 text-red-100/80">
                {calendarResult.error} Saving is paused so existing calendar context is not overwritten.
              </div>
            ) : null}
            {!scheduledWorkResult.ok ? (
              <div className="mx-3 mt-3 rounded-[10px] border border-red-400/20 bg-red-500/10 p-3 text-xs leading-5 text-red-100/80">
                {scheduledWorkResult.error} Queueing is paused so existing scheduled work is not overwritten.
              </div>
            ) : null}
            <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[minmax(0,2.15fr)_minmax(300px,0.85fr)]">
              <div className="flex min-h-[430px] min-w-0 flex-col p-3 lg:min-h-0 lg:pr-4">
                <ArtistCalendarView
                  compact
                  events={activeCalendarEvents}
                  selectedDate={selectedDate}
                  visibleMonth={visibleMonth}
                  disabled={!calendarResult.ok || !scheduledWorkResult.ok}
                  onSelectDate={setSelectedDate}
                  onChangeMonth={setVisibleMonth}
                  editingEventId={calendarEditId}
                  editDraft={calendarEditDraft}
                  onChangeEditDraft={setCalendarEditDraft}
                  onEditEvent={openCalendarEventEdit}
                  onCancelEditEvent={cancelCalendarEventEdit}
                  onSaveEditEvent={saveCalendarEventEdit}
                  onDeleteEvent={deleteCalendarEvent}
                  onQueueHqWork={(type) => {
                    setCalendarComposerType(type)
                    setCalendarComposerTarget('hq')
                  }}
                  selectedDateEvents={selectedDateEvents}
                  workById={scheduledWorkById}
                  workspaceId={workspaceId}
                />
              </div>
              {onCreateAgendaTask && onDeleteAgendaTask ? (
                <div id="plan-kanban" className="min-h-[280px] overflow-hidden border-t border-white/[0.07] bg-[#17191B] lg:min-h-0 lg:border-l lg:border-t-0">
                  <AgendaPage
                    embedded
                    sessions={agendaSessions}
                    onCreateTask={onCreateAgendaTask}
                    onDeleteTask={onDeleteAgendaTask}
                    workspaceId={workspaceId}
                    networkWorkspaceId={workspaceId}
                  />
                </div>
              ) : null}
            </div>
            <ScheduledWorkComposer
              open={calendarComposerTarget !== null}
              entry={calendarComposerEntry}
              disabled={!calendarResult.ok || !scheduledWorkResult.ok}
              onOpenChange={(open) => { if (!open) setCalendarComposerTarget(null) }}
              onSubmit={submitCalendarWork}
              allowedTypes={calendarComposerTarget === 'hq' ? ['event', 'agent-task', 'workflow-run'] : undefined}
              allowFollowUps={calendarComposerTarget !== 'hq'}
            />
          </HQCard>
          </>
        )}

        {tab === 'network' && (
          <>
            <PeoplePageHeader
              activeView="network"
              onSelectView={(view) => {
                if (view === 'community') navigate(routes.view.community())
              }}
            />
            <HQCard>
            <NetworkCategoryGrid
              categories={network.categories}
              allPeople={network.people}
              selectedCategoryId={selectedNetworkCategory}
              onToggleCategory={(categoryId) => {
                setSelectedNetworkCategory((value) => value === categoryId ? null : categoryId)
              }}
              onAddToCategory={(categoryId) => {
                setDraft({ ...emptyNetworkDraft, category: categoryId })
                setDraftOpen(true)
              }}
            />
            <div className={cn(categoryFormOpen ? 'mb-3' : 'mb-7', 'flex w-full items-center justify-end gap-2')}>
              <div className="relative min-w-0 flex-1 sm:flex-none">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/28" />
                <input
                  aria-label="Search people"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search people..."
                  className="h-9 w-full rounded-full bg-white/[0.045] pl-8 pr-3 text-xs text-white/75 outline-none placeholder:text-white/28 transition-colors focus:bg-white/[0.07] sm:w-56"
                />
              </div>
              <button
                type="button"
                onClick={() => setCategoryFormOpen((value) => !value)}
                aria-expanded={categoryFormOpen}
                className="inline-flex h-9 shrink-0 items-center rounded-full bg-white/[0.055] px-3.5 text-xs font-medium text-white/62 transition-colors hover:bg-white/[0.09] hover:text-white/82"
              >
                Categories
              </button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="Add person"
                    aria-expanded={draftOpen}
                    onClick={() => {
                      const category = selectedNetworkCategory
                        ?? (network.categories.some((item) => item.id === draft.category) ? draft.category : network.categories[0]?.id)
                        ?? ''
                      setDraft({ ...emptyNetworkDraft, category })
                      setDraftOpen(true)
                    }}
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/90 text-black transition-colors hover:bg-white"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Add person</TooltipContent>
              </Tooltip>
            </div>

            {categoryFormOpen && (
              <div className="mb-7 max-w-2xl rounded-[14px] bg-white/[0.035] p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[11px] font-medium text-white/62">Categories</span>
                  <button
                    type="button"
                    aria-label="Close categories"
                    onClick={() => {
                      setCategoryDraft('')
                      setEditingCategoryId(null)
                      setCategoryEditDraft('')
                      setCategoryFormOpen(false)
                    }}
                    className="grid h-7 w-7 place-items-center rounded-[8px] text-white/34 transition-colors hover:bg-white/[0.06] hover:text-white/70"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="mt-2 flex max-w-sm items-center gap-2">
                  <Input
                    autoFocus
                    value={categoryDraft}
                    onChange={setCategoryDraft}
                    placeholder="New category"
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void addCategory()
                      if (event.key === 'Escape') setCategoryDraft('')
                    }}
                  />
                  <button
                    type="button"
                    onClick={addCategory}
                    disabled={!networkResult.ok || !categoryDraft.trim()}
                    className="h-9 shrink-0 rounded-[9px] bg-white/90 px-3 text-xs font-medium text-black transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Add
                  </button>
                </div>
                <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
                  {network.categories.map((category) => {
                    const count = network.people.filter((person) => person.category === category.id).length
                    const editing = editingCategoryId === category.id
                    return (
                      <div key={category.id} className="flex h-9 min-w-0 items-center gap-2 rounded-[9px] bg-black/20 px-2.5">
                        {editing ? (
                          <>
                            <input
                              autoFocus
                              aria-label={`Rename ${category.label}`}
                              value={categoryEditDraft}
                              onChange={(event) => setCategoryEditDraft(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') void saveCategoryEdit(category.id)
                                if (event.key === 'Escape') {
                                  setEditingCategoryId(null)
                                  setCategoryEditDraft('')
                                }
                              }}
                              className="min-w-0 flex-1 bg-transparent text-xs text-white/80 outline-none"
                            />
                            <button type="button" onClick={() => saveCategoryEdit(category.id)} className="text-[10px] font-medium text-white/65 hover:text-white">Save</button>
                          </>
                        ) : (
                          <>
                            <span className="min-w-0 flex-1 truncate text-xs text-white/66">{category.label}</span>
                            <span className="text-[10px] tabular-nums text-white/24">{count}</span>
                            <button
                              type="button"
                              aria-label={`Rename ${category.label}`}
                              onClick={() => {
                                setEditingCategoryId(category.id)
                                setCategoryEditDraft(category.label)
                              }}
                              className="grid h-7 w-7 place-items-center rounded-[7px] text-white/28 transition-colors hover:bg-white/[0.06] hover:text-white/65"
                            >
                              <Pencil className="h-3 w-3" />
                            </button>
                            <button
                              type="button"
                              aria-label={`Delete ${category.label}`}
                              onClick={() => deleteCategory(category.id)}
                              className="grid h-7 w-7 place-items-center rounded-[7px] text-white/24 transition-colors hover:bg-red-500/10 hover:text-red-300/75"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            <Dialog
              open={draftOpen}
              onOpenChange={(open) => {
                setDraftOpen(open)
                if (!open) {
                  setDraft({
                    ...emptyNetworkDraft,
                    category: selectedNetworkCategory ?? network.categories[0]?.id ?? '',
                  })
                }
              }}
            >
              <DialogContent className="w-[min(560px,calc(100vw-2rem))] max-w-[560px] border-white/[0.08] bg-[#0C0D0E] p-0 text-white shadow-modal-small">
                <DialogHeader className="border-b border-white/[0.06] px-5 py-4 pr-14 text-left">
                  <DialogTitle className="text-lg font-medium tracking-[-0.02em]">Add person</DialogTitle>
                  <DialogDescription className="text-xs text-white/38">
                    {network.categories.find((category) => category.id === draft.category)?.label ?? 'Choose a category'}
                  </DialogDescription>
                </DialogHeader>
                <form
                  className="space-y-3 p-5"
                  onSubmit={(event) => {
                    event.preventDefault()
                    void addPerson()
                  }}
                >
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Input autoFocus value={draft.name} onChange={(name) => setDraft((value) => ({ ...value, name }))} placeholder="Name" />
                    <select
                      value={draft.category}
                      onChange={(event) => setDraft((value) => ({ ...value, category: event.target.value as ArtistNetworkCategory }))}
                      className="h-9 rounded-[10px] border border-white/[0.06] bg-black/30 px-3 text-xs text-white/75 outline-none"
                    >
                      {network.categories.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}
                    </select>
                    <Input value={draft.role} onChange={(role) => setDraft((value) => ({ ...value, role }))} placeholder="Role" />
                    <Input type="email" value={draft.email} onChange={(email) => setDraft((value) => ({ ...value, email }))} placeholder="Email" />
                    <Input value={draft.canHelpWith} onChange={(canHelpWith) => setDraft((value) => ({ ...value, canHelpWith }))} placeholder="Can help with" />
                    <Input value={draft.tags} onChange={(tags) => setDraft((value) => ({ ...value, tags }))} placeholder="Tags, comma separated" />
                  </div>
                  <textarea
                    value={draft.notes}
                    onChange={(event) => setDraft((value) => ({ ...value, notes: event.target.value }))}
                    placeholder="Notes"
                    className="min-h-[84px] w-full rounded-[10px] border border-white/[0.06] bg-black/25 px-3 py-2 text-xs leading-5 text-white/75 outline-none placeholder:text-white/28 focus:border-white/16"
                  />
                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setDraft({
                          ...emptyNetworkDraft,
                          category: selectedNetworkCategory ?? network.categories[0]?.id ?? '',
                        })
                        setDraftOpen(false)
                      }}
                      className="h-9 rounded-[9px] px-3 text-xs font-medium text-white/52 transition-colors hover:bg-white/[0.05] hover:text-white/78"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={!networkResult.ok || network.categories.length === 0 || !draft.name.trim()}
                      className="h-9 rounded-[9px] bg-white/90 px-4 text-xs font-medium text-black transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Add person
                    </button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>

            {!networkResult.ok ? (
              <div className="mb-4 rounded-[14px] border border-red-400/20 bg-red-500/10 p-3 text-xs leading-5 text-red-100/80">
                {networkResult.error} Saving is paused so existing relationship context is not overwritten.
              </div>
            ) : null}

              <NetworkBoard
                categories={network.categories}
                people={filteredPeople}
                selectedCategoryId={selectedNetworkCategory}
                onSelectPerson={openPerson}
                onTogglePersonStar={togglePersonStar}
              />
            </HQCard>
          </>
        )}

        {tab === 'branding' && (
          <HQCard>
            <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <SectionTitle icon={Sparkles} title="Branding" meta={`${brandingPercent}% complete`} compact bright />
                <p className="mt-2 max-w-2xl text-xs leading-5 text-white/42">
                  Brand DNA for positioning, mythology, campaign ideas, creative direction, and future branding workers.
                </p>
              </div>
              <button
                type="button"
                onClick={saveBranding}
                disabled={!brandingResult.ok}
                className="h-9 rounded-full bg-white/90 px-5 text-xs font-semibold text-black hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                Save Branding
              </button>
            </div>

            {!brandingResult.ok ? (
              <div className="mb-4 rounded-[14px] border border-red-400/20 bg-red-500/10 p-3 text-xs leading-5 text-red-100/80">
                {brandingResult.error} Saving is paused so existing branding context is not overwritten.
              </div>
            ) : null}

            <ArtistBrandingForm draft={brandingDraft} onChange={setBrandingDraft} />
          </HQCard>
        )}

        {tab === 'signals' && (
          <section className="space-y-3" aria-label="Signals intelligence reader">
            <div className="flex flex-wrap items-center justify-between gap-3 px-1">
              <div className="flex min-w-0 items-center gap-2.5 text-[11px] text-white/42">
                <span className={cn('h-1.5 w-1.5 rounded-full', intelSyncActive ? 'bg-emerald-300' : 'bg-white/24')} />
                <span>{intelSyncActive ? 'Weekly intelligence active' : 'Weekly intelligence paused'}</span>
                {latestSignalDate ? (
                  <span className="hidden sm:inline">· Latest {formatSignalDate(latestSignalDate)}</span>
                ) : null}
                {latestSignalFreshness?.status === 'aging' ? <span className="text-amber-200/60">· Aging</span> : null}
                {latestSignalFreshness?.status === 'stale' ? <span className="text-orange-200/70">· Stale</span> : null}
              </div>
              <div className="flex items-center gap-2">
                <label className="inline-flex h-8 items-center gap-2 rounded-[9px] bg-white/[0.035] px-2.5 text-[11px] text-white/58">
                  Weekly
                  <Switch checked={intelSyncActive} onCheckedChange={() => { void toggleIntelPulse() }} disabled={intelBusy} />
                </label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => setIntelConfigOpen(true)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-[9px] bg-white/[0.035] text-white/48 transition-colors hover:bg-white/[0.07] hover:text-white/82"
                      aria-label="Edit intelligence sources"
                    >
                      <SlidersHorizontal className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs">Edit YouTube channels</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <button
                        type="button"
                        onClick={() => { void runIntelPulse() }}
                        disabled={intelBusy || Boolean(signalRunDisabledReason)}
                        className="inline-flex h-8 items-center gap-2 rounded-[9px] bg-white/90 px-3 text-[11px] font-semibold text-black transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {intelBusy ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5 fill-current" />}
                        Run intelligence
                      </button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs text-xs">
                    {signalRunDisabledReason || 'Run the YouTube, platform, and industry collectors now.'}
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>

            {signalNotice ? (
              <div
                aria-live="polite"
                className={cn(
                  'flex items-start gap-2.5 rounded-[12px] px-3.5 py-2.5 text-xs',
                  signalNotice.tone === 'error' && 'bg-red-500/[0.09] text-red-100/82',
                  signalNotice.tone === 'partial' && 'bg-amber-400/[0.08] text-amber-50/76',
                  signalNotice.tone === 'stale' && 'bg-orange-400/[0.08] text-orange-50/74',
                  signalNotice.tone === 'running' && 'bg-white/[0.035] text-white/64',
                )}
              >
                {signalNotice.tone === 'running'
                  ? <RefreshCw className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" />
                  : <Radio className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                <div className="min-w-0">
                  <div className="font-medium text-current">{signalNotice.title}</div>
                  {signalNotice.detail ? <div className="mt-0.5 line-clamp-2 text-current opacity-65" title={signalNotice.detail}>{signalNotice.detail}</div> : null}
                </div>
              </div>
            ) : null}

            <div className="relative min-h-[520px] overflow-hidden rounded-[20px] bg-[#111214]/88 shadow-strong ring-1 ring-white/[0.07] backdrop-blur-2xl">
              <div
                className="pointer-events-none absolute inset-0 opacity-90"
                style={{
                  backgroundImage: 'radial-gradient(90% 68% at 50% 116%, rgba(249,115,22,0.12) 0%, rgba(249,115,22,0.025) 44%, transparent 72%), linear-gradient(180deg, rgba(255,255,255,0.045) 0%, rgba(255,255,255,0.012) 44%, rgba(0,0,0,0.14) 100%)',
                }}
              />
              <div className="relative flex min-h-[520px] flex-col">
                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/[0.055] px-5 py-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.16em] text-white/34">
                      <Radio className="h-3 w-3 text-orange-300/75" />
                      {selectedSignalItem?.kind === 'output' ? 'Intelligence report' : 'Saved intelligence'}
                    </div>
                    <h2 className="mt-2 truncate text-[18px] font-medium tracking-tight text-white/90">
                      {selectedSignalItem?.title || 'Signals'}
                    </h2>
                    {selectedSignalItem ? (
                      <p className="mt-1 line-clamp-1 max-w-3xl text-xs leading-5 text-white/42">
                        {selectedSignalItem.summary}{selectedSignalItem.date ? ` · ${formatSignalDate(selectedSignalItem.date)}` : ''}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {selectedSignalText ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={() => { void saveSignalNugget() }}
                            disabled={signalNuggetBusy}
                            className="inline-flex h-8 items-center gap-2 rounded-[9px] bg-orange-500/14 px-2.5 text-[11px] font-medium text-orange-200 transition-colors hover:bg-orange-500/22 disabled:opacity-40"
                          >
                            {signalNuggetBusy ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Diamond className="h-3.5 w-3.5" />}
                            Save selection
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="text-xs">Add to the dated Signal Nuggets document</TooltipContent>
                      </Tooltip>
                    ) : null}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="inline-flex h-8 items-center gap-2 rounded-[9px] bg-white/[0.04] px-2.5 text-[11px] text-white/58 transition-colors hover:bg-white/[0.075] hover:text-white/86"
                        >
                          <Library className="h-3.5 w-3.5" />
                          Library
                          <ChevronDown className="h-3 w-3" />
                        </button>
                      </DropdownMenuTrigger>
                      <StyledDropdownMenuContent align="end" className="w-80">
                        {signalLibraryItems.length ? signalLibraryItems.map((item) => (
                          <StyledDropdownMenuItem key={item.key} onClick={() => setSelectedSignalKey(item.key)} className="flex-col items-start gap-0.5 py-2.5">
                            <span className="w-full truncate text-xs text-white/82">{item.title}</span>
                            <span className="w-full truncate text-[10px] text-white/36">{item.date ? formatSignalDate(item.date) : item.summary}</span>
                          </StyledDropdownMenuItem>
                        )) : (
                          <StyledDropdownMenuItem disabled>No reports yet</StyledDropdownMenuItem>
                        )}
                      </StyledDropdownMenuContent>
                    </DropdownMenu>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => setSignalFullscreenOpen(true)}
                          disabled={!selectedSignalContent}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-[9px] bg-white/[0.04] text-white/48 transition-colors hover:bg-white/[0.075] hover:text-white/86 disabled:opacity-30"
                          aria-label="Read full report"
                        >
                          <Maximize2 className="h-3.5 w-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="text-xs">Read full report</TooltipContent>
                    </Tooltip>
                    {selectedSignalItem?.output ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={() => navigate(routes.view.output(selectedSignalItem.output!.id))}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-[9px] bg-white/[0.04] text-white/48 transition-colors hover:bg-white/[0.075] hover:text-white/86"
                            aria-label="Open source output"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="text-xs">Open source output</TooltipContent>
                      </Tooltip>
                    ) : null}
                  </div>
                </div>

                <div ref={signalReaderRef} onMouseUp={captureSignalSelection} className="min-h-0 flex-1 overflow-y-auto px-1 py-5 selection:bg-orange-400/30">
                  {signalContentLoading ? (
                    <div className="flex h-72 items-center justify-center text-white/34">
                      <RefreshCw className="h-4 w-4 animate-spin" />
                    </div>
                  ) : selectedSignalContent ? (
                    <Info_Markdown className="mx-auto max-w-[900px] px-6 pb-10 text-[14px] leading-7 text-white/70 [&_h1]:text-[24px] [&_h2]:mt-8 [&_h2]:text-[17px] [&_p]:leading-7">
                      {selectedSignalContent}
                    </Info_Markdown>
                  ) : (
                    <div className="flex h-72 flex-col items-center justify-center px-6 text-center">
                      <Radio className="h-5 w-5 text-orange-300/60" />
                      <p className="mt-3 text-sm font-medium text-white/72">No intelligence reports yet</p>
                      <p className="mt-1 text-xs text-white/36">Run intelligence to create the first brief.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>
        )}
      </div>
      {selectedPerson ? (
        <PersonDetailPanel
          person={selectedPerson}
          draft={editDraft}
          categories={network.categories}
          onChange={setEditDraft}
          onClose={() => setSelectedPersonId(null)}
          onSave={savePerson}
          onDelete={deletePerson}
          disabled={!networkResult.ok}
        />
      ) : null}
      <DocumentFormattedMarkdownOverlay
        content={selectedSignalContent}
        isOpen={signalFullscreenOpen}
        onClose={() => setSignalFullscreenOpen(false)}
        typeBadge={{ label: 'Signals', icon: Radio }}
      />
      <IntelConfigDialog
        open={intelConfigOpen}
        config={intelConfig}
        onOpenChange={setIntelConfigOpen}
        onSave={async (nextConfig) => {
          try {
            const nextScheduled = nextConfig.enabled && nextConfig.cadence === 'weekly'
            if (nextScheduled) {
              await ensureSignalScanReady()
            }
            await saveIntelConfigWithAutomationRollback({
              previousConfig: intelConfig,
              nextConfig,
              saveConfig: saveIntelConfig,
              mutateAutomation: async () => {
                const currentMatcher = intelSyncAutomation ? requireAutomationMatcher(intelSyncAutomation) : null
                if (nextScheduled) {
                  if (intelSyncAutomation) {
                    await window.electronAPI.replaceAutomation(
                      workspaceId,
                      intelSyncAutomation.event,
                      intelSyncAutomation.id,
                      currentMatcher!,
                      createIntelSyncMatcher(workspaceName || 'Artist HQ', signalScanWorkflowDigest, nextConfig),
                    )
                  } else {
                    await window.electronAPI.createAutomationFromTemplate(
                      workspaceId,
                      'SchedulerTick',
                      createIntelSyncMatcher(workspaceName || 'Artist HQ', signalScanWorkflowDigest, nextConfig),
                    )
                  }
                } else if (intelSyncAutomation) {
                  await window.electronAPI.replaceAutomation(
                    workspaceId,
                    intelSyncAutomation.event,
                    intelSyncAutomation.id,
                    currentMatcher!,
                    { ...currentMatcher!, enabled: false },
                  )
                }
              },
            })
            await refreshAutomations()
            toast.success('Signal settings saved')
            setIntelConfigOpen(false)
          } catch (error) {
            toast.error(error instanceof Error ? error.message : String(error))
          }
        }}
      />
    </div>
  )
}

function HQCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-2xl border border-white/[0.025] bg-[#0C0D0E] p-4', className)}>
      {children}
    </section>
  )
}

function SectionTitle({
  icon: Icon,
  title,
  meta,
  compact,
  bright,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  meta?: string
  compact?: boolean
  bright?: boolean
}) {
  return (
    <div className={cn('flex items-center justify-between gap-3', compact ? '' : 'mb-3 pb-1')}>
      <div className="flex items-center gap-2">
        <Icon className={cn('h-3 w-3', bright ? 'text-white/78' : 'text-white/58')} />
        <h3 className={cn('text-[9px] font-medium uppercase tracking-[0.15em]', bright ? 'text-white/92' : 'text-white/76')}>{title}</h3>
      </div>
      {meta ? <span className={cn('text-[8px] font-medium uppercase tracking-widest', bright ? 'text-white/64' : 'text-white/48')}>{meta}</span> : null}
    </div>
  )
}

function PulseRunControls({
  active,
  busy,
  runDisabled = false,
  manualLabel,
  weeklyLabel,
  activeClassName,
  onRun,
  onToggle,
}: {
  active: boolean
  busy: boolean
  runDisabled?: boolean
  manualLabel: string
  weeklyLabel: string
  activeClassName: string
  onRun: () => void
  onToggle: () => void
}) {
  const weeklyTooltip = active
    ? `${weeklyLabel} is on — click to pause`
    : `${weeklyLabel} is off — click to enable`

  return (
    <div
      className="inline-flex h-7 shrink-0 items-stretch divide-x divide-white/[0.08] overflow-hidden rounded-[7px] border border-white/[0.09] bg-white/[0.035]"
      aria-label="Pulse run controls"
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onRun()
            }}
            disabled={busy || runDisabled}
            title={manualLabel}
            aria-label={manualLabel}
            className="inline-flex h-full w-7 items-center justify-center text-white/58 transition-colors hover:bg-white/[0.08] hover:text-white/90 disabled:cursor-not-allowed disabled:opacity-35"
          >
            <Play className="h-3 w-3 fill-current" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{manualLabel}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onToggle()
            }}
            disabled={busy}
            title={weeklyTooltip}
            aria-label={weeklyTooltip}
            aria-pressed={active}
            className={cn(
              'inline-flex h-full w-7 items-center justify-center transition-colors',
              active
                ? activeClassName
                : 'text-white/28 hover:bg-white/[0.05] hover:text-white/60',
              busy && 'cursor-wait opacity-55',
            )}
          >
            <CalendarClock className="h-3 w-3" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{weeklyTooltip}</TooltipContent>
      </Tooltip>
    </div>
  )
}

function ManagerAskBar({
  busy,
  onAsk,
  onVoice,
}: {
  busy: boolean
  onAsk: (text: string) => Promise<void>
  onVoice: () => void
}) {
  const [value, setValue] = React.useState('')
  const submit = async () => {
    const text = value.trim()
    if (!text || busy) return
    await onAsk(text)
    setValue('')
  }
  return (
    <form
      onSubmit={(event) => { event.preventDefault(); void submit() }}
      className="flex h-11 items-center gap-2 rounded-[14px] border border-white/[0.075] bg-white/[0.035] pl-4 pr-2 backdrop-blur-2xl focus-within:border-[#f97316]/40"
    >
      <Sparkles className="h-3.5 w-3.5 shrink-0 text-[#f97316]/80" />
      <input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Tell your manager what you need…"
        aria-label="Tell your manager"
        disabled={busy}
        className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-white/88 outline-none placeholder:text-white/30 disabled:opacity-60"
      />
      <button
        type="button"
        onClick={onVoice}
        aria-label="Talk to Artist Manager"
        title="Talk to Artist Manager"
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] text-white/45 transition-colors hover:bg-white/[0.06] hover:text-white/90"
      >
        <Mic className="h-3.5 w-3.5" />
      </button>
      <button
        type="submit"
        disabled={busy || !value.trim()}
        aria-label="Send to Artist Manager"
        title="Send to Artist Manager"
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-[#f97316] text-black transition-colors hover:bg-[#fb8a3c] disabled:cursor-not-allowed disabled:bg-white/[0.06] disabled:text-white/30"
      >
        <Send className="h-3.5 w-3.5" />
      </button>
    </form>
  )
}

function SignalsStrip({
  spotifySnapshot,
  spotifyHistory,
  spotifyPublicApi,
  spotifyActive,
  spotifyBusy,
  spotifyRunDisabled,
  spotifyError,
  onToggleSpotify,
  onRunSpotify,
  socialDoctor,
  instagramSnapshot,
  instagramHistory,
  instagramActive,
  instagramBusy,
  instagramRunDisabled,
  instagramError,
  onRunInstagram,
  onToggleInstagram,
  onManageSocial,
}: {
  spotifySnapshot: ArtistSpotifySnapshot | null
  spotifyHistory: ArtistSpotifyHistoryPoint[]
  spotifyPublicApi: boolean
  spotifyActive: boolean
  spotifyBusy: boolean
  spotifyRunDisabled: boolean
  spotifyError: string | null
  onToggleSpotify: () => void
  onRunSpotify: () => void
  socialDoctor: SocialAccountsDoctorResult | null
  instagramSnapshot: ArtistInstagramSnapshot | null
  instagramHistory: ArtistInstagramGrowthPoint[]
  instagramActive: boolean
  instagramBusy: boolean
  instagramRunDisabled: boolean
  instagramError: string | null
  onRunInstagram: () => void
  onToggleInstagram: () => void
  onManageSocial: () => void
}) {
  const [spotifyOpen, setSpotifyOpen] = React.useState(false)
  const [socialOpen, setSocialOpen] = React.useState(false)
  const growth = calculateArtistSpotifyGrowth(spotifyHistory)
  const streamTrend = (spotifySnapshot?.dailyStreams?.length ?? 0) >= 2
    ? spotifySnapshot!.dailyStreams!.map((point) => point.streams)
    : spotifyHistory.map((point) => point.streams)
  const listenerTrend = spotifyHistory
    .map((point) => point.listeners)
    .filter((value): value is number => typeof value === 'number')
  const spotifyPending = spotifyActive ? `First read ${weeklyCronLabel(SPOTIFY_SYNC_CRON)}` : 'Run Spotify Pulse to start'
  const instagramPending = instagramActive ? `First read ${weeklyCronLabel(INSTAGRAM_SYNC_CRON)}` : 'Run Instagram Insights to start'
  const instagramProfiles = socialDoctor?.platforms.find((entry) => entry.platform === 'instagram')?.profiles ?? []
  const instagramReady = instagramProfiles.some((profile) => profile.ready)
  const instagramFoot = instagramSnapshot
    ? `${instagramSnapshot.profile.handle ?? instagramSnapshot.profile.profile}${instagramSnapshot.windowDays ? ` · ${instagramSnapshot.windowDays} days` : ''}`
    : instagramReady
      ? instagramPending
      : 'Instagram setup needed'
  const spotifyDate = spotifySnapshot ? formatShortDate(spotifySnapshot.snapshotDate) : null

  return (
    <section className="min-w-0">
      <div className="mb-2 flex h-6 items-center px-1">
        <p className="text-[9px] font-medium uppercase tracking-[0.16em] text-white/42">
          Performance
          {spotifyDate ? <span className="text-white/24"> · {spotifyDate}</span> : null}
          {spotifySnapshot?.windowDays && !spotifyPublicApi ? <span className="text-white/24"> · {spotifySnapshot.windowDays} days</span> : null}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
        <div className="relative grid min-w-0 grid-cols-2 divide-x divide-white/[0.075] overflow-hidden rounded-[14px] border border-white/[0.075] bg-white/[0.035] backdrop-blur-2xl">
          <SignalTile
            embedded
            label={spotifyPublicApi ? 'Popularity' : 'Streams'}
            value={formatMetric(spotifyPublicApi ? spotifySnapshot?.metrics.popularity : spotifySnapshot?.metrics.streams)}
            trend={spotifyPublicApi ? [] : streamTrend}
            foot={spotifySnapshot
              ? spotifyPublicApi
                ? 'Public API · 0–100'
                : growthFoot(growth?.streamsPercent, growth?.comparisonDate) ?? 'Baseline set'
              : spotifyPending}
            footTone={growthTone(growth?.streamsPercent)}
            ariaLabel="Open Spotify Pulse analysis"
            onOpen={() => setSpotifyOpen(true)}
          />
          <SignalTile
            embedded
            label="Listeners"
            value={formatMetric(spotifySnapshot?.metrics.listeners)}
            trend={listenerTrend}
            foot={spotifySnapshot
              ? growthFoot(growth?.listenersPercent, growth?.comparisonDate) ?? topTrackFoot(spotifySnapshot)
              : spotifyPending}
            footTone={growthTone(growth?.listenersPercent)}
            ariaLabel="Open Spotify listener analysis"
            onOpen={() => setSpotifyOpen(true)}
          />
          <div className="absolute right-3 top-2.5 z-10">
            <PulseRunControls
              active={spotifyActive}
              busy={spotifyBusy}
              runDisabled={spotifyRunDisabled}
              manualLabel="Run Spotify Pulse now — manual"
              weeklyLabel="Weekly Spotify auto-run"
              activeClassName="bg-[#f97316]/14 text-[#f97316]"
              onRun={onRunSpotify}
              onToggle={onToggleSpotify}
            />
          </div>
        </div>
        <div className="relative grid min-w-0 grid-cols-2 divide-x divide-white/[0.075] overflow-hidden rounded-[14px] border border-white/[0.075] bg-white/[0.035] backdrop-blur-2xl">
          <SignalTile
            embedded
            label="Followers"
            value={formatMetric(instagramSnapshot?.metrics.followers)}
            trend={[]}
            foot={instagramFoot}
            ariaLabel="Open Instagram follower analysis"
            onOpen={() => setSocialOpen(true)}
          />
          <SignalTile
            embedded
            label="Change"
            value={formatSignedMetric(instagramSnapshot?.metrics.followerDelta)}
            trend={instagramHistory.map((point) => point.followerDelta)}
            trendMode="bars"
            foot={instagramSnapshot?.windowDays ? `${instagramSnapshot.windowDays} days` : instagramPending}
            ariaLabel="Open Social Pulse analysis"
            onOpen={() => setSocialOpen(true)}
          />
          <div className="absolute right-3 top-2.5 z-10 flex items-center gap-1">
            <button
              type="button"
              onClick={onManageSocial}
              title="Manage social accounts"
              aria-label="Manage social accounts"
              className="inline-flex h-7 w-7 items-center justify-center rounded-[7px] border border-white/[0.07] bg-white/[0.02] text-white/28 transition-colors hover:bg-white/[0.06] hover:text-white/65"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
            </button>
            <PulseRunControls
              active={instagramActive}
              busy={instagramBusy}
              runDisabled={instagramRunDisabled}
              manualLabel="Run Instagram Insights now — manual"
              weeklyLabel="Weekly Instagram Insights auto-run"
              activeClassName="bg-[#f97316]/14 text-[#f97316]"
              onRun={onRunInstagram}
              onToggle={onToggleInstagram}
            />
          </div>
        </div>
      </div>

      <SpotifyPulseDetails
        open={spotifyOpen}
        onOpenChange={setSpotifyOpen}
        snapshot={spotifySnapshot}
        history={spotifyHistory}
        error={spotifyError}
      />
      <SocialPulseDetails
        open={socialOpen}
        onOpenChange={setSocialOpen}
        snapshot={instagramSnapshot}
        history={instagramHistory}
        busy={instagramBusy}
        readyProfiles={instagramProfiles.filter((profile) => profile.ready).length}
        error={instagramError}
      />
    </section>
  )
}

function SignalTile({
  embedded = false,
  label,
  value,
  trend,
  trendMode = 'line',
  foot,
  footTone = 'muted',
  ariaLabel,
  onOpen,
}: {
  embedded?: boolean
  label: string
  value: string
  trend: number[]
  trendMode?: 'line' | 'bars'
  foot: string
  footTone?: 'muted' | 'up' | 'down'
  ariaLabel: string
  onOpen: () => void
}) {
  const empty = value === '--'
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onOpen}
      className={cn(
        'group relative flex h-[104px] w-full min-w-0 flex-col overflow-hidden p-3.5 text-left transition-colors hover:bg-white/[0.05] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[#f97316]/70',
        embedded ? 'bg-transparent' : 'rounded-[14px] border border-white/[0.075] bg-white/[0.035] backdrop-blur-2xl',
      )}
    >
      <span className="text-[9px] font-medium uppercase tracking-[0.15em] text-white/42">{label}</span>
      <span className={cn(
        'mt-1 truncate text-[22px] font-medium leading-none tracking-[-0.03em]',
        empty ? 'text-white/28' : 'text-white/90',
      )}>
        {empty ? '—' : value}
      </span>
      <span className="mt-auto flex items-end justify-between gap-2">
        <span className={cn(
          'truncate text-[10px] leading-4',
          footTone === 'up' ? 'text-emerald-300/85' : footTone === 'down' ? 'text-red-300/80' : 'text-white/32',
        )}>
          {foot}
        </span>
        {trend.length >= 2 ? (
          trendMode === 'bars'
            ? <SignalBars values={trend} />
            : <Sparkline values={trend} />
        ) : null}
      </span>
    </button>
  )
}

function Sparkline({ values }: { values: number[] }) {
  const width = 72
  const height = 22
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = Math.max(1, max - min)
  const points = values.map((value, index) => ({
    x: (index / (values.length - 1)) * width,
    y: height - 2 - ((value - min) / range) * (height - 6),
  }))
  const line = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ')
  const last = points.at(-1)!
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-[22px] w-[72px] shrink-0 overflow-visible" aria-hidden="true">
      <path d={line} fill="none" stroke="#f97316" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last.x} cy={last.y} r="2.2" fill="#f97316" />
    </svg>
  )
}

function SignalBars({ values }: { values: number[] }) {
  const recent = values.slice(-8)
  const maxMagnitude = Math.max(1, ...recent.map((value) => Math.abs(value)))
  return (
    <span className="flex h-[22px] shrink-0 items-end gap-[3px]" aria-hidden="true">
      {recent.map((value, index) => (
        <span
          key={`${index}-${value}`}
          className={cn('w-[5px] rounded-[2px]', value >= 0 ? 'bg-[#f97316]/90' : 'bg-[#f97316]/40')}
          style={{ height: `${Math.max(3, (Math.abs(value) / maxMagnitude) * 22)}px` }}
        />
      ))}
    </span>
  )
}

function growthFoot(percent: number | undefined, comparisonDate: string | undefined): string | null {
  if (typeof percent !== 'number' || !comparisonDate) return null
  const arrow = percent > 0 ? '↑' : percent < 0 ? '↓' : '→'
  return `${arrow} ${Math.abs(percent).toFixed(1)}% vs ${formatShortDate(comparisonDate)}`
}

function growthTone(percent: number | undefined): 'muted' | 'up' | 'down' {
  if (typeof percent !== 'number' || percent === 0) return 'muted'
  return percent > 0 ? 'up' : 'down'
}

function topTrackFoot(snapshot: ArtistSpotifySnapshot): string {
  const lead = (snapshot.tracks ?? [])
    .filter((track): track is typeof track & { streams: number } => typeof track.streams === 'number')
    .sort((left, right) => right.streams - left.streams)[0]
  return lead ? `${lead.name} leads` : 'Baseline set'
}

function weeklyCronLabel(cron: string): string {
  const [minute, hour, , , weekday] = cron.trim().split(/\s+/)
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const hourNumber = Number(hour)
  const minuteNumber = Number(minute)
  const dayIndex = Number(weekday)
  if (!Number.isInteger(hourNumber) || !Number.isInteger(minuteNumber)) return 'on schedule'
  const suffix = hourNumber >= 12 ? 'PM' : 'AM'
  const displayHour = hourNumber % 12 || 12
  const time = `${displayHour}:${String(minuteNumber).padStart(2, '0')} ${suffix}`
  return Number.isInteger(dayIndex) && days[dayIndex] ? `${days[dayIndex]} ${time}` : time
}

function SpotifyPulseDetails({
  open,
  onOpenChange,
  snapshot,
  history,
  error,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  snapshot: ArtistSpotifySnapshot | null
  history: ArtistSpotifyHistoryPoint[]
  error: string | null
}) {
  const sourceLabel = snapshot?.dataSource === 'spotify-web-api'
    ? 'Public API'
    : snapshot?.dataSource === 'spotify-for-artists-browser'
      ? 'Spotify for Artists'
      : snapshot?.dataSource === 'manual'
        ? 'Manual'
        : 'No snapshot'
  const growth = calculateArtistSpotifyGrowth(history)
  const streamsPerListener = typeof snapshot?.metrics.streams === 'number'
    && typeof snapshot.metrics.listeners === 'number'
    && snapshot.metrics.listeners > 0
    ? (snapshot.metrics.streams / snapshot.metrics.listeners).toFixed(1)
    : '--'

  return (
    <PulseDetailsDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Spotify Pulse"
      description={`${sourceLabel}${snapshot ? ` · ${formatShortDate(snapshot.snapshotDate)}` : ''}`}
    >
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[12px] border border-white/[0.06] bg-white/[0.06] sm:grid-cols-3">
        <SignalStat label="Streams" value={formatMetric(snapshot?.metrics.streams)} />
        <SignalStat label="Listeners" value={formatMetric(snapshot?.metrics.listeners)} />
        <SignalStat label="Streams / listener" value={streamsPerListener} />
        <SignalStat label="Followers" value={formatMetric(snapshot?.metrics.followers)} />
        <SignalStat label="Saves" value={formatMetric(snapshot?.metrics.saves)} />
        <SignalStat label="Popularity" value={formatMetric(snapshot?.metrics.popularity)} />
        <SignalStat label="Save rate" value={formatRateMetric(snapshot?.metrics.saveRate)} />
        <SignalStat label="Skip rate" value={formatRateMetric(snapshot?.metrics.skipRate)} />
        <SignalStat label="Stream change" value={formatPercentMetric(growth?.streamsPercent, true)} />
      </div>
      <PulseDetailSection title="Top tracks" empty="No track analysis yet.">
        {(snapshot?.tracks ?? []).slice(0, 8).map((track) => (
          <PulseDetailRow
            key={track.id ?? track.name}
            label={track.name}
            value={`${formatMetric(track.streams)} streams · ${formatMetric(track.saves)} saves`}
          />
        ))}
      </PulseDetailSection>
      <PulseDetailSection title="Top cities" empty="No city analysis yet.">
        {(snapshot?.geo?.topCities ?? []).slice(0, 8).map((city) => (
          <PulseDetailRow
            key={`${city.city}-${city.country ?? ''}`}
            label={[city.city, city.country].filter(Boolean).join(', ')}
            value={`${formatMetric(city.listeners)} listeners`}
          />
        ))}
      </PulseDetailSection>
      <PulseDetailSection title="Playlists driving discovery" empty="No playlist analysis yet.">
        {(snapshot?.playlistsDriving ?? []).slice(0, 8).map((playlist) => (
          <PulseDetailRow
            key={`${playlist.name}-${playlist.type ?? ''}`}
            label={playlist.name}
            value={[playlist.type, typeof playlist.listeners === 'number' ? `${formatMetric(playlist.listeners)} listeners` : null].filter(Boolean).join(' · ') || '--'}
          />
        ))}
      </PulseDetailSection>
      <PulseDetailSection title="Discovery sources" empty="No source breakdown yet.">
        {Object.entries(snapshot?.sources ?? {}).map(([source, value]) => (
          <PulseDetailRow key={source} label={source} value={formatMetric(value)} />
        ))}
      </PulseDetailSection>
      {error || snapshot?.errors?.length ? (
        <PulseDetailNotice>{error ?? snapshot?.errors?.join(' · ')}</PulseDetailNotice>
      ) : null}
    </PulseDetailsDialog>
  )
}

function SignalStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 bg-[#0F0F10] px-3 py-3">
      <p className="text-[8px] font-medium uppercase tracking-[0.13em] text-white/48">{label}</p>
      <p title={value} className="mt-1.5 truncate text-[13px] font-medium text-white/82">{value}</p>
    </div>
  )
}

function PulseDetailsDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(760px,calc(100vh-2rem))] w-[min(680px,calc(100vw-2rem))] max-w-[680px] flex-col gap-0 overflow-hidden border-white/[0.09] bg-[#0C0D0E] p-0 text-white shadow-modal-small">
        <DialogHeader className="shrink-0 border-b border-white/[0.06] px-5 py-4 pr-14 text-left">
          <DialogTitle className="text-lg font-medium tracking-[-0.02em]">{title}</DialogTitle>
          <DialogDescription className="text-xs text-white/40">{description}</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
          {children}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function PulseDetailSection({
  title,
  empty,
  children,
}: {
  title: string
  empty: string
  children: React.ReactNode
}) {
  const hasChildren = React.Children.count(children) > 0
  return (
    <section>
      <p className="mb-2 text-[9px] font-medium uppercase tracking-[0.15em] text-white/38">{title}</p>
      <div className="overflow-hidden rounded-[12px] border border-white/[0.06] bg-[#0F0F10]">
        {hasChildren ? children : <p className="px-3 py-4 text-xs text-white/32">{empty}</p>}
      </div>
    </section>
  )
}

function PulseDetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-white/[0.05] px-3 py-2.5 last:border-b-0">
      <p className="min-w-0 truncate text-xs text-white/72">{label}</p>
      <p className="shrink-0 text-[10px] capitalize text-white/36">{value}</p>
    </div>
  )
}

function PulseDetailNotice({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-[10px] border border-red-300/10 bg-red-300/[0.04] px-3 py-2.5 text-xs leading-5 text-red-100/65">
      {children}
    </p>
  )
}

function SignalProgress({
  value,
  label,
  tone,
}: {
  value: number
  label: string
  tone: string
}) {
  const normalized = Math.max(0, Math.min(100, value))
  return (
    <div className="mt-auto">
      <div className="mb-1.5 flex items-center justify-between text-[9px] text-white/34">
        <span>{label}</span>
        <span>{Math.round(normalized)}%</span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-white/[0.07]">
        <div className={cn('h-full rounded-full', tone)} style={{ width: `${normalized}%` }} />
      </div>
    </div>
  )
}

type StateOfPlayPanelProps = {
  state: HqStateOfPlay | null
  workerItems: HqHomeWorkerItem[]
  recentOutputs: OutputSummaryDTO[]
  recentLoading: boolean
  workspaceId: string
  proactiveMode: boolean
  proactiveBusy: boolean
  routeBusy: boolean
  refreshBusy: boolean
  availableAgentSlugs: Set<string>
  onToggleProactiveMode: (enabled: boolean) => void
  onLaunchRoute: (route: HqStateRouteHint, recommendationId?: string) => void
  onOpenEntity: (entity: HqStateEntityRef) => void
  onTransitionRecommendation: (recommendationId: string, to: 'dismissed' | 'snoozed') => void
  onRefresh: () => void
  onOpenManagerSource: (surface: ManagerSourceSurface) => void
}

function StateOfPlayPanel(props: StateOfPlayPanelProps) {
  const {
    state,
    workerItems,
    recentOutputs,
    recentLoading,
    proactiveMode,
    proactiveBusy,
    routeBusy,
    refreshBusy,
    availableAgentSlugs,
    onOpenEntity,
    onToggleProactiveMode,
    onLaunchRoute,
    onRefresh,
  } = props
  const [detailsOpen, setDetailsOpen] = React.useState(false)
  const [view, setView] = React.useState<'needs' | 'progress' | 'recent'>('needs')
  const actionableMoves = state
    ? [state.nextMove, ...state.alternatives].filter((move) => move.attentionRequired)
    : []
  const primaryNeed = actionableMoves[0]
  const secondaryMoves = actionableMoves.slice(1, 4)
  const representedSources = new Set([
    primaryNeed?.entityRef?.source,
    ...secondaryMoves.map((move) => move.entityRef?.source),
  ].filter((source): source is string => Boolean(source)))
  const needsYouItems = state
    ? userFacingHqAttention(state.attention)
      .filter((item) => !representedSources.has(item.source))
      .slice(0, Math.max(0, 4 - secondaryMoves.length))
    : []
  const inProgressItems = workerItems
    .filter((item) => item.kind !== 'automation' && ['running', 'waiting', 'scheduled'].includes(item.status))
    .slice(0, 5)
  const completedOutputs = [...recentOutputs]
    .filter((output) => output.status !== 'failed' && output.status !== 'cancelled')
    .sort((left, right) => outputActivityTime(right) - outputActivityTime(left))
    .slice(0, 5)
  const counts = {
    needs: (primaryNeed ? 1 : 0) + secondaryMoves.length + needsYouItems.length,
    progress: inProgressItems.length,
    recent: completedOutputs.length,
  }

  return (
    <>
      <HQCard className="overflow-hidden border-white/[0.075] bg-white/[0.032] p-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-xl">
        <div className="flex min-h-12 items-center justify-between gap-3 border-b border-white/[0.055] px-3 sm:px-4">
          <div className="flex min-w-0 items-center gap-1" role="tablist" aria-label="Work activity">
            {([
              ['needs', 'Needs you'],
              ['progress', 'In progress'],
              ['recent', 'Recent'],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={view === id}
                onClick={() => setView(id)}
                className={cn(
                  'relative inline-flex h-8 items-center gap-2 rounded-[7px] px-2.5 text-[11px] font-medium transition-[background-color,color,box-shadow] sm:px-3',
                  view === id
                    ? 'bg-white/[0.055] text-white/90 shadow-[inset_0_0_0_1px_rgba(249,115,22,0.62),0_1px_2px_rgba(0,0,0,0.22)]'
                    : 'text-white/38 hover:bg-white/[0.035] hover:text-white/68',
                )}
              >
                {label}
                {counts[id] > 0 ? (
                  <span className={cn(
                    'inline-flex min-w-4 items-center justify-center rounded-full px-1 text-[9px] tabular-nums',
                    view === id ? 'bg-black/25 text-white/60' : 'bg-white/[0.045] text-white/30',
                  )}>
                    {counts[id]}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
          {state ? (
            <button
              type="button"
              onClick={() => setDetailsOpen(true)}
              aria-label="Open manager details"
              className="inline-flex h-7 shrink-0 items-center gap-1 rounded-[7px] px-1.5 text-[10px] font-medium text-white/42 transition-colors hover:bg-white/[0.05] hover:text-white/75 sm:px-2"
            >
              <span className="hidden sm:inline">Manager</span>
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          ) : (
            <StateOfPlayRefreshButton busy={refreshBusy} onRefresh={onRefresh} size="md" />
          )}
        </div>
        <div className="max-h-[228px] divide-y divide-white/[0.05] overflow-y-auto">
          {view === 'needs' ? (
            state && counts.needs > 0 ? (
              <>
                {primaryNeed ? <div className="flex min-h-10 items-center gap-3 px-4 py-2">
                  <span className="h-1 w-1 shrink-0 rounded-full bg-white/28" />
                  <h2 className="min-w-0 flex-1 truncate text-xs font-semibold text-white/88">{primaryNeed.title}</h2>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        aria-label="Why this is recommended"
                        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white/30 transition-colors hover:bg-white/[0.05] hover:text-white/70"
                      >
                        <Info className="h-3.5 w-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-[320px] text-xs leading-5">{primaryNeed.why}</TooltipContent>
                  </Tooltip>
                </div> : null}
                {secondaryMoves.map((move) => (
                  <button
                    key={move.entityRef?.source ?? `${move.worker ?? 'manual'}-${move.title}`}
                    type="button"
                    onClick={() => move.entityRef ? onOpenEntity(move.entityRef) : setDetailsOpen(true)}
                    className="flex min-h-10 w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-white/[0.035]"
                  >
                    <span className={cn(
                      'h-1 w-1 shrink-0 rounded-full',
                      /failed|failure|interrupted/i.test(move.why) ? 'bg-red-300/80' : 'bg-white/28',
                    )} />
                    <span className="min-w-0 flex-1 truncate text-xs text-white/58">{move.title}</span>
                    <ChevronRight className="h-3 w-3 shrink-0 text-white/24" />
                  </button>
                ))}
                {needsYouItems.map((item) => (
                  <div key={`${item.kind}-${item.source}-${item.text}`} className="flex min-h-10 items-center gap-3 px-4 py-2">
                    <span className={cn('h-1 w-1 shrink-0 rounded-full', item.kind === 'failure' ? 'bg-red-300/80' : 'bg-white/28')} />
                    <p className="line-clamp-1 text-xs text-white/54">{item.text}</p>
                  </div>
                ))}
              </>
            ) : <ActivityEmpty label="Nothing needs attention yet" />
          ) : null}

          {view === 'progress' ? (
            inProgressItems.length > 0 ? inProgressItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => navigate(routes.view.automations())}
                className="grid min-h-11 w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-white/[0.035]"
              >
                <span className={cn('h-1.5 w-1.5 rounded-full', item.status === 'running' ? 'bg-emerald-300' : 'bg-amber-300/75')} />
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium text-white/78">{item.title}</span>
                  <span className="block truncate text-[10px] text-white/34">{item.detail}</span>
                </span>
                <span className="text-[9px] font-medium uppercase tracking-[0.1em] text-white/34">{activityStatusLabel(item.status)}</span>
              </button>
            )) : <ActivityEmpty label="No work is running or queued" />
          ) : null}

          {view === 'recent' ? (
            recentLoading ? <ActivityEmpty label="Loading recent work..." />
              : completedOutputs.length > 0 ? completedOutputs.map((output) => (
                <button
                  key={output.id}
                  type="button"
                  onClick={() => navigate(routes.view.output(output.id))}
                  className="grid min-h-11 w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-white/[0.035]"
                >
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300/65" />
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-medium text-white/78">{output.title}</span>
                    <span className="block truncate text-[10px] text-white/34">{output.origin?.agentName || output.origin?.workflowName || 'Saved output'}</span>
                  </span>
                  <span className="text-[10px] text-white/30">{formatShortDate(output.completedAt || output.updatedAt || output.createdAt)}</span>
                </button>
              )) : <ActivityEmpty label="No completed work yet" />
          ) : null}
        </div>
      </HQCard>

      <Drawer direction="right" open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DrawerContent className="inset-y-0 right-0 left-auto mt-0 h-full !w-full rounded-none border-l border-white/[0.08] bg-[#070708] sm:!max-w-[560px]">
          <DrawerHeader className="relative border-b border-white/[0.06] px-5 py-4 pr-16 text-left">
            <DrawerTitle className="text-sm font-semibold text-white/78">Next move</DrawerTitle>
            <DrawerDescription className="sr-only">Manager recommendation and source transparency.</DrawerDescription>
            <DrawerClose asChild>
              <button
                type="button"
                aria-label="Close State of Play details"
                title="Close"
                className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.07] bg-white/[0.025] text-white/45 transition-colors hover:bg-white/[0.07] hover:text-white/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/55"
              >
                <X className="h-4 w-4" />
              </button>
            </DrawerClose>
          </DrawerHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6">
            <StateOfPlayDetailPanel {...props} />
          </div>
        </DrawerContent>
      </Drawer>
    </>
  )
}

function ActivityEmpty({ label }: { label: string }) {
  return <p className="px-4 py-4 text-xs text-white/34">{label}</p>
}

function activityStatusLabel(status: string): string {
  if (status === 'running') return 'Running'
  if (status === 'waiting') return 'Queued'
  if (status === 'scheduled') return 'Scheduled'
  return status.replaceAll('-', ' ')
}

function outputActivityTime(output: OutputSummaryDTO): number {
  const parsed = Date.parse(output.completedAt || output.updatedAt || output.createdAt)
  return Number.isNaN(parsed) ? 0 : parsed
}

function StateOfPlayDetailPanel({
  state,
  proactiveMode,
  proactiveBusy,
  routeBusy,
  availableAgentSlugs,
  refreshBusy,
  onToggleProactiveMode,
  onLaunchRoute,
  onOpenEntity,
  onTransitionRecommendation,
  onRefresh,
  onOpenManagerSource,
}: StateOfPlayPanelProps) {
  if (!state) {
    return (
      <EmptyLine
        title="No recommendation yet"
        detail="Add artist context or sync a source to generate one."
      />
    )
  }

  const attention = userFacingHqAttention(state.attention).slice(0, 3)
  const missing = state.missing.slice(0, 3)
  const route = state.nextMove.route
  const recommendationStatus = state.nextMove.recommendationStatus ?? 'proposed'
  const routeReadiness = resolveHqRouteReadiness(route, availableAgentSlugs, proactiveMode)
  const actionState = resolveHqRecommendationActionState(recommendationStatus, routeReadiness, proactiveMode, routeBusy)
  const canLaunchRoute = actionState.canLaunch

  return (
    <div className="mx-auto flex w-full max-w-[500px] flex-col">
      <section>
        <div className="flex items-center justify-between gap-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-orange-100/55">Recommended next</p>
          <StateOfPlayRefreshButton busy={refreshBusy} onRefresh={onRefresh} />
        </div>
        <h2 className="mt-2 text-xl font-semibold leading-tight tracking-tight text-white/90">
          {state.nextMove.title}
        </h2>
        <p className="mt-2 text-sm leading-6 text-white/48">{state.nextMove.why}</p>
      </section>

      {attention.length > 0 ? (
        <section className="mt-6 border-t border-white/[0.06] pt-5">
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/38">Needs attention</h3>
          <div className="mt-2 divide-y divide-white/[0.055]">
            {attention.map((item) => (
              <div key={`${item.kind}-${item.source}-${item.text}`} className="flex items-start gap-2.5 py-3">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-orange-300" />
                <p className="text-sm leading-6 text-white/70">{item.text}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {missing.length > 0 ? (
        <p className="mt-4 text-xs leading-5 text-white/34">
          Still needed: {missing.join(', ')}{state.missing.length > missing.length ? ', and more' : ''}.
        </p>
      ) : null}

      {route ? (
        <section className="mt-6 border-t border-white/[0.06] pt-5">
          <button
            type="button"
            onClick={() => onLaunchRoute(route, state.nextMove.recommendationId)}
            disabled={!canLaunchRoute || routeBusy}
            className={cn(
              'inline-flex h-10 w-full items-center justify-center rounded-[10px] border px-4 text-sm font-semibold transition-colors',
              canLaunchRoute
                ? 'border-orange-300/25 bg-orange-300/12 text-orange-50 hover:bg-orange-300/18'
                : 'cursor-not-allowed border-white/[0.06] bg-white/[0.02] text-white/30',
              routeBusy && 'cursor-wait opacity-65',
            )}
          >
            {actionState.label}
          </button>

          <div className="mt-3 flex items-center justify-center gap-4">
            {state.nextMove.entityRef ? (
              <button
                type="button"
                onClick={() => onOpenEntity(state.nextMove.entityRef!)}
                className="inline-flex items-center gap-1.5 text-xs text-white/42 transition-colors hover:text-white/70"
              >
                <ExternalLink className="h-3 w-3" />
                Open item
              </button>
            ) : null}
            {state.nextMove.recommendationId && actionState.canDefer ? (
              <>
                <button
                  type="button"
                  onClick={() => onTransitionRecommendation(state.nextMove.recommendationId!, 'snoozed')}
                  disabled={routeBusy}
                  className="text-xs text-white/36 transition-colors hover:text-white/65 disabled:opacity-40"
                >
                  Later
                </button>
                <button
                  type="button"
                  onClick={() => onTransitionRecommendation(state.nextMove.recommendationId!, 'dismissed')}
                  disabled={routeBusy}
                  className="text-xs text-white/36 transition-colors hover:text-white/65 disabled:opacity-40"
                >
                  Dismiss
                </button>
              </>
            ) : null}
          </div>

          <div className="mt-6 flex items-center justify-between border-t border-white/[0.05] pt-4">
            <div>
              <p className="text-xs font-medium text-white/60">Weekly manager check-in</p>
              <p className="mt-0.5 text-[11px] text-white/30">Mondays at 10:20, after Pulse updates</p>
            </div>
            <Switch
              checked={proactiveMode}
              onCheckedChange={onToggleProactiveMode}
              disabled={proactiveBusy}
              aria-label={proactiveMode ? 'Pause weekly manager check-in' : 'Enable weekly manager check-in'}
              className="data-[state=checked]:bg-orange-300"
            />
          </div>
        </section>
      ) : null}

      {state.version === 2 ? (
        <ManagerKnowledgePanel
          brief={state.managerBrief}
          refreshBusy={refreshBusy}
          onRefresh={onRefresh}
          onOpenSource={onOpenManagerSource}
        />
      ) : null}
    </div>
  )
}

function openHqStateEntity(entity: HqStateEntityRef): void {
  if (entity.kind === 'output') {
    navigate(routes.view.output(entity.id))
    return
  }
  if (entity.kind === 'workflow-run') {
    navigate(routes.view.workflowRun(entity.id))
    return
  }
  if (entity.kind === 'automation-run') {
    navigate(routes.view.automations())
    return
  }
  window.location.hash = '#artist-hq/calendar'
}

function SocialPulseDetails({
  open,
  onOpenChange,
  snapshot,
  history,
  busy,
  readyProfiles,
  error,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  snapshot: ArtistInstagramSnapshot | null
  history: ArtistInstagramGrowthPoint[]
  busy: boolean
  readyProfiles: number
  error: string | null
}) {
  const statusLabel = busy
    ? 'Checking'
    : snapshot
      ? `${snapshot.profile.handle ?? snapshot.profile.profile} · ${snapshot.windowDays ? `${snapshot.windowDays} days` : 'Insights'}`
      : readyProfiles > 0
        ? 'Instagram ready'
        : 'Instagram setup needed'

  return (
    <PulseDetailsDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Social Pulse"
      description={statusLabel}
    >
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[12px] border border-white/[0.06] bg-white/[0.06] sm:grid-cols-3">
        <SignalStat label="Followers" value={formatMetric(snapshot?.metrics.followers)} />
        <SignalStat label="Follower change" value={formatSignedMetric(snapshot?.metrics.followerDelta)} />
        <SignalStat label="Reach" value={formatMetric(snapshot?.metrics.accountsReached)} />
        <SignalStat label="Engaged" value={formatMetric(snapshot?.metrics.accountsEngaged)} />
        <SignalStat label="Interactions" value={formatMetric(snapshot?.metrics.interactions)} />
        <SignalStat label="Profile visits" value={formatMetric(snapshot?.metrics.profileVisits)} />
        <SignalStat label="Likes" value={formatMetric(snapshot?.metrics.likes)} />
        <SignalStat label="Comments" value={formatMetric(snapshot?.metrics.comments)} />
        <SignalStat label="Period" value={snapshot?.windowDays ? `${snapshot.windowDays} days` : '--'} />
      </div>
      <PulseDetailSection title="Follower trend" empty="Run Social Pulse again to build a trend.">
        {history.slice().reverse().map((point) => (
          <PulseDetailRow key={point.date} label={formatShortDate(point.date)} value={formatSignedMetric(point.followerDelta)} />
        ))}
      </PulseDetailSection>
      {error || snapshot?.errors?.length ? (
        <PulseDetailNotice>{error ?? snapshot?.errors?.join(' · ')}</PulseDetailNotice>
      ) : null}
    </PulseDetailsDialog>
  )
}

function formatSignedMetric(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--'
  return `${value > 0 ? '+' : ''}${value.toLocaleString()}`
}

function IntelConfigDialog({
  open,
  config,
  onOpenChange,
  onSave,
}: {
  open: boolean
  config: ArtistIntelConfig
  onOpenChange: (open: boolean) => void
  onSave: (config: ArtistIntelConfig) => void | Promise<void>
}) {
  const [sources, setSources] = React.useState<ArtistIntelSource[]>(config.sources)
  const [sinceDays, setSinceDays] = React.useState(config.sinceDays)
  const [cadence, setCadence] = React.useState(config.cadence)
  const [expandedSourceId, setExpandedSourceId] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setSources(config.sources)
    setSinceDays(config.sinceDays)
    setCadence(config.cadence)
    setExpandedSourceId(null)
    setSaving(false)
  }, [config, open])

  const updateSource = React.useCallback((id: string, patch: Partial<ArtistIntelSource>) => {
    setSources((current) => current.map((source) => source.id === id ? { ...source, ...patch } : source))
  }, [])

  const addSource = React.useCallback(() => {
    const id = `source-${Date.now()}`
    setSources((current) => [
      ...current,
      { id, name: '', url: '', priority: 'medium', notes: '' },
    ])
    setExpandedSourceId(id)
  }, [])

  const removeSource = React.useCallback((id: string) => {
    setSources((current) => current.filter((source) => source.id !== id))
    setExpandedSourceId((current) => current === id ? null : current)
  }, [])

  const save = React.useCallback(async () => {
    const nextSources = sources
      .map((source) => ({
        ...source,
        name: source.name.trim(),
        url: source.url.trim(),
        notes: source.notes?.trim(),
      }))
      .filter((source) => source.name && source.url)
    const invalid = nextSources.find((source) => !isValidYouTubeChannelUrl(source.url))
    if (invalid) {
      toast.error('Use a YouTube channel URL', {
        description: invalid.name ? `${invalid.name}: ${invalid.url}` : invalid.url,
      })
      return
    }
    setSaving(true)
    try {
      await onSave({
        ...config,
        cadence,
        sources: nextSources,
        sinceDays,
        maxPerChannel: 1,
        updatedAt: new Date().toISOString(),
      })
    } finally {
      setSaving(false)
    }
  }, [cadence, config, onSave, sinceDays, sources])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100vh-2rem)] w-[min(720px,calc(100vw-2rem))] max-w-[720px] flex-col gap-0 overflow-hidden border-white/[0.1] bg-[#111315] p-0 text-white shadow-modal-small">
        <DialogHeader className="shrink-0 border-b border-white/[0.07] bg-[linear-gradient(110deg,rgba(251,146,60,0.10),rgba(124,58,237,0.04)_48%,transparent)] px-5 py-5 pr-14">
          <DialogTitle className="text-xl font-medium tracking-[-0.02em]">Intel channels</DialogTitle>
          <DialogDescription className="text-white/46">Choose the YouTube channels Artist HQ watches each week.</DialogDescription>
        </DialogHeader>

        <div className="grid shrink-0 gap-3 border-b border-white/[0.06] bg-[#14171A] px-5 py-4 sm:grid-cols-2">
            <label className="block space-y-1.5">
              <span className="text-[9px] font-semibold uppercase tracking-[0.16em] text-orange-200/55">Cadence</span>
              <select
                value={cadence}
                onChange={(event) => setCadence(event.target.value as ArtistIntelConfig['cadence'])}
                className="h-10 w-full rounded-[10px] border border-white/[0.09] bg-[#202429] px-3 text-sm text-white/82 outline-none focus:border-orange-400/45"
              >
                <option value="weekly">Weekly</option>
                <option value="manual">Manual</option>
              </select>
            </label>
            <label className="block space-y-1.5">
              <span className="text-[9px] font-semibold uppercase tracking-[0.16em] text-violet-200/55">Lookback</span>
              <input
                type="number"
                min={1}
                max={14}
                value={sinceDays}
                onChange={(event) => setSinceDays(Number(event.target.value))}
                className="h-10 w-full rounded-[10px] border border-white/[0.09] bg-[#202429] px-3 text-sm text-white/82 outline-none focus:border-violet-400/45"
              />
            </label>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-[#0E1012] px-5 py-4">
          <div className="mb-2 flex items-center justify-between gap-3 px-1">
            <p className="text-[9px] font-semibold uppercase tracking-[0.17em] text-white/34">Channels</p>
            <p className="text-[10px] text-white/28">{sources.length} watched</p>
          </div>
          <div className="space-y-2">
            {sources.map((source, index) => {
              const expanded = expandedSourceId === source.id
              return (
                <div
                  key={source.id}
                  className={cn(
                    'overflow-hidden rounded-[13px] border transition-colors',
                    expanded ? 'border-orange-300/20 bg-[#1B1E22]' : 'border-white/[0.065] bg-[#171A1D] hover:border-white/[0.12]',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setExpandedSourceId((current) => current === source.id ? null : source.id)}
                    aria-expanded={expanded}
                    className="flex min-h-12 w-full items-center gap-3 px-3.5 py-2.5 text-left"
                  >
                    <span className={cn(
                      'flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] border text-[10px] font-semibold',
                      expanded ? 'border-orange-300/25 bg-orange-300/10 text-orange-200' : 'border-white/[0.07] bg-white/[0.035] text-white/42',
                    )}>
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-white/86">
                      {source.name.trim() || 'Untitled channel'}
                    </span>
                    <span className={cn(
                      'rounded-full border px-2 py-1 text-[8px] font-semibold uppercase tracking-[0.12em]',
                      source.priority === 'high'
                        ? 'border-orange-300/18 bg-orange-300/[0.07] text-orange-200/65'
                        : source.priority === 'medium'
                          ? 'border-violet-300/18 bg-violet-300/[0.07] text-violet-200/60'
                          : 'border-white/[0.07] bg-white/[0.025] text-white/38',
                    )}>
                      {source.priority}
                    </span>
                    <ChevronDown className={cn('h-4 w-4 shrink-0 text-white/30 transition-transform', expanded && 'rotate-180 text-orange-200/60')} />
                  </button>

                  {expanded ? (
                    <div className="border-t border-white/[0.06] bg-[#14171A] px-3.5 pb-3.5 pt-3">
                      <div className="grid gap-3 md:grid-cols-[1fr_1.55fr_110px]">
                        <label className="space-y-1.5">
                          <span className="text-[8px] font-semibold uppercase tracking-[0.14em] text-white/32">Channel name</span>
                          <Input value={source.name} onChange={(name) => updateSource(source.id, { name })} placeholder="Channel name" />
                        </label>
                        <label className="space-y-1.5">
                          <span className="text-[8px] font-semibold uppercase tracking-[0.14em] text-white/32">YouTube URL</span>
                          <Input value={source.url} onChange={(url) => updateSource(source.id, { url })} placeholder="https://www.youtube.com/@channel" />
                        </label>
                        <label className="space-y-1.5">
                          <span className="text-[8px] font-semibold uppercase tracking-[0.14em] text-white/32">Priority</span>
                          <select
                            value={source.priority}
                            onChange={(event) => updateSource(source.id, { priority: event.target.value as ArtistIntelSource['priority'] })}
                            className="h-9 w-full rounded-[10px] border border-white/[0.08] bg-[#202429] px-3 text-xs text-white/78 outline-none focus:border-orange-400/40"
                          >
                            <option value="high">High</option>
                            <option value="medium">Medium</option>
                            <option value="low">Low</option>
                          </select>
                        </label>
                      </div>
                      <label className="mt-3 block space-y-1.5">
                        <span className="text-[8px] font-semibold uppercase tracking-[0.14em] text-white/32">Why it matters</span>
                        <textarea
                          value={source.notes ?? ''}
                          onChange={(event) => updateSource(source.id, { notes: event.target.value })}
                          placeholder="What should the Intel agent learn from this channel?"
                          className="min-h-[72px] w-full resize-y rounded-[10px] border border-white/[0.08] bg-[#202429] px-3 py-2.5 text-xs leading-5 text-white/75 outline-none placeholder:text-white/28 focus:border-orange-400/35"
                        />
                      </label>
                      <div className="mt-3 flex justify-end">
                        <button
                          type="button"
                          onClick={() => removeSource(source.id)}
                          className="inline-flex h-8 items-center gap-1.5 rounded-[8px] px-2.5 text-[10px] font-medium text-red-200/45 transition-colors hover:bg-red-400/[0.07] hover:text-red-200/75"
                          aria-label={`Remove ${source.name || 'channel'}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Remove channel
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-white/[0.08] bg-[#171A1D] px-5 py-3.5 shadow-middle">
            <button
              type="button"
              onClick={addSource}
              className="inline-flex h-9 items-center gap-2 rounded-[9px] border border-white/[0.09] bg-white/[0.025] px-3.5 text-xs font-medium text-white/62 hover:bg-white/[0.06]"
            >
              <Plus className="h-3.5 w-3.5" />
              Add channel
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="h-9 min-w-[92px] rounded-[9px] bg-orange-300 px-5 text-xs font-semibold text-[#1A1008] transition-colors hover:bg-orange-200 disabled:cursor-wait disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function formatMetric(value: number | undefined): string {
  if (typeof value !== 'number') return '--'
  return new Intl.NumberFormat('en-US', { notation: value >= 10000 ? 'compact' : 'standard' }).format(value)
}

function formatPercentMetric(value: number | undefined, signed = false): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--'
  return `${signed && value > 0 ? '+' : ''}${value.toFixed(Math.abs(value) >= 10 ? 0 : 1)}%`
}

function formatRateMetric(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--'
  const percent = Math.abs(value) <= 1 ? value * 100 : value
  return `${percent.toFixed(Math.abs(percent) >= 10 ? 0 : 1)}%`
}

function formatShortDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date)
}

function EmptyLine({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-[14px] border border-white/[0.045] bg-white/[0.016] p-4">
      <div className="flex items-start gap-3">
        <CheckCircle2 className="mt-0.5 h-4 w-4 text-white/30" />
        <div>
          <p className="text-sm font-medium text-white/72">{title}</p>
          <p className="mt-1 text-xs leading-5 text-white/38">{detail}</p>
        </div>
      </div>
    </div>
  )
}

function ArtistProfileForm({
  draft,
  onChange,
}: {
  draft: ProfileDraft
  onChange: (draft: ProfileDraft) => void
}) {
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <ProfileField label="Artist mission / North Star" wide>
        <TextArea
          value={draft.mission ?? ''}
          onChange={(mission) => onChange({ ...draft, mission })}
          placeholder="One lasting sentence: what is this artist building, changing, or making people feel?"
        />
      </ProfileField>
      <ProfileField label="Artist name">
        <Input value={draft.artistName ?? ''} onChange={(artistName) => onChange({ ...draft, artistName })} placeholder="Name fans know" />
      </ProfileField>
      <ProfileField label="Aliases">
        <Input value={draft.aliases ?? ''} onChange={(aliases) => onChange({ ...draft, aliases })} placeholder="Other names, projects, handles" />
      </ProfileField>
      <ProfileField label="Spotify profile">
        <Input value={draft.spotifyProfile ?? ''} onChange={(spotifyProfile) => onChange({ ...draft, spotifyProfile })} placeholder="Spotify URL or artist ID" />
      </ProfileField>
      <ProfileField label="Promo budget">
        <Input value={draft.promoBudget ?? ''} onChange={(promoBudget) => onChange({ ...draft, promoBudget })} placeholder="$500, $2k/month, flexible..." />
      </ProfileField>
      <ProfileField label="Bio / story" wide>
        <TextArea value={draft.bio ?? ''} onChange={(bio) => onChange({ ...draft, bio })} placeholder="What is the artist story? What should workers never miss?" />
      </ProfileField>
      <ProfileField label="Themes / topics" wide>
        <TextArea
          value={draft.themes ?? ''}
          onChange={(themes) => onChange({ ...draft, themes })}
          placeholder="Topics they write about, recurring ideas, worldview, content lanes, lyrical themes, tensions, scenes, values."
        />
      </ProfileField>
      <ProfileField label="Sound">
        <TextArea value={draft.sound ?? ''} onChange={(sound) => onChange({ ...draft, sound })} placeholder="Genre, texture, voice, production, emotional lane" />
      </ProfileField>
      <ProfileField label="Visual world">
        <TextArea value={draft.visualWorld ?? ''} onChange={(visualWorld) => onChange({ ...draft, visualWorld })} placeholder="Colors, references, imagery, camera style, aesthetic rules" />
      </ProfileField>
      <ProfileField label="Brand words">
        <TextArea value={draft.brandWords ?? ''} onChange={(brandWords) => onChange({ ...draft, brandWords })} placeholder="Words the artist should feel like. Words to avoid." />
      </ProfileField>
      <ProfileField label="Audience">
        <TextArea value={draft.audience ?? ''} onChange={(audience) => onChange({ ...draft, audience })} placeholder="Who listens, why they care, what they are living through" />
      </ProfileField>
      <ProfileField label="Similar artists">
        <TextArea value={draft.similarArtists ?? ''} onChange={(similarArtists) => onChange({ ...draft, similarArtists })} placeholder="Reference artists, songs, scenes, labels" />
      </ProfileField>
      <ProfileField label="Priority markets">
        <TextArea value={draft.priorityMarkets ?? ''} onChange={(priorityMarkets) => onChange({ ...draft, priorityMarkets })} placeholder="Cities, countries, platforms, demographics" />
      </ProfileField>
      <ProfileField label="Social links">
        <TextArea value={draft.socialLinks ?? ''} onChange={(socialLinks) => onChange({ ...draft, socialLinks })} placeholder="Instagram, TikTok, YouTube, website, email list" />
      </ProfileField>
      <ProfileField label="Team">
        <TextArea value={draft.team ?? ''} onChange={(team) => onChange({ ...draft, team })} placeholder="Manager, producer, designer, label, collaborators" />
      </ProfileField>
      <ProfileField label="Rules / preferences">
        <TextArea value={draft.rules ?? ''} onChange={(rules) => onChange({ ...draft, rules })} placeholder="Hard no's, tone rules, approval preferences, tools to use or avoid" />
      </ProfileField>
    </div>
  )
}

function ArtistVoiceForm({
  draft,
  onChange,
}: {
  draft: VoiceDraft
  onChange: (draft: VoiceDraft) => void
}) {
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <ProfileField label="Voice summary" wide>
        <TextArea value={draft.summary ?? ''} onChange={(summary) => onChange({ ...draft, summary })} placeholder="Short summary of how the artist sounds in public. Dry, sharp, intimate, funny, poetic, chaotic..." />
      </ProfileField>
      <ProfileField label="How they talk">
        <TextArea value={draft.speakingStyle ?? ''} onChange={(speakingStyle) => onChange({ ...draft, speakingStyle })} placeholder="Sentence length, rhythm, humor, slang, punctuation, directness, emotional temperature" />
      </ProfileField>
      <ProfileField label="Words / phrases">
        <TextArea value={draft.vocabulary ?? ''} onChange={(vocabulary) => onChange({ ...draft, vocabulary })} placeholder="Words they use, repeated phrases, spelling quirks, signature expressions" />
      </ProfileField>
      <ProfileField label="Avoid">
        <TextArea value={draft.avoid ?? ''} onChange={(avoid) => onChange({ ...draft, avoid })} placeholder="Words, tones, cliches, emojis, topics, fake hype, or anything that does not sound like them" />
      </ProfileField>
      <ProfileField label="Caption examples" wide>
        <TextArea value={draft.captionExamples ?? ''} onChange={(captionExamples) => onChange({ ...draft, captionExamples })} placeholder="Paste real captions. Include good examples and notes if useful." />
      </ProfileField>
      <ProfileField label="Comment reply examples" wide>
        <TextArea value={draft.commentReplyExamples ?? ''} onChange={(commentReplyExamples) => onChange({ ...draft, commentReplyExamples })} placeholder="Paste examples of how the artist replies to fans, compliments, jokes, questions, criticism, or DMs. Social posting agents use this for reply tone." />
      </ProfileField>
      <ProfileField label="Post examples" wide>
        <TextArea value={draft.postExamples ?? ''} onChange={(postExamples) => onChange({ ...draft, postExamples })} placeholder="Paste posts, tweets, threads, announcements, replies, or email/social copy that sounds right." />
      </ProfileField>
      <ProfileField label="Writing excerpts" wide>
        <TextArea value={draft.writingExcerpts ?? ''} onChange={(writingExcerpts) => onChange({ ...draft, writingExcerpts })} placeholder="Longer samples: notes app drafts, artist statements, scripts, captions, or journal-style writing." />
      </ProfileField>
    </div>
  )
}

function ArtistBrandingForm({
  draft,
  onChange,
}: {
  draft: BrandingDraft
  onChange: (draft: BrandingDraft) => void
}) {
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <ProfileField label="Creative DNA" wide>
        <TextArea value={draft.creativeDna ?? ''} onChange={(creativeDna) => onChange({ ...draft, creativeDna })} placeholder="Musical and non-musical influences, films, fashion, books, places, childhood, internet rabbit holes, visual taste, production style." />
      </ProfileField>
      <ProfileField label="Tensions">
        <TextArea value={draft.tensions ?? ''} onChange={(tensions) => onChange({ ...draft, tensions })} placeholder="Contradictions that make the artist memorable: delicate x aggressive, spiritual x reckless, luxury x gritty." />
      </ProfileField>
      <ProfileField label="Fascinations">
        <TextArea value={draft.fascinations ?? ''} onChange={(fascinations) => onChange({ ...draft, fascinations })} placeholder="Things they could talk about for hours, binge, notice, envy, hate, admire, or keep returning to." />
      </ProfileField>
      <ProfileField label="Reaction hooks">
        <TextArea value={draft.reactionHooks ?? ''} onChange={(reactionHooks) => onChange({ ...draft, reactionHooks })} placeholder="Choices that would make people instantly have an opinion: no face, outdoor recording, chapters, odd samples, strict visual rules." />
      </ProfileField>
      <ProfileField label="Mythology">
        <TextArea value={draft.mythology ?? ''} onChange={(mythology) => onChange({ ...draft, mythology })} placeholder="Recurring symbols, settings, objects, phrases, references, rituals, eras, colors, places, and motifs." />
      </ProfileField>
      <ProfileField label="Emotional territory">
        <TextArea value={draft.emotionalTerritory ?? ''} onChange={(emotionalTerritory) => onChange({ ...draft, emotionalTerritory })} placeholder="The feelings the artist owns: longing, escape, triumph, decay, wonder, seduction, isolation, freedom." />
      </ProfileField>
      <ProfileField label="Audience gravity">
        <TextArea value={draft.audienceGravity ?? ''} onChange={(audienceGravity) => onChange({ ...draft, audienceGravity })} placeholder="Who feels seen psychologically, not demographically: lonely overachievers, small-town dreamers, people leaving bad relationships." />
      </ProfileField>
      <ProfileField label="Notes" wide>
        <TextArea value={draft.notes ?? ''} onChange={(notes) => onChange({ ...draft, notes })} placeholder="Extra brand observations, open questions, ideas for the branding agent, or patterns to investigate later." />
      </ProfileField>
    </div>
  )
}

function ProfileField({
  label,
  wide,
  children,
}: {
  label: string
  wide?: boolean
  children: React.ReactNode
}) {
  return (
    <label className={cn('block rounded-[14px] border border-white/[0.05] bg-black/20 p-3', wide && 'lg:col-span-2')}>
      <span className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.16em] text-white/78">{label}</span>
      {children}
    </label>
  )
}

const HQ_DAY_ACTIONS: CalendarDayAction[] = [
  { id: 'event', label: 'Add event', icon: FileText },
  { id: 'job', label: 'Add job', icon: Bot },
]

function ArtistCalendarView({
  compact,
  events,
  selectedDate,
  visibleMonth,
  disabled,
  selectedDateEvents,
  workById,
  workspaceId,
  editingEventId,
  editDraft,
  onSelectDate,
  onChangeMonth,
  onChangeEditDraft,
  onEditEvent,
  onCancelEditEvent,
  onSaveEditEvent,
  onDeleteEvent,
  onQueueHqWork,
}: {
  compact?: boolean
  events: ArtistCalendarEvent[]
  selectedDate: string
  visibleMonth: Date
  disabled?: boolean
  selectedDateEvents: ArtistCalendarEvent[]
  workById: Map<string, ScheduledWorkOrder>
  workspaceId: string
  editingEventId: string | null
  editDraft: CalendarEditDraft
  onSelectDate: (date: string) => void
  onChangeMonth: (month: Date) => void
  onChangeEditDraft: (draft: CalendarEditDraft) => void
  onEditEvent: (event: ArtistCalendarEvent) => void
  onCancelEditEvent: () => void
  onSaveEditEvent: (eventId: string) => void
  onDeleteEvent: (eventId: string) => void
  onQueueHqWork: (type?: ScheduledWorkComposerEntry['suggestedType']) => void
}) {
  const [detailEventId, setDetailEventId] = React.useState<string | null>(null)
  React.useEffect(() => {
    const raw = sessionStorage.getItem('artist-os:scheduled-work-focus')
    if (!raw) return
    try {
      const target = JSON.parse(raw) as { workspaceId?: string; orderId?: string }
      if (target.workspaceId !== workspaceId || !target.orderId) return
      const event = events.find((candidate) => candidate.scheduledWorkId === target.orderId)
      if (!event) return
      onSelectDate(event.date)
      onChangeMonth(parseDateKey(event.date))
      setDetailEventId(event.id)
      sessionStorage.removeItem('artist-os:scheduled-work-focus')
    } catch {
      sessionStorage.removeItem('artist-os:scheduled-work-focus')
    }
  }, [events, onChangeMonth, onSelectDate, workspaceId])
  const dayMetaByDate = React.useMemo(() => {
    const metaByDate = new Map<string, CalendarMonthDayMeta>()
    for (const event of events) {
      const work = event.scheduledWorkId ? workById.get(event.scheduledWorkId) : undefined
      const current = metaByDate.get(event.date) ?? { count: 0, items: [] }
      metaByDate.set(event.date, {
        count: (current.count ?? 0) + 1,
        items: [...(current.items ?? []), { id: event.id, label: event.title, detail: `${event.time || 'All day'}${work ? ` - ${work.status.replace(/-/g, ' ')}` : ''}` }],
      })
    }
    return metaByDate
  }, [events, workById])
  const selectedLabel = parseDateKey(selectedDate).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <CalendarMonthGrid
        compact={compact}
        appearance="paper"
        visibleMonth={visibleMonth}
        selectedDate={selectedDate}
        dayMetaByDate={dayMetaByDate}
        dayActions={HQ_DAY_ACTIONS}
        onSelectDate={onSelectDate}
        onChangeMonth={onChangeMonth}
        onDayAction={(date, actionId) => {
          onSelectDate(date)
          onQueueHqWork(actionId === 'event' ? 'event' : undefined)
        }}
        onSelectItem={(date, itemId) => {
          onSelectDate(date)
          setDetailEventId(itemId)
        }}
      />

      <Drawer direction="right" open={detailEventId !== null} onOpenChange={(open) => { if (!open) setDetailEventId(null) }}>
        <DrawerContent className="w-[min(420px,92vw)] border-white/[0.07] bg-[#090909] sm:max-w-[420px]">
          <DrawerHeader className="border-b border-white/[0.06]">
            <DrawerTitle className="text-base text-white/82">{selectedLabel}</DrawerTitle>
            <DrawerDescription>Calendar item details and controls</DrawerDescription>
          </DrawerHeader>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
          {selectedDateEvents.length === 0 ? (
            <div className="rounded-[12px] border border-white/[0.045] bg-white/[0.016] p-3 text-xs text-white/36">
              No events yet.
            </div>
          ) : selectedDateEvents.filter((event) => !detailEventId || event.id === detailEventId).map((event) => {
            const work = event.scheduledWorkId ? workById.get(event.scheduledWorkId) : undefined
            const agentResult = work?.result?.type === 'agent-task' ? work.result : undefined
            const workflowResult = work?.result?.type === 'workflow-run' ? work.result : undefined
            const outputIds = work?.result && 'outputIds' in work.result ? work.result.outputIds : []
            const latestRun = work?.runs.at(-1)
            return (
            <div key={event.id} className="rounded-[12px] border border-white/[0.055] bg-white/[0.025] p-3">
              {editingEventId === event.id ? (
                <div className="space-y-2">
                  <input
                    type="date"
                    value={editDraft.date}
                    onChange={(input) => onChangeEditDraft({ ...editDraft, date: input.target.value })}
                    className="h-9 w-full rounded-[10px] border border-white/[0.06] bg-black/25 px-3 text-xs text-white/75 outline-none focus:border-white/16"
                  />
                  <Input value={editDraft.title} onChange={(title) => onChangeEditDraft({ ...editDraft, title })} placeholder="Title" />
                  <Input value={editDraft.time} onChange={(time) => onChangeEditDraft({ ...editDraft, time })} placeholder="Time, optional" />
                  <textarea
                    value={editDraft.notes}
                    onChange={(input) => onChangeEditDraft({ ...editDraft, notes: input.target.value })}
                    placeholder="Notes, optional"
                    className="min-h-[74px] w-full rounded-[10px] border border-white/[0.06] bg-black/25 px-3 py-2 text-xs leading-5 text-white/75 outline-none placeholder:text-white/28 focus:border-white/16"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={onCancelEditEvent}
                      className="inline-flex h-8 items-center gap-1.5 rounded-full border border-white/[0.07] px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/55 hover:bg-white/[0.04]"
                    >
                      <X className="h-3.5 w-3.5" />
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => onSaveEditEvent(event.id)}
                      disabled={disabled}
                      className="inline-flex h-8 items-center gap-1.5 rounded-full bg-white/90 px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-black hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Save
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-sm font-semibold text-white/76">{event.title}</div>
                      {work ? <span className="rounded-full bg-white/[0.05] px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.12em] text-white/44">{work.status.replace(/-/g, ' ')}</span> : null}
                    </div>
                    {event.time ? <div className="mt-1 text-[10px] font-medium uppercase tracking-[0.12em] text-orange-200/65">{event.time}</div> : null}
                    {event.notes ? <div className="mt-2 text-xs leading-5 text-white/38">{event.notes}</div> : null}
                    <ContextBadges
                      workspaceLinks={event.workspaceLinks}
                      googleStatus={event.google?.syncStatus}
                      relatedCount={event.relatedPersonIds.length}
                    />
                    {work?.attention ? <div className="mt-2 rounded-[6px] border border-red-300/10 bg-red-300/[0.04] px-2 py-1.5 text-[11px] text-red-100/65">{work.attention.message}</div> : null}
                    {work ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {agentResult ? <HqWorkLink label="Open session" onClick={() => window.electronAPI.openSessionInNewWindow(workspaceId, agentResult.sessionId)} /> : null}
                        {workflowResult ? <HqWorkLink label="Open run" onClick={() => navigate(routes.view.workflowRun(workflowResult.workflowRunId))} /> : null}
                        {!agentResult && latestRun?.sessionId ? <HqWorkLink label="Open session" onClick={() => window.electronAPI.openSessionInNewWindow(workspaceId, latestRun.sessionId!)} /> : null}
                        {!workflowResult && latestRun?.workflowRunId ? <HqWorkLink label="Open run" onClick={() => navigate(routes.view.workflowRun(latestRun.workflowRunId!))} /> : null}
                        {outputIds.map((outputId, index) => <HqWorkLink key={outputId} label={outputIds.length === 1 ? 'Open Output' : `Output ${index + 1}`} onClick={() => navigate(routes.view.output(outputId))} />)}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {!work ? <button
                      type="button"
                      onClick={() => onEditEvent(event)}
                      disabled={disabled}
                      className="rounded-full p-1.5 text-white/28 hover:bg-white/[0.05] hover:text-white/70 disabled:cursor-not-allowed disabled:opacity-40"
                      aria-label="Edit event"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button> : null}
                    {!work ? <button
                      type="button"
                      onClick={() => { onDeleteEvent(event.id); setDetailEventId(null) }}
                      disabled={disabled}
                      className="rounded-full p-1.5 text-white/28 hover:bg-white/[0.05] hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-40"
                      aria-label="Delete event"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button> : null}
                  </div>
                </div>
              )}
            </div>
          )})}
        </div>
        </DrawerContent>
      </Drawer>
    </div>
  )
}

function HqWorkLink({ label, onClick }: { label: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="inline-flex h-7 items-center gap-1 rounded-[5px] border border-white/[0.07] px-2 text-[10px] font-medium text-white/52 hover:bg-white/[0.04]">{label}<ExternalLink className="h-3 w-3" /></button>
}

function NetworkCategoryGrid({
  categories,
  allPeople,
  selectedCategoryId,
  onToggleCategory,
  onAddToCategory,
}: {
  categories: ArtistNetworkCategoryDefinition[]
  allPeople: ArtistNetworkPerson[]
  selectedCategoryId: ArtistNetworkCategory | null
  onToggleCategory: (categoryId: ArtistNetworkCategory) => void
  onAddToCategory: (categoryId: ArtistNetworkCategory) => void
}) {
  return (
    <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5" aria-label="People categories">
      {categories.map((category) => {
        const count = allPeople.filter((person) => person.category === category.id).length
        const selected = selectedCategoryId === category.id
        return (
          <div
            key={category.id}
            className={cn(
              'group flex h-11 min-w-0 items-center rounded-[10px] transition-colors',
              selected
                ? 'bg-[#f97316]/14 shadow-[inset_0_0_0_1px_rgba(249,115,22,0.46)]'
                : 'bg-white/[0.035] hover:bg-white/[0.07]',
            )}
          >
            <button
              type="button"
              aria-pressed={selected}
              onClick={() => onToggleCategory(category.id)}
              className="flex h-full min-w-0 flex-1 items-center gap-2 pl-3 text-left"
            >
              <span className={cn('min-w-0 flex-1 truncate text-xs font-medium', selected ? 'text-orange-100/90' : 'text-white/62 group-hover:text-white/82')}>{category.label}</span>
              <span className={cn('text-[10px] tabular-nums', selected ? 'text-orange-100/55' : 'text-white/25')}>{count}</span>
            </button>
            <button
              type="button"
              aria-label={`Add person to ${category.label}`}
              onClick={() => onAddToCategory(category.id)}
              className="mr-1 grid h-8 w-8 shrink-0 place-items-center rounded-[8px] text-[#f97316]/60 transition-colors hover:bg-black/15 hover:text-[#f97316]"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        )
      })}
    </div>
  )
}

function NetworkBoard({
  categories,
  people,
  selectedCategoryId,
  onSelectPerson,
  onTogglePersonStar,
}: {
  categories: ArtistNetworkCategoryDefinition[]
  people: ArtistNetworkPerson[]
  selectedCategoryId: ArtistNetworkCategory | null
  onSelectPerson: (person: ArtistNetworkPerson) => void
  onTogglePersonStar: (person: ArtistNetworkPerson) => void
}) {
  return (
    <div>
      <div className="space-y-8">
      {categories.map((category) => {
        const categoryPeople = people.filter((person) => person.category === category.id)
        if (categoryPeople.length === 0) return null
        return (
          <section key={category.id}>
            <div className="mb-4 flex items-center gap-3">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/50">{category.label}</h3>
              <div className="h-px flex-1 bg-gradient-to-r from-white/[0.08] to-transparent" />
              <span className="rounded-full bg-white/[0.03] px-2 py-0.5 text-[10px] tabular-nums text-white/30">{categoryPeople.length}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {categoryPeople.map((person) => (
                <PersonCard
                  key={person.id}
                  person={person}
                  onClick={() => onSelectPerson(person)}
                  onToggleStar={() => onTogglePersonStar(person)}
                />
              ))}
            </div>
          </section>
        )
      })}
      {people.length === 0 ? (
        <EmptyLine
          title={selectedCategoryId ? `No people in ${categories.find((category) => category.id === selectedCategoryId)?.label ?? 'this category'}` : 'No people yet'}
          detail="Use a category + to add someone."
        />
      ) : null}
      </div>
    </div>
  )
}

function PersonCard({
  person,
  onClick,
  onToggleStar,
}: {
  person: ArtistNetworkPerson
  onClick: () => void
  onToggleStar: () => void
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          className="group flex h-12 w-fit min-w-[150px] max-w-[220px] items-center justify-center rounded-[9px] bg-white/[0.035] px-4 text-center transition-colors hover:bg-white/[0.065]"
        >
          <div className="min-w-0">
            <div className={cn(
              'truncate text-xs font-medium transition-colors',
              person.starred ? 'text-[#f97316]' : 'text-white/76 group-hover:text-white/92',
            )}>{person.name}</div>
            <div className="mt-0.5 truncate text-[10px] text-white/35">{person.role || person.email || 'No details yet'}</div>
          </div>
        </button>
      </ContextMenuTrigger>
      <StyledContextMenuContent minWidth="min-w-32">
        <StyledContextMenuItem onSelect={onToggleStar}>
          <Star className={person.starred ? 'fill-[#f97316] text-[#f97316]' : 'text-white/45'} />
          {person.starred ? 'Unstar person' : 'Star person'}
        </StyledContextMenuItem>
      </StyledContextMenuContent>
    </ContextMenu>
  )
}

function PersonDetailPanel({
  person,
  draft,
  categories,
  onChange,
  onClose,
  onSave,
  onDelete,
  disabled,
}: {
  person: ArtistNetworkPerson
  draft: NetworkDraft
  categories: ArtistNetworkCategoryDefinition[]
  onChange: (draft: NetworkDraft) => void
  onClose: () => void
  onSave: () => void
  onDelete: () => void
  disabled?: boolean
}) {
  return (
    <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[420px] flex-col border-l border-white/[0.08] bg-[#080808]/95 p-4 shadow-strong backdrop-blur-xl">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-white/35">Network</p>
          <h2 className="mt-1 text-xl font-semibold text-white/86">{person.name}</h2>
        </div>
        <button type="button" onClick={onClose} className="rounded-full border border-white/[0.08] p-2 text-white/45 hover:bg-white/[0.04] hover:text-white/70">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-1 gap-2">
        <Input value={draft.name} onChange={(name) => onChange({ ...draft, name })} placeholder="Name" />
        <select
          value={draft.category}
          onChange={(event) => onChange({ ...draft, category: event.target.value as ArtistNetworkCategory })}
          className="h-9 rounded-[10px] border border-white/[0.06] bg-black/30 px-3 text-xs text-white/75 outline-none"
        >
          {categories.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}
        </select>
        <Input value={draft.role} onChange={(role) => onChange({ ...draft, role })} placeholder="Role" />
        <Input type="email" value={draft.email} onChange={(email) => onChange({ ...draft, email })} placeholder="Email" />
        <Input value={draft.canHelpWith} onChange={(canHelpWith) => onChange({ ...draft, canHelpWith })} placeholder="Can help with" />
        <Input value={draft.tags} onChange={(tags) => onChange({ ...draft, tags })} placeholder="Tags, comma separated" />
        <textarea
          value={draft.notes}
          onChange={(event) => onChange({ ...draft, notes: event.target.value })}
          placeholder="Notes, context, recent history..."
          className="min-h-[120px] w-full rounded-[10px] border border-white/[0.06] bg-black/25 px-3 py-2 text-xs leading-5 text-white/75 outline-none placeholder:text-white/28 focus:border-white/16"
        />
      </div>

      <ContextBadges workspaceLinks={person.workspaceLinks} googleStatus={person.google?.syncStatus} />

      <div className="mt-auto flex items-center justify-between gap-3 pt-4">
        <button type="button" onClick={onDelete} disabled={disabled} className="inline-flex h-9 items-center gap-2 rounded-full border border-red-300/15 px-4 text-xs font-medium text-red-100/70 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40">
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </button>
        <button type="button" onClick={onSave} disabled={disabled} className="h-9 rounded-full bg-white/90 px-5 text-xs font-semibold text-black hover:bg-white disabled:cursor-not-allowed disabled:opacity-40">
          Save Changes
        </button>
      </div>
    </div>
  )
}

function ContextBadges({
  workspaceLinks,
  googleStatus,
  relatedCount,
}: {
  workspaceLinks: { workspaceId: string; workspaceName?: string; role?: string }[]
  googleStatus?: string
  relatedCount?: number
}) {
  const badges = [
    ...workspaceLinks.map((link) => link.workspaceName || link.role || 'Campaign linked'),
    googleStatus && googleStatus !== 'not-synced' ? `Google ${googleStatus}` : null,
    relatedCount ? `${relatedCount} people` : null,
  ].filter((badge): badge is string => Boolean(badge))

  if (badges.length === 0) return null

  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {badges.map((badge, index) => (
        <span
          key={`${badge}-${index}`}
          className="rounded-full border border-white/[0.06] bg-white/[0.025] px-2 py-1 text-[10px] font-medium text-white/38"
        >
          {badge}
        </span>
      ))}
    </div>
  )
}

function Input({
  value,
  onChange,
  placeholder,
  ...inputProps
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'placeholder'>) {
  return (
    <input
      {...inputProps}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className="h-9 w-full rounded-[10px] border border-white/[0.06] bg-black/25 px-3 text-xs text-white/75 outline-none placeholder:text-white/28 focus:border-white/16"
    />
  )
}

function TextArea({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <textarea
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className="min-h-[96px] w-full rounded-[10px] border border-white/[0.06] bg-black/25 px-3 py-2 text-xs leading-5 text-white/75 outline-none placeholder:text-white/28 focus:border-white/16"
    />
  )
}

function personToDraft(person: ArtistNetworkPerson): NetworkDraft {
  return {
    name: person.name,
    category: person.category,
    role: person.role ?? '',
    email: person.email ?? '',
    canHelpWith: person.canHelpWith ?? '',
    tags: person.tags.join(', '),
    notes: person.notes ?? '',
  }
}

function profileToDraft(profile: ArtistProfile): ProfileDraft {
  return {
    artistName: profile.artistName ?? '',
    mission: profile.mission ?? '',
    aliases: profile.aliases ?? '',
    bio: profile.bio ?? '',
    themes: profile.themes ?? '',
    sound: profile.sound ?? '',
    visualWorld: profile.visualWorld ?? '',
    bannerImagePath: profile.bannerImagePath ?? '',
    brandWords: profile.brandWords ?? '',
    audience: profile.audience ?? '',
    similarArtists: profile.similarArtists ?? '',
    priorityMarkets: profile.priorityMarkets ?? '',
    socialLinks: profile.socialLinks ?? '',
    spotifyProfile: profile.spotifyProfile ?? '',
    team: profile.team ?? '',
    promoBudget: profile.promoBudget ?? '',
    rules: profile.rules ?? '',
  }
}

function voiceToDraft(voice: ArtistVoice): VoiceDraft {
  return {
    summary: voice.summary ?? '',
    speakingStyle: voice.speakingStyle ?? '',
    vocabulary: voice.vocabulary ?? '',
    avoid: voice.avoid ?? '',
    captionExamples: voice.captionExamples ?? '',
    commentReplyExamples: voice.commentReplyExamples ?? '',
    postExamples: voice.postExamples ?? '',
    writingExcerpts: voice.writingExcerpts ?? '',
  }
}

function brandingToDraft(branding: ArtistBranding): BrandingDraft {
  return {
    creativeDna: branding.creativeDna ?? '',
    tensions: branding.tensions ?? '',
    fascinations: branding.fascinations ?? '',
    reactionHooks: branding.reactionHooks ?? '',
    mythology: branding.mythology ?? '',
    emotionalTerritory: branding.emotionalTerritory ?? '',
    audienceGravity: branding.audienceGravity ?? '',
    notes: branding.notes ?? '',
  }
}

function isResearchOutput(output: OutputSummaryDTO): boolean {
  const text = `${output.title} ${output.summary ?? ''} ${output.kind} ${(output.tags ?? []).join(' ')} ${output.origin?.agentName ?? ''}`.toLowerCase()
  return output.kind === 'report'
    || output.origin?.source === 'deep-research'
    || /\b(research|report|intel|analysis|spotify|youtube|trend)\b/.test(text)
}

function googleCalendarAutoSyncStorageKey(workspaceId: string): string {
  return `runneros:hq-google-calendar:${workspaceId}:last-auto-sync-at`
}

function joinWorkspacePath(rootPath: string, relativePath: string): string {
  const separator = rootPath.includes('\\') ? '\\' : '/'
  return `${rootPath.replace(/[\\/]$/, '')}${separator}${relativePath.replace(/^[\\/]/, '')}`
}

function isPreviewableBannerImage(path: string): boolean {
  return /\.(png|jpe?g|webp)$/i.test(path)
}

function readBooleanLocalStorage(key: string, fallback: boolean): boolean {
  try {
    const value = window.localStorage.getItem(key)
    if (value === '1') return true
    if (value === '0') return false
    return fallback
  } catch {
    return fallback
  }
}

function writeBooleanLocalStorage(key: string, value: boolean): void {
  try {
    window.localStorage.setItem(key, value ? '1' : '0')
  } catch {
    // Non-critical preference; keep the UI usable if storage is unavailable.
  }
}

function createSpotifySyncPrompt(): string {
  return `Run the Spotify snapshot for this Artist HQ workspace.

Use Artist Profile first, then use @printing-press-social from its injected absolute Local path to resolve the exact connected Spotify profile. Do not search for or use another RunnerOS checkout. Verify the live account, request the bounded Spotify for Artists snapshot browser plan, capture only visible values, and normalize the capture through \`snapshot spotify\` into this workspace.

If the Spotify browser profile is missing, logged out, or points at the wrong account, stop with that exact setup issue. Do not ask for Spotify client credentials and do not fabricate unavailable metrics.

Write the returned context payload to Artist HQ workspace context slug ${ARTIST_SPOTIFY_SNAPSHOT_CONTEXT_SLUG} so Spotify Pulse turns current.

Keep the final note short: snapshot date, key movement, any missing setup.`
}

function createSpotifySyncMatcher(executionTarget: PulseExecutionTarget = {}): Record<string, unknown> {
  return {
    name: SPOTIFY_SYNC_AUTOMATION_NAME,
    cron: SPOTIFY_SYNC_CRON,
    timezone: getLocalTimezone(),
    permissionMode: 'safe',
    labels: ['spotify', 'artist-hq', 'scheduled'],
    actions: [
      {
        type: 'prompt',
        agentSlug: 'spotify-analyst',
        prompt: createSpotifySyncPrompt(),
        ...executionTarget,
      },
    ],
  }
}

function createInstagramSyncPrompt(): string {
  return `Run the read-only Instagram Growth Snapshot for this Artist HQ workspace.

Load the instagram-growth-snapshot skill. If no exact Instagram profile was named, select the first ready Instagram profile returned by the live Printing Press Social catalog, preserving catalog order. Attach that saved browser session, verify the visible account identity, and read Instagram Insights for the last 14 completed days or the nearest visible supported range.

Save an immutable snapshot under data/instagram/snapshots and write its context payload to Workspace Context slug ${ARTIST_INSTAGRAM_SNAPSHOT_CONTEXT_SLUG} so Social Pulse updates.

Do not publish, reply, DM, follow, or change account settings. Never fabricate unavailable metrics. Keep the final note short: profile, actual reporting window, follower growth or decline, reach, interactions, and blockers.`
}

function createInstagramSyncMatcher(executionTarget: PulseExecutionTarget = {}): Record<string, unknown> {
  return {
    name: INSTAGRAM_SYNC_AUTOMATION_NAME,
    cron: INSTAGRAM_SYNC_CRON,
    timezone: getLocalTimezone(),
    permissionMode: 'safe',
    labels: ['instagram', 'insights', 'artist-hq', 'scheduled'],
    actions: [
      {
        type: 'prompt',
        agentSlug: 'social-publisher',
        prompt: createInstagramSyncPrompt(),
        ...executionTarget,
      },
    ],
  }
}

function createIntelSyncMatcher(
  workspaceName: string,
  workflowDigest: string,
  config: Pick<ArtistIntelConfig, 'sinceDays'>,
): Record<string, unknown> {
  return {
    name: INTEL_SYNC_AUTOMATION_NAME,
    cron: INTEL_SYNC_CRON,
    timezone: getLocalTimezone(),
    permissionMode: 'safe',
    labels: ['signals', 'intel', 'artist-hq', 'scheduled'],
    actions: [
      createSignalScanQueueWorkAction(workspaceName, workflowDigest, config),
    ],
  }
}

function isSpotifySyncAutomation(automation: AutomationListItem): boolean {
  if (automation.event !== 'SchedulerTick') return false
  if (automation.name === SPOTIFY_SYNC_AUTOMATION_NAME) return true
  return automation.actions.some((action) => (
    action.type === 'prompt'
    && action.agentSlug === 'spotify-analyst'
    && /artist-spotify-snapshot|weekly spotify/i.test(action.prompt)
  ))
}

function isInstagramSyncAutomation(automation: AutomationListItem): boolean {
  if (automation.event !== 'SchedulerTick') return false
  if (automation.name === INSTAGRAM_SYNC_AUTOMATION_NAME) return true
  return automation.actions.some((action) => (
    action.type === 'prompt'
    && action.agentSlug === 'social-publisher'
    && /artist-instagram-snapshot|instagram growth snapshot/i.test(action.prompt)
  ))
}

function isIntelSyncAutomation(automation: AutomationListItem): boolean {
  if (automation.event !== 'SchedulerTick') return false
  if (automation.name === INTEL_SYNC_AUTOMATION_NAME || automation.name === LEGACY_INTEL_SYNC_AUTOMATION_NAME) return true
  return automation.actions.some((action) => (
    (action.type === 'queue-work'
      && ((action.execution.type === 'workflow-run'
        && action.execution.workflowSlug === WEEKLY_SIGNAL_SCAN_SLUG)
        || (action.execution.type === 'agent-task'
          && action.execution.agentSlug === YOUTUBE_INTELLIGENCE_AGENT_SLUG)))
    || (action.type === 'prompt'
      && action.agentSlug === YOUTUBE_RESEARCH_AGENT_SLUG
      && /artist-intel-config|youtube intel pulse/i.test(action.prompt))
  ))
}

function isLegacyIntelSyncAutomation(automation: AutomationListItem): boolean {
  return automation.name === LEGACY_INTEL_SYNC_AUTOMATION_NAME
    || automation.actions.some((action) => (
      (action.type === 'queue-work'
        && action.execution.type === 'agent-task'
        && action.execution.agentSlug === YOUTUBE_INTELLIGENCE_AGENT_SLUG)
      || (action.type === 'prompt' && action.agentSlug === YOUTUBE_RESEARCH_AGENT_SLUG)
    ))
}

function requireAutomationMatcher(automation: AutomationListItem): Record<string, unknown> {
  if (!automation.rawMatcher) {
    throw new Error('Automation revision is unavailable. Refresh and try again.')
  }
  return automation.rawMatcher
}

function getLocalTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Chicago'
  } catch {
    return 'America/Chicago'
  }
}

function readTabFromHash(): ArtistHQTab {
  const raw = window.location.hash.startsWith(HQ_HASH_PREFIX)
    ? window.location.hash.slice(HQ_HASH_PREFIX.length)
    : ''
  if (raw === 'research') return 'signals'
  return isArtistHQTab(raw) ? raw : 'home'
}

function isArtistHQTab(value: string): value is ArtistHQTab {
  return value === 'home' || value === 'profile' || value === 'voice' || value === 'calendar' || value === 'network' || value === 'signals' || value === 'branding'
}
