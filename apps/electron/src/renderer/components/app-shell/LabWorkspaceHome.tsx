import * as React from 'react'
import {
  ArrowRight,
  Clock3,
  FileText,
  Newspaper,
  PenLine,
  Search,
  Sparkles,
} from 'lucide-react'
import { navigate, routes } from '@/lib/navigate'
import { cn } from '@/lib/utils'
import { CompactPageHeader } from './CompactPageHeader'
import { hydrateLabState, loadLabUiSongs, loadLabUiSparks, subscribeLabSongs, type LabUiSong, type LabUiSpark } from '@/lib/lab-song-state'
import { openLabSparkBank } from '@/lib/lab-sparks'
import { LAB_DEFAULT_WORKER_SLUGS } from '@/lib/worker-defaults'
import { useAgents } from '@/hooks/useAgents'

interface LabWorkspaceHomeProps {
  workspaceId?: string
  workspaceName?: string
}

function SectionTitle({
  icon: Icon,
  title,
  meta,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  meta?: string
}) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-orange-400/70" />
        <h2 className="text-sm font-semibold text-white/82">{title}</h2>
      </div>
      {meta ? <span className="text-xs font-medium text-white/36">{meta}</span> : null}
    </div>
  )
}

function LabCard({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn('rounded-2xl border border-white/[0.045] bg-[#111111] p-5 shadow-minimal', className)}>
      {children}
    </section>
  )
}

function QuickAction({
  icon: Icon,
  title,
  detail,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  detail: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex min-w-0 items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.035]"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-orange-500/[0.09]">
        <Icon className="h-4 w-4 text-orange-300/70 transition-colors group-hover:text-orange-200" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-white/80">{title}</span>
        <span className="mt-0.5 block truncate text-xs text-white/38">{detail}</span>
      </span>
      <ArrowRight className="ml-auto h-3.5 w-3.5 shrink-0 text-white/20 transition-transform group-hover:translate-x-0.5 group-hover:text-white/48" />
    </button>
  )
}

function formatSongDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Recently edited'
  return `Edited ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
}

export function LabWorkspaceHome({ workspaceId }: LabWorkspaceHomeProps) {
  const [songs, setSongs] = React.useState<LabUiSong[]>([])
  const [sparks, setSparks] = React.useState<LabUiSpark[]>([])
  const { activeAgents } = useAgents(workspaceId, { includeSystemVisibleAgents: false })
  const refreshLab = React.useCallback(() => {
    setSongs(loadLabUiSongs(workspaceId))
    setSparks(loadLabUiSparks(workspaceId))
  }, [workspaceId])

  React.useEffect(() => {
    void hydrateLabState(workspaceId).then(refreshLab)
    return subscribeLabSongs(refreshLab)
  }, [refreshLab, workspaceId])

  const recentSongs = React.useMemo(
    () => [...songs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 3),
    [songs],
  )
  const recentSparks = React.useMemo(
    () => [...sparks].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt)).slice(0, 3),
    [sparks],
  )
  const labWorkerSlugs = React.useMemo(() => new Set<string>(LAB_DEFAULT_WORKER_SLUGS), [])
  const labTeam = React.useMemo(
    () => activeAgents.filter((agent) => labWorkerSlugs.has(agent.slug)),
    [activeAgents, labWorkerSlugs],
  )
  return (
    <div className="h-full overflow-y-auto bg-[#050505] text-foreground">
      <div className="flex w-full flex-col gap-3 px-5 py-4 xl:px-8 xl:py-5">
        <CompactPageHeader
          eyebrow="Creative Lab"
          title="The Lab"
          tone="orange"
          compact
          actions={
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => navigate(routes.view.agents())}
                className="hidden text-xs font-medium text-white/62 transition-colors hover:text-white/86 sm:inline-flex"
              >
                {labTeam.length} specialists ready
              </button>
                <button
                  type="button"
                  onClick={() => navigate(routes.view.lab('pad'))}
                  className="inline-flex h-9 items-center gap-2 rounded-full bg-white px-5 text-xs font-semibold text-black shadow-minimal transition-transform hover:scale-[1.02] active:scale-95"
                >
                  Open Pad
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
            </div>
          }
        />

        <div className="grid overflow-hidden rounded-xl border border-white/[0.045] bg-[#0D0D0D] md:grid-cols-3 md:divide-x md:divide-white/[0.045]">
          <QuickAction icon={PenLine} title="Song Pad" detail="Write and shape a song" onClick={() => navigate(routes.view.lab('pad'))} />
          <QuickAction icon={FileText} title="Songs" detail="Browse your catalog" onClick={() => navigate(routes.view.lab('songs'))} />
          <QuickAction icon={Search} title="Research" detail="Find references and ideas" onClick={() => navigate(routes.view.agents('reference-master'))} />
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.7fr)_minmax(280px,1fr)]">
          <LabCard className="min-h-[248px]">
            <SectionTitle icon={Clock3} title="Continue writing" meta={recentSongs.length ? `${songs.length} songs` : undefined} />
            <div className="divide-y divide-white/[0.045]">
              {recentSongs.map((song, index) => (
                <button
                  key={song.id}
                  type="button"
                  onClick={() => navigate(routes.view.lab('pad', song.id))}
                  className={cn(
                    'group flex w-full items-center gap-4 px-1 text-left transition-colors hover:bg-white/[0.025]',
                    index === 0 ? 'py-5' : 'py-3.5',
                  )}
                >
                  <span className="h-8 w-1 shrink-0 rounded-full" style={{ backgroundColor: song.color }} />
                  <span className="min-w-0 flex-1">
                    <span className={cn('block truncate font-semibold text-white/88', index === 0 ? 'text-xl' : 'text-sm')}>{song.title}</span>
                    <span className="mt-1 block truncate text-xs text-white/40">
                      {song.project} · {song.status} · {formatSongDate(song.updatedAt)}
                    </span>
                  </span>
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/[0.035] text-white/38 transition-colors group-hover:bg-white/[0.08] group-hover:text-white/80">
                    <ArrowRight className="h-3.5 w-3.5" />
                  </span>
                </button>
              ))}
              {recentSongs.length === 0 ? (
                <button
                  type="button"
                  onClick={() => navigate(routes.view.lab('pad'))}
                  className="group flex w-full items-center justify-between py-8 text-left"
                >
                  <span>
                    <span className="block text-base font-semibold text-white/78">Start your first song</span>
                    <span className="mt-1 block text-sm text-white/38">Open a clean pad and capture the idea while it is fresh.</span>
                  </span>
                  <ArrowRight className="h-4 w-4 text-white/28 transition-transform group-hover:translate-x-1 group-hover:text-white/70" />
                </button>
              ) : null}
            </div>
          </LabCard>

          <LabCard className="min-h-[248px]">
            <SectionTitle icon={Newspaper} title="Spark bank" meta={sparks.length ? String(sparks.length) : undefined} />
            <div className="divide-y divide-white/[0.045]">
              {recentSparks.map((spark) => (
                <button
                  key={spark.id}
                  type="button"
                  onClick={openLabSparkBank}
                  className="group flex w-full items-center gap-3 py-3.5 text-left"
                >
                  <Sparkles className="h-3.5 w-3.5 shrink-0 text-orange-300/58" />
                  <span className="truncate text-sm font-medium text-white/68 transition-colors group-hover:text-white/88">{spark.text}</span>
                </button>
              ))}
              {recentSparks.length === 0 ? (
                <button type="button" onClick={openLabSparkBank} className="group flex w-full items-center gap-3 py-8 text-left">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-orange-500/[0.08]">
                    <Sparkles className="h-4 w-4 text-orange-300/62" />
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-white/72">Catch what matters</span>
                    <span className="mt-1 block text-xs text-white/36">Save lines, titles, and ideas here.</span>
                  </span>
                </button>
              ) : null}
            </div>
            {recentSparks.length > 0 ? (
              <button type="button" onClick={openLabSparkBank} className="mt-4 inline-flex items-center gap-2 text-xs font-semibold text-orange-200/68 hover:text-orange-100">
                View all sparks
                <ArrowRight className="h-3 w-3" />
              </button>
            ) : null}
          </LabCard>
        </div>
      </div>
    </div>
  )
}
