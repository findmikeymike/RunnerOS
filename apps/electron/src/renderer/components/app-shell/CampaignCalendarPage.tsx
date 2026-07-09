import * as React from 'react'
import { CalendarDays, CheckCircle2, Pencil, RotateCcw, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useWorkspaceContext } from '@/hooks/useWorkspaceContext'
import {
  CAMPAIGN_CALENDAR_CONTEXT_SLUG,
  activeCampaignCalendarItems,
  approveCampaignCalendarItem,
  campaignCalendarMetadata,
  createCampaignCalendarItem,
  isLiveExternalActionType,
  parseCampaignCalendarDocResult,
  requeueCampaignScheduledJob,
  serializeCampaignCalendarBody,
  updateCampaignCalendarItem,
  type CampaignCalendar,
  type CampaignCalendarItem,
  type CampaignCalendarItemKind,
  type CampaignCalendarItemStatus,
} from '@/lib/campaign-calendar'
import {
  CalendarMonthGrid,
  parseDateKey,
  toDateKey,
  type CalendarMonthDayMeta,
} from './CalendarMonthGrid'

type CampaignCalendarDraft = {
  title: string
  date: string
  time: string
  kind: CampaignCalendarItemKind
  status: CampaignCalendarItemStatus
  notes: string
}

const todayKey = toDateKey(new Date())

const emptyCampaignCalendarDraft = (date = todayKey): CampaignCalendarDraft => ({
  title: '',
  date,
  time: '',
  kind: 'manual',
  status: 'scheduled',
  notes: '',
})

export function CampaignCalendarPage({ workspaceId }: { workspaceId: string }) {
  const { docs, upsert } = useWorkspaceContext(workspaceId)
  const savedCampaignCalendarResult = React.useMemo(
    () => parseCampaignCalendarDocResult(docs.find((item) => item.slug === CAMPAIGN_CALENDAR_CONTEXT_SLUG), workspaceId || 'workspace'),
    [docs, workspaceId],
  )
  const [optimisticCampaignCalendar, setOptimisticCampaignCalendar] = React.useState<CampaignCalendar | null>(null)
  const campaignCalendar = optimisticCampaignCalendar ?? savedCampaignCalendarResult.calendar
  const activeCalendarItems = React.useMemo(
    () => activeCampaignCalendarItems(campaignCalendar.items),
    [campaignCalendar.items],
  )
  const [selectedCalendarDate, setSelectedCalendarDate] = React.useState(todayKey)
  const [visibleCalendarMonth, setVisibleCalendarMonth] = React.useState(() => parseDateKey(todayKey))
  const [calendarDraft, setCalendarDraft] = React.useState<CampaignCalendarDraft>(() => emptyCampaignCalendarDraft(todayKey))
  const [calendarEditId, setCalendarEditId] = React.useState<string | null>(null)
  const [calendarEditDraft, setCalendarEditDraft] = React.useState<CampaignCalendarDraft>(() => emptyCampaignCalendarDraft(todayKey))
  const selectedDateCalendarItems = React.useMemo(
    () => activeCalendarItems.filter((item) => item.date === selectedCalendarDate),
    [activeCalendarItems, selectedCalendarDate],
  )
  const nextCalendarDate = React.useMemo(() => {
    const nextItem = [...activeCalendarItems]
      .filter((item) => item.date >= todayKey)
      .sort((a, b) => `${a.date} ${a.time ?? ''}`.localeCompare(`${b.date} ${b.time ?? ''}`))[0]
    return nextItem
      ? parseDateKey(nextItem.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : 'No upcoming items'
  }, [activeCalendarItems])

  React.useEffect(() => {
    if (docs.some((item) => item.slug === CAMPAIGN_CALENDAR_CONTEXT_SLUG)) setOptimisticCampaignCalendar(null)
  }, [docs])

  const saveCampaignCalendar = React.useCallback(
    async (nextCalendar: CampaignCalendar) => {
      setOptimisticCampaignCalendar(nextCalendar)
      try {
        await upsert({
          slug: CAMPAIGN_CALENDAR_CONTEXT_SLUG,
          metadata: campaignCalendarMetadata(),
          body: serializeCampaignCalendarBody(nextCalendar),
        })
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err))
      }
    },
    [upsert],
  )

  const addCampaignCalendarItem = React.useCallback(() => {
    if (!calendarDraft.title.trim()) {
      toast.error('Add a title first.')
      return
    }
    const item = createCampaignCalendarItem({
      campaignId: workspaceId || 'workspace',
      date: calendarDraft.date || selectedCalendarDate,
      time: calendarDraft.time,
      title: calendarDraft.title,
      notes: calendarDraft.notes,
      kind: calendarDraft.kind,
      status: calendarDraft.status,
    })
    void saveCampaignCalendar({
      version: 1,
      campaignId: campaignCalendar.campaignId || workspaceId || 'workspace',
      items: [...campaignCalendar.items, item],
      updatedAt: new Date().toISOString(),
    })
    setSelectedCalendarDate(item.date)
    setCalendarDraft(emptyCampaignCalendarDraft(item.date))
  }, [calendarDraft, campaignCalendar.campaignId, campaignCalendar.items, saveCampaignCalendar, selectedCalendarDate, workspaceId])

  const openCampaignCalendarItemEdit = React.useCallback((item: CampaignCalendarItem) => {
    setCalendarEditId(item.id)
    setCalendarEditDraft({
      title: item.title,
      date: item.date,
      time: item.time ?? '',
      kind: item.kind,
      status: item.status,
      notes: item.notes ?? '',
    })
  }, [])

  const cancelCampaignCalendarItemEdit = React.useCallback(() => {
    setCalendarEditId(null)
    setCalendarEditDraft(emptyCampaignCalendarDraft(selectedCalendarDate))
  }, [selectedCalendarDate])

  const saveCampaignCalendarItemEdit = React.useCallback((itemId: string) => {
    if (!calendarEditDraft.title.trim()) {
      toast.error('Add a title first.')
      return
    }
    const nextItems = campaignCalendar.items.map((item) => item.id === itemId
      ? updateCampaignCalendarItem(item, {
          title: calendarEditDraft.title,
          date: calendarEditDraft.date,
          time: calendarEditDraft.time,
          kind: calendarEditDraft.kind,
          status: calendarEditDraft.status,
          notes: calendarEditDraft.notes,
        })
      : item)
    void saveCampaignCalendar({
      version: 1,
      campaignId: campaignCalendar.campaignId || workspaceId || 'workspace',
      items: nextItems,
      updatedAt: new Date().toISOString(),
    })
    setSelectedCalendarDate(calendarEditDraft.date)
    cancelCampaignCalendarItemEdit()
  }, [calendarEditDraft, campaignCalendar.campaignId, campaignCalendar.items, cancelCampaignCalendarItemEdit, saveCampaignCalendar, workspaceId])

  const deleteCampaignCalendarItem = React.useCallback((itemId: string) => {
    const now = new Date().toISOString()
    void saveCampaignCalendar({
      version: 1,
      campaignId: campaignCalendar.campaignId || workspaceId || 'workspace',
      items: campaignCalendar.items.map((item) => item.id === itemId ? { ...item, deletedAt: now, updatedAt: now } : item),
      updatedAt: now,
    })
  }, [campaignCalendar.campaignId, campaignCalendar.items, saveCampaignCalendar, workspaceId])

  const patchCampaignCalendarItem = React.useCallback((itemId: string, patcher: (item: CampaignCalendarItem) => CampaignCalendarItem) => {
    const now = new Date().toISOString()
    let patchedTitle: string | undefined
    const nextItems = campaignCalendar.items.map((item) => {
      if (item.id !== itemId) return item
      const next = patcher(item)
      patchedTitle = next.title
      return next
    })
    void saveCampaignCalendar({
      version: 1,
      campaignId: campaignCalendar.campaignId || workspaceId || 'workspace',
      items: nextItems,
      updatedAt: now,
    })
    if (patchedTitle) toast.success(`Updated ${patchedTitle}.`)
  }, [campaignCalendar.campaignId, campaignCalendar.items, saveCampaignCalendar, workspaceId])

  const approveCampaignCalendarJob = React.useCallback((itemId: string) => {
    patchCampaignCalendarItem(itemId, (item) => approveCampaignCalendarItem(item, {
      campaignId: campaignCalendar.campaignId || workspaceId || 'workspace',
      now: new Date().toISOString(),
    }))
  }, [campaignCalendar.campaignId, patchCampaignCalendarItem, workspaceId])

  const requeueCampaignCalendarJob = React.useCallback((itemId: string) => {
    patchCampaignCalendarItem(itemId, requeueCampaignScheduledJob)
  }, [patchCampaignCalendarItem])

  return (
    <div className="h-full overflow-y-auto bg-[#050505] text-foreground">
      <div className="mx-auto flex min-h-full w-full max-w-[1600px] flex-col gap-3 px-5 py-4 xl:px-8 xl:py-5">
        <section className="relative overflow-hidden rounded-[24px] border border-white/[0.05] bg-[#0A0A0A] p-6 lg:p-8">
          <div className="absolute -left-[18%] -top-[50%] h-[520px] w-[520px] rounded-full bg-indigo-600/10 blur-[110px]" />
          <div className="absolute -bottom-[50%] -right-[12%] h-[520px] w-[520px] rounded-full bg-purple-500/5 blur-[120px]" />
          <div className="relative z-10">
            <div className="flex items-start justify-between gap-4">
              <div className="inline-flex items-center gap-2.5 rounded-full border border-white/[0.05] bg-white/[0.02] px-3 py-1.5 pr-4">
                <CalendarDays className="h-3.5 w-3.5 text-white/58" />
                <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-white/70">Schedule</span>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-white/35">Next</p>
                <p className="mt-1.5 text-xs font-medium text-white/70">{nextCalendarDate}</p>
              </div>
            </div>

            <div className="mt-8 max-w-3xl">
              <h1 className="text-4xl font-medium tracking-tighter text-white/90 sm:text-5xl lg:text-[56px] lg:leading-[0.96]">
                Calendar
              </h1>
              <p className="mt-3 max-w-2xl text-sm font-light leading-relaxed text-white/50">
                Campaign-scoped schedule, deadlines, reviews, and important release checkpoints.
              </p>
            </div>
          </div>
        </section>

        <CampaignCalendarSurface
          items={activeCalendarItems}
          selectedDate={selectedCalendarDate}
          visibleMonth={visibleCalendarMonth}
          draft={calendarDraft}
          selectedDateItems={selectedDateCalendarItems}
          editingItemId={calendarEditId}
          editDraft={calendarEditDraft}
          disabled={!savedCampaignCalendarResult.ok}
          parseError={savedCampaignCalendarResult.ok ? undefined : savedCampaignCalendarResult.error}
          onSelectDate={(date) => {
            setSelectedCalendarDate(date)
            setCalendarDraft((current) => ({ ...current, date }))
          }}
          onChangeMonth={setVisibleCalendarMonth}
          onChangeDraft={setCalendarDraft}
          onChangeEditDraft={setCalendarEditDraft}
          onEditItem={openCampaignCalendarItemEdit}
          onCancelEditItem={cancelCampaignCalendarItemEdit}
          onSaveEditItem={saveCampaignCalendarItemEdit}
          onAddItem={addCampaignCalendarItem}
          onApproveItem={approveCampaignCalendarJob}
          onRequeueItem={requeueCampaignCalendarJob}
          onDeleteItem={deleteCampaignCalendarItem}
        />
      </div>
    </div>
  )
}

function CampaignCalendarSurface({
  items,
  selectedDate,
  visibleMonth,
  draft,
  selectedDateItems,
  editingItemId,
  editDraft,
  disabled,
  parseError,
  onSelectDate,
  onChangeMonth,
  onChangeDraft,
  onChangeEditDraft,
  onEditItem,
  onCancelEditItem,
  onSaveEditItem,
  onAddItem,
  onApproveItem,
  onRequeueItem,
  onDeleteItem,
}: {
  items: CampaignCalendarItem[]
  selectedDate: string
  visibleMonth: Date
  draft: CampaignCalendarDraft
  selectedDateItems: CampaignCalendarItem[]
  editingItemId: string | null
  editDraft: CampaignCalendarDraft
  disabled?: boolean
  parseError?: string
  onSelectDate: (date: string) => void
  onChangeMonth: (month: Date) => void
  onChangeDraft: (draft: CampaignCalendarDraft) => void
  onChangeEditDraft: (draft: CampaignCalendarDraft) => void
  onEditItem: (item: CampaignCalendarItem) => void
  onCancelEditItem: () => void
  onSaveEditItem: (itemId: string) => void
  onAddItem: () => void
  onApproveItem: (itemId: string) => void
  onRequeueItem: (itemId: string) => void
  onDeleteItem: (itemId: string) => void
}) {
  const dayMetaByDate = React.useMemo(() => {
    const statusesByDate = new Map<string, CampaignCalendarItemStatus[]>()
    for (const item of items) {
      statusesByDate.set(item.date, [...(statusesByDate.get(item.date) ?? []), item.status])
    }
    const metaByDate = new Map<string, CalendarMonthDayMeta>()
    statusesByDate.forEach((statuses, date) => {
      metaByDate.set(date, {
        count: statuses.length,
        dots: [...new Set(statuses)].map(statusDotClass),
      })
    })
    return metaByDate
  }, [items])
  const selectedLabel = parseDateKey(selectedDate).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })

  return (
    <section className="rounded-2xl border border-white/[0.04] bg-[#0A0A0A] p-5 shadow-minimal">
      {parseError ? (
        <div className="mb-3 rounded-xl border border-red-300/15 bg-red-500/10 p-3 text-xs text-red-100/70">
          {parseError}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <CalendarMonthGrid
          visibleMonth={visibleMonth}
          selectedDate={selectedDate}
          dayMetaByDate={dayMetaByDate}
          onSelectDate={onSelectDate}
          onChangeMonth={onChangeMonth}
        />

        <div className="rounded-[16px] border border-white/[0.05] bg-black/20 p-3">
          <div className="mb-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/35">Selected Date</div>
            <div className="mt-1 text-base font-semibold text-white/80">{selectedLabel}</div>
          </div>

          <div className="space-y-2">
            {selectedDateItems.length === 0 ? (
              <div className="rounded-[12px] border border-white/[0.045] bg-white/[0.016] p-3 text-xs text-white/36">
                Nothing scheduled.
              </div>
            ) : selectedDateItems.map((item) => (
              <div key={item.id} className="rounded-[12px] border border-white/[0.055] bg-white/[0.025] p-3">
                {editingItemId === item.id ? (
                  <CampaignCalendarForm
                    draft={editDraft}
                    disabled={disabled}
                    submitLabel="Save"
                    onChange={onChangeEditDraft}
                    onCancel={onCancelEditItem}
                    onSubmit={() => onSaveEditItem(item.id)}
                  />
                ) : (
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-sm font-semibold text-white/76">{item.title}</div>
                        <span className={cn('rounded-full px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.12em]', statusBadgeClass(item.status))}>
                          {item.status.replace(/-/g, ' ')}
                        </span>
                      </div>
                      <div className="mt-1 text-[10px] font-medium uppercase tracking-[0.12em] text-orange-200/65">
                        {item.time || 'All day'} · {item.kind.replace(/-/g, ' ')}
                      </div>
                      {item.notes ? <div className="mt-2 text-xs leading-5 text-white/38">{item.notes}</div> : null}
                      <CampaignCalendarJobDetails item={item} />
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {item.status === 'needs-approval' ? (
                        <button
                          type="button"
                          onClick={() => onApproveItem(item.id)}
                          disabled={disabled}
                          className="rounded-full p-1.5 text-white/28 hover:bg-white/[0.05] hover:text-emerald-200 disabled:cursor-not-allowed disabled:opacity-40"
                          aria-label="Approve calendar item"
                          title="Approve"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                      {item.job && (item.status === 'failed' || item.status === 'missed') ? (
                        <button
                          type="button"
                          onClick={() => onRequeueItem(item.id)}
                          disabled={disabled}
                          className="rounded-full p-1.5 text-white/28 hover:bg-white/[0.05] hover:text-blue-200 disabled:cursor-not-allowed disabled:opacity-40"
                          aria-label="Requeue scheduled job"
                          title="Requeue"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => onEditItem(item)}
                        disabled={disabled}
                        className="rounded-full p-1.5 text-white/28 hover:bg-white/[0.05] hover:text-white/70 disabled:cursor-not-allowed disabled:opacity-40"
                        aria-label="Edit calendar item"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteItem(item.id)}
                        disabled={disabled}
                        className="rounded-full p-1.5 text-white/28 hover:bg-white/[0.05] hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-40"
                        aria-label="Delete calendar item"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="mt-4 rounded-[14px] border border-white/[0.05] bg-white/[0.018] p-3">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/35">Schedule</div>
            <CampaignCalendarForm
              draft={draft}
              disabled={disabled}
              submitLabel="Add Item"
              onChange={onChangeDraft}
              onSubmit={onAddItem}
            />
          </div>
        </div>
      </div>
    </section>
  )
}

function CampaignCalendarJobDetails({ item }: { item: CampaignCalendarItem }) {
  const job = item.job
  const latestRun = item.runHistory.at(-1)
  if (!job) return null
  const externalBlocked = isLiveExternalActionType(job.actionType)
  return (
    <div className="mt-3 rounded-[10px] border border-white/[0.045] bg-black/24 p-2.5">
      <div className="flex flex-wrap items-center gap-2 text-[10px] font-medium uppercase tracking-[0.12em] text-white/40">
        <span>{job.actionType.replace(/-/g, ' ')}</span>
        <span>Attempts {job.attempts}/{job.maxAttempts}</span>
        {job.lastRunAt ? <span>Last {formatCompactDateTime(job.lastRunAt)}</span> : null}
      </div>
      {externalBlocked ? (
        <div className="mt-2 rounded-[8px] border border-yellow-300/10 bg-yellow-300/[0.055] px-2 py-1.5 text-[11px] leading-4 text-yellow-100/64">
          Approval can be recorded here. Live posting/outreach still waits for the external runner.
        </div>
      ) : null}
      {job.error ? (
        <div className="mt-2 text-[11px] leading-4 text-red-100/65">{job.error}</div>
      ) : null}
      {latestRun ? (
        <div className="mt-2 text-[10px] leading-4 text-white/34">
          Last run: {latestRun.status} · {formatCompactDateTime(latestRun.endedAt ?? latestRun.startedAt)}
          {latestRun.resultSummary ? ` · ${latestRun.resultSummary}` : ''}
        </div>
      ) : null}
    </div>
  )
}

function CampaignCalendarForm({
  draft,
  disabled,
  submitLabel,
  onChange,
  onSubmit,
  onCancel,
}: {
  draft: CampaignCalendarDraft
  disabled?: boolean
  submitLabel: string
  onChange: (draft: CampaignCalendarDraft) => void
  onSubmit: () => void
  onCancel?: () => void
}) {
  return (
    <div className="grid grid-cols-1 gap-2">
      <input
        type="date"
        value={draft.date}
        onChange={(event) => onChange({ ...draft, date: event.target.value })}
        className="h-9 rounded-[10px] border border-white/[0.06] bg-black/25 px-3 text-xs text-white/75 outline-none focus:border-white/16"
      />
      <Input value={draft.title} onChange={(title) => onChange({ ...draft, title })} placeholder="Title" />
      <Input value={draft.time} onChange={(time) => onChange({ ...draft, time })} placeholder="Time, optional HH:mm" />
      <div className="grid grid-cols-2 gap-2">
        <select
          value={draft.kind}
          onChange={(event) => onChange({ ...draft, kind: event.target.value as CampaignCalendarItemKind })}
          className="h-9 rounded-[10px] border border-white/[0.06] bg-black/25 px-3 text-xs text-white/75 outline-none focus:border-white/16"
        >
          <option value="manual">Manual reminder</option>
          <option value="deadline">Deadline</option>
          <option value="approval">Review / approval</option>
          <option value="scheduled-job">Scheduled job</option>
        </select>
        <select
          value={draft.status}
          onChange={(event) => onChange({ ...draft, status: event.target.value as CampaignCalendarItemStatus })}
          className="h-9 rounded-[10px] border border-white/[0.06] bg-black/25 px-3 text-xs text-white/75 outline-none focus:border-white/16"
        >
          <option value="scheduled">Scheduled</option>
          <option value="needs-approval">Needs approval</option>
          <option value="draft">Draft</option>
          <option value="done">Done</option>
          <option value="missed">Missed</option>
          <option value="canceled">Canceled</option>
        </select>
      </div>
      <textarea
        value={draft.notes}
        onChange={(event) => onChange({ ...draft, notes: event.target.value })}
        placeholder="Notes, optional"
        className="min-h-[74px] w-full rounded-[10px] border border-white/[0.06] bg-black/25 px-3 py-2 text-xs leading-5 text-white/75 outline-none placeholder:text-white/28 focus:border-white/16"
      />
      <div className="flex justify-end gap-2">
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-white/[0.07] px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/55 hover:bg-white/[0.04]"
          >
            <X className="h-3.5 w-3.5" />
            Cancel
          </button>
        ) : null}
        <button
          type="button"
          onClick={onSubmit}
          disabled={disabled}
          className="h-9 rounded-full bg-white/90 px-4 text-xs font-semibold text-black hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitLabel}
        </button>
      </div>
    </div>
  )
}

function Input({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className="h-9 rounded-[10px] border border-white/[0.06] bg-black/25 px-3 text-xs text-white/75 outline-none placeholder:text-white/28 focus:border-white/16"
    />
  )
}

function statusDotClass(status: CampaignCalendarItemStatus): string {
  if (status === 'needs-approval') return 'bg-yellow-300/85'
  if (status === 'done') return 'bg-emerald-300/85'
  if (status === 'failed' || status === 'missed') return 'bg-red-300/85'
  if (status === 'running') return 'bg-blue-300/85'
  if (status === 'canceled') return 'bg-white/25'
  return 'bg-orange-300/85'
}

function statusBadgeClass(status: CampaignCalendarItemStatus): string {
  if (status === 'needs-approval') return 'bg-yellow-300/10 text-yellow-100/75'
  if (status === 'done') return 'bg-emerald-400/10 text-emerald-200/75'
  if (status === 'failed' || status === 'missed') return 'bg-red-400/10 text-red-100/75'
  if (status === 'running') return 'bg-blue-400/10 text-blue-100/75'
  if (status === 'canceled') return 'bg-white/[0.035] text-white/38'
  return 'bg-orange-400/10 text-orange-100/75'
}

function formatCompactDateTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}
