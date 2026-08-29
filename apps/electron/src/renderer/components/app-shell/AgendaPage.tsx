import * as React from 'react'
import { CheckCircle2, ChevronDown, ChevronRight, Circle, Clock3, GripVertical, MessageCircle, Plus, Send, Trash2, Users, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  DndContext,
  DragOverlay,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
} from '@dnd-kit/core'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  ContextMenu,
  ContextMenuTrigger,
  StyledContextMenuContent,
  StyledContextMenuItem,
} from '@/components/ui/styled-context-menu'
import { cn } from '@/lib/utils'
import { getSessionTitle } from '@/utils/session'
import type { SessionMeta } from '@/atoms/sessions'
import type { AgendaTaskComment, AgendaTaskThread } from '@craft-agent/shared/agenda'
import type { TeamModeStatus } from '../../../shared/types'
import { useWorkspaceSyncRefresh } from '@/hooks/useWorkspaceSyncRefresh'
import { agendaTaskPreview, firstAgendaDetailLine, isAgendaSession } from './agenda-utils'
import { CompactPageHeader } from './CompactPageHeader'
import {
  ARTIST_NETWORK_CONTEXT_SLUG,
  parseArtistNetworkDocResult,
  type ArtistNetworkPerson,
} from '@/lib/artist-network'

export type AgendaColumnId = 'todo' | 'in-progress' | 'done'

export interface AgendaTaskDraft {
  title: string
  details: string
  status: AgendaColumnId
  personId: string | null
}

interface AgendaPageProps {
  sessions: SessionMeta[]
  onCreateTask: (task: AgendaTaskDraft) => Promise<string>
  onDeleteTask: (sessionId: string, skipConfirmation?: boolean) => Promise<boolean>
  workspaceId?: string
  networkWorkspaceId?: string
  embedded?: boolean
}

const AGENDA_COLUMNS: Array<{ id: AgendaColumnId; label: string }> = [
  { id: 'todo', label: 'To Do' },
  { id: 'in-progress', label: 'Doing' },
  { id: 'done', label: 'Done' },
]

const PERSON_LABEL_PREFIX = 'person::'
const NO_PERSON_VALUE = '__none__'

type SessionOverride = Partial<Pick<SessionMeta, 'name' | 'sessionStatus' | 'labels' | 'preview'>>

function DroppableLane({ id, children, className }: { id: string, children: React.ReactNode, className?: string }) {
  const { isOver, setNodeRef } = useDroppable({ id })
  return (
    <section ref={setNodeRef} className={cn(className, isOver && 'ring-2 ring-orange-500/50 bg-[#0A0A0A]')}>
      {children}
    </section>
  )
}

function DraggableCard({ session, detailsPreview, networkPeople, onClick, onDelete, compact = false }: { session: SessionMeta, detailsPreview?: string, networkPeople: ArtistNetworkPerson[], onClick: () => void, onDelete: () => void, compact?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: session.id,
    data: { session }
  })
  
  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 50 : undefined,
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={setNodeRef}
          style={style}
          className={cn(
            "group relative flex w-full flex-col rounded-[13px] border border-white/[0.07] bg-[#0F0F10] px-3 text-left transition-colors hover:bg-[#121314]",
            compact ? 'gap-1 py-2' : 'gap-2 py-2.5',
            isDragging && "shadow-2xl border-white/[0.15]"
          )}
        >
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={onClick}
              className="flex-1 text-left line-clamp-1 text-sm font-medium leading-5 text-white/80 hover:text-white"
            >
              {getSessionTitle(session)}
            </button>
            <button
              type="button"
              className="cursor-grab p-1 text-white/30 transition-colors hover:text-white/55"
              aria-label={`Drag ${getSessionTitle(session)}`}
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-3.5 w-3.5" />
            </button>
          </div>
          <button type="button" onClick={onClick} className="text-left w-full cursor-pointer">
            <p className="line-clamp-1 text-xs leading-5 text-white/38">
              {agendaTaskPreview(detailsPreview, session.preview, session.spawnedFromAgent?.agentName)}
            </p>
            <div className={cn('flex items-center justify-between gap-2', compact ? 'mt-1' : 'mt-2')}>
              <div />
              <PersonBadge labels={session.labels} people={networkPeople} />
            </div>
          </button>
        </div>
      </ContextMenuTrigger>
      <StyledContextMenuContent minWidth="min-w-0" className="p-1">
        <StyledContextMenuItem
          variant="destructive"
          onSelect={onDelete}
          className="gap-1.5 px-2 pr-2"
        >
          <X className="h-3.5 w-3.5" />
          Delete
        </StyledContextMenuItem>
      </StyledContextMenuContent>
    </ContextMenu>
  )
}

function CardOverlay({ session, detailsPreview, networkPeople }: { session: SessionMeta, detailsPreview?: string, networkPeople: ArtistNetworkPerson[] }) {
  return (
    <div className="w-full rotate-2 rounded-[13px] border border-white/[0.15] bg-[#0F0F10] px-3 py-2.5 shadow-2xl">
      <div className="flex items-center justify-between gap-3">
        <p className="line-clamp-1 text-sm font-medium leading-5 text-white/80">{getSessionTitle(session)}</p>
        <GripVertical className="h-3.5 w-3.5 shrink-0 text-white/30" />
      </div>
      <p className="mt-1 line-clamp-1 text-xs leading-5 text-white/38">
        {agendaTaskPreview(detailsPreview, session.preview, session.spawnedFromAgent?.agentName)}
      </p>
      <div className="mt-2 flex items-center justify-between gap-2">
        <div />
        <PersonBadge labels={session.labels} people={networkPeople} />
      </div>
    </div>
  )
}

export function AgendaPage({ sessions, onCreateTask, onDeleteTask, workspaceId, networkWorkspaceId, embedded = false }: AgendaPageProps) {
  const [networkPeople, setNetworkPeople] = React.useState<ArtistNetworkPerson[]>([])
  const [sessionOverrides, setSessionOverrides] = React.useState<Record<string, SessionOverride>>({})
  const [detailsPreviews, setDetailsPreviews] = React.useState<Record<string, string>>({})
  const [selectedSessionId, setSelectedSessionId] = React.useState<string | null>(null)
  const [creatingTask, setCreatingTask] = React.useState(false)
  const [draftTitle, setDraftTitle] = React.useState('')
  const [draftDetails, setDraftDetails] = React.useState('')
  const [draftStatus, setDraftStatus] = React.useState<AgendaColumnId>('todo')
  const [draftPersonId, setDraftPersonId] = React.useState(NO_PERSON_VALUE)
  const [saving, setSaving] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const [teamStatus, setTeamStatus] = React.useState<TeamModeStatus | null>(null)
  const [discussionOpen, setDiscussionOpen] = React.useState(false)
  const [taskThread, setTaskThread] = React.useState<AgendaTaskThread | null>(null)
  const [commentDraft, setCommentDraft] = React.useState('')
  const [commentSaving, setCommentSaving] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    if (!workspaceId) {
      setTeamStatus(null)
      return
    }
    void window.electronAPI.getWorkspaceTeamStatus(workspaceId).then((status) => {
      if (!cancelled) setTeamStatus(status)
    }).catch(() => {
      if (!cancelled) setTeamStatus(null)
    })
    return () => {
      cancelled = true
    }
  }, [workspaceId])

  const loadTaskThread = React.useCallback(async () => {
    if (!workspaceId || !selectedSessionId || !teamStatus?.team.enabled || !teamStatus.joined) {
      setTaskThread(null)
      return
    }
    setTaskThread(await window.electronAPI.getAgendaTaskThread(workspaceId, selectedSessionId))
  }, [selectedSessionId, teamStatus?.joined, teamStatus?.team.enabled, workspaceId])

  React.useEffect(() => {
    void loadTaskThread().catch(() => setTaskThread(null))
  }, [loadTaskThread])
  useWorkspaceSyncRefresh(workspaceId, ['records'], loadTaskThread)

  React.useEffect(() => {
    let cancelled = false
    if (!networkWorkspaceId) {
      setNetworkPeople([])
      return
    }
    void window.electronAPI.listWorkspaceContextDocs(networkWorkspaceId).then((docs) => {
      if (cancelled) return
      const result = parseArtistNetworkDocResult(docs.find((doc) => doc.slug === ARTIST_NETWORK_CONTEXT_SLUG))
      setNetworkPeople(result.network.people)
    }).catch(() => {
      if (!cancelled) setNetworkPeople([])
    })
    return () => {
      cancelled = true
    }
  }, [networkWorkspaceId])

  const visibleSessions = React.useMemo(
    () => sessions
      .filter((session) => !session.hidden && !session.isArchived && isAgendaSession(session))
      .map((session) => ({ ...session, ...(sessionOverrides[session.id] ?? {}) })),
    [sessionOverrides, sessions],
  )
  const byColumn = React.useMemo(() => {
    const map = new Map<string, SessionMeta[]>()
    for (const column of AGENDA_COLUMNS) map.set(column.id, [])
    for (const session of visibleSessions) {
      const key = normalizeAgendaStatus(session.sessionStatus)
      map.get(key)?.push(session)
    }
    for (const items of map.values()) {
      items.sort((a, b) => (b.lastMessageAt ?? b.createdAt ?? 0) - (a.lastMessageAt ?? a.createdAt ?? 0))
    }
    return map
  }, [visibleSessions])

  React.useEffect(() => {
    let cancelled = false
    void Promise.all(visibleSessions.map(async (session) => {
      const notes = await window.electronAPI.getSessionNotes(session.id).catch(() => '')
      return [session.id, firstAgendaDetailLine(notes)] as const
    })).then((entries) => {
      if (cancelled) return
      setDetailsPreviews(Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => Boolean(entry[1]))))
    })
    return () => {
      cancelled = true
    }
  }, [visibleSessions])

  const selectedSession = React.useMemo(
    () => visibleSessions.find((session) => session.id === selectedSessionId) ?? null,
    [selectedSessionId, visibleSessions],
  )

  const openEditor = React.useCallback((session: SessionMeta) => {
    setCreatingTask(false)
    setSelectedSessionId(session.id)
    setDraftTitle(getSessionTitle(session))
    setDraftDetails('')
    setDraftStatus(normalizeAgendaStatus(session.sessionStatus))
    setDraftPersonId(getPersonIdFromLabels(session.labels) ?? NO_PERSON_VALUE)
    setDiscussionOpen(false)
    setCommentDraft('')
    void window.electronAPI.getSessionNotes(session.id).then((notes) => {
      setDraftDetails(notes)
    }).catch(() => {
      setDraftDetails(session.preview ?? '')
    })
  }, [])

  const openCreateEditor = React.useCallback(() => {
    setSelectedSessionId(null)
    setCreatingTask(true)
    setDraftTitle('')
    setDraftDetails('')
    setDraftStatus('todo')
    setDraftPersonId(NO_PERSON_VALUE)
    setDiscussionOpen(false)
    setCommentDraft('')
  }, [])

  const deleteAgendaSession = React.useCallback(async (session: SessionMeta, skipConfirmation = false) => {
    if (deleting) return
    setDeleting(true)
    try {
      const deleted = await onDeleteTask(session.id, skipConfirmation)
      if (!deleted) return
      if (workspaceId && teamStatus?.team.enabled && teamStatus.joined) {
        await window.electronAPI.deleteAgendaTaskThread(workspaceId, session.id).catch((error) => {
          console.warn('Task deleted but its Team Mode discussion could not be removed:', error)
        })
      }
      if (selectedSessionId === session.id) {
        setSelectedSessionId(null)
        setTaskThread(null)
      }
    } finally {
      setDeleting(false)
    }
  }, [deleting, onDeleteTask, selectedSessionId, teamStatus?.joined, teamStatus?.team.enabled, workspaceId])

  const deleteTask = React.useCallback(async () => {
    if (!selectedSession) return
    await deleteAgendaSession(selectedSession)
  }, [deleteAgendaSession, selectedSession])

  const addComment = React.useCallback(async () => {
    const body = commentDraft.trim()
    if (!body || !workspaceId || !selectedSession || commentSaving) return
    setCommentSaving(true)
    try {
      const thread = await window.electronAPI.addAgendaTaskComment(workspaceId, selectedSession.id, {
        commentId: crypto.randomUUID(),
        body,
      })
      setTaskThread(thread)
      setCommentDraft('')
    } catch (error) {
      toast.error('Could not add comment', {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setCommentSaving(false)
    }
  }, [commentDraft, commentSaving, selectedSession, workspaceId])

  const saveEditor = React.useCallback(async () => {
    if (!creatingTask && !selectedSession) return
    const title = draftTitle.trim() || (selectedSession ? getSessionTitle(selectedSession) : 'New task')
    if (creatingTask) {
      setSaving(true)
      try {
        const sessionId = await onCreateTask({
          title,
          details: draftDetails,
          status: draftStatus,
          personId: draftPersonId === NO_PERSON_VALUE ? null : draftPersonId,
        })
        const preview = firstAgendaDetailLine(draftDetails)
        if (preview) setDetailsPreviews((current) => ({ ...current, [sessionId]: preview }))
        setCreatingTask(false)
      } finally {
        setSaving(false)
      }
      return
    }
    if (!selectedSession) return
    const labels = setPersonLabel(selectedSession.labels ?? [], draftPersonId === NO_PERSON_VALUE ? null : draftPersonId)
    setSaving(true)
    try {
      await Promise.all([
        title !== getSessionTitle(selectedSession)
          ? window.electronAPI.sessionCommand(selectedSession.id, { type: 'rename', name: title })
          : Promise.resolve(),
        draftStatus !== normalizeAgendaStatus(selectedSession.sessionStatus)
          ? window.electronAPI.sessionCommand(selectedSession.id, { type: 'setSessionStatus', state: draftStatus })
          : Promise.resolve(),
        window.electronAPI.sessionCommand(selectedSession.id, { type: 'setLabels', labels }),
        window.electronAPI.setSessionNotes(selectedSession.id, draftDetails),
      ])
      const preview = firstAgendaDetailLine(draftDetails)
      setDetailsPreviews((current) => {
        if (preview) return { ...current, [selectedSession.id]: preview }
        const next = { ...current }
        delete next[selectedSession.id]
        return next
      })
      setSessionOverrides((current) => ({
        ...current,
        [selectedSession.id]: {
          ...(current[selectedSession.id] ?? {}),
          name: title,
          sessionStatus: draftStatus,
          labels,
          preview: draftDetails.trim() ? draftDetails.trim().split('\n')[0] : selectedSession.preview,
        },
      }))
      setSelectedSessionId(null)
    } finally {
      setSaving(false)
    }
  }, [creatingTask, draftDetails, draftPersonId, draftStatus, draftTitle, onCreateTask, selectedSession])

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    })
  )

  const [activeDragId, setActiveDragId] = React.useState<string | null>(null)
  
  const activeDragSession = React.useMemo(
    () => activeDragId ? visibleSessions.find(s => s.id === activeDragId) : null,
    [activeDragId, visibleSessions]
  )

  const handleDragStart = React.useCallback((event: DragStartEvent) => {
    setActiveDragId(event.active.id as string)
  }, [])

  const handleDragEnd = React.useCallback((event: DragEndEvent) => {
    const { active, over } = event
    setActiveDragId(null)
    
    if (over && over.id !== normalizeAgendaStatus(visibleSessions.find(s => s.id === active.id)?.sessionStatus)) {
      const sessionId = active.id as string
      const newStatus = over.id as AgendaColumnId
      
      setSessionOverrides((current) => ({
        ...current,
        [sessionId]: {
          ...(current[sessionId] ?? {}),
          sessionStatus: newStatus,
        },
      }))
      
      window.electronAPI.sessionCommand(sessionId, { type: 'setSessionStatus', state: newStatus }).catch(console.error)
    }
  }, [visibleSessions])

  return (
    <div className={cn(embedded ? 'h-full min-h-0 text-foreground' : 'h-full overflow-y-auto bg-[#050505] text-foreground')}>
      <div className={cn(embedded ? 'h-full min-h-0 w-full' : 'mx-auto min-h-full w-full max-w-[1600px] px-5 py-4 xl:px-8 xl:py-5')}>
        {embedded ? null : (
        <CompactPageHeader
          eyebrow="Work Board"
          title="Agenda"
          tone="orange"
          className="mb-6"
          actions={
            <button
              type="button"
              onClick={openCreateEditor}
              className="inline-flex h-9 shrink-0 items-center gap-2 rounded-full bg-white/90 px-4 text-xs font-medium text-black hover:bg-white transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              New Task
            </button>
          }
        />
        )}

        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className={cn(
            'grid grid-cols-1',
            embedded
              ? 'h-full min-h-0 grid-rows-3 divide-y divide-white/[0.055]'
              : 'min-h-[520px] gap-3 lg:grid-cols-3',
          )}>
            {AGENDA_COLUMNS.map((column, index) => {
              const items = byColumn.get(column.id) ?? []
              return (
                <DroppableLane
                  key={column.id}
                  id={column.id}
                  className={cn(
                    'transition-colors',
                    embedded
                      ? 'flex min-h-0 flex-col px-3 py-2.5'
                      : 'rounded-[18px] border border-white/[0.055] bg-[#0C0D0E] p-3',
                  )}
                >
                  <div className={cn('flex items-center justify-between', embedded ? 'mb-1.5 pb-0.5' : 'mb-3 border-b border-white/[0.045] pb-2.5')}>
                    <div className="flex items-center gap-2">
                      <ColumnIcon index={index} />
                      <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/50">{column.label}</h2>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {embedded && column.id === 'todo' ? (
                        <button
                          type="button"
                          onClick={openCreateEditor}
                          aria-label="Add task to To Do"
                          title="Add task"
                          className="inline-flex h-5 w-5 items-center justify-center rounded-[5px] text-white/42 transition-colors hover:bg-white/[0.06] hover:text-[#f97316]"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                      <span className="text-[10px] tabular-nums text-white/28">{items.length}</span>
                    </div>
                  </div>

                  <div className={cn('space-y-1.5', embedded && 'min-h-0 flex-1 overflow-y-auto overscroll-contain pr-0.5')}>
                    {items.map((session) => (
                      <DraggableCard
                        key={session.id}
                        session={session}
                        detailsPreview={detailsPreviews[session.id]}
                        networkPeople={networkPeople}
                        onClick={() => openEditor(session)}
                        onDelete={() => void deleteAgendaSession(session, true)}
                        compact={embedded}
                      />
                    ))}
                  </div>
                </DroppableLane>
              )
            })}
          </div>
          <DragOverlay>
            {activeDragSession ? (
              <CardOverlay session={activeDragSession} detailsPreview={detailsPreviews[activeDragSession.id]} networkPeople={networkPeople} />
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>

      <Dialog open={creatingTask || Boolean(selectedSession)} onOpenChange={(open) => {
        if (open) return
        setCreatingTask(false)
        setSelectedSessionId(null)
      }}>
        <DialogContent className="max-w-[620px] border-white/[0.08] bg-[#080808] text-white shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-medium">{creatingTask ? 'New task' : 'Edit task'}</DialogTitle>
            <DialogDescription className="sr-only">
              Edit the task title, notes, board status, and assigned Network person.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <label className="block space-y-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/36">Title</span>
              <input
                value={draftTitle}
                onChange={(event) => setDraftTitle(event.target.value)}
                className="h-10 w-full rounded-[10px] border border-white/[0.08] bg-white/[0.025] px-3 text-sm text-white/80 outline-none focus:border-orange-400/45"
              />
            </label>
            <label className="block space-y-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/36">Info</span>
              <Textarea
                value={draftDetails}
                onChange={(event) => setDraftDetails(event.target.value)}
                placeholder="Add notes, context, links, or next steps..."
                className="min-h-28 rounded-[12px] border-white/[0.08] bg-white/[0.025] text-sm text-white/74 placeholder:text-white/22 focus-visible:border-orange-400/45"
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-2">
                <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/36">Status</span>
                <Select value={draftStatus} onValueChange={(value) => setDraftStatus(value as AgendaColumnId)}>
                  <SelectTrigger className="rounded-[10px] border-white/[0.08] bg-white/[0.025] text-white/74">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="z-overlay">
                    {AGENDA_COLUMNS.map((column) => (
                      <SelectItem key={column.id} value={column.id}>{column.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="block space-y-2">
                <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/36">Person</span>
                <Select value={draftPersonId} onValueChange={setDraftPersonId}>
                  <SelectTrigger className="rounded-[10px] border-white/[0.08] bg-white/[0.025] text-white/74">
                    <SelectValue placeholder="Tag from Network" />
                  </SelectTrigger>
                  <SelectContent className="z-overlay">
                    <SelectItem value={NO_PERSON_VALUE}>No person</SelectItem>
                    {networkPeople.map((person) => (
                      <SelectItem key={person.id} value={person.id}>{person.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            </div>
            {!creatingTask && teamStatus?.team.enabled ? (
              <div className="overflow-hidden rounded-[12px] border border-white/[0.07] bg-white/[0.018]">
                <button
                  type="button"
                  onClick={() => setDiscussionOpen((open) => !open)}
                  className="flex h-10 w-full items-center justify-between px-3 text-left text-sm text-white/68 hover:bg-white/[0.025]"
                >
                  <span className="flex items-center gap-2">
                    <MessageCircle className="h-3.5 w-3.5 text-white/38" />
                    Discussion
                    <span className="text-[10px] tabular-nums text-white/28">{taskThread?.comments.length ?? 0}</span>
                  </span>
                  {discussionOpen ? <ChevronDown className="h-3.5 w-3.5 text-white/32" /> : <ChevronRight className="h-3.5 w-3.5 text-white/32" />}
                </button>
                {discussionOpen ? (
                  <div className="border-t border-white/[0.06] p-3">
                    {!teamStatus.joined ? (
                      <p className="text-xs leading-5 text-white/38">Join this Team workspace in Settings to read or leave comments.</p>
                    ) : (
                      <>
                        <div className="max-h-44 space-y-2 overflow-y-auto pr-1">
                          {taskThread?.comments.length ? taskThread.comments.map((comment) => (
                            <TaskComment key={comment.id} comment={comment} />
                          )) : (
                            <p className="py-2 text-center text-xs text-white/28">No comments yet.</p>
                          )}
                        </div>
                        {teamStatus.canEditSharedWork ? (
                          <div className="mt-3 flex items-end gap-2">
                            <Textarea
                              value={commentDraft}
                              onChange={(event) => setCommentDraft(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' && !event.shiftKey) {
                                  event.preventDefault()
                                  void addComment()
                                }
                              }}
                              placeholder="Leave a comment..."
                              className="min-h-9 resize-none rounded-[9px] border-white/[0.08] bg-black/30 text-sm text-white/74 placeholder:text-white/24"
                            />
                            <button
                              type="button"
                              onClick={() => void addComment()}
                              disabled={!commentDraft.trim() || commentSaving}
                              aria-label="Send comment"
                              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-white text-black disabled:opacity-35"
                            >
                              <Send className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ) : null}
                      </>
                    )}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
          <DialogFooter className="sm:justify-between">
            {!creatingTask ? (
              <button
                type="button"
                onClick={() => void deleteTask()}
                disabled={deleting || saving}
                className="inline-flex h-10 items-center gap-2 rounded-full px-3 text-sm font-medium text-red-300/72 hover:bg-red-500/[0.08] hover:text-red-200 disabled:opacity-40"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {deleting ? 'Deleting...' : 'Delete task'}
              </button>
            ) : null}
            <button
              type="button"
              onClick={saveEditor}
              disabled={saving}
              className="h-10 rounded-full bg-white px-5 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? 'Saving...' : creatingTask ? 'Add Task' : 'Save'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function TaskComment({ comment }: { comment: AgendaTaskComment }) {
  const timestamp = new Date(comment.createdAt)
  const timeLabel = Number.isNaN(timestamp.getTime())
    ? ''
    : timestamp.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  return (
    <div className="rounded-[9px] bg-black/30 px-3 py-2">
      <div className="flex items-center justify-between gap-3 text-[10px]">
        <span className="truncate font-medium text-white/58">{comment.authorName}</span>
        <span className="shrink-0 text-white/24">{timeLabel}</span>
      </div>
      <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-white/66">{comment.body}</p>
    </div>
  )
}

function ColumnIcon({ index }: { index: number }) {
  const Icon = index === 0 ? Circle : index === 1 ? Clock3 : CheckCircle2
  return <Icon className="h-3.5 w-3.5 text-[#f97316]" />
}

function normalizeAgendaStatus(status: string | undefined): AgendaColumnId {
  if (status === 'done' || status === 'complete' || status === 'completed') return 'done'
  if (status === 'in-progress' || status === 'doing' || status === 'active') return 'in-progress'
  return 'todo'
}

function getPersonIdFromLabels(labels: string[] | undefined): string | null {
  return labels?.find((label) => label.startsWith(PERSON_LABEL_PREFIX))?.slice(PERSON_LABEL_PREFIX.length) ?? null
}

function setPersonLabel(labels: string[], personId: string | null): string[] {
  const next = labels.filter((label) => !label.startsWith(PERSON_LABEL_PREFIX))
  if (personId) next.push(`${PERSON_LABEL_PREFIX}${personId}`)
  return next
}

function PersonBadge({ labels, people }: { labels: string[] | undefined; people: ArtistNetworkPerson[] }) {
  const personId = getPersonIdFromLabels(labels)
  if (!personId) return null
  const person = people.find((item) => item.id === personId)
  return (
    <span className="inline-flex max-w-[160px] items-center gap-1 rounded-full border border-white/[0.06] bg-white/[0.035] px-2 py-1 text-[10px] font-medium text-white/46">
      <Users className="h-3 w-3 shrink-0" />
      <span className="truncate">{person?.name ?? 'Network'}</span>
    </span>
  )
}
