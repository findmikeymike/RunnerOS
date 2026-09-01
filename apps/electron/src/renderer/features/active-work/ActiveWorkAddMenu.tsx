import * as React from 'react'
import { Bot, CalendarClock, ChevronRight, Plus, Repeat2, Sparkles, Workflow } from 'lucide-react'
import { toast } from 'sonner'
import { AutomationWorkDialog } from '@/components/automations/AutomationWorkDialog'
import { TemplatesGalleryDialog } from '@/components/automations/TemplatesGalleryDialog'
import { ScheduledWorkComposer, type ScheduledWorkComposerEntry } from '@/components/calendar/ScheduledWorkComposer'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useActiveWorkspace, useAppShellContext } from '@/context/AppShellContext'
import { isArtistHQWorkspace } from '@/lib/artist-workspace'
import { navigate, routes } from '@/lib/navigate'
import {
  buildCampaignSchedulePlanFromComposer,
  buildHqSchedulePlanFromComposer,
  type ScheduledWorkComposerDraft,
  type ScheduledWorkComposerType,
} from '@/lib/scheduled-work-composer'

function todayKey(): string {
  const now = new Date()
  return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-')
}

export function allowedScheduleTypes(isHq: boolean): ScheduledWorkComposerType[] {
  return isHq
    ? ['agent-task', 'workflow-run']
    : ['agent-task', 'workflow-run', 'review', 'social-publish']
}

export function ActiveWorkAddMenu() {
  const workspace = useActiveWorkspace()
  const { workspaces } = useAppShellContext()
  const [runNowOpen, setRunNowOpen] = React.useState(false)
  const [scheduleOpen, setScheduleOpen] = React.useState(false)
  const [automationOpen, setAutomationOpen] = React.useState(false)
  const [templatesOpen, setTemplatesOpen] = React.useState(false)
  const isHq = isArtistHQWorkspace(workspace ?? undefined, workspaces)

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

  const chooseRunNow = React.useCallback((target: 'worker' | 'workflow') => {
    setRunNowOpen(false)
    navigate(target === 'worker' ? routes.view.agents() : routes.view.workflows())
  }, [])

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="inline-flex h-8 items-center gap-1.5 rounded-[8px] bg-white/[0.06] px-3 text-[10.5px] font-medium text-white/64 hover:bg-white/[0.09] hover:text-white/86">
            <Plus className="h-3 w-3" />
            Add
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onSelect={() => setRunNowOpen(true)}>
            <Bot className="h-3.5 w-3.5" /> Run now
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setScheduleOpen(true)} disabled={!entry}>
            <CalendarClock className="h-3.5 w-3.5" /> Schedule once
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setAutomationOpen(true)} disabled={!entry}>
            <Repeat2 className="h-3.5 w-3.5" /> New automation
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setTemplatesOpen(true)} disabled={!entry}>
            <Sparkles className="h-3.5 w-3.5" /> Browse templates
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={runNowOpen} onOpenChange={setRunNowOpen}>
        <DialogContent className="w-[min(440px,calc(100vw-24px))] max-w-none border-white/[0.08] bg-[#090909] p-0 text-white">
          <DialogHeader className="border-b border-white/[0.07] px-5 py-4 pr-12">
            <DialogTitle className="text-base">Run now</DialogTitle>
            <DialogDescription>Choose the kind of work. You will pick the exact worker or workflow next.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 p-4">
            <RunChoice icon={Bot} title="Worker" description="Start a focused chat with one specialist" onClick={() => chooseRunNow('worker')} />
            <RunChoice icon={Workflow} title="Workflow" description="Launch a chain of specialists" onClick={() => chooseRunNow('workflow')} />
          </div>
        </DialogContent>
      </Dialog>

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

function RunChoice({
  icon: Icon,
  title,
  description,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  description: string
  onClick: () => void
}) {
  return (
    <button type="button" onClick={onClick} className="group flex w-full items-center gap-3 rounded-[10px] bg-white/[0.04] px-3 py-3 text-left hover:bg-white/[0.07]">
      <span className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-white/[0.06] text-white/54">
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px] font-medium text-white/82">{title}</span>
        <span className="mt-0.5 block text-[10.5px] text-white/38">{description}</span>
      </span>
      <ChevronRight className="h-3.5 w-3.5 text-white/26 group-hover:text-white/52" />
    </button>
  )
}
