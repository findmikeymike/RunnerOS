import type { LabProjectsState, LabSong, LabSongSection, LabSpark, LabState } from '@craft-agent/shared/lab'

export type LabUiSongSection = LabSongSection
export type LabUiSong = LabSong
export type LabUiSequencePage = LabProjectsState['sequencePages'][number]
export type LabUiProjectsState = LabProjectsState
export type LabUiSpark = LabSpark

const SONGS_KEY_PREFIX = 'lab:songs:v1'
const PROJECTS_KEY_PREFIX = 'lab:projects:v1'
const SELECTED_SONG_KEY_PREFIX = 'lab:selected-song-id:v1'
const PENDING_STATE_KEY_PREFIX = 'lab:pending-state:v2'
const EVENT_NAME = 'lab-songs-updated'
const DEFAULT_SEQUENCE_ID = 'sequence-1'

export const LAB_PROJECT_COLORS = ['#fb923c', '#a78bfa', '#34d399', '#60a5fa', '#f472b6']
export const LAB_DEFAULT_SECTIONS: LabSongSection[] = [
  { id: 'verse-1', label: 'V1', text: '' },
  { id: 'pre-chorus', label: 'Pre1', text: '', optional: true },
  { id: 'chorus', label: 'Chorus', text: '' },
  { id: 'verse-2', label: 'V2', text: '', optional: true },
  { id: 'final-chorus', label: 'Chorus 2', text: '', optional: true },
  { id: 'bridge', label: 'Bridge', text: '', optional: true },
]

const stateByWorkspace = new Map<string, LabState>()
const hydrationByWorkspace = new Map<string, Promise<LabState>>()
const saveTailByWorkspace = new Map<string, Promise<unknown>>()
const saveRevisionByWorkspace = new Map<string, number>()
let remoteChangeCleanup: (() => void) | null = null

function workspaceKey(workspaceId?: string): string {
  return workspaceId || '__no_workspace__'
}

function emptyState(): LabState {
  return {
    songs: [],
    sparks: [],
    projects: {
      poolOrder: [],
      sequencePages: [{ id: DEFAULT_SEQUENCE_ID, title: 'Master Sequence', songIds: [] }],
      activeSequenceId: DEFAULT_SEQUENCE_ID,
    },
  }
}

function normalizeSections(sections: LabSongSection[]): LabSongSection[] {
  const kept = sections.filter((section) => section.id !== 'intro' || section.text.trim())
  const byId = new Map(kept.map((section) => [section.id, section]))
  const orderedDefaults = LAB_DEFAULT_SECTIONS.map((section) => byId.get(section.id) ?? section)
  const defaultIds = new Set(LAB_DEFAULT_SECTIONS.map((section) => section.id))
  return [...orderedDefaults, ...kept.filter((section) => !defaultIds.has(section.id))]
}

function normalizeSong(song: LabSong): LabSong {
  return {
    ...song,
    title: !song.title?.trim() || song.title.trim().toLowerCase() === 'untitled song'
      ? 'Untitled'
      : song.title.trim(),
    project: song.project?.trim() || 'Loose Singles',
    color: song.color || LAB_PROJECT_COLORS[0],
    notes: song.notes || '',
    sections: normalizeSections(song.sections ?? []),
    lineAlternatives: Array.isArray(song.lineAlternatives) ? song.lineAlternatives : [],
    captures: Array.isArray(song.captures) ? song.captures : [],
  }
}

function normalizeState(state: LabState): LabState {
  const songs = Array.isArray(state.songs) ? state.songs.map(normalizeSong) : []
  const songIds = new Set(songs.map((song) => song.id))
  const fallback = emptyState().projects
  const sequencePages = Array.isArray(state.projects?.sequencePages) && state.projects.sequencePages.length
    ? state.projects.sequencePages.map((page) => ({
        ...page,
        songIds: Array.from(new Set(page.songIds.filter((songId) => songIds.has(songId)))),
      }))
    : fallback.sequencePages
  const savedPoolOrder = Array.isArray(state.projects?.poolOrder)
    ? Array.from(new Set(state.projects.poolOrder.filter((songId) => songIds.has(songId))))
    : []
  const poolIds = new Set(savedPoolOrder)
  return {
    songs,
    sparks: Array.isArray(state.sparks)
      ? state.sparks.map((spark) => spark.songId && !songIds.has(spark.songId) ? { ...spark, songId: undefined } : spark)
      : [],
    projects: {
      poolOrder: [...savedPoolOrder, ...songs.map((song) => song.id).filter((songId) => !poolIds.has(songId))],
      sequencePages,
      activeSequenceId: sequencePages.some((page) => page.id === state.projects?.activeSequenceId)
        ? state.projects.activeSequenceId
        : sequencePages[0]!.id,
      selectedSongId: state.projects?.selectedSongId && songIds.has(state.projects.selectedSongId)
        ? state.projects.selectedSongId
        : undefined,
    },
  }
}

export function removeLabSongFromState(state: LabState, songId: string): LabState {
  return normalizeState({
    ...state,
    songs: state.songs.filter((song) => song.id !== songId),
    sparks: state.sparks.map((spark) => spark.songId === songId ? { ...spark, songId: undefined } : spark),
    projects: {
      ...state.projects,
      poolOrder: state.projects.poolOrder.filter((id) => id !== songId),
      sequencePages: state.projects.sequencePages.map((page) => ({
        ...page,
        songIds: page.songIds.filter((id) => id !== songId),
      })),
      selectedSongId: state.projects.selectedSongId === songId ? undefined : state.projects.selectedSongId,
    },
  })
}

export function removeLabSequencePage(
  projects: LabProjectsState,
  sequenceId: string,
): LabProjectsState {
  if (projects.sequencePages.length <= 1) return projects
  const index = projects.sequencePages.findIndex((page) => page.id === sequenceId)
  if (index < 0) return projects
  const sequencePages = projects.sequencePages.filter((page) => page.id !== sequenceId)
  const fallback = sequencePages[Math.min(index, sequencePages.length - 1)] ?? sequencePages[0]!
  return {
    ...projects,
    sequencePages,
    activeSequenceId: projects.activeSequenceId === sequenceId ? fallback.id : projects.activeSequenceId,
  }
}

function emitUpdate() {
  window.dispatchEvent(new CustomEvent(EVENT_NAME))
}

function localStorageKey(prefix: string, workspaceId: string): string {
  return `${prefix}:${workspaceId}`
}

function readLegacyState(workspaceId: string): LabState | null {
  try {
    const songsRaw = window.localStorage.getItem(localStorageKey(SONGS_KEY_PREFIX, workspaceId))
    if (!songsRaw) return null
    const parsedSongs = JSON.parse(songsRaw)
    if (!Array.isArray(parsedSongs)) return null
    // The former preview wrote four fake records automatically. Carry forward
    // only records that a user actually edited or created.
    const songs = parsedSongs
      .filter((song) => song && typeof song.id === 'string' && typeof song.title === 'string')
      .filter((song) => song.updatedAt !== new Date(0).toISOString())
      .map((song) => normalizeSong({
        ...song,
        project: typeof song.project === 'string' ? song.project : 'Loose Singles',
        color: typeof song.color === 'string' ? song.color : LAB_PROJECT_COLORS[0],
        notes: typeof song.notes === 'string' ? song.notes : '',
        status: song.status === 'done' ? 'done' : 'working',
        focused: song.focused === true,
        captures: Array.isArray(song.captures) ? song.captures : [],
        createdAt: typeof song.createdAt === 'string' ? song.createdAt : song.updatedAt,
      } as LabSong))
    if (!songs.length) return null

    const projectsRaw = window.localStorage.getItem(localStorageKey(PROJECTS_KEY_PREFIX, workspaceId))
    const projects = projectsRaw ? JSON.parse(projectsRaw) as Partial<LabProjectsState> : {}
    const selectedSongId = window.localStorage.getItem(localStorageKey(SELECTED_SONG_KEY_PREFIX, workspaceId)) ?? undefined
    return normalizeState({
      songs,
      sparks: [],
      projects: {
        poolOrder: Array.isArray(projects.poolOrder) ? projects.poolOrder : songs.map((song) => song.id),
        sequencePages: Array.isArray(projects.sequencePages) && projects.sequencePages.length
          ? projects.sequencePages
          : emptyState().projects.sequencePages,
        activeSequenceId: projects.activeSequenceId || DEFAULT_SEQUENCE_ID,
        selectedSongId,
      },
    })
  } catch {
    return null
  }
}

function clearLegacyState(workspaceId: string) {
  window.localStorage.removeItem(localStorageKey(SONGS_KEY_PREFIX, workspaceId))
  window.localStorage.removeItem(localStorageKey(PROJECTS_KEY_PREFIX, workspaceId))
  window.localStorage.removeItem(localStorageKey(SELECTED_SONG_KEY_PREFIX, workspaceId))
}

export async function hydrateLabState(workspaceId?: string): Promise<LabState> {
  if (!workspaceId) return emptyState()
  const existing = hydrationByWorkspace.get(workspaceId)
  if (existing) return existing
  const hydration = (async () => {
    let state = normalizeState(await window.electronAPI.getLabState(workspaceId))
    const pendingRaw = window.localStorage.getItem(localStorageKey(PENDING_STATE_KEY_PREFIX, workspaceId))
    if (pendingRaw) {
      try {
        state = normalizeState(JSON.parse(pendingRaw) as LabState)
        state = normalizeState(await window.electronAPI.saveLabState(workspaceId, state))
        window.localStorage.removeItem(localStorageKey(PENDING_STATE_KEY_PREFIX, workspaceId))
      } catch {
        // Keep the recovery draft intact and fall back to canonical state.
      }
    }
    if (state.songs.length === 0) {
      const legacy = readLegacyState(workspaceId)
      if (legacy) state = normalizeState(await window.electronAPI.saveLabState(workspaceId, legacy))
    }
    clearLegacyState(workspaceId)
    stateByWorkspace.set(workspaceId, state)
    emitUpdate()
    return state
  })().finally(() => hydrationByWorkspace.delete(workspaceId))
  hydrationByWorkspace.set(workspaceId, hydration)
  return hydration
}

export function subscribeLabSongs(callback: () => void): () => void {
  if (!remoteChangeCleanup) {
    remoteChangeCleanup = window.electronAPI.onLabStateChanged((workspaceId) => {
      void window.electronAPI.getLabState(workspaceId).then((state) => {
        stateByWorkspace.set(workspaceId, normalizeState(state))
        emitUpdate()
      }).catch(() => undefined)
    })
  }
  const handler = () => callback()
  window.addEventListener(EVENT_NAME, handler)
  return () => window.removeEventListener(EVENT_NAME, handler)
}

export function loadLabUiSongs(workspaceId?: string): LabSong[] {
  return stateByWorkspace.get(workspaceKey(workspaceId))?.songs ?? []
}

export function loadLabUiSparks(workspaceId?: string): LabSpark[] {
  return stateByWorkspace.get(workspaceKey(workspaceId))?.sparks ?? []
}

function persistState(workspaceId: string | undefined, state: LabState): Promise<LabState> {
  if (!workspaceId) return Promise.resolve(state)
  const normalized = normalizeState(state)
  stateByWorkspace.set(workspaceId, normalized)
  const revision = (saveRevisionByWorkspace.get(workspaceId) ?? 0) + 1
  saveRevisionByWorkspace.set(workspaceId, revision)
  window.localStorage.setItem(localStorageKey(PENDING_STATE_KEY_PREFIX, workspaceId), JSON.stringify(normalized))
  emitUpdate()
  const tail = saveTailByWorkspace.get(workspaceId) ?? Promise.resolve()
  const save = tail
    .catch(() => undefined)
    .then(() => window.electronAPI.saveLabState(workspaceId, normalized))
    .then((saved) => {
      const next = normalizeState(saved)
      stateByWorkspace.set(workspaceId, next)
      if (saveRevisionByWorkspace.get(workspaceId) === revision) {
        window.localStorage.removeItem(localStorageKey(PENDING_STATE_KEY_PREFIX, workspaceId))
      }
      return next
    })
  saveTailByWorkspace.set(workspaceId, save)
  return save
}

export function saveLabUiSongs(workspaceId: string | undefined, songs: LabSong[]) {
  const current = stateByWorkspace.get(workspaceKey(workspaceId)) ?? emptyState()
  return persistState(workspaceId, { ...current, songs })
}

export function saveLabUiSparks(workspaceId: string | undefined, sparks: LabSpark[]) {
  const current = stateByWorkspace.get(workspaceKey(workspaceId)) ?? emptyState()
  return persistState(workspaceId, { ...current, sparks })
}

export function createLabUiSpark(
  workspaceId: string | undefined,
  input: Pick<LabSpark, 'text' | 'kind' | 'tags'> & Pick<Partial<LabSpark>, 'songId' | 'pinned'>,
): LabSpark {
  const now = new Date().toISOString()
  const spark: LabSpark = {
    id: `spark-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`,
    text: input.text.trim(),
    kind: input.kind,
    tags: Array.from(new Set(input.tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))),
    pinned: input.pinned === true,
    songId: input.songId,
    createdAt: now,
    updatedAt: now,
  }
  void saveLabUiSparks(workspaceId, [spark, ...loadLabUiSparks(workspaceId)])
  return spark
}

export function updateLabUiSpark(
  workspaceId: string | undefined,
  sparkId: string,
  patch: Partial<Pick<LabSpark, 'text' | 'kind' | 'tags' | 'pinned' | 'songId'>>,
): LabSpark | null {
  const sparks = loadLabUiSparks(workspaceId)
  const existing = sparks.find((spark) => spark.id === sparkId)
  if (!existing) return null
  const next: LabSpark = {
    ...existing,
    ...patch,
    text: patch.text?.trim() || existing.text,
    tags: patch.tags
      ? Array.from(new Set(patch.tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean)))
      : existing.tags,
    updatedAt: new Date().toISOString(),
  }
  void saveLabUiSparks(workspaceId, sparks.map((spark) => spark.id === sparkId ? next : spark))
  return next
}

export function deleteLabUiSpark(workspaceId: string | undefined, sparkId: string): void {
  void saveLabUiSparks(workspaceId, loadLabUiSparks(workspaceId).filter((spark) => spark.id !== sparkId))
}

export function upsertLabUiSong(workspaceId: string | undefined, song: LabSong): LabSong {
  const songs = loadLabUiSongs(workspaceId)
  const index = songs.findIndex((item) => item.id === song.id)
  const next = normalizeSong({ ...song, updatedAt: new Date().toISOString() })
  void saveLabUiSongs(workspaceId, index >= 0
    ? songs.map((item) => item.id === song.id ? next : item)
    : [next, ...songs])
  return next
}

export function createLabUiSong(workspaceId: string | undefined, input: Pick<LabSong, 'title' | 'project' | 'color' | 'notes'>): LabSong {
  const now = new Date().toISOString()
  const idBase = input.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'song'
  return upsertLabUiSong(workspaceId, {
    id: `${idBase}-${Date.now()}`,
    title: input.title,
    project: input.project,
    color: input.color,
    notes: input.notes,
    status: 'working',
    focused: false,
    roughText: '',
    rememberText: '',
    sections: LAB_DEFAULT_SECTIONS,
    lineAlternatives: [],
    captures: [],
    createdAt: now,
    updatedAt: now,
  })
}

export function deleteLabUiSong(workspaceId: string | undefined, songId: string): boolean {
  const current = stateByWorkspace.get(workspaceKey(workspaceId)) ?? emptyState()
  if (!current.songs.some((song) => song.id === songId)) return false
  void persistState(workspaceId, removeLabSongFromState(current, songId))
  return true
}

export function setSelectedLabSongId(workspaceId: string | undefined, songId: string) {
  const current = stateByWorkspace.get(workspaceKey(workspaceId)) ?? emptyState()
  void persistState(workspaceId, { ...current, projects: { ...current.projects, selectedSongId: songId } })
}

export function getSelectedLabSongId(workspaceId?: string): string | null {
  return stateByWorkspace.get(workspaceKey(workspaceId))?.projects.selectedSongId ?? null
}

export function defaultLabProjectsState(workspaceId?: string): LabProjectsState {
  const songs = loadLabUiSongs(workspaceId)
  return { ...emptyState().projects, poolOrder: songs.map((song) => song.id) }
}

export function loadLabProjectsState(workspaceId?: string): LabProjectsState {
  return stateByWorkspace.get(workspaceKey(workspaceId))?.projects ?? defaultLabProjectsState(workspaceId)
}

export function saveLabProjectsState(workspaceId: string | undefined, projects: LabProjectsState) {
  const current = stateByWorkspace.get(workspaceKey(workspaceId)) ?? emptyState()
  return persistState(workspaceId, { ...current, projects })
}
