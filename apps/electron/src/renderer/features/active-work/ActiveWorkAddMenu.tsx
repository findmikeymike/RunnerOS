import * as React from 'react'
import { Bot, CalendarClock, Plus, Repeat2, Search, Sparkles, Workflow } from 'lucide-react'
import { toast } from 'sonner'
import { CONCIERGE_SLUG, ORCHESTRATOR_SLUG } from '@craft-agent/shared/agent-definitions/types'
import { AutomationWorkDialog } from '@/components/automations/AutomationWorkDialog'
import { TemplatesGalleryDialog } from '@/components/automations/TemplatesGalleryDialog'
import { ScheduledWorkComposer, type ScheduledWorkComposerEntry } from '@/components/calendar/ScheduledWorkComposer'
import { WorkflowLaunchDialog } from '@/components/workflows/WorkflowLaunchDialog'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useActiveWorkspace, useAppShellContext } from '@/context/AppShellContext'
import { useWorkflows } from '@/hooks/useWorkflows'
import { isArtistHQWorkspace } from '@/lib/artist-workspace'
import { openAgentSessionComposer } from '@/lib/run-agent'
import {
  buildCampaignSchedulePlanFromComposer,
  buildHqSchedulePlanFromComposer,
  type ScheduledWorkComposerDraft,
  type ScheduledWorkComposerType,
} from '@/lib/scheduled-work-composer'
import type { AgentDefinitionDTO, WorkflowDTO } from '../../../shared/types'

const HIDDEN_RUN_NOW_WORKERS = new Set([
  CONCIERGE_SLUG,
  ORCHESTRATOR_SLUG,
  '3d-agent',
  'hypermotion-agent',
  'lottie-animation-agent',
  'open-slide-agent',
  'researcher',
])

function todayKey(): string {
  const now = new Date()
  return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-')
}

export function allowedScheduleTypes(isHq: boolean): ScheduledWorkComposerType[] {
  return isHq
    ? ['agent-task', 'workflow-run']
    : ['agent-task', 'workflow-run', 'review', 'social-publish']
}

export function matchesRunNowQuery(name: string, description: string | undefined, query: string): boolean {
  const normalized = query.trim().toLowerCase()
  return !normalized || `${name} ${description ?? ''}`.toLowerCase().includes(normalized)
}

export function ActiveWorkAddMenu({ label = 'Add', prominent = false, hideAutomation = false }: { label?: string; prominent?: boolean; hideAutomation?: boolean }) {
  const workspace = useActiveWorkspace()
  const {
    workspaces,
    activeAgents = [],
    enabledSources = [],
    skills = [],
    onCreateSession,
    onInputChange,
  } = useAppShellContext()
  const { activeWorkflows, loading: workflowsLoading } = useWorkflows(workspace?.id)
  const [runNowOpen, setRunNowOpen] = React.useState(false)
  const [runNowKind, setRunNowKind] = React.useState<'workers' | 'workflows'>('workers')
  const [runNowQuery, setRunNowQuery] = React.useState('')
  const [launchingWorker, setLaunchingWorker] = React.useState<string | null>(null)
  const [launchWorkflow, setLaunchWorkflow] = React.useState<WorkflowDTO | null>(null)
  const [scheduleOpen, setScheduleOpen] = React.useState(false)
  const [automationOpen, setAutomationOpen] = React.useState(false)
  const [templatesOpen, setTemplatesOpen] = React.useState(false)
  const isHq = isArtistHQWorkspace(workspace ?? undefined, workspaces)
  const workers = React.useMemo(() => activeAgents
    .filter((agent) => !HIDDEN_RUN_NOW_WORKERS.has(agent.slug))
    .filter((agent) => matchesRunNowQuery(agent.metadata.name, agent.metadata.description, runNowQuery))
    .sort((a, b) => a.metadata.name.localeCompare(b.metadata.name)), [activeAgents, runNowQuery])
  const workflows = React.useMemo(() => activeWorkflows
    .filter((workflow) => matchesRunNowQuery(workflow.metadata.name, workflow.metadata.description, runNowQuery)), [activeWorkflows, runNowQuery])

  const entry = React.useMemo<ScheduledWorkComposerEntry | null>(() => {
    if (!workspace) return null
    return {
      owner: isHq
        ? { scope: 'hq', workspaceId: workspace.id }
        : { scope: 'campaign', workspaceId: workspace.id, campaignId: workspace.id },
      date: todayKey(),
      mode: 'job',
    }
  }, [isHq, workspace])

  const submitScheduledWork = React.useCallback(async (draft: ScheduledWorkComposerDraft) => {
    if (!workspace || draft.type === 'event') return
    if (draft.owner.scope === 'hq') {
      await window.electronAPI.scheduleHqWork(workspace.id, buildHqSchedulePlanFromComposer(draft))
    } else {
      const plan = buildCampaignSchedulePlanFromComposer(draft)
      if (draft.type === 'social-publish' && !('orders' in plan)) {
        await window.electronAPI.authorizeReleaseKitSocial(workspace.id, {
          requestId: draft.requestId,
          releaseKitItemId: plan.order.inputRefs[0]?.kind === 'release-kit' ? plan.order.inputRefs[0].itemId : '',
          title: plan.order.title,
          platform: draft.platform,
          profileId: draft.profileId,
          accountSetId: draft.accountSetId || undefined,
          caption: draft.caption,
          platformOptions: draft.platformOptions,
          startAt: plan.order.startAt,
          timezone: draft.timezone,
          source: 'calendar-ui',
        })
      } else if ('orders' in plan) {
        await window.electronAPI.scheduleCampaignWorkChain(workspace.id, plan)
      } else {
        await window.electronAPI.scheduleCampaignWork(workspace.id, plan)
      }
    }
    toast.success(`${draft.title} scheduled`)
  }, [workspace])

  const startWorker = React.useCallback(async (agent: AgentDefinitionDTO) => {
    if (!workspace || launchingWorker) return
    setLaunchingWorker(agent.slug)
    try {
      const contextDocs = await window.electronAPI
        .listWorkspaceContextDocsForAgent(workspace.id, agent.slug)
        .catch(() => [])
      await openAgentSessionComposer({
        agent,
        workspaceId: workspace.id,
        onCreateSession,
        onInputChange,
        skills,
        sources: enabledSources,
        contextDocs,
      })
      setRunNowOpen(false)
    } catch (error) {
      toast.error('Failed to start worker chat', {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setLaunchingWorker(null)
    }
  }, [enabledSources, launchingWorker, onCreateSession, onInputChange, skills, workspace])

  React.useEffect(() => {
    if (!runNowOpen) return
    setRunNowKind('workers')
    setRunNowQuery('')
  }, [runNowOpen])

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className={prominent
            ? 'inline-flex h-9 items-center gap-1.5 rounded-[9px] bg-gradient-to-r from-[#f97316] to-[#ef3e16] px-4 text-[11px] font-semibold text-white shadow-minimal hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-200/55'
            : 'inline-flex h-8 items-center gap-1.5 rounded-[8px] bg-white/[0.06] px-3 text-[10.5px] font-medium text-white/64 hover:bg-white/[0.09] hover:text-white/86 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/35'}>
            <Plus className="h-3 w-3" />
            {label}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onSelect={() => setRunNowOpen(true)}>
            <Bot className="h-3.5 w-3.5" /> Run now
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setScheduleOpen(true)} disabled={!entry}>
            <CalendarClock className="h-3.5 w-3.5" /> Schedule once
          </DropdownMenuItem>
          {!hideAutomation ? (
            <DropdownMenuItem onSelect={() => setAutomationOpen(true)} disabled={!entry}>
              <Repeat2 className="h-3.5 w-3.5" /> New automation
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onSelect={() => setTemplatesOpen(true)} disabled={!entry}>
            <Sparkles className="h-3.5 w-3.5" /> Browse templates
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={runNowOpen} onOpenChange={setRunNowOpen}>
        <DialogContent className="max-h-[calc(100dvh-24px)] w-[min(440px,calc(100vw-24px))] max-w-none overflow-hidden border-white/[0.08] bg-[#090909] p-0 text-white">
          <DialogHeader className="border-b border-white/[0.07] px-5 py-4 pr-12">
            <DialogTitle className="text-base">Run now</DialogTitle>
            <DialogDescription>Choose a specialist or workflow and start directly.</DialogDescription>
          </DialogHeader>
          <div className="p-4">
            <div className="mb-3 inline-flex rounded-[9px] bg-white/[0.035] p-1" role="tablist" aria-label="Run now type">
              {(['workers', 'workflows'] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  role="tab"
                  aria-selected={runNowKind === kind}
                  onClick={() => setRunNowKind(kind)}
                  className={`rounded-[7px] px-3 py-1.5 text-[11px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/35 ${runNowKind === kind ? 'bg-white/[0.10] text-white/86' : 'text-white/40 hover:text-white/68'}`}
                >
                  {kind === 'workers' ? 'Workers' : 'Workflows'}
                </button>
              ))}
            </div>
            <label className="relative mb-3 block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/28" />
              <span className="sr-only">Search {runNowKind}</span>
              <input
                key={runNowKind}
                autoFocus
                value={runNowQuery}
                onChange={(event) => setRunNowQuery(event.target.value)}
                placeholder={`Search ${runNowKind}`}
                aria-label={`Search ${runNowKind}`}
                className="h-9 w-full rounded-[8px] border border-white/[0.07] bg-white/[0.025] pl-9 pr-3 text-xs text-white/78 outline-none placeholder:text-white/26 focus:border-orange-300/30"
              />
            </label>
            <div className="space-y-1 overflow-y-auto pr-1" style={{ maxHeight: 340 }}>
              {runNowKind === 'workers' ? workers.map((agent) => (
                <RunNowResult
                  key={agent.slug}
                  icon={Bot}
                  title={agent.metadata.name}
                  description={agent.metadata.description}
                  busy={launchingWorker === agent.slug}
                  onClick={() => void startWorker(agent)}
                />
              )) : workflows.map((workflow) => (
                <RunNowResult
                  key={workflow.slug}
                  icon={Workflow}
                  title={workflow.metadata.name}
                  description={workflow.metadata.description}
                  onClick={() => {
                    setRunNowOpen(false)
                    setLaunchWorkflow(workflow)
                  }}
                />
              ))}
              {(runNowKind === 'workers' ? workers.length === 0 : workflows.length === 0) ? (
                <p className="px-2 py-6 text-center text-[11px] text-white/34">
                  {runNowKind === 'workflows' && workflowsLoading ? 'Loading workflows…' : `No matching ${runNowKind}.`}
                </p>
              ) : null}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {workspace && launchWorkflow ? (
        <WorkflowLaunchDialog
          open
          onOpenChange={(nextOpen) => { if (!nextOpen) setLaunchWorkflow(null) }}
          workflow={launchWorkflow}
          workspaceId={workspace.id}
        />
      ) : null}

      {entry ? (
        <ScheduledWorkComposer
          open={scheduleOpen}
          onOpenChange={setScheduleOpen}
          entry={entry}
          allowedTypes={allowedScheduleTypes(isHq)}
          onSubmit={submitScheduledWork}
        />
      ) : null}
      <AutomationWorkDialog open={automationOpen} onOpenChange={setAutomationOpen} />
      <TemplatesGalleryDialog open={templatesOpen} onOpenChange={setTemplatesOpen} />
    </>
  )
}

function RunNowResult({
  icon: Icon,
  title,
  description,
  onClick,
  busy = false,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  description: string
  onClick: () => void
  busy?: boolean
}) {
  return (
    <button type="button" onClick={onClick} disabled={busy} className="group flex w-full items-start gap-3 rounded-[9px] bg-white/[0.03] px-3 py-2.5 text-left hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/35 disabled:cursor-wait disabled:opacity-55">
      <span className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-white/[0.06] text-white/54">
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12px] font-medium text-white/82">{busy ? `Opening ${title}…` : title}</span>
        <span className="mt-0.5 block text-[10.5px] leading-4 text-white/38">{description}</span>
      </span>
    </button>
  )
}
