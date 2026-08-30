import * as React from 'react'
import {
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  FileArchive,
  FileText,
  FolderOpen,
  ImageIcon,
  Loader2,
  Music2,
  Sparkles,
  Upload,
  Video,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import {
  buildMissionBrief,
  hasSaveableMissionBrief,
  missionBriefContentKey,
  missionCampaignWindow,
  missionCampaignWindowError,
  missionBriefMetadata,
  serializeMissionBriefBody,
  type MissionBrief,
  type CampaignDateStatus,
  type MissionReference,
  type MissionType,
} from '@/lib/mission-brief'
import type {
  ContextDocDTO,
  ContextDocMetadata,
  MissionAssetKindHint,
  MissionAssetManifest,
  MissionAssetRecord,
} from '../../../shared/types'
import type { ReleaseBoard } from '@/lib/release-board'

const missionTypes: MissionType[] = ['single', 'ep', 'album', 'other']
const missionFieldClass = 'w-full rounded-lg border border-white/[0.07] bg-black/25 px-3 py-2 text-sm text-white/78 outline-none placeholder:text-white/22 focus:border-orange-300/45'
type DrawerTab = 'brief' | 'assets'
type CampaignDateKey = 'start' | 'release' | 'finish'

const campaignDateOrder: CampaignDateKey[] = ['start', 'release', 'finish']
const campaignDateLabels: Record<CampaignDateKey, string> = {
  start: 'Start',
  release: 'Release',
  finish: 'Finish',
}

type SaveMissionBrief = (input: {
  slug: string
  metadata: ContextDocMetadata
  body: string
}) => Promise<ContextDocDTO>

interface MissionBriefDrawerProps {
  open: boolean
  workspaceId: string
  mission: MissionBrief
  onOpenChange: (open: boolean) => void
  onSaved: (brief: MissionBrief) => void
  saveMissionBrief: SaveMissionBrief
  assetManifest: MissionAssetManifest | null
  assetBusy: boolean
  releaseBoard: ReleaseBoard
  onAddAsset: (kindHint: MissionAssetKindHint) => Promise<void>
  onImportAssetPaths: (filePaths: string[], kindHint?: MissionAssetKindHint) => Promise<void>
  onTranscribeLyrics: () => Promise<void>
  onSaveLyrics: (lyricsText: string, assetId?: string, sourceAudioAssetId?: string) => Promise<void>
  onOpenAssetsFolder: () => Promise<void>
}

export function MissionBriefDrawer({
  open,
  workspaceId,
  mission,
  onOpenChange,
  onSaved,
  saveMissionBrief,
  assetManifest,
  assetBusy,
  releaseBoard,
  onAddAsset,
  onImportAssetPaths,
  onTranscribeLyrics,
  onSaveLyrics,
  onOpenAssetsFolder,
}: MissionBriefDrawerProps) {
  const closeButtonRef = React.useRef<HTMLButtonElement>(null)
  const [drawerPortalContainer, setDrawerPortalContainer] = React.useState<HTMLDivElement | null>(null)
  const [activeTab, setActiveTab] = React.useState<DrawerTab>('brief')
  const [draft, setDraft] = React.useState<Partial<MissionBrief>>(mission)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    setDraft(mission)
  }, [mission])

  const editableBrief = React.useMemo(() => buildMissionBrief(workspaceId, draft), [draft, workspaceId])
  const savedBrief = React.useMemo(() => buildMissionBrief(workspaceId, mission), [mission, workspaceId])
  const campaignWindow = React.useMemo(() => missionCampaignWindow(editableBrief), [editableBrief])
  const campaignWindowError = React.useMemo(() => missionCampaignWindowError(editableBrief), [editableBrief])
  const canSave = hasSaveableMissionBrief(editableBrief) && !campaignWindowError
  const briefDirty = React.useMemo(
    () => missionBriefContentKey(editableBrief) !== missionBriefContentKey(savedBrief),
    [editableBrief, savedBrief],
  )

  const save = React.useCallback(async () => {
    const brief = buildMissionBrief(workspaceId, {
      ...draft,
    })
    if (brief.status === 'empty') {
      toast.message('Nothing to save yet')
      return
    }
    if (!hasSaveableMissionBrief(brief)) {
      toast.message('Add a title or goal before saving')
      return
    }
    const dateError = missionCampaignWindowError(brief)
    if (dateError) {
      toast.error(dateError)
      return
    }
    setSaving(true)
    try {
      await saveMissionBrief({
        slug: 'mission-brief',
        metadata: missionBriefMetadata(brief),
        body: serializeMissionBriefBody(brief),
      })
      onSaved(brief)
      toast.success('Campaign brief saved')
      if (mission.status === 'empty') {
        setActiveTab('assets')
      } else {
        onOpenChange(false)
      }
    } catch (err) {
      toast.error('Failed to save campaign brief', {
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setSaving(false)
    }
  }, [draft, mission.status, onOpenChange, onSaved, saveMissionBrief, workspaceId])

  const handleDrop = React.useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!event.dataTransfer.files.length) return
      event.preventDefault()
      const filePaths = Array.from(event.dataTransfer.files)
        .map((file) => window.electronAPI.getFilePath(file))
        .filter((path): path is string => Boolean(path))
      if (filePaths.length === 0) {
        toast.error('Could not read dropped files.')
        return
      }
      void onImportAssetPaths(filePaths, 'any')
    },
    [onImportAssetPaths],
  )

  return (
    <Drawer open={open} onOpenChange={onOpenChange} direction="right">
      <DrawerContent
        overlay={<div className="fixed inset-0 z-modal bg-black/20 backdrop-blur-[1px]" />}
        className="w-[min(560px,100vw)] !max-w-[min(560px,100vw)] border-l border-white/[0.08] bg-[#070707] text-white shadow-strong sm:!max-w-[560px]"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          closeButtonRef.current?.focus()
        }}
      >
        <div ref={setDrawerPortalContainer} className="contents" />
        <DrawerHeader className="border-b border-white/[0.06] px-5 py-4 text-left">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="mb-2 flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.18em] text-orange-300/70">
                <ClipboardList className="h-3.5 w-3.5" />
                Campaign Brief
              </div>
              <DrawerTitle className="text-xl font-medium tracking-tight text-white">
                {mission.title || 'Create Campaign'}
              </DrawerTitle>
              <DrawerDescription className="sr-only">
                Define the campaign brief, dates, audience, visual direction, and campaign assets.
              </DrawerDescription>
            </div>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={() => onOpenChange(false)}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.03] text-white/50 hover:bg-white/[0.08] hover:text-white"
              aria-label="Close campaign brief"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </DrawerHeader>

        <div className="flex gap-1 border-b border-white/[0.06] px-5 py-3">
          <TabButton active={activeTab === 'brief'} onClick={() => setActiveTab('brief')}>Brief</TabButton>
          <TabButton active={activeTab === 'assets'} onClick={() => setActiveTab('assets')}>Assets</TabButton>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-4">
          {activeTab === 'brief' ? (
          <section className="rounded-2xl border border-white/[0.06] bg-[#0b0b0b] p-4">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-[10px] font-medium uppercase tracking-[0.18em] text-white/50">
                  Campaign Brief
                </h3>
              </div>
              <span className="rounded-full border border-white/[0.06] px-2.5 py-1 text-[10px] text-white/42">
                {editableBrief.completeness}% complete
              </span>
            </div>

            <div className="grid gap-3">
              <Field label="Title">
                <input
                  value={draft.title ?? ''}
                  onChange={(event) => setDraft((value) => ({ ...value, title: event.target.value }))}
                  className={missionFieldClass}
                  placeholder="Song, EP, or album name"
                />
              </Field>
              <Field label="Type">
                <select
                  value={draft.missionType ?? ''}
                  onChange={(event) => setDraft((value) => ({ ...value, missionType: event.target.value as MissionType || undefined }))}
                  className={missionFieldClass}
                >
                  <option value="">Unknown</option>
                  {missionTypes.map((type) => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
              </Field>
              <Field label="Goal">
                <textarea
                  value={draft.goal ?? ''}
                  onChange={(event) => setDraft((value) => ({ ...value, goal: event.target.value }))}
                  className={cn(missionFieldClass, 'min-h-[84px] resize-none')}
                  placeholder="What are we trying to make happen?"
                />
              </Field>
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] p-3">
                <div className="mb-3">
                  <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-white/52">Campaign window</div>
                  <div className="mt-1 text-[11px] leading-4 text-white/30">Start the rollout, anchor the release, and define when post-release work ends.</div>
                </div>
                <CampaignWindowPicker
                  dates={{
                    start: campaignWindow.startDate,
                    release: campaignWindow.releaseDate,
                    finish: campaignWindow.finishDate,
                  }}
                  statuses={campaignWindow.statuses}
                  portalContainer={drawerPortalContainer}
                  onDateChange={(key, date) => setDraft((value) => ({
                    ...value,
                    ...(key === 'start' ? { campaignStartDate: date } : {}),
                    ...(key === 'release' ? { releaseDate: date } : {}),
                    ...(key === 'finish' ? { campaignFinishDate: date } : {}),
                  }))}
                  onStatusChange={(key, status) => setDraft((value) => ({
                    ...value,
                    campaignDateStatuses: { ...value.campaignDateStatuses, [key]: status },
                  }))}
                />
                {campaignWindowError ? <p className="mt-2 text-[11px] text-red-300/80">{campaignWindowError}</p> : null}
              </div>
              <Field label="Promo Budget">
                <input
                  value={draft.promoBudget ?? ''}
                  onChange={(event) => setDraft((value) => ({ ...value, promoBudget: event.target.value }))}
                  className={missionFieldClass}
                  placeholder="$0, $500, $2k, not sure yet"
                />
              </Field>
              <Field label="Timeline">
                <input
                  value={draft.timeline ?? ''}
                  onChange={(event) => setDraft((value) => ({ ...value, timeline: event.target.value }))}
                  className={missionFieldClass}
                  placeholder="Release week, next month, this summer..."
                />
              </Field>
              <Field label="Mood">
                <textarea
                  value={draft.mood ?? ''}
                  onChange={(event) => setDraft((value) => ({ ...value, mood: event.target.value }))}
                  className={cn(missionFieldClass, 'min-h-[72px] resize-none')}
                  placeholder="What should it feel like?"
                />
              </Field>
              <Field label="Visual World">
                <textarea
                  value={draft.visualWorld ?? ''}
                  onChange={(event) => setDraft((value) => ({ ...value, visualWorld: event.target.value }))}
                  className={cn(missionFieldClass, 'min-h-[72px] resize-none')}
                  placeholder="Colors, imagery, world, references"
                />
              </Field>
              <Field label="Target Listener">
                <input
                  value={draft.targetListener ?? ''}
                  onChange={(event) => setDraft((value) => ({ ...value, targetListener: event.target.value }))}
                  className={missionFieldClass}
                  placeholder="Who is this for?"
                />
              </Field>
              <Field label="References">
                <input
                  value={(draft.references ?? []).map((ref) => ref.value).join(', ')}
                  onChange={(event) => setDraft((value) => ({ ...value, references: parseReferences(event.target.value) }))}
                  className={missionFieldClass}
                  placeholder="artists, songs, visuals"
                />
              </Field>
              <Field label="Channels">
                <input
                  value={(draft.channels ?? []).join(', ')}
                  onChange={(event) => setDraft((value) => ({ ...value, channels: parseList(event.target.value) }))}
                  className={missionFieldClass}
                  placeholder="TikTok, Instagram, Spotify"
                />
              </Field>
            </div>
          </section>
          ) : (
            <AssetsSetup
              manifest={assetManifest}
              busy={assetBusy}
              releaseBoard={releaseBoard}
              onAdd={onAddAsset}
              onTranscribeLyrics={onTranscribeLyrics}
              onSaveLyrics={onSaveLyrics}
              onDrop={handleDrop}
              onOpenFolder={onOpenAssetsFolder}
            />
          )}
        </div>

        <div className="border-t border-white/[0.06] px-5 py-4">
          {activeTab === 'brief' ? (
            <>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={save}
                  disabled={saving || !canSave}
                  className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-full bg-orange-500 px-4 text-sm font-medium text-black hover:bg-orange-400 disabled:cursor-not-allowed disabled:opacity-60"
                  title={campaignWindowError ?? (!hasSaveableMissionBrief(editableBrief) ? 'Add a title or goal before saving' : undefined)}
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Accept Brief
                </button>
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  className="inline-flex h-10 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.03] px-4 text-sm font-medium text-white/62 hover:bg-white/[0.07] hover:text-white"
                >
                  Skip
                </button>
              </div>
              {!canSave ? (
                <p className="mt-2 text-center text-[11px] text-white/32">{campaignWindowError ?? 'Needs a title or goal before saving.'}</p>
              ) : null}
            </>
          ) : (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={briefDirty ? save : () => onOpenChange(false)}
                disabled={briefDirty && (saving || !canSave)}
                className="inline-flex h-10 flex-1 items-center justify-center rounded-full bg-white/90 px-4 text-sm font-medium text-black hover:bg-white"
              >
                {briefDirty ? 'Save Brief' : 'Done'}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('brief')}
                className="inline-flex h-10 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.03] px-4 text-sm font-medium text-white/62 hover:bg-white/[0.07] hover:text-white"
              >
                Brief
              </button>
            </div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-[9px] font-medium uppercase tracking-[0.18em] text-white/32">{label}</span>
      {children}
    </label>
  )
}

function CampaignWindowPicker({
  dates,
  statuses,
  portalContainer,
  onDateChange,
  onStatusChange,
}: {
  dates: Record<CampaignDateKey, string | undefined>
  statuses: Partial<Record<CampaignDateKey, CampaignDateStatus>>
  portalContainer?: HTMLElement | null
  onDateChange: (key: CampaignDateKey, date: string | undefined) => void
  onStatusChange: (key: CampaignDateKey, status: CampaignDateStatus) => void
}) {
  const today = React.useMemo(() => startOfMonth(new Date()), [])
  const months = React.useMemo(() => Array.from({ length: 12 }, (_, index) => addMonths(today, index)), [today])
  const [open, setOpen] = React.useState(false)
  const [activeKey, setActiveKey] = React.useState<CampaignDateKey>('start')
  const [visibleMonth, setVisibleMonth] = React.useState(today)
  const activeDate = parseDateKey(dates[activeKey])

  const openFor = React.useCallback((key: CampaignDateKey) => {
    setActiveKey(key)
    setVisibleMonth(parseDateKey(dates[key]) ?? today)
    setOpen(true)
  }, [dates, today])

  const selectDate = React.useCallback((date: Date | undefined) => {
    if (!date) return
    onDateChange(activeKey, toDateKey(date))
    const nextIndex = campaignDateOrder.indexOf(activeKey) + 1
    const nextKey = campaignDateOrder[nextIndex]
    if (!nextKey) {
      setOpen(false)
      return
    }
    setActiveKey(nextKey)
    setVisibleMonth(parseDateKey(dates[nextKey]) ?? startOfMonth(date))
  }, [activeKey, dates, onDateChange])

  const disabledMatcher = React.useMemo(() => {
    const start = parseDateKey(dates.start)
    const release = parseDateKey(dates.release)
    const finish = parseDateKey(dates.finish)
    if (activeKey === 'start') return release ? { after: release } : finish ? { after: finish } : undefined
    if (activeKey === 'release') {
      if (start && finish) return [{ before: start }, { after: finish }]
      return start ? { before: start } : finish ? { after: finish } : undefined
    }
    return release ? { before: release } : start ? { before: start } : undefined
  }, [activeKey, dates.finish, dates.release, dates.start])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className="grid gap-2 sm:grid-cols-3">
          {campaignDateOrder.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => openFor(key)}
              className={cn(
                'group min-w-0 rounded-[10px] border px-3 py-2.5 text-left transition-colors',
                open && activeKey === key
                  ? 'border-orange-300/45 bg-orange-300/[0.08]'
                  : 'border-white/[0.07] bg-black/25 hover:border-white/[0.14] hover:bg-white/[0.035]',
              )}
              aria-label={`Choose ${campaignDateLabels[key].toLowerCase()} date`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="text-[9px] font-medium uppercase tracking-[0.16em] text-white/38">{campaignDateLabels[key]}</span>
                <CalendarDays className="h-3.5 w-3.5 text-white/28 transition-colors group-hover:text-white/48" />
              </span>
              <span className={cn('mt-1.5 block truncate text-sm', dates[key] ? 'text-white/82' : 'text-white/26')}>
                {formatCampaignDate(dates[key])}
              </span>
              <span className={cn('mt-1 block text-[9px] uppercase tracking-[0.12em]', dates[key] ? 'text-white/32' : 'text-transparent')}>
                {statuses[key] === 'locked' ? 'Locked' : 'Target'}
              </span>
            </button>
          ))}
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        sideOffset={8}
        collisionPadding={16}
        container={portalContainer}
        className="z-overlay w-[min(360px,calc(100vw-32px))] rounded-[14px] border-white/[0.10] bg-[#111214] p-3 text-white shadow-modal-small"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <div className="mb-3 grid grid-cols-3 gap-1 rounded-[9px] bg-black/30 p-1">
          {campaignDateOrder.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setActiveKey(key)
                setVisibleMonth(parseDateKey(dates[key]) ?? visibleMonth)
              }}
              className={cn(
                'h-8 rounded-[7px] text-[10px] font-medium uppercase tracking-[0.12em] transition-colors',
                activeKey === key ? 'bg-white text-black' : 'text-white/42 hover:bg-white/[0.05] hover:text-white/70',
              )}
            >
              {campaignDateLabels[key]}
            </button>
          ))}
        </div>

        <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {months.map((month) => {
            const selected = month.getFullYear() === visibleMonth.getFullYear() && month.getMonth() === visibleMonth.getMonth()
            return (
              <button
                key={`${month.getFullYear()}-${month.getMonth()}`}
                type="button"
                onClick={() => setVisibleMonth(month)}
                className={cn(
                  'h-8 shrink-0 rounded-full px-3 text-[10px] font-medium transition-colors',
                  selected ? 'bg-orange-400/18 text-orange-200' : 'bg-white/[0.035] text-white/42 hover:bg-white/[0.07] hover:text-white/72',
                )}
              >
                {month.toLocaleDateString('en-US', { month: 'short' })} {String(month.getFullYear()).slice(2)}
              </button>
            )
          })}
        </div>

        <div className="flex h-9 items-center justify-between px-1">
          <button
            type="button"
            onClick={() => setVisibleMonth((month) => addMonths(month, -1))}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-white/48 transition-colors hover:bg-white/[0.07] hover:text-white"
            aria-label="Previous month"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-sm font-medium text-white/78">
            {visibleMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
          </span>
          <button
            type="button"
            onClick={() => setVisibleMonth((month) => addMonths(month, 1))}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-white/48 transition-colors hover:bg-white/[0.07] hover:text-white"
            aria-label="Next month"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <Calendar
          mode="single"
          hideNavigation
          month={visibleMonth}
          onMonthChange={setVisibleMonth}
          selected={activeDate}
          onSelect={selectDate}
          disabled={disabledMatcher}
          modifiers={{
            campaignStart: parseDateKey(dates.start),
            campaignRelease: parseDateKey(dates.release),
            campaignFinish: parseDateKey(dates.finish),
          }}
          modifiersClassNames={{
            campaignStart: 'ring-1 ring-white/30',
            campaignRelease: 'ring-1 ring-orange-400/65',
            campaignFinish: 'ring-1 ring-emerald-400/45',
          }}
          className="bg-transparent p-1 [--cell-size:2.25rem]"
          classNames={{
            month: 'relative flex w-full flex-col gap-2',
            month_caption: 'hidden',
            selected: 'bg-white text-black rounded-md',
            today: 'bg-white/[0.07] rounded-md',
            weekday: 'text-white/38',
            outside: 'text-white/18 aria-selected:text-white/45',
            disabled: 'text-white/24 opacity-100',
          }}
        />

        <div className="mt-2 flex items-center justify-between gap-3 border-t border-white/[0.07] pt-3">
          <div className="flex rounded-[8px] bg-black/30 p-1">
            {(['target', 'locked'] as CampaignDateStatus[]).map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => onStatusChange(activeKey, status)}
                disabled={!dates[activeKey]}
                className={cn(
                  'h-7 rounded-[6px] px-2.5 text-[9px] font-medium uppercase tracking-[0.1em] transition-colors disabled:cursor-not-allowed disabled:opacity-30',
                  (statuses[activeKey] ?? 'target') === status ? 'bg-white/[0.10] text-white/78' : 'text-white/30 hover:text-white/60',
                )}
              >
                {status}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => onDateChange(activeKey, undefined)}
            disabled={!dates[activeKey]}
            className="h-8 rounded-[7px] px-2.5 text-[10px] text-white/34 transition-colors hover:bg-white/[0.05] hover:text-white/62 disabled:cursor-not-allowed disabled:opacity-30"
          >
            Clear date
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function parseDateKey(value?: string): Date | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return undefined
  return date
}

function toDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function addMonths(date: Date, amount: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1)
}

function formatCampaignDate(value?: string): string {
  const date = parseDateKey(value)
  return date
    ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : 'Choose date'
}

function TabButton({
  active,
  children,
  onClick,
}: {
  active: boolean
  children: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'h-8 rounded-full px-3 text-xs font-medium transition-colors',
        active
          ? 'bg-white/90 text-black'
          : 'bg-white/[0.025] text-white/50 hover:bg-white/[0.06] hover:text-white/80',
      )}
    >
      {children}
    </button>
  )
}

function AssetsSetup({
  manifest,
  busy,
  releaseBoard,
  onAdd,
  onTranscribeLyrics,
  onSaveLyrics,
  onDrop,
  onOpenFolder,
}: {
  manifest: MissionAssetManifest | null
  busy: boolean
  releaseBoard: ReleaseBoard
  onAdd: (kindHint: MissionAssetKindHint) => Promise<void>
  onTranscribeLyrics: () => Promise<void>
  onSaveLyrics: (lyricsText: string, assetId?: string, sourceAudioAssetId?: string) => Promise<void>
  onDrop: (event: React.DragEvent<HTMLDivElement>) => void
  onOpenFolder: () => Promise<void>
}) {
  const files = manifest?.files ?? []
  const master = firstAsset(files, ['master', 'demo'])
  const lyrics = firstLyricsAsset(files)
  const lyricsApproved = Boolean(lyrics?.lyrics && !lyrics.lyrics.reviewRequired)
  const lyricsDraftExists = Boolean(lyrics?.lyrics?.reviewRequired)
  const [lyricsDraft, setLyricsDraft] = React.useState('')
  React.useEffect(() => {
    setLyricsDraft(lyrics?.lyrics?.text ?? '')
  }, [lyrics?.id, lyrics?.lyrics?.text])
  const cover = firstAsset(files, ['cover-art'])
  const photos = files.filter((file) => file.status === 'available' && file.kind === 'press-photo').length
  const rawVideo = files.filter((file) => file.status === 'available' && file.kind === 'raw-video').length
  const refs = files.filter((file) => file.status === 'available' && ['moodboard-image', 'audio-reference'].includes(file.kind)).length
  const toCreate = releaseBoard.categories
    .flatMap((category) => category.items.map((item) => ({ category: category.label, item })))
    .filter(({ item }) => ['canvas', 'lyric-clips', 'viral-clips', 'ugc-clips', 'lyric-video', 'ad-creatives'].includes(item.id))

  return (
    <div className="grid gap-4">
      <section
        className="rounded-2xl border border-white/[0.06] bg-[#0b0b0b] p-4"
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes('Files')) event.preventDefault()
        }}
        onDrop={onDrop}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-[10px] font-medium uppercase tracking-[0.18em] text-white/50">
              Provided
            </h3>
            <p className="mt-1 text-xs text-white/36">{files.length} working file{files.length === 1 ? '' : 's'} in Campaign Assets</p>
          </div>
          <button
            type="button"
            onClick={() => void onOpenFolder()}
            className="inline-flex h-8 items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 text-xs font-medium text-white/60 hover:bg-white/[0.07] hover:text-white"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            Folder
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <AssetBucket icon={Music2} label="Master" value={master?.label ?? 'Missing'} active={Boolean(master)} busy={busy} onClick={() => onAdd('master')} />
          <AssetBucket
            icon={FileText}
            label="Lyrics"
            value={lyricsApproved ? 'Approved' : lyricsDraftExists ? 'Needs review' : lyrics?.label ?? 'Missing'}
            active={lyricsApproved}
            busy={busy}
            onClick={() => onAdd('lyrics')}
          />
          <AssetBucket icon={ImageIcon} label="Cover Art" value={cover?.label ?? 'Missing'} active={Boolean(cover)} busy={busy} onClick={() => onAdd('cover-art')} />
          <AssetBucket icon={ImageIcon} label="Photos" value={photos ? `${photos} added` : 'Add'} active={photos > 0} busy={busy} onClick={() => onAdd('any')} />
          <AssetBucket icon={Video} label="Raw Video" value={rawVideo ? `${rawVideo} added` : 'Add'} active={rawVideo > 0} busy={busy} onClick={() => onAdd('any')} />
          <AssetBucket icon={Sparkles} label="References" value={refs ? `${refs} added` : 'Add'} active={refs > 0} busy={busy} onClick={() => onAdd('any')} />
        </div>

        <button
          type="button"
          disabled={busy}
          onClick={() => void onAdd('any')}
          className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-white/[0.10] bg-white/[0.012] text-sm font-medium text-white/52 hover:bg-white/[0.04] hover:text-white/78 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          Drop files here or add Campaign Assets
        </button>

        <div className="mt-3 rounded-xl border border-white/[0.045] bg-white/[0.012] p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-white/72">Lyrics</p>
              <p className="mt-0.5 text-xs text-white/34">
                {lyricsDraftExists ? 'Lyrics draft needs review.' : lyricsApproved ? 'Approved lyrics saved for agents.' : master ? 'Use master audio to create lyrics.' : 'Add master audio first.'}
              </p>
            </div>
            <button
              type="button"
              disabled={busy || !master || lyricsApproved}
              onClick={() => void onTranscribeLyrics()}
              className="inline-flex h-8 shrink-0 items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 text-xs font-medium text-white/62 hover:bg-white/[0.07] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
              Transcribe
            </button>
          </div>
          {lyrics ? (
            <div className="mt-3 grid gap-2">
              <textarea
                value={lyricsDraft}
                onChange={(event) => setLyricsDraft(event.target.value)}
                className="min-h-[140px] w-full resize-y rounded-lg border border-white/[0.07] bg-black/25 px-3 py-2 text-xs leading-5 text-white/72 outline-none placeholder:text-white/22 focus:border-orange-300/45"
                placeholder="Review or paste approved lyrics..."
              />
              <button
                type="button"
                disabled={busy || !lyricsDraft.trim()}
                onClick={() => void onSaveLyrics(lyricsDraft, lyrics.id, master?.id)}
                className="inline-flex h-8 items-center justify-center rounded-full bg-orange-500 px-3 text-xs font-medium text-black hover:bg-orange-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Save approved lyrics
              </button>
            </div>
          ) : null}
        </div>
      </section>

      <section className="rounded-2xl border border-white/[0.06] bg-[#0b0b0b] p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[10px] font-medium uppercase tracking-[0.18em] text-white/50">
            To Create
          </h3>
          <FileArchive className="h-3.5 w-3.5 text-white/25" />
        </div>
        <div className="grid gap-2">
          {toCreate.map(({ category, item }) => {
            const done = item.status === 'done'
            return (
              <div
                key={item.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.045] bg-white/[0.012] px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-white/76">{item.label}</p>
                  <p className="mt-0.5 text-[10px] uppercase tracking-[0.14em] text-white/28">{category}</p>
                </div>
                <span className={cn(
                  'inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2 text-[10px] font-medium',
                  done ? 'bg-emerald-400/10 text-emerald-300/78' : 'bg-white/[0.035] text-white/38',
                )}>
                  {done ? <CheckCircle2 className="h-3 w-3" /> : null}
                  {done ? 'Ready' : 'Needed'}
                </span>
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}

function AssetBucket({
  icon: Icon,
  label,
  value,
  active,
  busy,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  active: boolean
  busy: boolean
  onClick: () => Promise<void>
}) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => void onClick()}
      className="group min-w-0 rounded-xl border border-white/[0.045] bg-white/[0.012] p-3 text-left transition-colors hover:border-white/[0.10] hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-50"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <Icon className={cn('h-4 w-4', active ? 'text-orange-300/80' : 'text-white/32')} />
        <span className={cn('h-2 w-2 rounded-full', active ? 'bg-emerald-400/80' : 'bg-white/[0.10]')} />
      </div>
      <p className="truncate text-sm font-medium text-white/78">{label}</p>
      <p className={cn('mt-0.5 truncate text-xs', active ? 'text-white/45' : 'text-white/28')}>{value}</p>
    </button>
  )
}

function firstAsset(files: MissionAssetRecord[], kinds: MissionAssetRecord['kind'][]): MissionAssetRecord | null {
  return files.find((file) => file.status === 'available' && kinds.includes(file.kind)) ?? null
}

function firstLyricsAsset(files: MissionAssetRecord[]): MissionAssetRecord | null {
  return files.find((file) => file.status === 'available' && file.kind === 'lyrics' && file.lyrics && !file.lyrics.reviewRequired)
    ?? files.find((file) => file.status === 'available' && file.kind === 'lyrics' && file.lyrics)
    ?? firstAsset(files, ['lyrics'])
}

function parseList(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean)
}

function parseReferences(value: string): MissionReference[] {
  return parseList(value).map((item) => ({ type: 'other', value: item }))
}
