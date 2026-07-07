import * as React from 'react'
import {
  ArrowDownUp,
  ChevronDown,
  GripVertical,
  ListMusic,
  Music2,
  PenLine,
  Plus,
  Trash2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { navigate, routes } from '@/lib/navigate'
import {
  createLabUiSong,
  LAB_PROJECT_COLORS,
  loadLabProjectsState,
  loadLabUiSongs,
  saveLabProjectsState,
  setSelectedLabSongId,
  subscribeLabSongs,
  upsertLabUiSong,
  type LabUiSequencePage,
  type LabUiSong,
} from '@/lib/lab-song-state'

interface LabSequencePageProps {
  workspaceId?: string
  workspaceName?: string
}

function moveId(list: string[], id: string, targetId: string | null) {
  const without = list.filter((item) => item !== id)
  if (!targetId) return [...without, id]
  const targetIndex = without.indexOf(targetId)
  if (targetIndex < 0) return [...without, id]
  return [...without.slice(0, targetIndex), id, ...without.slice(targetIndex)]
}

export function LabSequencePage({ workspaceId, workspaceName }: LabSequencePageProps) {
  const [songs, setSongs] = React.useState(() => loadLabUiSongs(workspaceId))
  const [poolOrder, setPoolOrder] = React.useState(() => loadLabProjectsState(workspaceId).poolOrder)
  const [sequencePages, setSequencePages] = React.useState<LabUiSequencePage[]>(() => loadLabProjectsState(workspaceId).sequencePages)
  const [activeSequenceId, setActiveSequenceId] = React.useState(() => loadLabProjectsState(workspaceId).activeSequenceId)
  const [draftTitle, setDraftTitle] = React.useState('')
  const [draftProject, setDraftProject] = React.useState('Loose Singles')
  const [draftNotes, setDraftNotes] = React.useState('')
  const [draftColor, setDraftColor] = React.useState(LAB_PROJECT_COLORS[0])
  const [addOpen, setAddOpen] = React.useState(false)

  React.useEffect(() => {
    const state = loadLabProjectsState(workspaceId)
    setSongs(loadLabUiSongs(workspaceId))
    setPoolOrder(state.poolOrder)
    setSequencePages(state.sequencePages)
    setActiveSequenceId(state.activeSequenceId)
  }, [workspaceId])

  React.useEffect(() => subscribeLabSongs(() => {
    const nextSongs = loadLabUiSongs(workspaceId)
    setSongs(nextSongs)
    setPoolOrder((current) => {
      const known = new Set(current)
      const missing = nextSongs.map((song) => song.id).filter((id) => !known.has(id))
      return [...missing, ...current.filter((id) => nextSongs.some((song) => song.id === id))]
    })
  }), [workspaceId])

  React.useEffect(() => {
    saveLabProjectsState(workspaceId, { poolOrder, sequencePages, activeSequenceId })
  }, [activeSequenceId, poolOrder, sequencePages, workspaceId])

  const songsById = React.useMemo(() => new Map(songs.map((song) => [song.id, song])), [songs])
  const activeSequence = sequencePages.find((page) => page.id === activeSequenceId) ?? sequencePages[0]
  const poolSongs = poolOrder.map((id) => songsById.get(id)).filter(Boolean) as LabUiSong[]
  const sequenceSongs = (activeSequence?.songIds ?? []).map((id) => songsById.get(id)).filter(Boolean) as LabUiSong[]
  const projects = Array.from(new Set(songs.map((song) => song.project)))

  const updateActiveSequence = (updater: (songIds: string[]) => string[]) => {
    setSequencePages((prev) => prev.map((page) => (
      page.id === activeSequenceId ? { ...page, songIds: updater(page.songIds) } : page
    )))
  }

  const updateSequenceTitle = (title: string) => {
    setSequencePages((prev) => prev.map((page) => (
      page.id === activeSequenceId ? { ...page, title } : page
    )))
  }

  const addSequencePage = () => {
    const nextNumber = sequencePages.length + 1
    const page = { id: `sequence-${Date.now()}`, title: `Project List ${nextNumber}`, songIds: [] }
    setSequencePages((prev) => [...prev, page])
    setActiveSequenceId(page.id)
  }

  const addSong = () => {
    const title = draftTitle.trim()
    if (!title) return
    const project = draftProject.trim() || 'Loose Singles'
    const song = createLabUiSong(workspaceId, {
      title,
      project,
      color: draftColor,
      notes: draftNotes.trim(),
    })
    setPoolOrder((prev) => [song.id, ...prev.filter((id) => id !== song.id)])
    setDraftTitle('')
    setDraftNotes('')
    setAddOpen(false)
  }

  const updateSong = (id: string, patch: Partial<Pick<LabUiSong, 'notes' | 'project'>>) => {
    const song = songsById.get(id)
    if (!song) return
    upsertLabUiSong(workspaceId, { ...song, ...patch })
  }

  const openSongPad = (songId: string) => {
    setSelectedLabSongId(workspaceId, songId)
    navigate(routes.view.lab('pad', songId))
  }

  const onDragStart = (event: React.DragEvent, id: string, source: 'pool' | 'sequence') => {
    event.dataTransfer.setData('application/x-lab-song-id', id)
    event.dataTransfer.setData('application/x-lab-source', source)
    event.dataTransfer.effectAllowed = 'move'
  }

  const readDrag = (event: React.DragEvent) => {
    const id = event.dataTransfer.getData('application/x-lab-song-id')
    const source = event.dataTransfer.getData('application/x-lab-source') as 'pool' | 'sequence'
    return id ? { id, source } : null
  }

  const dropInPool = (event: React.DragEvent, targetId: string | null = null) => {
    event.stopPropagation()
    event.preventDefault()
    const drag = readDrag(event)
    if (!drag) return
    if (drag.source === 'sequence') {
      updateActiveSequence((prev) => prev.filter((id) => id !== drag.id))
    }
    setPoolOrder((prev) => moveId(prev.includes(drag.id) ? prev : [...prev, drag.id], drag.id, targetId))
  }

  const dropInSequence = (event: React.DragEvent, targetId: string | null = null) => {
    event.stopPropagation()
    event.preventDefault()
    const drag = readDrag(event)
    if (!drag) return
    updateActiveSequence((prev) => moveId(prev.includes(drag.id) ? prev : [...prev, drag.id], drag.id, targetId))
  }

  return (
    <div className="h-full overflow-hidden bg-[#050505] text-foreground">
      <div className="flex h-full min-h-0 w-full flex-col gap-3 px-5 py-4 xl:px-8 xl:py-5">
        <section className="relative overflow-hidden rounded-[24px] border border-white/[0.05] bg-[#0A0A0A] px-5 py-5 shadow-minimal lg:px-7 lg:py-6">
          <div className="absolute -left-[18%] -top-[80%] h-[520px] w-[520px] rounded-full bg-orange-600/8 blur-[115px]" />
          <div className="relative z-10 flex items-end justify-between gap-4">
            <div className="min-w-0">
              <div className="mb-3 inline-flex items-center gap-2.5 rounded-full border border-white/[0.05] bg-white/[0.02] px-3 py-1.5 pr-4">
                <ListMusic className="h-3.5 w-3.5 text-white/45" />
                <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-white/65">
                  {workspaceName || 'The Lab'}
                </span>
              </div>
              <h1 className="text-3xl font-medium tracking-tighter text-white/90 sm:text-4xl">Projects</h1>
              <p className="mt-2 max-w-2xl text-sm font-light leading-relaxed text-white/48">
                Build album, EP, and setlist orders from your song pool.
              </p>
            </div>
            <div className="hidden shrink-0 items-center gap-2 rounded-full border border-white/[0.06] bg-white/[0.025] px-4 py-2 text-[10px] uppercase tracking-[0.16em] text-white/42 sm:flex">
              <ArrowDownUp className="h-3.5 w-3.5" />
              Drag to order
            </div>
          </div>
        </section>

        <div className="grid min-h-0 flex-1 grid-cols-[360px_minmax(0,1fr)] gap-3">
          <aside className="flex min-h-0 flex-col gap-3">
            <section className="rounded-2xl border border-white/[0.05] bg-[#0A0A0A]">
              <div className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#fb923c]/12 text-[#fdba74]">
                    <Music2 className="h-3.5 w-3.5" />
                  </span>
                  <h2 className="text-sm font-semibold text-white/84">Add song</h2>
                </div>
                <button
                  type="button"
                  onClick={() => setAddOpen((open) => !open)}
                  className="flex h-7 w-7 items-center justify-center rounded-full border border-white/[0.06] text-white/38 hover:bg-white/[0.04] hover:text-white/70"
                  title={addOpen ? 'Close add song' : 'Open add song'}
                >
                  <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', addOpen && 'rotate-180')} />
                </button>
              </div>
              {addOpen ? (
                <div className="space-y-2.5 border-t border-white/[0.04] p-4 pt-3">
                  <input
                    value={draftTitle}
                    onChange={(event) => setDraftTitle(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') addSong()
                    }}
                    placeholder="Song title"
                    className={INPUT_CLASS}
                  />
                  <input
                    value={draftProject}
                    onChange={(event) => setDraftProject(event.target.value)}
                    placeholder="Project"
                    className={INPUT_CLASS}
                  />
                  <div className="flex items-center gap-2 px-1">
                    {LAB_PROJECT_COLORS.slice(0, 4).map((color) => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => setDraftColor(color)}
                        title="Choose project color"
                        className={cn(
                          'h-3.5 w-3.5 rounded-full border transition-transform hover:scale-110',
                          draftColor === color ? 'border-white/70 ring-2 ring-white/10' : 'border-white/10',
                        )}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                  <textarea
                    value={draftNotes}
                    onChange={(event) => setDraftNotes(event.target.value)}
                    placeholder="Notes"
                    rows={3}
                    className={cn(INPUT_CLASS, 'h-auto resize-none py-2 leading-5')}
                  />
                  <button
                    type="button"
                    onClick={addSong}
                    className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-full bg-white/90 px-4 text-xs font-medium text-black transition-transform hover:scale-[1.01] active:scale-95"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add Song
                  </button>
                </div>
              ) : null}
            </section>

            <section
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => dropInPool(event)}
              className="flex min-h-0 flex-1 flex-col rounded-2xl border border-white/[0.05] bg-[#0A0A0A]"
            >
              <SectionHeader title="Pool" count={poolSongs.length} />
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
                {poolSongs.map((song) => (
                  <SongBadgeCard
                    key={song.id}
                    song={song}
                    draggable
                    onDragStart={(event) => onDragStart(event, song.id, 'pool')}
                    onDrop={(event) => dropInPool(event, song.id)}
                    onDragOver={(event) => event.preventDefault()}
                    onNotesChange={(notes) => updateSong(song.id, { notes })}
                    onOpenPad={() => openSongPad(song.id)}
                  />
                ))}
              </div>
            </section>
          </aside>

          <section
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => dropInSequence(event)}
            className="flex min-h-0 flex-col rounded-2xl border border-white/[0.05] bg-[#0A0A0A]"
          >
            <div className="border-b border-white/[0.04] px-4 py-3">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
                  {sequencePages.map((page) => (
                    <button
                      key={page.id}
                      type="button"
                      onClick={() => setActiveSequenceId(page.id)}
                      className={cn(
                        'h-7 max-w-[180px] shrink-0 truncate rounded-full border px-3 text-xs font-medium transition-colors',
                        page.id === activeSequenceId
                          ? 'border-white/14 bg-white/[0.08] text-white/82'
                          : 'border-white/[0.055] bg-white/[0.02] text-white/42 hover:bg-white/[0.045] hover:text-white/70',
                      )}
                    >
                      {page.title || 'Untitled'}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={addSequencePage}
                  title="New sequence page"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/[0.06] text-white/44 hover:bg-white/[0.04] hover:text-white/76"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="flex items-center justify-between gap-3">
                <input
                  value={activeSequence?.title ?? ''}
                  onChange={(event) => updateSequenceTitle(event.target.value)}
                  className="min-w-0 flex-1 border-0 bg-transparent text-[10px] font-medium uppercase tracking-[0.18em] text-white/58 outline-none"
                  placeholder="Sequence title"
                />
                <span className="rounded-full bg-white/[0.04] px-2 py-0.5 text-[10px] text-white/36">{sequenceSongs.length}</span>
              </div>
            </div>
            {sequenceSongs.length === 0 ? (
              <div className="m-4 flex min-h-[320px] flex-1 items-center justify-center rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.01]">
                <div className="text-center">
                  <ArrowDownUp className="mx-auto mb-3 h-5 w-5 text-white/22" />
                  <p className="text-sm font-medium text-white/45">Drop songs here</p>
                  <p className="mt-1 text-xs text-white/28">Build the album, EP, or listening order.</p>
                </div>
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <div className="space-y-2">
                  {sequenceSongs.map((song, index) => (
                    <SongBadgeCard
                      key={song.id}
                      song={song}
                      index={index + 1}
                      draggable
                      wide
                      onDragStart={(event) => onDragStart(event, song.id, 'sequence')}
                      onDrop={(event) => dropInSequence(event, song.id)}
                      onDragOver={(event) => event.preventDefault()}
                      onNotesChange={(notes) => updateSong(song.id, { notes })}
                      onOpenPad={() => openSongPad(song.id)}
                      onRemove={() => updateActiveSequence((prev) => prev.filter((id) => id !== song.id))}
                    />
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

const INPUT_CLASS = 'h-9 w-full rounded-[10px] border border-white/[0.06] bg-white/[0.025] px-3 text-sm text-white/78 outline-none placeholder:text-white/24 focus:border-white/[0.12]'

function SectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <div className="flex items-center justify-between border-b border-white/[0.04] px-4 py-3">
      <h2 className="text-[10px] font-medium uppercase tracking-[0.18em] text-white/58">{title}</h2>
      <span className="rounded-full bg-white/[0.04] px-2 py-0.5 text-[10px] text-white/36">{count}</span>
    </div>
  )
}

function SongBadgeCard({
  song,
  index,
  wide,
  onNotesChange,
  onOpenPad,
  onRemove,
  ...dragProps
}: React.HTMLAttributes<HTMLDivElement> & {
  song: LabUiSong
  index?: number
  wide?: boolean
  onNotesChange: (notes: string) => void
  onOpenPad: () => void
  onRemove?: () => void
}) {
  const [notesOpen, setNotesOpen] = React.useState(false)

  return (
    <div
      {...dragProps}
      className={cn(
        'group rounded-xl border border-white/[0.055] bg-white/[0.018] px-3 py-1.5 transition-colors hover:border-white/[0.1] hover:bg-white/[0.035]',
        dragProps.className,
      )}
    >
      <div className="flex min-h-[30px] items-center gap-2">
        <div className="flex items-center gap-2">
          <GripVertical className="h-3.5 w-3.5 cursor-grab text-white/18 active:cursor-grabbing" />
          {index ? <span className="w-5 text-right text-[10px] font-medium text-white/28">{String(index).padStart(2, '0')}</span> : null}
        </div>
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: song.color }} />
        <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
          <p className="truncate text-xs font-medium text-white/82">{song.title}</p>
          <p className="truncate text-[11px] text-white/34">{song.project}</p>
        </div>
        <button
          type="button"
          onClick={onOpenPad}
          title="Open song pad"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/[0.05] text-white/32 hover:bg-white/[0.04] hover:text-[#fdba74]"
        >
          <PenLine className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={() => setNotesOpen((open) => !open)}
          title={notesOpen ? 'Hide notes' : 'Show notes'}
          className={cn(
            'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/[0.05] text-white/32 hover:bg-white/[0.04] hover:text-white/70',
            notesOpen && 'bg-white/[0.04] text-white/65',
          )}
        >
          <ChevronDown className={cn('h-3 w-3 transition-transform', notesOpen && 'rotate-180')} />
        </button>
        {onRemove ? (
          <button
            type="button"
            onClick={onRemove}
            title="Remove from sequence"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/[0.05] text-white/30 opacity-0 transition-opacity hover:bg-white/[0.04] hover:text-white/70 group-hover:opacity-100"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
      {notesOpen ? (
        <textarea
          value={song.notes}
          onChange={(event) => onNotesChange(event.target.value)}
          placeholder="Notes"
          rows={wide ? 2 : 1}
          className="mt-2 w-full resize-none rounded-[10px] border border-white/[0.04] bg-black/20 px-3 py-2 text-xs leading-5 text-white/54 outline-none placeholder:text-white/20 focus:border-white/[0.1]"
        />
      ) : null}
    </div>
  )
}
