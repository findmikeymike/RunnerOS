import * as React from 'react'
import { ArrowUpRight, CalendarDays, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { resolveHqCampaignFocus, type HqCampaignSummary } from '@/lib/artist-hq-home-feed'
import type {
  ArtistReleaseEventType,
  ArtistReleaseHorizon,
  ArtistReleaseMonthPlan,
} from '@/lib/artist-release-horizon'

interface ReleaseMonth {
  key: string
  label: string
  year: string
}

const EMPTY_MONTH_PLAN: ArtistReleaseMonthPlan = {
  title: '',
  event: 'creation',
  plan: '',
  keyGoal: '',
}

export function ReleaseHorizon({
  campaigns,
  northStar,
  plan,
  onOpenCampaign,
  onSaveNorthStar,
  onSaveMonthPlan,
}: {
  campaigns: HqCampaignSummary[]
  northStar?: string
  plan: ArtistReleaseHorizon
  onOpenCampaign?: (workspaceId: string) => void
  onSaveNorthStar: (value: string) => Promise<void>
  onSaveMonthPlan: (monthKey: string, value: ArtistReleaseMonthPlan | null) => Promise<void>
}) {
  const months = React.useMemo(() => buildRollingMonths(), [])
  const focus = React.useMemo(() => resolveHqCampaignFocus(campaigns), [campaigns])
  const [selectedMonthKey, setSelectedMonthKey] = React.useState<string | null>(null)
  const [monthDraft, setMonthDraft] = React.useState<ArtistReleaseMonthPlan>(EMPTY_MONTH_PLAN)
  const [monthEditMode, setMonthEditMode] = React.useState(false)
  const [northStarOpen, setNorthStarOpen] = React.useState(false)
  const [northStarDraft, setNorthStarDraft] = React.useState(northStar ?? '')
  const [allCampaignsOpen, setAllCampaignsOpen] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const selectedMonth = months.find((month) => month.key === selectedMonthKey)
  const selectedCampaigns = campaignsForMonth(campaigns, selectedMonthKey)
  const selectedPlan = selectedMonthKey ? plan.months[selectedMonthKey] : undefined

  React.useEffect(() => setNorthStarDraft(northStar ?? ''), [northStar])

  const openMonth = (monthKey: string) => {
    setSelectedMonthKey(monthKey)
    setMonthDraft(plan.months[monthKey] ?? EMPTY_MONTH_PLAN)
    setMonthEditMode(false)
  }

  const saveMonth = async () => {
    if (!selectedMonthKey) return
    setSaving(true)
    try {
      await onSaveMonthPlan(selectedMonthKey, monthDraft)
      setMonthEditMode(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save this month')
    } finally {
      setSaving(false)
    }
  }

  const saveNorthStar = async () => {
    setSaving(true)
    try {
      await onSaveNorthStar(northStarDraft)
      setNorthStarOpen(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save the direction')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="overflow-hidden rounded-[14px] border border-white/[0.055] bg-[#0d0e0f]">
      <div className="flex flex-col gap-4 border-b border-white/[0.055] px-5 py-4 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[9px] font-medium uppercase tracking-[0.18em] text-white/34">
            <CalendarDays className="h-3.5 w-3.5 text-[#ff5a00]" />
            Release horizon
          </div>
          <button
            type="button"
            onClick={() => setNorthStarOpen(true)}
            className="group mt-2 flex max-w-3xl items-center gap-2 text-left"
          >
            <span className={cn('truncate text-sm font-normal', northStar ? 'text-white/76' : 'text-white/30')}>
              {northStar || 'Add the direction for this year'}
            </span>
            <Pencil className="h-3 w-3 shrink-0 text-white/18 transition-colors group-hover:text-white/55" />
          </button>
        </div>

        <div className="flex min-w-0 items-center gap-3 md:justify-end">
          {focus ? (
            <button
              type="button"
              onClick={() => onOpenCampaign?.(focus.campaign.id)}
              disabled={!onOpenCampaign}
              className="group min-w-0 text-left disabled:cursor-default"
            >
              <span className="block text-[9px] font-medium uppercase tracking-[0.16em] text-[#ff6a00]/80">{focus.label}</span>
              <span className="mt-1 flex items-center gap-1.5">
                <span className="max-w-64 truncate text-sm font-medium text-white/82">{focus.campaign.name}</span>
                {focus.dateLabel ? <span className="shrink-0 text-[10px] text-white/34">{focus.dateLabel}</span> : null}
                <ArrowUpRight className="h-3 w-3 shrink-0 text-white/22 transition-colors group-hover:text-white/60" />
              </span>
            </button>
          ) : <span className="text-xs text-white/28">No campaigns yet</span>}
          {campaigns.length > 1 ? (
            <button type="button" onClick={() => setAllCampaignsOpen(true)} className="shrink-0 text-[10px] text-white/34 hover:text-white/72">
              All {campaigns.length}
            </button>
          ) : null}
        </div>
      </div>

      <div className="overflow-x-auto p-3">
        <div className="grid min-w-[1040px] grid-cols-12 gap-1.5">
          {months.map((month) => {
            const monthCampaigns = campaignsForMonth(campaigns, month.key)
            const monthPlan = plan.months[month.key]
            const displayTitle = monthPlan?.title || monthCampaigns[0]?.name
            const displayEvent: ArtistReleaseEventType | undefined = monthPlan?.event || (monthCampaigns.length > 0 ? 'release' : undefined)
            const populated = Boolean(displayTitle || monthPlan?.plan || monthPlan?.keyGoal)
            return (
              <button
                key={month.key}
                type="button"
                onClick={() => openMonth(month.key)}
                className={cn(
                  'group relative aspect-square min-h-[86px] rounded-[9px] border p-2 text-left transition-colors',
                  populated
                    ? 'border-[#ff5a00]/42 bg-[#ff5a00]/[0.085] hover:bg-[#ff5a00]/[0.13]'
                    : 'border-white/[0.045] bg-white/[0.018] hover:border-white/[0.10] hover:bg-white/[0.035]',
                )}
              >
                <span className="absolute inset-x-2 top-2 flex items-start justify-between gap-1">
                  <span>
                    <span className={cn('block text-[10px] font-medium uppercase tracking-[0.12em]', populated ? 'text-[#ff6a00]' : 'text-white/48')}>{month.label}</span>
                    <span className="mt-0.5 block text-[8px] text-white/20">{month.year}</span>
                  </span>
                  {monthPlan ? <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-white/35" title="Month plan saved" /> : null}
                </span>
                {displayTitle ? (
                  <span className="absolute inset-x-2 top-1/2 flex -translate-y-1/2 items-center justify-center gap-1.5 text-center">
                    {displayEvent ? <EventMarker event={displayEvent} /> : null}
                    <span className="line-clamp-2 text-[9px] font-medium leading-3 text-white/76">{displayTitle}</span>
                  </span>
                ) : null}
                {monthCampaigns.length > (monthPlan ? 0 : 1) ? (
                  <span className="absolute inset-x-2 bottom-2 text-center text-[8px] text-white/25">
                    {monthCampaigns.length} release{monthCampaigns.length === 1 ? '' : 's'}
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
      </div>

      <Dialog open={Boolean(selectedMonthKey)} onOpenChange={(open) => { if (!open) setSelectedMonthKey(null) }}>
        <DialogContent className="max-h-[86vh] overflow-y-auto border-white/[0.08] bg-[#101112] p-0 sm:max-w-3xl">
          <div className="border-b border-white/[0.06] px-7 py-6 pr-14">
            <div className="flex items-start justify-between gap-5">
              <DialogHeader className="min-w-0 text-left">
                <DialogTitle className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/42">
                  {selectedMonth?.label} {selectedMonth?.year}
                </DialogTitle>
                <DialogDescription className="sr-only">Monthly release and career plan.</DialogDescription>
              </DialogHeader>
              {!monthEditMode ? (
                <button
                  type="button"
                  onClick={() => {
                    setMonthDraft(selectedPlan ?? EMPTY_MONTH_PLAN)
                    setMonthEditMode(true)
                  }}
                  className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[7px] border border-white/[0.08] px-3 text-[10px] font-medium text-white/54 hover:bg-white/[0.04] hover:text-white/82"
                >
                  <Pencil className="h-3 w-3" />
                  {selectedPlan ? 'Edit' : 'Add plan'}
                </button>
              ) : null}
            </div>
          </div>

          {monthEditMode ? (
            <div className="space-y-5 px-7 py-6">
              <div className="grid gap-4 sm:grid-cols-[1fr_190px]">
                <MonthField label="Title">
                  <input
                    value={monthDraft.title}
                    onChange={(event) => setMonthDraft((draft) => ({ ...draft, title: event.target.value }))}
                    placeholder="What defines this month?"
                    className="h-10 w-full rounded-[8px] border border-white/30 bg-black/30 px-3 text-sm text-white/88 outline-none placeholder:text-white/34 focus:border-white/60"
                  />
                </MonthField>
                <MonthField label="Event">
                  <select
                    value={monthDraft.event}
                    onChange={(event) => setMonthDraft((draft) => ({ ...draft, event: event.target.value as ArtistReleaseEventType }))}
                    className="h-10 w-full rounded-[8px] border border-white/30 bg-[#0a0b0c] px-3 text-sm capitalize text-white/88 outline-none focus:border-white/60"
                  >
                    {(['release', 'promotion', 'live', 'creation', 'business'] as ArtistReleaseEventType[]).map((event) => (
                      <option key={event} value={event}>{event}</option>
                    ))}
                  </select>
                </MonthField>
              </div>
              <MonthField label="Key goal">
                <input
                  value={monthDraft.keyGoal}
                  onChange={(event) => setMonthDraft((draft) => ({ ...draft, keyGoal: event.target.value }))}
                  placeholder="One measurable result for the month"
                  className="h-10 w-full rounded-[8px] border border-white/30 bg-black/30 px-3 text-sm text-white/88 outline-none placeholder:text-white/34 focus:border-white/60"
                />
              </MonthField>
              <MonthField label="Plan">
                <textarea
                  value={monthDraft.plan}
                  onChange={(event) => setMonthDraft((draft) => ({ ...draft, plan: event.target.value }))}
                  placeholder="Lay out the work, sequence, decisions, and dependencies for this month."
                  className="min-h-64 w-full resize-y rounded-[9px] border border-white/30 bg-black/30 p-4 text-sm leading-6 text-white/88 outline-none placeholder:text-white/34 focus:border-white/60"
                />
              </MonthField>
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={() => setMonthEditMode(false)} className="h-9 rounded-[8px] border border-white/[0.08] px-4 text-xs text-white/48 hover:bg-white/[0.04] hover:text-white/76">
                  Cancel
                </button>
                <button type="button" onClick={() => void saveMonth()} disabled={saving} className="h-9 rounded-[8px] bg-[#ff5a00] px-5 text-xs font-medium text-black hover:bg-[#ff6a00] disabled:opacity-45">
                  Save plan
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-8 px-7 py-7">
              {selectedPlan ? (
                <>
                  <div>
                    <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.16em] text-white/36">
                      <EventMarker event={selectedPlan.event} />
                      {selectedPlan.event}
                    </div>
                    <h2 className="mt-3 text-3xl font-medium tracking-tight text-white/92">{selectedPlan.title || 'Untitled month'}</h2>
                  </div>
                  {selectedPlan.keyGoal ? (
                    <div className="border-l-2 border-[#ff5a00] pl-4">
                      <div className="text-[9px] font-medium uppercase tracking-[0.16em] text-white/30">Key goal</div>
                      <div className="mt-1.5 text-sm font-medium text-white/78">{selectedPlan.keyGoal}</div>
                    </div>
                  ) : null}
                  <div>
                    <div className="text-[9px] font-medium uppercase tracking-[0.16em] text-white/30">Plan</div>
                    <div className="mt-3 min-h-36 whitespace-pre-wrap text-sm leading-7 text-white/66">
                      {selectedPlan.plan || <span className="text-white/24">No detailed plan yet.</span>}
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex min-h-52 flex-col items-center justify-center text-center">
                  <div className="text-lg font-medium text-white/62">This month is open.</div>
                  <div className="mt-2 max-w-sm text-xs leading-5 text-white/30">Add a title, event type, goal, and working plan when you are ready to shape it.</div>
                  <button type="button" onClick={() => setMonthEditMode(true)} className="mt-5 h-9 rounded-[8px] bg-[#ff5a00] px-5 text-xs font-medium text-black hover:bg-[#ff6a00]">
                    Add month plan
                  </button>
                </div>
              )}

              {selectedCampaigns.length > 0 ? (
                <div className="border-t border-white/[0.06] pt-5">
                  <div className="mb-3 text-[9px] font-medium uppercase tracking-[0.16em] text-white/30">Dated releases</div>
                  <div className="space-y-1.5">
                    {selectedCampaigns.map((campaign) => (
                      <button key={campaign.id} type="button" onClick={() => onOpenCampaign?.(campaign.id)} className="flex w-full items-center justify-between rounded-[8px] border border-white/[0.055] bg-white/[0.02] px-3 py-2.5 text-left text-xs text-white/72 hover:bg-white/[0.045]">
                        <span className="flex min-w-0 items-center gap-2">
                          <EventMarker event="release" />
                          <span className="truncate">{campaign.name}</span>
                        </span>
                        <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-white/30" />
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={northStarOpen} onOpenChange={setNorthStarOpen}>
        <DialogContent className="border-white/[0.08] bg-[#101112] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Direction for the year</DialogTitle>
            <DialogDescription>This stays in the Artist Profile brain and guides every campaign.</DialogDescription>
          </DialogHeader>
          <textarea
            value={northStarDraft}
            onChange={(event) => setNorthStarDraft(event.target.value)}
            placeholder="What are you building toward this year?"
            className="min-h-28 w-full resize-none rounded-[9px] border border-white/[0.08] bg-black/30 p-3 text-sm leading-6 text-white/78 outline-none placeholder:text-white/22 focus:border-[#ff5a00]/45"
          />
          <button type="button" onClick={() => void saveNorthStar()} disabled={saving} className="h-9 rounded-[8px] bg-[#ff5a00] text-xs font-medium text-black hover:bg-[#ff6a00] disabled:opacity-45">
            Save direction
          </button>
        </DialogContent>
      </Dialog>

      <Dialog open={allCampaignsOpen} onOpenChange={setAllCampaignsOpen}>
        <DialogContent className="border-white/[0.08] bg-[#101112] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>All campaigns</DialogTitle>
            <DialogDescription>Every campaign workspace, ordered by release date.</DialogDescription>
          </DialogHeader>
          <div className="max-h-96 space-y-1.5 overflow-y-auto">
            {[...campaigns].sort(compareCampaignDates).map((campaign) => (
              <button key={campaign.id} type="button" onClick={() => onOpenCampaign?.(campaign.id)} className="flex w-full items-center justify-between rounded-[8px] border border-white/[0.055] bg-white/[0.02] px-3 py-2.5 text-left hover:bg-white/[0.045]">
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium text-white/76">{campaign.name}</span>
                  <span className="mt-1 block text-[9px] text-white/28">{campaign.releaseDate ? formatDate(campaign.releaseDate) : 'Release date not set'}</span>
                </span>
                <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-white/28" />
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  )
}

function buildRollingMonths(now = new Date()): ReleaseMonth[] {
  return Array.from({ length: 12 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() + index, 1)
    return {
      key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`,
      label: new Intl.DateTimeFormat('en-US', { month: 'short' }).format(date),
      year: String(date.getFullYear()),
    }
  })
}

function EventMarker({ event }: { event: ArtistReleaseEventType }) {
  return <span className={cn(
    'inline-block h-2 w-2 shrink-0 rounded-[2px]',
    event === 'release' ? 'bg-white/90' : event === 'live' ? 'bg-red-500' : 'bg-[#ff5a00]',
  )} />
}

function MonthField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-[9px] font-medium uppercase tracking-[0.16em] text-white/78">{label}</span>
      {children}
    </label>
  )
}

function campaignsForMonth(campaigns: HqCampaignSummary[], monthKey: string | null): HqCampaignSummary[] {
  if (!monthKey) return []
  return campaigns
    .filter((campaign) => campaign.releaseDate?.startsWith(`${monthKey}-`))
    .sort(compareCampaignDates)
}

function compareCampaignDates(left: HqCampaignSummary, right: HqCampaignSummary): number {
  if (left.releaseDate && right.releaseDate) return left.releaseDate.localeCompare(right.releaseDate)
  if (left.releaseDate) return -1
  if (right.releaseDate) return 1
  return left.name.localeCompare(right.name)
}

function formatDate(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    .format(new Date(year!, month! - 1, day!))
}
