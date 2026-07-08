import * as React from 'react'
import { CheckCircle2, Loader2, LogIn, Plus, RefreshCcw, Save, Trash2, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
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
  platform: SocialPlatform
  profile: string
  handle: string
  accountUrl: string
}

const EMPTY_DRAFT: Draft = {
  platform: 'instagram',
  profile: '',
  handle: '',
  accountUrl: '',
}

export default function SocialAccountsSettingsPage() {
  const [doctor, setDoctor] = React.useState<SocialAccountsDoctorResult | null>(null)
  const [draft, setDraft] = React.useState<Draft>(EMPTY_DRAFT)
  const [busy, setBusy] = React.useState<string | null>('load')
  const [loginPlan, setLoginPlan] = React.useState<SocialAccountCommandResult | null>(null)

  const profiles = React.useMemo(
    () => doctor?.platforms.flatMap((platform) => platform.profiles) ?? [],
    [doctor],
  )

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

  const save = async () => {
    const profile = draft.profile.trim()
    if (!profile) {
      toast.error('Profile name is required')
      return
    }
    setBusy('save')
    try {
      const exists = profiles.some((item) => item.platform === draft.platform && item.profile === profile)
      const input = {
        platform: draft.platform,
        profile,
        handle: draft.handle.trim() || undefined,
        accountUrl: draft.accountUrl.trim() || undefined,
      }
      if (exists) await window.electronAPI.updateSocialAccount(input)
      else await window.electronAPI.addSocialAccount(input)
      setDraft(EMPTY_DRAFT)
      await load()
      toast.success(exists ? 'Social profile updated' : 'Social profile added')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save social profile')
    } finally {
      setBusy(null)
    }
  }

  const edit = (profile: SocialAccountProfileStatus) => {
    setDraft({
      platform: profile.platform,
      profile: profile.profile,
      handle: profile.accountHandle ?? '',
      accountUrl: profile.accountUrl ?? '',
    })
  }

  const remove = async (profile: SocialAccountProfileStatus) => {
    setBusy(`${profile.platform}:${profile.profile}:delete`)
    try {
      await window.electronAPI.deleteSocialAccount({ platform: profile.platform, profile: profile.profile })
      await load()
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
      toast.success('Login handoff prepared')
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
            description="Save handles once, log in manually, then agents reuse the right browser session."
            action={
              <Button type="button" size="sm" variant="secondary" onClick={load} disabled={busy === 'load'}>
                {busy === 'load' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5" />}
                Refresh
              </Button>
            }
          >
            <SettingsCard>
              <SettingsCardContent>
                <div className="grid gap-3 md:grid-cols-[150px_1fr_1fr_1.2fr_auto]">
                  <label className="space-y-1">
                    <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/34">Platform</span>
                    <select
                      value={draft.platform}
                      onChange={(event) => setDraft((prev) => ({ ...prev, platform: event.target.value as SocialPlatform }))}
                      className="h-9 w-full rounded-md border border-white/10 bg-white/[0.035] px-3 text-sm text-white outline-none"
                    >
                      {PLATFORMS.map((platform) => (
                        <option key={platform.id} value={platform.id}>{platform.label}</option>
                      ))}
                    </select>
                  </label>
                  <Field label="Profile" value={draft.profile} placeholder="artist-main" onChange={(profile) => setDraft((prev) => ({ ...prev, profile }))} />
                  <Field label="Handle" value={draft.handle} placeholder="@yourhandle" onChange={(handle) => setDraft((prev) => ({ ...prev, handle }))} />
                  <Field label="Account URL" value={draft.accountUrl} placeholder="https://instagram.com/yourhandle" onChange={(accountUrl) => setDraft((prev) => ({ ...prev, accountUrl }))} />
                  <div className="flex items-end">
                    <Button type="button" onClick={save} disabled={busy === 'save'} className="w-full">
                      {busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : draft.profile ? <Save className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                      Save
                    </Button>
                  </div>
                </div>
              </SettingsCardContent>
            </SettingsCard>
          </SettingsSection>

          <SettingsSection title="Profiles" description="Ready profiles can be used by @social-publisher. Writes still require approval.">
            <div className="space-y-2.5">
              {profiles.length === 0 ? (
                <SettingsCard>
                  <SettingsCardContent>
                    <p className="text-sm text-white/46">No social profiles yet.</p>
                  </SettingsCardContent>
                </SettingsCard>
              ) : profiles.map((profile) => (
                <ProfileRow
                  key={`${profile.platform}:${profile.profile}`}
                  profile={profile}
                  busy={busy}
                  onEdit={() => edit(profile)}
                  onDelete={() => remove(profile)}
                  onLogin={() => login(profile)}
                />
              ))}
            </div>
          </SettingsSection>

          {loginPlan?.browserPlan && (
            <SettingsSection title="Login Handoff" description="Use this delegated plan with Runner browser tools until profile-bound browser sessions are wired.">
              <SettingsCard>
                <SettingsCardContent>
                  <pre className="max-h-64 overflow-auto rounded-md bg-black/35 p-3 text-[11px] leading-5 text-white/68">
                    {JSON.stringify(loginPlan.browserPlan, null, 2)}
                  </pre>
                </SettingsCardContent>
              </SettingsCard>
            </SettingsSection>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

function Field({ label, value, placeholder, onChange }: { label: string; value: string; placeholder: string; onChange: (value: string) => void }) {
  return (
    <label className="space-y-1">
      <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/34">{label}</span>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-full rounded-md border border-white/10 bg-white/[0.035] px-3 text-sm text-white outline-none placeholder:text-white/22"
      />
    </label>
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
  return (
    <SettingsCard>
      <SettingsCardContent>
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
              <span>{profile.accountHandle || 'No handle'}</span>
              <span>{profile.accountUrl || 'No account URL'}</span>
              <span>{profile.message || profile.profileStatus || 'Unknown status'}</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={onLogin} disabled={statusBusy}>
              {statusBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogIn className="h-3.5 w-3.5" />}
              Prepare Login
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={onEdit}>
              Edit
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={onDelete} disabled={statusBusy}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </SettingsCardContent>
    </SettingsCard>
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
