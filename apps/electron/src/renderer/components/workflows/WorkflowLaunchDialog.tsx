import * as React from 'react'
import { Sparkles, SlidersHorizontal } from 'lucide-react'
import { toast } from 'sonner'
import { CONCIERGE_SLUG } from '@craft-agent/shared/agent-definitions/types'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useAppShellContext } from '@/context/AppShellContext'
import { isArtistHQWorkspace } from '@/lib/artist-workspace'
import { openAgentSessionComposer } from '@/lib/run-agent'
import { buildWorkflowLaunchContextDocs, createWorkflowSetupDraft, resolveWorkflowLaunchWorkspace } from '@/lib/workflow-launcher'
import { WorkflowRunInputDialog } from '@/pages/WorkflowRunInputDialog'
import type { WorkflowDTO, WorkflowRunDTO } from '../../../shared/types'

interface WorkflowLaunchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workflow: WorkflowDTO
  workspaceId: string
  initialInputs?: Record<string, unknown>
  onStarted?: (run: WorkflowRunDTO) => void | Promise<void>
  onManagerSessionStarted?: (sessionId: string) => void | Promise<void>
  contextHint?: string
}

export function WorkflowLaunchDialog({
  open,
  onOpenChange,
  workflow,
  workspaceId,
  initialInputs,
  onStarted,
  onManagerSessionStarted,
  contextHint,
}: WorkflowLaunchDialogProps) {
  const {
    activeAgents = [],
    enabledSources = [],
    skills = [],
    onCreateSession,
    onInputChange,
    onSendMessage,
    workspaces,
  } = useAppShellContext()
  const workspace = resolveWorkflowLaunchWorkspace(workspaces, workspaceId)
  const [mode, setMode] = React.useState<'choice' | 'manual'>('choice')
  const [openingManager, setOpeningManager] = React.useState(false)

  const workspaceKind = isArtistHQWorkspace(workspace ?? undefined, workspaces) ? 'hq' : 'campaign'
  const workspaceName = workspace?.name || 'this workspace'
  const seededInputNames = React.useMemo(
    () => Object.entries(initialInputs ?? {})
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([key]) => key),
    [initialInputs],
  )

  React.useEffect(() => {
    if (open) setMode('choice')
  }, [open, workflow.slug])

  const handleOpenManager = React.useCallback(async () => {
    if (openingManager) return
    setOpeningManager(true)
    let opened = false
    try {
      const manager = activeAgents.find((agent) => agent.slug === CONCIERGE_SLUG)
        ?? await window.electronAPI.getAgentDefinition(CONCIERGE_SLUG)
      if (!manager) throw new Error('Artist Manager is not installed')
      const contextDocs = await window.electronAPI
        .listWorkspaceContextDocsForAgent(workspaceId, manager.slug)
        .catch(() => [])
      const launchContext = buildWorkflowLaunchContextDocs(contextDocs, workflow, {
        workspaceKind,
        workspaceName,
        workspaceRootPath: workspace?.rootPath,
        seededInputNames,
        seededInputs: initialInputs,
        contextHint,
      })
      const session = await openAgentSessionComposer({
        agent: manager,
        workspaceId,
        onCreateSession,
        onInputChange,
        onSendMessage,
        autoSendDraft: true,
        skills,
        sources: enabledSources,
        contextDocs: launchContext,
        agentCatalog: activeAgents.filter((agent) => agent.slug !== manager.slug),
        draftInput: createWorkflowSetupDraft(workflow, { workspaceKind, workspaceName, seededInputNames, seededInputs: initialInputs, contextHint }),
      })
      await onManagerSessionStarted?.(session.id)
      opened = true
    } catch (error) {
      toast.error('Failed to open Artist Manager', {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setOpeningManager(false)
      if (opened) onOpenChange(false)
    }
  }, [
    activeAgents,
    enabledSources,
    onCreateSession,
    onInputChange,
    onManagerSessionStarted,
    onOpenChange,
    onSendMessage,
    openingManager,
    skills,
    seededInputNames,
    workflow,
    contextHint,
    initialInputs,
    workspace?.rootPath,
    workspaceId,
    workspaceKind,
    workspaceName,
  ])

  const handleManual = React.useCallback(() => {
    setMode('manual')
  }, [])

  return (
    <>
      <Dialog
        open={open && mode === 'choice'}
        onOpenChange={(nextOpen) => {
          if (nextOpen) return
          setMode('choice')
          onOpenChange(false)
        }}
      >
        <DialogContent className="w-[min(520px,calc(100vw-24px))] max-w-none border-white/[0.08] bg-[#090909] p-0 text-white">
          <DialogHeader className="border-b border-white/[0.07] px-5 py-4 pr-12">
            <DialogTitle className="text-base">Start {workflow.metadata.name}</DialogTitle>
            <DialogDescription>
              Choose guided setup if you want Artist Manager to help frame the goal, assets, and missing decisions first.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 p-4">
            <LaunchChoice
              icon={Sparkles}
              title="Set up with Artist Manager"
              description="Recommended. Talk through the goal, assets, and timing before you run anything."
              busy={openingManager}
              onClick={() => void handleOpenManager()}
            />
            <LaunchChoice
              icon={SlidersHorizontal}
              title="Manual setup"
              description="Fill in the workflow inputs yourself."
              onClick={handleManual}
            />
          </div>
        </DialogContent>
      </Dialog>

      <WorkflowRunInputDialog
        open={open && mode === 'manual'}
        onOpenChange={(nextOpen) => {
          if (nextOpen) return
          setMode('choice')
          onOpenChange(false)
        }}
        workflow={workflow}
        workspaceId={workspaceId}
        initialInputs={initialInputs}
        onStarted={onStarted}
      />
    </>
  )
}

function LaunchChoice({
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
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="w-full rounded-[12px] bg-white/[0.04] px-4 py-3 text-left transition-colors hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:opacity-60"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-[9px] bg-white/[0.06] text-white/62">
          <Icon className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[12.5px] font-medium text-white/84">{busy ? 'Opening Artist Manager…' : title}</span>
          <span className="mt-0.5 block text-[10.5px] leading-5 text-white/40">{description}</span>
        </span>
      </div>
    </button>
  )
}
