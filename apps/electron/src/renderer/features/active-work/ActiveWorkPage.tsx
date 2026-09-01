import * as React from 'react'
import { useAtomValue } from 'jotai'
import { AlertTriangle, ArrowRight, Bot, CalendarClock, Clock3, Repeat2, Workflow } from 'lucide-react'
import { parseScheduledWorkDocResult, SCHEDULED_WORK_CONTEXT_SLUG } from '@craft-agent/shared/scheduled-work'
import { automationsAtom } from '@/atoms/automations'
import { sessionMetaMapAtom } from '@/atoms/sessions'
import { AutomationInfoPage } from '@/components/automations/AutomationInfoPage'
import type { ExecutionEntry } from '@/components/automations/types'
import { describeCron } from '@/components/automations/utils'
import { CompactPageHeader } from '@/components/app-shell/CompactPageHeader'
import { WorkPageTabs } from '@/components/app-shell/WorkPageTabs'
import { useAppShellContext } from '@/context/AppShellContext'
import { useWorkflowRuns } from '@/hooks/useWorkflowRuns'
import { useWorkspaceContext } from '@/hooks/useWorkspaceContext'
import { isArtistHQWorkspace } from '@/lib/artist-workspace'
import { navigate, routes } from '@/lib/navigate'
import { cn } from '@/lib/utils'
import { buildActiveWorkItems, visibleRecurringItems } from './build-active-work-items'
import { ActiveWorkAddMenu } from './ActiveWorkAddMenu'
import type { ActiveWorkItem, ActiveWorkSection } from './types'

const SECTION_META: Record<ActiveWorkSection, { title: string; icon: React.ComponentType<{ className?: string }> }> = {
  attention: { title: 'Needs Attention', icon: AlertTriangle },
  running: { title: 'Running Now', icon: Bot },
  'up-next': { title: 'Up Next', icon: Clock3 },
  recurring: { title: 'Recurring & Triggers', icon: Repeat2 },
}

const SECTION_ORDER: ActiveWorkSection[] = ['attention', 'running', 'up-next', 'recurring']

function formatWhen(value: string | undefined): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const now = new Date()
  const sameDay = date.toDateString() === now.toDateString()
  return date.toLocaleString(undefined, sameDay
    ? { hour: 'numeric', minute: '2-digit' }
    : { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function ActiveRow({ item, onOpen }: { item: ActiveWorkItem; onOpen: () => void }) {
  const Icon = item.source === 'workflow-run'
    ? Workflow
    : item.source === 'automation'
      ? Repeat2
      : item.source === 'scheduled-work'
        ? CalendarClock
        : Bot
  const when = item.section === 'up-next' ? formatWhen(item.sortAt) : null

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'group flex min-h-[54px] w-full items-center gap-2 rounded-[10px] bg-white/[0.035] px-3 py-2.5 text-left transition-colors hover:bg-white/[0.055] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/40 motion-reduce:transition-none sm:gap-3',
        item.section === 'attention' && 'bg-amber-400/[0.045] hover:bg-amber-400/[0.07]',
        item.section === 'running' && 'bg-orange-500/[0.045] hover:bg-orange-500/[0.07]',
      )}
    >
      <span className={cn(
        'flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-white/[0.055] text-white/42',
        item.section === 'attention' && 'text-amber-300/70',
        item.section === 'running' && 'text-orange-300/75',
      )}>
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] font-medium text-white/82">{item.title}</span>
        {item.subtitle || item.attentionReason ? (
          <span className="mt-0.5 block truncate text-[10.5px] text-white/36">
            {item.attentionReason || item.subtitle}
          </span>
        ) : null}
      </span>
      <span className="shrink-0 text-[10.5px] text-white/36">
        <span className="sm:hidden">{item.statusLabel}</span>
        <span className="hidden sm:inline">{when || item.statusLabel}</span>
      </span>
      {item.cadenceLabel ? (
        <span className="hidden shrink-0 rounded-full bg-white/[0.05] px-2 py-1 text-[9.5px] font-medium text-white/40 md:block">
          {item.cadenceLabel}
        </span>
      ) : null}
      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-white/24 transition-transform group-hover:translate-x-0.5 group-hover:text-white/48 motion-reduce:transform-none motion-reduce:transition-none" />
    </button>
  )
}

function ActiveSection({
  section,
  items,
  onOpen,
}: {
  section: ActiveWorkSection
  items: ActiveWorkItem[]
  onOpen: (item: ActiveWorkItem) => void
}) {
  const [showAll, setShowAll] = React.useState(false)
  const [showPaused, setShowPaused] = React.useState(false)
  const meta = SECTION_META[section]
  const Icon = meta.icon
  const pausedCount = section === 'recurring' ? items.filter((item) => item.statusLabel === 'Paused').length : 0
  const activeItems = section === 'recurring' ? visibleRecurringItems(items, showPaused) : items
  const visible = section === 'up-next' && !showAll ? activeItems.slice(0, 6) : activeItems

  if (items.length === 0) return null

  return (
    <section>
      <div className="mb-2 flex items-center gap-2 px-1">
        <Icon className={cn('h-3.5 w-3.5 text-white/36', section === 'attention' && 'text-amber-300/65', section === 'running' && 'text-orange-300/70')} />
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/48">{meta.title}</h2>
        <div className="h-px flex-1 bg-white/[0.055]" />
        <span className="text-[10px] text-white/28">{items.length}</span>
      </div>
      <div className="space-y-1.5">
        {visible.map((item) => <ActiveRow key={item.id} item={item} onOpen={() => onOpen(item)} />)}
      </div>
      {section === 'up-next' && activeItems.length > 6 ? (
        <button type="button" onClick={() => setShowAll((value) => !value)} className="mt-2 rounded px-1 text-[10.5px] text-white/38 hover:text-white/68 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/35">
          {showAll ? 'Show less' : `View all scheduled work (${activeItems.length})`}
        </button>
      ) : null}
      {section === 'recurring' && pausedCount > 2 ? (
        <button type="button" onClick={() => setShowPaused((value) => !value)} className="mt-2 rounded px-1 text-[10.5px] text-white/38 hover:text-white/68 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/35">
          {showPaused ? 'Hide paused' : `Show paused (${pausedCount})`}
        </button>
      ) : null}
    </section>
  )
}

export function ActiveWorkPage({ automationId, onSendAutomationToWorkspace }: { automationId?: string; onSendAutomationToWorkspace?: (automationId: string) => void }) {
  const {
    activeWorkspaceId,
    workspaces,
    onToggleAutomation,
    onTestAutomation,
    onDuplicateAutomation,
    onDeleteAutomation,
    automationTestResults,
    getAutomationHistory,
    onReplayAutomation,
  } = useAppShellContext()
  const automations = useAtomValue(automationsAtom)
  const sessionMeta = useAtomValue(sessionMetaMapAtom)
  const { runs, loading: runsLoading, error: runsError } = useWorkflowRuns(activeWorkspaceId)
  const { docs, loading: contextLoading, error: contextError } = useWorkspaceContext(activeWorkspaceId)
  const [executionMap, setExecutionMap] = React.useState<Map<string, ExecutionEntry[]>>(new Map())
  const [historyLoading, setHistoryLoading] = React.useState(false)
  const [historyError, setHistoryError] = React.useState<string | null>(null)
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId)

  React.useEffect(() => {
    let cancelled = false
    if (!getAutomationHistory || automations.length === 0) {
      setExecutionMap(new Map())
      setHistoryError(null)
      return () => { cancelled = true }
    }
    setExecutionMap(new Map())
    setHistoryError(null)
    setHistoryLoading(true)
    void Promise.allSettled(automations.map(async (automation) => [automation.id, await getAutomationHistory(automation.id)] as const))
      .then((results) => {
        if (cancelled) return
        const entries = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : [])
        const failedCount = results.length - entries.length
        setExecutionMap(new Map(entries))
        setHistoryError(failedCount > 0 ? `${failedCount} automation ${failedCount === 1 ? 'history' : 'histories'} could not be loaded.` : null)
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false)
      })
    return () => { cancelled = true }
  }, [automations, getAutomationHistory])

  const scheduled = React.useMemo(() => parseScheduledWorkDocResult(
    docs.find((doc) => doc.slug === SCHEDULED_WORK_CONTEXT_SLUG),
    activeWorkspaceId || 'workspace',
  ), [activeWorkspaceId, docs])

  const items = React.useMemo(() => buildActiveWorkItems({
    workspaceId: activeWorkspaceId || '',
    sessions: Array.from(sessionMeta.values()),
    workflowRuns: runs,
    scheduledWork: scheduled.work.items,
    automations,
    automationExecutions: executionMap,
    describeCron,
  }), [activeWorkspaceId, automations, executionMap, runs, scheduled.work.items, sessionMeta])

  const selectedAutomation = automationId ? automations.find((item) => item.id === automationId) : undefined
  if (selectedAutomation) {
    return (
      <div className="h-full overflow-y-auto bg-[#050505] text-foreground">
        {historyError ? (
          <div className="mx-auto mt-4 flex w-[min(960px,calc(100%-2rem))] items-start gap-2 rounded-[10px] bg-amber-400/[0.055] px-3 py-2.5 text-[11px] text-amber-100/65">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Automation history is incomplete. {historyError}
          </div>
        ) : null}
        <AutomationInfoPage
          automation={selectedAutomation}
          executions={executionMap.get(selectedAutomation.id) ?? []}
          testResult={automationTestResults?.[selectedAutomation.id]}
          onToggleEnabled={onToggleAutomation ? () => onToggleAutomation(selectedAutomation.id) : undefined}
          onTest={onTestAutomation ? () => onTestAutomation(selectedAutomation.id) : undefined}
          onDuplicate={onDuplicateAutomation ? () => onDuplicateAutomation(selectedAutomation.id) : undefined}
          onDelete={onDeleteAutomation ? () => onDeleteAutomation(selectedAutomation.id) : undefined}
          onSendToWorkspace={onSendAutomationToWorkspace ? () => onSendAutomationToWorkspace(selectedAutomation.id) : undefined}
          onReplay={onReplayAutomation}
        />
      </div>
    )
  }

  const handleOpen = (item: ActiveWorkItem) => {
    switch (item.openTarget.kind) {
      case 'session':
        navigate(routes.view.allSessions(item.openTarget.id))
        return
      case 'workflow-run':
        navigate(routes.view.workflowRun(item.openTarget.id))
        return
      case 'automation':
        navigate(routes.view.automations({ automationId: item.openTarget.id }))
        return
      case 'scheduled-work':
        if (isArtistHQWorkspace(activeWorkspace, workspaces)) {
          window.location.hash = '#artist-hq/calendar'
          navigate(routes.view.allSessions())
        } else {
          navigate(routes.view.campaign('calendar'))
        }
    }
  }

  const grouped = new Map<ActiveWorkSection, ActiveWorkItem[]>(SECTION_ORDER.map((section) => [section, []]))
  for (const item of items) grouped.get(item.section)?.push(item)
  const loading = runsLoading || contextLoading || historyLoading
  const sourceError = runsError || contextError || (!scheduled.ok ? scheduled.error : null) || historyError

  return (
    <div className="h-full overflow-y-auto bg-[#050505] text-foreground">
      <div className="mx-auto flex min-h-full max-w-[1600px] flex-col px-5 py-4 xl:px-8 xl:py-5">
        <CompactPageHeader eyebrow="Team" title="Work" tone="orange" className="mb-4" />
        <div className="mb-6 flex items-center justify-between gap-3">
          <WorkPageTabs active="active" />
          <ActiveWorkAddMenu />
        </div>

        {sourceError ? (
          <div className="mb-4 flex items-start gap-2 rounded-[10px] bg-amber-400/[0.055] px-3 py-2.5 text-[11px] text-amber-100/65">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Some active-work details could not be loaded. Available work is still shown. {sourceError}
          </div>
        ) : null}

        {loading && items.length === 0 ? (
          <div className="space-y-2">
            {[0, 1, 2].map((index) => <div key={index} className="h-[54px] animate-pulse rounded-[10px] bg-white/[0.035] motion-reduce:animate-none" />)}
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center pb-20 text-center">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-white/[0.045] text-white/36">
              <Clock3 className="h-4 w-4" />
            </div>
            <p className="max-w-md text-[13px] text-white/52">Nothing active yet. Run a worker or workflow now, schedule something for later, or create an automation.</p>
            <div className="mt-4">
              <ActiveWorkAddMenu label="Add work" prominent />
            </div>
          </div>
        ) : (
          <div className="space-y-7 pb-10">
            {SECTION_ORDER.map((section) => (
              <ActiveSection key={section} section={section} items={grouped.get(section) ?? []} onOpen={handleOpen} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
