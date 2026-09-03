import * as React from 'react'
import { Bot, CalendarClock, FileSearch, Link2, MessageSquare, Search, Webhook, Workflow } from 'lucide-react'
import type { WorkflowInputBinding } from '@craft-agent/shared/automations'
import {
  isAutomaticSchedulePlacementUnavailable,
  suggestAutomaticSchedule,
  type AutomaticScheduleCadence,
} from '@craft-agent/shared/automations/staggered-schedule'
import type { WorkflowTriggerInput } from '@craft-agent/shared/workflows'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useActiveWorkspace, useAppShellContext } from '@/context/AppShellContext'
import { useAgents } from '@/hooks/useAgents'
import { useWorkflows } from '@/hooks/useWorkflows'
import { isArtistHQWorkspace } from '@/lib/artist-workspace'
import {
  buildAutomationQueueWorkAction,
  buildCampaignSchedulePlanFromComposer,
  buildHqSchedulePlanFromComposer,
  composerDefinitionDigest,
  createScheduledWorkComposerDraft,
  type ScheduledWorkComposerDraft,
} from '@/lib/scheduled-work-composer'
import { humanizeWorkflowInputName } from '@/lib/workflow-input-presentation'
import { cn } from '@/lib/utils'
import type { AgentDefinitionDTO, WorkflowDTO } from '../../../shared/types'
import { CronBuilder } from './CronBuilder'
import { parseAutomationsConfig, type AutomationTrigger } from './types'
import {
  automationReviewSentence,
  compactWorkflowInputBindings,
  fixedValueWhenSelected,
  fixedTriggerInputs,
  initialWorkflowInputBindings,
  reconcileBindingsForWhen,
  requestedInputNames,
  triggerSourcesForInput,
  validateWorkflowInputBindings,
  type AutomationWhen,
} from './automation-work-setup'

type WorkTrigger = Extract<AutomationTrigger, 'SchedulerTick' | 'FileWatch' | 'WebhookReceive' | 'PollUrl' | 'MessageReceive'>
type SetupTarget = { kind: 'agent'; agent: AgentDefinitionDTO } | { kind: 'workflow'; workflow: WorkflowDTO }

const WHEN_OPTIONS: Array<{ value: AutomationWhen; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { value: 'weekly', label: 'Weekly', icon: CalendarClock },
  { value: 'daily', label: 'Daily', icon: CalendarClock },
  { value: 'once', label: 'Once', icon: CalendarClock },
  { value: 'file', label: 'On file', icon: FileSearch },
  { value: 'webhook', label: 'Webhook', icon: Webhook },
  { value: 'message', label: 'Message', icon: MessageSquare },
  { value: 'url', label: 'Page change', icon: Link2 },
  { value: 'custom', label: 'Custom', icon: CalendarClock },
]

const INPUT_CLASS = 'h-10 w-full rounded-[8px] border border-white/[0.08] bg-white/[0.045] px-3 text-[13px] text-white outline-none transition-colors placeholder:text-white/25 hover:bg-white/[0.06] focus:border-orange-400/35 focus:bg-white/[0.065] focus:ring-2 focus:ring-orange-400/10'
const INITIAL_SCHEDULE = suggestAutomaticSchedule([], 'weekly')

export interface AutomationWorkDialogProps {
  trigger?: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  workflowPrefill?: { slug: string; name: string; digest: string; triggerInputs: Record<string, unknown> }
  suggestedName?: string
  onFlowOpenChange?: (open: boolean) => void
  onCreated?: () => void
  workspaceId?: string
}

export function AutomationWorkDialog({ trigger, open, onOpenChange, workflowPrefill, suggestedName, onFlowOpenChange, onCreated, workspaceId }: AutomationWorkDialogProps) {
  const activeWorkspace = useActiveWorkspace()
  const { workspaces } = useAppShellContext()
  const workspace = workspaceId ? workspaces.find((candidate) => candidate.id === workspaceId) : activeWorkspace
  const { activeAgents, loading: agentsLoading } = useAgents(workspace?.id)
  const { activeWorkflows, loading: workflowsLoading } = useWorkflows(workspace?.id)
  const [internalOpen, setInternalOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [selectedId, setSelectedId] = React.useState('')
  const [name, setName] = React.useState('')
  const [brief, setBrief] = React.useState('')
  const [bindings, setBindings] = React.useState<Record<string, WorkflowInputBinding>>({})
  const [when, setWhen] = React.useState<AutomationWhen>('weekly')
  const [cron, setCron] = React.useState(INITIAL_SCHEDULE.cron)
  const [assignedScheduleLabel, setAssignedScheduleLabel] = React.useState(INITIAL_SCHEDULE.label)
  const [scheduleLoading, setScheduleLoading] = React.useState(false)
  const [scheduleError, setScheduleError] = React.useState<string | null>(null)
  const [scheduleReloadKey, setScheduleReloadKey] = React.useState(0)
  const [timezone, setTimezone] = React.useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')
  const [onceDate, setOnceDate] = React.useState(todayKey)
  const [onceTime, setOnceTime] = React.useState('09:00')
  const [watchPath, setWatchPath] = React.useState('.')
  const [watchGlob, setWatchGlob] = React.useState('**/*')
  const [webhookSlug, setWebhookSlug] = React.useState('')
  const [secretEnv, setSecretEnv] = React.useState('')
  const [pollUrl, setPollUrl] = React.useState('')
  const [pollIntervalSec, setPollIntervalSec] = React.useState(300)
  const [messageMatcher, setMessageMatcher] = React.useState('')
  const [showOnCalendar, setShowOnCalendar] = React.useState(true)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const initializedForOpen = React.useRef(false)
  const dialogOpen = open ?? internalOpen

  const setDialogOpen = React.useCallback((nextOpen: boolean) => {
    if (open === undefined) setInternalOpen(nextOpen)
    onOpenChange?.(nextOpen)
  }, [onOpenChange, open])

  React.useEffect(() => onFlowOpenChange?.(dialogOpen), [dialogOpen, onFlowOpenChange])

  const targets = React.useMemo<SetupTarget[]>(() => [
    ...activeAgents.map((agent): SetupTarget => ({ kind: 'agent', agent })),
    ...activeWorkflows.map((workflow): SetupTarget => ({ kind: 'workflow', workflow })),
  ], [activeAgents, activeWorkflows])
  const selected = React.useMemo(() => targets.find((target) => targetId(target) === selectedId), [selectedId, targets])
  const workflowInputs = selected?.kind === 'workflow' ? selected.workflow.metadata.trigger.inputs ?? [] : []
  const requestedInputs = selected?.kind === 'workflow' ? requestedInputNames(bindings) : []
  const isFed = requestedInputs.length > 0
  const automaticScheduleWorkspaceIds = React.useMemo(() => [...new Set([
    ...workspaces.map((candidate) => candidate.id),
    ...(workspace?.id ? [workspace.id] : []),
  ])].sort(), [workspace?.id, workspaces])

  React.useEffect(() => {
    if (!dialogOpen) {
      initializedForOpen.current = false
      return
    }
    if (initializedForOpen.current) return
    if (workflowPrefill && workflowsLoading) return
    initializedForOpen.current = true
    setQuery('')
    setBrief('')
    setWhen('weekly')
    setCron(INITIAL_SCHEDULE.cron)
    setAssignedScheduleLabel(INITIAL_SCHEDULE.label)
    setScheduleError(null)
    setScheduleReloadKey((current) => current + 1)
    setError(null)
    setBusy(false)
    setTimezone(localTimezone())
    setOnceDate(todayKey())
    setOnceTime('09:00')
    setWatchPath('.')
    setWatchGlob('**/*')
    setWebhookSlug('')
    setSecretEnv('')
    setPollUrl('')
    setPollIntervalSec(300)
    setMessageMatcher('')
    setShowOnCalendar(true)
    if (workflowPrefill) {
      const workflow = activeWorkflows.find((candidate) => candidate.slug === workflowPrefill.slug)
      setSelectedId(`workflow:${workflowPrefill.slug}`)
      setName(suggestedName || workflowPrefill.name)
      setBindings(initialWorkflowInputBindings(workflow?.metadata.trigger.inputs ?? [], workflowPrefill.triggerInputs))
    } else {
      setSelectedId('')
      setName(suggestedName || '')
      setBindings({})
    }
  }, [activeWorkflows, dialogOpen, suggestedName, workflowPrefill, workflowsLoading])

  const loadAutomaticSchedule = React.useCallback(async (cadence: AutomaticScheduleCadence) => {
    const configs = await Promise.all(automaticScheduleWorkspaceIds.map((id) => window.electronAPI.getAutomations(id)))
    const existing = configs.flatMap((config) => config
      ? parseAutomationsConfig(config)
        .filter((automation) => automation.event === 'SchedulerTick')
        .map((automation) => ({ cron: automation.cron, enabled: automation.enabled, timezone: automation.timezone }))
      : [])
    return suggestAutomaticSchedule(existing, cadence, { timezone })
  }, [automaticScheduleWorkspaceIds, timezone])

  React.useEffect(() => {
    if (!dialogOpen || (when !== 'weekly' && when !== 'daily') || !workspace?.id) return
    let cancelled = false
    setScheduleLoading(true)
    setScheduleError(null)
    void loadAutomaticSchedule(when)
      .then((suggestion) => {
        if (cancelled) return
        setCron(suggestion.cron)
        setAssignedScheduleLabel(suggestion.label)
      })
      .catch(() => {
        if (cancelled) return
        setScheduleError("Couldn't check other schedules. Try again.")
        setCron('')
        setAssignedScheduleLabel('')
      })
      .finally(() => { if (!cancelled) setScheduleLoading(false) })
    return () => { cancelled = true }
  }, [dialogOpen, loadAutomaticSchedule, scheduleReloadKey, when, workspace?.id])

  React.useEffect(() => {
    if (isFed && when === 'once') setWhen('weekly')
  }, [isFed, when])

  const filteredTargets = React.useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return targets.filter((target) => !normalized || targetSearchText(target).includes(normalized))
  }, [query, targets])

  const chooseTarget = React.useCallback((target: SetupTarget) => {
    setSelectedId(targetId(target))
    setName(targetName(target))
    setError(null)
    if (target.kind === 'workflow') {
      const prefilled = workflowPrefill?.slug === target.workflow.slug ? workflowPrefill.triggerInputs : {}
      const inputs = target.workflow.metadata.trigger.inputs ?? []
      setBindings(reconcileBindingsForWhen(inputs, initialWorkflowInputBindings(inputs, prefilled), when))
    } else {
      setBindings({})
    }
  }, [when, workflowPrefill])

  const chooseWhen = React.useCallback((nextWhen: AutomationWhen) => {
    setWhen(nextWhen)
    setScheduleError(null)
    setError(null)
    if (nextWhen === 'once') setTimezone(localTimezone())
    if (selected?.kind === 'workflow') setBindings((current) => reconcileBindingsForWhen(workflowInputs, current, nextWhen))
  }, [selected?.kind, workflowInputs])

  const submit = React.useCallback(async () => {
    if (!workspace || !selected) return
    const validationError = validateSetup({ selected, name, brief, bindings, workflowInputs, when, cron, onceDate, onceTime, watchPath, watchGlob, webhookSlug, secretEnv, pollUrl, pollIntervalSec, messageMatcher })
    if (validationError) {
      setError(validationError)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const isHq = isArtistHQWorkspace(workspace, workspaces)
      const owner = isHq
        ? { scope: 'hq' as const, workspaceId: workspace.id }
        : { scope: 'campaign' as const, workspaceId: workspace.id, campaignId: workspace.id }
      let resolvedLabel = assignedScheduleLabel
      const draft = buildDraft({ selected, owner, name, brief, bindings, date: onceDate, time: onceTime, timezone })
      if (when === 'once') {
        if (draft.owner.scope === 'hq') {
          await window.electronAPI.scheduleHqWork(workspace.id, buildHqSchedulePlanFromComposer(draft))
        } else {
          const plan = buildCampaignSchedulePlanFromComposer(draft)
          if ('orders' in plan) await window.electronAPI.scheduleCampaignWorkChain(workspace.id, plan)
          else await window.electronAPI.scheduleCampaignWork(workspace.id, plan)
        }
        toast.success(`${name.trim()} scheduled`)
      } else {
        const action = buildAutomationQueueWorkAction(draft, {
          calendarVisibility: showOnCalendar ? 'visible' : 'hidden',
          inputBindings: selected.kind === 'workflow' ? compactWorkflowInputBindings(workflowInputs, bindings) : undefined,
        })
        const { event, matcher } = buildAutomationMatcher({ when, name, cron, timezone, watchPath, watchGlob, webhookSlug, secretEnv, pollUrl, pollIntervalSec, messageMatcher, action })
        const result = await window.electronAPI.createAutomationFromTemplate(
          workspace.id,
          event,
          matcher,
          when === 'weekly' || when === 'daily' ? { automaticCadence: when } : undefined,
        )
        if (result.cron) setCron(result.cron)
        if (result.label) {
          resolvedLabel = result.label
          setAssignedScheduleLabel(result.label)
        }
        toast.success('Automation created', { description: automationReviewSentence({ title: name, runnerName: targetName(selected), when, scheduleLabel: when === 'weekly' || when === 'daily' ? resolvedLabel : when === 'custom' ? cron : undefined, requestedInputs, fixedInputs: selected.kind === 'workflow' ? fixedTriggerInputs(bindings) : undefined }) })
      }
      setDialogOpen(false)
      onCreated?.()
    } catch (submitError) {
      if ((when === 'weekly' || when === 'daily') && isAutomaticSchedulePlacementUnavailable(submitError)) {
        setScheduleError("Couldn't verify an open time. Try again.")
        setCron('')
        setAssignedScheduleLabel('')
        setError(null)
      } else {
        setError(submitError instanceof Error ? submitError.message : String(submitError))
      }
    } finally {
      setBusy(false)
    }
  }, [assignedScheduleLabel, bindings, brief, cron, loadAutomaticSchedule, messageMatcher, name, onCreated, onceDate, onceTime, pollIntervalSec, pollUrl, requestedInputs, secretEnv, selected, setDialogOpen, showOnCalendar, timezone, watchGlob, watchPath, webhookSlug, when, workflowInputs, workspace, workspaces])

  const review = selected ? automationReviewSentence({
    title: name,
    runnerName: targetName(selected),
    when,
    scheduleLabel: when === 'weekly' || when === 'daily' ? (scheduleError ? undefined : assignedScheduleLabel) : when === 'once' ? formatLocalDateTime(onceDate, onceTime) : undefined,
    requestedInputs,
    fixedInputs: selected.kind === 'workflow' ? fixedTriggerInputs(bindings) : undefined,
  }) : ''

  return (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent className="flex max-h-[90vh] w-[min(720px,calc(100vw-24px))] max-w-none flex-col gap-0 overflow-hidden border-white/[0.09] bg-[#0b0b0d]/95 p-0 text-white shadow-modal-small backdrop-blur-2xl max-sm:max-h-[100dvh] max-sm:w-screen max-sm:rounded-none">
        <DialogHeader className="shrink-0 border-b border-white/[0.065] px-6 py-5 pr-14">
          <DialogTitle className="text-[19px] font-semibold tracking-normal text-white/95">New automation</DialogTitle>
          <DialogDescription className="mt-1 text-[13px] leading-5 text-white/42">Choose the work, decide what starts it, then give it what it needs.</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
          <SetupSection number="1" title="What runs">
            {selected ? <SelectedTarget target={selected} locked={Boolean(workflowPrefill)} onChange={() => setSelectedId('')} /> : <TargetPicker targets={filteredTargets} query={query} loading={agentsLoading || workflowsLoading} onQuery={setQuery} onChoose={chooseTarget} />}
            {selected ? <Field label="Name"><input className={INPUT_CLASS} value={name} onChange={(event) => setName(event.target.value)} placeholder={targetName(selected)} /></Field> : null}
          </SetupSection>

          {selected ? (
            <SetupSection number="2" title="What starts it">
              <WhenPicker when={when} isFed={isFed} onChoose={chooseWhen} />
              <WhenFields when={when} isFed={isFed} requestedInputs={requestedInputs} assignedScheduleLabel={assignedScheduleLabel} scheduleLoading={scheduleLoading} scheduleError={scheduleError} cron={cron} timezone={timezone} onceDate={onceDate} onceTime={onceTime} watchPath={watchPath} watchGlob={watchGlob} webhookSlug={webhookSlug} secretEnv={secretEnv} pollUrl={pollUrl} pollIntervalSec={pollIntervalSec} messageMatcher={messageMatcher} onCron={setCron} onTimezone={setTimezone} onOnceDate={setOnceDate} onOnceTime={setOnceTime} onWatchPath={setWatchPath} onWatchGlob={setWatchGlob} onWebhookSlug={setWebhookSlug} onSecretEnv={setSecretEnv} onPollUrl={setPollUrl} onPollIntervalSec={setPollIntervalSec} onMessageMatcher={setMessageMatcher} onScheduleRetry={() => setScheduleReloadKey((current) => current + 1)} />
              {when !== 'once' ? <div className="flex items-center justify-between gap-4 rounded-[9px] bg-white/[0.035] px-3.5 py-3"><span className="text-[12px] text-white/62">Show runs on Calendar</span><Switch className="shrink-0 data-[state=checked]:bg-[#f4511e]" checked={showOnCalendar} onCheckedChange={setShowOnCalendar} aria-label="Show runs on Calendar" /></div> : null}
            </SetupSection>
          ) : null}

          {selected ? (
            <SetupSection number="3" title="What it needs">
              {selected.kind === 'agent' ? (
                <Field label="Instructions"><Textarea className="min-h-24 resize-y rounded-[8px] border-white/[0.08] bg-white/[0.045] text-[13px] text-white placeholder:text-white/25 focus-visible:ring-orange-400/15" value={brief} onChange={(event) => setBrief(event.target.value)} placeholder="What should this worker handle each time?" /></Field>
              ) : workflowInputs.length ? (
                <WorkflowBindings inputs={workflowInputs} bindings={bindings} when={when} onChange={setBindings} />
              ) : <p className="text-[12px] text-white/38">This workflow is ready to run without extra input.</p>}
            </SetupSection>
          ) : null}

          {error ? <p role="alert" className="rounded-[8px] bg-red-500/10 px-3 py-2.5 text-[12px] text-red-200/85">{error}</p> : null}
        </div>

        <div className="shrink-0 border-t border-white/[0.065] bg-black/15 px-6 py-4">
          {review ? <p className="mb-3 text-[12px] leading-5 text-white/48">{review}</p> : null}
          <div className="flex justify-end gap-2">
            <Button className="h-9 rounded-[8px] px-4 text-[13px] text-white/52 hover:bg-white/[0.05] hover:text-white/82" variant="ghost" onClick={() => setDialogOpen(false)} disabled={busy}>Cancel</Button>
            <Button className="h-9 rounded-[8px] bg-[#f4511e] px-4 text-[13px] font-semibold text-white hover:bg-[#ff5c28]" onClick={() => void submit()} disabled={!selected || busy || scheduleLoading || ((when === 'weekly' || when === 'daily') && Boolean(scheduleError))}>{busy ? 'Saving...' : when === 'once' ? 'Schedule once' : 'Save automation'}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function SetupSection({ number, title, children }: { number: string; title: string; children: React.ReactNode }) {
  return <section className="space-y-3"><div className="flex items-center gap-2"><span className="flex size-5 items-center justify-center rounded-full bg-white/[0.065] text-[10px] font-semibold text-white/48">{number}</span><h3 className="text-[13px] font-semibold text-white/82">{title}</h3></div>{children}</section>
}

function TargetPicker({ targets, query, loading, onQuery, onChoose }: { targets: SetupTarget[]; query: string; loading: boolean; onQuery: (value: string) => void; onChoose: (target: SetupTarget) => void }) {
  return <div className="space-y-2"><label className="relative block"><Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/28" /><span className="sr-only">Search workers and workflows</span><input autoFocus className={cn(INPUT_CLASS, 'pl-9')} value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Search workers and workflows" /></label><div className="max-h-52 space-y-1 overflow-y-auto pr-1">{loading ? <EmptyLine>Loading available work...</EmptyLine> : targets.length ? targets.map((target) => <button key={targetId(target)} type="button" onClick={() => onChoose(target)} className="flex w-full items-center gap-3 rounded-[8px] bg-white/[0.025] px-3 py-2.5 text-left hover:bg-white/[0.055] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/30"><TargetAvatar target={target} /><span className="min-w-0 flex-1"><span className="block text-[13px] font-medium text-white/78">{targetName(target)}</span><span className="mt-0.5 block truncate text-[11px] text-white/34">{targetDescription(target)}</span></span><span className="text-[10px] text-white/28">{target.kind === 'agent' ? 'Worker' : 'Workflow'}</span></button>) : <EmptyLine>No matching active workers or workflows.</EmptyLine>}</div></div>
}

function SelectedTarget({ target, locked, onChange }: { target: SetupTarget; locked: boolean; onChange: () => void }) {
  return <div className="flex items-center gap-3 rounded-[9px] bg-white/[0.04] px-3 py-2.5"><TargetAvatar target={target} /><div className="min-w-0 flex-1"><div className="text-[13px] font-medium text-white/82">{targetName(target)}</div><div className="mt-0.5 truncate text-[11px] text-white/34">{target.kind === 'agent' ? 'Worker' : `${target.workflow.metadata.steps.length} step workflow`}</div></div>{!locked ? <button type="button" className="text-[11px] text-orange-300/75 hover:text-orange-200" onClick={onChange}>Change</button> : null}</div>
}

function TargetAvatar({ target }: { target: SetupTarget }) {
  if (target.kind === 'agent' && target.agent.metadata.avatar?.trim()) return <span className="flex size-8 shrink-0 items-center justify-center rounded-[8px] bg-white/[0.055] text-[15px]">{target.agent.metadata.avatar.trim()}</span>
  const Icon = target.kind === 'agent' ? Bot : Workflow
  return <span className="flex size-8 shrink-0 items-center justify-center rounded-[8px] bg-white/[0.055] text-white/48"><Icon className="h-4 w-4" /></span>
}

function WorkflowBindings({ inputs, bindings, when, onChange }: { inputs: WorkflowTriggerInput[]; bindings: Record<string, WorkflowInputBinding>; when: AutomationWhen; onChange: React.Dispatch<React.SetStateAction<Record<string, WorkflowInputBinding>>> }) {
  return <div className="space-y-2">{inputs.map((input) => {
    const binding = bindings[input.name] ?? (input.required ? { mode: 'ask' as const } : { mode: 'fixed' as const, value: '' })
    const triggerSources = triggerSourcesForInput(when, input)
    const selectValue = binding.mode === 'trigger' ? `trigger:${binding.from}` : binding.mode
    return <div key={input.name} className="grid gap-2 rounded-[9px] bg-white/[0.028] p-3 sm:grid-cols-[minmax(120px,0.8fr)_170px_minmax(180px,1.2fr)] sm:items-center"><div className="min-w-0"><div className="truncate text-[12px] font-medium text-white/68">{humanizeWorkflowInputName(input.name)}</div>{input.description ? <div className="mt-0.5 truncate text-[10px] text-white/28">{input.description}</div> : null}</div><select className={cn(INPUT_CLASS, 'appearance-none')} value={selectValue} onChange={(event) => {
      const value = event.target.value
      onChange((current) => {
        const currentBinding = current[input.name]
        const fixedValue = fixedValueWhenSelected(input, currentBinding)
        return { ...current, [input.name]: value === 'ask' ? { mode: 'ask' } : value.startsWith('trigger:') ? { mode: 'trigger', from: value.slice('trigger:'.length) as Extract<WorkflowInputBinding, { mode: 'trigger' }>['from'] } : { mode: 'fixed', value: fixedValue } }
      })
    }}><option value="fixed">Same every time</option>{input.required ? <option value="ask">Ask me each time</option> : null}{triggerSources.map(({ source, label }) => <option key={source} value={`trigger:${source}`}>{label}</option>)}</select>{binding.mode === 'fixed' ? <FixedInput input={input} value={binding.value} onChange={(value) => onChange((current) => ({ ...current, [input.name]: { mode: 'fixed', value } }))} /> : binding.mode === 'ask' ? <span className="text-[11px] leading-4 text-white/30">Appears under Needs you when it runs.</span> : <span className="text-[11px] text-white/30">Filled automatically.</span>}</div>
  })}</div>
}

function FixedInput({ input, value, onChange }: { input: WorkflowTriggerInput; value: unknown; onChange: (value: unknown) => void }) {
  if (input.type === 'boolean') return <select className={cn(INPUT_CLASS, 'appearance-none')} value={value === '' || value === undefined || value === null ? '' : String(Boolean(value))} onChange={(event) => onChange(event.target.value === '' ? '' : event.target.value === 'true')}><option value="">Not set</option><option value="true">Yes</option><option value="false">No</option></select>
  return <input className={INPUT_CLASS} type={input.type === 'number' ? 'number' : 'text'} min={input.min} max={input.max} step={input.type === 'number' && input.integer ? 1 : undefined} value={typeof value === 'string' || typeof value === 'number' ? value : ''} onChange={(event) => onChange(input.type === 'number' ? (event.target.value === '' ? '' : Number(event.target.value)) : event.target.value)} />
}

function WhenPicker({ when, isFed, onChoose }: { when: AutomationWhen; isFed: boolean; onChoose: (value: AutomationWhen) => void }) {
  return <div className="grid grid-cols-2 gap-1 rounded-[10px] bg-white/[0.028] p-1 sm:grid-cols-4" role="radiogroup" aria-label="When this work runs">{WHEN_OPTIONS.filter((option) => !(isFed && option.value === 'once')).map((option) => {
    const Icon = option.icon
    const label = isFed && option.value === 'weekly' ? 'Needs input weekly' : isFed && option.value === 'daily' ? 'Needs input daily' : option.label
    return <button key={option.value} type="button" role="radio" aria-checked={option.value === when} onClick={() => onChoose(option.value)} className={cn('flex h-10 min-w-0 items-center justify-center gap-1.5 rounded-[7px] px-2 text-[11px] font-medium transition-colors', option.value === when ? 'bg-[#f4511e] text-white' : 'text-white/40 hover:bg-white/[0.045] hover:text-white/70')}><Icon className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{label}</span></button>
  })}</div>
}

interface WhenFieldsProps {
  when: AutomationWhen; isFed: boolean; requestedInputs: string[]; assignedScheduleLabel: string; scheduleLoading: boolean; scheduleError: string | null; cron: string; timezone: string; onceDate: string; onceTime: string; watchPath: string; watchGlob: string; webhookSlug: string; secretEnv: string; pollUrl: string; pollIntervalSec: number; messageMatcher: string
  onCron: (value: string) => void; onTimezone: (value: string) => void; onOnceDate: (value: string) => void; onOnceTime: (value: string) => void; onWatchPath: (value: string) => void; onWatchGlob: (value: string) => void; onWebhookSlug: (value: string) => void; onSecretEnv: (value: string) => void; onPollUrl: (value: string) => void; onPollIntervalSec: (value: number) => void; onMessageMatcher: (value: string) => void; onScheduleRetry: () => void
}

function WhenFields(props: WhenFieldsProps) {
  if (props.when === 'weekly' || props.when === 'daily') return <div className="space-y-2">{props.scheduleError ? <div className="flex items-center justify-between gap-3 rounded-[8px] bg-orange-500/[0.08] px-3 py-2.5 text-[12px]"><span className="text-orange-100/70">{props.scheduleError}</span><button type="button" className="font-medium text-orange-300 hover:text-orange-200" onClick={props.onScheduleRetry}>Retry</button></div> : <div className="flex items-center justify-between gap-3 rounded-[8px] bg-white/[0.035] px-3 py-2.5 text-[12px]"><span className="text-white/38">{props.scheduleLoading ? 'Finding an open time...' : props.isFed ? `Waits for ${props.requestedInputs.map(humanizeWorkflowInputName).join(', ')}` : 'Assigned time'}</span><span className="font-medium text-white/72">{props.scheduleLoading ? '' : props.assignedScheduleLabel}</span></div>}<Field label="Time zone"><input className={INPUT_CLASS} value={props.timezone} onChange={(event) => props.onTimezone(event.target.value)} /></Field></div>
  if (props.when === 'once') return <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto]"><Field label="Date"><input className={INPUT_CLASS} type="date" value={props.onceDate} onChange={(event) => props.onOnceDate(event.target.value)} /></Field><Field label="Time"><input className={INPUT_CLASS} type="time" value={props.onceTime} onChange={(event) => props.onOnceTime(event.target.value)} /></Field><div className="min-w-[130px] space-y-1.5"><span className="block text-[11px] font-medium text-white/48">Time zone</span><div className="flex h-10 items-center rounded-[8px] bg-white/[0.035] px-3 text-[12px] text-white/48">{props.timezone}</div></div></div>
  if (props.when === 'custom') return <CronBuilder className="rounded-[10px] bg-white/[0.02] p-3" value={props.cron} onChange={props.onCron} timezone={props.timezone} onTimezoneChange={props.onTimezone} showAdvanced={false} />
  if (props.when === 'file') return <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><Field label="Folder"><input className={INPUT_CLASS} value={props.watchPath} onChange={(event) => props.onWatchPath(event.target.value)} placeholder="content" /></Field><Field label="File pattern"><input className={INPUT_CLASS} value={props.watchGlob} onChange={(event) => props.onWatchGlob(event.target.value)} placeholder="**/*.md" /></Field></div>
  if (props.when === 'webhook') return <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><Field label="Webhook name"><input className={INPUT_CLASS} value={props.webhookSlug} onChange={(event) => props.onWebhookSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} placeholder="campaign-ready" /></Field><Field label="Secret environment variable"><input className={INPUT_CLASS} value={props.secretEnv} onChange={(event) => props.onSecretEnv(event.target.value.toUpperCase())} placeholder="CRAFT_WH_CAMPAIGN_SECRET" /></Field></div>
  if (props.when === 'url') return <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-3"><Field label="Page or feed URL"><input className={INPUT_CLASS} value={props.pollUrl} onChange={(event) => props.onPollUrl(event.target.value)} placeholder="https://example.com/feed.json" /></Field><Field label="Every (seconds)"><input className={INPUT_CLASS} type="number" min={30} value={props.pollIntervalSec} onChange={(event) => props.onPollIntervalSec(Number(event.target.value))} /></Field></div>
  return <Field label="Message pattern"><input className={INPUT_CLASS} value={props.messageMatcher} onChange={(event) => props.onMessageMatcher(event.target.value)} placeholder="campaign approved" /></Field>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block min-w-0 space-y-1.5"><span className="text-[11px] font-medium text-white/48">{label}</span>{children}</label>
}

function EmptyLine({ children }: { children: React.ReactNode }) {
  return <div className="rounded-[8px] bg-white/[0.025] px-3 py-5 text-center text-[11px] text-white/34">{children}</div>
}

function targetId(target: SetupTarget): string { return target.kind === 'agent' ? `agent:${target.agent.slug}` : `workflow:${target.workflow.slug}` }
function targetName(target: SetupTarget): string { return target.kind === 'agent' ? target.agent.metadata.name : target.workflow.metadata.name }
function targetDescription(target: SetupTarget): string { return target.kind === 'agent' ? target.agent.metadata.description : target.workflow.metadata.description }
function targetSearchText(target: SetupTarget): string { return target.kind === 'agent' ? `${target.agent.metadata.name} ${target.agent.metadata.description} ${(target.agent.metadata.tags ?? []).join(' ')}`.toLowerCase() : `${target.workflow.metadata.name} ${target.workflow.metadata.description}`.toLowerCase() }

function buildDraft(input: { selected: SetupTarget; owner: { scope: 'hq'; workspaceId: string } | { scope: 'campaign'; workspaceId: string; campaignId: string }; name: string; brief: string; bindings: Record<string, WorkflowInputBinding>; date: string; time: string; timezone: string }): Exclude<ScheduledWorkComposerDraft, { type: 'event' }> {
  if (input.selected.kind === 'agent') {
    const draft = createScheduledWorkComposerDraft({ owner: input.owner, date: input.date, timezone: input.timezone, title: input.name, suggestedType: 'agent-task' })
    if (draft.type !== 'agent-task') throw new Error('Could not prepare the worker task.')
    return { ...draft, time: input.time, agentSlug: input.selected.agent.slug, agentName: input.selected.agent.metadata.name, brief: input.brief, permissionMode: 'safe' }
  }
  const draft = createScheduledWorkComposerDraft({ owner: input.owner, date: input.date, timezone: input.timezone, title: input.name, suggestedType: 'workflow-run' })
  if (draft.type !== 'workflow-run') throw new Error('Could not prepare the workflow.')
  return { ...draft, time: input.time, workflowSlug: input.selected.workflow.slug, workflowName: input.selected.workflow.metadata.name, workflowDigest: composerDefinitionDigest({ metadata: input.selected.workflow.metadata, body: input.selected.workflow.body }), triggerInputs: fixedTriggerInputs(input.bindings) }
}

function validateSetup(input: { selected: SetupTarget; name: string; brief: string; bindings: Record<string, WorkflowInputBinding>; workflowInputs: WorkflowTriggerInput[]; when: AutomationWhen; cron: string; onceDate: string; onceTime: string; watchPath: string; watchGlob: string; webhookSlug: string; secretEnv: string; pollUrl: string; pollIntervalSec: number; messageMatcher: string }): string | undefined {
  if (!input.name.trim()) return 'Add a name.'
  if (input.selected.kind === 'agent' && !input.brief.trim()) return 'Tell the worker what to handle each time.'
  if (input.selected.kind === 'workflow') {
    const bindingError = validateWorkflowInputBindings(input.workflowInputs, input.bindings, input.when)
    if (bindingError) return bindingError
    if (input.when === 'once' && requestedInputNames(input.bindings).length) return 'One-time work needs its inputs now. Use the workflow directly instead.'
  }
  if (input.when === 'custom' && !input.cron.trim()) return 'Add a schedule.'
  if (input.when === 'once' && (!input.onceDate || !input.onceTime)) return 'Choose a date and time.'
  if (input.when === 'file' && (!input.watchPath.trim() || !input.watchGlob.trim())) return 'Choose a folder and file pattern.'
  if (input.when === 'webhook') {
    if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(input.webhookSlug)) return 'Use a webhook name with lowercase letters, numbers, and hyphens.'
    if (!/^CRAFT_WH_[A-Z0-9_]+$/.test(input.secretEnv)) return 'Use a CRAFT_WH_* environment variable for the signing secret.'
  }
  if (input.when === 'url') {
    try { const url = new URL(input.pollUrl); if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error() } catch { return 'Add a valid HTTP or HTTPS URL.' }
    if (!Number.isInteger(input.pollIntervalSec) || input.pollIntervalSec < 30) return 'Polling must be at least every 30 seconds.'
  }
  if (input.when === 'message' && input.messageMatcher) { try { new RegExp(input.messageMatcher) } catch { return 'Add a valid message pattern.' } }
  return undefined
}

function buildAutomationMatcher(input: { when: Exclude<AutomationWhen, 'once'>; name: string; cron: string; timezone: string; watchPath: string; watchGlob: string; webhookSlug: string; secretEnv: string; pollUrl: string; pollIntervalSec: number; messageMatcher: string; action: ReturnType<typeof buildAutomationQueueWorkAction> }): { event: WorkTrigger; matcher: Record<string, unknown> } {
  const base = { name: input.name.trim(), actions: [input.action] }
  if (input.when === 'weekly' || input.when === 'daily' || input.when === 'custom') return { event: 'SchedulerTick', matcher: { ...base, cron: input.cron.trim(), timezone: input.timezone.trim() || 'UTC' } }
  if (input.when === 'file') return { event: 'FileWatch', matcher: { ...base, watchPath: input.watchPath.trim(), watchGlob: input.watchGlob.trim(), watchChangeTypes: ['add', 'change'], watchDebounceMs: 500 } }
  if (input.when === 'webhook') return { event: 'WebhookReceive', matcher: { ...base, slug: input.webhookSlug, secretEnv: input.secretEnv, allowedMethods: ['POST'] } }
  if (input.when === 'url') return { event: 'PollUrl', matcher: { ...base, pollUrl: input.pollUrl.trim(), pollIntervalSec: input.pollIntervalSec, pollMethod: 'GET', pollFingerprint: 'body' } }
  return { event: 'MessageReceive', matcher: { ...base, matcher: input.messageMatcher.trim() || undefined } }
}

function todayKey(): string { const now = new Date(); return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-') }
function formatLocalDateTime(date: string, time: string): string { const value = new Date(`${date}T${time}:00`); return Number.isNaN(value.getTime()) ? 'the selected time' : `${value.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at ${value.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` }
function localTimezone(): string { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' }
