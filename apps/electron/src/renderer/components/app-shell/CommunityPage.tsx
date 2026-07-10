import * as React from 'react'
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  Download,
  Loader2,
  Mail,
  Plus,
  Send,
  Sparkles,
  Upload,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { navigate, routes } from '@/lib/navigate'
import type {
  CommunityContactRecord,
  CommunitySegment,
  CommunityState,
  ConsentStatus,
  ImportCommunityCsvInput,
} from '../../../shared/types'

type SegmentFilter = CommunitySegment | 'all'
type ImportBasis = ImportCommunityCsvInput['basis']
type FanDraft = {
  name: string
  email: string
  segment: CommunitySegment
  consentStatus: ConsentStatus
  city: string
  notes: string
  tags: string
}
interface CommunityPageProps {
  workspaceId: string
}

const segmentFilters: Array<{ id: SegmentFilter; label: string }> = [
  { id: 'all', label: 'All Fans' },
  { id: 'vip', label: 'VIPs' },
  { id: 'local', label: 'Local' },
  { id: 'buyers', label: 'Buyers' },
  { id: 'street-team', label: 'Street Team' },
  { id: 'general', label: 'General' },
]

const emptyDraft: FanDraft = {
  name: '',
  email: '',
  segment: 'general',
  consentStatus: 'unknown',
  city: '',
  notes: '',
  tags: '',
}
const consentOptions: Array<{ id: ConsentStatus; label: string }> = [
  { id: 'unknown', label: 'Unknown consent' },
  { id: 'opted-in', label: 'Opted in' },
  { id: 'transactional-only', label: 'Transactional only' },
]

const importBasisOptions: Array<{ id: ImportBasis; label: string }> = [
  { id: 'unknown', label: 'Unknown consent' },
  { id: 'existing-list-opt-in', label: 'Existing opt-in list' },
  { id: 'signup-form', label: 'Signup form export' },
]

export function CommunityPage({ workspaceId }: CommunityPageProps) {
  const [activeSegment, setActiveSegment] = React.useState<SegmentFilter>('all')
  const [draft, setDraft] = React.useState<FanDraft>(emptyDraft)
  const [community, setCommunity] = React.useState<CommunityState | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [draftingEmail, setDraftingEmail] = React.useState(false)
  const [importBasis, setImportBasis] = React.useState<ImportBasis>('unknown')

  const refreshCommunity = React.useCallback(async () => {
    setLoading(true)
    try {
      setCommunity(await window.electronAPI.getCommunity(workspaceId))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  React.useEffect(() => {
    void refreshCommunity()
  }, [refreshCommunity])

  const contacts = community?.contacts.filter((fan) => !fan.deletedAt) ?? []
  const emailJobs = community?.emailJobs.filter((job) => !job.deletedAt) ?? []
  const visibleFans = React.useMemo(
    () => activeSegment === 'all'
      ? contacts
      : contacts.filter((fan) => fan.segments.includes(activeSegment)),
    [activeSegment, contacts],
  )
  const addFan = React.useCallback(async () => {
    if (!draft.name.trim() || !draft.email.trim()) {
      toast.error('Add a name and email first.')
      return
    }
    setSaving(true)
    try {
      setCommunity(await window.electronAPI.addCommunityContact(workspaceId, {
        name: draft.name,
        email: draft.email,
        segment: draft.segment,
        source: 'manual',
        city: draft.city,
        notes: draft.notes,
        tags: draft.tags.split(/[;,]/).map((tag) => tag.trim()).filter(Boolean),
        consentStatus: draft.consentStatus,
      })
      )
      setDraft(emptyDraft)
      toast.success('Fan saved to Community')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }, [draft, workspaceId])

  const importCsv = React.useCallback(async () => {
    try {
      const paths = await window.electronAPI.openFileDialog()
      const path = paths[0]
      if (!path) return
      const csv = await window.electronAPI.readFile(path)
      setCommunity(await window.electronAPI.importCommunityCsv(workspaceId, {
        csv,
        filename: path.split('/').pop(),
        basis: importBasis,
      })
      )
      toast.success(importBasis === 'unknown'
        ? 'CSV imported. Unknown-consent contacts are held out of broadcasts.'
        : 'CSV imported with opt-in attestation.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }, [importBasis, workspaceId])

  const queueEmailJob = React.useCallback(async (audienceLabel: string, segmentIds: string[]): Promise<boolean> => {
    try {
      setCommunity(await window.electronAPI.createCommunityEmailJob(workspaceId, {
        title: `${audienceLabel} email`,
        segmentIds,
        purpose: 'newsletter',
        subject: `${audienceLabel} update`,
        bodyMarkdown: '',
        transportProvider: 'gmail',
      })
      )
      return true
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
      return false
    }
  }, [workspaceId])

  const draftEmail = React.useCallback(async (audience: string, segmentIds: string[], createJob: boolean) => {
    setDraftingEmail(true)
    try {
      if (createJob) {
        const queued = await queueEmailJob(audience, segmentIds)
        if (!queued) return
      }
    } finally {
      setDraftingEmail(false)
    }
    navigate(routes.action.newSession({
      name: 'Community email draft',
      input: `Draft a short fan email for ${audience}. Keep it warm, direct, and approval-ready.`,
    }))
  }, [queueEmailJob])

  const selectedSegmentIds = activeSegment === 'all'
    ? ['vip', 'local', 'buyers', 'street-team', 'general']
    : [activeSegment]
  const activeAudience = activeSegment === 'all' ? 'all fans' : `${segmentLabel(activeSegment)} fans`
  const vipCount = contacts.filter((fan) => fan.segments.includes('vip')).length
  const emailReady = contacts.filter((fan) => fan.email?.includes('@') && fan.consentStatus === 'opted-in').length

  return (
    <div className="h-full overflow-y-auto bg-[#050505] text-foreground">
      <div className="min-h-full w-full px-5 py-4 xl:px-8 xl:py-5">
        <header className="relative mb-6 overflow-hidden rounded-[24px] border border-white/[0.05] bg-[#0A0A0A] p-6 lg:p-8">
          <div className="absolute -left-[18%] -top-[50%] h-[520px] w-[520px] rounded-full bg-orange-600/10 blur-[110px]" />
          <div className="absolute -bottom-[50%] -right-[12%] h-[520px] w-[520px] rounded-full bg-orange-500/5 blur-[120px]" />
          <div className="relative z-10 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex-1">
              <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-white/[0.05] bg-white/[0.02] px-3 py-1.5">
                <Users className="h-3.5 w-3.5 text-orange-300/80" />
                <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-white/65">Fan Base</span>
              </div>
              <div className="max-w-3xl">
                <h1 className="text-4xl font-medium tracking-tighter text-white/90 sm:text-5xl lg:text-[56px] lg:leading-[0.96]">
                  Community
                </h1>
                <p className="mt-3 max-w-2xl text-sm font-light leading-relaxed text-white/50">
                  Fans, segments, emails, and outreach jobs for the artist.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => navigate(routes.view.sourcesApi('gmail'))}
                className="inline-flex h-9 items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.035] px-4 text-xs font-medium text-white/68 transition-colors hover:bg-white/[0.06]"
              >
                <Mail className="h-3.5 w-3.5" />
                Connect Gmail
              </button>
              <select
                value={importBasis}
                onChange={(event) => setImportBasis(event.target.value as ImportBasis)}
                className="h-9 rounded-full border border-white/[0.08] bg-white/[0.035] px-3 text-xs font-medium text-white/68 outline-none"
              >
                {importBasisOptions.map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => void importCsv()}
                className="inline-flex h-9 items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.035] px-4 text-xs font-medium text-white/68 transition-colors hover:bg-white/[0.06]"
              >
                <Upload className="h-3.5 w-3.5" />
                Import CSV
              </button>
              <button
                type="button"
                disabled={draftingEmail}
                onClick={() => void draftEmail(activeAudience, selectedSegmentIds, true)}
                className="inline-flex h-9 items-center gap-2 rounded-full bg-[#f97316]/90 px-4 text-xs font-medium text-white transition-colors hover:bg-[#f97316]"
              >
                {draftingEmail ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                Draft Email
              </button>
            </div>
          </div>
        </header>

        <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard label="Fans" value={String(contacts.length)} detail={`${vipCount} VIP`} />
          <MetricCard label="Email Ready" value={String(emailReady)} detail="opted-in addresses" />
          <MetricCard label="Segments" value="5" detail="VIP, local, buyers, street, general" />
          <MetricCard label="Queued" value={String(emailJobs.length)} detail="email jobs" />
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <section className="rounded-[16px] border border-white/[0.05] bg-[#0c0c0c]/80 p-4">
            <div className="mb-4 flex flex-col gap-3 border-b border-white/[0.045] pb-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-[11px] font-medium uppercase tracking-[0.15em] text-white/50">Fan List</h2>
                <p className="mt-1 text-xs text-white/32">Email contacts saved as team-safe community records.</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {segmentFilters.map((segment) => (
                  <button
                    key={segment.id}
                    type="button"
                    onClick={() => setActiveSegment(segment.id)}
                    className={cn(
                      'h-7 rounded-full px-3 text-[11px] font-medium transition-colors',
                      activeSegment === segment.id
                        ? 'bg-white/[0.09] text-white/84'
                        : 'bg-white/[0.025] text-white/40 hover:bg-white/[0.05] hover:text-white/68',
                    )}
                  >
                    {segment.label}
                  </button>
                ))}
              </div>
            </div>

            {loading ? (
              <div className="flex h-48 items-center justify-center text-sm text-white/40">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading Community...
              </div>
            ) : visibleFans.length ? (
              <div className="space-y-1.5">
                {visibleFans.map((fan) => (
                  <FanRow key={fan.id} fan={fan} onDraft={() => void draftEmail(`${fan.name ?? 'this fan'} and similar fans`, fan.segments, true)} />
                ))}
              </div>
            ) : (
              <div className="flex h-48 flex-col items-center justify-center rounded-[12px] border border-dashed border-white/[0.04] bg-white/[0.01] text-center">
                <Users className="mb-2 h-5 w-5 text-white/10" />
                <p className="text-[13px] font-medium text-white/40">No fans saved yet.</p>
                <p className="mt-1 text-[11px] text-white/25">Add the first contact from the panel on the right.</p>
              </div>
            )}
          </section>

          <aside className="space-y-4">
            <section className="rounded-[16px] border border-white/[0.05] bg-[#0c0c0c]/80 p-4">
              <div className="mb-4 flex items-center gap-2 border-b border-white/[0.045] pb-3">
                <Plus className="h-3.5 w-3.5 text-white/40" />
                <h2 className="text-[11px] font-medium uppercase tracking-[0.15em] text-white/50">Add Fan</h2>
              </div>
              <div className="space-y-1.5">
                <Input value={draft.name} placeholder="Name" onChange={(name) => setDraft((value) => ({ ...value, name }))} />
                <Input value={draft.email} placeholder="Email" onChange={(email) => setDraft((value) => ({ ...value, email }))} />
                <select
                  value={draft.segment}
                  onChange={(event) => setDraft((value) => ({ ...value, segment: event.target.value as CommunitySegment }))}
                  className="h-8 w-full rounded-[8px] border border-white/[0.04] bg-white/[0.015] px-3 text-[11px] text-white/70 outline-none focus:border-white/10"
                >
                  {segmentFilters.filter((segment) => segment.id !== 'all').map((segment) => (
                    <option key={segment.id} value={segment.id}>{segment.label}</option>
                  ))}
                </select>
                <select
                  value={draft.consentStatus}
                  onChange={(event) => setDraft((value) => ({ ...value, consentStatus: event.target.value as ConsentStatus }))}
                  className="h-9 w-full rounded-[10px] border border-white/[0.06] bg-white/[0.025] px-3 text-xs text-white/70 outline-none"
                >
                  {consentOptions.map((option) => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                </select>
                <Input value={draft.city} placeholder="City" onChange={(city) => setDraft((value) => ({ ...value, city }))} />
                <Input value={draft.tags} placeholder="Tags" onChange={(tags) => setDraft((value) => ({ ...value, tags }))} />
                <textarea
                  value={draft.notes}
                  placeholder="Notes"
                  onChange={(event) => setDraft((value) => ({ ...value, notes: event.target.value }))}
                  className="min-h-[64px] w-full resize-none rounded-[8px] border border-white/[0.04] bg-white/[0.015] px-3 py-2 text-[11px] text-white/70 outline-none placeholder:text-white/20 focus:border-white/10"
                />
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void addFan()}
                  className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-[8px] bg-orange-500/80 text-[11px] font-medium text-white transition-colors hover:bg-orange-500 disabled:cursor-wait disabled:opacity-50"
                >
                  {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                  Save Fan
                </button>
              </div>
            </section>

            <section className="rounded-[16px] border border-white/[0.05] bg-[#0c0c0c]/80 p-4">
              <div className="mb-4 flex items-center justify-between border-b border-white/[0.045] pb-3">
                <div className="flex items-center gap-2">
                  <Send className="h-3.5 w-3.5 text-white/40" />
                  <h2 className="text-[11px] font-medium uppercase tracking-[0.15em] text-white/50">Email Queue</h2>
                </div>
                <span className="text-[10px] tabular-nums text-white/28">{emailJobs.length}</span>
              </div>
              <div className="space-y-2">
                {emailJobs.length ? emailJobs.map((email) => (
                  <button
                    key={email.id}
                    type="button"
                    onClick={() => void draftEmail(email.title, email.audience.segmentIds, false)}
                    className="group w-full rounded-[13px] border border-white/[0.055] bg-white/[0.025] px-3 py-2.5 text-left transition-colors hover:bg-white/[0.05]"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="line-clamp-1 text-[13px] font-medium leading-5 text-white/70 group-hover:text-white/90">{email.title}</p>
                      <ArrowRight className="h-3.5 w-3.5 text-white/20 transition-colors group-hover:text-white/50" />
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2 text-[10px] uppercase tracking-[0.12em] text-white/28">
                      <span>{email.audience.estimatedRecipients} ready</span>
                      <span>{email.status}</span>
                    </div>
                  </button>
                )) : (
                  <div className="rounded-[12px] border border-dashed border-white/[0.04] bg-white/[0.01] px-3 py-5 text-center text-[11px] text-white/30">
                    No email jobs yet.
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-[16px] border border-white/[0.05] bg-[#0c0c0c]/80 p-4">
              <div className="mb-4 flex items-center gap-2 border-b border-white/[0.045] pb-3">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300/65" />
                <h2 className="text-[11px] font-medium uppercase tracking-[0.15em] text-white/50">Next Moves</h2>
              </div>
              <div className="space-y-1.5">
                <ActionButton icon={Download} label="Export segment" onClick={() => toast.info('Segment export is next.')} />
                <ActionButton icon={Clock3} label="Schedule send" onClick={() => toast.info('Scheduling will use Gmail once connected.')} />
              </div>
            </section>
          </aside>
        </div>
      </div>
    </div>
  )
}

function MetricCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-[14px] border border-white/[0.04] bg-white/[0.015] px-4 py-3 transition-colors hover:bg-white/[0.025]">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-white/40">{label}</p>
      </div>
      <div className="mt-2 flex items-end justify-between gap-3">
        <p className="text-2xl font-medium tracking-tight text-white/90">{value}</p>
        <p className="pb-0.5 text-right text-[11px] text-white/30">{detail}</p>
      </div>
    </div>
  )
}

function segmentLabel(segment: string): string {
  return segmentFilters.find((item) => item.id === segment)?.label ?? segment
}

function FanRow({ fan, onDraft }: { fan: CommunityContactRecord; onDraft: () => void }) {
  const primarySegment = fan.segments[0] ?? 'general'
  return (
    <div className="group/fan grid grid-cols-1 gap-3 rounded-[12px] border border-white/[0.03] bg-white/[0.015] px-3 py-2.5 transition-colors hover:border-white/[0.06] hover:bg-white/[0.03] lg:grid-cols-[minmax(0,1.35fr)_100px_100px_minmax(0,1fr)_90px] lg:items-center">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-white/78">{fan.name ?? 'Unnamed fan'}</p>
        <p className="mt-1 truncate text-xs text-white/36">{fan.email ?? fan.emailHash}</p>
      </div>
      <Badge>{segmentLabel(primarySegment)}</Badge>
      <p className="text-xs text-white/44">{fan.city ?? 'No city'}</p>
      <div className="min-w-0">
        <p className="truncate text-xs text-white/54">{fan.source}</p>
        <p className="mt-1 truncate text-[11px] text-white/30">{fan.notes ?? 'No notes yet'}</p>
      </div>
      <button
        type="button"
        onClick={onDraft}
        className="inline-flex h-7 items-center justify-center gap-1.5 rounded-[8px] bg-white/[0.03] px-2.5 text-[11px] font-medium text-white/50 transition-colors hover:bg-white/[0.06] hover:text-white/90"
      >
        <Mail className="h-3 w-3" />
        Draft
      </button>
    </div>
  )
}

function Input({ value, placeholder, onChange }: { value: string; placeholder: string; onChange: (value: string) => void }) {
  return (
    <input
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      className="h-8 w-full rounded-[8px] border border-white/[0.04] bg-white/[0.015] px-3 text-[11px] text-white/70 outline-none placeholder:text-white/20 focus:border-white/10"
    />
  )
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex h-6 w-fit items-center rounded-full bg-white/[0.03] px-2 text-[9px] font-medium uppercase tracking-[0.12em] text-white/40">
      {children}
    </span>
  )
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-8 w-full items-center gap-2 rounded-[8px] bg-white/[0.015] px-3 text-left text-[11px] font-medium text-white/50 transition-colors hover:bg-white/[0.04] hover:text-white/80"
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  )
}
