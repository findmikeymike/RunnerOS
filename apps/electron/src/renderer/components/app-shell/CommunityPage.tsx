import * as React from 'react'
import {
  ArrowRight,
  ChevronDown,
  Loader2,
  Mail,
  Menu,
  Plus,
  Send,
  Sparkles,
  Upload,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { navigate, routes } from '@/lib/navigate'
import { useWorkspaceSyncRefresh } from '@/hooks/useWorkspaceSyncRefresh'
import { PeoplePageHeader } from './PeoplePageHeader'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
  StyledDropdownMenuSeparator,
} from '@/components/ui/styled-dropdown'
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
  const [addFanOpen, setAddFanOpen] = React.useState(false)
  const [emailQueueOpen, setEmailQueueOpen] = React.useState(false)

  const refreshCommunity = React.useCallback(async (foreground = true) => {
    if (foreground) setLoading(true)
    try {
      setCommunity(await window.electronAPI.getCommunity(workspaceId))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      if (foreground) setLoading(false)
    }
  }, [workspaceId])

  React.useEffect(() => {
    void refreshCommunity()
  }, [refreshCommunity])
  useWorkspaceSyncRefresh(workspaceId, ['records'], () => refreshCommunity(false))

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
      setAddFanOpen(false)
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
  const selectPeopleView = React.useCallback((view: 'network' | 'community') => {
    if (view === 'community') return
    const nextHash = '#artist-hq/network'
    window.location.hash = nextHash
    navigate(routes.view.allSessions(), { skipAutoSelect: true })
  }, [])

  return (
    <div className="h-full overflow-y-auto bg-[#050505] text-foreground">
      <div className="min-h-full w-full px-5 py-4 xl:px-8 xl:py-5">
        <PeoplePageHeader activeView="community" onSelectView={selectPeopleView} />

        <section className="mt-3 rounded-2xl border border-white/[0.025] bg-[#0C0D0E] p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
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
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={() => setAddFanOpen((open) => !open)}
                aria-expanded={addFanOpen}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-full bg-white/90 px-4 text-xs font-medium text-black transition-colors hover:bg-white"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Fan
                <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', addFanOpen && 'rotate-180')} />
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="Community actions"
                    title="Community actions"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.025] text-white/52 transition-colors hover:bg-white/[0.06] hover:text-white/85"
                  >
                    <Menu className="h-4 w-4" />
                  </button>
                </DropdownMenuTrigger>
                <StyledDropdownMenuContent align="end" sideOffset={6} className="w-60">
                  <StyledDropdownMenuItem onClick={() => navigate(routes.view.sourcesApi('gmail'))}>
                    <Mail />
                    Connect Gmail
                  </StyledDropdownMenuItem>
                  <div className="px-2 py-2">
                    <label className="mb-1.5 block text-[9px] font-medium uppercase tracking-[0.14em] text-white/34">
                      CSV consent
                    </label>
                    <select
                      value={importBasis}
                      onChange={(event) => setImportBasis(event.target.value as ImportBasis)}
                      className="h-8 w-full rounded-[7px] border border-white/[0.08] bg-black/35 px-2 text-[11px] text-white/68 outline-none"
                    >
                      {importBasisOptions.map((option) => (
                        <option key={option.id} value={option.id}>{option.label}</option>
                      ))}
                    </select>
                  </div>
                  <StyledDropdownMenuItem onClick={() => void importCsv()}>
                    <Upload />
                    Import CSV
                  </StyledDropdownMenuItem>
                  <StyledDropdownMenuSeparator />
                  <StyledDropdownMenuItem
                    disabled={draftingEmail}
                    onClick={() => void draftEmail(activeAudience, selectedSegmentIds, true)}
                  >
                    {draftingEmail ? <Loader2 className="animate-spin" /> : <Sparkles />}
                    Draft Email
                  </StyledDropdownMenuItem>
                </StyledDropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {addFanOpen ? (
            <div className="mt-3 rounded-[14px] border border-white/[0.05] bg-black/20 p-3">
              <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
                <Input value={draft.name} placeholder="Name" onChange={(name) => setDraft((value) => ({ ...value, name }))} />
                <Input value={draft.email} placeholder="Email" onChange={(email) => setDraft((value) => ({ ...value, email }))} />
                <select
                  value={draft.segment}
                  onChange={(event) => setDraft((value) => ({ ...value, segment: event.target.value as CommunitySegment }))}
                  className="h-9 w-full rounded-[10px] border border-white/[0.06] bg-black/30 px-3 text-xs text-white/70 outline-none"
                >
                  {segmentFilters.filter((segment) => segment.id !== 'all').map((segment) => (
                    <option key={segment.id} value={segment.id}>{segment.label}</option>
                  ))}
                </select>
                <select
                  value={draft.consentStatus}
                  onChange={(event) => setDraft((value) => ({ ...value, consentStatus: event.target.value as ConsentStatus }))}
                  className="h-9 w-full rounded-[10px] border border-white/[0.06] bg-black/30 px-3 text-xs text-white/70 outline-none"
                >
                  {consentOptions.map((option) => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                </select>
              </div>
              <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                <Input value={draft.city} placeholder="City" onChange={(city) => setDraft((value) => ({ ...value, city }))} />
                <Input value={draft.tags} placeholder="Tags" onChange={(tags) => setDraft((value) => ({ ...value, tags }))} />
              </div>
              <textarea
                value={draft.notes}
                placeholder="Notes"
                onChange={(event) => setDraft((value) => ({ ...value, notes: event.target.value }))}
                className="mt-2 min-h-[70px] w-full resize-none rounded-[10px] border border-white/[0.06] bg-black/25 px-3 py-2 text-xs text-white/70 outline-none placeholder:text-white/24 focus:border-white/14"
              />
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void addFan()}
                  className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[9px] bg-[#f97316] px-4 text-xs font-medium text-white transition-colors hover:bg-[#fb8122] disabled:cursor-wait disabled:opacity-50"
                >
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                  Save Fan
                </button>
              </div>
            </div>
          ) : null}

          <div className="mt-4 border-t border-white/[0.045] pt-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-[11px] font-medium uppercase tracking-[0.15em] text-white/50">Fan List</h2>
                <p className="mt-1 text-xs text-white/32">{contacts.length} saved contact{contacts.length === 1 ? '' : 's'}</p>
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
                <p className="mt-1 text-[11px] text-white/25">Use Add Fan above when you are ready.</p>
              </div>
            )}
          </div>

          <div className="mt-4 border-t border-white/[0.045] pt-2">
            <button
              type="button"
              onClick={() => setEmailQueueOpen((open) => !open)}
              aria-expanded={emailQueueOpen}
              className="flex h-9 w-full items-center justify-between gap-3 rounded-[9px] px-2 text-left transition-colors hover:bg-white/[0.025]"
            >
              <div className="flex items-center gap-2">
                <Send className="h-3.5 w-3.5 text-white/40" />
                <h2 className="text-[11px] font-medium uppercase tracking-[0.15em] text-white/50">Email Queue</h2>
              </div>
              <div className="flex items-center gap-2 text-white/28">
                <span className="text-[10px] tabular-nums">{emailJobs.length}</span>
                <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', emailQueueOpen && 'rotate-180')} />
              </div>
            </button>
            {emailQueueOpen ? (
              <div className="mt-2 space-y-2 px-2 pb-2">
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
            ) : null}
          </div>
        </section>
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
