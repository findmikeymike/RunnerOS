import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

export type LabSongStatus = 'working' | 'done'
export type LabSongDestination = 'rough_pad' | 'remember' | 'section'
export type LabSongWriteMode = 'append' | 'replace'

export interface LabSongSection {
  id: string
  label: string
  text: string
  optional?: boolean
}
export interface LabSongCapture {
  id: string
  text: string
  selectionLabel?: string
  destination: LabSongDestination
  sectionId?: string
  sectionLabel?: string
  sourceSessionId?: string
  sourceAgentSlug?: string
  sourceMessageId?: string
  note?: string
  createdAt: string
}

export interface LabSong {
  id: string
  title: string
  project?: string
  status: LabSongStatus
  focused: boolean
  roughText: string
  rememberText: string
  sections: LabSongSection[]
  captures: LabSongCapture[]
  createdAt: string
  updatedAt: string
}

export interface LabSongCaptureInput {
  text: string
  selectionLabel?: string
  destination?: LabSongDestination
  sectionId?: string
  sectionLabel?: string
  mode?: LabSongWriteMode
  sourceSessionId?: string
  sourceAgentSlug?: string
  sourceMessageId?: string
  note?: string
}

export interface CreateLabSongInput {
  title: string
  project?: string
  status?: LabSongStatus
  focused?: boolean
  captures?: LabSongCaptureInput[]
}

export interface SaveLabLyricsInput {
  songId?: string
  songTitle?: string
  createIfMissing?: {
    title: string
    project?: string
    status?: LabSongStatus
    focused?: boolean
  }
  captures: LabSongCaptureInput[]
}

export interface LabSongsLibrary {
  version: 1
  songs: LabSong[]
}

const LAB_DIR = 'lab'
const SONGS_FILE = 'songs.json'

function nowIso(): string {
  return new Date().toISOString()
}

function slugify(value: string): string {
  const slug = value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return slug || `song-${Date.now()}`
}

function appendText(existing: string, incoming: string): string {
  const clean = incoming.trim()
  if (!clean) return existing
  return existing.trim() ? `${existing.trim()}\n${clean}` : clean
}

function getLibraryPath(workspaceRoot: string): string {
  return join(workspaceRoot, LAB_DIR, SONGS_FILE)
}

function normalizeLibrary(value: unknown): LabSongsLibrary {
  const parsed = value as Partial<LabSongsLibrary> | null
  if (!parsed || !Array.isArray(parsed.songs)) return { version: 1, songs: [] }
  return {
    version: 1,
    songs: parsed.songs.filter((song): song is LabSong => (
      Boolean(song) &&
      typeof (song as LabSong).id === 'string' &&
      typeof (song as LabSong).title === 'string'
    )),
  }
}

export function loadLabSongs(workspaceRoot: string): LabSong[] {
  const path = getLibraryPath(workspaceRoot)
  if (!existsSync(path)) return []
  try {
    return normalizeLibrary(JSON.parse(readFileSync(path, 'utf-8'))).songs
  } catch {
    return []
  }
}

export function saveLabSongs(workspaceRoot: string, songs: LabSong[]): void {
  const path = getLibraryPath(workspaceRoot)
  mkdirSync(join(workspaceRoot, LAB_DIR), { recursive: true })
  writeFileSync(path, `${JSON.stringify({ version: 1, songs }, null, 2)}\n`, 'utf-8')
}

function uniqueSongId(existing: LabSong[], title: string): string {
  const base = slugify(title)
  const used = new Set(existing.map((song) => song.id))
  if (!used.has(base)) return base
  for (let i = 2; i < 1000; i += 1) {
    const next = `${base}-${i}`
    if (!used.has(next)) return next
  }
  return `${base}-${randomUUID().slice(0, 8)}`
}

function defaultSections(): LabSongSection[] {
  return [
    { id: 'verse-1', label: 'V1', text: '' },
    { id: 'pre-chorus', label: 'Pre1', text: '', optional: true },
    { id: 'chorus', label: 'Chorus', text: '' },
    { id: 'verse-2', label: 'V2', text: '', optional: true },
    { id: 'bridge', label: 'Bridge', text: '', optional: true },
    { id: 'final-chorus', label: 'Chorus 2', text: '', optional: true },
  ]
}

function applyCapture(song: LabSong, input: LabSongCaptureInput): LabSong {
  const text = input.text.trim()
  if (!text) return song
  const destination = input.destination ?? 'rough_pad'
  const capture: LabSongCapture = {
    id: randomUUID(),
    text,
    selectionLabel: input.selectionLabel?.trim() || undefined,
    destination,
    sectionId: input.sectionId?.trim() || undefined,
    sectionLabel: input.sectionLabel?.trim() || undefined,
    sourceSessionId: input.sourceSessionId?.trim() || undefined,
    sourceAgentSlug: input.sourceAgentSlug?.trim() || undefined,
    sourceMessageId: input.sourceMessageId?.trim() || undefined,
    note: input.note?.trim() || undefined,
    createdAt: nowIso(),
  }
  const mode = input.mode ?? 'append'

  if (destination === 'remember') {
    return {
      ...song,
      rememberText: mode === 'replace' ? text : appendText(song.rememberText, text),
      captures: [...song.captures, capture],
    }
  }

  if (destination === 'section') {
    const sectionId = input.sectionId?.trim() || slugify(input.sectionLabel || 'section')
    const sectionLabel = input.sectionLabel?.trim() || sectionId
    const sections = song.sections.some((section) => section.id === sectionId)
      ? song.sections.map((section) => section.id === sectionId
        ? { ...section, label: input.sectionLabel?.trim() || section.label, text: mode === 'replace' ? text : appendText(section.text, text) }
        : section)
      : [...song.sections, { id: sectionId, label: sectionLabel, text, optional: true }]
    return { ...song, sections, captures: [...song.captures, { ...capture, sectionId, sectionLabel }] }
  }

  return {
    ...song,
    roughText: mode === 'replace' ? text : appendText(song.roughText, text),
    captures: [...song.captures, capture],
  }
}

export function createLabSong(workspaceRoot: string, input: CreateLabSongInput): LabSong {
  const title = input.title.trim()
  if (!title) throw new Error('Song title is required.')
  const songs = loadLabSongs(workspaceRoot)
  const timestamp = nowIso()
  let song: LabSong = {
    id: uniqueSongId(songs, title),
    title,
    project: input.project?.trim() || undefined,
    status: input.status ?? 'working',
    focused: input.focused ?? false,
    roughText: '',
    rememberText: '',
    sections: defaultSections(),
    captures: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  for (const capture of input.captures ?? []) {
    song = applyCapture(song, capture)
  }
  song.updatedAt = nowIso()
  saveLabSongs(workspaceRoot, [song, ...songs])
  return song
}

export function saveLabLyrics(workspaceRoot: string, input: SaveLabLyricsInput): LabSong {
  if (!Array.isArray(input.captures) || input.captures.length === 0) {
    throw new Error('At least one exact lyric excerpt is required.')
  }
  const songs = loadLabSongs(workspaceRoot)
  let songIndex = input.songId
    ? songs.findIndex((song) => song.id === input.songId)
    : -1
  if (songIndex < 0 && input.songTitle?.trim()) {
    const title = input.songTitle.trim().toLowerCase()
    songIndex = songs.findIndex((song) => song.title.toLowerCase() === title)
  }

  if (songIndex < 0) {
    if (!input.createIfMissing) {
      throw new Error('Song not found. Provide songId, songTitle, or createIfMissing.')
    }
    return createLabSong(workspaceRoot, {
      ...input.createIfMissing,
      captures: input.captures,
    })
  }

  let song = songs[songIndex]
  for (const capture of input.captures) {
    song = applyCapture(song, capture)
  }
  song = { ...song, updatedAt: nowIso() }
  const next = [...songs]
  next[songIndex] = song
  saveLabSongs(workspaceRoot, next)
  return song
}
