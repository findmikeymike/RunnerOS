import * as React from 'react'
import { useAtomValue } from 'jotai'
import { toast } from 'sonner'
import { AlertTriangle, ArrowRight, Bot, CalendarClock, Clock3, Pause, Plus, Repeat2, Workflow } from 'lucide-react'
import { parseScheduledWorkDocResult, SCHEDULED_WORK_CONTEXT_SLUG } from '@craft-agent/shared/scheduled-work'
import { automationsAtom } from '@/atoms/automations'
import { sessionMetaMapAtom } from '@/atoms/sessions'
import { AutomationInfoPage } from '@/components/automations/AutomationInfoPage'
import { AutomationWorkDialog } from '@/components/automations/AutomationWorkDialog'
import type { AutomationListItem, ExecutionEntry } from '@/components/automations/types'
import { describeCron } from '@/components/automations/utils'
import { ArtistManagerCreateLink } from '@/components/app-shell/ArtistManagerCreateLink'
import { CompactPageHeader } from '@/components/app-shell/CompactPageHeader'
import { WorkPageTabs } from '@/components/app-shell/WorkPageTabs'
import { useAppShellContext } from '@/context/AppShellContext'
import { useWorkflowRuns } from '@/hooks/useWorkflowRuns'
import { useWorkflows } from '@/hooks/useWorkflows'
import { useWorkspaceContext } from '@/hooks/useWorkspaceContext'
import { isArtistHQWorkspace } from '@/lib/artist-workspace'
import { navigate, routes } from '@/lib/navigate'
import { cn } from '@/lib/utils'
import { buildActiveWorkItems, countStaleInputRequests } from './build-active-work-items'
import { ActiveWorkAddMenu } from './ActiveWorkAddMenu'
import { coerceSupplyValues, type SupplyInputDefinition } from './active-work-inputs'
import type { ActiveWorkItem, ActiveWorkSection } from './types'
import type { WorkflowRunDTO } from '../../../shared/types'
import { mergeActiveSessions, useGlobalRunningWork } from './useGlobalRunningWork'

const SECTION_META: Record<ActiveWorkSection, { title: string; icon: React.ComponentType<{ className?: string }> }> = {
  running: { title: 'Running Now', icon: Bot },
  attention: { title: 'Needs You', icon: AlertTriangle },
  'up-next': { title: 'Up Next', icon: Clock3 },
  paused: { title: 'Paused', icon: Pause },
}

const SECTION_ORDER: ActiveWorkSection[] = ['running', 'attention', 'up-next', 'paused']
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

function shortDay(value: string | undefined): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const ageDays = Math.floor((Date.now() - date.getTime()) / 86_400_000)
  if (ageDays === 0) return 'Today'
  if (ageDays === 1) return 'Yesterday'
  return date.toLocaleDateString(undefined, ageDays < 7
    ? { weekday: 'short' }
    : { month: 'short', day: 'numeric' })
}

function ActiveRow({ item, onOpen, onAction, supplyOpen, children }: {
  item: ActiveWorkItem
  onOpen: () => void
  onAction?: () => void
  supplyOpen?: boolean
  children?: React.ReactNode
}) {
  const Icon = item.source === 'workflow-run'
    ? Workflow
    : item.source === 'automation'
      ? Repeat2
      : item.source === 'scheduled-work'
        ? CalendarClock
        : Bot
  const when = formatWhen(item.nextRunAt ?? (item.section === 'up-next' ? item.sortAt : undefined))
  const finished = shortDay(item.recentCompletionAt)

  return (
    <div className={cn(
      'rounded-[10px] bg-white/[0.035] transition-colors hover:bg-white/[0.055]',
        item.section === 'attention' && 'bg-amber-400/[0.045] hover:bg-amber-400/[0.07]',
        item.section === 'running' && 'bg-orange-500/[0.045] hover:bg-orange-500/[0.07]',
    )}>
      <div className="flex min-h-[54px] items-center gap-2 px-3 py-2.5 sm:gap-3">
        <button type="button" onClick={onOpen} className="group flex min-w-0 flex-1 items-center gap-2 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/40 sm:gap-3">
          <span className={cn(
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-white/[0.055] text-white/42',
            item.section === 'attention' && 'text-amber-300/70',
            item.section === 'running' && 'text-orange-300/75',
          )}>
            <Icon className="h-3.5 w-3.5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12.5px] font-medium text-white/82">{item.title}</span>
            {item.subtitle || item.attentionReason || when || finished ? (
              <span className="mt-0.5 block truncate text-[10.5px] text-white/36">
                {item.attentionReason || item.subtitle}
                {(when || finished) ? <span className="ml-2 text-white/28">{when ? `Runs ${when}` : ''}{when && finished ? ' · ' : ''}{finished ? `Finished ${finished}` : ''}</span> : null}
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
          {item.originLabel ? (
            <span className="hidden shrink-0 rounded-full bg-orange-400/10 px-2 py-1 text-[9.5px] font-semibold text-orange-100/65 sm:block">
              {item.originLabel}
            </span>
          ) : null}
          <ArrowRight className="h-3.5 w-3.5 shrink-0 text-white/24 transition-transform group-hover:translate-x-0.5 group-hover:text-white/48 motion-reduce:transform-none motion-reduce:transition-none" />
        </button>
        {item.actionLabel && onAction ? (
          <button type="button" onClick={onAction} className="shrink-0 rounded-[7px] bg-amber-300/12 px-2.5 py-1.5 text-[10.5px] font-semibold text-amber-100/78 hover:bg-amber-300/18 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200/40">
            {item.actionLabel === 'Supply' && supplyOpen ? 'Close' : item.actionLabel}
            {(item.inputRequest?.coalescedFireCount ?? 0) > 1 ? ` ×${item.inputRequest!.coalescedFireCount}` : ''}
          </button>
        ) : null}
      </div>
      {supplyOpen ? children : null}
    </div>
  )
}

function ActiveSection({
  section,
  items,
  onOpen,
  onAction,
  supplyingItemId,
  renderSupply,
}: {
  section: ActiveWorkSection
  items: ActiveWorkItem[]
  onOpen: (item: ActiveWorkItem) => void
  onAction: (item: ActiveWorkItem) => void
  supplyingItemId?: string | null
  renderSupply: (item: ActiveWorkItem) => React.ReactNode
}) {
  const [showAll, setShowAll] = React.useState(false)
  const meta = SECTION_META[section]
  const Icon = meta.icon
  const visible = section === 'up-next' && !showAll ? items.slice(0, 6) : items
  const staleInputCount = section === 'attention' ? countStaleInputRequests(items) : 0

  if (items.length === 0) return null

  return (
    <section>
      <div className="mb-2 flex items-center gap-2 px-1">
        <Icon className={cn('h-3.5 w-3.5 text-white/36', section === 'attention' && 'text-amber-300/65', section === 'running' && 'text-orange-300/70')} />
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/48">{meta.title}</h2>
        <div className="h-px flex-1 bg-white/[0.055]" />
        {staleInputCount > 0 ? <span className="text-[10px] text-amber-100/50">{staleInputCount} waiting over a week</span> : null}
        <span className="text-[10px] text-white/28">{items.length}</span>
      </div>
      <div className="space-y-1.5">
        {visible.map((item) => (
          <ActiveRow
            key={item.id}
            item={item}
            onOpen={() => onOpen(item)}
            supplyOpen={supplyingItemId === item.id}
            onAction={item.actionLabel ? () => onAction(item) : undefined}
          >
            {renderSupply(item)}
          </ActiveRow>
        ))}
      </div>
      {section === 'up-next' && items.length > 6 ? (
        <button type="button" onClick={() => setShowAll((value) => !value)} className="mt-2 rounded px-1 text-[10.5px] text-white/38 hover:text-white/68 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/35">
          {showAll ? 'Show less' : `View all scheduled work (${items.length})`}
        </button>
      ) : null}
    </section>
  )
}

function WorkSetupActions({ workspaceId }: { workspaceId: string | null | undefined }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <ArtistManagerCreateLink kind="automation" workspaceId={workspaceId} label="Set up with Artist Manager" prominent />
      <AutomationWorkDialog
        workspaceId={workspaceId ?? undefined}
        trigger={(
          <button type="button" disabled={!workspaceId} className="inline-flex h-8 items-center gap-1.5 rounded-[8px] bg-white/[0.07] px-3 text-[10.5px] font-medium text-white/72 hover:bg-white/[0.10] hover:text-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/35 disabled:opacity-40">
            <Plus className="h-3 w-3" /> New automation
          </button>
        )}
      />
      <ActiveWorkAddMenu label="More" hideAutomation />
    </div>
  )
}

const STARTER_ROUTINES = [
  { title: 'Weekly campaign check-in', detail: 'Review timing, readiness, and the clearest next move.' },
  { title: 'Weekly signal scan', detail: 'Collect useful artist, audience, and industry signals.' },
  { title: 'Weekly content plan', detail: 'Turn current priorities into a focused week of content.' },
] as const

function StarterRoutines({ workspaceId }: { workspaceId: string | null | undefined }) {
  return (
    <section className="mb-6">
      <div className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/42">Starter routines</div>
      <div className="grid gap-1.5 md:grid-cols-3">
        {STARTER_ROUTINES.map((routine) => (
          <div key={routine.title} className="flex min-h-[68px] items-center justify-between gap-3 rounded-[10px] bg-white/[0.032] px-3 py-2.5">
            <div className="min-w-0"><div className="text-[11.5px] font-medium text-white/76">{routine.title}</div><div className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-white/32">{routine.detail}</div></div>
            <ArtistManagerCreateLink
              kind="automation"
              workspaceId={workspaceId}
              label="Set up"
              draft={`Set up a ${routine.title.toLowerCase()}. ${routine.detail} Choose the best active worker or workflow, use automatic weekly placement, bind every required input, and show me the exact one-sentence review before saving.`}
              className="shrink-0"
            />
          </div>
        ))}
      </div>
    </section>
  )
}

function SupplyWorkInputs({ item, definitions, onDone }: {
  item: ActiveWorkItem
  definitions: SupplyInputDefinition[]
  onDone: () => void
}) {
  const request = item.inputRequest!
  const [rawValues, setRawValues] = React.useState<Record<string, string>>({})
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const definitionsByName = React.useMemo(() => new Map(definitions.map((definition) => [definition.name, definition])), [definitions])
  const requestInputsKey = request.inputs.join('\u0000')

  React.useEffect(() => {
    setRawValues(Object.fromEntries(request.inputs.map((name) => [name, ''])))
    setError(null)
  }, [request.id, requestInputsKey])

  const submit = async () => {
    if (busy) return
    const coerced = coerceSupplyValues(request.inputs, definitions, rawValues)
    if ('error' in coerced) {
      setError(coerced.error)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await window.electronAPI.supplyScheduledWorkInputs(item.workspaceId, {
        orderId: item.sourceId,
        requestId: request.id,
        expectedUpdatedAt: item.updatedAt,
        source: 'list',
        values: coerced.values,
      })
      toast.success(`${item.title} is ready to run`)
      onDone()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="border-t border-white/[0.055] px-3 py-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        {request.inputs.map((name) => {
          const definition = definitionsByName.get(name)
          return (
            <label key={name} className="min-w-0 flex-1">
              <span className="mb-1 block text-[9.5px] font-medium uppercase tracking-[0.12em] text-white/38">{name.replace(/_/g, ' ')}</span>
              {definition?.type === 'boolean' ? (
                <select value={rawValues[name] ?? ''} onChange={(event) => setRawValues((current) => ({ ...current, [name]: event.target.value }))} className="h-8 w-full rounded-[7px] border border-white/[0.07] bg-[#121212] px-2.5 text-[11px] text-white/78 outline-none focus:border-orange-300/35">
                  <option value="">Choose</option>
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              ) : (
                <input
                  type={definition?.type === 'number' ? 'number' : 'text'}
                  value={rawValues[name] ?? ''}
                  onChange={(event) => setRawValues((current) => ({ ...current, [name]: event.target.value }))}
                  className="h-8 w-full rounded-[7px] border border-white/[0.07] bg-white/[0.035] px-2.5 text-[11px] text-white/78 outline-none placeholder:text-white/24 focus:border-orange-300/35"
                />
              )}
            </label>
          )
        })}
        <button type="button" onClick={() => void submit()} disabled={busy} className="h-8 shrink-0 rounded-[7px] bg-white px-3 text-[10.5px] font-semibold text-black hover:bg-white/90 disabled:opacity-45">
          {busy ? 'Saving…' : 'Continue'}
        </button>
      </div>
      {error ? <p className="mt-2 text-[10.5px] text-red-300/78">{error}</p> : null}
    </div>
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
    onSelectWorkspaceAndNavigate,
  } = useAppShellContext()
  const automations = useAtomValue(automationsAtom)
  const sessionMeta = useAtomValue(sessionMetaMapAtom)
  const { runs, loading: runsLoading, error: runsError } = useWorkflowRuns(activeWorkspaceId)
  const localWorkspaceIds = React.useMemo(
    () => workspaces.filter((workspace) => !workspace.remoteServer).map((workspace) => workspace.id).sort(),
    [workspaces],
  )
  const globalRunning = useGlobalRunningWork(localWorkspaceIds)
  const { allWorkflows, loading: workflowsLoading, error: workflowsError } = useWorkflows(activeWorkspaceId)
  const { docs, loading: contextLoading, error: contextError } = useWorkspaceContext(activeWorkspaceId)
  const [executionMap, setExecutionMap] = React.useState<Map<string, ExecutionEntry[]>>(new Map())
  const [historyLoading, setHistoryLoading] = React.useState(false)
  const [historyError, setHistoryError] = React.useState<string | null>(null)
  const [supplyingItemId, setSupplyingItemId] = React.useState<string | null>(null)
  const [pausingAll, setPausingAll] = React.useState(false)
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

  const combinedRuns = React.useMemo(() => {
    const byId = new Map<string, WorkflowRunDTO>()
    for (const run of [...globalRunning.runs, ...runs]) byId.set(run.id, run)
    return [...byId.values()]
  }, [globalRunning.runs, runs])
  const combinedSessions = React.useMemo(() => {
    return mergeActiveSessions(sessionMeta.values(), globalRunning.sessions)
  }, [globalRunning.sessions, sessionMeta])
  const combinedScheduledWork = React.useMemo(() => [
    ...scheduled.work.items,
    ...globalRunning.orders.filter((order) => order.owner.workspaceId !== activeWorkspaceId),
  ], [activeWorkspaceId, globalRunning.orders, scheduled.work.items])
  const runningWorkspaceIds = React.useMemo(() => new Set(globalRunning.workspaceIds), [globalRunning.workspaceIds])
  const automationsByWorkspace = React.useMemo(() => {
    const byWorkspace = new Map<string, AutomationListItem[]>(globalRunning.automationsByWorkspace)
    if (activeWorkspaceId) byWorkspace.set(activeWorkspaceId, automations)
    return byWorkspace
  }, [activeWorkspaceId, automations, globalRunning.automationsByWorkspace])
  const workspaceNamesById = React.useMemo(() => new Map(workspaces.map((workspace) => [
    workspace.id,
    isArtistHQWorkspace(workspace, workspaces) ? 'HQ' : workspace.name,
  ])), [workspaces])

  const items = React.useMemo(() => buildActiveWorkItems({
    workspaceId: activeWorkspaceId || '',
    sessions: combinedSessions,
    workflowRuns: combinedRuns,
    scheduledWork: combinedScheduledWork,
    automations,
    automationExecutions: executionMap,
    describeCron,
    runningWorkspaceIds,
    automationsByWorkspace,
    workspaceNamesById,
  }), [activeWorkspaceId, automations, automationsByWorkspace, combinedRuns, combinedScheduledWork, combinedSessions, executionMap, runningWorkspaceIds, workspaceNamesById])

  React.useEffect(() => {
    if (supplyingItemId && !items.some((item) => item.id === supplyingItemId && item.inputRequest)) {
      setSupplyingItemId(null)
    }
  }, [items, supplyingItemId])

  const selectedAutomation = automationId ? automations.find((item) => item.id === automationId) : undefined
  if (selectedAutomation) {
    const isPulse = selectedAutomation.actions.some((action) => action.type === 'pulse')
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
          onTest={!isPulse && onTestAutomation ? () => onTestAutomation(selectedAutomation.id) : undefined}
          onDuplicate={onDuplicateAutomation ? () => onDuplicateAutomation(selectedAutomation.id) : undefined}
          onDelete={onDeleteAutomation ? () => onDeleteAutomation(selectedAutomation.id) : undefined}
          onSendToWorkspace={onSendAutomationToWorkspace ? () => onSendAutomationToWorkspace(selectedAutomation.id) : undefined}
          onReplay={onReplayAutomation}
        />
      </div>
    )
  }

  const handleOpen = async (item: ActiveWorkItem) => {
    const targetWorkspace = workspaces.find((workspace) => workspace.id === item.workspaceId)
    if (!targetWorkspace) {
      toast.error('That workspace is no longer available')
      return
    }
    let route
    let hash: string | undefined
    if (item.openTarget.kind === 'scheduled-work') {
      sessionStorage.setItem('artist-os:scheduled-work-focus', JSON.stringify({
        workspaceId: item.workspaceId,
        orderId: item.openTarget.id,
      }))
    }
    switch (item.openTarget.kind) {
      case 'session':
        route = routes.view.allSessions(item.openTarget.id)
        break
      case 'workflow-run':
        route = routes.view.workflowRun(item.openTarget.id)
        break
      case 'automation':
        route = routes.view.automations({ automationId: item.openTarget.id })
        break
      case 'scheduled-work':
        if (isArtistHQWorkspace(targetWorkspace, workspaces)) {
          hash = '#artist-hq/calendar'
          route = routes.view.allSessions()
        } else {
          hash = ''
          route = routes.view.campaign('calendar')
        }
        break
    }
    if (item.workspaceId !== activeWorkspaceId) {
      if (!onSelectWorkspaceAndNavigate) {
        toast.error('Could not open that workspace')
        return
      }
      try {
        await onSelectWorkspaceAndNavigate(item.workspaceId, route, hash)
      } catch (error) {
        toast.error('Could not open that workspace', { description: error instanceof Error ? error.message : String(error) })
      }
      return
    }
    if (hash !== undefined) window.location.hash = hash
    navigate(route)
  }

  const handleAction = async (item: ActiveWorkItem) => {
    if (item.actionLabel === 'Supply') {
      setSupplyingItemId((current) => current === item.id ? null : item.id)
      return
    }
    if (item.source === 'automation' && (item.actionLabel === 'Activate' || item.actionLabel === 'Snooze 24h')) {
      const automation = automationsByWorkspace.get(item.workspaceId)?.find((candidate) => candidate.id === item.sourceId)
      if (!automation) return
      try {
        if (item.actionLabel === 'Snooze 24h') {
          await window.electronAPI.setAutomationSnoozedUntil(
            item.workspaceId,
            automation.event,
            automation.matcherIndex,
            new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          )
          toast.success(`${item.title} snoozed for 24 hours`)
        } else if (item.snoozedUntil) {
          await window.electronAPI.setAutomationSnoozedUntil(item.workspaceId, automation.event, automation.matcherIndex, null)
          if (!automation.enabled) {
            await window.electronAPI.setAutomationEnabled(item.workspaceId, automation.event, automation.matcherIndex, true)
          }
          toast.success(`${item.title} is active again`)
        } else if (onToggleAutomation) {
          onToggleAutomation(item.sourceId)
        }
      } catch (error) {
        toast.error('Could not update automatic work', { description: error instanceof Error ? error.message : String(error) })
      }
      return
    }
    if (item.actionLabel === 'Reconnect') {
      try {
        if (item.workspaceId !== activeWorkspaceId) {
          if (!onSelectWorkspaceAndNavigate) throw new Error('Workspace navigation is unavailable')
          await onSelectWorkspaceAndNavigate(item.workspaceId, routes.view.settings('secrets'))
        } else {
          navigate(routes.view.settings('secrets'))
        }
      } catch (error) {
        toast.error('Could not open Connections', { description: error instanceof Error ? error.message : String(error) })
      }
      return
    }
    if (item.source === 'scheduled-work' && item.actionLabel === 'Activate') {
      const order = combinedScheduledWork.find((candidate) => candidate.id === item.sourceId)
      if (!order) return
      try {
        if (order.execution.type === 'agent-task') {
          await window.electronAPI.setAgentDefinitionActive(item.workspaceId, order.execution.agentSlug, true)
        } else if (order.execution.type === 'workflow-run') {
          await window.electronAPI.setWorkflowActive(item.workspaceId, order.execution.workflowSlug, true)
        } else {
          await handleOpen(item)
          return
        }
        toast.success(`${item.title} is ready to resume`)
      } catch (error) {
        toast.error('Could not activate this work', { description: error instanceof Error ? error.message : String(error) })
      }
      return
    }
    await handleOpen(item)
  }

  const handlePauseAll = async () => {
    if (pausingAll) return
    if (globalRunning.loading || globalRunning.error) {
      toast.error('Refresh Work before pausing all automatic work')
      return
    }
    const enabled = [...automationsByWorkspace.entries()].flatMap(([workspaceId, entries]) => (
      entries.filter((automation) => automation.enabled).map((automation) => ({ workspaceId, automation }))
    ))
    if (!enabled.length) return
    setPausingAll(true)
    const results = await Promise.allSettled(enabled.map(({ workspaceId, automation }) => (
      window.electronAPI.setAutomationEnabled(workspaceId, automation.event, automation.matcherIndex, false)
    )))
    const failed = results.filter((result) => result.status === 'rejected').length
    if (failed) toast.error(`Paused ${enabled.length - failed}; ${failed} could not be paused`)
    else toast.success(`Paused ${enabled.length} automatic ${enabled.length === 1 ? 'routine' : 'routines'}`)
    setPausingAll(false)
  }

  const grouped = new Map<ActiveWorkSection, ActiveWorkItem[]>(SECTION_ORDER.map((section) => [section, []]))
  for (const item of items) grouped.get(item.section)?.push(item)
  const loading = runsLoading || globalRunning.loading || workflowsLoading || contextLoading || historyLoading
  const sourceError = runsError || globalRunning.error || workflowsError || contextError || (!scheduled.ok ? scheduled.error : null) || historyError

  const renderSupply = (item: ActiveWorkItem) => {
    if (!item.inputRequest || item.source !== 'scheduled-work') return null
    if (workflowsLoading) {
      return <div className="border-t border-white/[0.055] px-3 py-3 text-[10.5px] text-amber-100/62">Refreshing workflow fields…</div>
    }
    const order = combinedScheduledWork.find((candidate) => candidate.id === item.sourceId)
    if (!order || order.execution.type !== 'workflow-run') return null
    const workflowSlug = order.execution.workflowSlug
    const workflow = allWorkflows.find((candidate) => candidate.slug === workflowSlug)
    if (!workflow) {
      return (
        <div className="border-t border-white/[0.055] px-3 py-3 text-[10.5px] text-amber-100/62">
          Workflow fields are unavailable. Refresh Work before supplying input.
        </div>
      )
    }
    const requested = new Set(item.inputRequest.inputs)
    const definitions = (workflow.metadata.trigger.inputs ?? [])
      .filter((definition) => requested.has(definition.name))
      .map((definition) => ({ name: definition.name, type: definition.type }))
    if (definitions.length !== requested.size) {
      return <div className="border-t border-white/[0.055] px-3 py-3 text-[10.5px] text-amber-100/62">This workflow changed. Open its details before supplying input.</div>
    }
    return <SupplyWorkInputs item={item} definitions={definitions} onDone={() => setSupplyingItemId(null)} />
  }

  return (
    <div className="h-full overflow-y-auto bg-[#050505] text-foreground">
      <div className="mx-auto flex min-h-full max-w-[1600px] flex-col px-5 py-4 xl:px-8 xl:py-5">
        <CompactPageHeader eyebrow="Team" title="Work" tone="orange" className="mb-4" />
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <WorkPageTabs active="active" />
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button type="button" title={globalRunning.error ? 'Refresh Work before pausing every workspace' : 'Pause automatic work in every local workspace'} disabled={pausingAll || globalRunning.loading || Boolean(globalRunning.error) || ![...automationsByWorkspace.values()].some((entries) => entries.some((automation) => automation.enabled))} onClick={() => void handlePauseAll()} className="inline-flex h-8 items-center gap-1.5 rounded-[8px] bg-white/[0.045] px-3 text-[10.5px] font-medium text-white/48 hover:bg-white/[0.075] hover:text-white/78 disabled:opacity-30">
              <Pause className="h-3 w-3" /> {pausingAll ? 'Pausing…' : 'Pause all'}
            </button>
            <WorkSetupActions workspaceId={activeWorkspaceId} />
          </div>
        </div>

        {sourceError ? (
          <div className="mb-4 flex items-start gap-2 rounded-[10px] bg-amber-400/[0.055] px-3 py-2.5 text-[11px] text-amber-100/65">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Some active-work details could not be loaded. Available work is still shown. {sourceError}
          </div>
        ) : null}

        {automations.length === 0 && !loading ? <StarterRoutines workspaceId={activeWorkspaceId} /> : null}

        {loading && items.length === 0 ? (
          <div className="space-y-2">
            {[0, 1, 2].map((index) => <div key={index} className="h-[54px] animate-pulse rounded-[10px] bg-white/[0.035] motion-reduce:animate-none" />)}
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center pb-20 text-center">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-white/[0.045] text-white/36">
              <Clock3 className="h-4 w-4" />
            </div>
            <p className="max-w-md text-[13px] text-white/52">Nothing is running or scheduled.</p>
          </div>
        ) : (
          <div className="space-y-7 pb-10">
            {SECTION_ORDER.map((section) => (
              <ActiveSection
                key={section}
                section={section}
                items={grouped.get(section) ?? []}
                onOpen={handleOpen}
                onAction={(item) => void handleAction(item)}
                supplyingItemId={supplyingItemId}
                renderSupply={renderSupply}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
