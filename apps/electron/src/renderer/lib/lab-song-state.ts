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

const SONGS_KEY = 'lab:songs:v1'
const SELECTED_SONG_KEY = 'lab:selected-song-id:v1'
const EVENT_NAME = 'lab-songs-updated'

export const LAB_PROJECT_COLORS = ['#fb923c', '#a78bfa', '#34d399', '#60a5fa', '#f472b6']

export const LAB_DEFAULT_SECTIONS: LabUiSongSection[] = [
  { id: 'intro', label: 'Intro', text: '', optional: true },
  { id: 'verse-1', label: 'V1', text: '' },
  { id: 'pre-chorus', label: 'Pre1', text: '', optional: true },
  { id: 'chorus', label: 'Chorus', text: '' },
  { id: 'verse-2', label: 'V2', text: '', optional: true },
  { id: 'bridge', label: 'Bridge', text: '', optional: true },
  { id: 'final-chorus', label: 'Chorus 2', text: '', optional: true },
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

export function subscribeLabSongs(callback: () => void): () => void {
  const handler = () => callback()
  window.addEventListener(EVENT_NAME, handler)
  window.addEventListener('storage', handler)
  return () => {
    window.removeEventListener(EVENT_NAME, handler)
    window.removeEventListener('storage', handler)
  }
}

export function loadLabUiSongs(): LabUiSong[] {
  try {
    const raw = window.localStorage.getItem(SONGS_KEY)
    if (!raw) return SEED_SONGS
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return SEED_SONGS
    return parsed.filter((song): song is LabUiSong => Boolean(song?.id && song?.title))
  } catch {
    return SEED_SONGS
  }
}

export function saveLabUiSongs(songs: LabUiSong[]) {
  window.localStorage.setItem(SONGS_KEY, JSON.stringify(songs))
  emitUpdate()
}

export function upsertLabUiSong(song: LabUiSong) {
  const songs = loadLabUiSongs()
  const index = songs.findIndex((item) => item.id === song.id)
  const next = { ...song, updatedAt: new Date().toISOString() }
  saveLabUiSongs(index >= 0
    ? songs.map((item) => item.id === song.id ? next : item)
    : [next, ...songs])
  return next
}

export function createLabUiSong(input: Pick<LabUiSong, 'title' | 'project' | 'color' | 'notes'>): LabUiSong {
  const idBase = input.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'song'
  const id = `${idBase}-${Date.now()}`
  return upsertLabUiSong({
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

export function setSelectedLabSongId(songId: string) {
  window.localStorage.setItem(SELECTED_SONG_KEY, songId)
}

export function getSelectedLabSongId(): string | null {
  return window.localStorage.getItem(SELECTED_SONG_KEY)
}
