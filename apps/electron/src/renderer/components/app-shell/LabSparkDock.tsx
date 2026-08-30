import * as React from 'react'
import {
  Check,
  Copy,
  Gem,
  Pencil,
  Pin,
  Search,
  Tag,
  Trash2,
} from 'lucide-react'
import type { LabSparkKind } from '@craft-agent/shared/lab'
import { cn } from '@/lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  createLabUiSpark,
  deleteLabUiSpark,
  getSelectedLabSongId,
  hydrateLabState,
  loadLabUiSongs,
  loadLabUiSparks,
  subscribeLabSongs,
  updateLabUiSpark,
  type LabUiSpark,
} from '@/lib/lab-song-state'
import {
  filterLabSparks,
  LAB_SPARK_BANK_OPEN_EVENT,
  parseSparkTags,
  type LabSparkKindFilter,
} from '@/lib/lab-sparks'

interface LabSparkDockProps {
  workspaceId: string
  attachToCurrentSong?: boolean
}

const SPARK_KINDS: Array<{ id: LabSparkKind; label: string }> = [
  { id: 'line', label: 'Line' },
  { id: 'concept', label: 'Concept' },
  { id: 'title', label: 'Title' },
  { id: 'image', label: 'Image' },
  { id: 'wildcard', label: 'Wildcard' },
]

export const LabSparkDock: React.FC<LabSparkDockProps> = ({ workspaceId, attachToCurrentSong = false }) => {
  const [captureOpen, setCaptureOpen] = React.useState(false)
  const [bankOpen, setBankOpen] = React.useState(false)
  const [sparks, setSparks] = React.useState<LabUiSpark[]>([])
  const [draft, setDraft] = React.useState('')
  const [draftKind, setDraftKind] = React.useState<LabSparkKind>('line')
  const [draftTags, setDraftTags] = React.useState('')
  const [saved, setSaved] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [kindFilter, setKindFilter] = React.useState<LabSparkKindFilter>('all')
  const [tagFilter, setTagFilter] = React.useState<string | 'all'>('all')
  const [copiedId, setCopiedId] = React.useState<string | null>(null)
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [editingText, setEditingText] = React.useState('')

  const refresh = React.useCallback(() => setSparks(loadLabUiSparks(workspaceId)), [workspaceId])

  React.useEffect(() => {
    void hydrateLabState(workspaceId).then(refresh)
    return subscribeLabSongs(refresh)
  }, [refresh, workspaceId])

  React.useEffect(() => {
    const open = () => {
      setCaptureOpen(false)
      setBankOpen(true)
    }
    window.addEventListener(LAB_SPARK_BANK_OPEN_EVENT, open)
    return () => window.removeEventListener(LAB_SPARK_BANK_OPEN_EVENT, open)
  }, [])

  const activeSongId = attachToCurrentSong ? getSelectedLabSongId(workspaceId) ?? undefined : undefined
  const songsById = React.useMemo(
    () => new Map(loadLabUiSongs(workspaceId).map((song) => [song.id, song.title])),
    [sparks, workspaceId],
  )
  const activeSongTitle = activeSongId ? songsById.get(activeSongId) : undefined
  const allTags = React.useMemo(
    () => Array.from(new Set(sparks.flatMap((spark) => spark.tags))).sort(),
    [sparks],
  )
  const visibleSparks = React.useMemo(
    () => filterLabSparks(sparks, { query, kind: kindFilter, tag: tagFilter }),
    [kindFilter, query, sparks, tagFilter],
  )

  const saveSpark = React.useCallback(() => {
    const text = draft.trim()
    if (!text) return
    createLabUiSpark(workspaceId, {
      text,
      kind: draftKind,
      tags: parseSparkTags(draftTags),
      songId: activeSongId,
    })
    setDraft('')
    setDraftTags('')
    setSaved(true)
    window.setTimeout(() => setSaved(false), 900)
  }, [activeSongId, draft, draftKind, draftTags, workspaceId])

  const openBank = React.useCallback(() => {
    setCaptureOpen(false)
    setBankOpen(true)
  }, [])

  const copySpark = React.useCallback(async (spark: LabUiSpark) => {
    try {
      await navigator.clipboard.writeText(spark.text)
      setCopiedId(spark.id)
      window.setTimeout(() => setCopiedId(null), 900)
    } catch {
      setCopiedId(null)
    }
  }, [])

  const startEditing = React.useCallback((spark: LabUiSpark) => {
    setEditingId(spark.id)
    setEditingText(spark.text)
  }, [])

  const saveEditing = React.useCallback((spark: LabUiSpark) => {
    const text = editingText.trim()
    if (!text) return
    updateLabUiSpark(workspaceId, spark.id, { text })
    setEditingId(null)
    setEditingText('')
  }, [editingText, workspaceId])

  return (
    <>
      <Popover open={captureOpen} onOpenChange={setCaptureOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Capture a spark"
            title="Capture a spark"
            className="fixed bottom-4 right-4 z-[75] flex h-10 w-10 items-center justify-center rounded-full border border-[#fb923c]/24 bg-[#12100d]/94 text-[#fdba74]/78 shadow-strong backdrop-blur-xl transition-all hover:scale-[1.04] hover:border-[#fb923c]/42 hover:bg-[#1a140e] hover:text-[#fed7aa] active:scale-95"
          >
            <Gem className="h-4 w-4" />
            {sparks.some((spark) => spark.pinned) ? (
              <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-[#fb923c]" />
            ) : null}
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="end"
          sideOffset={10}
          className="w-[370px] border border-white/[0.09] bg-[#0b0b0b] p-3.5 text-white shadow-modal-small"
        >
          <div className="mb-2.5 flex items-center justify-between gap-3">
            <div>
              <div className="text-[9px] font-semibold uppercase tracking-[0.17em] text-[#fdba74]/72">Catch the spark</div>
              <div className="mt-1 text-[11px] text-white/34">Save it before the room changes.</div>
            </div>
            <button type="button" onClick={openBank} className="text-[10px] font-medium text-white/42 hover:text-white/75">
              Open Spark Bank · {sparks.length}
            </button>
          </div>

          <textarea
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') saveSpark()
            }}
            rows={4}
            placeholder="A line, title, image, premise, strange little thing…"
            className="w-full resize-none rounded-xl border border-white/[0.07] bg-white/[0.025] px-3 py-2.5 text-sm leading-6 text-white/82 outline-none placeholder:text-white/23 focus:border-[#fb923c]/32"
          />

          <div className="mt-2.5 flex flex-wrap gap-1">
            {SPARK_KINDS.map((kind) => (
              <button
                key={kind.id}
                type="button"
                onClick={() => setDraftKind(kind.id)}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-[9px] font-medium transition-colors',
                  draftKind === kind.id
                    ? 'border-[#fb923c]/28 bg-[#fb923c]/11 text-[#fdba74]'
                    : 'border-white/[0.055] bg-white/[0.018] text-white/35 hover:text-white/62',
                )}
              >
                {kind.label}
              </button>
            ))}
          </div>

          <label className="mt-2.5 flex h-8 items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.018] px-2.5">
            <Tag className="h-3 w-3 text-white/25" />
            <span className="sr-only">Spark tags</span>
            <input
              value={draftTags}
              onChange={(event) => setDraftTags(event.target.value)}
              placeholder="Tags: hook, midnight, heartbreak"
              className="min-w-0 flex-1 bg-transparent text-[11px] text-white/62 outline-none placeholder:text-white/23"
            />
          </label>

          <div className="mt-2.5 flex items-center justify-between gap-3">
            <div className="min-w-0 truncate text-[9px] text-white/27">
              {activeSongTitle ? `Attached to ${activeSongTitle}` : 'Saved across the whole Lab'}
            </div>
            <button
              type="button"
              disabled={!draft.trim()}
              onClick={saveSpark}
              className="inline-flex h-8 items-center gap-1.5 rounded-full bg-white/90 px-3.5 text-[10px] font-medium text-black disabled:cursor-not-allowed disabled:opacity-35"
            >
              {saved ? <Check className="h-3 w-3" /> : <Gem className="h-3 w-3" />}
              {saved ? 'Saved' : 'Bank it'}
            </button>
          </div>
        </PopoverContent>
      </Popover>

      <Dialog open={bankOpen} onOpenChange={setBankOpen}>
        <DialogContent className="flex h-[76vh] flex-col overflow-hidden border border-white/[0.08] bg-[#080808] p-0 text-white sm:max-w-[920px]">
          <DialogHeader className="border-b border-white/[0.055] px-5 py-4 pr-12">
            <DialogTitle className="flex items-center gap-2 text-base font-medium">
              <Gem className="h-4 w-4 text-[#fdba74]" />
              Spark Bank
            </DialogTitle>
            <DialogDescription className="text-xs text-white/34">
              Fragments worth keeping. Search the words, filter the shape, follow the tags.
            </DialogDescription>
          </DialogHeader>

          <div className="flex min-h-0 flex-1 flex-col px-5 pb-5">
            <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.045] py-3">
              <label className="flex h-9 min-w-[240px] flex-1 items-center gap-2 rounded-full border border-white/[0.065] bg-white/[0.022] px-3">
                <Search className="h-3.5 w-3.5 text-white/25" />
                <span className="sr-only">Search sparks</span>
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search sparks or tags"
                  className="min-w-0 flex-1 bg-transparent text-xs text-white/68 outline-none placeholder:text-white/24"
                />
              </label>
              <select
                aria-label="Filter spark type"
                value={kindFilter}
                onChange={(event) => setKindFilter(event.target.value as LabSparkKindFilter)}
                className="h-9 rounded-full border border-white/[0.065] bg-[#0d0d0d] px-3 text-xs text-white/55 outline-none"
              >
                <option value="all">All types</option>
                {SPARK_KINDS.map((kind) => <option key={kind.id} value={kind.id}>{kind.label}</option>)}
              </select>
            </div>

            {allTags.length ? (
              <div className="flex shrink-0 gap-1.5 overflow-x-auto py-2.5">
                <button
                  type="button"
                  onClick={() => setTagFilter('all')}
                  className={cn('rounded-full border px-2.5 py-1 text-[9px]', tagFilter === 'all' ? 'border-white/[0.15] text-white/68' : 'border-white/[0.05] text-white/28')}
                >
                  All tags
                </button>
                {allTags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => setTagFilter(tag)}
                    className={cn('rounded-full border px-2.5 py-1 text-[9px]', tagFilter === tag ? 'border-[#fb923c]/28 bg-[#fb923c]/8 text-[#fdba74]' : 'border-white/[0.05] text-white/30 hover:text-white/58')}
                  >
                    #{tag}
                  </button>
                ))}
              </div>
            ) : null}

            <div className="min-h-0 flex-1 overflow-y-auto pt-1">
              {visibleSparks.length ? (
                <div className="grid gap-2.5 pb-3 md:grid-cols-2">
                  {visibleSparks.map((spark) => (
                    <article key={spark.id} className="group rounded-xl border border-white/[0.055] bg-white/[0.018] p-3.5 hover:border-white/[0.09] hover:bg-white/[0.026]">
                      <div className="flex items-start justify-between gap-3">
                        {editingId === spark.id ? (
                          <div className="min-w-0 flex-1">
                            <textarea
                              autoFocus
                              value={editingText}
                              onChange={(event) => setEditingText(event.target.value)}
                              onKeyDown={(event) => {
                                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') saveEditing(spark)
                                if (event.key === 'Escape') setEditingId(null)
                              }}
                              rows={4}
                              className="w-full resize-none rounded-lg border border-[#fb923c]/20 bg-black/25 px-2.5 py-2 text-sm leading-6 text-white/80 outline-none focus:border-[#fb923c]/40"
                            />
                            <div className="mt-2 flex justify-end gap-2">
                              <button type="button" onClick={() => setEditingId(null)} className="text-[10px] text-white/38 hover:text-white/68">Cancel</button>
                              <button type="button" disabled={!editingText.trim()} onClick={() => saveEditing(spark)} className="rounded-full bg-white/90 px-3 py-1 text-[10px] font-medium text-black disabled:opacity-35">Save</button>
                            </div>
                          </div>
                        ) : (
                          <div className="min-w-0 flex-1 whitespace-pre-wrap text-sm leading-6 text-white/76">{spark.text}</div>
                        )}
                        <button
                          type="button"
                          aria-label={spark.pinned ? 'Unpin spark' : 'Pin spark'}
                          onClick={() => updateLabUiSpark(workspaceId, spark.id, { pinned: !spark.pinned })}
                          className={cn('shrink-0 rounded-full p-1.5 transition-colors', spark.pinned ? 'bg-[#fb923c]/10 text-[#fdba74]' : 'text-white/18 hover:bg-white/[0.05] hover:text-white/55')}
                        >
                          <Pin className={cn('h-3 w-3', spark.pinned && 'fill-current')} />
                        </button>
                      </div>
                      <div className="mt-3 flex items-end justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap gap-1">
                            <span className="rounded-full border border-white/[0.055] px-2 py-0.5 text-[8px] font-medium uppercase tracking-[0.12em] text-white/32">{spark.kind}</span>
                            {spark.tags.map((tag) => <span key={tag} className="text-[9px] text-white/28">#{tag}</span>)}
                          </div>
                          {spark.songId && songsById.get(spark.songId) ? (
                            <div className="mt-1.5 truncate text-[9px] text-[#fdba74]/45">From {songsById.get(spark.songId)}</div>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 items-center gap-1 opacity-45 transition-opacity group-hover:opacity-100">
                          <button type="button" title="Edit spark" onClick={() => startEditing(spark)} className="rounded-full p-1.5 text-white/35 hover:bg-white/[0.06] hover:text-white/72">
                            <Pencil className="h-3 w-3" />
                          </button>
                          <button type="button" title="Copy spark" onClick={() => void copySpark(spark)} className="rounded-full p-1.5 text-white/35 hover:bg-white/[0.06] hover:text-white/72">
                            {copiedId === spark.id ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                          </button>
                          <button type="button" title="Delete spark" onClick={() => deleteLabUiSpark(workspaceId, spark.id)} className="rounded-full p-1.5 text-white/25 hover:bg-red-500/10 hover:text-red-200/65">
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="flex h-full min-h-[260px] flex-col items-center justify-center text-center">
                  <Gem className="h-5 w-5 text-white/16" />
                  <div className="mt-3 text-sm text-white/45">No sparks in this view.</div>
                  <div className="mt-1 text-xs text-white/24">Capture one or loosen the filters.</div>
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

export default LabSparkDock
