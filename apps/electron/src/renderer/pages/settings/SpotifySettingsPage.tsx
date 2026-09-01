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
import { SettingsCard, SettingsSection } from '@/components/settings'
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
  const [addOpen, setAddOpen] = React.useState(false)
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
      setAddOpen(false)
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
        <div className="space-y-5 p-6">
          <SettingsSection
            title="Spotify"
            description="Connect artist data, playlists, and ads separately for each account."
            action={(
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label="Refresh Spotify accounts"
                title="Refresh"
                className="h-8 w-8 p-0 text-white/42 hover:bg-white/[0.06] hover:text-white/76"
                onClick={load}
                disabled={busy === 'load'}
              >
                {busy === 'load' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5" />}
              </Button>
            )}
          >
            <div className="space-y-2">
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
              {profiles.length === 0 && busy !== 'load' ? (
                <p className="rounded-xl bg-white/[0.025] px-4 py-5 text-sm text-white/46">Add a Spotify account to connect its tools.</p>
              ) : null}
            </div>
          </SettingsSection>

          {profiles.length > 0 && !addOpen ? (
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="inline-flex h-8 items-center gap-1.5 rounded-[8px] px-2 text-xs font-medium text-white/42 transition-colors hover:bg-white/[0.04] hover:text-white/72"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Spotify account
            </button>
          ) : null}

          {profiles.length === 0 || addOpen ? (
            <SettingsSection title="Add Spotify Account">
              <SettingsCard className="!border-0 shadow-none">
                <div className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
                  <input
                    aria-label="Spotify account name"
                    value={newProfile}
                    placeholder={profiles.length === 0 ? DEFAULT_PROFILE : 'Account name'}
                    onChange={(event) => setNewProfile(event.target.value)}
                    className="h-9 min-w-0 flex-1 rounded-[8px] border border-white/[0.07] bg-white/[0.035] px-3 text-sm text-white outline-none placeholder:text-white/24 focus:border-white/15"
                  />
                  <div className="flex items-center gap-2">
                    {profiles.length > 0 ? (
                      <Button type="button" variant="ghost" size="sm" onClick={() => setAddOpen(false)} className="text-white/42 hover:text-white/72">
                        Cancel
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      onClick={addAccount}
                      disabled={busy === 'add'}
                      className="bg-white text-black hover:bg-white/90"
                    >
                      {busy === 'add' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                      Add Account
                    </Button>
                  </div>
                </div>
              </SettingsCard>
            </SettingsSection>
          ) : null}

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
    <SettingsCard divided={false} className="!border-0 bg-[#0d0d0f] shadow-none">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-[#1ED760]/10 text-[#1ED760]/85">
              <Music2 className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-sm font-semibold text-white/86">{profile.profile}</p>
                <SpotifyStatusPill profile={profile} />
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 gap-1.5 px-2.5 text-xs text-white/50 hover:bg-white/[0.055] hover:text-white/78"
              onClick={onVerify}
              disabled={accountBusy}
            >
              {busy === `${profile.profile}:verify` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
              Verify
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label="Copy account reference"
              title="Copy account reference"
              className="h-8 w-8 p-0 text-white/34 hover:bg-white/[0.055] hover:text-white/70"
              onClick={copyAgentRef}
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label="Delete Spotify account"
              title="Delete account"
              className="h-8 w-8 p-0 text-white/28 hover:bg-red-400/[0.08] hover:text-red-200/80"
              onClick={onDelete}
              disabled={accountBusy}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        <div className="divide-y divide-white/[0.055] border-t border-white/[0.055]">
          <SpotifyCapabilityRow
            label="Spotify for Artists"
            purpose="Artist analytics"
            capability={capabilities?.artists}
            busy={busy === `${profile.profile}:login:artists`}
            disabled={accountBusy}
            onOpen={() => onLogin('artists')}
          />
          <SpotifyCapabilityRow
            label="Spotify Web Player"
            purpose="Playlist creation"
            capability={capabilities?.webPlayer}
            busy={busy === `${profile.profile}:login:web-player`}
            disabled={accountBusy}
            onOpen={() => onLogin('web-player')}
          />
          <SpotifyCapabilityRow
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

function SpotifyCapabilityRow({
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
    <div className="flex min-h-[58px] flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1 sm:flex sm:items-baseline sm:gap-3">
        <p className="truncate text-sm font-medium text-white/78">{label}</p>
        <p className="mt-0.5 truncate text-xs text-white/34 sm:mt-0">{purpose}</p>
      </div>
      <div className="flex items-center justify-between gap-3 sm:justify-end">
        <span
          className={ready
            ? 'inline-flex min-w-[94px] items-center gap-1.5 text-xs font-medium text-emerald-200/80'
            : checked
              ? 'inline-flex min-w-[94px] items-center gap-1.5 text-xs font-medium text-amber-200/70'
              : 'inline-flex min-w-[94px] items-center gap-1.5 text-xs font-medium text-white/34'}
          title={capability?.message}
        >
          {ready
            ? <CheckCircle2 className="h-3.5 w-3.5" />
            : checked
              ? <XCircle className="h-3.5 w-3.5" />
              : <CircleDashed className="h-3.5 w-3.5" />}
          {ready ? 'Connected' : checked ? statusLabel(capability.status) : 'Not connected'}
        </span>
        <Button
          type="button"
          size="sm"
          variant={ready ? 'ghost' : 'secondary'}
          className={ready
            ? 'h-8 min-w-[88px] shrink-0 text-white/52 hover:bg-white/[0.055] hover:text-white/78'
            : 'h-8 min-w-[88px] shrink-0 bg-white text-black hover:bg-white/90 disabled:text-black/50'}
          onClick={onOpen}
          disabled={disabled}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogIn className="h-3.5 w-3.5" />}
          {ready ? 'Open' : 'Connect'}
        </Button>
      </div>
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
