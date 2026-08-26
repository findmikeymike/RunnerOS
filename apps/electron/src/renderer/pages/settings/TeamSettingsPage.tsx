import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, RefreshCcw, Search, Trash2, Users } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Spinner } from '@craft-agent/ui'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { HeaderMenu } from '@/components/ui/HeaderMenu'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { SettingsCard, SettingsCardContent, SettingsSection } from '@/components/settings'
import { useAppShellContext } from '@/context/AppShellContext'
import { useDirectoryPicker } from '@/hooks/useDirectoryPicker'
import { useWorkspaceSyncRefresh } from '@/hooks/useWorkspaceSyncRefresh'
import { routes } from '@/lib/navigate'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import type { TeamModeStatus } from '../../../shared/types'
import type { SharedRecordConflict } from '@craft-agent/shared/records'
import { ServerDirectoryBrowser } from '@/components/ServerDirectoryBrowser'
import { PRODUCT_NAME } from '@/lib/product-identity'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'team',
}

function ValueRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3 text-[12px]">
      <div className="min-w-0 text-white/48">{label}</div>
      <div className="max-w-[55%] truncate font-mono text-white/72" title={value}>{value}</div>
    </div>
  )
}

export default function TeamSettingsPage() {
  const { t } = useTranslation()
  const { activeWorkspaceId, onRefreshWorkspaces } = useAppShellContext()
  const [status, setStatus] = useState<TeamModeStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [destinationParentPath, setDestinationParentPath] = useState('')
  const [pathOverrides, setPathOverrides] = useState<Record<string, string>>({})
  const [overrideRefId, setOverrideRefId] = useState('')
  const [overridePath, setOverridePath] = useState('')
  const [recordConflicts, setRecordConflicts] = useState<SharedRecordConflict[]>([])
  const [ownerRecoveryCode, setOwnerRecoveryCode] = useState('')
  const [newOwnerRecoveryCode, setNewOwnerRecoveryCode] = useState('')

  const loadStatus = useCallback(async (foreground = true) => {
    if (!activeWorkspaceId) {
      setStatus(null)
      setLoading(false)
      return
    }
    if (foreground) setLoading(true)
    try {
      const [nextStatus, nextOverrides] = await Promise.all([
        window.electronAPI.getWorkspaceTeamStatus(activeWorkspaceId),
        window.electronAPI.getWorkspaceTeamPathOverrides(activeWorkspaceId),
      ])
      // Status reconciliation can create provider conflict artifacts; list them afterward.
      const nextConflicts = await window.electronAPI.listRecordConflicts(activeWorkspaceId)
      setStatus(nextStatus)
      setPathOverrides(nextOverrides)
      setRecordConflicts(nextConflicts)
    } catch (error) {
      toast.error('Failed to load team settings', {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      if (foreground) setLoading(false)
    }
  }, [activeWorkspaceId])

  useEffect(() => {
    void loadStatus()
  }, [loadStatus])
  useWorkspaceSyncRefresh(activeWorkspaceId, ['workspace', 'team', 'records'], () => loadStatus(false))

  const enableTeamMode = async () => {
    if (!activeWorkspaceId) return
    setBusy(true)
    try {
      const next = await window.electronAPI.enableWorkspaceTeamMode(activeWorkspaceId, {
        provider: 'generic-folder',
        providerLabel: 'Shared folder',
      })
      setStatus(next)
      toast.success('Team metadata initialized')
    } catch (error) {
      toast.error('Failed to initialize team metadata', {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setBusy(false)
    }
  }

  const setMachineAsRunner = async (machineId?: string) => {
    if (!activeWorkspaceId) return
    setBusy(true)
    try {
      const next = await window.electronAPI.setWorkspaceTeamRunner(activeWorkspaceId, machineId)
      setStatus(next)
      toast.success(machineId && machineId !== next.machine.machineId ? 'Team runner handoff started' : 'This machine is now the team runner')
    } catch (error) {
      toast.error('Failed to set team runner', {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setBusy(false)
    }
  }

  const joinThisMachine = async () => {
    if (!activeWorkspaceId) return
    setBusy(true)
    try {
      const next = await window.electronAPI.joinWorkspaceTeam(activeWorkspaceId)
      setStatus(next)
      toast.success('This machine joined the team workspace')
    } catch (error) {
      toast.error('Failed to join team workspace', {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setBusy(false)
    }
  }

  const rotateOwnerRecoveryCode = async () => {
    if (!activeWorkspaceId) return
    setBusy(true)
    try {
      const result = await window.electronAPI.rotateWorkspaceOwnerRecoveryCode(activeWorkspaceId)
      setStatus(result.status)
      setNewOwnerRecoveryCode(result.recoveryCode)
      toast.success('New Owner transfer code created')
    } catch (error) {
      toast.error('Failed to create Owner transfer code', {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setBusy(false)
    }
  }

  const recoverOwnership = async () => {
    if (!activeWorkspaceId || !ownerRecoveryCode.trim()) return
    setBusy(true)
    try {
      const next = await window.electronAPI.recoverWorkspaceOwner(activeWorkspaceId, ownerRecoveryCode.trim())
      setStatus(next)
      setOwnerRecoveryCode('')
      toast.success('Owner transfer request submitted for approval')
    } catch (error) {
      toast.error('Failed to request workspace ownership transfer', {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setBusy(false)
    }
  }

  const approveOwnerRecovery = async (claimId: string) => {
    if (!activeWorkspaceId) return
    setBusy(true)
    try {
      setStatus(await window.electronAPI.approveWorkspaceOwnerRecovery(activeWorkspaceId, claimId))
      toast.success('Replacement machine approved as Owner')
    } catch (error) {
      toast.error('Failed to approve Owner transfer', {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setBusy(false)
    }
  }

  const savePathOverride = async () => {
    if (!activeWorkspaceId || !overrideRefId.trim() || !overridePath.trim()) return
    setBusy(true)
    try {
      const next = await window.electronAPI.setWorkspaceTeamPathOverride(activeWorkspaceId, overrideRefId.trim(), overridePath.trim())
      setPathOverrides(next)
      setOverrideRefId('')
      setOverridePath('')
      toast.success('Path override saved')
    } catch (error) {
      toast.error('Failed to save path override', {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setBusy(false)
    }
  }

  const clearPathOverride = async (refId: string) => {
    if (!activeWorkspaceId) return
    setBusy(true)
    try {
      setPathOverrides(await window.electronAPI.clearWorkspaceTeamPathOverride(activeWorkspaceId, refId))
      toast.success('Path override removed')
    } catch (error) {
      toast.error('Failed to remove path override', {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setBusy(false)
    }
  }

  const scanRecordConflicts = async () => {
    if (!activeWorkspaceId) return
    setBusy(true)
    try {
      const found = await window.electronAPI.scanRecordProviderConflicts(activeWorkspaceId)
      setRecordConflicts(await window.electronAPI.listRecordConflicts(activeWorkspaceId))
      toast.success(found.length ? `Found ${found.length} conflicted file${found.length === 1 ? '' : 's'}` : 'No conflicted files found')
    } catch (error) {
      toast.error('Failed to scan record conflicts', {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setBusy(false)
    }
  }

  const detectRecordClobbers = async () => {
    if (!activeWorkspaceId) return
    setBusy(true)
    try {
      const issues = await window.electronAPI.detectRecordClobbers(activeWorkspaceId)
      setRecordConflicts(await window.electronAPI.listRecordConflicts(activeWorkspaceId))
      toast.success(issues.length ? `Recovered ${issues.length} clobbered write${issues.length === 1 ? '' : 's'}` : 'No clobbered writes found')
    } catch (error) {
      toast.error('Failed to detect clobbered writes', {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setBusy(false)
    }
  }

  const unsupported = Boolean(status && !status.supported)
  const needsJoin = Boolean(status?.team.enabled && status.storage.mode === 'shared-folder' && !status.joined)
  const canManageTeam = Boolean(status?.canManageTeam)
  const canMakeRunner = Boolean(status?.team.enabled && status.storage.mode === 'shared-folder' && status.joined && canManageTeam)
  const wasMovedToSharedFolder = Boolean(status?.storage.mode === 'shared-folder' && status.storage.movedFrom)
  const runnerIsThisMachine = Boolean(status?.team.runnerMachineId && status.team.runnerMachineId === status.machine.machineId)
  const runnerHandoverPending = Boolean(status?.team.runnerHandover?.to && status.team.runnerHandover.to === status.machine.machineId)
  const roleLabel = status?.currentRole === 'owner'
    ? 'Owner'
    : status?.currentRole === 'editor'
      ? 'Editor'
      : status?.team.enabled
        ? 'Not joined'
        : 'Owner'
  const roleDetail = status?.currentRole === 'owner'
    ? 'Can manage team settings and runner'
    : status?.currentRole === 'editor'
      ? 'Can create and edit shared work'
      : status?.team.enabled
        ? 'Join this workspace to collaborate'
        : 'Solo workspace'
  const runnerStateLabel = !status?.team.runnerMachineId
    ? 'No runner assigned'
    : runnerHandoverPending
      ? 'Pending handover'
      : runnerIsThisMachine
      ? 'This machine'
      : status.runnerIsStale
        ? 'Stale on another machine'
        : 'Another machine'

  const moveToSharedFolder = async () => {
    if (!activeWorkspaceId || !destinationParentPath) return
    setBusy(true)
    try {
      const result = await window.electronAPI.moveWorkspaceToSharedFolder(activeWorkspaceId, {
        destinationParentPath,
        provider: 'generic-folder',
        providerLabel: 'Shared folder',
      })
      toast.success('Workspace moved to shared folder', {
        description: result.tombstoneWritten === false
          ? `Moved to ${result.finalRootPath}. Old-path marker failed: ${result.tombstoneError}`
          : result.finalRootPath,
      })
      await onRefreshWorkspaces?.()
      await loadStatus()
    } catch (error) {
      toast.error('Failed to move workspace', {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setBusy(false)
    }
  }

  const {
    pickDirectory,
    showServerBrowser,
    serverBrowserMode,
    cancelServerBrowser,
    confirmServerBrowser,
  } = useDirectoryPicker(setDestinationParentPath)

  return (
    <>
      <PanelHeader title={t('settings.team.title')} actions={<HeaderMenu route={routes.view.settings('team')} />} />
      <ScrollArea className="h-full">
        <div className="settings-content-scroll px-6 py-6">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Spinner className="text-muted-foreground" />
            </div>
          ) : (
            <div className="mx-auto max-w-[720px] space-y-6">
              {unsupported && status && (
                <SettingsCard>
                  <SettingsCardContent>
                    <div className="text-[13px] font-medium text-amber-200">Workspace format needs an app upgrade</div>
                    <div className="mt-1 text-[12px] leading-5 text-white/45">
                      This workspace uses format {status.formatVersion}. This app supports format {status.supportedFormatVersion}.
                    </div>
                  </SettingsCardContent>
                </SettingsCard>
              )}

              <SettingsSection
                title="Team mode"
                description={`Shared Folder Team Mode is for trusted collaborators. Folder access is the security boundary: collaborators can read shared data and edit files outside ${PRODUCT_NAME}.`}
                action={
                  <Button variant="ghost" size="sm" onClick={() => void loadStatus()} disabled={busy}>
                    <RefreshCcw className="mr-1.5 h-3.5 w-3.5" />
                    Refresh
                  </Button>
                }
              >
                <SettingsCard>
                  <SettingsCardContent>
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-white/[0.06] text-white/70">
                          {status?.team.enabled ? <CheckCircle2 className="h-4 w-4" /> : <Users className="h-4 w-4" />}
                        </div>
                        <div className="min-w-0">
                          <div className="text-[13px] font-medium text-white/82">
                            {status?.team.enabled ? 'Team metadata enabled' : 'Solo workspace'}
                          </div>
                          <div className="mt-0.5 text-[12px] text-white/40">
                            Storage mode: {status?.storage.mode ?? 'solo'}
                          </div>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {!status?.team.enabled && (
                          <Button size="sm" onClick={() => void enableTeamMode()} disabled={busy || unsupported}>
                            {busy ? <Spinner className="mr-1.5" /> : null}
                            Initialize
                          </Button>
                        )}
                        {needsJoin && (
                          <Button size="sm" onClick={() => void joinThisMachine()} disabled={busy || unsupported}>
                            {busy ? <Spinner className="mr-1.5" /> : null}
                            Join
                          </Button>
                        )}
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => void setMachineAsRunner()}
                          disabled={busy || unsupported || !canMakeRunner}
                          title={!canManageTeam && status?.team.enabled ? 'Only the Owner can change runner' : runnerHandoverPending ? 'Waiting for previous runner acknowledgement' : status?.runnerIsStale ? 'Request handoff; a dead runner cannot be replaced without its acknowledgement' : 'Assign runner duties to this machine'}
                        >
                          {runnerHandoverPending ? 'Pending' : runnerIsThisMachine ? 'Runner active' : status?.runnerIsStale ? 'Request handoff' : 'Make runner'}
                        </Button>
                      </div>
                    </div>
                    {status?.team.enabled && (
                      <div className="mt-4 rounded-[8px] border border-white/[0.06] bg-white/[0.025] px-3 py-2">
                        <div className="mb-2 flex items-center justify-between gap-3 border-b border-white/[0.06] pb-2 text-[12px]">
                          <span className="text-white/48">Your role</span>
                          <span className={status.currentRole === 'owner' ? 'font-medium text-emerald-200' : status.currentRole === 'editor' ? 'font-medium text-white/72' : 'font-medium text-amber-200'}>{roleLabel}</span>
                        </div>
                        <div className="mb-2 truncate text-[11px] text-white/36">{roleDetail}</div>
                        <div className="flex items-center justify-between gap-3 text-[12px]">
                          <span className="text-white/48">Runner status</span>
                          <span className={status.runnerIsStale ? 'font-medium text-amber-200' : 'text-white/72'}>{runnerStateLabel}</span>
                        </div>
                        <div className="mt-1 truncate text-[11px] text-white/36">
                          {runnerHandoverPending
                            ? `Previous runner: ${status.team.runnerHandover?.from ?? 'unknown'}`
                            : `Last seen: ${status.runnerHeartbeat?.lastAutomationHeartbeatAt ?? status.runnerHeartbeat?.lastSeenAt ?? 'Not observed'}`}
                        </div>
                      </div>
                    )}
                  </SettingsCardContent>
                </SettingsCard>
              </SettingsSection>

              {status?.team.enabled && (
                <SettingsSection
                  title="Team metadata health"
                  description={`Checks Team metadata, runner heartbeats, and record conflicts. Your sync provider's full file state remains outside ${PRODUCT_NAME}.`}
                >
                  <SettingsCard>
                    <SettingsCardContent>
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <div className={status.syncHealth.status === 'healthy' ? 'text-[13px] font-medium text-emerald-200' : status.syncHealth.status === 'blocked' ? 'text-[13px] font-medium text-red-200' : 'text-[13px] font-medium text-amber-200'}>
                            {status.syncHealth.summary}
                          </div>
                          <div className="mt-1 text-[12px] text-white/38">
                            {status.syncHealth.machineCount} machine heartbeat{status.syncHealth.machineCount === 1 ? '' : 's'} · {status.syncHealth.conflictCount} open conflict{status.syncHealth.conflictCount === 1 ? '' : 's'}
                          </div>
                        </div>
                        <div className="rounded-full border border-white/[0.08] px-2.5 py-1 text-[11px] uppercase tracking-[0.08em] text-white/50">
                          {status.syncHealth.status}
                        </div>
                      </div>
                      <div className="mt-4 divide-y divide-white/[0.06]">
                        {status.syncHealth.checks.map((check) => (
                          <div key={check.id} className="flex items-start justify-between gap-4 py-2.5 text-[12px]">
                            <div className="min-w-0">
                              <div className="font-medium text-white/72">{check.label}</div>
                              {check.detail && <div className="mt-0.5 truncate text-white/36">{check.detail}</div>}
                            </div>
                            <div className={check.status === 'ok' ? 'shrink-0 text-emerald-200/80' : check.status === 'blocked' ? 'shrink-0 text-red-200/80' : 'shrink-0 text-amber-200/80'}>
                              {check.status}
                            </div>
                          </div>
                        ))}
                      </div>
                    </SettingsCardContent>
                  </SettingsCard>
                </SettingsSection>
              )}

              {status?.team.enabled && (
                <SettingsSection
                  title="Team machines"
                  description="The Owner can hand runner duties to any machine that has joined and synced a heartbeat."
                >
                  <SettingsCard>
                    <SettingsCardContent>
                      <div className="divide-y divide-white/[0.06]">
                        {status.machines.map((teamMachine) => {
                          const isRunner = teamMachine.machineId === status.team.runnerMachineId
                          const isCurrent = teamMachine.machineId === status.machine.machineId
                          return (
                            <div key={teamMachine.machineId} className="flex items-center justify-between gap-4 py-3">
                              <div className="min-w-0">
                                <div className="truncate text-[12px] font-medium text-white/76">
                                  {teamMachine.displayName}{isCurrent ? ' · this machine' : ''}
                                </div>
                                <div className="mt-0.5 truncate font-mono text-[11px] text-white/36">
                                  {teamMachine.machineId} · last seen {teamMachine.lastSeenAt}
                                </div>
                              </div>
                              <Button
                                variant="secondary"
                                size="sm"
                                disabled={busy || !canManageTeam || isRunner}
                                title={!canManageTeam ? 'Only the Owner can change runner' : isRunner ? 'Current runner' : 'Hand runner duties to this machine'}
                                onClick={() => void setMachineAsRunner(teamMachine.machineId)}
                              >
                                {isRunner ? 'Runner' : 'Make runner'}
                              </Button>
                            </div>
                          )
                        })}
                      </div>
                    </SettingsCardContent>
                  </SettingsCard>
                </SettingsSection>
              )}

              {status?.team.enabled && (
                <SettingsSection
                  title="Owner transfer approval"
                  description="A one-time code lets a replacement machine request ownership. The current Owner must still approve it; this does not recover a lost sole Owner."
                >
                  <SettingsCard>
                    <SettingsCardContent>
                      {status.currentRole === 'owner' ? (
                        <div className="space-y-3">
                          <Button size="sm" onClick={() => void rotateOwnerRecoveryCode()} disabled={busy}>
                            Generate transfer code
                          </Button>
                          {newOwnerRecoveryCode && (
                            <div className="rounded-[8px] border border-amber-300/20 bg-amber-300/[0.06] p-3">
                              <div className="text-[12px] font-medium text-amber-100">Save this now. It is shown only here and replaces any older code.</div>
                              <div className="mt-2 break-all font-mono text-[12px] text-white/78">{newOwnerRecoveryCode}</div>
                            </div>
                          )}
                          {status.ownerRecoveryClaims.length > 0 && (
                            <div className="divide-y divide-white/[0.06] rounded-[8px] border border-white/[0.06]">
                              {status.ownerRecoveryClaims.map((claim) => (
                                <div key={claim.claimId} className="flex items-center justify-between gap-3 p-3">
                                  <div className="min-w-0">
                                    <div className="truncate text-[12px] font-medium text-white/76">{claim.displayName}</div>
                                    <div className="mt-0.5 truncate font-mono text-[11px] text-white/36">{claim.machineId}</div>
                                  </div>
                                  <Button size="sm" onClick={() => void approveOwnerRecovery(claim.claimId)} disabled={busy || status.team.ownerRecovery?.state === 'contested'}>
                                    Approve transfer
                                  </Button>
                                </div>
                              ))}
                              {status.team.ownerRecovery?.state === 'contested' && (
                                <div className="p-3 text-[12px] text-red-200">Multiple machines used this code. Rotate it and verify shared-folder access before approving anyone.</div>
                              )}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <input
                            type="password"
                            value={ownerRecoveryCode}
                            onChange={(event) => setOwnerRecoveryCode(event.target.value)}
                            placeholder="One-time owner transfer code"
                            className="h-9 min-w-0 flex-1 rounded-[10px] border border-white/[0.06] bg-white/[0.025] px-3 font-mono text-xs text-white/70 outline-none placeholder:text-white/25"
                          />
                          <Button size="sm" onClick={() => void recoverOwnership()} disabled={busy || !ownerRecoveryCode.trim()}>
                            Request transfer
                          </Button>
                        </div>
                      )}
                    </SettingsCardContent>
                  </SettingsCard>
                </SettingsSection>
              )}

              {status && !wasMovedToSharedFolder && (
                <SettingsSection
                  title="Move to shared folder"
                  description="Copies this workspace into a migration folder, writes config last, then updates this app to open the new shared location."
                >
                  <SettingsCard>
                    <SettingsCardContent>
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-mono text-[12px] text-white/68">
                            {destinationParentPath || 'No destination selected'}
                          </div>
                          <div className="mt-1 text-[12px] text-white/38">
                            Choose the synced parent folder. {PRODUCT_NAME} creates a workspace folder inside it.
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <Button variant="secondary" size="sm" onClick={pickDirectory} disabled={busy || unsupported}>
                            Choose
                          </Button>
                          <Button size="sm" onClick={() => void moveToSharedFolder()} disabled={busy || unsupported || !destinationParentPath}>
                            {busy ? <Spinner className="mr-1.5" /> : null}
                            Move
                          </Button>
                        </div>
                      </div>
                    </SettingsCardContent>
                  </SettingsCard>
                </SettingsSection>
              )}

              {status && (
                <SettingsSection
                  title="External file overrides"
                  description="Private paths for files that were linked from another machine instead of copied into the workspace vault."
                >
                  <SettingsCard>
                    <SettingsCardContent>
                      <div className="grid gap-2 md:grid-cols-[1fr_1.6fr_auto]">
                        <input
                          value={overrideRefId}
                          onChange={(event) => setOverrideRefId(event.target.value)}
                          placeholder="ref id"
                          className="h-9 rounded-[10px] border border-white/[0.06] bg-white/[0.025] px-3 text-xs text-white/70 outline-none placeholder:text-white/25"
                        />
                        <input
                          value={overridePath}
                          onChange={(event) => setOverridePath(event.target.value)}
                          placeholder="/Users/you/path/to/file"
                          className="h-9 rounded-[10px] border border-white/[0.06] bg-white/[0.025] px-3 font-mono text-xs text-white/70 outline-none placeholder:text-white/25"
                        />
                        <Button size="sm" onClick={() => void savePathOverride()} disabled={busy || !overrideRefId.trim() || !overridePath.trim()}>
                          Save
                        </Button>
                      </div>
                      <div className="mt-3 divide-y divide-white/[0.06]">
                        {Object.entries(pathOverrides).length === 0 ? (
                          <div className="py-2 text-[12px] text-white/38">No external path overrides on this machine.</div>
                        ) : Object.entries(pathOverrides).map(([refId, path]) => (
                          <div key={refId} className="flex items-center justify-between gap-3 py-2 text-[12px]">
                            <div className="min-w-0">
                              <div className="truncate font-medium text-white/72">{refId}</div>
                              <div className="truncate font-mono text-white/42" title={path}>{path}</div>
                            </div>
                            <Button variant="ghost" size="icon" onClick={() => void clearPathOverride(refId)} disabled={busy} title="Remove override">
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    </SettingsCardContent>
                  </SettingsCard>
                </SettingsSection>
              )}

              {status && (
                <SettingsSection
                  title="Conflict Inbox"
                  description="Record conflicts from stale edits, provider conflicted copies, and recovered clobbered writes."
                  action={
                    <div className="flex items-center gap-2">
                      <Button variant="ghost" size="sm" onClick={() => void scanRecordConflicts()} disabled={busy}>
                        <Search className="mr-1.5 h-3.5 w-3.5" />
                        Scan files
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => void detectRecordClobbers()} disabled={busy}>
                        <RefreshCcw className="mr-1.5 h-3.5 w-3.5" />
                        Check writes
                      </Button>
                    </div>
                  }
                >
                  <SettingsCard>
                    <SettingsCardContent>
                      {recordConflicts.length === 0 ? (
                        <div className="py-2 text-[12px] text-white/38">No open record conflicts.</div>
                      ) : (
                        <div className="divide-y divide-white/[0.06]">
                          {recordConflicts.slice(0, 8).map((conflict) => (
                            <div key={conflict.conflictId} className="flex items-start gap-3 py-3">
                              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-amber-400/10 text-amber-200">
                                <AlertTriangle className="h-4 w-4" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <div className="truncate text-[12px] font-medium text-white/78">{conflict.entityPath}</div>
                                  <span className="rounded-full border border-white/[0.08] px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-white/42">
                                    {conflict.reason.replaceAll('-', ' ')}
                                  </span>
                                </div>
                                <div className="mt-1 truncate font-mono text-[11px] text-white/36" title={conflict.conflictId}>
                                  {conflict.conflictId} · {conflict.detectedAt}
                                </div>
                              </div>
                              <div className="shrink-0 text-[11px] text-white/38">{conflict.status}</div>
                            </div>
                          ))}
                          {recordConflicts.length > 8 && (
                            <div className="pt-3 text-[12px] text-white/38">{recordConflicts.length - 8} more conflicts hidden.</div>
                          )}
                        </div>
                      )}
                    </SettingsCardContent>
                  </SettingsCard>
                </SettingsSection>
              )}

              {status && (
                <SettingsSection title="Status">
                  <SettingsCard>
                    <ValueRow label="Team revision" value={String(status.team.revision)} />
                    <ValueRow label="Team ID" value={status.team.teamId} />
                    <ValueRow label="Joined on this machine" value={status.joined ? 'Yes' : 'No'} />
                    <ValueRow label="Role on this machine" value={roleLabel} />
                    <ValueRow label="Sync health" value={status.syncHealth.status} />
                    <ValueRow label="Runner machine" value={status.team.runnerMachineId || 'None'} />
                    <ValueRow label="Runner state" value={runnerStateLabel} />
                    <ValueRow label="This machine" value={`${status.machine.displayName} (${status.machine.machineId})`} />
                    <ValueRow label="Heartbeat observed revision" value={String(status.heartbeat.observedTeamRevision)} />
                  </SettingsCard>
                </SettingsSection>
              )}

              {status && (
                <SettingsSection title="Files">
                  <SettingsCard>
                    <ValueRow label="Team config mirror" value={status.teamConfigPath} />
                    <ValueRow label="Private machine identity" value={status.privateMachinePath} />
                    <ValueRow label="Shared heartbeat" value={status.heartbeatPath} />
                  </SettingsCard>
                </SettingsSection>
              )}
            </div>
          )}
        </div>
      </ScrollArea>
      <ServerDirectoryBrowser
        open={showServerBrowser}
        mode={serverBrowserMode}
        onSelect={confirmServerBrowser}
        onCancel={cancelServerBrowser}
      />
    </>
  )
}
