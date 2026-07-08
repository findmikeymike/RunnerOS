export type LabUiSongSection = {
  id: string
  label: string
  text: string
  optional?: boolean
}

export type LabUiSong = {
  id: string
  title: string
  project: string
  color: string
  notes: string
  roughText: string
  rememberText: string
  sections: LabUiSongSection[]
  updatedAt: string
}

export type LabUiSequencePage = {
  id: string
  title: string
  songIds: string[]
}

export type LabUiProjectsState = {
  poolOrder: string[]
  sequencePages: LabUiSequencePage[]
  activeSequenceId: string
}

const SONGS_KEY_PREFIX = 'lab:songs:v1'
const PROJECTS_KEY_PREFIX = 'lab:projects:v1'
const SELECTED_SONG_KEY_PREFIX = 'lab:selected-song-id:v1'
const EVENT_NAME = 'lab-songs-updated'

export const LAB_PROJECT_COLORS = ['#fb923c', '#a78bfa', '#34d399', '#60a5fa', '#f472b6']

export const LAB_DEFAULT_SECTIONS: LabUiSongSection[] = [
  { id: 'verse-1', label: 'V1', text: '' },
  { id: 'pre-chorus', label: 'Pre1', text: '', optional: true },
  { id: 'chorus', label: 'Chorus', text: '' },
  { id: 'verse-2', label: 'V2', text: '', optional: true },
  { id: 'final-chorus', label: 'Chorus 2', text: '', optional: true },
  { id: 'bridge', label: 'Bridge', text: '', optional: true },
]

const SEED_SONGS: LabUiSong[] = [
  createSeedSong({
    id: 'night-drive',
    title: 'Untitled night-drive hook',
    project: 'Loose Singles',
    color: LAB_PROJECT_COLORS[0],
    notes: 'Strong hook. Needs second verse.',
    roughText: 'I keep writing versions of leaving that still sound like staying\nEverybody called the ending while I was still becoming it\nWhat if the chorus is more confession than flex?\n\nlooking expensive / feeling unstable / making it sound controlled',
    rememberText: 'Luxury as armor\nA private-life song about everyone having a camera and no real access\nSoft exit, no revenge',
    sections: LAB_DEFAULT_SECTIONS.map((section) => section.id === 'verse-1'
      ? { ...section, text: 'I keep leaving town but every red light knows my name\nWindow down, I make the silence say it first' }
      : section.id === 'chorus'
        ? { ...section, text: 'Pretty trouble, dressed like I meant it\nSoft disaster, nobody gets it' }
        : section),
  }),
  createSeedSong({ id: 'pretty-trouble', title: 'Pretty trouble', project: 'EP One', color: LAB_PROJECT_COLORS[1], notes: 'Feels like track 2.' }),
  createSeedSong({ id: 'backseat-prophecy', title: 'Backseat prophecy', project: 'Loose Singles', color: LAB_PROJECT_COLORS[0], notes: 'Maybe later in sequence.' }),
  createSeedSong({ id: 'soft-exit', title: 'Soft exit', project: 'Album Sketches', color: LAB_PROJECT_COLORS[2], notes: 'Quiet closer energy.' }),
]

const DEFAULT_SEQUENCE_ID = 'sequence-1'

function createSeedSong(input: Partial<LabUiSong> & Pick<LabUiSong, 'id' | 'title' | 'project' | 'color' | 'notes'>): LabUiSong {
  return {
    roughText: '',
    rememberText: '',
    sections: LAB_DEFAULT_SECTIONS,
    updatedAt: new Date(0).toISOString(),
    ...input,
  }
}

function emitUpdate() {
  window.dispatchEvent(new CustomEvent(EVENT_NAME))
}

function normalizeSections(sections: LabUiSongSection[]): LabUiSongSection[] {
  return sections.filter((section) => section.id !== 'intro' || section.text.trim())
}

function normalizeSong(song: LabUiSong): LabUiSong {
  return { ...song, sections: normalizeSections(song.sections) }
}

function scopedKey(prefix: string, workspaceId?: string): string {
  return `${prefix}:${workspaceId || 'default'}`
}

export function subscribeLabSongs(callback: () => void): () => void {
  const handler = () => callback()
  window.addEventListener(EVENT_NAME, handler)
  window.addEventListener('storage', handler)
  return () => {
    window.removeEventListener(EVENT_NAME, handler)
    window.removeEventListener('storage', handler)
  }
}

export function loadLabUiSongs(workspaceId?: string): LabUiSong[] {
  const key = scopedKey(SONGS_KEY_PREFIX, workspaceId)
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) {
      const songs = SEED_SONGS.map(normalizeSong)
      window.localStorage.setItem(key, JSON.stringify(songs))
      return songs
    }
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      const songs = SEED_SONGS.map(normalizeSong)
      window.localStorage.setItem(key, JSON.stringify(songs))
      return songs
    }
    const songs = parsed
      .filter((song): song is LabUiSong => Boolean(song?.id && song?.title))
      .map(normalizeSong)
    window.localStorage.setItem(key, JSON.stringify(songs))
    return songs
  } catch {
    const songs = SEED_SONGS.map(normalizeSong)
    window.localStorage.setItem(key, JSON.stringify(songs))
    return songs
  }
}

export function saveLabUiSongs(workspaceId: string | undefined, songs: LabUiSong[]) {
  window.localStorage.setItem(scopedKey(SONGS_KEY_PREFIX, workspaceId), JSON.stringify(songs))
  emitUpdate()
}

export function upsertLabUiSong(workspaceId: string | undefined, song: LabUiSong) {
  const songs = loadLabUiSongs(workspaceId)
  const index = songs.findIndex((item) => item.id === song.id)
  const next = { ...song, updatedAt: new Date().toISOString() }
  saveLabUiSongs(workspaceId, index >= 0
    ? songs.map((item) => item.id === song.id ? next : item)
    : [next, ...songs])
  return next
}

export function createLabUiSong(workspaceId: string | undefined, input: Pick<LabUiSong, 'title' | 'project' | 'color' | 'notes'>): LabUiSong {
  const idBase = input.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'song'
  const id = `${idBase}-${Date.now()}`
  return upsertLabUiSong(workspaceId, {
    id,
    title: input.title,
    project: input.project,
    color: input.color,
    notes: input.notes,
    roughText: '',
    rememberText: '',
    sections: LAB_DEFAULT_SECTIONS,
    updatedAt: new Date().toISOString(),
  })
}

export function setSelectedLabSongId(workspaceId: string | undefined, songId: string) {
  window.localStorage.setItem(scopedKey(SELECTED_SONG_KEY_PREFIX, workspaceId), songId)
}

export function getSelectedLabSongId(workspaceId?: string): string | null {
  return window.localStorage.getItem(scopedKey(SELECTED_SONG_KEY_PREFIX, workspaceId))
}

export function defaultLabProjectsState(workspaceId?: string): LabUiProjectsState {
  const songs = loadLabUiSongs(workspaceId)
  return {
    poolOrder: songs.map((song) => song.id),
    sequencePages: [{ id: DEFAULT_SEQUENCE_ID, title: 'Master Sequence', songIds: [] }],
    activeSequenceId: DEFAULT_SEQUENCE_ID,
  }
}

export function loadLabProjectsState(workspaceId?: string): LabUiProjectsState {
  const key = scopedKey(PROJECTS_KEY_PREFIX, workspaceId)
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return defaultLabProjectsState(workspaceId)
    const parsed = JSON.parse(raw) as Partial<LabUiProjectsState>
    const fallback = defaultLabProjectsState(workspaceId)
    const sequencePages = Array.isArray(parsed.sequencePages) && parsed.sequencePages.length > 0
      ? parsed.sequencePages.filter((page): page is LabUiSequencePage => Boolean(page?.id && typeof page.title === 'string' && Array.isArray(page.songIds)))
      : fallback.sequencePages
    const activeSequenceId = parsed.activeSequenceId && sequencePages.some((page) => page.id === parsed.activeSequenceId)
      ? parsed.activeSequenceId
      : sequencePages[0].id
    return {
      poolOrder: Array.isArray(parsed.poolOrder) ? parsed.poolOrder.filter((id): id is string => typeof id === 'string') : fallback.poolOrder,
      sequencePages,
      activeSequenceId,
    }
  } catch {
    return defaultLabProjectsState(workspaceId)
  }
}

export function saveLabProjectsState(workspaceId: string | undefined, state: LabUiProjectsState) {
  window.localStorage.setItem(scopedKey(PROJECTS_KEY_PREFIX, workspaceId), JSON.stringify(state))
}
