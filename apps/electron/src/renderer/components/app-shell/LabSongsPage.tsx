import * as React from 'react'
import {
  ArrowDownUp,
  ArrowRight,
  CheckCircle2,
  CircleDot,
  Clock3,
  FileText,
  Folder,
  Pencil,
  PenLine,
  Plus,
  Search,
  Star,
  Trash2,
} from 'lucide-react'
import { navigate, routes } from '@/lib/navigate'
import { cn } from '@/lib/utils'
import { CompactPageHeader } from './CompactPageHeader'
import {
  createLabUiSong,
  deleteLabUiSong,
  hydrateLabState,
  LAB_PROJECT_COLORS,
  loadLabUiSongs,
  subscribeLabSongs,
  upsertLabUiSong,
} from '@/lib/lab-song-state'

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

function SongRow({
  song,
  onSetFocused,
  onSetStatus,
  onEdit,
  onDelete,
}: {
  song: SongRecord
  onSetFocused: (songId: string, focused: boolean) => void
  onSetStatus: (songId: string, status: SongStatus) => void
  onEdit: (song: SongRecord) => void
  onDelete: (song: SongRecord) => void
}) {
  const StatusIcon = song.status === 'done' ? CheckCircle2 : CircleDot

  return (
    <div
      className="group grid w-full grid-cols-[minmax(0,1fr)_150px_120px_180px] items-center gap-4 border-b border-white/[0.035] px-4 py-4 transition-colors last:border-b-0 hover:bg-white/[0.025]"
    >
      <button
        type="button"
        onClick={() => navigate(routes.view.lab('pad', song.id))}
        className="min-w-0 text-left"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium text-white/86">{song.title}</span>
          {song.focused ? (
            <span className="shrink-0 rounded-full border border-[#fb923c]/18 bg-[#fb923c]/10 px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.14em] text-[#fdba74]">
              Focus
            </span>
          ) : null}
        </span>
        <span className="mt-1 block truncate text-xs text-white/36">{song.preview}</span>
      </button>

      <span className="inline-flex min-w-0 items-center gap-2 text-xs text-white/48">
        <Folder className="h-3.5 w-3.5 shrink-0 text-white/28" />
        <span className="truncate">{song.project}</span>
      </span>

      <label className="inline-flex items-center gap-2 text-xs capitalize text-white/45">
        <StatusIcon className={cn('h-3.5 w-3.5', song.status === 'done' ? 'text-emerald-300/70' : 'text-white/30')} />
        <span className="sr-only">Status for {song.title}</span>
        <select
          aria-label={`Status for ${song.title}`}
          value={song.status}
          onChange={(event) => onSetStatus(song.id, event.target.value as SongStatus)}
          className="bg-transparent text-xs capitalize text-white/55 outline-none"
        >
          <option value="working">Working</option>
          <option value="done">Done</option>
        </select>
      </label>

      <span className="inline-flex items-center justify-end gap-2 text-xs text-white/32">
        <button
          type="button"
          aria-label={`${song.focused ? 'Remove' : 'Add'} ${song.title} ${song.focused ? 'from' : 'to'} focus`}
          aria-pressed={song.focused}
          onClick={() => onSetFocused(song.id, !song.focused)}
          className={cn(
            'rounded-full p-1.5 transition-colors hover:bg-white/[0.06]',
            song.focused ? 'text-[#fb923c]' : 'text-white/25',
          )}
        >
          <Star className={cn('h-3.5 w-3.5', song.focused && 'fill-current')} />
        </button>
        <Clock3 className="h-3.5 w-3.5" />
        {formatRelativeDate(song.editedAt)}
        <button
          type="button"
          title={`Edit ${song.title}`}
          aria-label={`Edit ${song.title}`}
          onClick={() => onEdit(song)}
          className="rounded-full p-1.5 text-white/28 transition-colors hover:bg-white/[0.06] hover:text-white/72"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          title={`Delete ${song.title}`}
          aria-label={`Delete ${song.title}`}
          onClick={() => onDelete(song)}
          className="rounded-full p-1.5 text-white/22 transition-colors hover:bg-red-500/10 hover:text-red-200/75"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </span>
    </div>
  )
}

export function LabSongsPage({ workspaceId, workspaceName }: LabSongsPageProps) {
  const [filterPreset, setFilterPreset] = React.useState<FilterPreset>('all')
  const [query, setQuery] = React.useState('')
  const [songs, setSongs] = React.useState<SongRecord[]>([])
  const [addSongOpen, setAddSongOpen] = React.useState(false)
  const [draftTitle, setDraftTitle] = React.useState('')
  const [draftTag, setDraftTag] = React.useState('')
  const [editingSongId, setEditingSongId] = React.useState<string | null>(null)
  const [editTitle, setEditTitle] = React.useState('')
  const [editProject, setEditProject] = React.useState('')

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

  const createSong = React.useCallback((event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const title = draftTitle.trim()
    if (!title) return

    createLabUiSong(workspaceId, {
      title,
      project: draftTag.trim() || 'Loose Singles',
      color: LAB_PROJECT_COLORS[songs.length % LAB_PROJECT_COLORS.length],
      notes: '',
    })
    setDraftTitle('')
    setDraftTag('')
    setFilterPreset('all')
    setQuery('')
    setAddSongOpen(false)
  }, [draftTag, draftTitle, songs.length, workspaceId])

  const updateSong = React.useCallback((songId: string, patch: Partial<Pick<SongRecord, 'focused' | 'status'>>) => {
    const song = loadLabUiSongs(workspaceId).find((item) => item.id === songId)
    if (!song) return
    upsertLabUiSong(workspaceId, { ...song, ...patch })
  }, [workspaceId])

  const onSetFocused = React.useCallback((songId: string, focused: boolean) => {
    updateSong(songId, { focused })
  }, [updateSong])

  const onSetStatus = React.useCallback((songId: string, status: SongStatus) => {
    updateSong(songId, { status })
  }, [updateSong])

  const startEditingSong = React.useCallback((song: SongRecord) => {
    setEditingSongId(song.id)
    setEditTitle(song.title)
    setEditProject(song.project)
    setAddSongOpen(false)
  }, [])

  const saveEditedSong = React.useCallback((event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const song = loadLabUiSongs(workspaceId).find((item) => item.id === editingSongId)
    const title = editTitle.trim()
    if (!song || !title) return
    upsertLabUiSong(workspaceId, {
      ...song,
      title,
      project: editProject.trim() || 'Loose Singles',
    })
    setEditingSongId(null)
  }, [editProject, editTitle, editingSongId, workspaceId])

  const deleteSong = React.useCallback((song: SongRecord) => {
    const confirmed = window.confirm(
      `Delete “${song.title}”? This removes its lyrics and takes it out of every sequence. Saved Sparks will stay in the Spark Bank.`,
    )
    if (!confirmed) return
    deleteLabUiSong(workspaceId, song.id)
    if (editingSongId === song.id) setEditingSongId(null)
  }, [editingSongId, workspaceId])

  return (
    <div className="h-full overflow-y-auto bg-[#050505] text-foreground">
      <div className="flex w-full flex-col gap-3 px-5 py-4 xl:px-8 xl:py-5">
        <CompactPageHeader
          eyebrow="The Lab"
          title="Songs"
          tone="orange"
          actions={
            <>
              <button
                type="button"
                onClick={() => setAddSongOpen(true)}
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
            </>
          }
        />

        {addSongOpen ? (
          <form
            onSubmit={createSong}
            className="flex flex-col gap-3 rounded-2xl border border-[#fb923c]/20 bg-[#0A0A0A] p-4 shadow-minimal sm:flex-row sm:items-end"
            aria-label="Add song"
          >
            <label className="min-w-0 flex-1">
              <span className="mb-1.5 block text-[9px] font-medium uppercase tracking-[0.15em] text-white/38">Title</span>
              <input
                autoFocus
                value={draftTitle}
                onChange={(event) => setDraftTitle(event.target.value)}
                placeholder="Song title"
                className="h-10 w-full rounded-xl border border-white/[0.07] bg-white/[0.025] px-3 text-sm text-white/80 outline-none placeholder:text-white/25 focus:border-[#fb923c]/35"
              />
            </label>
            <label className="min-w-0 flex-1">
              <span className="mb-1.5 block text-[9px] font-medium uppercase tracking-[0.15em] text-white/38">Tag</span>
              <input
                value={draftTag}
                onChange={(event) => setDraftTag(event.target.value)}
                placeholder="Tag (optional)"
                className="h-10 w-full rounded-xl border border-white/[0.07] bg-white/[0.025] px-3 text-sm text-white/80 outline-none placeholder:text-white/25 focus:border-[#fb923c]/35"
              />
            </label>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={() => {
                  setAddSongOpen(false)
                  setDraftTitle('')
                  setDraftTag('')
                }}
                className="h-10 rounded-full border border-white/[0.07] px-4 text-xs font-medium text-white/52 hover:bg-white/[0.04]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!draftTitle.trim()}
                className="h-10 rounded-full bg-white/90 px-5 text-xs font-medium text-black transition-transform hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-35"
              >
                Add to Songs
              </button>
            </div>
          </form>
        ) : null}

        {editingSongId ? (
          <form
            onSubmit={saveEditedSong}
            className="flex flex-col gap-3 rounded-2xl border border-white/[0.08] bg-[#0A0A0A] p-4 shadow-minimal sm:flex-row sm:items-end"
            aria-label="Edit song"
          >
            <label className="min-w-0 flex-1">
              <span className="mb-1.5 block text-[9px] font-medium uppercase tracking-[0.15em] text-white/38">Title</span>
              <input
                autoFocus
                value={editTitle}
                onChange={(event) => setEditTitle(event.target.value)}
                className="h-10 w-full rounded-xl border border-white/[0.07] bg-white/[0.025] px-3 text-sm text-white/80 outline-none focus:border-[#fb923c]/35"
              />
            </label>
            <label className="min-w-0 flex-1">
              <span className="mb-1.5 block text-[9px] font-medium uppercase tracking-[0.15em] text-white/38">Project / tag</span>
              <input
                value={editProject}
                onChange={(event) => setEditProject(event.target.value)}
                placeholder="Loose Singles"
                className="h-10 w-full rounded-xl border border-white/[0.07] bg-white/[0.025] px-3 text-sm text-white/80 outline-none placeholder:text-white/25 focus:border-[#fb923c]/35"
              />
            </label>
            <div className="flex shrink-0 gap-2">
              <button type="button" onClick={() => setEditingSongId(null)} className="h-10 rounded-full border border-white/[0.07] px-4 text-xs font-medium text-white/52 hover:bg-white/[0.04]">
                Cancel
              </button>
              <button type="submit" disabled={!editTitle.trim()} className="h-10 rounded-full bg-white/90 px-5 text-xs font-medium text-black disabled:cursor-not-allowed disabled:opacity-35">
                Save changes
              </button>
            </div>
          </form>
        ) : null}

        <section className="overflow-x-auto rounded-2xl border border-white/[0.04] bg-[#0A0A0A] shadow-minimal">
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

          <div className="grid grid-cols-[minmax(0,1fr)_150px_120px_180px] gap-4 border-b border-white/[0.035] px-4 py-2 text-[9px] font-medium uppercase tracking-[0.16em] text-white/30">
            <span>Song</span>
            <span>Project</span>
            <span>Status</span>
            <span className="text-right">Edited</span>
          </div>

          <div>
            <button
              type="button"
              onClick={() => setAddSongOpen(true)}
              className="group grid w-full grid-cols-[minmax(0,1fr)_150px_120px_180px] items-center gap-4 border-b border-white/[0.035] px-4 py-4 text-left transition-colors hover:bg-white/[0.025]"
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

            {visibleSongs.map((song) => (
              <SongRow
                key={song.id}
                song={song}
                onSetFocused={onSetFocused}
                onSetStatus={onSetStatus}
                onEdit={startEditingSong}
                onDelete={deleteSong}
              />
            ))}
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
