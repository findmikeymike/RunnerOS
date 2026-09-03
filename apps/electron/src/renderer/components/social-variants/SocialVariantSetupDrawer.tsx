import * as React from 'react'
import { Check, Loader2, Scissors } from 'lucide-react'
import type {
  SocialAccountRole,
  SocialVariantDestinationIntent,
  SocialVariantPlatform,
  SocialVariantSourceSelection,
} from '@craft-agent/shared/outputs'
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { Button } from '@/components/ui/button'
import { useAppShellContext } from '@/context/AppShellContext'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { buildSocialVariantSetKickoff } from '@/lib/release-kit-repurpose'
import { openVideoRepurposeSession } from '@/lib/video-repurpose-launch'
import { sendAgentDraft } from '@/lib/run-agent'
import { navigate, routes } from '@/lib/navigate'

export interface SocialVariantSetupSource {
  id: string
  title: string
  detail?: string
  selection: SocialVariantSourceSelection
  absolutePath?: string
  sha256?: string
  restriction?: string
}

interface SocialVariantSetupDrawerProps {
  open: boolean
  workspaceId: string
  sources: SocialVariantSetupSource[]
  initialSourceId?: string
  onOpenChange: (open: boolean) => void
  onCreated?: (outputId: string) => void
}

type ReadyProfile = {
  key: string
  platform: SocialVariantPlatform
  profileId: string
  accountSetId?: string
  label: string
}

const PLATFORMS: Array<{ value: SocialVariantPlatform; label: string }> = [
  { value: 'instagram', label: 'Instagram' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'x', label: 'X' },
  { value: 'youtube', label: 'YouTube' },
]

const ROLES: Array<{ value: SocialAccountRole; label: string }> = [
  { value: 'secondary', label: 'Secondary' },
  { value: 'fan-page', label: 'Fan page' },
  { value: 'primary', label: 'Primary' },
]

export function SocialVariantSetupDrawer({
  open,
  workspaceId,
  sources,
  initialSourceId,
  onOpenChange,
  onCreated,
}: SocialVariantSetupDrawerProps) {
  const { onCreateSession, onInputChange, onSendMessage, skills, enabledSources, activeAgents } = useAppShellContext()
  const [selectedIds, setSelectedIds] = React.useState<string[]>([])
  const [variantsPerSource, setVariantsPerSource] = React.useState(2)
  const [platform, setPlatform] = React.useState<SocialVariantPlatform>('instagram')
  const [role, setRole] = React.useState<SocialAccountRole | ''>('')
  const [profileKey, setProfileKey] = React.useState('')
  const [profiles, setProfiles] = React.useState<ReadyProfile[]>([])
  const [trial, setTrial] = React.useState(false)
  const [direction, setDirection] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    const initial = sources.find((source) => source.id === initialSourceId && !source.restriction)
      ?? sources.find((source) => !source.restriction)
    setSelectedIds(initial ? [initial.id] : [])
    setVariantsPerSource(2)
    setPlatform('instagram')
    setRole('')
    setProfileKey('')
    setTrial(false)
    setDirection('')
    let active = true
    void window.electronAPI.listSocialAccounts().then((doctor) => {
      if (!active) return
      setProfiles(doctor.platforms.flatMap((group) => group.profiles.flatMap((profile) => {
        if (profile.platform === 'spotify') return []
        const ready = profile.ready || (profile.localSessionExists && Boolean(profile.accountHandle || profile.accountUrl))
        if (!ready) return []
        const label = `${profile.platform === 'x' ? 'X' : capitalize(profile.platform)} · ${profile.accountHandle || `@${profile.profile}`}`
        return [{
          key: `${profile.platform}\0${profile.profile}\0${profile.accountGroup ?? ''}`,
          platform: profile.platform,
          profileId: profile.profile,
          ...(profile.accountGroup ? { accountSetId: profile.accountGroup } : {}),
          label,
        } satisfies ReadyProfile]
      })))
    }).catch(() => { if (active) setProfiles([]) })
    return () => { active = false }
  }, [initialSourceId, open, sources])

  const selectedSources = sources.filter((source) => selectedIds.includes(source.id))
  const total = selectedSources.length * variantsPerSource
  const overLimit = total > 12
  const selectedProfile = profiles.find((profile) => profile.key === profileKey)

  const toggleSource = (source: SocialVariantSetupSource) => {
    if (source.restriction) return
    setSelectedIds((current) => current.includes(source.id)
      ? current.filter((id) => id !== source.id)
      : current.length >= 5 ? current : [...current, source.id])
  }

  const chooseProfile = (nextKey: string) => {
    setProfileKey(nextKey)
    const profile = profiles.find((candidate) => candidate.key === nextKey)
    if (profile) {
      setPlatform(profile.platform)
      if (profile.platform !== 'instagram') setTrial(false)
    }
  }

  const create = async () => {
    if (!selectedSources.length || !role || overLimit || total < 1) return
    setBusy(true)
    try {
      const destination: SocialVariantDestinationIntent = {
        platform,
        accountRole: role,
        ...(selectedProfile ? {
          profileId: selectedProfile.profileId,
          accountSetId: selectedProfile.accountSetId,
          labelSnapshot: selectedProfile.label,
        } : {}),
        mode: trial ? 'trial' : 'standard',
        ...(trial ? { trialRequested: true as const } : {}),
      }
      const session = await openVideoRepurposeSession({
        workspaceId,
        activeAgents,
        skills,
        sources: enabledSources,
        onCreateSession,
        onInputChange,
        onSendMessage,
        autoSendDraft: false,
        navigateOnCreate: false,
      })
      const created = await window.electronAPI.createSocialVariantSet(workspaceId, {
        editorSessionId: session.id,
        sourceSelections: selectedSources.map((source) => source.selection),
        destinationIntents: [destination],
        variantsPerSource,
        ...(direction.trim() ? { direction: direction.trim() } : {}),
      })
      if (!created.socialVariantSet) throw new Error('The Variant Set was not saved correctly.')
      const started = await window.electronAPI.startSocialVariantSet(workspaceId, {
        outputId: created.id,
        expectedRevision: created.socialVariantSet.revision,
      })
      const kickoff = buildSocialVariantSetKickoff({
        outputId: started.id,
        sources: selectedSources.map((source) => ({
          title: source.title,
          absolutePath: source.absolutePath,
          sha256: source.sha256,
        })),
        variantsPerSource,
        destination,
        direction,
      })
      await sendAgentDraft(onSendMessage, session.id, kickoff, 'Raw Video Editor')
      if (window.location.hash.startsWith('#artist-hq/')) {
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
      }
      navigate(routes.view.allSessions(session.id))
      onCreated?.(started.id)
      onOpenChange(false)
      toast.success(`Creating ${total} video variant${total === 1 ? '' : 's'}`)
    } catch (error) {
      toast.error('Could not start video variants', {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Drawer direction="right" open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DrawerContent className="inset-y-0 right-0 left-auto mt-0 h-full !w-full rounded-none border-l border-white/[0.07] bg-[#080808] text-white sm:!max-w-[480px]">
        <DrawerHeader className="border-b border-white/[0.06] px-5 py-4 text-left">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-orange-500/10 text-orange-200/80"><Scissors className="h-4 w-4" /></div>
            <div>
              <DrawerTitle className="text-base font-medium text-white/88">Create video variants</DrawerTitle>
              <DrawerDescription className="text-xs text-white/38">Choose the footage and direction. Creation starts immediately.</DrawerDescription>
            </div>
          </div>
        </DrawerHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <SetupSection number="1" title="Footage">
            <div className="space-y-1.5">
              {sources.map((source) => {
                const selected = selectedIds.includes(source.id)
                return (
                  <button
                    key={source.id}
                    type="button"
                    disabled={Boolean(source.restriction) || (!selected && selectedIds.length >= 5)}
                    title={source.restriction}
                    onClick={() => toggleSource(source)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-left transition-colors',
                      selected ? 'bg-white/[0.075]' : 'bg-white/[0.025] hover:bg-white/[0.045]',
                      source.restriction && 'cursor-not-allowed opacity-35',
                    )}
                  >
                    <span className={cn('flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border', selected ? 'border-orange-400/70 bg-orange-500/80 text-black' : 'border-white/16')}>
                      {selected ? <Check className="h-3 w-3" /> : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-white/76">{source.title}</span>
                      <span className="block truncate text-[11px] text-white/32">{source.restriction ?? source.detail ?? 'Ready to use'}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          </SetupSection>

          <SetupSection number="2" title="Versions">
            <div className="flex items-center justify-between rounded-[10px] bg-white/[0.025] px-3 py-2.5">
              <div>
                <div className="text-sm text-white/72">Per video</div>
                <div className="text-[11px] text-white/32">Each edit must be materially different.</div>
              </div>
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((count) => (
                  <button key={count} type="button" onClick={() => setVariantsPerSource(count)} className={cn('h-7 w-7 rounded-md text-xs', variantsPerSource === count ? 'bg-white/90 text-black' : 'text-white/45 hover:bg-white/[0.05]')}>{count}</button>
                ))}
              </div>
            </div>
          </SetupSection>

          <SetupSection number="3" title="Intended account">
            <div className="grid grid-cols-2 gap-2">
              <select value={platform} onChange={(event) => { setPlatform(event.target.value as SocialVariantPlatform); setProfileKey(''); if (event.target.value !== 'instagram') setTrial(false) }} className={SELECT_CLASS}>
                {PLATFORMS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
              <select value={role} onChange={(event) => setRole(event.target.value as SocialAccountRole)} className={SELECT_CLASS}>
                <option value="">Choose account role</option>
                {ROLES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </div>
            <select value={profileKey} onChange={(event) => chooseProfile(event.target.value)} className={cn(SELECT_CLASS, 'mt-2 w-full')}>
              <option value="">Choose the exact account later</option>
              {profiles.map((profile) => <option key={profile.key} value={profile.key}>{profile.label}</option>)}
            </select>
            <p className="mt-1.5 text-[10px] leading-4 text-white/26">Account role is your explicit label for how this profile will be used.</p>
            {platform === 'instagram' ? (
              <label className="mt-2 flex items-center justify-between rounded-[10px] bg-white/[0.025] px-3 py-2.5">
                <span><span className="block text-sm text-white/70">Instagram Trial</span><span className="block text-[11px] text-white/32">Off unless you explicitly choose it.</span></span>
                <input type="checkbox" checked={trial} onChange={(event) => setTrial(event.target.checked)} className="h-4 w-4 accent-orange-500" />
              </label>
            ) : null}
          </SetupSection>

          <SetupSection number="4" title="Direction" optional>
            <textarea
              value={direction}
              onChange={(event) => setDirection(event.target.value)}
              maxLength={4000}
              rows={3}
              placeholder="Example: faster openings, intimate moments, clean white captions"
              className="w-full resize-none rounded-[10px] border-0 bg-white/[0.035] px-3 py-2.5 text-sm text-white/75 outline-none ring-1 ring-white/[0.06] placeholder:text-white/24 focus:ring-orange-400/35"
            />
          </SetupSection>
        </div>

        <div className="border-t border-white/[0.06] px-5 py-4">
          <div className="mb-3 flex items-center justify-between text-xs">
            <span className="text-white/36">{selectedSources.length} video{selectedSources.length === 1 ? '' : 's'} × {variantsPerSource}</span>
            <span className={overLimit ? 'text-red-300' : 'font-medium text-white/76'}>{total} total{overLimit ? ' · max 12' : ''}</span>
          </div>
          <Button className="h-10 w-full bg-[#f97316] text-black hover:bg-[#fb923c]" disabled={busy || !selectedSources.length || !role || overLimit} onClick={() => void create()}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Scissors className="mr-2 h-4 w-4" />}
            {busy ? 'Starting…' : `Create ${total || ''} variant${total === 1 ? '' : 's'}`}
          </Button>
          <p className="mt-2 text-center text-[11px] leading-4 text-white/28">No post goes live. You approve the exact post later.</p>
        </div>
      </DrawerContent>
    </Drawer>
  )
}

function SetupSection({ number, title, optional, children }: { number: string; title: string; optional?: boolean; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <div className="mb-2.5 flex items-center gap-2">
        <span className="text-[10px] font-medium tabular-nums text-orange-300/55">{number}</span>
        <h3 className="text-[11px] font-medium uppercase tracking-[0.16em] text-white/48">{title}</h3>
        {optional ? <span className="text-[10px] text-white/24">optional</span> : null}
      </div>
      {children}
    </section>
  )
}

const SELECT_CLASS = 'h-9 rounded-[9px] border-0 bg-white/[0.035] px-2.5 text-xs text-white/68 outline-none ring-1 ring-white/[0.06] focus:ring-orange-400/35'

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}
