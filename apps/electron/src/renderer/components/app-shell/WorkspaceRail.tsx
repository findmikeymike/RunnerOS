import * as React from "react"
import { useCallback, useEffect, useRef, useState } from "react"
import { AnimatePresence } from "motion/react"
import { Check, ChevronDown, Cloud, CloudOff, Disc3, FlaskConical, FolderPlus, Home, Plus } from "lucide-react"
import { Tooltip, TooltipTrigger, TooltipContent } from "@craft-agent/ui"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
  StyledDropdownMenuSeparator,
} from "@/components/ui/styled-dropdown"
import { toast } from "sonner"
import { useSetAtom } from "jotai"
import { useTranslation } from "react-i18next"

import { cn } from "@/lib/utils"
import { fullscreenOverlayOpenAtom } from "@/atoms/overlay"
import { CrossfadeAvatar } from "@/components/ui/avatar"
import { WorkspaceCreationScreen } from "@/components/workspace"
import { waitForTransportConnected } from "@/lib/transport-wait"
import { useWorkspaceIcons } from "@/hooks/useWorkspaceIcon"
import { useTransportConnectionState } from "@/hooks/useTransportConnectionState"
import { navigate, routes } from "@/lib/navigate"
import { isArtistHQWorkspace, isLabWorkspace } from "@/lib/artist-workspace"
import type { Workspace } from "../../../shared/types"

interface WorkspaceRailProps {
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  onSelect: (workspaceId: string, openInNewWindow?: boolean) => void | Promise<void>
  onWorkspaceCreated?: (workspace: Workspace) => void
  workspaceUnreadMap?: Record<string, boolean>
  orientation?: 'horizontal' | 'vertical'
}

export function WorkspaceRail({
  workspaces,
  activeWorkspaceId,
  onSelect,
  onWorkspaceCreated,
  workspaceUnreadMap,
  orientation = 'vertical',
}: WorkspaceRailProps) {
  const { t } = useTranslation()
  const [showCreationScreen, setShowCreationScreen] = useState(false)
  const [creationStep, setCreationStep] = useState<'choice' | 'create' | 'open'>('choice')
  const [creationName, setCreationName] = useState('')
  const [creationKind, setCreationKind] = useState<'campaign' | 'lab' | null>(null)
  const [isCreatingLab, setIsCreatingLab] = useState(false)
  const [reconnectTarget, setReconnectTarget] = useState<Workspace | null>(null)
  const [remoteHealthMap, setRemoteHealthMap] = useState<Map<string, 'ok' | 'error' | 'checking'>>(new Map())
  const healthCheckAbort = useRef<AbortController | null>(null)
  const setFullscreenOverlayOpen = useSetAtom(fullscreenOverlayOpenAtom)
  const workspaceIconMap = useWorkspaceIcons(workspaces)
  const connectionState = useTransportConnectionState()
  const isRemote = connectionState?.mode === 'remote'
  const hqWorkspace = workspaces.find((workspace) => isArtistHQWorkspace(workspace, workspaces))
  const labWorkspaces = workspaces.filter((workspace) => isLabWorkspace(workspace, workspaces))
  const labWorkspace = labWorkspaces[0]
  const campaignWorkspaces = workspaces.filter((workspace) => (
    !isArtistHQWorkspace(workspace, workspaces)
    && !isLabWorkspace(workspace, workspaces)
  ))

  const checkRemoteHealth = useCallback(() => {
    healthCheckAbort.current?.abort()
    const abort = new AbortController()
    healthCheckAbort.current = abort

    const remoteWorkspaces = workspaces.filter(w => w.remoteServer && w.id !== activeWorkspaceId)
    if (remoteWorkspaces.length === 0) return

    setRemoteHealthMap(prev => {
      const next = new Map(prev)
      for (const ws of remoteWorkspaces) next.set(ws.id, 'checking')
      return next
    })

    for (const ws of remoteWorkspaces) {
      window.electronAPI.testRemoteConnection(ws.remoteServer!.url, ws.remoteServer!.token)
        .then(result => {
          if (abort.signal.aborted) return
          setRemoteHealthMap(prev => new Map(prev).set(ws.id, result.ok ? 'ok' : 'error'))
        })
        .catch(() => {
          if (abort.signal.aborted) return
          setRemoteHealthMap(prev => new Map(prev).set(ws.id, 'error'))
        })
    }
  }, [activeWorkspaceId, workspaces])

  useEffect(() => {
    checkRemoteHealth()
    return () => healthCheckAbort.current?.abort()
  }, [checkRemoteHealth])

  const getDisconnectTooltip = (workspaceId: string): string => {
    if (workspaceId === activeWorkspaceId && connectionState?.lastError) {
      const { kind } = connectionState.lastError
      if (kind === 'auth') return t('toast.authenticationFailed')
      if (kind === 'timeout') return t('toast.serverUnreachable')
      if (kind === 'network') return t('toast.serverUnreachable')
    }
    return t('toast.disconnected')
  }

  const isRemoteDisconnected = useCallback((workspaceId: string) => {
    if (workspaceId === activeWorkspaceId) {
      if (!isRemote || !connectionState) return false
      const { status } = connectionState
      return status !== 'connected' && status !== 'connecting' && status !== 'idle'
    }
    return remoteHealthMap.get(workspaceId) === 'error'
  }, [activeWorkspaceId, connectionState, isRemote, remoteHealthMap])

  const openWorkspaceCreation = (step: 'choice' | 'create' | 'open', initialName = '', kind: 'campaign' | 'lab' | null = null) => {
    setCreationStep(step)
    setCreationName(initialName)
    setCreationKind(kind)
    setShowCreationScreen(true)
    setFullscreenOverlayOpen(true)
  }

  const handleNewCampaign = () => openWorkspaceCreation('create', 'New Campaign', 'campaign')
  const handleCloseCreationScreen = useCallback(() => {
    setShowCreationScreen(false)
    setReconnectTarget(null)
    setCreationName('')
    setCreationKind(null)
    setFullscreenOverlayOpen(false)
  }, [setFullscreenOverlayOpen])

  const handleWorkspaceCreated = (workspace: Workspace) => {
    setShowCreationScreen(false)
    setFullscreenOverlayOpen(false)
    toast.success(t('toast.createdWorkspace', { name: workspace.name }))
    onWorkspaceCreated?.(workspace)
    void Promise.resolve(onSelect(workspace.id)).then(() => {
      if (creationKind === 'lab') {
        navigate(routes.view.lab())
      } else if (creationKind === 'campaign') {
        navigate(routes.view.campaign())
      }
      setCreationKind(null)
      setCreationName('')
    })
  }

  const handleNewLab = useCallback(async () => {
    if (labWorkspace) {
      await Promise.resolve(onSelect(labWorkspace.id))
      navigate(routes.view.lab())
      return
    }

    setIsCreatingLab(true)
    try {
      const { path: folderPath } = await window.electronAPI.checkWorkspaceSlug('creative-lab')
      const workspace = await window.electronAPI.createWorkspace(folderPath, 'Creative Lab', undefined, 'lab')
      toast.success(t('toast.createdWorkspace', { name: workspace.name }))
      onWorkspaceCreated?.(workspace)
      await Promise.resolve(onSelect(workspace.id))
      navigate(routes.view.lab())
    } catch (error) {
      toast.error(t('toast.failedToCreateWorkspace'), {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    } finally {
      setIsCreatingLab(false)
    }
  }, [labWorkspace, onSelect, onWorkspaceCreated, t])

  const handleReconnectWorkspace = useCallback(async (workspaceId: string, remoteServer: { url: string; token: string; remoteWorkspaceId: string }) => {
    await window.electronAPI.updateWorkspaceRemoteServer(workspaceId, remoteServer)

    if (workspaceId === activeWorkspaceId) {
      await window.electronAPI.reconnectTransport()
      await waitForTransportConnected(window.electronAPI)
    } else {
      await Promise.resolve(onSelect(workspaceId))
      await waitForTransportConnected(window.electronAPI)
    }

    handleCloseCreationScreen()
    toast.success(t('toast.workspaceReconnected'))
  }, [activeWorkspaceId, handleCloseCreationScreen, onSelect, t])

  const handleWorkspaceSelect = useCallback(async (workspace: Workspace, openInNewWindow = false) => {
    const disconnected = isRemoteDisconnected(workspace.id)
    if (disconnected && workspace.remoteServer) {
      setReconnectTarget(workspace)
      setShowCreationScreen(true)
      setFullscreenOverlayOpen(true)
      return
    }
    if (disconnected) return
    await Promise.resolve(onSelect(workspace.id, openInNewWindow))

    if (orientation !== 'horizontal' || openInNewWindow) return
    if (window.location.hash.startsWith('#artist-hq/')) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
    }
    if (isArtistHQWorkspace(workspace, workspaces)) {
      navigate(routes.view.allSessions(), { skipAutoSelect: true })
    } else if (isLabWorkspace(workspace, workspaces)) {
      navigate(routes.view.lab())
    } else {
      navigate(routes.view.campaign())
    }
  }, [isRemoteDisconnected, onSelect, orientation, setFullscreenOverlayOpen, workspaces])

  const renderWorkspaceButton = (workspace: Workspace, variant: 'workspace' | 'home' | 'lab' = 'workspace') => {
    const active = workspace.id === activeWorkspaceId
    const disconnected = isRemoteDisconnected(workspace.id)
    const unread = workspaceUnreadMap?.[workspace.id]
    const label = variant === 'home' ? 'Artist HQ' : workspace.name

    return (
      <Tooltip key={workspace.id}>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={(e) => void handleWorkspaceSelect(workspace, e.metaKey || e.ctrlKey)}
            className={cn(
              "group relative flex h-8 w-8 items-center justify-center rounded-[10px] border transition-all duration-200",
              variant === 'home'
                ? active
                  ? "border-[#fb923c]/70 bg-white text-black"
                  : "border-white bg-white text-black hover:border-white/80 hover:bg-white/90"
                : active
                  ? "border-[#fb923c]/70 bg-transparent text-white"
                  : "border-white/[0.08] bg-transparent text-white/42 hover:border-white/16 hover:bg-white/[0.035] hover:text-white/75",
              disconnected && "opacity-55",
            )}
            aria-current={active ? "page" : undefined}
            aria-label={`Switch to ${label}`}
          >
            {variant === 'home' ? (
              <Home className="h-4 w-4 text-black" strokeWidth={2} />
            ) : variant === 'lab' ? (
              <FlaskConical className="h-4 w-4 text-[#fdba74]" />
            ) : (
              <CrossfadeAvatar
                src={workspaceIconMap.get(workspace.id)}
                alt={workspace.name}
                className="h-5 w-5 rounded-[7px]"
                fallbackClassName={cn(
                  "text-[10px] rounded-[7px]",
                  active ? "bg-transparent text-white" : "bg-transparent text-white/55",
                )}
                fallback={workspace.name.charAt(0)}
              />
            )}
            {unread && (
              <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border border-[#050507] bg-[#fb923c]" />
            )}
            {workspace.remoteServer && (
              <span
                title={disconnected ? getDisconnectTooltip(workspace.id) : undefined}
                className={cn(
                  "absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-[5px] border border-background",
                  active ? "bg-background text-foreground" : "bg-muted text-muted-foreground",
                )}
              >
                {disconnected ? <CloudOff className="h-2.5 w-2.5 text-destructive" /> : <Cloud className="h-2.5 w-2.5" />}
              </span>
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side={orientation === 'horizontal' ? 'bottom' : 'right'}>{label}</TooltipContent>
      </Tooltip>
    )
  }

  const addWorkspaceMenu = (side: 'top' | 'bottom') => (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border border-white/[0.08] bg-transparent text-white/38 transition-colors hover:border-white/16 hover:bg-white/[0.035] hover:text-white/75"
              aria-label={t("workspace.addWorkspace")}
            >
              {orientation === 'horizontal'
                ? <Plus className="h-3.5 w-3.5" />
                : <FolderPlus className="h-3.5 w-3.5" />}
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side={orientation === 'horizontal' ? 'bottom' : 'right'}>
          {t("workspace.addWorkspace")}
        </TooltipContent>
      </Tooltip>
      <StyledDropdownMenuContent side={side} align="start" sideOffset={8} minWidth="min-w-44">
        <StyledDropdownMenuItem onClick={handleNewCampaign}>
          <Disc3 className="h-3.5 w-3.5" />
          New Campaign
        </StyledDropdownMenuItem>
        {!labWorkspace && (
          <StyledDropdownMenuItem onClick={() => void handleNewLab()} disabled={isCreatingLab}>
            <FlaskConical className="h-3.5 w-3.5" />
            {isCreatingLab ? 'Creating Creative Lab…' : 'Add Creative Lab'}
          </StyledDropdownMenuItem>
        )}
      </StyledDropdownMenuContent>
    </DropdownMenu>
  )

  return (
    <>
      <AnimatePresence>
        {showCreationScreen && (
          <WorkspaceCreationScreen
            onWorkspaceCreated={handleWorkspaceCreated}
            onClose={handleCloseCreationScreen}
            initialStep={reconnectTarget ? undefined : creationStep}
            initialName={creationName}
            initialPurpose={creationKind ?? undefined}
            reconnectWorkspace={reconnectTarget ?? undefined}
            onReconnectWorkspace={handleReconnectWorkspace}
          />
        )}
      </AnimatePresence>

      {orientation === 'horizontal' ? (
        <nav
          className="titlebar-no-drag flex min-w-0 items-center"
          aria-label="Places"
        >
          <div
            data-testid="artist-place-switcher"
            className="artist-os-workspace-switcher flex h-8 shrink-0 items-center rounded-[11px] border border-white/[0.10] p-0.5"
          >
            {hqWorkspace ? (
              <button
                type="button"
                onClick={(event) => void handleWorkspaceSelect(hqWorkspace, event.metaKey || event.ctrlKey)}
                aria-current={hqWorkspace.id === activeWorkspaceId ? 'page' : undefined}
                className={cn(
                  'flex h-7 items-center gap-1.5 rounded-[8px] px-2.5 text-[11px] font-medium transition-colors',
                  hqWorkspace.id === activeWorkspaceId
                    ? 'bg-white/[0.12] text-white'
                    : 'text-white/52 hover:bg-white/[0.055] hover:text-white/88',
                )}
              >
                <Home className="h-3.5 w-3.5" strokeWidth={1.8} />
                <span>HQ</span>
              </button>
            ) : null}

            <span className="mx-0.5 h-4 w-px bg-white/[0.09]" aria-hidden="true" />

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-current={campaignWorkspaces.some((workspace) => workspace.id === activeWorkspaceId) ? 'page' : undefined}
                  className={cn(
                    'relative flex h-7 items-center gap-1.5 rounded-[8px] px-2.5 text-[11px] font-medium transition-colors',
                    campaignWorkspaces.some((workspace) => workspace.id === activeWorkspaceId)
                      ? 'bg-white/[0.12] text-white'
                      : 'text-white/52 hover:bg-white/[0.055] hover:text-white/88',
                  )}
                >
                  <Disc3 className="h-3.5 w-3.5" strokeWidth={1.8} />
                  <span>Campaigns</span>
                  <ChevronDown className="h-3 w-3 text-white/40" strokeWidth={1.8} />
                  {campaignWorkspaces.some((workspace) => workspaceUnreadMap?.[workspace.id]) ? (
                    <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-[#fb923c]" />
                  ) : null}
                </button>
              </DropdownMenuTrigger>
              <StyledDropdownMenuContent side="bottom" align="start" sideOffset={8} minWidth="min-w-52">
                {campaignWorkspaces.map((workspace) => {
                  const active = workspace.id === activeWorkspaceId
                  const disconnected = isRemoteDisconnected(workspace.id)
                  return (
                    <StyledDropdownMenuItem
                      key={workspace.id}
                      onClick={() => void handleWorkspaceSelect(workspace)}
                      className="gap-2"
                    >
                      {disconnected
                        ? <CloudOff className="h-3.5 w-3.5 text-white/38" />
                        : <Disc3 className="h-3.5 w-3.5 text-white/48" />}
                      <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
                      {workspaceUnreadMap?.[workspace.id] ? <span className="h-1.5 w-1.5 rounded-full bg-[#fb923c]" /> : null}
                      {active ? <Check className="h-3.5 w-3.5 text-white/70" /> : null}
                    </StyledDropdownMenuItem>
                  )
                })}
                {campaignWorkspaces.length > 0 ? <StyledDropdownMenuSeparator /> : null}
                <StyledDropdownMenuItem onClick={handleNewCampaign}>
                  <Plus className="h-3.5 w-3.5" />
                  New Campaign
                </StyledDropdownMenuItem>
              </StyledDropdownMenuContent>
            </DropdownMenu>

            <span className="mx-0.5 h-4 w-px bg-white/[0.09]" aria-hidden="true" />

            <button
              type="button"
              onClick={(event) => {
                if (labWorkspace) {
                  void handleWorkspaceSelect(labWorkspace, event.metaKey || event.ctrlKey)
                } else {
                  void handleNewLab()
                }
              }}
              disabled={isCreatingLab}
              aria-current={labWorkspace?.id === activeWorkspaceId ? 'page' : undefined}
              className={cn(
                'relative flex h-7 items-center gap-1.5 rounded-[8px] px-2.5 text-[11px] font-medium transition-colors disabled:opacity-45',
                labWorkspace?.id === activeWorkspaceId
                  ? 'bg-white/[0.12] text-white'
                  : 'text-white/52 hover:bg-white/[0.055] hover:text-white/88',
              )}
            >
              <FlaskConical className="h-3.5 w-3.5 text-[#fdba74]" strokeWidth={1.8} />
              <span>{isCreatingLab ? 'Creating…' : 'Lab'}</span>
              {labWorkspace && workspaceUnreadMap?.[labWorkspace.id] ? (
                <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-[#fb923c]" />
              ) : null}
            </button>
          </div>
        </nav>
      ) : (
        <aside className="titlebar-no-drag -mb-16 flex h-[calc(100%+64px)] w-[56px] shrink-0 flex-col items-center justify-end">
          <div className="runneros-workspace-dock flex max-h-full min-h-0 flex-col items-center gap-1.5 overflow-y-auto px-1.5 pb-2.5 pt-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {hqWorkspace ? renderWorkspaceButton(hqWorkspace, 'home') : null}
            {campaignWorkspaces.map((workspace) => renderWorkspaceButton(workspace))}
            {labWorkspace ? renderWorkspaceButton(labWorkspace, 'lab') : null}
          </div>
          {addWorkspaceMenu('top')}
        </aside>
      )}
    </>
  )
}
