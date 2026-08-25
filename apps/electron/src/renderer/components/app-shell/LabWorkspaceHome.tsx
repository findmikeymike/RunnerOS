import * as React from 'react'
import {
  ArrowRight,
  Bot,
  Clock3,
  FileText,
  FlaskConical,
  MessageSquare,
  Newspaper,
  PenLine,
  Search,
  Sparkles,
} from 'lucide-react'
import { navigate, routes } from '@/lib/navigate'
import { cn } from '@/lib/utils'
import { hydrateLabState, loadLabUiSongs, subscribeLabSongs, type LabUiSong } from '@/lib/lab-song-state'
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
    <div className="mb-3 flex items-center justify-between border-b border-white/[0.04] pb-2.5">
      <div className="flex items-center gap-2">
        <Icon className="h-3 w-3 text-white/40" />
        <h3 className="text-[9px] font-medium uppercase tracking-[0.15em] text-white/60">{title}</h3>
      </div>
      {meta ? <span className="text-[8px] font-medium uppercase tracking-widest text-white/30">{meta}</span> : null}
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
    <section className={cn('rounded-2xl border border-white/[0.04] bg-[#0A0A0A] p-4 shadow-minimal', className)}>
      {children}
    </section>
  )
}

function ActionTile({
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
      className="group min-w-0 rounded-xl border border-white/[0.045] bg-white/[0.012] p-3 text-left transition-colors hover:border-white/[0.09] hover:bg-white/[0.035]"
    >
      <span className="mb-3 flex h-8 w-8 items-center justify-center rounded-full border border-white/[0.05] bg-white/[0.02]">
        <Icon className="h-4 w-4 text-white/45 group-hover:text-[#fdba74]" />
      </span>
      <span className="block truncate text-sm font-medium text-white/82">{title}</span>
      <span className="mt-1 block text-xs leading-5 text-white/38">{detail}</span>
    </button>
  )
}

export function LabWorkspaceHome({ workspaceId, workspaceName }: LabWorkspaceHomeProps) {
  const [songs, setSongs] = React.useState<LabUiSong[]>([])
  const { activeAgents } = useAgents(workspaceId, { includeSystemVisibleAgents: false })
  const refreshSongs = React.useCallback(() => setSongs(loadLabUiSongs(workspaceId)), [workspaceId])

  React.useEffect(() => {
    void hydrateLabState(workspaceId).then(refreshSongs)
    return subscribeLabSongs(refreshSongs)
  }, [refreshSongs, workspaceId])

  const recentSongs = React.useMemo(
    () => [...songs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 3),
    [songs],
  )
  const sparks = React.useMemo(
    () => songs.flatMap((song) => song.rememberText.split('\n').map((line) => line.trim()).filter(Boolean)).slice(0, 3),
    [songs],
  )
  return (
    <div className="h-full overflow-y-auto bg-[#050505] text-foreground">
      <div className="flex w-full flex-col gap-3 px-5 py-4 xl:px-8 xl:py-5">
        <section className="relative min-h-[230px] overflow-hidden rounded-[24px] border border-white/[0.05] bg-[#0A0A0A]">
          <div className="absolute -left-[20%] -top-[40%] h-[600px] w-[600px] rounded-full bg-orange-600/10 blur-[120px]" />
          <div className="absolute -bottom-[45%] -right-[10%] h-[620px] w-[620px] rounded-full bg-indigo-600/5 blur-[120px]" />

          <div className="relative z-10 flex min-h-[230px] flex-col justify-between p-6 lg:p-8">
            <div className="flex items-start justify-between gap-4">
              <div className="inline-flex items-center gap-2.5 rounded-full border border-white/[0.05] bg-white/[0.02] px-3 py-1.5 pr-4 backdrop-blur-md">
                <span className="flex h-2 w-2 items-center justify-center rounded-full bg-[#f97316]/20">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#fb923c]" />
                </span>
                <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-white/70">
                  Creative Workspace
                </span>
              </div>
              <p className="text-right text-[10px] font-medium uppercase tracking-[0.2em] text-white/38">
                Songs · Lyrics · Research
              </p>
            </div>

            <div className="my-5 max-w-[760px]">
              <h1 className="text-4xl font-medium tracking-tighter text-white/90 sm:text-5xl md:text-6xl lg:text-[56px] lg:leading-[0.94]">
                The Lab
              </h1>
              <p className="mt-3 max-w-2xl text-sm font-light leading-relaxed text-white/50">
                A quiet place to collect loose ideas, write songs, shape lyrics, and turn sparks into something worth finishing.
              </p>
            </div>

            <div className="flex flex-col gap-4 border-t border-white/[0.05] pt-4 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="text-[9px] font-medium uppercase tracking-[0.18em] text-white/40">Workspace</p>
                <p className="mt-1 text-xs font-medium text-white/72">{workspaceName || 'Creative Lab'}</p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2.5">
                <button
                  type="button"
                  onClick={() => navigate(routes.view.lab('pad'))}
                  className="inline-flex h-9 items-center gap-2 rounded-full bg-white/90 px-5 text-xs font-medium text-black transition-transform hover:scale-[1.02] active:scale-95"
                >
                  Open Pad
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => navigate(routes.view.lab('songs'))}
                  className="inline-flex h-9 items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.025] px-4 text-xs font-medium text-white/70 hover:bg-white/[0.05]"
                >
                  Songs
                </button>
              </div>
            </div>
          </div>
        </section>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <ActionTile icon={PenLine} title="Song Pad" detail="Write loose, then shape the structure." onClick={() => navigate(routes.view.lab('pad'))} />
          <ActionTile icon={FileText} title="Songs" detail="Browse drafts by project, focus, and status." onClick={() => navigate(routes.view.lab('songs'))} />
          <ActionTile icon={Search} title="Research" detail="Collect references, stories, and concepts." onClick={() => navigate(routes.view.agents('researcher'))} />
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <LabCard>
            <SectionTitle icon={Clock3} title="Recent Songs" meta={String(recentSongs.length)} />
            <div className="space-y-2">
              {recentSongs.map((song) => (
                <button
                  key={song.id}
                  type="button"
                  onClick={() => navigate(routes.view.lab('pad', song.id))}
                  className="w-full rounded-xl border border-white/[0.04] bg-white/[0.012] px-3 py-3 text-left transition-colors hover:bg-white/[0.035]"
                >
                  <p className="truncate text-sm font-medium text-white/82">{song.title}</p>
                  <p className="mt-1 truncate text-xs text-white/36">{song.project} · {song.status}</p>
                </button>
              ))}
              {recentSongs.length === 0 ? <p className="px-1 py-3 text-xs text-white/34">No songs yet.</p> : null}
            </div>
          </LabCard>

          <LabCard>
            <SectionTitle icon={Newspaper} title="Sparks" meta="Ideas" />
            <div className="space-y-2">
              {sparks.map((spark) => (
                <button
                  key={spark}
                  type="button"
                  onClick={() => navigate(routes.view.agents('researcher'))}
                  className="flex w-full items-center gap-2 rounded-xl border border-white/[0.04] bg-white/[0.012] px-3 py-3 text-left transition-colors hover:bg-white/[0.035]"
                >
                  <Sparkles className="h-3.5 w-3.5 shrink-0 text-white/32" />
                  <span className="truncate text-sm font-medium text-white/72">{spark}</span>
                </button>
              ))}
              {sparks.length === 0 ? <p className="px-1 py-3 text-xs text-white/34">Saved ideas will appear here.</p> : null}
            </div>
          </LabCard>

          <LabCard>
            <SectionTitle icon={Bot} title="Lab Team" meta={`${activeAgents.length} active`} />
            <div className="rounded-xl border border-white/[0.03] bg-white/[0.012] p-4">
              <p className="text-sm font-medium text-white/75">{activeAgents.length ? 'Your creative team is ready' : 'No workers active'}</p>
              <p className="mt-1 text-xs leading-5 text-white/38">
                Activate only the specialists you want available in this Lab.
              </p>
              <button
                type="button"
                onClick={() => navigate(routes.view.agents())}
                className="mt-4 inline-flex h-8 items-center gap-2 rounded-full border border-white/[0.07] bg-white/[0.025] px-3 text-xs font-medium text-white/62 hover:bg-white/[0.05]"
              >
                Workers
                <ArrowRight className="h-3 w-3" />
              </button>
            </div>
          </LabCard>
        </div>
      </div>
    </div>
  )
}
