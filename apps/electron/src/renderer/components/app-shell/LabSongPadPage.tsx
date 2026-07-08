import * as React from 'react'
import {
  Copy,
  Eye,
  EyeOff,
  FlaskConical,
  Info,
  Layers,
  Music2,
  Plus,
  Sparkles,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useWorkspaceContext } from '@/hooks/useWorkspaceContext'
import { useAgents } from '@/hooks/useAgents'
import {
  buildAgentCreateSessionOptions,
  loadAgentMemoryEntries,
  loadUserMemoryEntries,
} from '@/lib/run-agent'
import {
  resolveLabWorkerRoute,
  type LabWorkerCandidate,
  type LabWorkerRole,
  type LabWorkerRouteResult,
} from '@/lib/lab-worker-routing'
import {
  buildProsodySelection,
  type ProsodySelectionInfo,
} from '@/lib/prosody-selection'
import {
  ARTIST_PROFILE_CONTEXT_SLUG,
  parseArtistProfileDocResult,
  type ArtistProfile,
} from '@/lib/artist-profile'
import {
  getSelectedLabSongId,
  LAB_DEFAULT_SECTIONS,
  LAB_PROJECT_COLORS,
  loadLabUiSongs,
  setSelectedLabSongId,
  subscribeLabSongs,
  upsertLabUiSong,
  type LabUiSong,
} from '@/lib/lab-song-state'
import type { AgentDefinitionDTO, ProsodyLookupResult, ProsodyRhymeItem } from '../../../shared/types'

interface LabSongPadPageProps {
  workspaceId?: string
  songId?: string
  artistProfileWorkspaceId?: string
  workspaceName?: string
}

type SelectionSource = 'rough' | 'remember'

type ProsodySelectionSource = SelectionSource | 'section'

type ProsodySelectionState = ProsodySelectionInfo & {
  source: ProsodySelectionSource
  sectionId?: string
  anchor: { x: number; y: number }
}

type SongSection = {
  id: string
  label: string
  text: string
  optional?: boolean
}

type LyricAgentPayload = {
  action: LyricAgentAction
  actionLabel: string
  routeRole: LabWorkerRole
  requestedRoles: LabWorkerRole[]
  labWorkspaceId?: string
  artistProfile: Pick<ArtistProfile, 'artistName' | 'themes' | 'sound' | 'similarArtists' | 'rules'>
  song: {
    title: string
    roughText: string
    rememberText: string
    sections: SongSection[]
  }
  targetSection: SongSection
}

const INITIAL_SECTIONS: SongSection[] = [
  { id: 'intro', label: 'Intro', text: '', optional: true },
  {
    id: 'verse-1',
    label: 'V1',
    text: 'I keep leaving town but every red light knows my name\nWindow down, I make the silence say it first',
  },
  { id: 'pre-chorus', label: 'Pre1', text: '', optional: true },
  {
    id: 'chorus',
    label: 'Chorus',
    text: 'Pretty trouble, dressed like I meant it\nSoft disaster, nobody gets it',
  },
  { id: 'verse-2', label: 'V2', text: '', optional: true },
  { id: 'bridge', label: 'Bridge', text: '', optional: true },
  { id: 'final-chorus', label: 'Chorus 2', text: '', optional: true },
]

function fallbackSong(workspaceId?: string): LabUiSong {
  return loadLabUiSongs(workspaceId)[0] ?? {
    id: 'untitled-song',
    title: 'Untitled song',
    project: 'Loose Singles',
    color: LAB_PROJECT_COLORS[0],
    notes: '',
    roughText: '',
    rememberText: '',
    sections: LAB_DEFAULT_SECTIONS,
    updatedAt: new Date().toISOString(),
  }
}

function getActiveLabSong(workspaceId?: string, routeSongId?: string): LabUiSong {
  const songs = loadLabUiSongs(workspaceId)
  const selectedId = routeSongId ?? getSelectedLabSongId(workspaceId)
  const selected = selectedId ? songs.find((song) => song.id === selectedId) : null
  const song = selected ?? songs[0] ?? fallbackSong(workspaceId)
  setSelectedLabSongId(workspaceId, song.id)
  return song
}

const SECTION_BUTTONS = [
  { id: 'verse-1', label: 'V1', title: 'Send to Verse 1' },
  { id: 'pre-chorus', label: 'P', title: 'Send to Pre-Chorus' },
  { id: 'chorus', label: 'C', title: 'Send to Chorus' },
  { id: 'verse-2', label: 'V2', title: 'Send to Verse 2' },
  { id: 'bridge', label: 'B', title: 'Send to Bridge' },
]

const LYRIC_AGENT_ACTIONS = [
  { id: 'suggest', label: 'Suggest lines' },
  { id: 'references', label: 'References' },
  { id: 'review', label: 'Review this' },
  { id: 'stronger', label: 'Make stronger' },
  { id: 'continue', label: 'Continue from here' },
] as const

type LyricAgentAction = typeof LYRIC_AGENT_ACTIONS[number]['id']

function appendText(existing: string, incoming: string) {
  const clean = incoming.trim()
  if (!clean) return existing
  return existing.trim() ? `${existing.trim()}\n${clean}` : clean
}

function removeSelectedText(existing: string, selected: string) {
  if (!selected.trim()) return existing
  return existing.replace(selected, '').replace(/\n{3,}/g, '\n\n').trimStart()
}

function textareaBase(extra?: string) {
  return cn(
    'w-full resize-none border-0 bg-transparent text-sm leading-7 tracking-normal text-white/82 outline-none placeholder:text-white/20',
    extra,
  )
}

function sectionRows(text: string) {
  return Math.max(2, text.split('\n').length + 1)
}

function selectionAnchor(
  node: HTMLTextAreaElement,
  selection: Pick<ProsodySelectionInfo, 'end'>,
): { x: number; y: number } {
  const rect = node.getBoundingClientRect()
  const style = window.getComputedStyle(node)
  const valueBeforeSelection = node.value.slice(0, selection.end)
  const lineStart = valueBeforeSelection.lastIndexOf('\n') + 1
  const lineText = valueBeforeSelection.slice(lineStart)
  const lineIndex = valueBeforeSelection.slice(0, lineStart).split('\n').length - 1
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (context) {
    context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
  }
  const measuredTextWidth = context?.measureText(lineText).width ?? 0
  const paddingLeft = Number.parseFloat(style.paddingLeft) || 0
  const paddingTop = Number.parseFloat(style.paddingTop) || 0
  const lineHeight = Number.parseFloat(style.lineHeight) || 28

  return {
    x: Math.min(rect.right - 8, rect.left + paddingLeft + measuredTextWidth - node.scrollLeft + 4),
    y: Math.min(rect.bottom - 18, rect.top + paddingTop + (lineIndex * lineHeight) - node.scrollTop + 2),
  }
}

function prosodyPopoverPosition(anchor: { x: number; y: number }) {
  const width = 300
  const gutter = 6
  const wouldOverflowRight = typeof window !== 'undefined' && anchor.x + width + gutter > window.innerWidth
  const preferredLeft = wouldOverflowRight ? anchor.x - width - gutter : anchor.x + gutter
  const left = typeof window === 'undefined'
    ? preferredLeft
    : Math.min(Math.max(12, preferredLeft), Math.max(12, window.innerWidth - width - 12))
  const top = typeof window === 'undefined'
    ? anchor.y
    : Math.min(Math.max(12, anchor.y - 6), Math.max(12, window.innerHeight - 260))
  return { left, top }
}

function buildLyricAgentPayload({
  action,
  actionLabel,
  routeRole,
  requestedRoles,
  artistProfile,
  workspaceId,
  roughText,
  rememberText,
  sections,
  targetSection,
  title,
}: {
  action: LyricAgentAction
  actionLabel: string
  routeRole: LabWorkerRole
  requestedRoles: LabWorkerRole[]
  artistProfile: ArtistProfile
  workspaceId?: string
  roughText: string
  rememberText: string
  sections: SongSection[]
  targetSection: SongSection
  title: string
}): LyricAgentPayload {
  return {
    action,
    actionLabel,
    routeRole,
    requestedRoles,
    labWorkspaceId: workspaceId,
    artistProfile: {
      artistName: artistProfile.artistName,
      themes: artistProfile.themes,
      sound: artistProfile.sound,
      similarArtists: artistProfile.similarArtists,
      rules: artistProfile.rules,
    },
    song: {
      title,
      roughText,
      rememberText,
      sections,
    },
    targetSection,
  }
}

async function runSavedLabWorker(
  workspaceId: string,
  agent: AgentDefinitionDTO,
  payload: LyricAgentPayload,
  agentCatalog: AgentDefinitionDTO[],
): Promise<string> {
  const [skills, sources, contextDocs, userMemoryEntries, agentMemoryEntries] = await Promise.all([
    window.electronAPI.getSkills(workspaceId),
    window.electronAPI.getSources(workspaceId),
    window.electronAPI.listWorkspaceContextDocsForAgent(workspaceId, agent.slug),
    loadUserMemoryEntries(),
    loadAgentMemoryEntries(agent.slug),
  ])
  const baseOptions = buildAgentCreateSessionOptions(agent, {
    skills,
    sources,
    contextDocs,
    agentCatalog,
    userMemoryEntries,
    agentMemoryEntries,
  })
  const session = await window.electronAPI.createSession(workspaceId, {
    ...baseOptions,
    hidden: true,
    name: `${agent.metadata.name} - ${payload.targetSection.label}`,
    launchReceipt: baseOptions.launchReceipt
      ? {
          ...baseOptions.launchReceipt,
          summary: `Lab ${payload.actionLabel.toLowerCase()} for ${payload.targetSection.label}.`,
        }
      : baseOptions.launchReceipt,
  })

  const response = waitForLyricAgentResponse(session.id)
  try {
    await window.electronAPI.sendMessage(session.id, buildLyricAgentPrompt(payload))
    return await response.promise
  } catch (err) {
    response.cancel()
    throw err
  }
}

function waitForLyricAgentResponse(sessionId: string): { promise: Promise<string>; cancel: () => void } {
  let cancel = () => {}
  const promise = new Promise<string>((resolve, reject) => {
    let settled = false
    let latestText = ''
    let cleanup: (() => void) | null = null
    const timeout = window.setTimeout(() => {
      finish(() => reject(new Error('Lab worker timed out. Try again.')))
    }, 90_000)

    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      window.clearTimeout(timeout)
      cleanup?.()
      fn()
    }
    cancel = () => finish(() => reject(new Error('Lab worker cancelled.')))

    cleanup = window.electronAPI.onSessionEvent((event) => {
      if (!('sessionId' in event) || event.sessionId !== sessionId) return
      if (event.type === 'text_complete' && !event.isIntermediate) {
        latestText = event.text.trim()
        if (latestText) {
          finish(() => resolve(latestText))
        }
      } else if (event.type === 'error') {
        finish(() => reject(new Error(event.error)))
      } else if (event.type === 'typed_error') {
        finish(() => reject(new Error(event.error.message || event.error.title || 'Lab worker failed.')))
      } else if (event.type === 'complete' && latestText) {
        finish(() => resolve(latestText))
      }
    })
  })
  return { promise, cancel }
}

function buildLyricAgentPrompt(payload: LyricAgentPayload) {
  return [
    `Action: ${payload.action}`,
    `Action label: ${payload.actionLabel}`,
    `Requested Lab role: ${payload.routeRole}`,
    `Accepted role path: ${payload.requestedRoles.join(' -> ')}`,
    `Target section: ${payload.targetSection.label}`,
    '',
    'Artist profile:',
    JSON.stringify(payload.artistProfile, null, 2),
    '',
    'Song:',
    `Title: ${payload.song.title}`,
    '',
    'Rough pad:',
    payload.song.roughText || '(empty)',
    '',
    'Remember this:',
    payload.song.rememberText || '(empty)',
    '',
    'Structured sections:',
    payload.song.sections.map((section) => [
      `## ${section.label}`,
      section.text || '(empty)',
    ].join('\n')).join('\n\n'),
    '',
    'Target section current text:',
    payload.targetSection.text || '(empty)',
    '',
    'Use your saved Lab worker persona. Focus on the requested role and target section. Keep the output short enough to insert into the Song Pad.',
    '',
    actionInstruction(payload.action),
  ].join('\n')
}

function actionInstruction(action: LyricAgentAction) {
  if (action === 'references') {
    return 'Find fresh cultural references, images, and allusions that could color this target section. Group them by well, give one-line meanings, and include brief lyric-use notes. Do not write a full lyric.'
  }
  if (action === 'review') {
    return 'Review only this target section. Give 3 short bullets: what works, what is weak, and one specific fix.'
  }
  if (action === 'stronger') {
    return 'Rewrite or add stronger lyric lines for the target section. Return only the improved lines.'
  }
  if (action === 'continue') {
    return 'Continue naturally from the target section. Return only new lyric lines.'
  }
  return 'Suggest 3-5 lyric lines that could fit this target section. Return only the lines.'
}

function actionLabel(action: LyricAgentAction): string {
  return LYRIC_AGENT_ACTIONS.find((item) => item.id === action)?.label ?? action
}

function routeRequestForAction(section: SongSection, action: LyricAgentAction): { role: LabWorkerRole; fallbackRoles: LabWorkerRole[] } {
  const sectionRole = roleForSection(section)
  if (action === 'references') {
    return { role: 'research.reference', fallbackRoles: ['song.reference', 'song.concept'] }
  }
  if (action === 'review') {
    return { role: 'lyrics.review', fallbackRoles: ['lyrics.rewrite'] }
  }
  if (action === 'stronger') {
    return sectionRole
      ? { role: sectionRole, fallbackRoles: ['lyrics.rewrite', 'lyrics.review'] }
      : { role: 'lyrics.rewrite', fallbackRoles: ['lyrics.review'] }
  }
  if (action === 'continue') {
    return sectionRole
      ? { role: sectionRole, fallbackRoles: ['lyrics.generate'] }
      : { role: 'lyrics.generate', fallbackRoles: ['lyrics.rewrite'] }
  }
  return sectionRole
    ? { role: sectionRole, fallbackRoles: ['lyrics.generate'] }
    : { role: 'lyrics.generate', fallbackRoles: ['lyrics.rewrite'] }
}

function roleForSection(section: SongSection): LabWorkerRole | null {
  const key = `${section.id} ${section.label}`.toLowerCase()
  if (key.includes('chorus') || /\bc\b/.test(key)) return 'lyrics.section.chorus'
  if (key.includes('bridge') || /\bb\b/.test(key)) return 'lyrics.section.bridge'
  if (key.includes('verse') || /\bv\d?\b/.test(key)) return 'lyrics.section.verse'
  return null
}

export function LabSongPadPage({ workspaceId, songId, artistProfileWorkspaceId, workspaceName }: LabSongPadPageProps) {
  const roughRef = React.useRef<HTMLTextAreaElement>(null)
  const rememberRef = React.useRef<HTMLTextAreaElement>(null)
  const activeWorkerRunIdRef = React.useRef(0)
  const prosodyLookupRunIdRef = React.useRef(0)
  const savingSongRef = React.useRef(false)
  const initialSongRef = React.useRef<LabUiSong | null>(null)
  const readInitialSong = () => {
    initialSongRef.current ??= getActiveLabSong(workspaceId, songId)
    return initialSongRef.current
  }
  const [activeSongId, setActiveSongId] = React.useState(() => readInitialSong().id)
  const [title, setTitle] = React.useState(() => readInitialSong().title)
  const [project, setProject] = React.useState(() => readInitialSong().project)
  const [projectColor, setProjectColor] = React.useState(() => readInitialSong().color)
  const [roughText, setRoughText] = React.useState(() => readInitialSong().roughText)
  const [rememberText, setRememberText] = React.useState(() => readInitialSong().rememberText)
  const [sections, setSections] = React.useState<SongSection[]>(() => readInitialSong().sections.length ? readInitialSong().sections : INITIAL_SECTIONS)
  const [selectedText, setSelectedText] = React.useState('')
  const [selectionSource, setSelectionSource] = React.useState<SelectionSource>('rough')
  const [prosodySelection, setProsodySelection] = React.useState<ProsodySelectionState | null>(null)
  const [prosodyResult, setProsodyResult] = React.useState<ProsodyLookupResult | null>(null)
  const [prosodyBusy, setProsodyBusy] = React.useState(false)
  const [prosodyCopiedWord, setProsodyCopiedWord] = React.useState<string | null>(null)
  const [showEmptySections, setShowEmptySections] = React.useState(true)
  const [activeAgentSectionId, setActiveAgentSectionId] = React.useState<string | null>(null)
  const [agentOutput, setAgentOutput] = React.useState('')
  const [agentBusy, setAgentBusy] = React.useState(false)
  const [agentError, setAgentError] = React.useState('')
  const [workerRoute, setWorkerRoute] = React.useState<LabWorkerRouteResult | null>(null)
  const [pendingWorkerRun, setPendingWorkerRun] = React.useState<{ section: SongSection; action: LyricAgentAction } | null>(null)
  const { docs: artistProfileDocs } = useWorkspaceContext(artistProfileWorkspaceId)
  const { activeAgents, loading: agentsLoading } = useAgents(workspaceId)

  React.useEffect(() => subscribeLabSongs(() => {
    if (savingSongRef.current) return
    const next = getActiveLabSong(workspaceId, songId)
    setActiveSongId(next.id)
    setTitle(next.title)
    setProject(next.project)
    setProjectColor(next.color)
    setRoughText(next.roughText)
    setRememberText(next.rememberText)
    setSections(next.sections.length ? next.sections : INITIAL_SECTIONS)
  }), [songId, workspaceId])

  React.useEffect(() => {
    const next = getActiveLabSong(workspaceId, songId)
    setActiveSongId(next.id)
    setTitle(next.title)
    setProject(next.project)
    setProjectColor(next.color)
    setRoughText(next.roughText)
    setRememberText(next.rememberText)
    setSections(next.sections.length ? next.sections : INITIAL_SECTIONS)
  }, [songId, workspaceId])

  React.useEffect(() => {
    savingSongRef.current = true
    upsertLabUiSong(workspaceId, {
      id: activeSongId,
      title,
      project,
      color: projectColor,
      notes: loadLabUiSongs(workspaceId).find((song) => song.id === activeSongId)?.notes ?? '',
      roughText,
      rememberText,
      sections,
      updatedAt: new Date().toISOString(),
    })
    window.queueMicrotask(() => {
      savingSongRef.current = false
    })
  }, [activeSongId, title, project, projectColor, roughText, rememberText, sections, workspaceId])

  const artistProfile = React.useMemo(
    () => parseArtistProfileDocResult(artistProfileDocs.find((doc) => doc.slug === ARTIST_PROFILE_CONTEXT_SLUG)).profile,
    [artistProfileDocs],
  )

  const captureProsodySelection = React.useCallback((
    source: ProsodySelectionSource,
    node: HTMLTextAreaElement,
    sectionId?: string,
  ) => {
    const selection = buildProsodySelection(node.value, node.selectionStart, node.selectionEnd)
    if (!selection) {
      setProsodySelection(null)
      return
    }
    setProsodySelection({
      ...selection,
      source,
      sectionId,
      anchor: selectionAnchor(node, selection),
    })
    setProsodyCopiedWord(null)
  }, [])

  const capturePadSelection = React.useCallback((
    source: SelectionSource,
    node: HTMLTextAreaElement | null,
  ) => {
    if (!node) return
    const value = node.value.slice(node.selectionStart, node.selectionEnd)
    setSelectionSource(source)
    setSelectedText(value)
    captureProsodySelection(source, node)
  }, [captureProsodySelection])

  const captureSectionProsodySelection = React.useCallback((
    sectionId: string,
    node: HTMLTextAreaElement,
  ) => {
    captureProsodySelection('section', node, sectionId)
  }, [captureProsodySelection])

  const clearMovedText = React.useCallback((text: string) => {
    if (selectionSource === 'rough') {
      setRoughText((current) => removeSelectedText(current, text))
    } else {
      setRememberText((current) => removeSelectedText(current, text))
    }
    setSelectedText('')
  }, [selectionSource])

  const sendSelectionToSection = React.useCallback((sectionId: string, shouldDuplicate = false) => {
    const text = selectedText.trim()
    if (!text) return
    setSections((current) => current.map((section) => (
      section.id === sectionId ? { ...section, text: appendText(section.text, text) } : section
    )))
    if (!shouldDuplicate) clearMovedText(selectedText)
  }, [clearMovedText, selectedText])

  const sendSelectionToRemember = React.useCallback((shouldDuplicate = false) => {
    const text = selectedText.trim()
    if (!text) return
    setRememberText((current) => appendText(current, text))
    if (!shouldDuplicate) clearMovedText(selectedText)
  }, [clearMovedText, selectedText])

  const updateSection = React.useCallback((sectionId: string, text: string) => {
    setSections((current) => current.map((section) => (
      section.id === sectionId ? { ...section, text } : section
    )))
  }, [])

  const deleteSection = React.useCallback((sectionId: string) => {
    setSections((current) => current.filter((section) => section.id !== sectionId))
  }, [])

  const addCustomSection = React.useCallback(() => {
    setSections((current) => [
      ...current,
      { id: `section-${Date.now()}`, label: 'New Section', text: '', optional: true },
    ])
    setShowEmptySections(true)
  }, [])

  const buildPayload = React.useCallback((section: SongSection, action: LyricAgentAction, route: LabWorkerRouteResult): LyricAgentPayload => buildLyricAgentPayload({
    action,
    actionLabel: actionLabel(action),
    routeRole: route.role,
    requestedRoles: route.requestedRoles,
    artistProfile,
    workspaceId,
    roughText,
    rememberText,
    sections,
    targetSection: section,
    title,
  }), [artistProfile, rememberText, roughText, sections, title, workspaceId])

  const runResolvedWorker = React.useCallback(async (section: SongSection, action: LyricAgentAction, route: LabWorkerRouteResult, candidate: LabWorkerCandidate) => {
    if (!workspaceId) {
      setAgentError('No Lab workspace is active.')
      return
    }
    const runId = activeWorkerRunIdRef.current + 1
    activeWorkerRunIdRef.current = runId
    const payload = buildPayload(section, action, route)
    setActiveAgentSectionId(section.id)
    setAgentOutput('')
    setAgentError('')
    setWorkerRoute(route)
    setAgentBusy(true)
    try {
      const result = await runSavedLabWorker(workspaceId, candidate.agent, payload, activeAgents)
      if (activeWorkerRunIdRef.current !== runId) return
      setAgentOutput(result)
    } catch (err) {
      if (activeWorkerRunIdRef.current !== runId) return
      setAgentError(err instanceof Error ? err.message : String(err))
    } finally {
      if (activeWorkerRunIdRef.current === runId) {
        setAgentBusy(false)
      }
    }
  }, [activeAgents, buildPayload, workspaceId])

  const runLyricAgent = React.useCallback(async (section: SongSection, action: LyricAgentAction) => {
    activeWorkerRunIdRef.current += 1
    if (agentsLoading) {
      setActiveAgentSectionId(section.id)
      setAgentOutput('')
      setWorkerRoute(null)
      setPendingWorkerRun(null)
      setAgentError('Lab workers are still loading.')
      return
    }
    const roleRequest = routeRequestForAction(section, action)
    const route = resolveLabWorkerRoute(activeAgents, {
      ...roleRequest,
      sectionId: section.id,
      sectionLabel: section.label,
    })
    setActiveAgentSectionId(section.id)
    setAgentOutput('')
    setAgentError(route.emptyReason ?? '')
    setWorkerRoute(route)
    setPendingWorkerRun(null)

    if (route.candidates.length === 0) return
    if (route.candidates.length > 1) {
      setPendingWorkerRun({ section, action })
      return
    }
    await runResolvedWorker(section, action, route, route.candidates[0])
  }, [activeAgents, agentsLoading, runResolvedWorker])

  const insertAgentOutput = React.useCallback((sectionId: string) => {
    if (!agentOutput.trim()) return
    setSections((current) => current.map((section) => (
      section.id === sectionId ? { ...section, text: appendText(section.text, agentOutput) } : section
    )))
  }, [agentOutput])

  const replaceWithAgentOutput = React.useCallback((sectionId: string) => {
    if (!agentOutput.trim()) return
    updateSection(sectionId, agentOutput)
  }, [agentOutput, updateSection])

  const sendAgentOutputToRemember = React.useCallback(() => {
    if (!agentOutput.trim()) return
    setRememberText((current) => appendText(current, agentOutput))
  }, [agentOutput])

  const chooseWorker = React.useCallback(async (candidate: LabWorkerCandidate) => {
    if (!pendingWorkerRun || !workerRoute) return
    setPendingWorkerRun(null)
    await runResolvedWorker(pendingWorkerRun.section, pendingWorkerRun.action, workerRoute, candidate)
  }, [pendingWorkerRun, runResolvedWorker, workerRoute])

  React.useEffect(() => {
    if (!prosodySelection) {
      prosodyLookupRunIdRef.current += 1
      setProsodyBusy(false)
      setProsodyResult(null)
      setProsodyCopiedWord(null)
      return
    }

    const runId = prosodyLookupRunIdRef.current + 1
    prosodyLookupRunIdRef.current = runId
    setProsodyBusy(true)
    setProsodyResult(null)
    setProsodyCopiedWord(null)

    const timer = window.setTimeout(async () => {
      try {
        const result = await window.electronAPI.lookupProsodyRhymes({
          selection: prosodySelection.selectedText,
          line: prosodySelection.line,
        })
        if (prosodyLookupRunIdRef.current !== runId) return
        setProsodyResult(result.ok && result.inDictionary ? result : null)
      } catch {
        if (prosodyLookupRunIdRef.current !== runId) return
        setProsodyResult(null)
      } finally {
        if (prosodyLookupRunIdRef.current === runId) setProsodyBusy(false)
      }
    }, 150)

    return () => {
      window.clearTimeout(timer)
    }
  }, [prosodySelection])

  const copyProsodyRhyme = React.useCallback(async (item: ProsodyRhymeItem) => {
    try {
      await navigator.clipboard?.writeText(item.word)
      setProsodyCopiedWord(item.word)
    } catch {
      setProsodyCopiedWord(null)
    }
  }, [])

  const visibleSections = showEmptySections
    ? sections
    : sections.filter((section) => section.text.trim())
  const selectedCount = selectedText.trim().split(/\s+/).filter(Boolean).length
  const prosodyPosition = prosodySelection ? prosodyPopoverPosition(prosodySelection.anchor) : null
  const hasProsodyMatches = Boolean((prosodyResult?.perfect.length ?? 0) + (prosodyResult?.slant.length ?? 0))

  return (
    <div className="runneros-glass-route flex h-full min-h-0 flex-col overflow-hidden bg-[#050505] text-white">
      {prosodySelection && prosodyPosition && (prosodyBusy || prosodyResult) ? (
        <div
          className="fixed z-[90] w-[300px] rounded-xl border border-white/[0.16] bg-[#242424]/96 p-2.5 text-white shadow-strong backdrop-blur-xl"
          style={{ left: prosodyPosition.left, top: prosodyPosition.top }}
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="min-w-0 truncate text-[9px] font-semibold uppercase tracking-[0.14em] text-white/52">
              Forward rhymes · {prosodySelection.selectedText.trim()}
            </div>
            <button
              type="button"
              onClick={() => setProsodySelection(null)}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-white/42 hover:bg-white/[0.08] hover:text-white/76"
              title="Close rhymes"
            >
              <X className="h-3 w-3" />
            </button>
          </div>

          {prosodyBusy ? (
            <div className="rounded-lg border border-white/[0.1] bg-white/[0.055] px-2.5 py-2 text-[11px] font-medium text-white/58">
              Finding rhymes...
            </div>
          ) : null}

          {!prosodyBusy && prosodyResult && !hasProsodyMatches ? (
            <div className="rounded-lg border border-white/[0.1] bg-white/[0.055] px-2.5 py-2 text-[11px] font-medium text-white/54">
              No clean matches.
            </div>
          ) : null}

          {!prosodyBusy && prosodyResult?.perfect.length ? (
            <div className="mb-2">
              <div className="mb-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-white/48">Perfect</div>
              <div className="flex flex-wrap gap-1.5">
                {prosodyResult.perfect.slice(0, 10).map((item) => (
                  <button
                    key={`perfect-${item.word}`}
                    type="button"
                    title="Copy rhyme"
                    onClick={() => copyProsodyRhyme(item)}
                    className="rounded-full border border-white/[0.14] bg-[#303030] px-2.5 py-1 text-[11px] font-medium text-white/78 hover:bg-[#393939] hover:text-white"
                  >
                    {prosodyCopiedWord === item.word ? 'Copied' : item.word}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {!prosodyBusy && prosodyResult?.slant.length ? (
            <div>
              <div className="mb-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-white/48">Slant</div>
              <div className="flex flex-wrap gap-1.5">
                {prosodyResult.slant.slice(0, 12).map((item) => (
                  <button
                    key={`slant-${item.word}-${item.kind}`}
                    type="button"
                    title={item.kind}
                    onClick={() => copyProsodyRhyme(item)}
                    className="inline-flex items-center gap-1 rounded-full border border-[#fb923c]/35 bg-[#3a281a] px-2.5 py-1 text-[11px] font-medium text-[#ffe0b0]/88 hover:bg-[#4a311d] hover:text-[#fff0d2]"
                  >
                    <span>{prosodyCopiedWord === item.word ? 'Copied' : item.word}</span>
                    <span className="text-[8px] uppercase tracking-[0.1em] text-[#fbbf24]/62">{item.kind}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="shrink-0 border-b border-white/[0.04] px-6 py-3">
        <div className="flex w-full items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="mb-1.5 flex items-center gap-2 text-[9px] font-medium uppercase tracking-[0.18em] text-white/38">
              <FlaskConical className="h-3.5 w-3.5" />
              Song Pad
            </div>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="w-full border-0 bg-transparent text-xl font-semibold tracking-normal text-white/92 outline-none placeholder:text-white/25"
              placeholder="Untitled song"
            />
          </div>
          <div className="flex shrink-0 items-center gap-2 rounded-xl border border-white/[0.05] bg-white/[0.025] px-3 py-2 text-xs text-white/45">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: projectColor }} />
            <Music2 className="h-3.5 w-3.5" />
            <input
              value={project}
              onChange={(event) => setProject(event.target.value)}
              className="w-28 border-0 bg-transparent text-xs text-white/55 outline-none"
              placeholder={workspaceName || 'Project'}
            />
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
        <div className="grid w-full gap-4 xl:grid-cols-[minmax(0,1.08fr)_minmax(460px,0.92fr)]">
          <section className="flex min-h-[calc(100vh-176px)] flex-col rounded-xl border border-white/[0.05] bg-[#080808] shadow-minimal">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/[0.04] px-4 py-2.5">
              <div className="flex min-w-0 items-center gap-2">
                <div className="flex shrink-0 items-center gap-2 text-[9px] font-medium uppercase tracking-[0.15em] text-white/55">
                  <Sparkles className="h-3 w-3 text-white/35" />
                  Rough Pad
                </div>
                <div
                  title="Highlight text and click to send to song section."
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-white/[0.06] bg-white/[0.025] text-white/34"
                >
                  <Info className="h-3 w-3" />
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {SECTION_BUTTONS.map((section) => (
                  <button
                    key={section.id}
                    type="button"
                    title={section.title}
                    disabled={!selectedText.trim()}
                    onClick={() => sendSelectionToSection(section.id)}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/[0.06] bg-white/[0.025] text-[10px] font-semibold text-white/55 hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    {section.label}
                  </button>
                ))}
                <button
                  type="button"
                  title="Send to Remember This"
                  disabled={!selectedText.trim()}
                  onClick={() => sendSelectionToRemember()}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[#fb923c]/35 bg-[#fb923c]/10 text-[10px] font-semibold text-[#fbbf24] hover:bg-[#fb923c]/15 disabled:cursor-not-allowed disabled:opacity-35"
                >
                  R
                </button>
                <button
                  type="button"
                  title="Copy to Chorus"
                  disabled={!selectedText.trim()}
                  onClick={() => sendSelectionToSection('chorus', true)}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/[0.06] bg-white/[0.025] text-white/45 hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-35"
                >
                  <Copy className="h-3 w-3" />
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 p-4">
              <textarea
                ref={roughRef}
                value={roughText}
                onChange={(event) => setRoughText(event.target.value)}
                onSelect={(event) => capturePadSelection('rough', event.currentTarget)}
                onKeyUp={(event) => capturePadSelection('rough', event.currentTarget)}
                onMouseUp={(event) => capturePadSelection('rough', event.currentTarget)}
                placeholder="Dump lines, images, hooks, bad drafts, voice notes transcribed into words..."
                className={textareaBase('min-h-[560px]')}
              />

              <div className="my-5 flex items-center gap-3">
                <div className="h-px flex-1 bg-white/[0.07]" />
                <div className="rounded-full border border-white/[0.07] bg-white/[0.025] px-3 py-1 text-[9px] font-medium uppercase tracking-[0.16em] text-white/34">
                  Remember This
                </div>
                <div className="h-px flex-1 bg-white/[0.07]" />
              </div>

              <textarea
                ref={rememberRef}
                value={rememberText}
                onChange={(event) => setRememberText(event.target.value)}
                onSelect={(event) => capturePadSelection('remember', event.currentTarget)}
                onKeyUp={(event) => capturePadSelection('remember', event.currentTarget)}
                onMouseUp={(event) => capturePadSelection('remember', event.currentTarget)}
                placeholder="Park strong lines, title ideas, images, references, or alternate bars here."
                className={textareaBase('min-h-[170px] text-white/66')}
              />
            </div>

            <div className="flex shrink-0 items-center justify-between border-t border-white/[0.04] px-4 py-3 text-[11px] text-white/34">
              <span>{selectedText.trim() ? `${selectedCount} selected word${selectedCount === 1 ? '' : 's'} from ${selectionSource}` : 'Select a line or phrase to move it.'}</span>
              <span>Move organizes. It never locks.</span>
            </div>
          </section>

          <section className="flex min-h-[calc(100vh-176px)] flex-col rounded-xl border border-white/[0.05] bg-[#080808] shadow-minimal">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/[0.04] px-4 py-2.5">
              <div className="flex min-w-0 items-center gap-2">
                <div className="flex items-center gap-2 text-[9px] font-medium uppercase tracking-[0.15em] text-white/55">
                  <Layers className="h-3 w-3 text-white/35" />
                  Song Structure
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  title={showEmptySections ? 'Hide empty sections' : 'Show empty sections'}
                  onClick={() => setShowEmptySections((current) => !current)}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/[0.06] bg-white/[0.025] text-white/45 hover:bg-white/[0.05]"
                >
                  {showEmptySections ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                </button>
                <button
                  type="button"
                  title="Add section"
                  onClick={addCustomSection}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[#fb923c]/35 bg-[#fb923c]/10 text-[#fbbf24] hover:bg-[#fb923c]/15"
                >
                  <Plus className="h-3 w-3" />
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto px-4 py-2">
              {visibleSections.map((section) => (
                <article
                  key={section.id}
                  className={cn(
                    'border-b border-white/[0.045] py-3 last:border-b-0',
                    !section.text.trim() && 'opacity-55',
                  )}
                >
                  <div className="mb-1.5 flex items-center justify-between gap-3">
                    <div />
                    <div className="flex shrink-0 items-center gap-1.5">
                      <input
                        value={section.label}
                        onChange={(event) => {
                          const label = event.target.value
                          setSections((current) => current.map((item) => (
                            item.id === section.id ? { ...item, label } : item
                          )))
                        }}
                        className="w-20 border-0 bg-transparent text-right text-[10px] font-medium uppercase tracking-[0.12em] text-white/34 outline-none focus:text-white/62"
                      />
                      <Popover
                        open={activeAgentSectionId === section.id}
                        onOpenChange={(open) => {
                          setActiveAgentSectionId(open ? section.id : null)
                          if (!open) {
                            setAgentOutput('')
                            setAgentError('')
                            setAgentBusy(false)
                            setWorkerRoute(null)
                            setPendingWorkerRun(null)
                            activeWorkerRunIdRef.current += 1
                          }
                        }}
                      >
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            title="Lyric agent"
                            className="flex h-5 w-5 items-center justify-center rounded-full text-white/18 transition-colors hover:bg-white/[0.045] hover:text-[#fbbf24]/70"
                          >
                            <Sparkles className="h-3 w-3" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent
                          align="end"
                          side="left"
                          className="w-[300px] border border-white/[0.08] bg-[#080808] p-3 text-white shadow-modal-small"
                        >
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <div className="text-[9px] font-medium uppercase tracking-[0.16em] text-white/42">
                              Lab Worker · {section.label}
                            </div>
                            <div className="text-[9px] text-white/24">HQ + full song</div>
                          </div>
                          <div className="grid grid-cols-2 gap-1.5">
                            {LYRIC_AGENT_ACTIONS.map((action) => (
                              <button
                                key={action.id}
                                type="button"
                                onClick={() => runLyricAgent(section, action.id)}
                                disabled={agentBusy}
                                className="rounded-lg border border-white/[0.06] bg-white/[0.025] px-2 py-1.5 text-left text-[11px] text-white/58 hover:bg-white/[0.05] hover:text-white/78 disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                {action.label}
                              </button>
                            ))}
                          </div>
                          {agentBusy ? (
                            <div className="mt-3 rounded-lg border border-white/[0.055] bg-white/[0.018] p-2 text-xs text-white/42">
                              Lab worker is thinking...
                            </div>
                          ) : null}
                          {workerRoute && pendingWorkerRun && workerRoute.candidates.length > 1 ? (
                            <div className="mt-3 rounded-lg border border-white/[0.055] bg-white/[0.018] p-2">
                              <div className="mb-2 text-[9px] font-medium uppercase tracking-[0.14em] text-white/34">
                                Choose worker
                              </div>
                              <div className="space-y-1.5">
                                {workerRoute.candidates.map((candidate) => (
                                  <button
                                    key={candidate.agent.slug}
                                    type="button"
                                    onClick={() => chooseWorker(candidate)}
                                    className="w-full rounded-lg border border-white/[0.055] bg-white/[0.018] px-2 py-2 text-left hover:bg-white/[0.045]"
                                  >
                                    <span className="flex items-center justify-between gap-2">
                                      <span className="truncate text-xs font-medium text-white/72">{candidate.agent.metadata.name}</span>
                                      {candidate.recommended ? <span className="text-[9px] uppercase tracking-[0.12em] text-[#fbbf24]/70">Recommended</span> : null}
                                    </span>
                                    <span className="mt-1 block text-[10px] leading-4 text-white/36">{candidate.reason}</span>
                                  </button>
                                ))}
                              </div>
                            </div>
                          ) : null}
                          {agentError ? (
                            <div className="mt-3 rounded-lg border border-red-500/20 bg-red-500/10 p-2 text-xs leading-5 text-red-100/72">
                              {agentError}
                            </div>
                          ) : null}
                          {agentOutput ? (
                            <div className="mt-3">
                              <div className="max-h-[180px] overflow-auto whitespace-pre-wrap rounded-lg border border-white/[0.055] bg-white/[0.018] p-2 text-xs leading-5 text-white/70">
                                {agentOutput}
                              </div>
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                <button type="button" onClick={() => insertAgentOutput(section.id)} className="rounded-full border border-white/[0.07] px-2.5 py-1 text-[10px] text-white/55 hover:bg-white/[0.05]">Insert</button>
                                <button type="button" onClick={() => replaceWithAgentOutput(section.id)} className="rounded-full border border-white/[0.07] px-2.5 py-1 text-[10px] text-white/55 hover:bg-white/[0.05]">Replace</button>
                                <button type="button" onClick={sendAgentOutputToRemember} className="rounded-full border border-white/[0.07] px-2.5 py-1 text-[10px] text-white/55 hover:bg-white/[0.05]">Remember</button>
                              </div>
                            </div>
                          ) : null}
                        </PopoverContent>
                      </Popover>
                      <button
                        type="button"
                        title="Delete section"
                        onClick={() => deleteSection(section.id)}
                        className="flex h-5 w-5 items-center justify-center rounded-full text-white/16 transition-colors hover:bg-white/[0.045] hover:text-white/50"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                  <textarea
                    value={section.text}
                    rows={sectionRows(section.text)}
                    onChange={(event) => updateSection(section.id, event.target.value)}
                    onSelect={(event) => captureSectionProsodySelection(section.id, event.currentTarget)}
                    onKeyUp={(event) => captureSectionProsodySelection(section.id, event.currentTarget)}
                    onMouseUp={(event) => captureSectionProsodySelection(section.id, event.currentTarget)}
                    placeholder={section.optional ? 'Optional' : 'Write lyrics here.'}
                    className={textareaBase('overflow-hidden text-white/76 placeholder:text-white/14')}
                  />
                </article>
              ))}
              {!visibleSections.length ? (
                <div className="rounded-xl border border-dashed border-white/[0.08] bg-white/[0.015] p-8 text-center text-sm text-white/35">
                  Empty sections are hidden. Show empty sections or move a line from the rough pad.
                </div>
              ) : null}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
