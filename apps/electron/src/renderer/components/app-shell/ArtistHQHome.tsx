import * as React from 'react'
import {
  Bot,
  CalendarDays,
  CheckCircle2,
  Circle,
  ExternalLink,
  FileText,
  FolderKanban,
  History,
  MessageSquareText,
  Music2,
  Pencil,
  Plus,
  RefreshCw,
  Radio,
  Search,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  UserRound,
  Users,
  X,
} from 'lucide-react'
import { useAtomValue } from 'jotai'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { navigate, routes } from '@/lib/navigate'
import { useAppShellContext } from '@/context/AppShellContext'
import { useAgents } from '@/hooks/useAgents'
import { useOutputs, type OutputSummaryDTO } from '@/hooks/useOutputs'
import { useWorkspaceContext } from '@/hooks/useWorkspaceContext'
import { FinalsWidget } from '@/components/outputs/FinalsWidget'
import { skillsAtom } from '@/atoms/skills'
import { sourcesAtom } from '@/atoms/sources'
import {
  dedupeAgentsBySlug,
  proactiveHqModeStorageKey,
  resolveHqRouteReadiness,
} from '@/lib/artist-hq-proactive'
import { parseAutomationsConfig, type AutomationListItem } from '@/components/automations/types'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { ScheduledWorkComposer, type ScheduledWorkComposerEntry } from '@/components/calendar/ScheduledWorkComposer'
import { buildCampaignSchedulePlanFromComposer, buildHqSchedulePlanFromComposer, type ScheduledWorkComposerDraft } from '@/lib/scheduled-work-composer'
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
  parseHqStateOfPlay,
  type HqStateOfPlay,
  type HqRecommendationDetail,
  type HqStateEntityRef,
  type HqStateRouteHint,
} from '@craft-agent/shared/hq-state'
import {
  ARTIST_CALENDAR_CONTEXT_SLUG,
  artistCalendarMetadata,
  createCalendarEvent,
  parseArtistCalendarDocResult,
  serializeArtistCalendarBody,
  type ArtistCalendar,
  type ArtistCalendarEvent,
} from '@/lib/artist-calendar'
import {
  ARTIST_NETWORK_CONTEXT_SLUG,
  createNetworkCategory,
  artistNetworkMetadata,
  createNetworkPerson,
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
  parseArtistSpotifySnapshotDocResult,
} from '@/lib/artist-spotify'
import {
  ARTIST_INTEL_CONFIG_CONTEXT_SLUG,
  ARTIST_INTEL_REPORT_CONTEXT_SLUG,
  artistIntelConfigMetadata,
  artistIntelReportMetadata,
  createQueuedIntelRun,
  createIntelRunPrompt,
  createIntelQueueWorkAction,
  createScheduledIntelRunPrompt,
  isValidYouTubeChannelUrl,
  parseArtistIntelConfigDocResult,
  parseArtistIntelReportDocResult,
  serializeArtistIntelConfigBody,
  serializeArtistIntelReportBody,
  type ArtistIntelConfig,
  type ArtistIntelSource,
  YOUTUBE_INTELLIGENCE_AGENT_SLUG,
} from '@/lib/artist-intel'

interface ArtistHQHomeProps {
  workspaceId: string
  workspaceName?: string
  primaryCampaignWorkspaceName?: string
  primaryCampaignWorkspaceId?: string
  onOpenPrimaryCampaignWorkspace?: () => void
}

type ArtistHQTab = 'home' | 'profile' | 'voice' | 'calendar' | 'network' | 'research' | 'branding'
type NetworkDraft = {
  name: string
  category: ArtistNetworkCategory
  role: string
  contact: string
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

const HQ_HASH_PREFIX = '#artist-hq/'
const todayKey = toDateKey(new Date())
const SPOTIFY_SYNC_AUTOMATION_NAME = 'Weekly Spotify Snapshot'
const SPOTIFY_SYNC_CRON = '0 9 * * 1'
const INTEL_SYNC_AUTOMATION_NAME = 'Weekly YouTube Intel Pulse'
const INTEL_SYNC_CRON = '0 10 * * 1'
const YOUTUBE_RESEARCH_AGENT_SLUG = 'youtube-research-agent'
const GOOGLE_CALENDAR_SOURCE_SLUG = 'google-calendar'
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
  category: 'key',
  role: '',
  contact: '',
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

const projectColumns = [
  {
    id: 'focus',
    label: 'Focus',
    cards: [
      { title: 'Current Release', detail: 'Open the active campaign workspace', status: 'active', action: 'open-campaign' },
      { title: 'Spotify Pulse', detail: 'Connect analytics and review listener movement', status: 'waiting' },
    ],
  },
  {
    id: 'active',
    label: 'Active',
    cards: [
      { title: 'Content System', detail: 'Weekly clips and hooks', status: 'active' },
      { title: 'Audience Research', detail: 'Reference artists and cities', status: 'active' },
    ],
  },
  {
    id: 'waiting',
    label: 'Waiting',
    cards: [
      { title: 'Network Follow Ups', detail: 'People to touch this week', status: 'waiting' },
    ],
  },
  {
    id: 'upcoming',
    label: 'Upcoming',
    cards: [
      { title: 'Next Campaign', detail: 'Single, EP, album, or other release', status: 'planned' },
    ],
  },
]

export function ArtistHQHome({
  workspaceId,
  workspaceName,
  primaryCampaignWorkspaceName,
  primaryCampaignWorkspaceId,
  onOpenPrimaryCampaignWorkspace,
}: ArtistHQHomeProps) {
  const {
    activeAgents: shellActiveAgents = [],
  } = useAppShellContext()
  const { activeAgents: workspaceActiveAgents, allAgents } = useAgents(workspaceId)
  const skills = useAtomValue(skillsAtom)
  const sources = useAtomValue(sourcesAtom)
  const [tab, setTab] = React.useState<ArtistHQTab>(() => readTabFromHash())
  const [query, setQuery] = React.useState('')
  const [draftOpen, setDraftOpen] = React.useState(false)
  const [intelConfigOpen, setIntelConfigOpen] = React.useState(false)
  const [intelBusy, setIntelBusy] = React.useState(false)
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
  const [googleCalendarBusy, setGoogleCalendarBusy] = React.useState(false)
  const [googleCalendarConnected, setGoogleCalendarConnected] = React.useState(false)
  const [proactiveMode, setProactiveMode] = React.useState(() => readBooleanLocalStorage(proactiveHqModeStorageKey(workspaceId), false))
  const [hqRouteBusy, setHqRouteBusy] = React.useState(false)
  const { docs, loading, upsert, refresh: refreshContext } = useWorkspaceContext(workspaceId)
  const { outputs, loading: outputsLoading } = useOutputs(workspaceId)
  const profileResult = React.useMemo(
    () => parseArtistProfileDocResult(docs.find((doc) => doc.slug === ARTIST_PROFILE_CONTEXT_SLUG)),
    [docs],
  )
  const profile = profileResult.profile
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
  const intelSyncAutomation = React.useMemo(
    () => automations.find(isIntelSyncAutomation) ?? null,
    [automations],
  )
  const intelSyncActive = Boolean(intelSyncAutomation?.enabled)
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
  const youtubeIntelligenceAgent = React.useMemo(
    () => [...shellActiveAgents, ...workspaceActiveAgents, ...allAgents]
      .find((agent) => agent.slug === YOUTUBE_INTELLIGENCE_AGENT_SLUG),
    [allAgents, shellActiveAgents, workspaceActiveAgents],
  )
  const availableAgents = React.useMemo(
    () => dedupeAgentsBySlug([...shellActiveAgents, ...workspaceActiveAgents, ...allAgents]),
    [allAgents, shellActiveAgents, workspaceActiveAgents],
  )
  const researchDocs = React.useMemo(
    () => docs.filter((doc) => /research|report|intel|analysis/i.test(`${doc.slug} ${doc.metadata.name} ${doc.metadata.description ?? ''}`)),
    [docs],
  )
  const researchOutputs = React.useMemo(
    () => outputs.filter(isResearchOutput),
    [outputs],
  )
  const activeCalendarEvents = React.useMemo(
    () => calendar.events.filter((event) => !event.deletedAt),
    [calendar.events],
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

  React.useEffect(() => {
    setProactiveMode(readBooleanLocalStorage(proactiveHqModeStorageKey(workspaceId), false))
  }, [workspaceId])

  React.useEffect(() => {
    writeBooleanLocalStorage(proactiveHqModeStorageKey(workspaceId), proactiveMode)
  }, [proactiveMode, workspaceId])

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
    const onHashChange = () => setTab(readTabFromHash())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  React.useEffect(() => {
    if (!selectedPersonId) return
    if (!selectedPerson) setSelectedPersonId(null)
  }, [selectedPerson, selectedPersonId])

  React.useEffect(() => {
    setProfileDraft(profileToDraft(profile))
  }, [profile])

  React.useEffect(() => {
    setVoiceDraft(voiceToDraft(voice))
  }, [voice])

  React.useEffect(() => {
    setBrandingDraft(brandingToDraft(branding))
  }, [branding])

  React.useEffect(() => {
    if (intelReport.status !== 'queued') return
    const interval = window.setInterval(() => {
      refreshContext()
    }, 10000)
    return () => window.clearInterval(interval)
  }, [intelReport.status, refreshContext])

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

  const toggleIntelPulse = React.useCallback(async () => {
    if (!intelConfigResult.ok) {
      toast.error(intelConfigResult.error)
      return
    }
    setIntelBusy(true)
    try {
      const nextEnabled = !intelConfig.enabled
      await saveIntelConfig({
        ...intelConfig,
        enabled: nextEnabled,
      })
      if (intelSyncAutomation && nextEnabled && isLegacyIntelSyncAutomation(intelSyncAutomation)) {
        await window.electronAPI.deleteAutomation(workspaceId, intelSyncAutomation.event, intelSyncAutomation.matcherIndex)
        if (intelConfig.cadence === 'weekly') {
          await window.electronAPI.createAutomationFromTemplate(
            workspaceId,
            'SchedulerTick',
            createIntelSyncMatcher(workspaceName || 'Artist HQ'),
          )
        }
      } else if (intelSyncAutomation) {
        await window.electronAPI.setAutomationEnabled(
          workspaceId,
          intelSyncAutomation.event,
          intelSyncAutomation.matcherIndex,
          nextEnabled && intelConfig.cadence === 'weekly',
        )
      } else if (nextEnabled && intelConfig.cadence === 'weekly') {
        await window.electronAPI.createAutomationFromTemplate(
          workspaceId,
          'SchedulerTick',
          createIntelSyncMatcher(workspaceName || 'Artist HQ'),
        )
      }
      await refreshAutomations()
      toast.success(nextEnabled ? 'Intel Pulse activated' : 'Intel Pulse paused')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setIntelBusy(false)
    }
  }, [intelConfig, intelConfigResult, intelSyncAutomation, refreshAutomations, saveIntelConfig, workspaceId, workspaceName])

  const runIntelPulse = React.useCallback(async () => {
    if (!workspaceId || !intelConfigResult.ok) return
    if (!youtubeIntelligenceAgent) {
      toast.error('YouTube Intelligence Agent is not installed in this workspace')
      return
    }
    setIntelBusy(true)
    try {
      const config = intelConfig.enabled ? intelConfig : { ...intelConfig, enabled: true }
      if (!intelConfig.enabled) {
        await saveIntelConfig(config)
      }
      const generatedAt = new Date().toISOString()
      const result = await window.electronAPI.testAutomation({
        workspaceId,
        automationName: 'Manual YouTube Intel Pulse',
        actions: [createIntelQueueWorkAction(workspaceName || 'Artist HQ', createIntelRunPrompt(config, workspaceName || 'Artist HQ'))],
        permissionMode: 'safe',
        labels: ['youtube', 'intel', 'artist-hq', 'manual'],
      })
      const queued = result.actions.find((action) => action.type === 'queue-work')
      if (!queued || !queued.success || !queued.workOrderIds?.[0]) throw new Error(queued?.error || 'Intel work was not queued.')
      await upsert({
        slug: ARTIST_INTEL_REPORT_CONTEXT_SLUG,
        metadata: artistIntelReportMetadata(),
        body: serializeArtistIntelReportBody(createQueuedIntelRun(intelReport, {
          workOrderId: queued.workOrderIds[0],
          sourceCount: config.sources.length,
          generatedAt,
        })),
      })
      toast.success('Intel Pulse started')
    } catch (error) {
      toast.error('Failed to start Intel Pulse', {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setIntelBusy(false)
    }
  }, [
    intelConfig,
    intelConfigResult,
    intelReport,
    saveIntelConfig,
    upsert,
    workspaceId,
    workspaceName,
    youtubeIntelligenceAgent,
  ])

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
        )
        toast.success(spotifySyncAutomation.enabled ? 'Spotify sync paused' : 'Spotify sync enabled')
      } else {
        await window.electronAPI.createAutomationFromTemplate(
          workspaceId,
          'SchedulerTick',
          createSpotifySyncMatcher(),
        )
        toast.success('Weekly Spotify sync enabled')
      }
      await refreshAutomations()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setSpotifySyncBusy(false)
    }
  }, [refreshAutomations, spotifySyncAutomation, workspaceId])

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
    const person = createNetworkPerson(draft)
    const nextNetwork: ArtistNetwork = {
      version: 1,
      categories: network.categories,
      people: [...network.people, person],
      updatedAt: new Date().toISOString(),
    }
    try {
      await saveNetwork(nextNetwork)
      setDraft(emptyNetworkDraft)
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
      setDraft((value) => ({ ...value, category: nextCategory.id }))
      toast.success('Category added')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }, [categoryDraft, network.categories, network.people, saveNetwork])

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

  const filteredPeople = React.useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return network.people
    return network.people.filter((person) => [
      person.name,
      person.role,
      person.contact,
      person.location,
      person.canHelpWith,
      person.notes,
      ...person.tags,
    ].filter(Boolean).join(' ').toLowerCase().includes(needle))
  }, [network.people, query])

  const artistName = profile.artistName || workspaceName || 'Artist HQ'
  const nextDate = 'This week'

  // Dynamic header properties based on active tab
  const getHeaderProps = () => {
    switch (tab) {
      case 'calendar':
        return {
          title: 'Calendar',
          description: 'Schedule, events, and important dates for the artist.',
          orb1: 'bg-indigo-600/10',
          orb2: 'bg-purple-500/5',
          icon: <CalendarDays className="h-3.5 w-3.5 text-white/58" />,
          label: 'Schedule',
        }
      case 'network':
        return {
          title: 'Network',
          description: 'Relationships, roles, contact info, and context on everyone who matters to the artist.',
          orb1: 'bg-emerald-600/10',
          orb2: 'bg-teal-500/5',
          icon: <Users className="h-3.5 w-3.5 text-white/58" />,
          label: 'Contacts',
        }
      case 'profile':
        return {
          title: 'Profile',
          description: 'Global context every worker should know before touching campaigns, content, research, ads, or outreach.',
          orb1: 'bg-blue-600/10',
          orb2: 'bg-indigo-500/5',
          icon: <UserRound className="h-3.5 w-3.5 text-white/58" />,
          label: 'Context',
        }
      case 'voice':
        return {
          title: 'Voice',
          description: 'How the artist talks, writes captions, phrases ideas, and wants public copy to sound.',
          orb1: 'bg-pink-600/10',
          orb2: 'bg-orange-500/5',
          icon: <MessageSquareText className="h-3.5 w-3.5 text-white/58" />,
          label: 'Style',
        }
      case 'branding':
        return {
          title: 'Branding',
          description: 'Artist positioning, narrative, voice, references, and creative direction.',
          orb1: 'bg-blue-600/10',
          orb2: 'bg-emerald-500/5',
          icon: <Sparkles className="h-3.5 w-3.5 text-white/58" />,
          label: 'Brain',
        }
      default:
        return {
          title: artistName,
          description: 'Global career context, signals, calendar, network, and research. Campaign workspaces pull from here.',
          orb1: 'bg-orange-600/10',
          orb2: 'bg-cyan-500/5',
          icon: <Sparkles className="h-3.5 w-3.5 text-white/58" />,
          label: 'Artist HQ',
        }
    }
  }

  const headerProps = getHeaderProps()

  return (
    <div className="h-full overflow-y-auto bg-[#050505] text-foreground">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-3 px-5 py-4 xl:px-8 xl:py-5">
        <section className="relative overflow-hidden rounded-[24px] border border-white/[0.05] bg-[#0A0A0A] p-6 lg:p-8">
          <div className={cn("absolute -left-[18%] -top-[50%] h-[520px] w-[520px] rounded-full blur-[110px]", headerProps.orb1)} />
          <div className={cn("absolute -bottom-[50%] -right-[12%] h-[520px] w-[520px] rounded-full blur-[120px]", headerProps.orb2)} />
          <div className="relative z-10">
            <div className="flex items-start justify-between gap-4">
              <div className="inline-flex items-center gap-2.5 rounded-full border border-white/[0.05] bg-white/[0.02] px-3 py-1.5 pr-4">
                {headerProps.icon}
                <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-white/70">{headerProps.label}</span>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-white/35">Next</p>
                <p className="mt-1.5 text-xs font-medium text-white/70">{nextDate}</p>
              </div>
            </div>

            <div className="mt-8 max-w-3xl">
              <h1 className="text-4xl font-medium tracking-tighter text-white/90 sm:text-5xl lg:text-[56px] lg:leading-[0.96]">
                {headerProps.title}
              </h1>
              <p className="mt-3 max-w-2xl text-sm font-light leading-relaxed text-white/50">
                {headerProps.description}
              </p>
            </div>

          </div>
        </section>

        {tab === 'home' && (
          <>
            <StateOfPlayPanel
              state={hqState}
              workspaceId={workspaceId}
              proactiveMode={proactiveMode}
              routeBusy={hqRouteBusy}
              availableAgentSlugs={new Set(availableAgents.map((agent) => agent.slug))}
              onToggleProactiveMode={setProactiveMode}
              onLaunchRoute={launchHqRoute}
              onOpenEntity={openHqStateEntity}
              onTransitionRecommendation={transitionHqRecommendation}
            />

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
              <HQCard className="lg:col-span-1">
                <div className="mb-3 flex items-center justify-between gap-3 border-b border-white/[0.04] pb-2.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <Music2 className="h-3 w-3 shrink-0 text-white/40" />
                    <h3 className="truncate text-[11px] font-semibold uppercase tracking-[0.16em] text-white/48">
                      Spotify Pulse
                    </h3>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/24">
                      {spotifySnapshot ? spotifySnapshot.snapshotDate : 'connect'}
                    </span>
                    <button
                      type="button"
                      onClick={toggleSpotifySync}
                      disabled={spotifySyncBusy}
                      title={spotifySyncActive ? 'Weekly Spotify sync active' : 'Enable weekly Spotify sync'}
                      className={cn(
                        'inline-flex h-6 w-6 items-center justify-center rounded-full border transition-colors',
                        spotifySyncActive
                          ? 'border-emerald-400/35 bg-emerald-500/12 text-emerald-300'
                          : 'border-white/[0.07] bg-white/[0.02] text-white/28 hover:text-white/60',
                        spotifySyncBusy && 'cursor-wait opacity-60',
                      )}
                      aria-label={spotifySyncActive ? 'Pause weekly Spotify sync' : 'Enable weekly Spotify sync'}
                    >
                      <RefreshCw className={cn('h-3.5 w-3.5', spotifySyncBusy && 'animate-spin')} />
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Metric
                    label={spotifyIsPublicApi ? 'Popularity' : 'Streams'}
                    value={spotifyIsPublicApi ? formatMetric(spotifySnapshot?.metrics.popularity) : formatMetric(spotifySnapshot?.metrics.streams)}
                  />
                  <Metric
                    label={spotifyIsPublicApi ? 'Top track' : 'Listeners'}
                    value={spotifyIsPublicApi ? spotifySnapshot?.tracks?.[0]?.name ?? '--' : formatMetric(spotifySnapshot?.metrics.listeners)}
                  />
                  <Metric label="Followers" value={formatMetric(spotifySnapshot?.metrics.followers)} />
                  <Metric
                    label={spotifyIsPublicApi ? 'Genres' : 'Top city'}
                    value={spotifyIsPublicApi ? spotifySnapshot?.artist.genres?.[0] ?? '--' : spotifySnapshot?.geo?.topCities?.[0]?.city ?? '--'}
                  />
                </div>
                <p className="mt-3 text-xs leading-5 text-white/38">
                  {spotifySnapshot
                    ? spotifyIsPublicApi
                      ? 'Latest public Spotify API snapshot. Streams and listeners require Spotify for Artists access.'
                      : `Latest ${spotifySnapshot.windowDays}-day Spotify for Artists snapshot.`
                    : 'Run Spotify Analyst to create the first snapshot.'}
                </p>
                <p className="mt-2 text-[10px] font-medium uppercase tracking-[0.12em] text-white/25">
                  {spotifySyncActive ? 'Weekly sync active' : 'Weekly sync off'}
                </p>
                {!spotifyResult.ok ? (
                  <p className="mt-2 text-xs leading-5 text-red-100/65">{spotifyResult.error}</p>
                ) : null}
              </HQCard>

              <IntelPulseCard
                config={intelConfig}
                report={intelReport}
                configError={intelConfigResult.ok ? null : intelConfigResult.error}
                reportError={intelReportResult.ok ? null : intelReportResult.error}
                busy={intelBusy}
                agentReady={Boolean(youtubeIntelligenceAgent)}
                scheduled={intelSyncActive}
                onToggle={toggleIntelPulse}
                onRun={runIntelPulse}
                onEdit={() => setIntelConfigOpen(true)}
              />

              <HQCard>
                <SectionTitle icon={CalendarDays} title="This Week" meta="calendar" />
                <TimelineItem time="Today" title="Review active campaign" />
                <TimelineItem time="Next" title="Plan content and outreach" />
                <TimelineItem time="Soon" title="Add key dates to Calendar" />
              </HQCard>

              <HQCard>
                <SectionTitle icon={Bot} title="Workers" meta="quiet" />
                <EmptyLine title="No active global workers" detail="Spotify sync, research monitors, and calendar jobs will appear here." />
              </HQCard>

              <FinalsWidget
                title="Artist Kit / Finals"
                outputs={outputs}
                scope="hq"
                loading={outputsLoading}
                onOpenOutput={(outputId) => navigate(routes.view.output(outputId))}
              />
            </div>

            <HQCard>
              <SectionTitle icon={FolderKanban} title="Projects" meta="global" />
              <ProjectBoard
                primaryCampaignWorkspaceName={primaryCampaignWorkspaceName}
                onOpenPrimaryCampaignWorkspace={onOpenPrimaryCampaignWorkspace}
              />
            </HQCard>
          </>
        )}

        {tab === 'profile' && (
          <HQCard>
            <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <SectionTitle icon={UserRound} title="Profile" meta={`${profilePercent}% complete`} compact />
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
                <SectionTitle icon={MessageSquareText} title="Voice" meta={`${voicePercent}% complete`} compact />
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
          <HQCard>
            {!calendarResult.ok ? (
              <div className="mb-4 rounded-[14px] border border-red-400/20 bg-red-500/10 p-3 text-xs leading-5 text-red-100/80">
                {calendarResult.error} Saving is paused so existing calendar context is not overwritten.
              </div>
            ) : null}
            {!scheduledWorkResult.ok ? (
              <div className="mb-4 rounded-[14px] border border-red-400/20 bg-red-500/10 p-3 text-xs leading-5 text-red-100/80">
                {scheduledWorkResult.error} Queueing is paused so existing scheduled work is not overwritten.
              </div>
            ) : null}
            <ArtistCalendarView
              events={activeCalendarEvents}
              selectedDate={selectedDate}
              visibleMonth={visibleMonth}
              disabled={!calendarResult.ok || !scheduledWorkResult.ok}
              googleConnected={googleCalendarConnected}
              googleBusy={googleCalendarBusy}
              onSelectDate={setSelectedDate}
              onChangeMonth={setVisibleMonth}
              editingEventId={calendarEditId}
              editDraft={calendarEditDraft}
              onChangeEditDraft={setCalendarEditDraft}
              onEditEvent={openCalendarEventEdit}
              onCancelEditEvent={cancelCalendarEventEdit}
              onSaveEditEvent={saveCalendarEventEdit}
              onDeleteEvent={deleteCalendarEvent}
              onConnectGoogle={connectGoogleCalendar}
              onSyncGoogle={syncGoogleCalendar}
              onQueueHqWork={(type) => {
                setCalendarComposerType(type)
                setCalendarComposerTarget('hq')
              }}
              selectedDateEvents={selectedDateEvents}
              workById={scheduledWorkById}
              workspaceId={workspaceId}
            />
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
        )}

        {tab === 'network' && (
          <HQCard>
            <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/28" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search people..."
                    className="h-9 w-52 rounded-full border border-white/[0.06] bg-black/20 pl-8 pr-3 text-xs text-white/75 outline-none placeholder:text-white/28 focus:border-white/16"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setDraftOpen((value) => !value)}
                  className="inline-flex h-9 items-center gap-2 rounded-full bg-white/90 px-4 text-xs font-medium text-black"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Person
                </button>
              </div>
            </div>

            <div className="mb-4 flex flex-col gap-2 rounded-[14px] border border-white/[0.05] bg-black/20 p-3 sm:flex-row sm:items-center">
              <Input value={categoryDraft} onChange={setCategoryDraft} placeholder="New category name" />
              <button
                type="button"
                onClick={addCategory}
                disabled={!networkResult.ok}
                className="h-9 shrink-0 rounded-[10px] border border-white/[0.08] px-3 text-xs font-medium text-white/65 hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-40"
              >
                Add Category
              </button>
            </div>

            {draftOpen && (
              <div className="mb-4 rounded-[16px] border border-white/[0.06] bg-white/[0.025] p-3">
                <div className="grid grid-cols-1 gap-2 md:grid-cols-5">
                  <Input value={draft.name} onChange={(name) => setDraft((value) => ({ ...value, name }))} placeholder="Name" />
                  <select
                    value={draft.category}
                    onChange={(event) => setDraft((value) => ({ ...value, category: event.target.value as ArtistNetworkCategory }))}
                    className="h-9 rounded-[10px] border border-white/[0.06] bg-black/30 px-3 text-xs text-white/75 outline-none"
                  >
                    {network.categories.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}
                  </select>
                  <Input value={draft.role} onChange={(role) => setDraft((value) => ({ ...value, role }))} placeholder="Role" />
                  <Input value={draft.contact} onChange={(contact) => setDraft((value) => ({ ...value, contact }))} placeholder="Contact" />
                  <button type="button" onClick={addPerson} disabled={!networkResult.ok} className="h-9 rounded-[10px] bg-[#f97316]/80 px-3 text-xs font-medium text-white hover:bg-[#f97316] disabled:cursor-not-allowed disabled:opacity-40">
                    Save
                  </button>
                </div>
                <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                  <Input value={draft.canHelpWith} onChange={(canHelpWith) => setDraft((value) => ({ ...value, canHelpWith }))} placeholder="Can help with" />
                  <Input value={draft.tags} onChange={(tags) => setDraft((value) => ({ ...value, tags }))} placeholder="Tags, comma separated" />
                </div>
                <textarea
                  value={draft.notes}
                  onChange={(event) => setDraft((value) => ({ ...value, notes: event.target.value }))}
                  placeholder="Notes, how they can help, last context..."
                  className="mt-2 min-h-[70px] w-full rounded-[10px] border border-white/[0.06] bg-black/25 px-3 py-2 text-xs leading-5 text-white/75 outline-none placeholder:text-white/28 focus:border-white/16"
                />
              </div>
            )}

            {!networkResult.ok ? (
              <div className="mb-4 rounded-[14px] border border-red-400/20 bg-red-500/10 p-3 text-xs leading-5 text-red-100/80">
                {networkResult.error} Saving is paused so existing relationship context is not overwritten.
              </div>
            ) : null}

            <NetworkBoard categories={network.categories} people={filteredPeople} onSelectPerson={openPerson} />
          </HQCard>
        )}

        {tab === 'branding' && (
          <HQCard>
            <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <SectionTitle icon={Sparkles} title="Branding" meta={`${brandingPercent}% complete`} compact />
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

        {tab === 'research' && (
          <HQCard>
            <SectionTitle icon={FileText} title="Research Reports" meta={loading || outputsLoading ? 'loading' : `${researchDocs.length + researchOutputs.length}`} />
            {researchDocs.length === 0 && researchOutputs.length === 0 ? (
              <EmptyLine title="No research reports yet" detail="Research, Spotify analysis, YouTube intel, and trend reports will live here." />
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {researchOutputs.map((output) => (
                  <button
                    key={output.id}
                    type="button"
                    onClick={() => navigate(routes.view.output(output.id))}
                    className="rounded-[14px] border border-white/[0.05] bg-black/20 p-3 text-left transition-colors hover:bg-white/[0.035]"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="truncate text-sm font-medium text-white/78">{output.title}</div>
                      <ExternalLink className="h-3.5 w-3.5 shrink-0 text-white/24" />
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-white/40">{output.summary || output.origin?.agentName || output.kind}</p>
                  </button>
                ))}
                {researchDocs.map((doc) => (
                  <div key={doc.slug} className="rounded-[14px] border border-white/[0.05] bg-black/20 p-3">
                    <div className="truncate text-sm font-medium text-white/78">{doc.metadata.name}</div>
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-white/40">{doc.metadata.description || doc.body}</p>
                  </div>
                ))}
              </div>
            )}
          </HQCard>
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
      <IntelConfigDialog
        open={intelConfigOpen}
        config={intelConfig}
        onOpenChange={setIntelConfigOpen}
        onSave={async (nextConfig) => {
          try {
            await saveIntelConfig(nextConfig)
            if (intelSyncAutomation) {
              await window.electronAPI.setAutomationEnabled(
                workspaceId,
                intelSyncAutomation.event,
                intelSyncAutomation.matcherIndex,
                nextConfig.enabled && nextConfig.cadence === 'weekly',
              )
            } else if (nextConfig.enabled && nextConfig.cadence === 'weekly') {
              await window.electronAPI.createAutomationFromTemplate(
                workspaceId,
                'SchedulerTick',
                createIntelSyncMatcher(workspaceName || 'Artist HQ'),
              )
            }
            await refreshAutomations()
            toast.success('Intel channels saved')
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
    <section className={cn('rounded-2xl border border-white/[0.04] bg-[#0A0A0A] p-4 shadow-minimal', className)}>
      {children}
    </section>
  )
}

function SectionTitle({
  icon: Icon,
  title,
  meta,
  compact,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  meta?: string
  compact?: boolean
}) {
  return (
    <div className={cn('flex items-center justify-between gap-3', compact ? '' : 'mb-3 border-b border-white/[0.04] pb-2.5')}>
      <div className="flex items-center gap-2">
        <Icon className="h-3 w-3 text-white/40" />
        <h3 className="text-[9px] font-medium uppercase tracking-[0.15em] text-white/60">{title}</h3>
      </div>
      {meta ? <span className="text-[8px] font-medium uppercase tracking-widest text-white/30">{meta}</span> : null}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[13px] border border-white/[0.045] bg-white/[0.018] p-3">
      <div className="text-[9px] font-medium uppercase tracking-[0.14em] text-white/32">{label}</div>
      <div title={value} className="mt-2 truncate text-lg font-medium text-white/80">{value}</div>
    </div>
  )
}

function StateOfPlayPanel({
  state,
  workspaceId,
  proactiveMode,
  routeBusy,
  availableAgentSlugs,
  onToggleProactiveMode,
  onLaunchRoute,
  onOpenEntity,
  onTransitionRecommendation,
}: {
  state: HqStateOfPlay | null
  workspaceId: string
  proactiveMode: boolean
  routeBusy: boolean
  availableAgentSlugs: Set<string>
  onToggleProactiveMode: (enabled: boolean) => void
  onLaunchRoute: (route: HqStateRouteHint, recommendationId?: string) => void
  onOpenEntity: (entity: HqStateEntityRef) => void
  onTransitionRecommendation: (recommendationId: string, to: 'dismissed' | 'snoozed') => void
}) {
  const recommendationId = state?.nextMove.recommendationId
  const [detail, setDetail] = React.useState<HqRecommendationDetail | null>(null)
  const [historyOpen, setHistoryOpen] = React.useState(false)

  React.useEffect(() => {
    setDetail(null)
    setHistoryOpen(false)
    if (!recommendationId) return
    let cancelled = false
    window.electronAPI.getHqRecommendationDetail(workspaceId, recommendationId)
      .then((value) => { if (!cancelled) setDetail(value) })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [recommendationId, workspaceId])

  if (!state) {
    return (
      <HQCard>
        <div className="mb-3 flex items-center justify-between gap-3 border-b border-white/[0.04] pb-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <Sparkles className="h-3 w-3 text-white/40" />
            <h3 className="truncate text-[9px] font-medium uppercase tracking-[0.15em] text-white/60">State of Play</h3>
          </div>
          <Switch
            checked={proactiveMode}
            onCheckedChange={onToggleProactiveMode}
            aria-label={proactiveMode ? 'Disable proactive HQ mode' : 'Enable proactive HQ mode'}
            className="data-[state=checked]:bg-orange-300"
          />
        </div>
        <EmptyLine
          title="No HQ brief generated yet"
          detail="Save artist context, share intel, sync calendar, or update Vault to generate the operating brief."
        />
      </HQCard>
    )
  }

  const attention = state.attention.slice(0, 3)
  const alternatives = state.alternatives.slice(0, 3)
  const missing = state.missing.slice(0, 5)
  const unhealthySources = state.sourceHealth.filter((source) => source.status !== 'fresh')
  const generatedLabel = formatShortDate(state.generatedAt)
  const route = state.nextMove.route
  const recommendationStatus = state.nextMove.recommendationStatus ?? 'proposed'
  const launchableStatus = ['proposed', 'viewed', 'accepted', 'failed'].includes(recommendationStatus)
  const canDeferRecommendation = ['proposed', 'viewed', 'accepted', 'failed'].includes(recommendationStatus)
  const routeReadiness = resolveHqRouteReadiness(route, availableAgentSlugs, proactiveMode)
  const canLaunchRoute = routeReadiness.canLaunch && launchableStatus

  return (
    <HQCard>
      <div className="mb-4 flex flex-col gap-3 border-b border-white/[0.04] pb-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-orange-200/70" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/45">State of Play</span>
          </div>
          <h2 className="line-clamp-2 text-xl font-medium tracking-tight text-white/88 md:text-2xl">
            {state.nextMove.title}
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-white/48">{state.nextMove.why}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 md:justify-end">
          {state.nextMove.worker ? <Pill label={`@${state.nextMove.worker}`} /> : null}
          {state.nextMove.action ? <Pill label={state.nextMove.action} /> : null}
          {route ? <Pill label={canLaunchRoute ? `${route.confidence} route` : 'review needed'} muted={!canLaunchRoute} /> : null}
          {state.nextMove.recommendationStatus ? <Pill label={state.nextMove.recommendationStatus} muted={state.nextMove.recommendationStatus !== 'proposed'} /> : null}
          <Pill label={generatedLabel} muted />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.35fr_0.8fr]">
        <div className="space-y-2">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/35">Attention</div>
          {attention.length > 0 ? (
            attention.map((item) => (
              <div key={`${item.kind}-${item.source}-${item.text}`} className="rounded-[13px] border border-white/[0.045] bg-white/[0.018] p-3">
                <div className="flex items-start gap-2">
                  <Circle className="mt-1.5 h-1.5 w-1.5 shrink-0 fill-orange-300 text-orange-300" />
                  <div className="min-w-0">
                    <div className="text-sm font-medium leading-5 text-white/74">{item.text}</div>
                    <div className="mt-1 text-[10px] uppercase tracking-[0.12em] text-white/28">{item.kind} / {item.source}</div>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <EmptyLine title="No urgent attention items" detail="The generated brief did not flag immediate risks." />
          )}
          {alternatives.length > 0 ? (
            <div className="pt-2">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/35">Also Consider</div>
              <div className="space-y-1.5">
                {alternatives.map((move) => {
                  const content = (
                    <>
                      <span className="min-w-0 flex-1 truncate text-left text-xs text-white/62">{move.title}</span>
                      {move.recommendationStatus ? <span className="text-[9px] uppercase tracking-[0.12em] text-white/28">{move.recommendationStatus}</span> : null}
                    </>
                  )
                  return move.entityRef ? (
                    <button
                      key={move.recommendationId ?? move.title}
                      type="button"
                      onClick={() => onOpenEntity(move.entityRef!)}
                      className="flex h-9 w-full items-center gap-2 rounded-[10px] border border-white/[0.045] bg-white/[0.018] px-3 transition-colors hover:bg-white/[0.045]"
                    >
                      {content}
                      <ExternalLink className="h-3 w-3 shrink-0 text-white/28" />
                    </button>
                  ) : (
                    <div key={move.recommendationId ?? move.title} className="flex h-9 items-center gap-2 rounded-[10px] border border-white/[0.045] bg-white/[0.018] px-3">
                      {content}
                    </div>
                  )
                })}
              </div>
            </div>
          ) : null}
        </div>

        <div className="space-y-3">
          {route ? (
            <div className="rounded-[14px] border border-white/[0.045] bg-black/20 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/35">Proactive</div>
                <Switch
                  checked={proactiveMode}
                  onCheckedChange={onToggleProactiveMode}
                  aria-label={proactiveMode ? 'Disable proactive HQ mode' : 'Enable proactive HQ mode'}
                  className="data-[state=checked]:bg-orange-300"
                />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Pill label={route.target === 'agent' && route.agentSlug ? `@${route.agentSlug}` : 'manual'} muted={!routeReadiness.agentAvailable && route.target === 'agent'} />
                <Pill label={route.confidence} muted={route.confidence !== 'high'} />
                <Pill label={`${route.contextDocSlugs.length} docs`} muted />
              </div>
              <p className="mt-3 line-clamp-3 text-xs leading-5 text-white/44">
                {routeReadiness.blockedReason ?? route.prompt}
              </p>
              {state.nextMove.entityRef ? (
                <button
                  type="button"
                  onClick={() => onOpenEntity(state.nextMove.entityRef!)}
                  className="mt-3 inline-flex h-8 w-full items-center justify-center gap-2 rounded-[10px] border border-white/[0.08] bg-white/[0.035] px-3 text-xs font-medium text-white/72 transition-colors hover:bg-white/[0.07]"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open item
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => route ? onLaunchRoute(route, state.nextMove.recommendationId) : undefined}
                disabled={!canLaunchRoute || routeBusy}
                className={cn(
                  'mt-3 inline-flex h-8 w-full items-center justify-center rounded-[10px] border px-3 text-xs font-medium transition-colors',
                  canLaunchRoute
                    ? 'border-orange-300/25 bg-orange-300/10 text-orange-100/82 hover:bg-orange-300/16'
                    : 'cursor-not-allowed border-white/[0.055] bg-white/[0.018] text-white/28',
                  routeBusy && 'cursor-wait opacity-70',
                )}
              >
                {routeBusy
                  ? 'Starting...'
                  : recommendationStatus === 'failed'
                    ? 'Retry Route'
                    : recommendationStatus === 'awaiting_approval'
                      ? 'Awaiting Approval'
                      : recommendationStatus === 'launched' || recommendationStatus === 'in_progress'
                        ? 'Work in Progress'
                        : recommendationStatus === 'completed'
                          ? 'Completed'
                          : proactiveMode ? (routeReadiness.blockedReason ? 'Start Review' : 'Start Route') : 'Proactive Off'}
              </button>
              {state.nextMove.recommendationId && canDeferRecommendation ? (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => onTransitionRecommendation(state.nextMove.recommendationId!, 'snoozed')}
                    disabled={routeBusy}
                    className="h-8 rounded-[10px] border border-white/[0.06] bg-white/[0.02] text-xs text-white/48 transition-colors hover:bg-white/[0.05] hover:text-white/70 disabled:opacity-40"
                  >
                    Snooze 7 days
                  </button>
                  <button
                    type="button"
                    onClick={() => onTransitionRecommendation(state.nextMove.recommendationId!, 'dismissed')}
                    disabled={routeBusy}
                    className="h-8 rounded-[10px] border border-white/[0.06] bg-white/[0.02] text-xs text-white/48 transition-colors hover:bg-white/[0.05] hover:text-white/70 disabled:opacity-40"
                  >
                    Dismiss
                  </button>
                </div>
              ) : null}
              {detail ? (
                <div className="mt-2 border-t border-white/[0.05] pt-2">
                  <button
                    type="button"
                    onClick={() => setHistoryOpen((open) => !open)}
                    className="flex h-8 w-full items-center justify-between text-xs text-white/48 hover:text-white/72"
                  >
                    <span className="inline-flex items-center gap-2"><History className="h-3.5 w-3.5" />History</span>
                    <span>{detail.events.length}</span>
                  </button>
                  {historyOpen ? (
                    <div className="mt-1 space-y-2 border-l border-white/[0.06] pl-3">
                      {detail.events.slice(0, 6).map((event) => (
                        <div key={event.id} className="text-[11px] leading-4 text-white/42">
                          <span className="font-medium text-white/62">{event.to.replaceAll('_', ' ')}</span>
                          <span> / {formatShortDate(event.createdAt)}</span>
                          {event.reason ? <div className="line-clamp-2 text-white/32">{event.reason}</div> : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {(recommendationStatus === 'completed' || recommendationStatus === 'failed') ? (
                    <div className="mt-2 flex items-center gap-2">
                      <span className="mr-auto text-[10px] uppercase tracking-[0.12em] text-white/30">Was this useful?</span>
                      {(['useful', 'not_useful'] as const).map((usefulness) => (
                        <button
                          key={usefulness}
                          type="button"
                          onClick={async () => {
                            try {
                              const outcome = await window.electronAPI.setHqRecommendationUsefulness(workspaceId, { recommendationId: detail.candidate.id, usefulness })
                              setDetail((current) => current ? { ...current, outcome } : current)
                            } catch (error) {
                              toast.error('Could not save recommendation feedback', { description: error instanceof Error ? error.message : String(error) })
                            }
                          }}
                          className={cn(
                            'h-7 rounded-[8px] border px-2 text-[10px] transition-colors',
                            detail.outcome?.userUsefulness === usefulness
                              ? 'border-orange-300/25 bg-orange-300/10 text-orange-100/80'
                              : 'border-white/[0.06] text-white/42 hover:bg-white/[0.04]',
                          )}
                        >
                          {usefulness === 'useful' ? 'Useful' : 'Not useful'}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="rounded-[14px] border border-white/[0.045] bg-black/20 p-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/35">Gaps</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {missing.length > 0 ? (
                missing.map((item) => <Pill key={item} label={item} muted />)
              ) : (
                <span className="text-xs leading-5 text-white/42">No blocking context gaps.</span>
              )}
            </div>
            {state.momentum.up.length > 0 ? (
              <div className="mt-4">
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/30">Momentum</div>
                <p className="mt-2 line-clamp-3 text-xs leading-5 text-white/44">{state.momentum.up.join(' ')}</p>
              </div>
            ) : null}
            <div className="mt-4 border-t border-white/[0.05] pt-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/30">System Evidence</div>
              {unhealthySources.length > 0 ? (
                <div className="mt-2 space-y-2">
                  {unhealthySources.map((source) => (
                    <div key={source.source} className="text-xs leading-5 text-orange-100/62">
                      <span className="font-medium capitalize">{source.source.replaceAll('-', ' ')}</span>
                      <span className="text-white/38"> / {source.message ?? source.status}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-xs text-white/40">Operational sources are healthy.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </HQCard>
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

function Pill({ label, muted }: { label: string; muted?: boolean }) {
  return (
    <span className={cn(
      'inline-flex max-w-full items-center rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.12em]',
      muted
        ? 'border-white/[0.055] bg-white/[0.018] text-white/34'
        : 'border-orange-300/18 bg-orange-300/8 text-orange-100/76',
    )}>
      <span className="truncate">{label}</span>
    </span>
  )
}

function IntelPulseCard({
  config,
  report,
  configError,
  reportError,
  busy,
  agentReady,
  scheduled,
  onToggle,
  onRun,
  onEdit,
}: {
  config: ArtistIntelConfig
  report: ReturnType<typeof parseArtistIntelReportDocResult>['report']
  configError: string | null
  reportError: string | null
  busy: boolean
  agentReady: boolean
  scheduled: boolean
  onToggle: () => void
  onRun: () => void
  onEdit: () => void
}) {
  const latestLabel = report.generatedAt ? formatShortDate(report.generatedAt) : 'not run'
  const running = report.status === 'queued'
  const statusLabel = report.status === 'queued'
    ? 'Running'
    : report.status === 'ready'
      ? 'Ready'
      : report.status === 'failed'
        ? 'Needs check'
        : config.enabled ? scheduled ? 'Scheduled' : 'Manual' : 'Off'

  return (
    <HQCard>
      <div className="mb-3 flex items-center justify-between gap-3 border-b border-white/[0.04] pb-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Radio className="h-3 w-3 shrink-0 text-white/40" />
          <h3 className="truncate text-[11px] font-semibold uppercase tracking-[0.16em] text-white/48">
            Intel Pulse
          </h3>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/24">
            {statusLabel}
          </span>
          <button
            type="button"
            onClick={onToggle}
            disabled={busy}
            title={config.enabled ? 'Pause Intel Pulse' : 'Activate Intel Pulse'}
            className={cn(
              'inline-flex h-6 w-6 items-center justify-center rounded-full border transition-colors',
              config.enabled
                ? 'border-emerald-400/35 bg-emerald-500/12 text-emerald-300'
                : 'border-white/[0.07] bg-white/[0.02] text-white/28 hover:text-white/60',
              busy && 'cursor-wait opacity-60',
            )}
            aria-label={config.enabled ? 'Pause Intel Pulse' : 'Activate Intel Pulse'}
          >
            <RefreshCw className={cn('h-3.5 w-3.5', busy && 'animate-spin')} />
          </button>
          <button
            type="button"
            onClick={onEdit}
            title="Edit Intel channels"
            className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-white/[0.07] bg-white/[0.02] text-white/28 transition-colors hover:text-white/65"
            aria-label="Edit Intel channels"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Metric label="Channels" value={String(config.sources.length)} />
        <Metric label="Latest" value={latestLabel} />
      </div>
      <p className="mt-3 line-clamp-2 text-xs leading-5 text-white/38">
        {report.summary || 'Watches selected YouTube channels and turns new videos into artist-facing research.'}
      </p>
      <div className="mt-3 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onRun}
          disabled={busy || running || !agentReady || config.sources.length === 0}
          className="h-8 rounded-full bg-white/90 px-4 text-xs font-semibold text-black hover:bg-white disabled:cursor-not-allowed disabled:opacity-45"
        >
          {busy ? 'Starting...' : running ? 'Running' : 'Run'}
        </button>
        {report.outputId || report.sessionId ? (
          <button
            type="button"
            onClick={() => report.outputId
              ? navigate(routes.view.output(report.outputId))
              : navigate(routes.view.allSessions(report.sessionId!))}
            className="h-8 rounded-full border border-white/[0.08] px-3 text-xs font-medium text-white/55 hover:bg-white/[0.04]"
          >
            Open report
          </button>
        ) : null}
      </div>
      <p className="mt-2 text-[10px] font-medium uppercase tracking-[0.12em] text-white/25">
        {config.enabled
          ? scheduled ? 'Weekly automation active' : 'Manual radar active'
          : 'Radar off'}
      </p>
      {report.runs.length > 0 ? (
        <div className="mt-3 space-y-1.5 border-t border-white/[0.04] pt-2">
          {report.runs.slice(0, 3).map((run) => (
            <div key={run.id} className="flex items-center justify-between gap-3 text-[11px] leading-4">
              <span className="truncate text-white/38">{run.summary || run.title || run.status}</span>
              <span className="shrink-0 uppercase tracking-[0.1em] text-white/22">{run.status}</span>
            </div>
          ))}
        </div>
      ) : null}
      {!agentReady ? (
        <p className="mt-2 text-xs leading-5 text-yellow-100/65">YouTube Intelligence Agent is not active in this workspace.</p>
      ) : null}
      {configError || reportError ? (
        <p className="mt-2 text-xs leading-5 text-red-100/65">{configError || reportError}</p>
      ) : null}
    </HQCard>
  )
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

  React.useEffect(() => {
    if (!open) return
    setSources(config.sources)
    setSinceDays(config.sinceDays)
    setCadence(config.cadence)
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
  }, [])

  const removeSource = React.useCallback((id: string) => {
    setSources((current) => current.filter((source) => source.id !== id))
  }, [])

  const save = React.useCallback(() => {
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
    void onSave({
      ...config,
      cadence,
      sources: nextSources,
      sinceDays,
      maxPerChannel: 1,
      updatedAt: new Date().toISOString(),
    })
  }, [cadence, config, onSave, sinceDays, sources])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[760px] border-white/[0.08] bg-[#080808] text-white shadow-2xl">
        <DialogHeader>
          <DialogTitle className="text-xl font-medium">Intel channels</DialogTitle>
          <DialogDescription className="text-white/42">
            Pick the YouTube channels this HQ should watch.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block space-y-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/36">Cadence</span>
              <select
                value={cadence}
                onChange={(event) => setCadence(event.target.value as ArtistIntelConfig['cadence'])}
                className="h-9 w-full rounded-[10px] border border-white/[0.08] bg-white/[0.025] px-3 text-sm text-white/80 outline-none focus:border-orange-400/45"
              >
                <option value="weekly">Weekly</option>
                <option value="manual">Manual</option>
              </select>
            </label>
            <label className="block space-y-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/36">Scan days</span>
              <input
                type="number"
                min={1}
                max={30}
                value={sinceDays}
                onChange={(event) => setSinceDays(Number(event.target.value))}
                className="h-9 w-full rounded-[10px] border border-white/[0.08] bg-white/[0.025] px-3 text-sm text-white/80 outline-none focus:border-orange-400/45"
              />
            </label>
          </div>
          <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
            {sources.map((source) => (
              <div key={source.id} className="rounded-[14px] border border-white/[0.055] bg-white/[0.018] p-3">
                <div className="grid gap-2 md:grid-cols-[1fr_1.35fr_120px_34px]">
                  <Input value={source.name} onChange={(name) => updateSource(source.id, { name })} placeholder="Channel name" />
                  <Input value={source.url} onChange={(url) => updateSource(source.id, { url })} placeholder="https://www.youtube.com/@channel" />
                  <select
                    value={source.priority}
                    onChange={(event) => updateSource(source.id, { priority: event.target.value as ArtistIntelSource['priority'] })}
                    className="h-9 rounded-[10px] border border-white/[0.06] bg-black/30 px-3 text-xs text-white/75 outline-none"
                  >
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => removeSource(source.id)}
                    className="inline-flex h-9 items-center justify-center rounded-[10px] border border-white/[0.07] text-white/35 hover:bg-white/[0.04] hover:text-white/70"
                    aria-label={`Remove ${source.name || 'channel'}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <textarea
                  value={source.notes ?? ''}
                  onChange={(event) => updateSource(source.id, { notes: event.target.value })}
                  placeholder="Why this channel matters..."
                  className="mt-2 min-h-[58px] w-full rounded-[10px] border border-white/[0.06] bg-black/25 px-3 py-2 text-xs leading-5 text-white/75 outline-none placeholder:text-white/28 focus:border-white/16"
                />
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between gap-3 pt-1">
            <button
              type="button"
              onClick={addSource}
              className="inline-flex h-9 items-center gap-2 rounded-full border border-white/[0.08] px-4 text-xs font-medium text-white/62 hover:bg-white/[0.04]"
            >
              <Plus className="h-3.5 w-3.5" />
              Add channel
            </button>
            <button
              type="button"
              onClick={save}
              className="h-9 rounded-full bg-white px-5 text-xs font-semibold text-black"
            >
              Save
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function formatMetric(value: number | undefined): string {
  if (typeof value !== 'number') return '--'
  return new Intl.NumberFormat('en-US', { notation: value >= 10000 ? 'compact' : 'standard' }).format(value)
}

function formatShortDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date)
}

function TimelineItem({ time, title }: { time: string; title: string }) {
  return (
    <div className="flex items-start gap-3 py-1.5">
      <div className="w-12 text-[10px] font-medium uppercase tracking-[0.12em] text-white/28">{time}</div>
      <Circle className="mt-1 h-2 w-2 fill-orange-400 text-orange-400" />
      <div className="text-sm font-medium text-white/72">{title}</div>
    </div>
  )
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
      <span className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.16em] text-white/35">{label}</span>
      {children}
    </label>
  )
}

const HQ_DAY_ACTIONS: CalendarDayAction[] = [
  { id: 'event', label: 'Add event', icon: FileText },
  { id: 'job', label: 'Add job', icon: Bot },
]

function ArtistCalendarView({
  events,
  selectedDate,
  visibleMonth,
  disabled,
  googleConnected,
  googleBusy,
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
  onConnectGoogle,
  onSyncGoogle,
  onQueueHqWork,
}: {
  events: ArtistCalendarEvent[]
  selectedDate: string
  visibleMonth: Date
  disabled?: boolean
  googleConnected?: boolean
  googleBusy?: boolean
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
  onConnectGoogle: () => void
  onSyncGoogle: () => void
  onQueueHqWork: (type?: ScheduledWorkComposerEntry['suggestedType']) => void
}) {
  const [detailEventId, setDetailEventId] = React.useState<string | null>(null)
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
    <div>
      <div className="mb-3 flex justify-end gap-1.5">
        <button
          type="button"
          onClick={onConnectGoogle}
          disabled={googleBusy}
          className="h-8 rounded-[6px] border border-white/[0.07] px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/55 hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {googleConnected ? 'Reconnect Google' : 'Connect Google'}
        </button>
        <button
          type="button"
          onClick={onSyncGoogle}
          disabled={disabled || googleBusy}
          className="inline-flex h-8 items-center gap-1.5 rounded-[6px] bg-white/90 px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-black hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', googleBusy && 'animate-spin')} />
          Sync
        </button>
      </div>
      <CalendarMonthGrid
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

function ProjectBoard({
  primaryCampaignWorkspaceName,
  onOpenPrimaryCampaignWorkspace,
}: {
  primaryCampaignWorkspaceName?: string
  onOpenPrimaryCampaignWorkspace?: () => void
}) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
      {projectColumns.map((column) => (
        <div key={column.id} className="min-h-[210px] rounded-[14px] border border-white/[0.05] bg-black/20 p-3">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/42">{column.label}</div>
            <span className="text-[10px] text-white/28">{column.cards.length}</span>
          </div>
          <div className="space-y-2">
            {column.cards.map((card) => {
              const isCampaignAction = card.action === 'open-campaign'
              const disabled = isCampaignAction && !onOpenPrimaryCampaignWorkspace
              const detail = isCampaignAction
                ? primaryCampaignWorkspaceName
                  ? `Open ${primaryCampaignWorkspaceName}`
                  : 'No campaign workspace yet'
                : card.detail

              const content = (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <div className="truncate text-sm font-semibold text-white/76">{card.title}</div>
                    {isCampaignAction ? <ExternalLink className="h-3.5 w-3.5 shrink-0 text-white/28" /> : null}
                  </div>
                  <div className="mt-1 line-clamp-2 text-xs leading-5 text-white/38">{detail}</div>
                </>
              )

              if (isCampaignAction) {
                return (
                  <button
                    key={card.title}
                    type="button"
                    onClick={onOpenPrimaryCampaignWorkspace}
                    disabled={disabled}
                    className={cn(
                      'w-full rounded-[12px] border border-white/[0.055] bg-white/[0.025] p-3 text-left transition-colors',
                      disabled
                        ? 'cursor-not-allowed opacity-55'
                        : 'hover:border-[#fb923c]/35 hover:bg-[#fb923c]/[0.055]',
                    )}
                    aria-label={primaryCampaignWorkspaceName ? `Open ${primaryCampaignWorkspaceName}` : 'No campaign workspace available'}
                  >
                    {content}
                  </button>
                )
              }

              return (
                <div key={card.title} className="rounded-[12px] border border-white/[0.055] bg-white/[0.025] p-3">
                  {content}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

function NetworkBoard({
  categories,
  people,
  onSelectPerson,
}: {
  categories: ArtistNetworkCategoryDefinition[]
  people: ArtistNetworkPerson[]
  onSelectPerson: (person: ArtistNetworkPerson) => void
}) {
  return (
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
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {categoryPeople.map((person) => (
                <PersonCard key={person.id} person={person} onClick={() => onSelectPerson(person)} />
              ))}
            </div>
          </section>
        )
      })}
      {people.length === 0 ? (
        <EmptyLine title="No people yet" detail="Add the real humans around the artist: DJs, producers, curators, collaborators, press, brands, and VIPs." />
      ) : null}
    </div>
  )
}

function PersonCard({ person, onClick }: { person: ArtistNetworkPerson; onClick: () => void }) {
  return (
    <button 
      type="button" 
      onClick={onClick} 
      className="group flex flex-col justify-between rounded-[14px] border border-white/[0.04] bg-white/[0.015] p-3 text-left transition-all hover:bg-white/[0.03] hover:border-white/[0.08] hover:shadow-lg hover:-translate-y-0.5"
    >
      <div className="flex items-start justify-between gap-2 w-full">
        <div className="flex items-center justify-center h-8 w-8 rounded-full bg-gradient-to-br from-white/10 to-white/5 border border-white/10 shrink-0">
          <UserRound className="h-4 w-4 text-white/60" />
        </div>
        {person.relationship && person.relationship !== 'new' ? (
          <span className={cn(
            "rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em]",
            person.relationship === 'vip' ? "bg-purple-500/10 text-purple-300" :
            person.relationship === 'strong' ? "bg-orange-500/10 text-orange-300" :
            "bg-blue-500/10 text-blue-300"
          )}>
            {person.relationship}
          </span>
        ) : null}
      </div>
      
      <div className="mt-3 w-full">
        <div className="truncate text-sm font-semibold text-white/80 group-hover:text-white transition-colors">{person.name}</div>
        <div className="mt-0.5 truncate text-[11px] text-white/40">{person.role || person.contact || 'No role added'}</div>
      </div>
      
      {person.tags.length > 0 ? (
        <div className="mt-3 flex w-full flex-wrap gap-1.5 overflow-hidden h-[20px]">
          {person.tags.slice(0, 3).map(tag => (
            <span key={tag} className="inline-flex items-center rounded-[6px] bg-white/[0.04] px-1.5 py-0.5 text-[9px] font-medium text-white/40">
              {tag}
            </span>
          ))}
          {person.tags.length > 3 && (
            <span className="inline-flex items-center rounded-[6px] bg-white/[0.02] px-1.5 py-0.5 text-[9px] font-medium text-white/30">
              +{person.tags.length - 3}
            </span>
          )}
        </div>
      ) : (
        <div className="mt-3 h-[20px]" />
      )}
    </button>
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
    <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[420px] flex-col border-l border-white/[0.08] bg-[#080808]/95 p-4 shadow-2xl backdrop-blur-xl">
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
        <Input value={draft.contact} onChange={(contact) => onChange({ ...draft, contact })} placeholder="Contact" />
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

function Input({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className="h-9 rounded-[10px] border border-white/[0.06] bg-black/25 px-3 text-xs text-white/75 outline-none placeholder:text-white/28 focus:border-white/16"
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
    contact: person.contact ?? '',
    canHelpWith: person.canHelpWith ?? '',
    tags: person.tags.join(', '),
    notes: person.notes ?? '',
  }
}

function profileToDraft(profile: ArtistProfile): ProfileDraft {
  return {
    artistName: profile.artistName ?? '',
    aliases: profile.aliases ?? '',
    bio: profile.bio ?? '',
    themes: profile.themes ?? '',
    sound: profile.sound ?? '',
    visualWorld: profile.visualWorld ?? '',
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

function createSpotifySyncMatcher(): Record<string, unknown> {
  return {
    name: SPOTIFY_SYNC_AUTOMATION_NAME,
    cron: SPOTIFY_SYNC_CRON,
    timezone: getLocalTimezone(),
    permissionMode: 'ask',
    labels: ['spotify', 'artist-hq', 'scheduled'],
    actions: [
      {
        type: 'prompt',
        agentSlug: 'spotify-analyst',
        prompt: `Run the weekly Spotify snapshot for this Artist HQ workspace.

Use Artist Profile first, then resolve the exact connected Spotify profile with Printing Press Social. Verify the live account, request the bounded Spotify for Artists snapshot browser plan, capture only visible values, and normalize the capture through \`snapshot spotify\` into this workspace.

If the Spotify browser profile is missing, logged out, or points at the wrong account, stop with that exact setup issue. Do not ask for Spotify client credentials and do not fabricate unavailable metrics.

Write the returned context payload to Artist HQ workspace context slug ${ARTIST_SPOTIFY_SNAPSHOT_CONTEXT_SLUG} so Spotify Pulse turns current.

Keep the final note short: snapshot date, key movement, any missing setup.`,
      },
    ],
  }
}

function createIntelSyncMatcher(workspaceName: string): Record<string, unknown> {
  return {
    name: INTEL_SYNC_AUTOMATION_NAME,
    cron: INTEL_SYNC_CRON,
    timezone: getLocalTimezone(),
    permissionMode: 'safe',
    labels: ['youtube', 'intel', 'artist-hq', 'scheduled'],
    actions: [
      createIntelQueueWorkAction(workspaceName, createScheduledIntelRunPrompt(workspaceName)),
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

function isIntelSyncAutomation(automation: AutomationListItem): boolean {
  if (automation.event !== 'SchedulerTick') return false
  if (automation.name === INTEL_SYNC_AUTOMATION_NAME) return true
  return automation.actions.some((action) => (
    (action.type === 'queue-work'
      && action.execution.type === 'agent-task'
      && action.execution.agentSlug === YOUTUBE_INTELLIGENCE_AGENT_SLUG)
    || (action.type === 'prompt'
      && action.agentSlug === YOUTUBE_RESEARCH_AGENT_SLUG
      && /artist-intel-config|youtube intel pulse/i.test(action.prompt))
  ))
}

function isLegacyIntelSyncAutomation(automation: AutomationListItem): boolean {
  return automation.actions.some((action) => action.type === 'prompt' && action.agentSlug === YOUTUBE_RESEARCH_AGENT_SLUG)
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
  return isArtistHQTab(raw) ? raw : 'home'
}

function isArtistHQTab(value: string): value is ArtistHQTab {
  return value === 'home' || value === 'profile' || value === 'voice' || value === 'calendar' || value === 'network' || value === 'research' || value === 'branding'
}
