import * as React from 'react'
import {
  Archive,
  Bell,
  Bot,
  Brain,
  CalendarDays,
  ChevronRight,
  CircleHelp,
  FileCheck2,
  FileText,
  FlaskConical,
  FolderOutput,
  Gauge,
  Gem,
  Globe2,
  KeyRound,
  ListChecks,
  LockKeyhole,
  ListMusic,
  MessageSquareText,
  Music2,
  PenLine,
  RadioTower,
  Settings,
  Sparkles,
  Users,
  Wrench,
  Workflow,
  Zap,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import {
  ARTIST_GUIDE_TABS,
  ARTIST_GUIDE_CONNECTIONS,
  ARTIST_GUIDE_PRIMARY_TAB_IDS,
  ARTIST_GUIDE_UTILITY_TAB_IDS,
  type ArtistGuideActionId,
  type ArtistGuideAiReadiness,
  type ArtistGuideIconId,
  type ArtistGuideItem,
  type ArtistGuideTabId,
} from './artist-guide-content'

const GUIDE_TAB_BY_ID = new Map(ARTIST_GUIDE_TABS.map((tab) => [tab.id, tab]))
const CONNECTION_GROUPS = Array.from(new Set(ARTIST_GUIDE_CONNECTIONS.map((connection) => connection.group)))

type ArtistGuideDialogProps = {
  open: boolean
  activeTab: ArtistGuideTabId
  aiReadiness: ArtistGuideAiReadiness
  availableActions: ReadonlySet<ArtistGuideActionId>
  onOpenChange: (open: boolean) => void
  onTabChange: (tab: ArtistGuideTabId) => void
  onAction: (action: ArtistGuideActionId) => void | Promise<void>
}

const GUIDE_ICONS: Record<ArtistGuideIconId, LucideIcon> = {
  ai: Sparkles,
  connection: KeyRound,
  accounts: RadioTower,
  safety: LockKeyhole,
  brain: Brain,
  command: MessageSquareText,
  workers: Bot,
  workflow: Workflow,
  automation: Zap,
  outputs: FolderOutput,
  lab: FlaskConical,
  hq: Gauge,
  people: Users,
  campaign: Globe2,
  calendar: CalendarDays,
  essentials: ListChecks,
  'release-kit': Archive,
  'song-pad': PenLine,
  songs: Music2,
  projects: ListMusic,
  spark: Gem,
  tools: Wrench,
  skills: Zap,
  context: FileText,
  notifications: Bell,
  settings: Settings,
  guide: CircleHelp,
}

const AI_READINESS_COPY: Record<ArtistGuideAiReadiness, { label: string; className: string }> = {
  ready: { label: 'Ready', className: 'bg-emerald-300/[0.10] text-emerald-100/70' },
  'needs-setup': { label: 'Needs setup', className: 'bg-orange-300/[0.10] text-orange-100/72' },
  'check-setup': { label: 'Check setup', className: 'bg-amber-300/[0.10] text-amber-100/70' },
}

export function ArtistGuideDialog({
  open,
  activeTab,
  aiReadiness,
  availableActions,
  onOpenChange,
  onTabChange,
  onAction,
}: ArtistGuideDialogProps) {
  const scrollRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!open) return
    scrollRef.current?.scrollTo({ top: 0 })
  }, [activeTab, open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="artist-guide-dialog"
        className="top-14 right-2 left-auto flex h-[min(760px,calc(100dvh-4rem))] w-[min(760px,calc(100vw-1rem))] max-w-[760px] translate-x-0 translate-y-0 grid-rows-none flex-col gap-0 overflow-hidden rounded-[22px] border-white/[0.09] bg-[linear-gradient(145deg,rgba(25,25,27,0.98),rgba(8,8,9,0.99))] p-0 text-white shadow-modal-small max-[760px]:top-2 max-[760px]:h-[calc(100dvh-1rem)]"
      >
        <DialogHeader className="shrink-0 border-b border-white/[0.06] bg-[radial-gradient(circle_at_95%_0%,rgba(249,115,22,0.14),transparent_42%),linear-gradient(120deg,rgba(239,68,68,0.07),transparent_44%)] px-6 pb-4 pt-5 pr-14 text-left">
          <div className="mb-2 flex items-center gap-2 text-[11px] font-medium text-orange-200/62">
            <CircleHelp className="h-3.5 w-3.5" strokeWidth={1.7} />
            Start here
          </div>
          <DialogTitle className="text-[22px] font-medium tracking-[-0.025em] text-white/92">Artist OS Guide</DialogTitle>
          <DialogDescription className="mt-1 max-w-xl text-[13px] leading-5 text-white/44">
            The essentials for setting up Artist OS and knowing where your work belongs.
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={activeTab}
          onValueChange={(value) => onTabChange(value as ArtistGuideTabId)}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="shrink-0 border-b border-white/[0.055] bg-black/18 px-5 py-3">
            <TabsList aria-label="Artist OS guide sections" className="grid h-9 w-full grid-cols-4 rounded-[10px] bg-black/30 p-1">
              {ARTIST_GUIDE_PRIMARY_TAB_IDS.map((tabId) => {
                const tab = GUIDE_TAB_BY_ID.get(tabId)!
                return (
                  <TabsTrigger
                    key={tab.id}
                    value={tab.id}
                    className="rounded-[7px] px-0.5 text-[10px] font-medium text-white/42 shadow-none data-[state=active]:bg-white/[0.09] data-[state=active]:text-white/88 data-[state=active]:shadow-none sm:text-[11px]"
                  >
                    {tab.label}
                  </TabsTrigger>
                )
              })}
            </TabsList>
            <div className="mt-2 flex items-center justify-between gap-3 px-1">
              <span className="text-[9px] font-medium uppercase tracking-[0.16em] text-white/24">Setup & controls</span>
              <TabsList aria-label="Artist OS setup and controls" className="flex h-7 gap-1 rounded-[8px] bg-transparent p-0">
                {ARTIST_GUIDE_UTILITY_TAB_IDS.map((tabId) => {
                  const tab = GUIDE_TAB_BY_ID.get(tabId)!
                  return (
                    <TabsTrigger
                      key={tab.id}
                      value={tab.id}
                      className="h-7 rounded-[7px] bg-white/[0.025] px-3 text-[10px] font-medium text-white/36 shadow-none data-[state=active]:bg-white/[0.08] data-[state=active]:text-white/78 data-[state=active]:shadow-none"
                    >
                      {tab.label}
                    </TabsTrigger>
                  )
                })}
              </TabsList>
            </div>
          </div>

          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5">
            {ARTIST_GUIDE_TABS.map((tab) => (
              <TabsContent key={tab.id} value={tab.id} className="mt-0 pt-5 focus-visible:ring-0">
                <p className="max-w-[640px] text-[13px] leading-5 text-white/48">{tab.intro}</p>

                <GuideSection title="Start here" className="mt-6">
                  <div className="overflow-hidden rounded-[15px] bg-white/[0.035]">
                    {tab.start.map((item, index) => (
                      <GuideStartRow
                        key={item.id}
                        item={item}
                        index={index}
                        aiReadiness={aiReadiness}
                        availableActions={availableActions}
                        onAction={onAction}
                      />
                    ))}
                  </div>
                </GuideSection>

                {tab.id === 'connections' ? (
                  <ConnectionsCatalog availableActions={availableActions} onAction={onAction} />
                ) : (
                  <>
                    <GuideSection title="Where to go" className="mt-7">
                      <div className="grid gap-2 md:grid-cols-2">
                        {tab.destinations.map((item) => (
                          <GuideDestinationCard
                            key={item.id}
                            item={item}
                            availableActions={availableActions}
                            onAction={onAction}
                          />
                        ))}
                      </div>
                    </GuideSection>

                    <GuideSection title={tab.conceptsLabel} className="mt-7">
                      <div className="space-y-1.5">
                        {tab.concepts.map((item) => (
                          <details key={item.id} className="group rounded-[11px] bg-white/[0.027] px-3.5 py-3 open:bg-white/[0.04]">
                            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[12px] font-medium text-white/68 marker:hidden">
                              {item.title}
                              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-white/28 transition-transform group-open:rotate-90" />
                            </summary>
                            <p className="max-w-[640px] pt-2 text-[12px] leading-[1.65] text-white/42">{item.body}</p>
                          </details>
                        ))}
                      </div>
                    </GuideSection>
                  </>
                )}
              </TabsContent>
            ))}
          </div>
        </Tabs>

        <div className="shrink-0 border-t border-white/[0.06] bg-black/22 p-4">
          <button
            type="button"
            onClick={() => { void onAction('workspace.command') }}
            disabled={!availableActions.has('workspace.command')}
            className="flex h-10 w-full items-center justify-between rounded-[11px] bg-[linear-gradient(105deg,rgba(239,68,68,0.13),rgba(249,115,22,0.13))] px-4 text-left text-[12px] font-medium text-white/76 transition-colors hover:bg-[linear-gradient(105deg,rgba(239,68,68,0.18),rgba(249,115,22,0.18))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/35 disabled:cursor-not-allowed disabled:opacity-35"
          >
            <span className="flex items-center gap-2">
              <MessageSquareText className="h-3.5 w-3.5 text-orange-200/68" />
              Still stuck? Ask Command
            </span>
            <ChevronRight className="h-3.5 w-3.5 text-white/34" />
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function GuideSection({ title, className, children }: { title: string; className?: string; children: React.ReactNode }) {
  return (
    <section className={className}>
      <h3 className="mb-2.5 text-[13px] font-medium text-white/72">{title}</h3>
      {children}
    </section>
  )
}

function ConnectionsCatalog({
  availableActions,
  onAction,
}: {
  availableActions: ReadonlySet<ArtistGuideActionId>
  onAction: (action: ArtistGuideActionId) => void | Promise<void>
}) {
  return (
    <GuideSection title="Available connections" className="mt-7">
      <div className="space-y-5">
        {CONNECTION_GROUPS.map((group) => (
          <div key={group}>
            <div className="mb-2 text-[9px] font-medium uppercase tracking-[0.15em] text-white/28">{group}</div>
            <div className="grid gap-2 md:grid-cols-2">
              {ARTIST_GUIDE_CONNECTIONS.filter((connection) => connection.group === group).map((connection) => {
                const actionAvailable = availableActions.has(connection.action.id)
                return (
                  <div key={connection.id} className="rounded-[13px] bg-white/[0.032] p-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <h4 className="pt-0.5 text-[12px] font-medium text-white/76">{connection.title}</h4>
                      {actionAvailable ? (
                        <button
                          type="button"
                          onClick={() => { void onAction(connection.action.id) }}
                          className="shrink-0 rounded-[7px] bg-white/[0.055] px-2.5 py-1.5 text-[9px] font-medium text-white/52 transition-colors hover:bg-white/[0.09] hover:text-white/82 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/35"
                        >
                          {connection.action.label}
                        </button>
                      ) : null}
                    </div>
                    <p className="mt-2 text-[10.5px] leading-[1.55] text-white/40">
                      <span className="font-medium text-white/58">Unlocks: </span>
                      {connection.unlocks}
                    </p>
                    <p className="mt-1.5 text-[10.5px] leading-[1.55] text-white/34">
                      <span className="font-medium text-white/52">Connect: </span>
                      {connection.setup}
                    </p>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </GuideSection>
  )
}

function GuideStartRow({
  item,
  index,
  aiReadiness,
  availableActions,
  onAction,
}: {
  item: ArtistGuideItem
  index: number
  aiReadiness: ArtistGuideAiReadiness
  availableActions: ReadonlySet<ArtistGuideActionId>
  onAction: (action: ArtistGuideActionId) => void | Promise<void>
}) {
  const Icon = item.icon ? GUIDE_ICONS[item.icon] : FileCheck2
  const readiness = item.readiness === 'ai' ? AI_READINESS_COPY[aiReadiness] : null

  return (
    <div className={cn('flex gap-3 px-4 py-3.5', index > 0 && 'border-t border-white/[0.05]')}>
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] bg-white/[0.055] text-white/52">
        <Icon className="h-3.5 w-3.5" strokeWidth={1.6} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] font-medium text-white/76">
            <span className="mr-1.5 text-white/28">{index + 1}.</span>
            {item.title}
          </span>
          {readiness ? (
            <span className={cn('rounded-full px-2 py-0.5 text-[9px] font-medium', readiness.className)}>
              {readiness.label}
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-[11px] leading-[1.55] text-white/40">{item.body}</p>
        <GuideActions item={item} availableActions={availableActions} onAction={onAction} />
      </div>
    </div>
  )
}

function GuideDestinationCard({
  item,
  availableActions,
  onAction,
}: {
  item: ArtistGuideItem
  availableActions: ReadonlySet<ArtistGuideActionId>
  onAction: (action: ArtistGuideActionId) => void | Promise<void>
}) {
  const Icon = item.icon ? GUIDE_ICONS[item.icon] : FileCheck2

  return (
    <div className="flex min-h-[112px] flex-col rounded-[14px] bg-white/[0.032] p-3.5 transition-colors hover:bg-white/[0.045]">
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-white/[0.055] text-orange-100/58">
          <Icon className="h-3.5 w-3.5" strokeWidth={1.6} />
        </div>
        <h4 className="text-[12px] font-medium text-white/75">{item.title}</h4>
      </div>
      <p className="mt-2 text-[11px] leading-[1.55] text-white/39">{item.body}</p>
      <GuideActions item={item} availableActions={availableActions} onAction={onAction} className="mt-auto pt-3" />
    </div>
  )
}

function GuideActions({
  item,
  availableActions,
  onAction,
  className,
}: {
  item: ArtistGuideItem
  availableActions: ReadonlySet<ArtistGuideActionId>
  onAction: (action: ArtistGuideActionId) => void | Promise<void>
  className?: string
}) {
  const visibleActions = item.actions?.filter((action) => availableActions.has(action.id)) ?? []
  if (visibleActions.length === 0) return null

  return (
    <div className={cn('mt-2 flex flex-wrap gap-1.5', className)}>
      {visibleActions.map((action) => (
        <button
          key={`${item.id}:${action.id}`}
          type="button"
          onClick={() => { void onAction(action.id) }}
          className="rounded-[7px] bg-white/[0.055] px-2.5 py-1.5 text-[10px] font-medium text-white/54 transition-colors hover:bg-white/[0.09] hover:text-white/82 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/35"
        >
          {action.label}
        </button>
      ))}
    </div>
  )
}
