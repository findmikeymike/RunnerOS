import * as React from 'react'
import {
  AlertTriangle,
  CalendarClock,
  Check,
  ExternalLink,
  FileText,
  Loader2,
  Megaphone,
  Pencil,
  SkipForward,
  Sparkles,
  X as CloseIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  X_STANDARD_POST_MAX_CHARACTERS,
  isXEditorialSlateStale,
  parseXEditorialSlate,
  xPostCharacterCount,
  xStandardPostLengthError,
  type XEditorialCandidate,
  type XEditorialLane,
  type XEditorialResearchBasis,
  type XEditorialSlate,
} from '@craft-agent/shared/x-editorial'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

interface XEditorialSlatePreviewProps {
  workspaceId: string
  outputId: string
  outputUpdatedAt: string
  content: string
  compact?: boolean
  className?: string
  onPreviewSettled?: (status: 'ready' | 'error') => void
}

const LANE_LABELS: Record<XEditorialLane, string> = {
  worldview: 'Worldview',
  'campaign-adjacent': 'Campaign thread',
  'direct-release': 'Release',
}

const LANE_STYLES: Record<XEditorialLane, string> = {
  worldview: 'bg-white/[0.07] text-white/62',
  'campaign-adjacent': 'bg-orange-400/[0.11] text-orange-200/72',
  'direct-release': 'bg-red-400/[0.11] text-red-200/72',
}

export function XEditorialSlatePreview({
  workspaceId,
  outputId,
  outputUpdatedAt,
  content,
  compact = false,
  className,
  onPreviewSettled,
}: XEditorialSlatePreviewProps) {
  const parsed = React.useMemo(() => parseXEditorialSlate(content), [content])
  const [slate, setSlate] = React.useState<XEditorialSlate | null>(parsed.ok ? parsed.slate : null)
  const [currentOutputUpdatedAt, setCurrentOutputUpdatedAt] = React.useState(outputUpdatedAt)
  const [busyId, setBusyId] = React.useState<string | null>(null)
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [approveAllOpen, setApproveAllOpen] = React.useState(false)

  React.useEffect(() => {
    if (parsed.ok) setSlate(parsed.slate)
    setCurrentOutputUpdatedAt(outputUpdatedAt)
  }, [outputUpdatedAt, parsed])

  React.useEffect(() => {
    onPreviewSettled?.(parsed.ok ? 'ready' : 'error')
  }, [onPreviewSettled, parsed.ok])

  if (!parsed.ok || !slate) {
    return (
      <div className={cn('flex items-start gap-2 rounded-[14px] bg-amber-400/[0.08] px-3 py-3 text-sm text-amber-100/74', className)}>
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300/70" />
        <span>Daily X Slate needs repair: {parsed.ok ? 'Slate data is unavailable.' : parsed.error}</span>
      </div>
    )
  }

  const visible = compact ? slate.candidates.slice(0, 2) : slate.candidates
  const scheduledCount = slate.candidates.filter((candidate) => candidate.status === 'scheduled' || candidate.status === 'posted').length
  const needsDecisionCount = slate.candidates.filter((candidate) => candidate.status === 'proposed').length
  const approvable = slate.candidates.filter((candidate) => approvalBlocker(slate, candidate) === null)
  const stale = isXEditorialSlateStale(slate)

  const mutateCandidate = async (
    candidate: XEditorialCandidate,
    action: 'approve' | 'skip' | 'edit',
    edit?: { text: string; scheduledFor: string | null },
  ) => {
    setBusyId(candidate.id)
    try {
      const result = await window.electronAPI.mutateXEditorialCandidate(workspaceId, {
        outputId,
        candidateId: candidate.id,
        expectedRevision: candidate.revision,
        expectedOutputUpdatedAt: currentOutputUpdatedAt,
        ...(action === 'edit'
          ? { action, text: edit!.text, scheduledFor: edit!.scheduledFor }
          : { action }),
      })
      setSlate(result.slate)
      setCurrentOutputUpdatedAt(result.outputUpdatedAt)
      setEditingId(null)
      toast.success(action === 'approve' ? 'Post approved and scheduled.' : action === 'skip' ? 'Post skipped.' : 'Draft updated. Review it again before approval.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusyId(null)
    }
  }

  const approveAll = async () => {
    if (approvable.length === 0) return
    setApproveAllOpen(false)
    setBusyId('all')
    let nextSlate = slate
    let nextUpdatedAt = currentOutputUpdatedAt
    let approved = 0
    try {
      for (const original of approvable) {
        const candidate = nextSlate.candidates.find((entry) => entry.id === original.id)
        if (!candidate || approvalBlocker(nextSlate, candidate)) continue
        const result = await window.electronAPI.mutateXEditorialCandidate(workspaceId, {
          action: 'approve',
          outputId,
          candidateId: candidate.id,
          expectedRevision: candidate.revision,
          expectedOutputUpdatedAt: nextUpdatedAt,
        })
        approved += 1
        nextSlate = result.slate
        nextUpdatedAt = result.outputUpdatedAt
        setSlate(nextSlate)
        setCurrentOutputUpdatedAt(nextUpdatedAt)
      }
      toast.success(`${approved} post${approved === 1 ? '' : 's'} approved and scheduled.`)
    } catch (error) {
      toast.error(`${approved} scheduled before the next approval stopped: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <>
      <div className={cn('overflow-hidden rounded-[18px] bg-[#0d0d0e] text-white', className)}>
      <header className="relative overflow-hidden px-4 py-4 sm:px-5">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_10%_0%,rgba(249,115,22,0.13),transparent_34%),radial-gradient(circle_at_100%_100%,rgba(239,68,68,0.08),transparent_35%)]" />
        <div className="relative flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.18em] text-white/36">
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-white/[0.075] text-sm text-white/78">𝕏</span>
              Daily editorial slate
            </div>
            <h3 className="mt-3 truncate text-[17px] font-medium tracking-[-0.015em] text-white/88">{slate.title}</h3>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-white/42">{slate.research.summary}</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <div className="flex items-center gap-2 text-[11px] text-white/42">
              <span>{slate.profile.profileId || 'Connect X'}</span>
              <span className="text-white/18">•</span>
              <span>{formatZone(slate.timezone)}</span>
            </div>
            {!compact && approvable.length > 1 && (
              <Button
                size="sm"
                className="h-7 bg-orange-500/90 px-3 text-[11px] text-black hover:bg-orange-400"
                disabled={busyId !== null}
                onClick={() => setApproveAllOpen(true)}
              >
                {busyId === 'all' ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <Check className="mr-1.5 h-3 w-3" />}
                Approve all ready
              </Button>
            )}
          </div>
        </div>
        <div className="relative mt-4 flex flex-wrap gap-2 text-[11px]">
          <SlateMetric icon={FileText} value={`${slate.candidates.length} drafts`} />
          <SlateMetric icon={Sparkles} value={`${needsDecisionCount} need review`} warm={needsDecisionCount > 0} />
          <SlateMetric icon={Check} value={`${scheduledCount} scheduled`} />
          {slate.context.campaignName && (
            <SlateMetric icon={Megaphone} value={`${slate.context.campaignWeight} · ${slate.context.campaignName}`} warm />
          )}
        </div>
      </header>

      {!compact && stale && (
        <div className="mx-4 mb-3 flex items-start gap-2 rounded-xl bg-amber-400/[0.07] px-3 py-2.5 text-[11px] leading-4 text-amber-100/58">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>This slate is over 48 hours old. Refresh anything tied to current events before approving; timeless artist-truth posts can still be used.</span>
        </div>
      )}

      <div className="space-y-2 px-3 pb-3 sm:px-4 sm:pb-4">
        {visible.map((candidate) => (
          <CandidateCard
            key={candidate.id}
            candidate={candidate}
            slate={slate}
            compact={compact}
            busy={busyId === candidate.id || busyId === 'all'}
            editing={editingId === candidate.id}
            onBeginEdit={() => setEditingId(candidate.id)}
            onCancelEdit={() => setEditingId(null)}
            onApprove={() => void mutateCandidate(candidate, 'approve')}
            onSkip={() => void mutateCandidate(candidate, 'skip')}
            onSaveEdit={(edit) => void mutateCandidate(candidate, 'edit', edit)}
          />
        ))}
        {compact && slate.candidates.length > visible.length && (
          <div className="px-2 pt-1 text-xs text-white/35">+{slate.candidates.length - visible.length} more in the slate</div>
        )}
      </div>

      {!compact && slate.research.sources.length > 0 && (
        <footer className="mx-4 border-t border-white/[0.06] px-1 py-3">
          <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.16em] text-white/28">Research used</div>
          <div className="flex flex-wrap gap-2">
            {slate.research.sources.map((source) => (
              <button
                key={source.id}
                type="button"
                className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-white/[0.045] px-2.5 py-1 text-[11px] text-white/48 transition-colors hover:bg-white/[0.075] hover:text-white/70"
                title={source.claim}
                onClick={() => window.electronAPI.openUrl(source.url)}
              >
                <span className="truncate">{source.title}</span>
                <ExternalLink className="h-3 w-3 shrink-0" />
              </button>
            ))}
          </div>
        </footer>
      )}
      </div>

      <Dialog open={approveAllOpen} onOpenChange={setApproveAllOpen}>
        <DialogContent className="max-w-[520px] overflow-hidden border-white/[0.09] bg-[#0a0a0b] p-0 text-white shadow-modal-small">
          <DialogHeader className="border-b border-white/[0.06] px-5 py-4 text-left">
            <DialogTitle className="text-base font-medium text-white/88">Approve and schedule {approvable.length} posts?</DialogTitle>
            <DialogDescription className="text-xs leading-5 text-white/42">
              This authorizes each exact revision and adds it to the calendar at the shown time.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[44vh] space-y-2 overflow-y-auto px-4 py-3">
            {approvable.map((candidate) => (
              <div key={candidate.id} className="rounded-xl bg-white/[0.04] px-3 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <ResearchBasisBadge basis={candidate.researchBasis} />
                  <span className="text-[10px] text-white/32">{formatSchedule(candidate.scheduledFor!, slate.timezone)}</span>
                </div>
                <p className="mt-2 line-clamp-2 text-xs leading-5 text-white/68">{candidate.text}</p>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-white/[0.06] px-4 py-3">
            <Button variant="ghost" size="sm" className="text-white/55" onClick={() => setApproveAllOpen(false)}>Cancel</Button>
            <Button size="sm" className="bg-orange-500 text-black hover:bg-orange-400" onClick={() => void approveAll()}>
              Approve and schedule
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

function CandidateCard({
  candidate,
  slate,
  compact,
  busy,
  editing,
  onBeginEdit,
  onCancelEdit,
  onApprove,
  onSkip,
  onSaveEdit,
}: {
  candidate: XEditorialCandidate
  slate: XEditorialSlate
  compact: boolean
  busy: boolean
  editing: boolean
  onBeginEdit: () => void
  onCancelEdit: () => void
  onApprove: () => void
  onSkip: () => void
  onSaveEdit: (edit: { text: string; scheduledFor: string | null }) => void
}) {
  const [draftText, setDraftText] = React.useState(candidate.text)
  const [draftTime, setDraftTime] = React.useState(() => candidate.scheduledFor ? toDateTimeLocal(candidate.scheduledFor, slate.timezone) : '')
  const blocker = approvalBlocker(slate, candidate)
  const characterCount = xPostCharacterCount(candidate.text)
  const canChange = candidate.status !== 'posted'
  const candidateSources = candidate.sourceIds
    .map((sourceId) => slate.research.sources.find((source) => source.id === sourceId))
    .filter((source): source is XEditorialSlate['research']['sources'][number] => Boolean(source))

  React.useEffect(() => {
    setDraftText(candidate.text)
    setDraftTime(candidate.scheduledFor ? toDateTimeLocal(candidate.scheduledFor, slate.timezone) : '')
  }, [candidate.revision, candidate.scheduledFor, candidate.text, slate.timezone])

  const saveEdit = () => {
    try {
      onSaveEdit({
        text: draftText,
        scheduledFor: draftTime ? zonedLocalToIso(draftTime, slate.timezone) : null,
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <article className="rounded-[14px] bg-white/[0.035] px-3.5 py-3 transition-colors hover:bg-white/[0.05]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', LANE_STYLES[candidate.lane])}>
            {LANE_LABELS[candidate.lane]}
          </span>
          {candidate.format === 'thread' && (
            <span className="text-[10px] text-white/30">Draft thread · {candidate.thread?.length ?? 0} posts</span>
          )}
          {candidate.asset && (
            <span className="max-w-[220px] truncate text-[10px] text-white/34" title={candidate.asset.label}>
              Media · {candidate.asset.label}
            </span>
          )}
          <ResearchBasisBadge basis={candidate.researchBasis} />
          <CandidateStatus status={candidate.status} />
        </div>
        <div className="flex shrink-0 items-center gap-2.5 text-[10px] text-white/34">
          <span className={cn(characterCount > X_STANDARD_POST_MAX_CHARACTERS && 'text-amber-200/70')}>
            {characterCount}/{X_STANDARD_POST_MAX_CHARACTERS}
          </span>
          <span className="flex items-center gap-1.5">
            <CalendarClock className="h-3 w-3" />
            {candidate.scheduledFor ? formatSchedule(candidate.scheduledFor, slate.timezone) : 'Time needed'}
          </span>
        </div>
      </div>

      {editing ? (
        <div className="mt-3 space-y-2.5">
          <textarea
            value={draftText}
            rows={5}
            autoFocus
            className="w-full resize-y rounded-xl bg-black/40 px-3 py-2.5 text-[13px] leading-[1.55] text-white/82 outline-none ring-1 ring-white/[0.09] placeholder:text-white/25 focus:ring-orange-400/35"
            onChange={(event) => setDraftText(event.target.value)}
          />
          <div className={cn(
            'text-right text-[10px] text-white/28',
            xPostCharacterCount(draftText) > X_STANDARD_POST_MAX_CHARACTERS && 'text-amber-200/70',
          )}>
            {xPostCharacterCount(draftText)}/{X_STANDARD_POST_MAX_CHARACTERS}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-[11px] text-white/38">
              Publish in {formatZone(slate.timezone)}
              <input
                type="datetime-local"
                value={draftTime}
                className="rounded-lg bg-black/40 px-2.5 py-1.5 text-xs text-white/72 outline-none ring-1 ring-white/[0.09] focus:ring-orange-400/35"
                onChange={(event) => setDraftTime(event.target.value)}
              />
            </label>
            <div className="ml-auto flex items-center gap-2">
              <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px] text-white/48" disabled={busy} onClick={onCancelEdit}>
                <CloseIcon className="mr-1 h-3 w-3" /> Cancel
              </Button>
              <Button size="sm" className="h-7 bg-white/90 px-3 text-[11px] text-black hover:bg-white" disabled={busy || !draftText.trim()} onClick={saveEdit}>
                {busy && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                Save draft
              </Button>
            </div>
          </div>
          {candidate.scheduledWorkId && <p className="text-[10px] text-amber-100/48">Saving cancels the old schedule. The revised post must be approved again.</p>}
        </div>
      ) : (
        <>
          <p className="mt-3 whitespace-pre-wrap text-[13px] leading-[1.55] text-white/76">{candidate.text}</p>
          {candidate.format === 'thread' && candidate.thread && (
            <div className="mt-2 space-y-1.5 pl-3">
              {candidate.thread.slice(1).map((part, index) => (
                <p key={index} className="border-l border-white/[0.08] pl-3 text-xs leading-5 text-white/48">{part}</p>
              ))}
            </div>
          )}
        </>
      )}

      <div className="mt-3 flex flex-wrap items-end justify-between gap-2">
        <p className="max-w-2xl text-[11px] leading-4 text-white/34">
          <span className="text-white/46">Why this fits:</span> {candidate.rationale}
        </p>
        <span className="shrink-0 text-[10px] text-white/26">{timingLabel(candidate.timingBasis)}</span>
      </div>

      {!compact && candidateSources.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] text-white/24">Sources</span>
          {candidateSources.map((source) => (
            <button
              key={source.id}
              type="button"
              className="inline-flex max-w-[220px] items-center gap-1 rounded-full bg-white/[0.04] px-2 py-0.5 text-[10px] text-white/38 transition-colors hover:bg-white/[0.07] hover:text-white/62"
              title={source.claim}
              onClick={() => window.electronAPI.openUrl(source.url)}
            >
              <span className="truncate">{source.title}</span>
              <ExternalLink className="h-2.5 w-2.5 shrink-0" />
            </button>
          ))}
        </div>
      )}

      {candidate.attentionMessage && (
        <div className="mt-2.5 flex items-start gap-2 rounded-lg bg-amber-400/[0.07] px-2.5 py-2 text-[11px] leading-4 text-amber-100/58">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          {candidate.attentionMessage}
        </div>
      )}
      {candidate.receipt && (
        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-emerald-400/[0.055] px-2.5 py-2 text-[11px] text-emerald-100/55">
          <span>{candidate.receipt.summary}</span>
          {candidate.receipt.externalUrl && (
            <button
              type="button"
              className="inline-flex items-center gap-1 text-emerald-100/68 hover:text-emerald-100"
              onClick={() => window.electronAPI.openUrl(candidate.receipt!.externalUrl!)}
            >
              View post <ExternalLink className="h-3 w-3" />
            </button>
          )}
        </div>
      )}

      {!compact && !editing && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/[0.055] pt-2.5">
          {blocker && candidate.status === 'proposed' && (
            <span className="mr-auto text-[10px] text-amber-100/45">{blocker}</span>
          )}
          {!blocker && <span className="mr-auto text-[10px] text-white/28">Approval schedules this exact revision.</span>}
          {canChange && (
            <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px] text-white/48 hover:text-white/75" disabled={busy} onClick={onBeginEdit}>
              <Pencil className="mr-1 h-3 w-3" /> Edit
            </Button>
          )}
          {canChange && candidate.status !== 'skipped' && (
            <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px] text-white/38 hover:text-white/65" disabled={busy} onClick={onSkip}>
              <SkipForward className="mr-1 h-3 w-3" /> Skip
            </Button>
          )}
          {candidate.status === 'proposed' && (
            <Button
              size="sm"
              className="h-7 bg-orange-500/90 px-3 text-[11px] text-black hover:bg-orange-400 disabled:bg-white/[0.07] disabled:text-white/24"
              disabled={busy || Boolean(blocker)}
              title={blocker ?? 'Approve and schedule this exact post'}
              onClick={onApprove}
            >
              {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Check className="mr-1 h-3 w-3" />}
              Approve
            </Button>
          )}
        </div>
      )}
    </article>
  )
}

function approvalBlocker(slate: XEditorialSlate, candidate: XEditorialCandidate): string | null {
  if (candidate.status !== 'proposed') return 'Already decided'
  if (!slate.profile.profileId.trim()) return 'Connect X before approval'
  if (candidate.format === 'thread') return 'Thread stays draft-only in this version'
  const lengthError = xStandardPostLengthError(candidate.text)
  if (lengthError) return `${lengthError} for a standard X post`
  if (!candidate.scheduledFor) return 'Choose a publish time'
  if (Date.parse(candidate.scheduledFor) <= Date.now()) return 'Choose a future publish time'
  return null
}

const RESEARCH_BASIS_LABELS: Record<XEditorialResearchBasis, string> = {
  'artist-truth': 'Artist truth',
  'cited-research': 'Researched',
  mixed: 'Artist + research',
}

function ResearchBasisBadge({ basis }: { basis: XEditorialResearchBasis }) {
  return (
    <span className={cn(
      'rounded-full px-2 py-0.5 text-[10px] font-medium',
      basis === 'artist-truth' && 'bg-violet-400/[0.08] text-violet-100/50',
      basis === 'cited-research' && 'bg-sky-400/[0.08] text-sky-100/50',
      basis === 'mixed' && 'bg-orange-400/[0.08] text-orange-100/52',
    )}>
      {RESEARCH_BASIS_LABELS[basis]}
    </span>
  )
}

function SlateMetric({ icon: Icon, value, warm = false }: {
  icon: React.ComponentType<{ className?: string }>
  value: string
  warm?: boolean
}) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 rounded-full bg-white/[0.045] px-2.5 py-1 text-white/42',
      warm && 'bg-orange-400/[0.08] text-orange-100/55',
    )}>
      <Icon className="h-3 w-3" />
      {value}
    </span>
  )
}

function CandidateStatus({ status }: { status: XEditorialCandidate['status'] }) {
  if (status === 'proposed') return null
  const label = status === 'needs-attention' ? 'Needs attention' : status[0]!.toUpperCase() + status.slice(1)
  return (
    <span className={cn(
      'text-[10px] text-white/34',
      status === 'posted' && 'text-emerald-200/55',
      status === 'needs-attention' && 'text-amber-200/60',
    )}>
      {label}
    </span>
  )
}

function formatSchedule(value: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(value))
  } catch {
    return value
  }
}

function toDateTimeLocal(value: string, timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(value))
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value ?? ''
    return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`
  } catch {
    return ''
  }
}

function zonedLocalToIso(value: string, timezone: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value)
  if (!match) throw new Error('Choose a valid publish date and time.')
  const desiredUtc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]))
  let guess = desiredUtc
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const observed = toDateTimeLocal(new Date(guess).toISOString(), timezone)
    const observedMatch = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(observed)
    if (!observedMatch) throw new Error('Could not interpret that time in the slate timezone.')
    const observedUtc = Date.UTC(Number(observedMatch[1]), Number(observedMatch[2]) - 1, Number(observedMatch[3]), Number(observedMatch[4]), Number(observedMatch[5]))
    guess += desiredUtc - observedUtc
  }
  const result = new Date(guess).toISOString()
  if (toDateTimeLocal(result, timezone) !== value) {
    throw new Error('That local time does not exist in the slate timezone. Choose another time.')
  }
  return result
}

function formatZone(timezone: string): string {
  return timezone.split('/').at(-1)?.replaceAll('_', ' ') ?? timezone
}

function timingLabel(basis: XEditorialCandidate['timingBasis']): string {
  if (basis === 'account-analytics') return 'Based on account analytics'
  if (basis === 'known-audience') return 'Based on known audience behavior'
  if (basis === 'campaign-constraint') return 'Campaign-timed'
  return 'Editorial default'
}
