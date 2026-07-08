import * as React from 'react'
import { CheckCircle2, ChevronDown, ChevronRight, Copy, Loader2, LogIn, Plus, RefreshCcw, Save, Trash2, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { SettingsCard, SettingsCardContent, SettingsSection } from '@/components/settings'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import type {
  SocialAccountCommandResult,
  SocialAccountProfileStatus,
  SocialAccountsDoctorResult,
  SocialPlatform,
} from '../../../shared/types'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'social-accounts',
}

const PLATFORMS: Array<{ id: SocialPlatform; label: string }> = [
  { id: 'instagram', label: 'Instagram' },
  { id: 'tiktok', label: 'TikTok' },
  { id: 'x', label: 'X' },
  { id: 'youtube', label: 'YouTube' },
]

type Draft = {
  accountGroup: string
  platform: SocialPlatform
  profile: string
  handle: string
  accountUrl: string
}

const EMPTY_DRAFT: Draft = {
  accountGroup: '',
  platform: 'instagram',
  profile: '',
  handle: '',
  accountUrl: '',
}

export default function SocialAccountsSettingsPage() {
  const [doctor, setDoctor] = React.useState<SocialAccountsDoctorResult | null>(null)
  const [draft, setDraft] = React.useState<Draft>(EMPTY_DRAFT)
  const [editingRef, setEditingRef] = React.useState<{ platform: SocialPlatform; profile: string } | null>(null)
  const [busy, setBusy] = React.useState<string | null>('load')
  const [loginPlan, setLoginPlan] = React.useState<SocialAccountCommandResult | null>(null)
  const [pendingDelete, setPendingDelete] = React.useState<SocialAccountProfileStatus | null>(null)
  const [newGroupName, setNewGroupName] = React.useState('')
  const [localGroups, setLocalGroups] = React.useState<string[]>([])
  const [activeGroup, setActiveGroup] = React.useState<string | null>(null)
  const [collapsedGroups, setCollapsedGroups] = React.useState<Set<string>>(() => new Set())

  const profiles = React.useMemo(
    () => doctor?.platforms.flatMap((platform) => platform.profiles) ?? [],
    [doctor],
  )

  const accountSetGroups = React.useMemo(() => {
    const groups = new Map<string, SocialAccountProfileStatus[]>()
    for (const profile of profiles) {
      const group = profile.accountGroup?.trim() || 'Ungrouped'
      groups.set(group, [...(groups.get(group) ?? []), profile])
    }

    for (const group of localGroups) {
      const name = group.trim()
      if (name && !groups.has(name)) groups.set(name, [])
    }

    return Array.from(groups.entries())
      .map(([name, items]) => ({
        name,
        profiles: [...items].sort((a, b) => platformLabel(a.platform).localeCompare(platformLabel(b.platform))),
      }))
      .sort((a, b) => {
        if (a.name === 'Ungrouped') return 1
        if (b.name === 'Ungrouped') return -1
        return a.name.localeCompare(b.name)
      })
  }, [localGroups, profiles])

  const load = React.useCallback(async () => {
    setBusy('load')
    try {
      setDoctor(await window.electronAPI.listSocialAccounts())
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load social accounts')
    } finally {
      setBusy(null)
    }
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  const save = async (accountGroup: string) => {
    const normalizedGroup = accountGroup.trim()
    const profile = draft.profile.trim()
    if (!normalizedGroup) {
      toast.error('Account set title is required')
      return
    }
    if (!profile) {
      toast.error('Agent Ref ID is required')
      return
    }
    setBusy('save')
    try {
      const exists = profiles.some((item) => item.platform === draft.platform && item.profile === profile)
      const input = {
        platform: draft.platform,
        profile,
        accountGroup: normalizedGroup,
        handle: exists ? draft.handle.trim() : draft.handle.trim() || undefined,
        accountUrl: exists ? draft.accountUrl.trim() : draft.accountUrl.trim() || undefined,
      }
      if (exists) await window.electronAPI.updateSocialAccount(input)
      else await window.electronAPI.addSocialAccount(input)
      setDraft({ ...EMPTY_DRAFT, accountGroup: normalizedGroup })
      setEditingRef(null)
      setActiveGroup(null)
      await load()
      toast.success(exists ? 'Social profile updated' : 'Social profile added')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save social profile')
    } finally {
      setBusy(null)
    }
  }

  const openEditor = (accountGroup: string) => {
    setDraft({ ...EMPTY_DRAFT, accountGroup })
    setEditingRef(null)
    setActiveGroup(accountGroup)
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      next.delete(accountGroup)
      return next
    })
  }

  const edit = (profile: SocialAccountProfileStatus) => {
    const accountGroup = profile.accountGroup?.trim() || 'Ungrouped'
    setDraft({
      accountGroup,
      platform: profile.platform,
      profile: profile.profile,
      handle: profile.accountHandle ?? '',
      accountUrl: profile.accountUrl ?? '',
    })
    setEditingRef({ platform: profile.platform, profile: profile.profile })
    setActiveGroup(accountGroup)
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      next.delete(accountGroup)
      return next
    })
  }

  const cancelEdit = () => {
    setDraft(activeGroup ? { ...EMPTY_DRAFT, accountGroup: activeGroup } : EMPTY_DRAFT)
    setEditingRef(null)
  }

  const addAccountSet = () => {
    const name = newGroupName.trim()
    if (!name) {
      toast.error('Account set title is required')
      return
    }
    setLocalGroups((prev) => prev.includes(name) ? prev : [...prev, name])
    setNewGroupName('')
    openEditor(name)
  }

  const toggleGroup = (accountGroup: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(accountGroup)) next.delete(accountGroup)
      else next.add(accountGroup)
      return next
    })
  }

  const remove = async () => {
    if (!pendingDelete) return
    const profile = pendingDelete
    setBusy(`${profile.platform}:${profile.profile}:delete`)
    try {
      await window.electronAPI.deleteSocialAccount({ platform: profile.platform, profile: profile.profile })
      await load()
      setPendingDelete(null)
      toast.success('Social profile deleted')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not delete social profile')
    } finally {
      setBusy(null)
    }
  }

  const login = async (profile: SocialAccountProfileStatus) => {
    setBusy(`${profile.platform}:${profile.profile}:login`)
    try {
      const result = await window.electronAPI.loginSocialAccount({ platform: profile.platform, profile: profile.profile })
      setLoginPlan(result)
      await load()
      toast.success(result.browserInstanceId ? 'Login browser opened' : 'Login handoff prepared')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not start login')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <PanelHeader />
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-6 p-6">
          <SettingsSection
            title="Social Accounts"
            description="Create an account set for each persona or brand, then add platform accounts beneath it."
            action={
              <Button type="button" size="sm" variant="secondary" onClick={load} disabled={busy === 'load'}>
                {busy === 'load' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5" />}
                Refresh
              </Button>
            }
          >
            <SettingsCard>
              <SettingsCardContent>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <Field label="New Account Set" value={newGroupName} placeholder="Music Fan Page" onChange={setNewGroupName} />
                  <Button type="button" onClick={addAccountSet} className="sm:w-auto">
                    <Plus className="h-4 w-4" />
                    Add Set
                  </Button>
                </div>
              </SettingsCardContent>
            </SettingsCard>
          </SettingsSection>

          <SettingsSection title="Account Sets" description="Use the set name or exact platform/profile reference with @social-publisher. Writes still require approval.">
            <div className="space-y-3">
              {accountSetGroups.length === 0 ? (
                <SettingsCard>
                  <SettingsCardContent>
                    <p className="text-sm text-white/46">No account sets yet.</p>
                  </SettingsCardContent>
                </SettingsCard>
              ) : accountSetGroups.map((group) => {
                const collapsed = collapsedGroups.has(group.name)
                const editingThisGroup = activeGroup === group.name
                return (
                  <SettingsCard key={group.name} divided={false}>
                    <button
                      type="button"
                      onClick={() => toggleGroup(group.name)}
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-white/[0.025]"
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        {collapsed ? <ChevronRight className="h-4 w-4 text-white/42" /> : <ChevronDown className="h-4 w-4 text-white/42" />}
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-white/86">{group.name}</span>
                          <span className="block truncate text-xs text-white/38">
                            {group.profiles.length ? group.profiles.map((profile) => platformLabel(profile.platform)).join(', ') : 'No platform accounts yet'}
                          </span>
                        </span>
                      </span>
                      <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-white/42">
                        {group.profiles.length} {group.profiles.length === 1 ? 'account' : 'accounts'}
                      </span>
                    </button>
                    {!collapsed && (
                      <div className="border-t border-white/[0.055] px-4 py-3">
                        <div className="space-y-2.5">
                          {group.profiles.map((profile) => (
                            <ProfileRow
                              key={`${profile.platform}:${profile.profile}`}
                              profile={profile}
                              busy={busy}
                              onEdit={() => edit(profile)}
                              onDelete={() => setPendingDelete(profile)}
                              onLogin={() => login(profile)}
                            />
                          ))}
                          {editingThisGroup ? (
                            <AccountEditor
                              draft={draft}
                              editing={Boolean(editingRef)}
                              busy={busy === 'save'}
                              onDraftChange={(patch) => setDraft((prev) => ({ ...prev, ...patch }))}
                              onSave={() => save(group.name)}
                              onCancel={cancelEdit}
                            />
                          ) : null}
                          {!editingThisGroup && (
                            <Button type="button" size="sm" variant="secondary" onClick={() => openEditor(group.name)}>
                              <Plus className="h-3.5 w-3.5" />
                              Add Another Platform Account
                            </Button>
                          )}
                        </div>
                      </div>
                    )}
                  </SettingsCard>
                )
              })}
            </div>
          </SettingsSection>

          {loginPlan?.browserPlan && (
            <SettingsSection title="Login Browser" description={loginPlan.browserInstanceId ? `Opened browser ${loginPlan.browserInstanceId}. Log in manually, then refresh or verify status.` : 'Use this delegated plan with Runner browser tools.'}>
              <SettingsCard>
                <SettingsCardContent>
                  <pre className="max-h-64 overflow-auto rounded-md bg-black/35 p-3 text-[11px] leading-5 text-white/68">
                    {JSON.stringify(loginPlan.browserPlan, null, 2)}
                  </pre>
                </SettingsCardContent>
              </SettingsCard>
            </SettingsSection>
          )}
          <DeleteProfileDialog
            profile={pendingDelete}
            busy={Boolean(pendingDelete && busy === `${pendingDelete.platform}:${pendingDelete.profile}:delete`)}
            onCancel={() => setPendingDelete(null)}
            onConfirm={remove}
          />
        </div>
      </ScrollArea>
    </div>
  )
}

function AccountEditor({
  draft,
  editing,
  busy,
  onDraftChange,
  onSave,
  onCancel,
}: {
  draft: Draft
  editing: boolean
  busy: boolean
  onDraftChange: (patch: Partial<Draft>) => void
  onSave: () => void
  onCancel: () => void
}) {
  return (
    <div className="rounded-lg border border-white/[0.07] bg-white/[0.025] p-3">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[150px_1fr_1fr_1.3fr_auto]">
        <label className="space-y-1">
          <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/34">Platform</span>
          <select
            value={draft.platform}
            onChange={(event) => onDraftChange({ platform: event.target.value as SocialPlatform })}
            disabled={editing}
            className="h-9 w-full rounded-md border border-white/10 bg-white/[0.035] px-3 text-sm text-white outline-none disabled:cursor-not-allowed disabled:opacity-55"
          >
            {PLATFORMS.map((platform) => (
              <option key={platform.id} value={platform.id}>{platform.label}</option>
            ))}
          </select>
        </label>
        <Field
          label="Agent Ref ID"
          value={draft.profile}
          placeholder="theinstaban"
          disabled={editing}
          hint="Agent uses this as instagram/theinstaban."
          onChange={(profile) => onDraftChange({ profile })}
        />
        <Field label="Handle" value={draft.handle} placeholder="@yourhandle" onChange={(handle) => onDraftChange({ handle })} />
        <Field label="Account URL" value={draft.accountUrl} placeholder="https://instagram.com/yourhandle" onChange={(accountUrl) => onDraftChange({ accountUrl })} />
        <div className="flex items-end gap-2">
          <Button type="button" onClick={onSave} disabled={busy} className="w-full">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : editing ? <Save className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            Save
          </Button>
          {editing && (
            <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

function Field({
  label,
  value,
  placeholder,
  disabled,
  hint,
  onChange,
}: {
  label: string
  value: string
  placeholder: string
  disabled?: boolean
  hint?: string
  onChange: (value: string) => void
}) {
  return (
    <label className="space-y-1">
      <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/34">{label}</span>
      <input
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-full rounded-md border border-white/10 bg-white/[0.035] px-3 text-sm text-white outline-none placeholder:text-white/22 disabled:cursor-not-allowed disabled:opacity-55"
      />
      {hint && <span className="block text-[11px] leading-4 text-white/32">{hint}</span>}
    </label>
  )
}

function DeleteProfileDialog({
  profile,
  busy,
  onCancel,
  onConfirm,
}: {
  profile: SocialAccountProfileStatus | null
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const agentRef = profile ? `${profile.platform}/${profile.profile}` : ''
  return (
    <Dialog open={Boolean(profile)} onOpenChange={(open) => { if (!open && !busy) onCancel() }}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Delete social profile?</DialogTitle>
          <DialogDescription>
            This removes the saved profile entry for <span className="font-mono text-white/72">{agentRef}</span>. The agent will no longer be able to select it.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button type="button" variant="destructive" onClick={onConfirm} disabled={busy}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ProfileRow({
  profile,
  busy,
  onEdit,
  onDelete,
  onLogin,
}: {
  profile: SocialAccountProfileStatus
  busy: string | null
  onEdit: () => void
  onDelete: () => void
  onLogin: () => void
}) {
  const statusBusy = busy?.startsWith(`${profile.platform}:${profile.profile}:`)
  const agentRef = `${profile.platform}/${profile.profile}`
  const copyAgentRef = async () => {
    try {
      await navigator.clipboard.writeText(agentRef)
      toast.success('Agent profile reference copied')
    } catch {
      toast.error('Could not copy profile reference')
    }
  }
  return (
    <div className="rounded-lg border border-white/[0.06] bg-black/20 px-3 py-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-white/[0.06] px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/52">
              {platformLabel(profile.platform)}
            </span>
            <span className="text-sm font-semibold text-white/86">{profile.profile}</span>
            <StatusPill profile={profile} />
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-white/42">
            <span className="font-mono text-white/58">{agentRef}</span>
            <span>{profile.accountHandle || 'No handle'}</span>
            <span>{profile.accountUrl || 'No account URL'}</span>
            <span>{profile.message || profile.profileStatus || 'Unknown status'}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={copyAgentRef}>
            <Copy className="h-3.5 w-3.5" />
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={onLogin} disabled={statusBusy}>
            {statusBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogIn className="h-3.5 w-3.5" />}
            Open Login
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={onEdit}>
            Edit
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onDelete} disabled={statusBusy}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  )
}

function StatusPill({ profile }: { profile: SocialAccountProfileStatus }) {
  const ready = profile.ready
  return (
    <span className={ready
      ? 'inline-flex items-center gap-1 rounded-full bg-emerald-400/12 px-2 py-1 text-[11px] font-medium text-emerald-200'
      : 'inline-flex items-center gap-1 rounded-full bg-amber-400/12 px-2 py-1 text-[11px] font-medium text-amber-200'}
    >
      {ready ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
      {ready ? 'Ready' : statusLabel(profile.profileStatus)}
    </span>
  )
}

function platformLabel(platform: SocialPlatform) {
  return PLATFORMS.find((item) => item.id === platform)?.label ?? platform
}

function statusLabel(status: string | null) {
  if (status === 'login_needed') return 'Login needed'
  if (status === 'session_exists_unverified') return 'Verify'
  if (status === 'wrong_account') return 'Wrong account'
  if (status === 'verification_failed') return 'Failed'
  return 'Not ready'
}
