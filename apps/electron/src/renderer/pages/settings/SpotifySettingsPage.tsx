import * as React from 'react'
import { useSetAtom } from 'jotai'
import {
  CheckCircle2,
  CircleDashed,
  Copy,
  Loader2,
  LogIn,
  Music2,
  Plus,
  RefreshCcw,
  ShieldCheck,
  Trash2,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { openBrowserSidecarAtom, setBrowserInstancesAtom } from '@/atoms/browser-pane'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { SettingsCard, SettingsCardContent, SettingsSection } from '@/components/settings'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import type {
  SocialAccountProfileStatus,
  SocialAccountsDoctorResult,
  SpotifyCapabilityStatus,
  SpotifyLoginSurface,
} from '../../../shared/types'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'spotify',
}

const DEFAULT_PROFILE = 'spotify-main'

export default function SpotifySettingsPage() {
  const openBrowserSidecar = useSetAtom(openBrowserSidecarAtom)
  const setBrowserInstances = useSetAtom(setBrowserInstancesAtom)
  const [doctor, setDoctor] = React.useState<SocialAccountsDoctorResult | null>(null)
  const [newProfile, setNewProfile] = React.useState('')
  const [pendingDelete, setPendingDelete] = React.useState<SocialAccountProfileStatus | null>(null)
  const [busy, setBusy] = React.useState<string | null>('load')

  const profiles = React.useMemo(
    () => doctor?.platforms
      .flatMap((platform) => platform.profiles)
      .filter((profile) => profile.platform === 'spotify') ?? [],
    [doctor],
  )

  const load = React.useCallback(async () => {
    setBusy('load')
    try {
      setDoctor(await window.electronAPI.listSocialAccounts())
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load Spotify accounts')
    } finally {
      setBusy(null)
    }
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  const addAccount = async () => {
    const profile = newProfile.trim() || (profiles.length === 0 ? DEFAULT_PROFILE : '')
    if (!profile) {
      toast.error('Account name is required')
      return
    }
    if (profiles.some((item) => item.profile === profile)) {
      toast.error('That Spotify account already exists')
      return
    }

    setBusy('add')
    try {
      await window.electronAPI.addSocialAccount({
        platform: 'spotify',
        profile,
        accountGroup: 'Spotify',
      })
      setNewProfile('')
      await load()
      toast.success('Spotify account added')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not add Spotify account')
    } finally {
      setBusy(null)
    }
  }

  const login = async (profile: SocialAccountProfileStatus, surface: SpotifyLoginSurface) => {
    setBusy(`${profile.profile}:login:${surface}`)
    try {
      const result = await window.electronAPI.loginSocialAccount({
        platform: 'spotify',
        profile: profile.profile,
        spotifySurface: surface,
      })
      if (result.browserInstanceId) {
        const instances = await window.electronAPI.browserPane.list()
        setBrowserInstances(instances)
        openBrowserSidecar(result.browserInstanceId)
      }
      await load()
      toast.success(result.browserInstanceId
        ? 'Spotify opened. Sign in if needed, then click Verify Account.'
        : 'Spotify login handoff prepared')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not open Spotify')
    } finally {
      setBusy(null)
    }
  }

  const verify = async (profile: SocialAccountProfileStatus) => {
    setBusy(`${profile.profile}:verify`)
    try {
      const result = await window.electronAPI.getSocialAccountStatus({
        platform: 'spotify',
        profile: profile.profile,
        live: true,
      }) as SocialAccountProfileStatus
      setDoctor((previous) => replaceSpotifyProfile(previous, result))
      if (result.browserInstanceId) {
        const instances = await window.electronAPI.browserPane.list()
        setBrowserInstances(instances)
        openBrowserSidecar(result.browserInstanceId)
      }
      if (result.ready) toast.success('Spotify account verified')
      else toast.warning(result.message || 'Spotify still needs verification')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not verify Spotify')
    } finally {
      setBusy(null)
    }
  }

  const remove = async () => {
    if (!pendingDelete) return
    const profile = pendingDelete
    setBusy(`${profile.profile}:delete`)
    try {
      await window.electronAPI.deleteSocialAccount({ platform: 'spotify', profile: profile.profile })
      setPendingDelete(null)
      await load()
      toast.success('Spotify account removed')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not remove Spotify account')
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
            title="Spotify"
            description="Connect Spotify once for artist analytics, playlist creation, and Spotify Ads Manager. Each capability keeps its own login check under the same isolated account."
            action={(
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="border border-white/10 bg-white/[0.05] text-white/72 hover:bg-white/[0.09] hover:text-white"
                onClick={load}
                disabled={busy === 'load'}
              >
                {busy === 'load' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5" />}
                Refresh
              </Button>
            )}
          >
            <div className="space-y-3">
              {profiles.length === 0 && busy !== 'load' ? (
                <SettingsCard>
                  <SettingsCardContent>
                    <div className="flex items-start gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#1ED760]/12 text-[#1ED760]">
                        <Music2 className="h-4 w-4" />
                      </span>
                      <div>
                        <p className="text-sm font-semibold text-white/86">No Spotify account connected</p>
                        <p className="mt-1 text-xs leading-5 text-white/42">Add an account, then connect the Spotify surfaces you use in the controlled browser.</p>
                      </div>
                    </div>
                  </SettingsCardContent>
                </SettingsCard>
              ) : null}

              {profiles.map((profile) => (
                <SpotifyAccountCard
                  key={profile.profile}
                  profile={profile}
                  busy={busy}
                  onLogin={(surface) => login(profile, surface)}
                  onVerify={() => verify(profile)}
                  onDelete={() => setPendingDelete(profile)}
                />
              ))}
            </div>
          </SettingsSection>

          <SettingsSection
            title={profiles.length ? 'Add Another Spotify Account' : 'Add Spotify Account'}
            description="Use a short local name so agents can select the correct saved login."
          >
            <SettingsCard>
              <SettingsCardContent>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <label className="min-w-0 flex-1 space-y-1">
                    <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/34">Account Name</span>
                    <input
                      value={newProfile}
                      placeholder={DEFAULT_PROFILE}
                      onChange={(event) => setNewProfile(event.target.value)}
                      className="h-9 w-full rounded-md border border-white/10 bg-white/[0.035] px-3 text-sm text-white outline-none placeholder:text-white/22"
                    />
                    <span className="block text-[11px] leading-4 text-white/32">
                      Agents use this account as spotify/{newProfile.trim() || (profiles.length === 0 ? DEFAULT_PROFILE : 'your-account-name')}.
                    </span>
                  </label>
                  <Button
                    type="button"
                    onClick={addAccount}
                    disabled={busy === 'add'}
                    className="bg-white text-black hover:bg-white/90 sm:w-auto"
                  >
                    {busy === 'add' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    Add Account
                  </Button>
                </div>
              </SettingsCardContent>
            </SettingsCard>
          </SettingsSection>

          <DeleteSpotifyDialog
            profile={pendingDelete}
            busy={Boolean(pendingDelete && busy === `${pendingDelete.profile}:delete`)}
            onCancel={() => setPendingDelete(null)}
            onConfirm={remove}
          />
        </div>
      </ScrollArea>
    </div>
  )
}

function SpotifyAccountCard({
  profile,
  busy,
  onLogin,
  onVerify,
  onDelete,
}: {
  profile: SocialAccountProfileStatus
  busy: string | null
  onLogin: (surface: SpotifyLoginSurface) => void
  onVerify: () => void
  onDelete: () => void
}) {
  const capabilities = profile.spotifyCapabilities
  const accountBusy = Boolean(busy?.startsWith(`${profile.profile}:`))
  const copyAgentRef = async () => {
    try {
      await navigator.clipboard.writeText(`spotify/${profile.profile}`)
      toast.success('Spotify account reference copied')
    } catch {
      toast.error('Could not copy Spotify account reference')
    }
  }

  return (
    <SettingsCard divided={false}>
      <div className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#1ED760]/12 text-[#1ED760]">
              <Music2 className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-sm font-semibold text-white/86">{profile.profile}</p>
                <SpotifyStatusPill profile={profile} />
              </div>
              <p className="mt-0.5 truncate font-mono text-[11px] text-white/38">spotify/{profile.profile}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="border border-amber-300/25 bg-amber-400/10 text-amber-100 hover:bg-amber-400/16 hover:text-amber-50"
              onClick={onVerify}
              disabled={accountBusy}
            >
              {busy === `${profile.profile}:verify` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
              Verify Account
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="border border-white/10 bg-white/[0.04] text-white/68 hover:bg-white/[0.08] hover:text-white"
              onClick={copyAgentRef}
            >
              <Copy className="h-3.5 w-3.5" />
              Copy Ref
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="border border-red-300/15 bg-red-400/[0.06] text-red-200/75 hover:bg-red-400/12 hover:text-red-100"
              onClick={onDelete}
              disabled={accountBusy}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </Button>
          </div>
        </div>

        <div className="grid gap-2 lg:grid-cols-3">
          <SpotifyCapabilityCard
            label="Spotify for Artists"
            purpose="Artist analytics"
            capability={capabilities?.artists}
            busy={busy === `${profile.profile}:login:artists`}
            disabled={accountBusy}
            onOpen={() => onLogin('artists')}
          />
          <SpotifyCapabilityCard
            label="Spotify Web Player"
            purpose="Playlist creation"
            capability={capabilities?.webPlayer}
            busy={busy === `${profile.profile}:login:web-player`}
            disabled={accountBusy}
            onOpen={() => onLogin('web-player')}
          />
          <SpotifyCapabilityCard
            label="Spotify Ads Manager"
            purpose="Paid campaign dashboard"
            capability={capabilities?.adsManager}
            busy={busy === `${profile.profile}:login:ads-manager`}
            disabled={accountBusy}
            onOpen={() => onLogin('ads-manager')}
          />
        </div>
      </div>
    </SettingsCard>
  )
}

function SpotifyCapabilityCard({
  label,
  purpose,
  capability,
  busy,
  disabled,
  onOpen,
}: {
  label: string
  purpose: string
  capability?: SpotifyCapabilityStatus
  busy: boolean
  disabled: boolean
  onOpen: () => void
}) {
  const ready = capability?.ready === true
  const checked = capability != null
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-white/[0.07] bg-black/20 p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-white/78">{label}</p>
        <p className="mt-0.5 truncate text-[11px] text-white/38">{purpose}</p>
        <span
          className={ready
            ? 'mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-emerald-200'
            : checked
              ? 'mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-amber-200'
              : 'mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-white/42'}
          title={capability?.message}
        >
          {ready
            ? <CheckCircle2 className="h-3.5 w-3.5" />
            : checked
              ? <XCircle className="h-3.5 w-3.5" />
              : <CircleDashed className="h-3.5 w-3.5" />}
          {ready ? 'Ready' : checked ? statusLabel(capability.status) : 'Not checked'}
        </span>
      </div>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        className="shrink-0 border border-white/15 bg-white text-black hover:bg-white/90 disabled:text-black/50"
        onClick={onOpen}
        disabled={disabled}
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogIn className="h-3.5 w-3.5" />}
        {ready ? 'Open' : 'Connect'}
      </Button>
    </div>
  )
}

function SpotifyStatusPill({ profile }: { profile: SocialAccountProfileStatus }) {
  const artistsReady = profile.spotifyCapabilities?.artists.ready === true
  const webPlayerReady = profile.spotifyCapabilities?.webPlayer.ready === true
  const adsManagerReady = profile.spotifyCapabilities?.adsManager.ready === true
  const allReady = artistsReady && webPlayerReady
  const partlyReady = artistsReady || webPlayerReady
  return (
    <span className={allReady
      ? 'inline-flex items-center gap-1 rounded-full bg-emerald-400/12 px-2 py-1 text-[11px] font-medium text-emerald-200'
      : 'inline-flex items-center gap-1 rounded-full bg-amber-400/12 px-2 py-1 text-[11px] font-medium text-amber-200'}
    >
      {allReady ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
      {allReady ? (adsManagerReady ? 'All ready' : 'Core ready') : partlyReady ? 'Partial setup' : statusLabel(profile.profileStatus)}
    </span>
  )
}

function DeleteSpotifyDialog({
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
  return (
    <Dialog open={Boolean(profile)} onOpenChange={(open) => { if (!open && !busy) onCancel() }}>
      <DialogContent className="dark border-white/10 bg-[#111] text-white sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Delete Spotify account?</DialogTitle>
          <DialogDescription>
            This removes <span className="font-mono text-white/72">spotify/{profile?.profile}</span> from Artist OS. It will no longer be available to Spotify agents.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            className="border-white/12 bg-white/[0.04] text-white/78 hover:bg-white/[0.08] hover:text-white"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="bg-red-500 text-white hover:bg-red-400"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function replaceSpotifyProfile(
  doctor: SocialAccountsDoctorResult | null,
  updated: SocialAccountProfileStatus,
): SocialAccountsDoctorResult | null {
  if (!doctor) return doctor
  return {
    ...doctor,
    platforms: doctor.platforms.map((platform) => ({
      ...platform,
      profiles: platform.profiles.map((profile) =>
        profile.platform === 'spotify' && profile.profile === updated.profile ? updated : profile,
      ),
    })),
  }
}

function statusLabel(status: string | null) {
  if (status === 'login_needed') return 'Login needed'
  if (status === 'identity_unverified') return 'Verify account'
  if (status === 'session_exists_unverified') return 'Verify'
  if (status === 'wrong_account') return 'Wrong account'
  if (status === 'verification_failed') return 'Failed'
  return 'Not ready'
}
