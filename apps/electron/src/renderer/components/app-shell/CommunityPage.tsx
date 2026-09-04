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
import { describeListExport, parseListExport } from '@craft-agent/shared/community/list-export'
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
  CommunityEmailJobRecord,
  CommunitySegment,
  CommunityState,
  ConsentStatus,
  ImportCommunityCsvInput,
} from '../../../shared/types'

type SegmentFilter = CommunitySegment | 'all'
type ImportBasis = ImportCommunityCsvInput['basis']
type PendingImport = {
  csv: string
  filename?: string
  preview: ReturnType<typeof describeListExport>
}
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
  const [pendingImport, setPendingImport] = React.useState<PendingImport | null>(null)
  const [importing, setImporting] = React.useState(false)
  const [addFanOpen, setAddFanOpen] = React.useState(false)
  const [emailQueueOpen, setEmailQueueOpen] = React.useState(true)
  const [mailBusy, setMailBusy] = React.useState<string | null>(null)
  const [emailReady, setEmailReady] = React.useState(true)

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
  const openJobs = emailJobs.filter((job) => job.status !== 'sent' && job.status !== 'cancelled')
  const sentJobs = emailJobs.filter((job) => job.status === 'sent')
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
      const filename = path.split('/').pop()

      // Read the file before writing anything, so the artist sees what this
      // will do to their list rather than finding out from the result.
      const preview = describeListExport(parseListExport(csv, { filename }))
      setPendingImport({ csv, filename, preview })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }, [])

  const confirmImport = React.useCallback(async () => {
    if (!pendingImport) return
    setImporting(true)
    try {
      setCommunity(await window.electronAPI.importCommunityCsv(workspaceId, {
        csv: pendingImport.csv,
        filename: pendingImport.filename,
        basis: importBasis,
      }))
      const { canEmail, needConfirming, willSuppress } = pendingImport.preview
      const parts: string[] = []
      if (canEmail > 0) parts.push(`${canEmail} ready to email`)
      if (needConfirming > 0) parts.push(`${needConfirming} held back until they confirm`)
      if (willSuppress > 0) parts.push(`${willSuppress} added to do-not-email`)
      toast.success(parts.length > 0 ? parts.join(', ') : 'Nothing to import from that file.')
      setPendingImport(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setImporting(false)
    }
  }, [importBasis, pendingImport, workspaceId])

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

          {pendingImport ? (
            <ImportPreview
              preview={pendingImport.preview}
              filename={pendingImport.filename}
              busy={importing}
              onCancel={() => setPendingImport(null)}
              onConfirm={() => void confirmImport()}
            />
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

          <CommunityEmailSetup workspaceId={workspaceId} onReadyChange={setEmailReady} />

          <CommunityRoutineRow
            workspaceId={workspaceId}
            busy={mailBusy}
            onBusy={setMailBusy}
            onChanged={() => void refreshCommunity(false)}
          />

          <div className="mt-4 border-t border-white/[0.045] pt-2">
            <button
              type="button"
              onClick={() => setEmailQueueOpen((open) => !open)}
              aria-expanded={emailQueueOpen}
              className="flex h-9 w-full items-center justify-between gap-3 rounded-[9px] px-2 text-left transition-colors hover:bg-white/[0.025]"
            >
              <div className="flex items-center gap-2">
                <Send className="h-3.5 w-3.5 text-white/40" />
                <h2 className="text-[11px] font-medium uppercase tracking-[0.15em] text-white/50">Ready to send</h2>
              </div>
              <div className="flex items-center gap-2 text-white/28">
                <span className="text-[10px] tabular-nums">{openJobs.length}</span>
                <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', emailQueueOpen && 'rotate-180')} />
              </div>
            </button>
            {emailQueueOpen ? (
              <div className="mt-2 space-y-2 px-2 pb-2">
                {openJobs.length ? openJobs.map((email) => (
                  <EmailProposal
                    key={email.id}
                    job={email}
                    workspaceId={workspaceId}
                    busy={mailBusy}
                    onBusy={setMailBusy}
                    emailReady={emailReady}
                    onChanged={() => void refreshCommunity(false)}
                  />
                )) : (
                  <div className="rounded-[12px] border border-dashed border-white/[0.04] bg-white/[0.01] px-3 py-5 text-center text-[11px] leading-5 text-white/30">
                    Nothing waiting. Your Community Agent puts drafts here when it finds
                    something worth sending.
                  </div>
                )}
                {sentJobs.length > 0 ? (
                  <p className="pt-1 text-[10px] uppercase tracking-[0.12em] text-white/22">
                    {sentJobs.length} already sent
                  </p>
                ) : null}
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

/**
 * What this file will do to the fan list, before it does it.
 *
 * An import is not undoable in any way the artist would recognise, and the
 * numbers that matter are not the ones a success toast usually carries: how
 * many can actually be emailed, and how many are about to be marked
 * do-not-email. Both are shown here, with the file's own warnings, and
 * nothing is written until they press the button.
 */
function ImportPreview({
  preview,
  filename,
  busy,
  onCancel,
  onConfirm,
}: {
  preview: ReturnType<typeof describeListExport>
  filename?: string
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const departures = preview.willSuppress > 0 && preview.willImport === 0
  return (
    <div className={cn(
      'mt-3 rounded-[14px] border p-3',
      departures ? 'border-[#f97316]/30 bg-[#f97316]/[0.06]' : 'border-white/[0.05] bg-black/20',
    )}>
      <p className="text-[13px] font-medium text-white/78">{preview.summary}</p>
      {filename ? <p className="mt-0.5 text-[11px] text-white/28">{filename}</p> : null}

      <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-[11px]">
        <span className="text-white/50">Ready to email <span className="text-white/78">{preview.canEmail}</span></span>
        <span className="text-white/50">Held back <span className="text-white/78">{preview.needConfirming}</span></span>
        {preview.willSuppress > 0 ? (
          <span className="text-white/50">Do-not-email <span className="text-white/78">{preview.willSuppress}</span></span>
        ) : null}
      </div>

      {preview.warnings.length > 0 ? (
        <ul className="mt-2.5 space-y-1">
          {preview.warnings.map((warning) => (
            <li key={warning} className="text-[11px] leading-relaxed text-white/45">{warning}</li>
          ))}
        </ul>
      ) : null}

      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex h-9 items-center rounded-[9px] border border-white/[0.06] px-3 text-xs text-white/55 transition-colors hover:text-white/80"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onConfirm}
          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[9px] bg-[#f97316] px-4 text-xs font-medium text-white transition-colors hover:bg-[#fb8122] disabled:cursor-wait disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          {departures ? 'Add to do-not-email' : 'Import'}
        </button>
      </div>
    </div>
  )
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

// ---------------------------------------------------------------------------
// How often the agent looks for something worth sending
// ---------------------------------------------------------------------------

type CommunityCadence = 'weekly' | 'monthly' | 'manual'

interface CommunityRoutine {
  cadence: CommunityCadence
  dayOfWeek?: number
  dayOfMonth?: number
  hour?: number
  lastRunAt?: string
}

/** Stable name so the schedule can be found and replaced. */
const COMMUNITY_ROUTINE_AUTOMATION = 'Community Check'

const CADENCE_CHOICES: Array<{ value: CommunityCadence; label: string }> = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'manual', label: 'Only when I ask' },
]

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function CommunityRoutineRow({
  workspaceId,
  busy,
  onBusy,
  onChanged,
}: {
  workspaceId: string
  busy: string | null
  onBusy: (key: string | null) => void
  onChanged: () => void
}) {
  const [routine, setRoutine] = React.useState<CommunityRoutine | null>(null)
  const [description, setDescription] = React.useState('')

  const load = React.useCallback(async () => {
    if (!workspaceId) return
    try {
      const result = await window.electronAPI.getCommunityRoutine(workspaceId) as {
        routine?: CommunityRoutine
        description?: string
      }
      setRoutine(result?.routine ?? null)
      setDescription(result?.description ?? '')
    } catch {
      // A missing routine is simply "manual"; nothing to report.
    }
  }, [workspaceId])

  React.useEffect(() => { void load() }, [load])

  /**
   * Keep the stored cadence and the automation that actually fires in step.
   * A preference nothing acts on is worse than no preference.
   */
  const apply = React.useCallback(async (config: Partial<CommunityRoutine> & { cadence: CommunityCadence }) => {
    onBusy('cadence')
    try {
      const saved = await window.electronAPI.setCommunityRoutine(workspaceId, {
        cadence: config.cadence,
        dayOfWeek: config.dayOfWeek ?? routine?.dayOfWeek,
        dayOfMonth: config.dayOfMonth ?? routine?.dayOfMonth,
        hour: config.hour ?? routine?.hour,
      }) as { cron?: string | null }

      const listed = await window.electronAPI.getAutomations(workspaceId) as
        | Array<{ event: string; name?: string; matcherIndex: number }>
        | null
      const existing = (Array.isArray(listed) ? listed : [])
        .find(item => item.event === 'SchedulerTick' && item.name === COMMUNITY_ROUTINE_AUTOMATION)
      if (existing) {
        await window.electronAPI.deleteAutomation(workspaceId, existing.event, existing.matcherIndex)
      }

      if (saved?.cron) {
        await window.electronAPI.createAutomationFromTemplate(workspaceId, 'SchedulerTick', {
          name: COMMUNITY_ROUTINE_AUTOMATION,
          cron: saved.cron,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          permissionMode: 'safe',
          labels: ['community', 'artist-hq', 'scheduled'],
          actions: [{
            type: 'prompt',
            agentSlug: 'community-agent',
            prompt: 'Scheduled community check. Read the list health and what has happened lately, then decide whether anything is genuinely worth emailing the fans about. If nothing is, say so and stop — do not manufacture a reason to write. If something is, draft one email against the right segment and leave it for the artist to review. Never send.',
          }],
        })
      }
      toast.success('Saved.')
      await load()
      onChanged()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save that.')
    } finally {
      onBusy(null)
    }
  }, [load, onBusy, onChanged, routine, workspaceId])

  const cadence = routine?.cadence ?? 'manual'
  const hour = routine?.hour ?? 10

  return (
    <div className="mt-4 border-t border-white/[0.045] pt-3">
      <div className="flex items-start justify-between gap-3 px-2">
        <div>
          <h2 className="text-[11px] font-medium uppercase tracking-[0.15em] text-white/50">Look for something to send</h2>
          <p className="mt-1 max-w-md text-[11px] leading-5 text-white/35">
            Your Community Agent checks what is happening and drafts an email only when
            there is something a fan would actually want. {description}
          </p>
        </div>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => navigate(routes.action.newSession({
            name: 'Community check',
            input: 'Check the fan list and what has happened lately, then tell me whether anything is genuinely worth emailing about. If nothing is, say so. If something is, draft it against the right segment and leave it for me to review.',
          }))}
          className="h-7 shrink-0 rounded-[7px] border border-white/[0.08] px-2.5 text-[11px] text-white/60 transition-colors hover:bg-white/[0.04] disabled:opacity-40"
        >
          Check now
        </button>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 px-2">
        {CADENCE_CHOICES.map(choice => (
          <button
            key={choice.value}
            type="button"
            disabled={busy !== null}
            onClick={() => void apply({ cadence: choice.value })}
            className={cn(
              'h-7 rounded-[7px] px-2.5 text-[11px] transition-colors disabled:opacity-40',
              cadence === choice.value
                ? 'bg-white/90 text-black'
                : 'border border-white/[0.08] text-white/55 hover:bg-white/[0.04]',
            )}
          >
            {choice.label}
          </button>
        ))}

        {cadence !== 'manual' ? (
          <>
            {cadence === 'weekly' ? (
              <select
                value={routine?.dayOfWeek ?? 1}
                disabled={busy !== null}
                onChange={(event) => void apply({ cadence, dayOfWeek: Number(event.target.value) })}
                className="h-7 rounded-[7px] border border-white/[0.08] bg-transparent px-2 text-[11px] text-white/70 outline-none focus:border-white/20"
              >
                {WEEKDAYS.map((name, index) => (
                  <option key={name} value={index} className="bg-neutral-900">{name}</option>
                ))}
              </select>
            ) : (
              <select
                value={routine?.dayOfMonth ?? 1}
                disabled={busy !== null}
                onChange={(event) => void apply({ cadence, dayOfMonth: Number(event.target.value) })}
                className="h-7 rounded-[7px] border border-white/[0.08] bg-transparent px-2 text-[11px] text-white/70 outline-none focus:border-white/20"
              >
                {Array.from({ length: 28 }, (_, index) => index + 1).map(day => (
                  <option key={day} value={day} className="bg-neutral-900">{day}</option>
                ))}
              </select>
            )}
            <select
              value={hour}
              disabled={busy !== null}
              onChange={(event) => void apply({ cadence, hour: Number(event.target.value) })}
              className="h-7 rounded-[7px] border border-white/[0.08] bg-transparent px-2 text-[11px] text-white/70 outline-none focus:border-white/20"
            >
              {Array.from({ length: 24 }, (_, index) => index).map(value => (
                <option key={value} value={value} className="bg-neutral-900">
                  {value % 12 === 0 ? 12 : value % 12}:00 {value < 12 ? 'AM' : 'PM'}
                </option>
              ))}
            </select>
          </>
        ) : null}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// One proposed email: read it, change it, send it
// ---------------------------------------------------------------------------

function EmailProposal({
  job,
  workspaceId,
  busy,
  onBusy,
  emailReady,
  onChanged,
}: {
  job: CommunityEmailJobRecord
  workspaceId: string
  busy: string | null
  onBusy: (key: string | null) => void
  /** False until a verified sender and an unsubscribe link exist. */
  emailReady: boolean
  onChanged: () => void
}) {
  const [open, setOpen] = React.useState(false)
  const [subject, setSubject] = React.useState(job.content.subject)
  const [body, setBody] = React.useState(job.content.bodyMarkdown)
  const [confirming, setConfirming] = React.useState(false)

  const edited = subject !== job.content.subject || body !== job.content.bodyMarkdown
  const recipients = job.audience.estimatedRecipients
  const blocker = !emailReady
    ? 'Finish the email setup above first.'
    : recipients === 0
      ? 'Nobody is in this audience.'
      : !subject.trim() || !body.trim()
        ? 'Needs a subject and a body.'
        : undefined
  const canSend = blocker === undefined

  const act = React.useCallback(async (key: string, run: () => Promise<unknown>, success: string) => {
    onBusy(key)
    try {
      const result = await run() as { ok?: boolean; error?: string }
      if (result?.ok === false) {
        toast.error(String(result.error ?? 'That did not work.'))
        return false
      }
      toast.success(success)
      onChanged()
      return true
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'That did not work.')
      return false
    } finally {
      onBusy(null)
    }
  }, [onBusy, onChanged])

  return (
    <div className="rounded-[13px] border border-white/[0.055] bg-white/[0.025]">
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        aria-expanded={open}
        className="w-full px-3 py-2.5 text-left"
      >
        <div className="flex items-center justify-between gap-3">
          <p className="line-clamp-1 text-[13px] font-medium leading-5 text-white/80">
            {subject || job.title}
          </p>
          <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-white/25 transition-transform', open && 'rotate-180')} />
        </div>
        <div className="mt-1.5 flex items-center gap-2 text-[10px] uppercase tracking-[0.12em] text-white/28">
          <span>{recipients} {recipients === 1 ? 'fan' : 'fans'}</span>
          <span>·</span>
          <span>{job.audience.segmentIds.join(', ') || 'no segment'}</span>
          {job.audience.excludedSuppressed > 0 ? (
            <><span>·</span><span>{job.audience.excludedSuppressed} excluded</span></>
          ) : null}
        </div>
      </button>

      {open ? (
        <div className="border-t border-white/[0.05] px-3 py-3">
          <label className="block text-[10px] uppercase tracking-[0.12em] text-white/30">Subject</label>
          <input
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            className="mt-1 h-8 w-full rounded-[8px] border border-white/[0.08] bg-transparent px-2.5 text-[12px] text-white/85 outline-none focus:border-white/20"
          />

          <label className="mt-3 block text-[10px] uppercase tracking-[0.12em] text-white/30">Email</label>
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={8}
            className="mt-1 w-full resize-y rounded-[8px] border border-white/[0.08] bg-transparent px-2.5 py-2 text-[12px] leading-6 text-white/80 outline-none focus:border-white/20"
          />

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {edited ? (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void act(
                  `save-${job.id}`,
                  () => window.electronAPI.updateCommunityEmailJob(workspaceId, job.id, { subject, bodyMarkdown: body }),
                  'Saved.',
                )}
                className="h-8 rounded-[8px] border border-white/[0.08] px-3 text-[12px] text-white/70 transition-colors hover:bg-white/[0.04] disabled:opacity-40"
              >
                Save changes
              </button>
            ) : null}

            {confirming ? (
              <>
                <span className="text-[11px] text-white/55">
                  Send to {recipients} {recipients === 1 ? 'fan' : 'fans'}?
                </span>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void (async () => {
                    // Save first: sending anything other than what is on screen
                    // would be a lie about what was approved.
                    if (edited) {
                      const saved = await act(
                        `save-${job.id}`,
                        () => window.electronAPI.updateCommunityEmailJob(workspaceId, job.id, { subject, bodyMarkdown: body }),
                        'Saved.',
                      )
                      if (!saved) return
                    }
                    await act(
                      `send-${job.id}`,
                      () => window.electronAPI.sendCommunityEmailJob(workspaceId, job.id),
                      'Sent.',
                    )
                    setConfirming(false)
                  })()}
                  className="inline-flex h-8 items-center gap-1.5 rounded-[8px] bg-emerald-200/90 px-3 text-[12px] font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  <Send className="h-3.5 w-3.5" />
                  {busy === `send-${job.id}` ? 'Sending…' : 'Yes, send it'}
                </button>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => setConfirming(false)}
                  className="text-[11px] text-white/35 hover:text-white/60"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={busy !== null || !canSend}
                title={blocker}
                onClick={() => setConfirming(true)}
                className="inline-flex h-8 items-center gap-1.5 rounded-[8px] bg-emerald-200/90 px-3 text-[12px] font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                <Send className="h-3.5 w-3.5" />
                Send
              </button>
            )}

            {blocker && !confirming ? (
              <span className="text-[11px] text-white/35">{blocker}</span>
            ) : null}

            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void act(
                `cancel-${job.id}`,
                () => window.electronAPI.cancelCommunityEmailJob(workspaceId, job.id),
                'Discarded.',
              )}
              className="ml-auto text-[11px] text-white/30 underline-offset-2 hover:text-white/60 hover:underline disabled:opacity-40"
            >
              Discard
            </button>
          </div>

          <p className="mt-2.5 text-[10px] leading-4 text-white/25">
            Every email carries an unsubscribe link. Fans who unsubscribed after this was
            drafted are dropped automatically at send.
          </p>
        </div>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// What is still missing before fan email can go out
// ---------------------------------------------------------------------------

interface SetupStep {
  id: string
  label: string
  done: boolean
  secret?: boolean
  value?: string
}

interface CommunitySetup {
  ready: boolean
  steps: SetupStep[]
  domain?: { name: string; verified: boolean; note?: string }
  suggestedUnsubscribeUrl?: string
  remaining: number
}

const STEP_HELP: Record<string, { hint: string; placeholder: string; link?: { label: string; url: string } }> = {
  RESEND_API_KEY: {
    hint: 'Resend is the service that actually delivers the email. The free tier covers most artists.',
    placeholder: 're_...',
    link: { label: 'Create a key', url: 'https://resend.com/api-keys' },
  },
  COMMUNITY_FROM_EMAIL: {
    hint: 'The address fans see. It has to use a domain you verified in Resend, not gmail.com.',
    placeholder: 'hello@yourband.com',
    link: { label: 'Verify a domain', url: 'https://resend.com/domains' },
  },
  COMMUNITY_UNSUBSCRIBE_URL: {
    hint: 'Where the unsubscribe link goes. Every email carries one.',
    placeholder: 'https://yourband.com/unsubscribe',
  },
  COMMUNITY_POSTAL_ADDRESS: {
    hint: 'Required by law on bulk email. A PO box is fine; it does not have to be your home.',
    placeholder: 'PO Box 1, Denver CO 80201',
  },
}

/**
 * Shown until fan email can actually be sent, then collapses to a quiet line.
 *
 * Steps rather than one switch: "not set up" is useless to an artist who has
 * already done three of the four things.
 */
function CommunityEmailSetup({
  workspaceId,
  onReadyChange,
}: {
  workspaceId: string
  onReadyChange?: (ready: boolean) => void
}) {
  const [setup, setSetup] = React.useState<CommunitySetup | null>(null)
  const [drafts, setDrafts] = React.useState<Record<string, string>>({})
  const [saving, setSaving] = React.useState<string | null>(null)
  const [expanded, setExpanded] = React.useState(false)

  const load = React.useCallback(async () => {
    if (!workspaceId) return
    try {
      const result = await window.electronAPI.getCommunitySetup(workspaceId) as unknown as CommunitySetup
      setSetup(result)
      onReadyChange?.(Boolean(result?.ready))
    } catch {
      // Setup state is advisory; a failure here must not break the page.
    }
  }, [onReadyChange, workspaceId])

  React.useEffect(() => { void load() }, [load])

  const save = React.useCallback(async (id: string) => {
    const value = (drafts[id] ?? '').trim()
    if (!value) return
    setSaving(id)
    try {
      const result = await window.electronAPI.saveSecret(id, value, workspaceId)
      if (!result.success) {
        toast.error(result.error ?? 'Could not save that.')
        return
      }
      setDrafts(current => ({ ...current, [id]: '' }))
      toast.success('Saved.')
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save that.')
    } finally {
      setSaving(null)
    }
  }, [drafts, load, workspaceId])

  if (!setup) return null

  const domainProblem = setup.domain && !setup.domain.verified

  if (setup.ready && !expanded) {
    return (
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-white/[0.045] px-2 pt-3">
        <p className="text-[11px] text-white/30">
          Sending from {setup.steps.find(step => step.id === 'COMMUNITY_FROM_EMAIL')?.value}
        </p>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="text-[11px] text-white/30 underline-offset-2 hover:text-white/60 hover:underline"
        >
          Change
        </button>
      </div>
    )
  }

  return (
    <div className="mt-4 rounded-[13px] border border-amber-300/15 bg-amber-300/[0.04] p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[12px] font-medium text-white/80">
            {setup.ready ? 'Email settings' : 'Before you can email fans'}
          </h2>
          {!setup.ready ? (
            <p className="mt-1 max-w-md text-[11px] leading-5 text-white/45">
              {setup.remaining} {setup.remaining === 1 ? 'thing' : 'things'} left. This is a one-time
              setup and the free tier covers most artists.
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => navigate(routes.action.newSession({
            name: 'Set up fan email',
            input: 'Walk me through setting up fan email with Resend, step by step. I need an API key, a verified sending domain, an unsubscribe link, and a postal address for the footer. Tell me what each one is for in plain terms, open the pages I need, and wait for me at each step.',
          }))}
          className="h-7 shrink-0 rounded-[7px] bg-white/90 px-2.5 text-[11px] font-medium text-black transition-opacity hover:opacity-90"
        >
          Set up with Resend
        </button>
      </div>

      {domainProblem ? (
        <p className="mt-2.5 rounded-[8px] border border-amber-300/20 bg-amber-300/[0.05] px-2.5 py-2 text-[11px] leading-5 text-amber-100/75">
          {setup.domain?.note}
        </p>
      ) : null}

      <div className="mt-3 space-y-2.5">
        {setup.steps.map(step => {
          const help = STEP_HELP[step.id]
          const suggestion = step.id === 'COMMUNITY_UNSUBSCRIBE_URL' ? setup.suggestedUnsubscribeUrl : undefined
          return (
            <div key={step.id}>
              <div className="flex items-center gap-2">
                <span className={cn(
                  'inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border text-[8px]',
                  step.done ? 'border-emerald-300/40 bg-emerald-300/20 text-emerald-100' : 'border-white/15 text-white/25',
                )}>
                  {step.done ? '✓' : ''}
                </span>
                <span className="text-[11px] font-medium text-white/65">{step.label}</span>
                {step.done && step.value ? (
                  <span className="truncate text-[11px] text-white/30">{step.value}</span>
                ) : null}
                {step.done && step.secret ? (
                  <span className="text-[11px] text-white/30">saved</span>
                ) : null}
                {help?.link ? (
                  <a
                    href={help.link.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="ml-auto text-[11px] text-white/35 underline-offset-2 hover:text-white/70 hover:underline"
                  >
                    {help.link.label}
                  </a>
                ) : null}
              </div>

              {!step.done ? (
                <div className="mt-1.5 pl-[22px]">
                  <p className="text-[11px] leading-5 text-white/35">{help?.hint}</p>
                  <div className="mt-1.5 flex items-center gap-2">
                    <input
                      type={step.secret ? 'password' : 'text'}
                      value={drafts[step.id] ?? ''}
                      onChange={(event) => setDrafts(current => ({ ...current, [step.id]: event.target.value }))}
                      placeholder={help?.placeholder}
                      className="h-7 flex-1 rounded-[7px] border border-white/[0.08] bg-transparent px-2 text-[11px] text-white/80 outline-none placeholder:text-white/20 focus:border-white/20"
                    />
                    <button
                      type="button"
                      disabled={saving !== null || !(drafts[step.id] ?? '').trim()}
                      onClick={() => void save(step.id)}
                      className="h-7 rounded-[7px] border border-white/[0.08] px-2.5 text-[11px] text-white/70 transition-colors hover:bg-white/[0.04] disabled:opacity-40"
                    >
                      {saving === step.id ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                  {suggestion ? (
                    <button
                      type="button"
                      onClick={() => setDrafts(current => ({ ...current, [step.id]: suggestion }))}
                      className="mt-1 text-[10px] text-white/30 underline-offset-2 hover:text-white/60 hover:underline"
                    >
                      Use {suggestion}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>

      {setup.ready ? (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="mt-3 text-[11px] text-white/30 underline-offset-2 hover:text-white/60 hover:underline"
        >
          Done
        </button>
      ) : null}
    </div>
  )
}
