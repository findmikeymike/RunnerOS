import * as React from 'react'
import { Bot, CheckCircle2, ExternalLink, FileText, Pencil, ReceiptText, RotateCcw, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { useNavigation } from '@/contexts/NavigationContext'
import { routes } from '../../../shared/routes'
import type { SettingsSubpage } from '../../../shared/settings-registry'
import {
  SCHEDULED_WORK_CONTEXT_SLUG,
  parseScheduledWorkDocResult,
  type ScheduledWorkDocument,
  type ScheduledWorkOrder,
  type ScheduledWorkStatus,
} from '@craft-agent/shared/scheduled-work'
import { cn } from '@/lib/utils'
import { CompactPageHeader } from './CompactPageHeader'
import { AgendaPage, type AgendaTaskDraft } from './AgendaPage'
import type { SessionMeta } from '@/atoms/sessions'
import { MISSION_BRIEF_CONTEXT_SLUG, missionReleaseDateKey, parseMissionBriefDoc } from '@/lib/mission-brief'
import { useWorkspaceContext } from '@/hooks/useWorkspaceContext'
import {
  CAMPAIGN_CALENDAR_CONTEXT_SLUG,
  activeCampaignCalendarItems,
  approveCampaignCalendarItem,
  createCampaignCalendarItem,
  formatCampaignExternalReceiptLabel,
  isLiveExternalActionType,
  parseCampaignCalendarDocResult,
  requeueCampaignScheduledJob,
  mutateCampaignCalendarDoc,
  reviseCampaignCalendarDraftItem,
  takePendingCampaignCalendarPrefill,
  updateCampaignCalendarItem,
  type CampaignCalendar,
  type CampaignCalendarItem,
  type CampaignCalendarItemKind,
  type CampaignCalendarItemStatus,
  type CampaignFinalRef,
  type CampaignOutputRef,
  type CampaignScheduledJobActionType,
} from '@/lib/campaign-calendar'
import {
  CalendarMonthGrid,
  parseDateKey,
  toDateKey,
  type CalendarMonthDayMeta,
  type CalendarDayAction,
} from './CalendarMonthGrid'
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import {
  ScheduledWorkComposer,
  type ScheduledWorkComposerEntry,
} from '@/components/calendar/ScheduledWorkComposer'
import {
  buildCampaignSchedulePlanFromComposer,
  type ScheduledWorkComposerDraft,
} from '@/lib/scheduled-work-composer'

type CampaignCalendarDraft = {
  title: string
  date: string
  time: string
  kind: CampaignCalendarItemKind
  status: CampaignCalendarItemStatus
  notes: string
  actionType: CampaignScheduledJobActionType
  actionInput: string
  socialPlatform: string
  socialProfileId: string
  accountSetId: string
  finalRefs: CampaignFinalRef[]
  outputRefs: CampaignOutputRef[]
}

type CalendarSocialProfile = { platform: string; profile: string; accountGroup: string | null; ready: boolean }

const todayKey = toDateKey(new Date())
const CAMPAIGN_DAY_ACTIONS: CalendarDayAction[] = [
  { id: 'event', label: 'Add event', icon: FileText },
  { id: 'job', label: 'Add job', icon: Bot },
]

const emptyCampaignCalendarDraft = (date = todayKey): CampaignCalendarDraft => ({
  title: '',
  date,
  time: '',
  kind: 'manual',
  status: 'scheduled',
  notes: '',
  actionType: 'ask-agent',
  actionInput: '',
  socialPlatform: '',
  socialProfileId: '',
  accountSetId: '',
  finalRefs: [],
  outputRefs: [],
})

export function CampaignCalendarPage({
  workspaceId,
  agendaSessions,
  onCreateAgendaTask,
  onDeleteAgendaTask,
  networkWorkspaceId,
}: {
  workspaceId: string
  agendaSessions: SessionMeta[]
  onCreateAgendaTask: (task: AgendaTaskDraft) => Promise<string>
  onDeleteAgendaTask: (sessionId: string, skipConfirmation?: boolean) => Promise<boolean>
  networkWorkspaceId: string
}) {
  const { navigate } = useNavigation()
  const { docs, upsert, refresh } = useWorkspaceContext(workspaceId)
  const savedCampaignCalendarResult = React.useMemo(
    () => parseCampaignCalendarDocResult(docs.find((item) => item.slug === CAMPAIGN_CALENDAR_CONTEXT_SLUG), workspaceId || 'workspace'),
    [docs, workspaceId],
  )
  const [optimisticCampaignCalendar, setOptimisticCampaignCalendar] = React.useState<CampaignCalendar | null>(null)
  const savedScheduledWorkResult = React.useMemo(
    () => parseScheduledWorkDocResult(docs.find((item) => item.slug === SCHEDULED_WORK_CONTEXT_SLUG), workspaceId || 'workspace'),
    [docs, workspaceId],
  )
  const [optimisticScheduledWork, setOptimisticScheduledWork] = React.useState<ScheduledWorkDocument | null>(null)
  const scheduledWork = optimisticScheduledWork ?? savedScheduledWorkResult.work
  const campaignCalendar = optimisticCampaignCalendar ?? savedCampaignCalendarResult.calendar
  const missionBrief = React.useMemo(
    () => parseMissionBriefDoc(docs.find((item) => item.slug === MISSION_BRIEF_CONTEXT_SLUG)),
    [docs],
  )
  const releaseDate = missionBrief ? missionReleaseDateKey(missionBrief) : undefined
  const storageError = !savedCampaignCalendarResult.ok
    ? savedCampaignCalendarResult.error
    : !savedScheduledWorkResult.ok
      ? savedScheduledWorkResult.error
      : undefined
  const activeCalendarItems = React.useMemo(
    () => activeCampaignCalendarItems(campaignCalendar.items),
    [campaignCalendar.items],
  )
  const [selectedCalendarDate, setSelectedCalendarDate] = React.useState(todayKey)
  const [visibleCalendarMonth, setVisibleCalendarMonth] = React.useState(() => parseDateKey(todayKey))
  const [calendarEditId, setCalendarEditId] = React.useState<string | null>(null)
  const [calendarEditDraft, setCalendarEditDraft] = React.useState<CampaignCalendarDraft>(() => emptyCampaignCalendarDraft(todayKey))
  const [composerOpen, setComposerOpen] = React.useState(false)
  const [composerPrefill, setComposerPrefill] = React.useState<Pick<ScheduledWorkComposerEntry, 'mode' | 'title' | 'inputRefs' | 'suggestedType'> | null>(null)
  const [socialProfiles, setSocialProfiles] = React.useState<CalendarSocialProfile[]>([])
  const selectedDateCalendarItems = React.useMemo(
    () => activeCalendarItems.filter((item) => item.date === selectedCalendarDate),
    [activeCalendarItems, selectedCalendarDate],
  )
  const nextCalendarDate = React.useMemo(() => {
    const nextItemDate = [...activeCalendarItems]
      .map((item) => item.date)
      .filter((date) => date >= todayKey)
      .sort()[0]
    const nextDate = [nextItemDate, releaseDate && releaseDate >= todayKey ? releaseDate : undefined]
      .filter((date): date is string => Boolean(date))
      .sort()[0]
    return nextDate
      ? parseDateKey(nextDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : 'No upcoming items'
  }, [activeCalendarItems, releaseDate])

  React.useEffect(() => {
    if (docs.some((item) => item.slug === CAMPAIGN_CALENDAR_CONTEXT_SLUG)) setOptimisticCampaignCalendar(null)
    if (docs.some((item) => item.slug === SCHEDULED_WORK_CONTEXT_SLUG)) setOptimisticScheduledWork(null)
  }, [docs])

  React.useEffect(() => {
    const prefill = takePendingCampaignCalendarPrefill()
    if (!prefill) return
    setComposerPrefill({
      title: prefill.title,
      suggestedType: prefill.actionType === 'post-asset' ? 'social-publish' : 'agent-task',
      inputRefs: [
        ...(prefill.finalRefs ?? []).map((ref) => ({ kind: 'final' as const, ...ref })),
        ...(prefill.outputRefs ?? []).map((ref) => ({ kind: 'output' as const, outputId: ref.outputId, title: ref.title, outputKind: ref.kind })),
      ],
    })
    setComposerOpen(true)
  }, [])

  const composerEntry = React.useMemo<ScheduledWorkComposerEntry>(() => ({
    owner: { scope: 'campaign', workspaceId: workspaceId || 'workspace', campaignId: workspaceId || 'workspace' },
    date: selectedCalendarDate,
    mode: composerPrefill?.mode,
    title: composerPrefill?.title,
    inputRefs: composerPrefill?.inputRefs,
    suggestedType: composerPrefill?.suggestedType,
  }), [composerPrefill, selectedCalendarDate, workspaceId])

  React.useEffect(() => {
    let active = true
    window.electronAPI.listSocialAccounts().then((doctor) => {
      if (!active) return
      setSocialProfiles(doctor.platforms.flatMap((group) => group.profiles.map((profile) => ({
        platform: profile.platform,
        profile: profile.profile,
        accountGroup: profile.accountGroup,
        ready: profile.ready,
      }))))
    }).catch(() => {
      if (active) setSocialProfiles([])
    })
    return () => { active = false }
  }, [])

  const saveCampaignCalendar = React.useCallback(
    async (mutate: (calendar: CampaignCalendar) => CampaignCalendar): Promise<boolean> => {
      try {
        setOptimisticCampaignCalendar(mutate(campaignCalendar))
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err))
        return false
      }
      try {
        await mutateCampaignCalendarDoc({
          campaignId: workspaceId || 'workspace',
          load: () => window.electronAPI.getWorkspaceContextDoc(workspaceId, CAMPAIGN_CALENDAR_CONTEXT_SLUG),
          upsert,
          mutate,
        })
        return true
      } catch (err) {
        setOptimisticCampaignCalendar(null)
        await refresh()
        toast.error(err instanceof Error ? err.message : String(err))
        return false
      }
    },
    [campaignCalendar, refresh, upsert, workspaceId],
  )

  const submitScheduledWork = React.useCallback(async (draft: ScheduledWorkComposerDraft) => {
    if (draft.type === 'event') {
      const item = createCampaignCalendarItem({
        campaignId: workspaceId || 'workspace',
        date: draft.date,
        time: draft.time,
        timezone: draft.timezone,
        title: draft.title,
        notes: draft.notes,
        kind: 'manual',
      })
      const saved = await saveCampaignCalendar((latest) => ({
        ...latest,
        items: [...latest.items, item],
        updatedAt: new Date().toISOString(),
      }))
      if (!saved) throw new Error('Calendar event could not be saved.')
      setSelectedCalendarDate(item.date)
      toast.success('Event added')
      return
    }
    const input = buildCampaignSchedulePlanFromComposer(draft)
    const result = draft.type === 'social-publish' && !('orders' in input)
      ? await window.electronAPI.authorizeReleaseKitSocial(workspaceId, {
          requestId: draft.requestId,
          releaseKitItemId: input.order.inputRefs[0]?.kind === 'release-kit' ? input.order.inputRefs[0].itemId : '',
          title: input.order.title,
          platform: draft.platform,
          profileId: draft.profileId,
          accountSetId: draft.accountSetId || undefined,
          caption: draft.caption,
          platformOptions: draft.platformOptions,
          startAt: input.order.startAt,
          timezone: draft.timezone,
          source: 'calendar-ui',
        })
      : 'orders' in input
        ? await window.electronAPI.scheduleCampaignWorkChain(workspaceId, input)
        : await window.electronAPI.scheduleCampaignWork(workspaceId, input)
    setOptimisticCampaignCalendar(result.calendar)
    setOptimisticScheduledWork(result.work)
    const queuedOrder = 'orders' in result ? result.orders[0] : result.order
    const queuedCalendarItem = 'calendarItems' in result ? result.calendarItems[0] : result.calendarItem
    setSelectedCalendarDate(queuedCalendarItem.date)
    setComposerPrefill(null)
    toast.success(`${queuedOrder.title} queued`)
  }, [saveCampaignCalendar, workspaceId])

  const openCampaignCalendarItemEdit = React.useCallback((item: CampaignCalendarItem) => {
    setCalendarEditId(item.id)
    setCalendarEditDraft({
      title: item.title,
      date: item.date,
      time: item.time ?? '',
      kind: item.kind,
      status: item.status,
      notes: item.notes ?? '',
      actionType: item.job?.actionType ?? 'ask-agent',
      actionInput: typeof item.job?.payload.prompt === 'string'
        ? item.job.payload.prompt
        : typeof item.job?.payload.caption === 'string'
          ? item.job.payload.caption
          : typeof item.job?.payload.workflowSlug === 'string'
            ? item.job.payload.workflowSlug
            : '',
      socialPlatform: item.socialProfileRefs?.[0]?.platform ?? '',
      socialProfileId: item.socialProfileRefs?.[0]?.profileId ?? '',
      accountSetId: item.accountSetId ?? '',
      finalRefs: item.finalRefs,
      outputRefs: item.outputRefs,
    })
  }, [])

  const cancelCampaignCalendarItemEdit = React.useCallback(() => {
    setCalendarEditId(null)
    setCalendarEditDraft(emptyCampaignCalendarDraft(selectedCalendarDate))
  }, [selectedCalendarDate])

  const saveCampaignCalendarItemEdit = React.useCallback(async (itemId: string) => {
    if (!calendarEditDraft.title.trim()) {
      toast.error('Add a title first.')
      return
    }
    const existing = campaignCalendar.items.find((item) => item.id === itemId)
    if (existing?.job && !calendarEditDraft.time.trim()) {
      toast.error('Scheduled jobs require a time.')
      return
    }
    const saved = await saveCampaignCalendar((latest) => ({
      ...latest,
      items: latest.items.map((item) => {
        if (item.id !== itemId) return item
        if (item.job) {
          const revised = reviseCampaignCalendarDraftItem(item, {
            campaignId: latest.campaignId,
            title: calendarEditDraft.title,
            date: calendarEditDraft.date,
            time: calendarEditDraft.time,
            kind: 'scheduled-job',
            status: calendarEditDraft.status,
            notes: calendarEditDraft.notes,
            actionType: calendarEditDraft.actionType,
            actionInput: calendarEditDraft.actionInput,
            accountSetId: calendarEditDraft.accountSetId || undefined,
            socialProfileRefs: calendarEditDraft.socialPlatform && calendarEditDraft.socialProfileId
              ? [{ platform: calendarEditDraft.socialPlatform, profileId: calendarEditDraft.socialProfileId }]
              : undefined,
            finalRefs: calendarEditDraft.finalRefs,
            outputRefs: calendarEditDraft.outputRefs,
          })
          if (!revised.ok) throw new Error(revised.error)
          return revised.item
        }
        return updateCampaignCalendarItem(item, {
          title: calendarEditDraft.title,
          date: calendarEditDraft.date,
          time: calendarEditDraft.time,
          kind: calendarEditDraft.kind,
          status: calendarEditDraft.status,
          notes: calendarEditDraft.notes,
        })
      }),
      updatedAt: new Date().toISOString(),
    }))
    if (!saved) return
    setSelectedCalendarDate(calendarEditDraft.date)
    cancelCampaignCalendarItemEdit()
  }, [calendarEditDraft, campaignCalendar.items, cancelCampaignCalendarItemEdit, saveCampaignCalendar])

  const deleteCampaignCalendarItem = React.useCallback((itemId: string) => {
    const linked = campaignCalendar.items.find((item) => item.id === itemId)
    if (linked?.scheduledWorkId) {
      void window.electronAPI.cancelCampaignWork(workspaceId, {
        orderId: linked.scheduledWorkId,
        calendarItemId: linked.id,
      }).then((result) => {
        setOptimisticCampaignCalendar(result.calendar)
        setOptimisticScheduledWork(result.work)
        toast.success(`${result.order.title} canceled`)
      }).catch(async (error) => {
        setOptimisticCampaignCalendar(null)
        await refresh()
        toast.error(error instanceof Error ? error.message : String(error))
      })
      return
    }
    const now = new Date().toISOString()
    void saveCampaignCalendar((latest) => ({
      ...latest,
      items: latest.items.map((item) => item.id === itemId ? { ...item, deletedAt: now, updatedAt: now } : item),
      updatedAt: now,
    }))
  }, [campaignCalendar.items, refresh, saveCampaignCalendar, workspaceId])

  const patchCampaignCalendarItem = React.useCallback(async (itemId: string, patcher: (item: CampaignCalendarItem) => CampaignCalendarItem) => {
    const now = new Date().toISOString()
    let patchedTitle: string | undefined
    const saved = await saveCampaignCalendar((latest) => ({
      ...latest,
      items: latest.items.map((item) => {
        if (item.id !== itemId) return item
        const next = patcher(item)
        patchedTitle = next.title
        return next
      }),
      updatedAt: now,
    }))
    if (saved && patchedTitle) toast.success(`Updated ${patchedTitle}.`)
  }, [saveCampaignCalendar])

  const approveCampaignCalendarJob = React.useCallback((itemId: string) => {
    void patchCampaignCalendarItem(itemId, (item) => approveCampaignCalendarItem(item, {
      campaignId: campaignCalendar.campaignId || workspaceId || 'workspace',
      now: new Date().toISOString(),
    }))
  }, [campaignCalendar.campaignId, patchCampaignCalendarItem, workspaceId])

  const requeueCampaignCalendarJob = React.useCallback((itemId: string) => {
    void patchCampaignCalendarItem(itemId, requeueCampaignScheduledJob)
  }, [patchCampaignCalendarItem])

  const decideScheduledWork = React.useCallback(async (
    order: ScheduledWorkOrder,
    decision: 'approved' | 'changes-requested',
    notes?: string,
  ) => {
    try {
      const result = await window.electronAPI.decideCampaignWork(workspaceId, {
        orderId: order.id,
        calendarItemId: order.calendarLink.itemId,
        expectedUpdatedAt: order.updatedAt,
        decision,
        notes,
      })
      setOptimisticCampaignCalendar(result.calendar)
      setOptimisticScheduledWork(result.work)
      toast.success(decision === 'approved' ? `${order.title} approved` : `Changes requested for ${order.title}`)
    } catch (error) {
      setOptimisticCampaignCalendar(null)
      setOptimisticScheduledWork(null)
      await refresh()
      throw error
    }
  }, [refresh, workspaceId])

  const resolveProducedOutput = React.useCallback(async (order: ScheduledWorkOrder, outputId: string) => {
    try {
      const result = await window.electronAPI.resolveCampaignProducedOutput(workspaceId, {
        orderId: order.id,
        calendarItemId: order.calendarLink.itemId,
        expectedUpdatedAt: order.updatedAt,
        outputId,
      })
      setOptimisticCampaignCalendar(result.calendar)
      setOptimisticScheduledWork(result.work)
      toast.success(`Selected Output for ${order.title}`)
    } catch (error) {
      setOptimisticCampaignCalendar(null)
      setOptimisticScheduledWork(null)
      await refresh()
      throw error
    }
  }, [refresh, workspaceId])

  const approveScheduledSocial = React.useCallback(async (order: ScheduledWorkOrder) => {
    try {
      const result = await window.electronAPI.approveCampaignSocialWork(workspaceId, {
        orderId: order.id,
        calendarItemId: order.calendarLink.itemId,
        expectedUpdatedAt: order.updatedAt,
      })
      setOptimisticCampaignCalendar(result.calendar)
      setOptimisticScheduledWork(result.work)
      toast.success(`${order.title} approved for publishing`)
    } catch (error) {
      setOptimisticCampaignCalendar(null)
      setOptimisticScheduledWork(null)
      await refresh()
      throw error
    }
  }, [refresh, workspaceId])

  const reauthorizeScheduledSocial = React.useCallback(async (order: ScheduledWorkOrder, edit: { title: string; caption: string; startAt: string; timezone: string }) => {
    const definition = order.authorization?.definition
    if (!definition) throw new Error('This post does not have a durable authorization to replace.')
    try {
      const result = await window.electronAPI.reauthorizeReleaseKitSocial(workspaceId, {
        orderId: order.id,
        calendarItemId: order.calendarLink.itemId,
        expectedUpdatedAt: order.updatedAt,
        releaseKitItemId: definition.releaseKitRef.itemId,
        title: edit.title,
        platform: definition.platform,
        profileId: definition.profileId,
        accountSetId: definition.accountSetId,
        caption: edit.caption,
        platformOptions: definition.platformOptions,
        startAt: edit.startAt,
        timezone: edit.timezone,
      })
      setOptimisticCampaignCalendar(result.calendar)
      setOptimisticScheduledWork(result.work)
      toast.success('Post changes confirmed')
    } catch (error) {
      setOptimisticCampaignCalendar(null)
      setOptimisticScheduledWork(null)
      await refresh()
      throw error
    }
  }, [refresh, workspaceId])

  const manageGoalRun = React.useCallback(async (order: ScheduledWorkOrder, operation: 'rearm' | 'pause' | 'cancel') => {
    if (!order.continuation || order.continuation.role !== 'coordinator') return
    let objective: string | undefined
    let maxRounds: number | undefined
    if (operation === 'rearm') {
      const confirmedObjective = window.prompt('Confirm the Goal objective before resuming:', order.continuation.objective)
      if (!confirmedObjective?.trim()) return
      objective = confirmedObjective.trim()
      if (order.attention?.reason === 'continuation-round-limit') {
        const entered = window.prompt('New maximum rounds (up to 8):', String(Math.min(order.continuation.maxRounds + 1, 8)))
        if (!entered) return
        maxRounds = Number(entered)
      }
    } else if (!window.confirm(`${operation === 'pause' ? 'Pause' : 'Cancel'} this Goal run?`)) return
    try {
      const result = await window.electronAPI.manageGoalRun(workspaceId, {
        runId: order.continuation.runId,
        operation,
        expectedUpdatedAt: order.updatedAt,
        explanation: operation === 'rearm' ? 'User reviewed and resumed the Goal run.' : `User ${operation}d the Goal run.`,
        requiresUserConfirmation: false,
        objective,
        maxRounds,
      })
      setOptimisticScheduledWork(result.work)
      toast.success(operation === 'rearm' ? 'Goal run resumed' : operation === 'pause' ? 'Goal run paused' : 'Goal run canceled')
    } catch (error) {
      setOptimisticScheduledWork(null)
      await refresh()
      throw error
    }
  }, [refresh, workspaceId])

  return (
    <div className="h-full overflow-y-auto bg-[#050505] text-foreground lg:overflow-hidden">
      <div className="mx-auto flex min-h-full w-full max-w-[1600px] flex-col gap-3 px-5 py-4 lg:h-full lg:min-h-0 xl:px-8 xl:py-5">
        <CompactPageHeader
          eyebrow="Schedule"
          title="Plan"
          tone="orange"
          actions={
              <div className="text-right">
                <p className="text-[9px] font-medium uppercase tracking-[0.18em] text-white/35">Next</p>
                <p className="mt-1 text-[11px] font-medium text-white/70">{nextCalendarDate}</p>
              </div>
          }
        />

        <div className="grid min-h-[430px] flex-1 grid-cols-1 gap-3 lg:min-h-0 lg:grid-cols-[minmax(0,2.15fr)_minmax(300px,0.85fr)]">
          <CampaignCalendarSurface
            items={activeCalendarItems}
            releaseDate={releaseDate}
            selectedDate={selectedCalendarDate}
            visibleMonth={visibleCalendarMonth}
            selectedDateItems={selectedDateCalendarItems}
            editingItemId={calendarEditId}
            editDraft={calendarEditDraft}
            disabled={Boolean(storageError)}
            parseError={storageError}
            onSelectDate={(date) => {
              setSelectedCalendarDate(date)
            }}
            onChangeMonth={setVisibleCalendarMonth}
            onChangeEditDraft={setCalendarEditDraft}
            onEditItem={openCampaignCalendarItemEdit}
            onCancelEditItem={cancelCampaignCalendarItemEdit}
            onSaveEditItem={saveCampaignCalendarItemEdit}
            onApproveItem={approveCampaignCalendarJob}
            onRequeueItem={requeueCampaignCalendarJob}
            onDeleteItem={deleteCampaignCalendarItem}
            socialProfiles={socialProfiles}
            workById={new Map(scheduledWork.items.map((order) => [order.id, order]))}
            onOpenSession={(sessionId) => window.electronAPI.openSessionInNewWindow(workspaceId, sessionId)}
            onOpenRun={(runId) => navigate(routes.view.workflowRun(runId))}
            onOpenOutput={(outputId) => navigate(routes.view.output(outputId))}
            onReviewDecision={decideScheduledWork}
            onResolveProducedOutput={resolveProducedOutput}
            onApproveSocial={approveScheduledSocial}
            onReauthorizeSocial={reauthorizeScheduledSocial}
            onManageGoalRun={manageGoalRun}
            onQueueReplacement={(work) => {
              setComposerPrefill({
                title: work.title,
                suggestedType: work.type,
                inputRefs: work.inputRefs.filter((ref) => ref.kind !== 'produced-output'),
              })
              setComposerOpen(true)
            }}
            onOpenSocialSettings={(subpage) => navigate(routes.view.settings(subpage))}
            onOpenComposer={(type) => {
              setComposerPrefill(type ? { mode: 'event', suggestedType: type } : { mode: 'job' })
              setComposerOpen(true)
            }}
          />
          <div id="campaign-calendar-kanban" className="min-h-[280px] overflow-hidden rounded-2xl border border-white/[0.08] bg-[#17191B] lg:h-full lg:min-h-0">
            <AgendaPage
              embedded
              sessions={agendaSessions}
              onCreateTask={onCreateAgendaTask}
              onDeleteTask={onDeleteAgendaTask}
              workspaceId={workspaceId}
              networkWorkspaceId={networkWorkspaceId}
            />
          </div>
        </div>
        <ScheduledWorkComposer
          open={composerOpen}
          entry={composerEntry}
          disabled={Boolean(storageError)}
          onOpenChange={setComposerOpen}
          onSubmit={submitScheduledWork}
        />
      </div>
    </div>
  )
}

function CampaignCalendarSurface({
  items,
  releaseDate,
  selectedDate,
  visibleMonth,
  selectedDateItems,
  editingItemId,
  editDraft,
  disabled,
  parseError,
  onSelectDate,
  onChangeMonth,
  onChangeEditDraft,
  onEditItem,
  onCancelEditItem,
  onSaveEditItem,
  onApproveItem,
  onRequeueItem,
  onDeleteItem,
  socialProfiles,
  workById,
  onOpenSession,
  onOpenRun,
  onOpenOutput,
  onReviewDecision,
  onResolveProducedOutput,
  onApproveSocial,
  onReauthorizeSocial,
  onManageGoalRun,
  onQueueReplacement,
  onOpenSocialSettings,
  onOpenComposer,
}: {
  items: CampaignCalendarItem[]
  releaseDate?: string
  selectedDate: string
  visibleMonth: Date
  selectedDateItems: CampaignCalendarItem[]
  editingItemId: string | null
  editDraft: CampaignCalendarDraft
  disabled?: boolean
  parseError?: string
  onSelectDate: (date: string) => void
  onChangeMonth: (month: Date) => void
  onChangeEditDraft: (draft: CampaignCalendarDraft) => void
  onEditItem: (item: CampaignCalendarItem) => void
  onCancelEditItem: () => void
  onSaveEditItem: (itemId: string) => void
  onApproveItem: (itemId: string) => void
  onRequeueItem: (itemId: string) => void
  onDeleteItem: (itemId: string) => void
  socialProfiles: CalendarSocialProfile[]
  workById: Map<string, ScheduledWorkOrder>
  onOpenSession: (sessionId: string) => void
  onOpenRun: (runId: string) => void
  onOpenOutput: (outputId: string) => void
  onReviewDecision: (order: ScheduledWorkOrder, decision: 'approved' | 'changes-requested', notes?: string) => Promise<void>
  onResolveProducedOutput: (order: ScheduledWorkOrder, outputId: string) => Promise<void>
  onApproveSocial: (order: ScheduledWorkOrder) => Promise<void>
  onReauthorizeSocial: (order: ScheduledWorkOrder, edit: { title: string; caption: string; startAt: string; timezone: string }) => Promise<void>
  onManageGoalRun: (order: ScheduledWorkOrder, operation: 'rearm' | 'pause' | 'cancel') => Promise<void>
  onQueueReplacement: (order: ScheduledWorkOrder) => void
  onOpenSocialSettings: (subpage: ConnectionSettingsSubpage) => void
  onOpenComposer: (type?: ScheduledWorkComposerEntry['suggestedType']) => void
}) {
  const [detailItemId, setDetailItemId] = React.useState<string | null>(null)
  const dayMetaByDate = React.useMemo(() => {
    const metaByDate = new Map<string, CalendarMonthDayMeta>()
    for (const item of items) {
      const linkedWork = item.scheduledWorkId ? workById.get(item.scheduledWorkId) : undefined
      const work = linkedWork?.legacyRef ? undefined : linkedWork
      const status = campaignStatusForWork(work?.status) ?? item.status
      const current = metaByDate.get(item.date) ?? { count: 0, dots: [], items: [] }
      metaByDate.set(item.date, {
        count: (current.count ?? 0) + 1,
        dots: [...new Set([...(current.dots ?? []), statusDotClass(status)])],
        items: [...(current.items ?? []), { id: item.id, label: item.title, detail: `${item.time || 'All day'} - ${status.replace(/-/g, ' ')}`, markerClass: statusDotClass(status) }],
      })
    }
    if (releaseDate) {
      const current = metaByDate.get(releaseDate) ?? { count: 0, dots: [], items: [] }
      metaByDate.set(releaseDate, {
        ...current,
        highlights: [{ id: 'campaign-release-day', label: 'Release day' }],
      })
    }
    return metaByDate
  }, [items, releaseDate, workById])
  const selectedLabel = parseDateKey(selectedDate).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })

  return (
    <section className="flex min-h-[430px] flex-1 flex-col rounded-2xl border border-white/[0.08] bg-[#0C0D0E] p-5 shadow-minimal lg:min-h-0">
      {parseError ? (
        <div className="mb-3 rounded-xl border border-red-300/15 bg-red-500/10 p-3 text-xs text-red-100/70">
          {parseError}
        </div>
      ) : null}

      <>
        <CalendarMonthGrid
          visibleMonth={visibleMonth}
          selectedDate={selectedDate}
          dayMetaByDate={dayMetaByDate}
          dayActions={CAMPAIGN_DAY_ACTIONS}
          onSelectDate={onSelectDate}
          onChangeMonth={onChangeMonth}
          onDayAction={(date, actionId) => {
            onSelectDate(date)
            onOpenComposer(actionId === 'event' ? 'event' : undefined)
          }}
          onSelectItem={(date, itemId) => {
            onSelectDate(date)
            setDetailItemId(itemId)
          }}
        />

        <Drawer direction="right" open={detailItemId !== null} onOpenChange={(open) => { if (!open) setDetailItemId(null) }}>
          <DrawerContent className="w-[min(440px,92vw)] border-white/[0.07] bg-[#090909] sm:max-w-[440px]">
            <DrawerHeader className="border-b border-white/[0.06]">
              <DrawerTitle className="text-base text-white/82">{selectedLabel}</DrawerTitle>
              <DrawerDescription>Scheduled item details and controls</DrawerDescription>
            </DrawerHeader>

          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
            {selectedDateItems.length === 0 ? (
              <div className="rounded-[12px] border border-white/[0.045] bg-white/[0.016] p-3 text-xs text-white/36">
                Nothing scheduled.
              </div>
            ) : selectedDateItems.filter((item) => !detailItemId || item.id === detailItemId).map((item) => {
              const linkedWork = item.scheduledWorkId ? workById.get(item.scheduledWorkId) : undefined
              const work = linkedWork?.legacyRef ? undefined : linkedWork
              const predecessor = work?.chain?.predecessor ? workById.get(work.chain.predecessor.orderId) : undefined
              const producedOutputIds = predecessor?.result && 'outputIds' in predecessor.result ? predecessor.result.outputIds : []
              const displayStatus = work?.status ?? item.status
              return <div key={item.id} className="rounded-[12px] border border-white/[0.055] bg-white/[0.025] p-3">
                {editingItemId === item.id ? (
                  <CampaignCalendarForm
                    draft={editDraft}
                    disabled={disabled}
                    submitLabel="Save"
                    onChange={onChangeEditDraft}
                    onCancel={onCancelEditItem}
                    onSubmit={() => onSaveEditItem(item.id)}
                    socialProfiles={socialProfiles}
                    showJobConfig={Boolean(item.job)}
                  />
                ) : (
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-sm font-semibold text-white/76">{item.title}</div>
                        <span className={cn('rounded-full px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.12em]', statusBadgeClass(campaignStatusForWork(work?.status) ?? item.status))}>
                          {displayStatus.replace(/-/g, ' ')}
                        </span>
                      </div>
                      <div className="mt-1 text-[10px] font-medium uppercase tracking-[0.12em] text-orange-200/65">
                        {item.time || 'All day'} · {item.kind.replace(/-/g, ' ')}
                      </div>
                      {item.notes ? <div className="mt-2 text-xs leading-5 text-white/38">{item.notes}</div> : null}
                      <CampaignCalendarJobDetails item={item} />
                      {work ? <ScheduledWorkDetails work={work} calendarStatus={item.status} producedOutputIds={producedOutputIds} onOpenSession={onOpenSession} onOpenRun={onOpenRun} onOpenOutput={onOpenOutput} onReviewDecision={onReviewDecision} onResolveProducedOutput={onResolveProducedOutput} onApproveSocial={onApproveSocial} onReauthorizeSocial={onReauthorizeSocial} onManageGoalRun={onManageGoalRun} onQueueReplacement={onQueueReplacement} onOpenSocialSettings={onOpenSocialSettings} /> : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {item.status === 'needs-approval' && !item.scheduledWorkId ? (
                        <button
                          type="button"
                          onClick={() => onApproveItem(item.id)}
                          disabled={disabled}
                          className="rounded-full p-1.5 text-white/28 hover:bg-white/[0.05] hover:text-emerald-200 disabled:cursor-not-allowed disabled:opacity-40"
                          aria-label="Approve calendar item"
                          title="Approve"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                      {item.job && (item.status === 'failed' || item.status === 'missed') ? (
                        <button
                          type="button"
                          onClick={() => onRequeueItem(item.id)}
                          disabled={disabled}
                          className="rounded-full p-1.5 text-white/28 hover:bg-white/[0.05] hover:text-blue-200 disabled:cursor-not-allowed disabled:opacity-40"
                          aria-label="Requeue scheduled job"
                          title="Requeue"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                      {!item.scheduledWorkId ? (
                        <button
                          type="button"
                          onClick={() => onEditItem(item)}
                          disabled={disabled}
                          className="rounded-full p-1.5 text-white/28 hover:bg-white/[0.05] hover:text-white/70 disabled:cursor-not-allowed disabled:opacity-40"
                          aria-label="Edit calendar item"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => { onDeleteItem(item.id); setDetailItemId(null) }}
                        disabled={disabled}
                        className="rounded-full p-1.5 text-white/28 hover:bg-white/[0.05] hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-40"
                        aria-label="Delete calendar item"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            })}
          </div>
          </DrawerContent>
        </Drawer>
      </>
    </section>
  )
}

function CampaignCalendarJobDetails({ item }: { item: CampaignCalendarItem }) {
  const job = item.job
  const latestRun = item.runHistory.at(-1)
  const receipt = latestRun?.externalReceipt
  const preview = job?.externalActionPreview
  if (!job) return null
  const externalPending = isLiveExternalActionType(job.actionType) && item.status !== 'done'
  return (
    <div className="mt-3 rounded-[10px] border border-white/[0.045] bg-black/24 p-2.5">
      <div className="flex flex-wrap items-center gap-2 text-[10px] font-medium uppercase tracking-[0.12em] text-white/40">
        <span>{job.actionType.replace(/-/g, ' ')}</span>
        <span>Attempts {job.attempts}/{job.maxAttempts}</span>
        {job.lastRunAt ? <span>Last {formatCompactDateTime(job.lastRunAt)}</span> : null}
      </div>
      {externalPending ? (
        <div className="mt-2 rounded-[8px] border border-yellow-300/10 bg-yellow-300/[0.055] px-2 py-1.5 text-[11px] leading-4 text-yellow-100/64">
          Exact approval is required before posting or outreach.
        </div>
      ) : null}
      {preview ? (
        <div className="mt-2 rounded-[8px] border border-blue-300/10 bg-blue-300/[0.045] p-2 text-[11px] leading-4 text-blue-100/68">
          <div className="font-medium">Dry run {preview.actionId}</div>
          <div className="mt-1 text-blue-100/52">
            {preview.platform} · {preview.profileId} · {formatCompactDateTime(preview.preparedAt)}
          </div>
          {preview.summary ? <div className="mt-1 text-blue-100/52">{preview.summary}</div> : null}
        </div>
      ) : null}
      {job.error ? (
        <div className="mt-2 text-[11px] leading-4 text-red-100/65">{job.error}</div>
      ) : null}
      {latestRun ? (
        <div className="mt-2 text-[10px] leading-4 text-white/34">
          Last run: {latestRun.status} · {formatCompactDateTime(latestRun.endedAt ?? latestRun.startedAt)}
          {latestRun.resultSummary ? ` · ${latestRun.resultSummary}` : ''}
        </div>
      ) : null}
      {receipt ? (
        <div className="mt-2 rounded-[8px] border border-emerald-300/10 bg-emerald-300/[0.045] p-2 text-[11px] leading-4 text-emerald-100/68">
          <div className="flex items-center gap-1.5 font-medium">
            <ReceiptText className="h-3.5 w-3.5" />
            <span>{formatCampaignExternalReceiptLabel(receipt)}</span>
          </div>
          {receipt.summary ? <div className="mt-1 text-emerald-100/52">{receipt.summary}</div> : null}
          <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[10px] text-white/34">
            <span>{formatCompactDateTime(receipt.completedAt)}</span>
            {receipt.externalUrl ? (
              <a
                href={receipt.externalUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-emerald-100/58 hover:text-emerald-100/80"
              >
                Open result
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function ScheduledWorkDetails({ work, calendarStatus, producedOutputIds, onOpenSession, onOpenRun, onOpenOutput, onReviewDecision, onResolveProducedOutput, onApproveSocial, onReauthorizeSocial, onManageGoalRun, onQueueReplacement, onOpenSocialSettings }: {
  work: ScheduledWorkOrder
  calendarStatus: CampaignCalendarItemStatus
  producedOutputIds: string[]
  onOpenSession: (sessionId: string) => void
  onOpenRun: (runId: string) => void
  onOpenOutput: (outputId: string) => void
  onReviewDecision: (order: ScheduledWorkOrder, decision: 'approved' | 'changes-requested', notes?: string) => Promise<void>
  onResolveProducedOutput: (order: ScheduledWorkOrder, outputId: string) => Promise<void>
  onApproveSocial: (order: ScheduledWorkOrder) => Promise<void>
  onReauthorizeSocial: (order: ScheduledWorkOrder, edit: { title: string; caption: string; startAt: string; timezone: string }) => Promise<void>
  onManageGoalRun: (order: ScheduledWorkOrder, operation: 'rearm' | 'pause' | 'cancel') => Promise<void>
  onQueueReplacement: (order: ScheduledWorkOrder) => void
  onOpenSocialSettings: (subpage: ConnectionSettingsSubpage) => void
}) {
  const latestRun = work.runs.at(-1)
  const agentResult = work.result?.type === 'agent-task' ? work.result : undefined
  const workflowResult = work.result?.type === 'workflow-run' ? work.result : undefined
  const outputIds = work.result && 'outputIds' in work.result ? work.result.outputIds : []
  const [requestingChanges, setRequestingChanges] = React.useState(false)
  const [notes, setNotes] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [decisionError, setDecisionError] = React.useState<string | null>(null)
  const [socialEditOpen, setSocialEditOpen] = React.useState(false)
  const [socialEditTitle, setSocialEditTitle] = React.useState('')
  const [socialEditCaption, setSocialEditCaption] = React.useState('')
  const [socialEditDate, setSocialEditDate] = React.useState('')
  const [socialEditTime, setSocialEditTime] = React.useState('')
  const expectedCalendarStatus = work.reviewDecision?.decision === 'approved' ? 'done' : work.reviewDecision ? 'failed' : undefined
  const needsCalendarRepair = Boolean(expectedCalendarStatus && calendarStatus !== expectedCalendarStatus)
  const connectionSettingsTarget = connectionSettingsSubpageForWork(work)
  const connectionSettingsLabel = connectionSettingsTarget === 'spotify'
    ? 'Open Spotify Settings'
    : connectionSettingsTarget === 'ad-accounts'
      ? 'Open Ad Accounts'
      : 'Open Social Accounts'
  const durableDefinition = work.authorizationPolicy === 'durable-v1' ? work.authorization?.definition : undefined
  const openSocialEdit = () => {
    if (!durableDefinition) return
    const local = new Date(durableDefinition.startAt)
    setSocialEditTitle(durableDefinition.title)
    setSocialEditCaption(durableDefinition.caption)
    setSocialEditDate(`${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`)
    setSocialEditTime(`${String(local.getHours()).padStart(2, '0')}:${String(local.getMinutes()).padStart(2, '0')}`)
    setDecisionError(null)
    setSocialEditOpen(true)
  }
  const editedStartAt = socialEditDate && socialEditTime ? new Date(`${socialEditDate}T${socialEditTime}:00`).toISOString() : ''
  const socialEditChanges = durableDefinition ? [
    socialEditTitle.trim() !== durableDefinition.title ? { label: 'Title', before: durableDefinition.title, after: socialEditTitle.trim() } : null,
    socialEditCaption.trim() !== durableDefinition.caption ? { label: 'Caption', before: durableDefinition.caption, after: socialEditCaption.trim() } : null,
    editedStartAt && editedStartAt !== durableDefinition.startAt ? { label: 'When', before: formatCompactDateTime(durableDefinition.startAt), after: formatCompactDateTime(editedStartAt) } : null,
  ].filter((change): change is { label: string; before: string; after: string } => Boolean(change)) : []
  const decide = async (decision: 'approved' | 'changes-requested', decisionNotes = notes) => {
    if (decision === 'changes-requested' && !decisionNotes.trim()) {
      setDecisionError('Explain what needs to change.')
      return
    }
    setBusy(true)
    setDecisionError(null)
    try {
      await onReviewDecision(work, decision, decisionNotes.trim() || undefined)
    } catch (error) {
      setDecisionError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="mt-3 border-t border-white/[0.05] pt-2.5">
      <div className="flex flex-wrap items-center gap-2 text-[10px] font-medium uppercase tracking-[0.12em] text-white/38">
        <span>{work.type.replace(/-/g, ' ')}</span>
        {latestRun ? <span>Last run {latestRun.status}</span> : null}
      </div>
      {work.attention ? (
        <div className="mt-2 rounded-[6px] border border-orange-300/25 bg-orange-400/[0.09] px-2.5 py-2 text-[11px] leading-4 text-orange-50/85">
          {work.attention.message}
        </div>
      ) : null}
      {work.continuation?.role === 'coordinator' ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {work.status === 'needs-attention' ? <button type="button" disabled={busy} onClick={() => { setBusy(true); void onManageGoalRun(work, 'rearm').catch((error) => setDecisionError(error instanceof Error ? error.message : String(error))).finally(() => setBusy(false)) }} className="h-7 rounded-[5px] bg-white/85 px-2.5 text-[10px] font-semibold text-black disabled:opacity-40">Review and resume</button> : null}
          {work.status === 'waiting' ? <button type="button" disabled={busy} onClick={() => { setBusy(true); void onManageGoalRun(work, 'pause').catch((error) => setDecisionError(error instanceof Error ? error.message : String(error))).finally(() => setBusy(false)) }} className="h-7 rounded-[5px] border border-white/[0.08] px-2.5 text-[10px] font-medium text-white/58 disabled:opacity-40">Pause</button> : null}
          {(work.status === 'waiting' || work.status === 'needs-attention') ? <button type="button" disabled={busy} onClick={() => { setBusy(true); void onManageGoalRun(work, 'cancel').catch((error) => setDecisionError(error instanceof Error ? error.message : String(error))).finally(() => setBusy(false)) }} className="h-7 rounded-[5px] border border-red-300/10 px-2.5 text-[10px] font-medium text-red-100/60 disabled:opacity-40">Cancel</button> : null}
        </div>
      ) : null}
      {work.status === 'needs-attention' && work.attention?.reason !== 'produced-output-ambiguous' && work.attention?.reason !== 'produced-output-missing' && work.attention?.reason !== 'execution-uncertain' ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button type="button" onClick={() => onQueueReplacement(work)} className="h-7 rounded-[5px] border border-white/[0.08] px-2.5 text-[10px] font-medium text-white/58">Queue replacement</button>
          {work.attention?.reason === 'profile-login-required' ? <button type="button" onClick={() => onOpenSocialSettings(connectionSettingsTarget)} className="h-7 rounded-[5px] border border-yellow-200/15 px-2.5 text-[10px] font-medium text-yellow-100/65">{connectionSettingsLabel}</button> : null}
        </div>
      ) : null}
      {(work.attention?.reason === 'produced-output-missing' || work.attention?.reason === 'produced-output-ambiguous') && producedOutputIds.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {producedOutputIds.map((outputId, index) => (
            <div key={outputId} className="flex items-center gap-1">
              <WorkAction label={`Open Output ${index + 1}`} onClick={() => onOpenOutput(outputId)} />
              <button type="button" disabled={busy} onClick={() => {
                setBusy(true)
                void onResolveProducedOutput(work, outputId).catch((error) => setDecisionError(error instanceof Error ? error.message : String(error))).finally(() => setBusy(false))
              }} className="h-7 rounded-[5px] bg-white/85 px-2 text-[10px] font-semibold text-black disabled:opacity-40">Use</button>
            </div>
          ))}
        </div>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {agentResult ? <WorkAction label="Open session" onClick={() => onOpenSession(agentResult.sessionId)} /> : null}
        {workflowResult ? <WorkAction label="Open run" onClick={() => onOpenRun(workflowResult.workflowRunId)} /> : null}
        {!work.result && latestRun?.sessionId ? <WorkAction label="Open session" onClick={() => onOpenSession(latestRun.sessionId!)} /> : null}
        {!work.result && latestRun?.workflowRunId ? <WorkAction label="Open run" onClick={() => onOpenRun(latestRun.workflowRunId!)} /> : null}
        {outputIds.map((outputId, index) => <WorkAction key={outputId} label={outputIds.length === 1 ? 'Open Output' : `Output ${index + 1}`} onClick={() => onOpenOutput(outputId)} />)}
      </div>
      {work.status === 'awaiting-review' ? (
        <div className="mt-2.5 border-t border-white/[0.05] pt-2.5">
          {requestingChanges ? (
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="What needs to change?"
              className="min-h-16 w-full rounded-[6px] border border-white/[0.08] bg-black/25 px-2.5 py-2 text-xs leading-5 text-white/72 outline-none placeholder:text-white/28 focus:border-white/18"
            />
          ) : null}
          {decisionError ? <div className="mt-1.5 text-[11px] text-red-200/70">{decisionError}</div> : null}
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button type="button" disabled={busy} onClick={() => void decide('approved')} className="h-7 rounded-[5px] bg-emerald-200/90 px-2.5 text-[10px] font-semibold text-black disabled:opacity-40">Approve</button>
            <button type="button" disabled={busy} onClick={() => requestingChanges ? void decide('changes-requested') : setRequestingChanges(true)} className="h-7 rounded-[5px] border border-white/[0.08] px-2.5 text-[10px] font-medium text-white/58 disabled:opacity-40">Request changes</button>
            {requestingChanges ? <button type="button" disabled={busy} onClick={() => { setRequestingChanges(false); setNotes(''); setDecisionError(null) }} className="h-7 px-2 text-[10px] text-white/38">Cancel</button> : null}
          </div>
        </div>
      ) : null}
      {work.reviewDecision ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-white/38">
          <span>Review {work.reviewDecision.decision.replace(/-/g, ' ')} · {formatCompactDateTime(work.reviewDecision.decidedAt)}</span>
          {needsCalendarRepair ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void decide(work.reviewDecision!.decision, work.reviewDecision!.notes ?? '')}
              className="h-7 rounded-[5px] border border-yellow-200/15 px-2 text-[10px] font-medium text-yellow-100/65 disabled:opacity-40"
            >
              Repair calendar status
            </button>
          ) : null}
        </div>
      ) : null}
      {durableDefinition && work.status !== 'done' && work.status !== 'running' && work.status !== 'canceled' ? (
        <div className="mt-2.5 border-t border-white/[0.05] pt-2.5">
          {!socialEditOpen ? (
            <button type="button" onClick={openSocialEdit} className="h-7 rounded-[5px] border border-white/[0.09] px-2.5 text-[10px] font-medium text-white/62 hover:bg-white/[0.04]">Edit scheduled post</button>
          ) : (
            <div className="space-y-3">
              <input value={socialEditTitle} onChange={(event) => setSocialEditTitle(event.target.value)} maxLength={200} aria-label="Post title" className="h-9 w-full rounded-[6px] border border-white/[0.09] bg-black/25 px-2.5 text-xs text-white/78 outline-none" />
              <textarea value={socialEditCaption} onChange={(event) => setSocialEditCaption(event.target.value)} maxLength={5000} rows={4} aria-label="Post caption" className="w-full resize-none rounded-[6px] border border-white/[0.09] bg-black/25 px-2.5 py-2 text-xs text-white/78 outline-none" />
              <div className="grid grid-cols-2 gap-2">
                <input type="date" value={socialEditDate} min={new Date().toISOString().slice(0, 10)} onChange={(event) => setSocialEditDate(event.target.value)} aria-label="Post date" className="h-9 rounded-[6px] border border-white/[0.09] bg-black/25 px-2 text-xs text-white/72" />
                <input type="time" value={socialEditTime} onChange={(event) => setSocialEditTime(event.target.value)} aria-label="Post time" className="h-9 rounded-[6px] border border-white/[0.09] bg-black/25 px-2 text-xs text-white/72" />
              </div>
              <div className="text-[10px] text-white/34">{Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'}</div>
              {socialEditChanges.length ? <div className="space-y-2 rounded-[6px] border border-orange-300/15 bg-orange-300/[0.045] p-2.5">{socialEditChanges.map((change) => <div key={change.label} className="text-[11px]"><div className="font-medium text-orange-100/75">{change.label}</div><div className="mt-0.5 break-words text-white/35 line-through">{change.before}</div><div className="mt-0.5 break-words text-white/72">{change.after}</div></div>)}</div> : <div className="text-[11px] text-white/34">No changes yet.</div>}
              {decisionError ? <div className="text-[11px] text-red-200/75">{decisionError}</div> : null}
              <div className="flex gap-2">
                <button type="button" disabled={busy || socialEditChanges.length === 0 || !socialEditTitle.trim() || !socialEditCaption.trim() || !editedStartAt} onClick={() => {
                  setBusy(true); setDecisionError(null)
                  void onReauthorizeSocial(work, { title: socialEditTitle.trim(), caption: socialEditCaption.trim(), startAt: editedStartAt, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' })
                    .then(() => setSocialEditOpen(false)).catch((error) => setDecisionError(error instanceof Error ? error.message : String(error))).finally(() => setBusy(false))
                }} className="h-8 rounded-[5px] bg-orange-400 px-3 text-[10px] font-semibold text-black disabled:opacity-35">Confirm changes</button>
                <button type="button" disabled={busy} onClick={() => { setSocialEditOpen(false); setDecisionError(null) }} className="h-8 px-2 text-[10px] text-white/42">Cancel</button>
              </div>
            </div>
          )}
        </div>
      ) : null}
      {work.execution.type === 'social-publish' && work.socialAction ? (
        <div className="mt-2.5 rounded-[6px] border border-yellow-200/10 bg-yellow-200/[0.04] px-2.5 py-2 text-[11px] leading-4 text-yellow-100/65">
          <div>{work.socialAction.summary ?? `Prepared ${work.socialAction.platform}/${work.socialAction.profileId}`}</div>
          <div className="mt-1 font-mono text-[9px] text-white/30">{work.socialAction.actionId} · {work.socialAction.actionDigest.slice(0, 20)}...</div>
          {work.socialApproval ? (
            <div className="mt-1.5 text-emerald-100/65">Approved until {formatCompactDateTime(work.socialApproval.expiresAt)}</div>
          ) : work.authorizationPolicy === 'durable-v1' && work.authorization ? (
            <div className="mt-1.5 text-emerald-100/65">Authorized when scheduled · publishing will be verified automatically</div>
          ) : work.status === 'needs-approval' ? (
            <button type="button" disabled={busy} onClick={() => {
              setBusy(true)
              void onApproveSocial(work).catch((error) => setDecisionError(error instanceof Error ? error.message : String(error))).finally(() => setBusy(false))
            }} className="mt-2 h-7 rounded-[5px] bg-yellow-100/90 px-2.5 text-[10px] font-semibold text-black disabled:opacity-40">Approve exact post</button>
          ) : null}
        </div>
      ) : null}
      {work.result?.type === 'social-publish' ? (
        <div className="mt-2 rounded-[6px] border border-emerald-200/10 bg-emerald-200/[0.04] px-2.5 py-2 text-[11px] text-emerald-100/68">
          <div>{work.result.receipt.summary ?? `Published to ${work.result.receipt.platform}/${work.result.receipt.profileId}`}</div>
          <div className="mt-1 text-[10px] text-white/34">Receipt {work.result.receipt.id} · {formatCompactDateTime(work.result.receipt.completedAt)}</div>
          {work.result.receipt.externalUrl ? <a href={work.result.receipt.externalUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-emerald-100/70">Open post <ExternalLink className="h-3 w-3" /></a> : null}
        </div>
      ) : null}
    </div>
  )
}

type ConnectionSettingsSubpage = Extract<SettingsSubpage, 'social-accounts' | 'spotify' | 'ad-accounts'>

export function connectionSettingsSubpageForWork(work: ScheduledWorkOrder): ConnectionSettingsSubpage {
  if (work.execution.type === 'social-publish' && work.execution.platform === 'spotify') return 'spotify'
  if (work.socialAction?.platform === 'spotify') return 'spotify'
  if (work.execution.type === 'agent-task' && /^spotify-/.test(work.execution.agentSlug)) return 'spotify'
  if (work.execution.type === 'agent-task' && work.execution.agentSlug === 'ads-agent') return 'ad-accounts'
  return 'social-accounts'
}

function WorkAction({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex h-7 items-center gap-1 rounded-[5px] border border-white/[0.07] px-2 text-[10px] font-medium text-white/52 hover:bg-white/[0.04] hover:text-white/72">
      {label}
      <ExternalLink className="h-3 w-3" />
    </button>
  )
}

function CampaignCalendarForm({
  draft,
  disabled,
  submitLabel,
  onChange,
  onSubmit,
  onCancel,
  socialProfiles,
  showJobConfig = true,
}: {
  draft: CampaignCalendarDraft
  disabled?: boolean
  submitLabel: string
  onChange: (draft: CampaignCalendarDraft) => void
  onSubmit: () => void
  onCancel?: () => void
  socialProfiles: CalendarSocialProfile[]
  showJobConfig?: boolean
}) {
  return (
    <div className="grid grid-cols-1 gap-2">
      <input
        type="date"
        value={draft.date}
        onChange={(event) => onChange({ ...draft, date: event.target.value })}
        className="h-9 rounded-[10px] border border-white/[0.06] bg-black/25 px-3 text-xs text-white/75 outline-none focus:border-white/16"
      />
      <Input value={draft.title} onChange={(title) => onChange({ ...draft, title })} placeholder="Title" />
      <Input value={draft.time} onChange={(time) => onChange({ ...draft, time })} placeholder="Time, optional HH:mm" />
      <div className="grid grid-cols-2 gap-2">
        <select
          value={draft.kind}
          onChange={(event) => onChange({ ...draft, kind: event.target.value as CampaignCalendarItemKind })}
          className="h-9 rounded-[10px] border border-white/[0.06] bg-black/25 px-3 text-xs text-white/75 outline-none focus:border-white/16"
        >
          <option value="manual">Manual reminder</option>
          <option value="deadline">Deadline</option>
          <option value="approval">Review / approval</option>
          {(showJobConfig || draft.kind === 'scheduled-job') ? <option value="scheduled-job">Scheduled job</option> : null}
        </select>
        <select
          value={draft.status}
          onChange={(event) => onChange({ ...draft, status: event.target.value as CampaignCalendarItemStatus })}
          className="h-9 rounded-[10px] border border-white/[0.06] bg-black/25 px-3 text-xs text-white/75 outline-none focus:border-white/16"
        >
          <option value="scheduled">Scheduled</option>
          <option value="needs-approval">Needs approval</option>
          <option value="draft">Draft</option>
          <option value="done">Done</option>
          <option value="missed">Missed</option>
          <option value="canceled">Canceled</option>
        </select>
      </div>
      {draft.kind === 'scheduled-job' && showJobConfig ? (
        <>
          <select
            value={draft.actionType}
            onChange={(event) => onChange({ ...draft, actionType: event.target.value as CampaignScheduledJobActionType })}
            className="h-9 rounded-[10px] border border-white/[0.06] bg-black/25 px-3 text-xs text-white/75 outline-none focus:border-white/16"
          >
            <option value="ask-agent">Ask agent</option>
            <option value="generate-content">Generate content</option>
            <option value="run-workflow">Run workflow</option>
            <option value="review">Review</option>
            <option value="custom-prompt">Custom prompt</option>
            {(draft.finalRefs.length > 0 || draft.outputRefs.length > 0) ? <option value="post-asset">Post asset</option> : null}
          </select>
          {draft.actionType === 'post-asset' ? (
            <select
              value={draft.socialPlatform && draft.socialProfileId ? `${draft.socialPlatform}/${draft.socialProfileId}` : ''}
              onChange={(event) => {
                const selected = socialProfiles.find((profile) => `${profile.platform}/${profile.profile}` === event.target.value)
                onChange({
                  ...draft,
                  socialPlatform: selected?.platform ?? '',
                  socialProfileId: selected?.profile ?? '',
                  accountSetId: selected?.accountGroup ?? '',
                })
              }}
              className="h-9 rounded-[10px] border border-white/[0.06] bg-black/25 px-3 text-xs text-white/75 outline-none focus:border-white/16"
            >
              <option value="">Choose social profile</option>
              {socialProfiles.map((profile) => (
                <option key={`${profile.platform}/${profile.profile}`} value={`${profile.platform}/${profile.profile}`} disabled={!profile.ready}>
                  {profile.platform} · {profile.profile}{profile.ready ? '' : ' · setup required'}
                </option>
              ))}
            </select>
          ) : null}
          {(draft.finalRefs.length > 0 || draft.outputRefs.length > 0) ? (
            <div className="rounded-[8px] border border-blue-300/10 bg-blue-300/[0.04] px-2.5 py-2 text-[11px] text-blue-100/58">
              Attached: {draft.finalRefs.length > 0 ? 'campaign Final' : 'Output'}
            </div>
          ) : null}
          <textarea
            value={draft.actionInput}
            onChange={(event) => onChange({ ...draft, actionInput: event.target.value })}
            placeholder={draft.actionType === 'post-asset' ? 'Final caption' : draft.actionType === 'run-workflow' ? 'Workflow slug' : 'Job instruction'}
            className="min-h-[64px] w-full rounded-[10px] border border-white/[0.06] bg-black/25 px-3 py-2 text-xs leading-5 text-white/75 outline-none placeholder:text-white/28 focus:border-white/16"
          />
        </>
      ) : null}
      <textarea
        value={draft.notes}
        onChange={(event) => onChange({ ...draft, notes: event.target.value })}
        placeholder="Notes, optional"
        className="min-h-[74px] w-full rounded-[10px] border border-white/[0.06] bg-black/25 px-3 py-2 text-xs leading-5 text-white/75 outline-none placeholder:text-white/28 focus:border-white/16"
      />
      <div className="flex justify-end gap-2">
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-white/[0.07] px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/55 hover:bg-white/[0.04]"
          >
            <X className="h-3.5 w-3.5" />
            Cancel
          </button>
        ) : null}
        <button
          type="button"
          onClick={onSubmit}
          disabled={disabled}
          className="h-9 rounded-full bg-white/90 px-4 text-xs font-semibold text-black hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitLabel}
        </button>
      </div>
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

function statusDotClass(status: CampaignCalendarItemStatus): string {
  if (status === 'needs-approval') return 'bg-yellow-300/85'
  if (status === 'done') return 'bg-emerald-300/85'
  if (status === 'failed' || status === 'missed') return 'bg-red-300/85'
  if (status === 'running') return 'bg-blue-300/85'
  if (status === 'canceled') return 'bg-white/25'
  return 'bg-orange-300/85'
}

function statusBadgeClass(status: CampaignCalendarItemStatus): string {
  if (status === 'needs-approval') return 'bg-yellow-300/10 text-yellow-100/75'
  if (status === 'done') return 'bg-emerald-400/10 text-emerald-200/75'
  if (status === 'failed' || status === 'missed') return 'bg-red-400/10 text-red-100/75'
  if (status === 'running') return 'bg-blue-400/10 text-blue-100/75'
  if (status === 'canceled') return 'bg-white/[0.035] text-white/38'
  return 'bg-orange-400/10 text-orange-100/75'
}

function campaignStatusForWork(status: ScheduledWorkStatus | undefined): CampaignCalendarItemStatus | undefined {
  if (!status) return undefined
  if (status === 'waiting') return 'draft'
  if (status === 'needs-setup' || status === 'needs-attention') return 'failed'
  if (status === 'awaiting-review') return 'needs-approval'
  return status
}

function formatCompactDateTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}
