import * as React from 'react'
import {
  ArrowDownUp,
  ArrowRight,
  CheckCircle2,
  CircleDot,
  Clock3,
  FileText,
  FlaskConical,
  Folder,
  PenLine,
  Plus,
  Search,
} from 'lucide-react'
import { navigate, routes } from '@/lib/navigate'
import { cn } from '@/lib/utils'
import { hydrateLabState, loadLabUiSongs, subscribeLabSongs } from '@/lib/lab-song-state'

interface LabSongsPageProps {
  workspaceId?: string
  workspaceName?: string
}

type SongStatus = 'working' | 'done'
type SortMode = 'recent' | 'newest' | 'oldest'
type FilterPreset =
  | 'all'
  | 'working'
  | 'done'
  | 'focused'
  | `project:${string}`
  | `sort:${SortMode}`

type SongRecord = {
  id: string
  title: string
  preview: string
  project: string
  focused: boolean
  status: SongStatus
  editedAt: string
  createdAt: string
}

function SongRow({ song }: { song: SongRecord }) {
  const StatusIcon = song.status === 'done' ? CheckCircle2 : CircleDot

  return (
    <button
      type="button"
      onClick={() => navigate(routes.view.lab('pad', song.id))}
      className="group grid w-full grid-cols-[minmax(0,1fr)_150px_120px_96px] items-center gap-4 border-b border-white/[0.035] px-4 py-4 text-left transition-colors last:border-b-0 hover:bg-white/[0.025]"
    >
      <span className="min-w-0">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium text-white/86">{song.title}</span>
          {song.focused ? (
            <span className="shrink-0 rounded-full border border-[#fb923c]/18 bg-[#fb923c]/10 px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.14em] text-[#fdba74]">
              Focus
            </span>
          ) : null}
        </span>
        <span className="mt-1 block truncate text-xs text-white/36">{song.preview}</span>
      </span>

      <span className="inline-flex min-w-0 items-center gap-2 text-xs text-white/48">
        <Folder className="h-3.5 w-3.5 shrink-0 text-white/28" />
        <span className="truncate">{song.project}</span>
      </span>

      <span className="inline-flex items-center gap-2 text-xs capitalize text-white/45">
        <StatusIcon className={cn('h-3.5 w-3.5', song.status === 'done' ? 'text-emerald-300/70' : 'text-white/30')} />
        {song.status}
      </span>

      <span className="inline-flex items-center justify-end gap-2 text-xs text-white/32">
        <Clock3 className="h-3.5 w-3.5" />
        {formatRelativeDate(song.editedAt)}
      </span>
    </button>
  )
}

export function LabSongsPage({ workspaceId, workspaceName }: LabSongsPageProps) {
  const [filterPreset, setFilterPreset] = React.useState<FilterPreset>('all')
  const [query, setQuery] = React.useState('')
  const [songs, setSongs] = React.useState<SongRecord[]>([])

  const refreshSongs = React.useCallback(() => {
    setSongs(loadLabUiSongs(workspaceId).map((song) => ({
      id: song.id,
      title: song.title,
      preview: song.roughText.trim() || song.notes.trim() || 'No lyrics yet.',
      project: song.project,
      focused: song.focused,
      status: song.status,
      editedAt: song.updatedAt,
      createdAt: song.createdAt,
    })))
  }, [workspaceId])

  React.useEffect(() => {
    void hydrateLabState(workspaceId).then(refreshSongs)
    return subscribeLabSongs(refreshSongs)
  }, [refreshSongs, workspaceId])

  const projects = React.useMemo(
    () => Array.from(new Set(songs.map((song) => song.project))),
    [songs],
  )

  const visibleSongs = React.useMemo(() => {
    return songs
      .filter((song) => {
        if (filterPreset === 'all') return true
        if (filterPreset === 'working' || filterPreset === 'done') return song.status === filterPreset
        if (filterPreset === 'focused') return song.focused
        if (filterPreset.startsWith('project:')) return song.project === filterPreset.slice('project:'.length)
        return true
      })
      .filter((song) => {
        const text = `${song.title} ${song.preview} ${song.project}`.toLowerCase()
        return !query.trim() || text.includes(query.toLowerCase())
      })
      .sort((a, b) => {
        const sortMode = filterPreset.startsWith('sort:') ? filterPreset.slice('sort:'.length) as SortMode : 'recent'
        if (sortMode === 'newest') return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        if (sortMode === 'oldest') return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        return new Date(b.editedAt).getTime() - new Date(a.editedAt).getTime()
      })
  }, [filterPreset, query, songs])

  return (
    <div className="h-full overflow-y-auto bg-[#050505] text-foreground">
      <div className="flex w-full flex-col gap-3 px-5 py-4 xl:px-8 xl:py-5">
        <section className="relative overflow-hidden rounded-[24px] border border-white/[0.05] bg-[#0A0A0A] p-6 lg:p-8">
          <div className="absolute -left-[18%] -top-[70%] h-[520px] w-[520px] rounded-full bg-orange-600/8 blur-[115px]" />
          <div className="relative z-10 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
            <div className="min-w-0">
              <div className="mb-3 inline-flex items-center gap-2.5 rounded-full border border-white/[0.05] bg-white/[0.02] px-3 py-1.5 pr-4">
                <FlaskConical className="h-3.5 w-3.5 text-white/45" />
                <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-white/65">The Lab</span>
              </div>
              <h1 className="text-3xl font-medium tracking-tighter text-white/90 sm:text-4xl">
                Songs
              </h1>
              <p className="mt-2 max-w-2xl text-sm font-light leading-relaxed text-white/48">
                A simple library for drafts, focused songs, finished ideas, and projects.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2.5">
              <button
                type="button"
                onClick={() => navigate(routes.view.lab('pad'))}
                className="inline-flex h-9 items-center gap-2 rounded-full bg-white/90 px-5 text-xs font-medium text-black transition-transform hover:scale-[1.02] active:scale-95"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Song
              </button>
              <button
                type="button"
                onClick={() => navigate(routes.view.lab('pad'))}
                className="inline-flex h-9 items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.025] px-4 text-xs font-medium text-white/70 hover:bg-white/[0.05]"
              >
                <PenLine className="h-3.5 w-3.5" />
                Open Pad
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-white/[0.04] bg-[#0A0A0A] shadow-minimal">
          <div className="flex items-center justify-between gap-3 border-b border-white/[0.04] p-4">
            <label className="inline-flex h-8 items-center gap-2 rounded-full border border-white/[0.06] bg-white/[0.025] px-3 text-xs text-white/45">
              <ArrowDownUp className="h-3.5 w-3.5 text-white/35" />
              <span className="sr-only">Filter songs</span>
              <select
                value={filterPreset}
                onChange={(event) => setFilterPreset(event.target.value as FilterPreset)}
                className="bg-transparent text-xs text-white/62 outline-none"
              >
                <option value="all">All songs</option>
                <option value="working">Working</option>
                <option value="done">Done</option>
                <option value="focused">Focused</option>
                {projects.map((project) => (
                  <option key={project} value={`project:${project}`}>Project: {project}</option>
                ))}
                <option value="sort:recent">Recently edited</option>
                <option value="sort:newest">Newest first</option>
                <option value="sort:oldest">Oldest first</option>
              </select>
            </label>

            <div className="flex items-center gap-2">
              <div className="flex h-8 w-[220px] items-center gap-2 rounded-full border border-white/[0.06] bg-white/[0.025] px-3">
                <Search className="h-3.5 w-3.5 text-white/30" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search songs"
                  className="min-w-0 flex-1 border-0 bg-transparent text-xs text-white/70 outline-none placeholder:text-white/28"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-[minmax(0,1fr)_150px_120px_96px] gap-4 border-b border-white/[0.035] px-4 py-2 text-[9px] font-medium uppercase tracking-[0.16em] text-white/30">
            <span>Song</span>
            <span>Project</span>
            <span>Status</span>
            <span className="text-right">Edited</span>
          </div>

          <div>
            <button
              type="button"
              onClick={() => navigate(routes.view.lab('pad'))}
              className="group grid w-full grid-cols-[minmax(0,1fr)_150px_120px_96px] items-center gap-4 border-b border-white/[0.035] px-4 py-4 text-left transition-colors hover:bg-white/[0.025]"
            >
              <span className="inline-flex min-w-0 items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-dashed border-white/[0.12] bg-white/[0.018]">
                  <Plus className="h-4 w-4 text-white/42" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-white/82">New song</span>
                  <span className="mt-1 block text-xs text-white/34">Start with a title, line, hook, or empty pad.</span>
                </span>
              </span>
              <span className="text-xs text-white/28">Unassigned</span>
              <span className="text-xs text-white/28">Draft</span>
              <span className="flex justify-end">
                <ArrowRight className="h-3.5 w-3.5 text-white/28" />
              </span>
            </button>

            {visibleSongs.map((song) => <SongRow key={song.id} song={song} />)}
          </div>
        </section>

        <div className="text-xs text-white/28">
          Showing {visibleSongs.length} of {songs.length} songs in {workspaceName || 'Creative Lab'}.
        </div>
      </div>
    </div>
  )
}

function formatRelativeDate(value: string) {
  const date = new Date(value)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / 86_400_000)
  if (diffDays <= 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  return `${diffDays}d ago`
}
