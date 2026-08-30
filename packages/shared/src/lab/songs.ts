import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { atomicWriteFileSync } from '../utils/files.ts'

export type LabSongStatus = 'working' | 'done'
export type LabSongDestination = 'rough_pad' | 'remember' | 'section'
export type LabSongWriteMode = 'append' | 'replace'

export interface LabSongSection {
  id: string
  label: string
  text: string
  optional?: boolean
}

export type LabSongLineSource = 'rough' | 'section'

export interface LabSongLineAlternative {
  id: string
  text: string
  createdAt: string
}

export interface LabSongLineAlternativeGroup {
  id: string
  source: LabSongLineSource
  sectionId?: string
  anchorText: string
  lineIndex: number
  occurrence: number
  alternatives: LabSongLineAlternative[]
  updatedAt: string
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
  project: string
  color: string
  notes: string
  status: LabSongStatus
  focused: boolean
  roughText: string
  rememberText: string
  sections: LabSongSection[]
  lineAlternatives: LabSongLineAlternativeGroup[]
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
  version: 2
  songs: LabSong[]
  projects: LabProjectsState
}

export interface LabSequencePage {
  id: string
  title: string
  songIds: string[]
}

export interface LabProjectsState {
  poolOrder: string[]
  sequencePages: LabSequencePage[]
  activeSequenceId: string
  selectedSongId?: string
}

export interface LabState {
  songs: LabSong[]
  projects: LabProjectsState
}

const LAB_DIR = 'lab'
const SONGS_FILE = 'songs.json'
export const LAB_PROJECT_COLORS = ['#fb923c', '#a78bfa', '#34d399', '#60a5fa', '#f472b6'] as const
const DEFAULT_SEQUENCE_ID = 'sequence-1'

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

function defaultProjects(songs: LabSong[]): LabProjectsState {
  return {
    poolOrder: songs.map((song) => song.id),
    sequencePages: [{ id: DEFAULT_SEQUENCE_ID, title: 'Master Sequence', songIds: [] }],
    activeSequenceId: DEFAULT_SEQUENCE_ID,
  }
}

function normalizeSection(value: unknown): LabSongSection | null {
  const section = value as Partial<LabSongSection> | null
  if (!section || typeof section.id !== 'string' || typeof section.label !== 'string') return null
  return {
    id: section.id,
    label: section.label,
    text: typeof section.text === 'string' ? section.text : '',
    optional: section.optional === true ? true : undefined,
  }
}

function normalizeCapture(value: unknown): LabSongCapture | null {
  const capture = value as Partial<LabSongCapture> | null
  if (!capture || typeof capture.id !== 'string' || typeof capture.text !== 'string') return null
  const destination: LabSongDestination = capture.destination === 'remember' || capture.destination === 'section'
    ? capture.destination
    : 'rough_pad'
  return {
    id: capture.id,
    text: capture.text,
    selectionLabel: typeof capture.selectionLabel === 'string' ? capture.selectionLabel : undefined,
    destination,
    sectionId: typeof capture.sectionId === 'string' ? capture.sectionId : undefined,
    sectionLabel: typeof capture.sectionLabel === 'string' ? capture.sectionLabel : undefined,
    sourceSessionId: typeof capture.sourceSessionId === 'string' ? capture.sourceSessionId : undefined,
    sourceAgentSlug: typeof capture.sourceAgentSlug === 'string' ? capture.sourceAgentSlug : undefined,
    sourceMessageId: typeof capture.sourceMessageId === 'string' ? capture.sourceMessageId : undefined,
    note: typeof capture.note === 'string' ? capture.note : undefined,
    createdAt: typeof capture.createdAt === 'string' ? capture.createdAt : nowIso(),
  }
}

function normalizeLineAlternative(value: unknown): LabSongLineAlternative | null {
  const alternative = value as Partial<LabSongLineAlternative> | null
  if (!alternative || typeof alternative.id !== 'string' || typeof alternative.text !== 'string' || !alternative.text.trim()) return null
  return {
    id: alternative.id,
    text: alternative.text.trim(),
    createdAt: typeof alternative.createdAt === 'string' ? alternative.createdAt : nowIso(),
  }
}

function normalizeLineAlternativeGroup(value: unknown): LabSongLineAlternativeGroup | null {
  const group = value as Partial<LabSongLineAlternativeGroup> | null
  if (!group || typeof group.id !== 'string' || (group.source !== 'rough' && group.source !== 'section')) return null
  if (group.source === 'section' && typeof group.sectionId !== 'string') return null
  if (!Array.isArray(group.alternatives)) return null
  const alternatives = group.alternatives
    .map(normalizeLineAlternative)
    .filter((alternative): alternative is LabSongLineAlternative => alternative !== null)
  if (!alternatives.length) return null
  return {
    id: group.id,
    source: group.source,
    sectionId: group.source === 'section' ? group.sectionId : undefined,
    anchorText: typeof group.anchorText === 'string' ? group.anchorText : '',
    lineIndex: Number.isInteger(group.lineIndex) && Number(group.lineIndex) >= 0 ? Number(group.lineIndex) : 0,
    occurrence: Number.isInteger(group.occurrence) && Number(group.occurrence) >= 0 ? Number(group.occurrence) : 0,
    alternatives,
    updatedAt: typeof group.updatedAt === 'string' ? group.updatedAt : nowIso(),
  }
}

function normalizeSong(value: unknown): LabSong | null {
  const song = value as Partial<LabSong> | null
  if (!song || typeof song.id !== 'string' || typeof song.title !== 'string') return null
  const timestamp = nowIso()
  return {
    id: song.id,
    title: song.title,
    project: typeof song.project === 'string' && song.project.trim() ? song.project : 'Loose Singles',
    color: typeof song.color === 'string' && song.color ? song.color : LAB_PROJECT_COLORS[0],
    notes: typeof song.notes === 'string' ? song.notes : '',
    status: song.status === 'done' ? 'done' : 'working',
    focused: song.focused === true,
    roughText: typeof song.roughText === 'string' ? song.roughText : '',
    rememberText: typeof song.rememberText === 'string' ? song.rememberText : '',
    sections: Array.isArray(song.sections)
      ? song.sections.map(normalizeSection).filter((section): section is LabSongSection => section !== null)
      : defaultSections(),
    lineAlternatives: Array.isArray(song.lineAlternatives)
      ? song.lineAlternatives
        .map(normalizeLineAlternativeGroup)
        .filter((group): group is LabSongLineAlternativeGroup => group !== null)
      : [],
    captures: Array.isArray(song.captures)
      ? song.captures.map(normalizeCapture).filter((capture): capture is LabSongCapture => capture !== null)
      : [],
    createdAt: typeof song.createdAt === 'string' ? song.createdAt : timestamp,
    updatedAt: typeof song.updatedAt === 'string' ? song.updatedAt : timestamp,
  }
}

function normalizeLibrary(value: unknown): LabSongsLibrary {
  const parsed = value as Partial<LabSongsLibrary> | null
  if (!parsed || !Array.isArray(parsed.songs)) {
    const songs: LabSong[] = []
    return { version: 2, songs, projects: defaultProjects(songs) }
  }
  const songs = parsed.songs.map(normalizeSong).filter((song): song is LabSong => song !== null)
  const candidate = parsed.projects
  const sequencePages = Array.isArray(candidate?.sequencePages)
    ? candidate.sequencePages.flatMap((value) => {
      const page = value as Partial<LabSequencePage> | null
      if (!page || typeof page.id !== 'string' || typeof page.title !== 'string' || !Array.isArray(page.songIds)) return []
      return [{
        id: page.id,
        title: page.title,
        songIds: page.songIds.filter((id): id is string => typeof id === 'string'),
      }]
    })
    : []
  const fallback = defaultProjects(songs)
  return {
    version: 2,
    songs,
    projects: {
      poolOrder: Array.isArray(candidate?.poolOrder)
        ? candidate.poolOrder.filter((id): id is string => typeof id === 'string')
        : fallback.poolOrder,
      sequencePages: sequencePages.length ? sequencePages : fallback.sequencePages,
      activeSequenceId: typeof candidate?.activeSequenceId === 'string' && sequencePages.some((page) => page.id === candidate.activeSequenceId)
        ? candidate.activeSequenceId
        : (sequencePages[0]?.id ?? fallback.activeSequenceId),
      selectedSongId: typeof candidate?.selectedSongId === 'string' && songs.some((song) => song.id === candidate.selectedSongId)
        ? candidate.selectedSongId
        : undefined,
    },
  }
}

export function loadLabState(workspaceRoot: string): LabState {
  const path = getLibraryPath(workspaceRoot)
  if (!existsSync(path)) {
    const songs: LabSong[] = []
    return { songs, projects: defaultProjects(songs) }
  }
  try {
    const library = normalizeLibrary(JSON.parse(readFileSync(path, 'utf-8')))
    return { songs: library.songs, projects: library.projects }
  } catch {
    try {
      renameSync(path, `${path}.corrupt-${Date.now()}`)
    } catch {
      // Recovery remains non-destructive whenever the filesystem permits it.
    }
    const songs: LabSong[] = []
    return { songs, projects: defaultProjects(songs) }
  }
}

export function saveLabState(workspaceRoot: string, state: LabState): LabState {
  const normalized = normalizeLibrary({ version: 2, ...state })
  const path = getLibraryPath(workspaceRoot)
  mkdirSync(join(workspaceRoot, LAB_DIR), { recursive: true })
  atomicWriteFileSync(path, `${JSON.stringify(normalized, null, 2)}\n`)
  return { songs: normalized.songs, projects: normalized.projects }
}

export function loadLabSongs(workspaceRoot: string): LabSong[] {
  return loadLabState(workspaceRoot).songs
}

export function saveLabSongs(workspaceRoot: string, songs: LabSong[]): void {
  const current = loadLabState(workspaceRoot)
  saveLabState(workspaceRoot, { songs, projects: current.projects })
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
    { id: 'final-chorus', label: 'Chorus 2', text: '', optional: true },
    { id: 'bridge', label: 'Bridge', text: '', optional: true },
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
    project: input.project?.trim() || 'Loose Singles',
    color: LAB_PROJECT_COLORS[0],
    notes: '',
    status: input.status ?? 'working',
    focused: input.focused ?? false,
    roughText: '',
    rememberText: '',
    sections: defaultSections(),
    lineAlternatives: [],
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
  if (!song) throw new Error('Song not found.')
  for (const capture of input.captures) {
    song = applyCapture(song, capture)
  }
  song = { ...song, updatedAt: nowIso() }
  const next = [...songs]
  next[songIndex] = song
  saveLabSongs(workspaceRoot, next)
  return song
}
