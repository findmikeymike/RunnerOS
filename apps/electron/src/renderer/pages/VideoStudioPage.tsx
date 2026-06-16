import * as React from 'react'
import { AlertTriangle, Bot, ChevronDown, ClipboardCheck, Code2, Copy, Download, Eye, EyeOff, FileVideo, FolderOpen, History, Layers, Link, Loader2, Lock, Magnet, MoreHorizontal, Pause, Play, Plus, Redo2, RefreshCw, Save, Scissors, Send, ShieldCheck, SlidersHorizontal, Trash2, Type, Undo2, Unlock, Upload, Volume2, VolumeX, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuTrigger, StyledDropdownMenuContent, StyledDropdownMenuItem, StyledDropdownMenuSeparator } from '@/components/ui/styled-dropdown'
import { useOutputs, type OutputAssetDTO, type OutputManifestDTO } from '@/hooks/useOutputs'
import { findVideoProjectAsset, formatDuration, summarizeVideoProject } from '@/components/outputs/video-project-output'
import type { RunnerVideoProject, VideoAspectRatio, VideoClip } from '@craft-agent/shared/video'

interface Props {
  workspaceId: string
  outputId: string
}

type VideoProject = RunnerVideoProject

const ASPECT_PRESETS: Array<{ value: Exclude<VideoAspectRatio, 'custom'>; label: string; width: number; height: number }> = [
  { value: '9:16', label: 'Vertical 9:16', width: 1080, height: 1920 },
  { value: '16:9', label: 'Landscape 16:9', width: 1920, height: 1080 },
  { value: '1:1', label: 'Square 1:1', width: 1080, height: 1080 },
  { value: '4:5', label: 'Portrait 4:5', width: 1080, height: 1350 },
]

type AspectSelectValue = VideoAspectRatio
type LookPreset = 'neutral' | 'clean' | 'cinematic' | 'warm' | 'punchy' | 'black-and-white'

const LOOK_PRESETS: Array<{ value: LookPreset; label: string; adjustments: NonNullable<VideoClip['adjustments']> }> = [
  { value: 'neutral', label: 'Neutral', adjustments: {} },
  { value: 'clean', label: 'Clean', adjustments: { exposure: 0.03, contrast: 1.05, saturation: 1.04, grain: 0, preset: 'clean' } },
  { value: 'cinematic', label: 'Cinematic', adjustments: { exposure: -0.03, contrast: 1.18, saturation: 0.92, highlights: -0.12, shadows: 0.08, grain: 0.12, preset: 'cinematic' } },
  { value: 'warm', label: 'Warm', adjustments: { exposure: 0.02, contrast: 1.05, saturation: 1.08, temperature: 0.18, grain: 0.04, preset: 'warm' } },
  { value: 'punchy', label: 'Punchy', adjustments: { exposure: 0.04, contrast: 1.25, saturation: 1.22, highlights: -0.05, shadows: -0.04, grain: 0.02, preset: 'punchy' } },
  { value: 'black-and-white', label: 'B&W', adjustments: { exposure: 0, contrast: 1.16, saturation: 0, grain: 0.1, preset: 'black-and-white' } },
]

const MIN_CLIP_DURATION_MS = 100

type TimelineDragMode = 'move' | 'trim-start' | 'trim-end'

interface TimelineDragState {
  clipId: string
  mode: TimelineDragMode
  startX: number
  currentX: number
  currentY: number
  sourceTrackId: string
  initialStartMs: number
  initialDurationMs: number
  initialSourceInMs: number
  lastProposedStartMs: number
  active: boolean
}

interface ClipContextMenuState {
  clipId: string
  x: number
  y: number
}

type VideoStudioElectronAPI = typeof window.electronAPI & {
  writeOutputAssetText?: (workspaceId: string, outputId: string, assetId: string, content: string) => Promise<boolean>
  importVideoStudioMedia?: (workspaceId: string, outputId: string, options?: { mode?: 'files' | 'folder' }) => Promise<{ imported: Array<{ label: string }>; skipped?: number }>
  inspectVideoStudio?: (workspaceId: string, outputId: string) => Promise<{ ok: boolean; assetId: string; status: number }>
  dryRunVideoStudio?: (workspaceId: string, outputId: string) => Promise<{ ok: boolean; assetId: string; status: number }>
  exportVideoStudio?: (workspaceId: string, outputId: string, preset?: string) => Promise<{ assetId: string }>
  runVideoStudioAgent?: (workspaceId: string, outputId: string, prompt: string) => Promise<{ ok: boolean; status: string; message?: string }>
}

export default function VideoStudioPage({ workspaceId, outputId }: Props) {
  const { getOutput } = useOutputs(workspaceId)
  const [manifest, setManifest] = React.useState<OutputManifestDTO | null>(null)
  const [projectAsset, setProjectAsset] = React.useState<OutputAssetDTO | null>(null)
  const [project, setProject] = React.useState<VideoProject | null>(null)
  const [rawJson, setRawJson] = React.useState('')
  const [selectedClipId, setSelectedClipId] = React.useState<string | null>(null)
  const [renderPreviewUrl, setRenderPreviewUrl] = React.useState<string | null>(null)
  const [clipPreviewUrl, setClipPreviewUrl] = React.useState<string | null>(null)
  const [playheadMs, setPlayheadMs] = React.useState(0)
  const [isPreviewPlaying, setIsPreviewPlaying] = React.useState(false)
  const [timelineZoom, setTimelineZoom] = React.useState(1)
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [importing, setImporting] = React.useState(false)
  const [checking, setChecking] = React.useState<'inspect' | 'dry-run' | null>(null)
  const [exporting, setExporting] = React.useState(false)
  const [timelineDrag, setTimelineDrag] = React.useState<TimelineDragState | null>(null)
  const [rippleEdits, setRippleEdits] = React.useState(false)
  const [clipContextMenu, setClipContextMenu] = React.useState<ClipContextMenuState | null>(null)
  const [undoStack, setUndoStack] = React.useState<VideoProject[]>([])
  const [redoStack, setRedoStack] = React.useState<VideoProject[]>([])
  const [externalReloadPending, setExternalReloadPending] = React.useState(false)
  const [showDeveloperDetails, setShowDeveloperDetails] = React.useState(false)
  const [agentPanelOpen, setAgentPanelOpen] = React.useState(false)
  const [agentPrompt, setAgentPrompt] = React.useState('')
  const [agentRunning, setAgentRunning] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const previewVideoRef = React.useRef<HTMLVideoElement | null>(null)
  const timelineScrubRef = React.useRef<HTMLDivElement | null>(null)
  const selectedClipRef = React.useRef<VideoClip | null>(null)
  const clipPreviewActiveRef = React.useRef(false)
  const hasLocalEditsRef = React.useRef(false)
  const timelineDragRef = React.useRef<TimelineDragState | null>(null)
  const timelineDurationMs = project?.timeline?.durationMs ?? 0

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const loaded = await getOutput(outputId)
      if (!loaded) throw new Error('Output not found.')
      const asset = findVideoProjectAsset(loaded)
      if (!asset) throw new Error('This output does not include a Video Studio project file.')
      const text = await window.electronAPI.readOutputAssetText(workspaceId, outputId, asset.id)
      const parsed = JSON.parse(text) as VideoProject
      setManifest(loaded)
      setProjectAsset(asset)
      setProject(parsed)
      setRawJson(JSON.stringify(parsed, null, 2))
      setUndoStack([])
      setRedoStack([])
      setExternalReloadPending(false)
      const latestRender = findLatestVideoRenderAsset(loaded)
      if (latestRender) {
        const url = await window.electronAPI.readOutputAssetDataUrl(workspaceId, outputId, latestRender.id)
        setRenderPreviewUrl(url)
      } else {
        setRenderPreviewUrl(null)
      }
      const firstClip = parsed.timeline?.tracks?.flatMap((track) => track.clips ?? [])[0]
      setSelectedClipId(firstClip?.id ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [getOutput, outputId, workspaceId])

  React.useEffect(() => {
    void load()
  }, [load])

  React.useEffect(() => {
    const cleanup = window.electronAPI.onOutputsUpdated?.((changedWorkspaceId) => {
      if (changedWorkspaceId !== workspaceId) return
      if (hasLocalEditsRef.current || timelineDragRef.current) {
        setExternalReloadPending(true)
        toast.info('Video project changed outside the editor. Save or reload when ready.')
        return
      }
      void load()
    })
    return cleanup
  }, [load, workspaceId])

  React.useEffect(() => {
    hasLocalEditsRef.current = undoStack.length > 0 || redoStack.length > 0
  }, [redoStack.length, undoStack.length])

  React.useEffect(() => {
    timelineDragRef.current = timelineDrag
  }, [timelineDrag])

  React.useEffect(() => {
    if (!clipContextMenu) return
    const close = () => setClipContextMenu(null)
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [clipContextMenu])

  React.useEffect(() => {
    setPlayheadMs((current) => clampNumber(current, 0, timelineDurationMs))
  }, [timelineDurationMs])

  const setPlayheadPosition = React.useCallback((nextMs: number, seekPreview = false) => {
    const clamped = clampNumber(Number.isFinite(nextMs) ? nextMs : 0, 0, timelineDurationMs)
    setPlayheadMs(Math.round(clamped))
    if (seekPreview && previewVideoRef.current) {
      const selected = selectedClipRef.current
      const previewMs = clipPreviewActiveRef.current && selected
        ? clampNumber(clamped - (selected.startMs ?? 0) + (selected.sourceInMs ?? 0), 0, selected.durationMs ?? timelineDurationMs)
        : clamped
      previewVideoRef.current.currentTime = previewMs / 1000
    }
  }, [timelineDurationMs])

  const updatePlayheadFromPointer = React.useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (!timelineScrubRef.current) return
    const rect = timelineScrubRef.current.getBoundingClientRect()
    const x = event.clientX - rect.left + timelineScrubRef.current.scrollLeft - 12
    setPlayheadPosition(timelineMsFromPixels(x, timelineZoom), true)
  }, [setPlayheadPosition, timelineZoom])

  const updatePlayheadFromPreviewTime = React.useCallback((videoTimeMs: number) => {
    const selected = selectedClipRef.current
    const timelineMs = clipPreviewActiveRef.current && selected
      ? (selected.startMs ?? 0) + Math.max(0, videoTimeMs - (selected.sourceInMs ?? 0))
      : videoTimeMs
    setPlayheadMs(Math.round(clampNumber(timelineMs, 0, timelineDurationMs)))
  }, [timelineDurationMs])

  const togglePreviewPlayback = React.useCallback(() => {
    const video = previewVideoRef.current
    if (!video) return
    if (video.paused) {
      void video.play()
    } else {
      video.pause()
    }
  }, [])

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return
      const target = event.target
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable)) return
      event.preventDefault()
      togglePreviewPlayback()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [togglePreviewPlayback])

  const selectedClip = React.useMemo(() => {
    if (!project || !selectedClipId) return null
    for (const track of project.timeline?.tracks ?? []) {
      const clip = track.clips?.find((item) => item.id === selectedClipId)
      if (clip) return clip
    }
    return null
  }, [project, selectedClipId])

  const selectedClipMedia = React.useMemo(() => {
    if (!project || !selectedClip?.mediaId) return null
    return (project.media ?? []).find((item) => item.id === selectedClip.mediaId) ?? null
  }, [project, selectedClip?.mediaId])

  React.useEffect(() => {
    selectedClipRef.current = selectedClip
  }, [selectedClip])

  React.useEffect(() => {
    let cancelled = false
    async function loadSelectedClipPreview() {
      setClipPreviewUrl(null)
      if (!manifest || !selectedClipMedia || !selectedClip?.mediaId) return
      if (selectedClipMedia.type !== 'video') return
      const mediaAsset = manifest.assets.find((asset) => asset.id === `video-media-${selectedClip.mediaId}`)
      if (!mediaAsset) return
      try {
        const url = await window.electronAPI.readOutputAssetDataUrl(workspaceId, outputId, mediaAsset.id)
        if (!cancelled) setClipPreviewUrl(url)
      } catch {
        if (!cancelled) setClipPreviewUrl(null)
      }
    }
    void loadSelectedClipPreview()
    return () => {
      cancelled = true
    }
  }, [manifest, outputId, selectedClip?.mediaId, selectedClipMedia, workspaceId])

  const selectedClipSupportsLook = selectedClipMedia?.type === 'video' || selectedClipMedia?.type === 'image'
  const selectedLookValue = selectedClip?.adjustments ? selectedClip.adjustments.preset ?? 'manual' : 'neutral'
  const previewLook = selectedClipSupportsLook ? previewLookStyle(selectedClip?.adjustments) : null
  const previewUrl = clipPreviewUrl ?? renderPreviewUrl
  const previewStatus = clipPreviewUrl ? 'selected clip' : renderPreviewUrl ? 'latest export' : 'not rendered'

  React.useEffect(() => {
    clipPreviewActiveRef.current = Boolean(clipPreviewUrl)
  }, [clipPreviewUrl])

  const updateProject = React.useCallback((updater: (current: VideoProject) => VideoProject, options: { recordHistory?: boolean } = {}) => {
    setProject((current) => {
      if (!current) return current
      const next = updater(current)
      if (next === current) return current
      if (options.recordHistory !== false) {
        setUndoStack((items) => [...items.slice(-49), current])
        setRedoStack([])
      }
      setRawJson(JSON.stringify(next, null, 2))
      return next
    })
  }, [])

  const restoreProject = React.useCallback((next: VideoProject) => {
    setProject(next)
    setRawJson(JSON.stringify(next, null, 2))
    const clipStillExists = selectedClipId && next.timeline?.tracks?.some((track) => track.clips?.some((clip) => clip.id === selectedClipId))
    if (!clipStillExists) {
      const firstClip = next.timeline?.tracks?.flatMap((track) => track.clips ?? [])[0]
      setSelectedClipId(firstClip?.id ?? null)
    }
  }, [selectedClipId])

  const undo = React.useCallback(() => {
    if (!project || undoStack.length === 0) return
    const previous = undoStack[undoStack.length - 1]
    if (!previous) return
    setUndoStack((items) => items.slice(0, -1))
    setRedoStack((items) => [...items.slice(-49), project])
    restoreProject(previous)
  }, [project, restoreProject, undoStack])

  const redo = React.useCallback(() => {
    if (!project || redoStack.length === 0) return
    const next = redoStack[redoStack.length - 1]
    if (!next) return
    setRedoStack((items) => items.slice(0, -1))
    setUndoStack((items) => [...items.slice(-49), project])
    restoreProject(next)
  }, [project, redoStack, restoreProject])

  const selectedClipTrack = React.useMemo(() => findTrackForClip(project, selectedClipId), [project, selectedClipId])
  const selectedClipLocked = selectedClipTrack?.locked === true

  const canEditClip = React.useCallback((clipId: string | null | undefined) => {
    if (!clipId) return false
    return findTrackForClip(project, clipId)?.locked !== true
  }, [project])

  const updateSelectedClip = React.useCallback((patch: Partial<VideoClip>) => {
    if (!selectedClipId) return
    if (!canEditClip(selectedClipId)) {
      toast.error('Unlock the track before editing this clip.')
      return
    }
    updateProject((current) => {
      const tracks = (current.timeline?.tracks ?? []).map((track) => ({
        ...track,
        clips: (track.clips ?? []).map((clip) => clip.id === selectedClipId ? { ...clip, ...patch } : clip),
      }))
      const durationMs = computeTimelineDuration(tracks)
      return {
        ...current,
        timeline: {
          ...current.timeline,
          durationMs,
          tracks,
        },
      }
    })
  }, [canEditClip, selectedClipId, updateProject])

  const moveClip = React.useCallback((clipId: string, startMs: number, snap = true, recordHistory = true) => {
    updateProject((current) => moveClipInProject(current, clipId, startMs, snap), { recordHistory })
  }, [updateProject])

  React.useEffect(() => {
    if (!timelineDrag) return

    const handlePointerMove = (event: PointerEvent) => {
      const deltaX = event.clientX - timelineDrag.startX
      if (!timelineDrag.active && Math.abs(deltaX) < 4) return
      if (!timelineDrag.active) {
        setProject((current) => {
          if (current) {
            setUndoStack((items) => [...items.slice(-49), current])
            setRedoStack([])
          }
          return current
        })
        setTimelineDrag((current) => current ? { ...current, active: true } : current)
      }
      const deltaMs = Math.round(deltaX * (12 / timelineZoom))
      if (timelineDrag.mode === 'move') {
        const nextStartMs = timelineDrag.initialStartMs + deltaMs
        moveClip(timelineDrag.clipId, nextStartMs, true, false)
        setTimelineDrag((current) => current ? { ...current, currentX: event.clientX, currentY: event.clientY, lastProposedStartMs: Math.max(0, nextStartMs) } : current)
      } else if (timelineDrag.mode === 'trim-start') {
        updateProject((current) => trimClipStartInProject(current, timelineDrag.clipId, {
          startMs: timelineDrag.initialStartMs + deltaMs,
          initialStartMs: timelineDrag.initialStartMs,
          initialDurationMs: timelineDrag.initialDurationMs,
          initialSourceInMs: timelineDrag.initialSourceInMs,
        }), { recordHistory: false })
      } else {
        updateProject((current) => trimClipEndInProject(current, timelineDrag.clipId, timelineDrag.initialDurationMs + deltaMs, rippleEdits), { recordHistory: false })
      }
    }
    const handlePointerUp = (event: PointerEvent) => {
      if (timelineDrag.mode === 'move' && timelineDrag.active) {
        const target = document.elementFromPoint(event.clientX, event.clientY)
        const targetTrackId = target instanceof HTMLElement ? target.closest<HTMLElement>('[data-video-track-id]')?.dataset.videoTrackId : undefined
        if (targetTrackId && targetTrackId !== timelineDrag.sourceTrackId) {
          updateProject((current) => moveClipToTrackInProject(current, timelineDrag.clipId, targetTrackId, timelineDrag.lastProposedStartMs, true), { recordHistory: false })
        }
      }
      setTimelineDrag(null)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp, { once: true })
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [moveClip, rippleEdits, timelineDrag, timelineZoom, updateProject])

  const updateSelectedClipAdjustment = React.useCallback((patch: NonNullable<VideoClip['adjustments']>) => {
    updateSelectedClip({
      adjustments: {
        ...(selectedClip?.adjustments ?? {}),
        ...patch,
      },
    })
  }, [selectedClip, updateSelectedClip])

  const toggleClipDisabled = React.useCallback((clipId: string) => {
    if (!canEditClip(clipId)) {
      toast.error('Unlock the track before editing this clip.')
      return
    }
    updateProject((current) => {
      const tracks = (current.timeline?.tracks ?? []).map((track) => ({
        ...track,
        clips: (track.clips ?? []).map((clip) => clip.id === clipId ? { ...clip, disabled: clip.disabled === true ? undefined : true } : clip),
      }))
      return {
        ...current,
        timeline: {
          ...current.timeline,
          tracks,
        },
      }
    })
  }, [canEditClip, updateProject])

  const toggleTrackFlag = React.useCallback((trackId: string, flag: 'locked' | 'muted' | 'hidden') => {
    updateProject((current) => ({
      ...current,
      timeline: {
        ...current.timeline,
        tracks: (current.timeline?.tracks ?? []).map((track) => track.id === trackId ? { ...track, [flag]: track[flag] === true ? undefined : true } : track),
      },
    }))
  }, [updateProject])

  const updateSelectedClipDurationFromPreview = React.useCallback((durationMs: number) => {
    if (!selectedClipId || !selectedClip?.mediaId || !Number.isFinite(durationMs) || durationMs <= 0) return
    if (!canEditClip(selectedClipId)) return
    const roundedDurationMs = Math.max(1, Math.round(durationMs))
    if (Math.abs((selectedClip.durationMs ?? 0) - roundedDurationMs) < 250) return
    updateProject((current) => {
      const tracks = (current.timeline?.tracks ?? []).map((track) => ({
        ...track,
        clips: (track.clips ?? []).map((clip) => clip.id === selectedClipId
          ? {
              ...clip,
              durationMs: roundedDurationMs,
              sourceInMs: clip.sourceInMs ?? 0,
              sourceOutMs: roundedDurationMs,
            }
          : clip),
      }))
      const media = (current.media ?? []).map((item) => item.id === selectedClip.mediaId ? { ...item, durationMs: roundedDurationMs } : item)
      return {
        ...current,
        media,
        timeline: {
          ...current.timeline,
          durationMs: computeTimelineDuration(tracks),
          tracks,
        },
      }
    }, { recordHistory: false })
  }, [canEditClip, selectedClip, selectedClipId, updateProject])

  const applyLookPreset = React.useCallback((preset: LookPreset) => {
    const found = LOOK_PRESETS.find((item) => item.value === preset)
    if (!found) return
    updateSelectedClip({ adjustments: found.adjustments })
  }, [updateSelectedClip])

  const resetLook = React.useCallback(() => {
    updateSelectedClip({ adjustments: undefined })
  }, [updateSelectedClip])

  const addLane = React.useCallback((type: 'video' | 'audio') => {
    updateProject((current) => {
      const tracks = current.timeline?.tracks ?? []
      const trackCount = tracks.filter((track) => track.type === type).length
      const newTrack = {
        id: `${type}-${crypto.randomUUID()}`,
        type,
        label: `${type === 'video' ? 'Video' : 'Audio'} ${trackCount + 1}`,
        clips: [],
      }
      const lastMatchingIndex = tracks.reduce((lastIndex, track, index) => track.type === type ? index : lastIndex, -1)
      const nextTracks = [...tracks]
      nextTracks.splice(lastMatchingIndex + 1, 0, newTrack)
      return {
        ...current,
        timeline: {
          ...current.timeline,
          tracks: nextTracks,
        },
      }
    })
    toast.success(`${type === 'video' ? 'Video' : 'Audio'} lane added.`)
  }, [updateProject])

  const stackSelectedClipOnNewLane = React.useCallback(() => {
    if (!selectedClip) return
    if (!canEditClip(selectedClip.id)) {
      toast.error('Unlock the track before editing this clip.')
      return
    }
    let createdId: string | null = null
    updateProject((current) => {
      const tracks = current.timeline?.tracks ?? []
      const videoTrackCount = tracks.filter((track) => track.type === 'video').length
      createdId = crypto.randomUUID()
      const newTrack = {
        id: `video-${crypto.randomUUID()}`,
        type: 'video' as const,
        label: `Video ${videoTrackCount + 1}`,
        clips: [{
          ...selectedClip,
          id: createdId,
          label: selectedClip.label ? `${selectedClip.label} take` : 'Stacked take',
        }],
      }
      const lastVideoIndex = tracks.reduce((lastIndex, track, index) => track.type === 'video' ? index : lastIndex, -1)
      const nextTracks = [...tracks]
      nextTracks.splice(lastVideoIndex + 1, 0, newTrack)
      return {
        ...current,
        timeline: {
          ...current.timeline,
          durationMs: Math.max(current.timeline?.durationMs ?? 0, (selectedClip.startMs ?? 0) + (selectedClip.durationMs ?? 0)),
          tracks: nextTracks,
        },
      }
    })
    if (createdId) setSelectedClipId(createdId)
    toast.success('Take stacked on a new video lane.')
  }, [canEditClip, selectedClip, updateProject])

  const changeAspectRatio = React.useCallback((aspectRatio: AspectSelectValue) => {
    if (aspectRatio === 'custom') return
    const preset = ASPECT_PRESETS.find((item) => item.value === aspectRatio)
    if (!preset) return
    updateProject((current) => ({
      ...current,
      settings: {
        ...current.settings,
        aspectRatio: preset.value,
        width: preset.width,
        height: preset.height,
      },
    }))
  }, [updateProject])

  const packTimeline = React.useCallback(() => {
    updateProject((current) => {
      const tracks = (current.timeline?.tracks ?? []).map((track) => {
        if (track.locked) return track
        let cursor = 0
        const clips = [...(track.clips ?? [])]
          .sort((a, b) => (a.startMs ?? 0) - (b.startMs ?? 0))
          .map((clip) => {
            const nextClip = { ...clip, startMs: cursor }
            cursor += Math.max(1, clip.durationMs ?? 1)
            return nextClip
          })
        return { ...track, clips }
      })
      return {
        ...current,
        timeline: {
          ...current.timeline,
          durationMs: computeTimelineDuration(tracks),
          tracks,
        },
      }
    })
    toast.success('Timeline packed.')
  }, [updateProject])

  const addTextClip = React.useCallback(() => {
    let createdId: string | null = null
    updateProject((current) => {
      const tracks = current.timeline?.tracks ?? []
      const captionTrack = tracks.find((track) => track.type === 'caption' && track.locked !== true && track.hidden !== true)
      const targetTrackId = captionTrack?.id ?? 'captions-main'
      const durationMs = 3000
      const clipStartMs = captionTrack
        ? clampClipMoveStart(captionTrack.clips ?? [], 'new-title-clip', Math.max(0, Math.round(playheadMs)), durationMs)
        : Math.max(0, Math.round(playheadMs))
      const newClip: VideoClip = {
        id: crypto.randomUUID(),
        type: 'text',
        startMs: clipStartMs,
        durationMs,
        label: 'Title',
        text: { text: 'Title', fontSize: 64, color: '#ffffff' },
      }
      createdId = newClip.id
      const nextTracks = captionTrack
        ? tracks.map((track) => track.id === targetTrackId ? { ...track, clips: sortClipsByStart([...(track.clips ?? []), newClip]) } : track)
        : [...tracks, { id: `caption-${crypto.randomUUID()}`, type: 'caption' as const, label: 'Titles', clips: [newClip] }]
      return {
        ...current,
        timeline: {
          ...current.timeline,
          durationMs: computeTimelineDuration(nextTracks),
          tracks: nextTracks,
        },
      }
    })
    if (createdId) setSelectedClipId(createdId)
  }, [playheadMs, updateProject])

  const duplicateClip = React.useCallback((clipId: string | null = selectedClipId) => {
    if (!clipId) return
    if (!canEditClip(clipId)) {
      toast.error('Unlock the track before editing this clip.')
      return
    }
    let createdId: string | null = null
    updateProject((current) => {
      const tracks = (current.timeline?.tracks ?? []).map((track) => {
        const index = (track.clips ?? []).findIndex((clip) => clip.id === clipId)
        if (index === -1) return track
        const clips = [...(track.clips ?? [])]
        const clip = clips[index]
        if (!clip) return track
        createdId = crypto.randomUUID()
        const insertStart = (clip.startMs ?? 0) + Math.max(1, clip.durationMs ?? 1)
        const clipDuration = Math.max(1, clip.durationMs ?? 1)
        for (let nextIndex = 0; nextIndex < clips.length; nextIndex += 1) {
          const nextClip = clips[nextIndex]
          if (nextClip && nextClip.id !== clip.id && (nextClip.startMs ?? 0) >= insertStart) {
            clips[nextIndex] = { ...nextClip, startMs: (nextClip.startMs ?? 0) + clipDuration }
          }
        }
        clips.splice(index + 1, 0, {
          ...clip,
          id: createdId,
          startMs: insertStart,
          label: clip.label ? `${clip.label} copy` : undefined,
        })
        return { ...track, clips: sortClipsByStart(clips) }
      })
      return {
        ...current,
        timeline: {
          ...current.timeline,
          durationMs: computeTimelineDuration(tracks),
          tracks,
        },
      }
    })
    if (createdId) setSelectedClipId(createdId)
  }, [canEditClip, selectedClipId, updateProject])

  const deleteClip = React.useCallback((clipId: string | null = selectedClipId, ripple = false) => {
    if (!clipId) return
    if (!canEditClip(clipId)) {
      toast.error('Unlock the track before editing this clip.')
      return
    }
    let nextSelection: string | null = null
    updateProject((current) => {
      const tracks = (current.timeline?.tracks ?? []).map((track) => {
        const deleted = (track.clips ?? []).find((clip) => clip.id === clipId)
        let clips = (track.clips ?? []).filter((clip) => clip.id !== clipId)
        if (ripple && deleted) {
          const deletedEndMs = (deleted.startMs ?? 0) + Math.max(1, deleted.durationMs ?? 1)
          clips = clips.map((clip) => (clip.startMs ?? 0) >= deletedEndMs ? { ...clip, startMs: Math.max(0, (clip.startMs ?? 0) - Math.max(1, deleted.durationMs ?? 1)) } : clip)
        }
        if (!nextSelection) nextSelection = clips[0]?.id ?? null
        return { ...track, clips }
      })
      return {
        ...current,
        timeline: {
          ...current.timeline,
          durationMs: computeTimelineDuration(tracks),
          tracks,
        },
      }
    })
    setSelectedClipId(nextSelection)
  }, [canEditClip, selectedClipId, updateProject])

  const splitClip = React.useCallback((clipId: string | null = selectedClipId) => {
    if (!clipId || !project) return
    if (!canEditClip(clipId)) {
      toast.error('Unlock the track before editing this clip.')
      return
    }
    const clipToSplit = project.timeline?.tracks?.flatMap((track) => track.clips ?? []).find((clip) => clip.id === clipId)
    if (!clipToSplit) return
    const clipStart = clipToSplit.startMs ?? 0
    const clipDuration = clipToSplit.durationMs ?? 0
    const splitAt = Math.round(playheadMs)
    const clipEnd = clipStart + clipDuration
    if (splitAt <= clipStart || splitAt >= clipEnd) {
      toast.error('Playhead must be inside the selected clip.')
      return
    }
    let createdId: string | null = null
    updateProject((current) => {
      const tracks = (current.timeline?.tracks ?? []).map((track) => {
        const index = (track.clips ?? []).findIndex((clip) => clip.id === clipId)
        if (index === -1) return track
        const clips = [...(track.clips ?? [])]
        const clip = clips[index]
        if (!clip) return track
        const firstDuration = splitAt - (clip.startMs ?? 0)
        const secondDuration = (clip.durationMs ?? 0) - firstDuration
        const sourceInMs = clip.sourceInMs ?? 0
        createdId = crypto.randomUUID()
        clips.splice(index, 1, {
          ...clip,
          durationMs: firstDuration,
          sourceOutMs: clip.sourceOutMs !== undefined ? sourceInMs + firstDuration : clip.sourceOutMs,
        }, {
          ...clip,
          id: createdId,
          startMs: splitAt,
          durationMs: secondDuration,
          sourceInMs: sourceInMs + firstDuration,
          label: clip.label ? `${clip.label} split` : undefined,
        })
        return { ...track, clips }
      })
      return {
        ...current,
        timeline: {
          ...current.timeline,
          durationMs: computeTimelineDuration(tracks),
          tracks,
        },
      }
    })
    if (createdId) setSelectedClipId(createdId)
  }, [canEditClip, playheadMs, project, selectedClipId, updateProject])

  const persistProject = async (summary = 'Edited in Video Studio') => {
    if (!projectAsset) return
    setSaving(true)
    try {
      const parsed = addUserEditVersion(JSON.parse(rawJson) as VideoProject, summary)
      await (window.electronAPI as VideoStudioElectronAPI).writeOutputAssetText?.(
        workspaceId,
        outputId,
        projectAsset.id,
        `${JSON.stringify(parsed, null, 2)}\n`,
      )
      setProject(parsed)
      setRawJson(JSON.stringify(parsed, null, 2))
      setUndoStack([])
      setRedoStack([])
      setExternalReloadPending(false)
      return parsed
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
      throw err
    } finally {
      setSaving(false)
    }
  }

  const save = async () => {
    await persistProject()
    toast.success('Video project saved.')
  }

  const importMedia = async (mode: 'files' | 'folder') => {
    setImporting(true)
    try {
      const result = await (window.electronAPI as VideoStudioElectronAPI).importVideoStudioMedia?.(workspaceId, outputId, { mode })
      if (!result || result.imported.length === 0) {
        toast.info('No supported media files found.')
        return
      }
      const skipped = result.skipped ? ` Skipped ${result.skipped}.` : ''
      toast.success(`Imported ${result.imported.length} media file${result.imported.length === 1 ? '' : 's'}.${skipped}`)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setImporting(false)
    }
  }

  const exportProject = async () => {
    setExporting(true)
    try {
      await persistProject('Saved before export')
      const result = await (window.electronAPI as VideoStudioElectronAPI).exportVideoStudio?.(workspaceId, outputId, 'simple-mp4')
      if (!result) throw new Error('Video Studio export bridge is unavailable.')
      toast.success('Video export rendered.')
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setExporting(false)
    }
  }

  const runReport = async (command: 'inspect' | 'dry-run') => {
    setChecking(command)
    try {
      await persistProject(command === 'inspect' ? 'Saved before inspect' : 'Saved before dry run')
      const api = window.electronAPI as VideoStudioElectronAPI
      const result = command === 'inspect'
        ? await api.inspectVideoStudio?.(workspaceId, outputId)
        : await api.dryRunVideoStudio?.(workspaceId, outputId)
      if (!result) throw new Error('Video Studio report bridge is unavailable.')
      if (result.ok) toast.success(command === 'inspect' ? 'Inspect report passed.' : 'Dry run passed.')
      else toast.error(command === 'inspect' ? 'Inspect found issues. Report saved.' : 'Dry run failed. Report saved.')
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setChecking(null)
    }
  }

  const runVideoAgent = async () => {
    const prompt = agentPrompt.trim()
    if (!prompt) return
    setAgentRunning(true)
    try {
      const result = await (window.electronAPI as VideoStudioElectronAPI).runVideoStudioAgent?.(workspaceId, outputId, prompt)
      if (!result) throw new Error('Video agent bridge is unavailable.')
      if (result.status === 'not-implemented') {
        toast.info(result.message ?? 'Video agent handoff is not wired yet.')
      } else {
        toast.success(result.message ?? 'Video agent command sent.')
        setAgentPrompt('')
        await load()
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setAgentRunning(false)
    }
  }

  if (loading) {
    return <div className="runneros-glass-route flex h-full items-center justify-center text-sm text-white/50">Loading Video Studio</div>
  }

  if (error || !project || !manifest) {
    return (
      <div className="m-5 flex items-center gap-2 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
        <AlertTriangle className="h-4 w-4" />
        <span>{error ?? 'Video project unavailable.'}</span>
      </div>
    )
  }

  const summary = summarizeVideoProject(project)
  const tracks = project.timeline?.tracks ?? []
  const media = project.media ?? []
  const duration = project.timeline?.durationMs ?? 0
  const contextClip = clipContextMenu
    ? tracks.flatMap((track) => track.clips ?? []).find((clip) => clip.id === clipContextMenu.clipId) ?? null
    : null
  const matchedAspectPreset = ASPECT_PRESETS.find((preset) =>
    preset.value === project.settings.aspectRatio
    && preset.width === project.settings.width
    && preset.height === project.settings.height
  )
  const currentAspectRatio: AspectSelectValue = matchedAspectPreset?.value ?? 'custom'
  const customAspectLabel = `Custom ${project.settings.width}x${project.settings.height}`
  const isBusy = saving || importing || checking !== null || exporting

  return (
    <div className="h-full overflow-hidden bg-[#101010] text-white">
      <div
        className="grid h-full min-h-0"
        style={{ gridTemplateRows: externalReloadPending ? '44px 36px minmax(0,1fr) 220px' : '44px minmax(0,1fr) 220px' }}
      >
        <header className="flex min-w-0 items-center justify-between gap-3 border-b border-white/[0.07] bg-[#171717] px-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-white/[0.06] text-white/58">
              <FileVideo className="h-4 w-4" />
            </div>
            <input
              value={project.title}
              onChange={(event) => updateProject((current) => ({ ...current, title: event.target.value }))}
              className="min-w-0 bg-transparent text-[15px] font-semibold text-white outline-none"
            />
            <div className="hidden items-center gap-1.5 text-[11px] text-white/42 xl:flex">
              <MetricPill label="Dur" value={formatDuration(duration)} />
              <MetricPill label="Canvas" value={`${summary?.width ?? '-'}x${summary?.height ?? '-'}`} />
              <MetricPill label="FPS" value={String(summary?.fps ?? '-')} />
              <MetricPill label="Ver" value={String(summary?.versionCount ?? 0)} />
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <label className="flex h-8 items-center gap-2 rounded-md bg-white/[0.06] px-2 text-[12px] text-white/55">
              <span>Canvas</span>
              <select
                value={currentAspectRatio}
                onChange={(event) => changeAspectRatio(event.target.value as AspectSelectValue)}
                disabled={isBusy}
                className="w-[116px] bg-transparent text-[12px] text-white/80 outline-none"
              >
                {currentAspectRatio === 'custom' && <option value="custom">{customAspectLabel}</option>}
                {ASPECT_PRESETS.map((preset) => (
                  <option key={preset.value} value={preset.value}>{preset.label}</option>
                ))}
              </select>
            </label>
            <IconButton label="Undo" onClick={undo} disabled={isBusy || undoStack.length === 0}><Undo2 className="h-4 w-4" /></IconButton>
            <IconButton label="Redo" onClick={redo} disabled={isBusy || redoStack.length === 0}><Redo2 className="h-4 w-4" /></IconButton>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="flex h-8 w-8 items-center justify-center rounded-md bg-white/[0.06] text-white/62 hover:bg-white/[0.1] hover:text-white">
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <StyledDropdownMenuContent align="end" minWidth="min-w-48">
                <StyledDropdownMenuItem onClick={exportProject} disabled={isBusy}>
                  {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                  Export video
                </StyledDropdownMenuItem>
                <StyledDropdownMenuItem onClick={save} disabled={isBusy}>
                  <Save className="h-3.5 w-3.5" />
                  {saving ? 'Saving' : 'Save project'}
                </StyledDropdownMenuItem>
                <StyledDropdownMenuItem onClick={() => void importMedia('files')} disabled={isBusy}>
                  {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                  Import files
                </StyledDropdownMenuItem>
                <StyledDropdownMenuItem onClick={() => void importMedia('folder')} disabled={isBusy}>
                  <FolderOpen className="h-3.5 w-3.5" />
                  Import folder
                </StyledDropdownMenuItem>
                <StyledDropdownMenuSeparator />
                <StyledDropdownMenuItem onClick={() => void load()}>
                  <RefreshCw className="h-3.5 w-3.5" />
                  Reload
                </StyledDropdownMenuItem>
                {projectAsset && (
                  <StyledDropdownMenuItem onClick={() => window.electronAPI.showOutputInFolder(workspaceId, outputId, projectAsset.id)}>
                    <FolderOpen className="h-3.5 w-3.5" />
                    Show project file
                  </StyledDropdownMenuItem>
                )}
                <StyledDropdownMenuItem onClick={() => void runReport('inspect')} disabled={isBusy}>
                  {checking === 'inspect' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ClipboardCheck className="h-3.5 w-3.5" />}
                  Inspect
                </StyledDropdownMenuItem>
                <StyledDropdownMenuItem onClick={() => void runReport('dry-run')} disabled={isBusy}>
                  {checking === 'dry-run' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                  Dry run
                </StyledDropdownMenuItem>
              </StyledDropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {externalReloadPending && (
          <div className="flex h-9 items-center justify-between border-b border-[#f97316]/18 bg-[#3b220d]/35 px-3 text-[12px] text-[#ffd7a8]">
            <span>Project changed outside this editor. Save your work or reload to sync.</span>
            <button type="button" onClick={() => void load()} className="rounded bg-[#f97316]/18 px-2 py-1 text-[#ffd7a8] hover:bg-[#f97316]/28">
              Reload
            </button>
          </div>
        )}

        <div className="grid min-h-0 grid-cols-[220px_minmax(0,1fr)_460px] overflow-hidden">
          <aside className="min-h-0 border-r border-white/[0.07] bg-[#181818]">
            <div className="flex h-10 items-center justify-between border-b border-white/[0.07] px-3">
              <PanelTitle title="Media" value={`${media.length}`} />
              <button type="button" title="Import files" onClick={() => void importMedia('files')} disabled={isBusy} className="flex h-7 w-7 items-center justify-center rounded-md bg-white/[0.06] text-white/58 hover:bg-white/[0.1] hover:text-white">
                <Upload className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="grid gap-2 p-2">
              {media.length === 0 ? <EmptyText>No media yet</EmptyText> : media.map((item) => (
                <div key={item.id} className="group rounded-md border border-white/[0.06] bg-[#222] p-2 hover:border-[#18c7d4]/40">
                  <div className="aspect-video rounded bg-black/70" />
                  <div className="mt-2 truncate text-[12px] font-medium text-white/78">{item.label ?? item.id}</div>
                  <div className="truncate text-[11px] text-white/36">{item.type ?? 'media'}</div>
                </div>
              ))}
            </div>
          </aside>

          <main className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-[#101010]">
            <div className="flex h-10 shrink-0 items-center justify-between border-b border-white/[0.07] px-3">
              <PanelTitle title="Player" value={previewStatus} />
              <div className="flex items-center gap-2 text-[11px] text-white/38">
                <span>{`${summary?.width ?? '-'} x ${summary?.height ?? '-'}`}</span>
                <span>{`${summary?.fps ?? '-'} fps`}</span>
              </div>
            </div>
            <div className="flex min-h-0 flex-1 items-center justify-center bg-[#0a0a0a] p-4">
              <div className="flex aspect-video w-full max-w-[min(100%,980px)] items-center justify-center overflow-hidden rounded-sm border border-white/[0.06] bg-black">
                {previewUrl ? (
                  <div className="relative h-full w-full">
                    <video
                      ref={previewVideoRef}
                      src={previewUrl}
                      controls
                      onTimeUpdate={(event) => updatePlayheadFromPreviewTime(event.currentTarget.currentTime * 1000)}
                      onSeeked={(event) => updatePlayheadFromPreviewTime(event.currentTarget.currentTime * 1000)}
                      onLoadedMetadata={(event) => {
                        if (clipPreviewUrl) updateSelectedClipDurationFromPreview(event.currentTarget.duration * 1000)
                      }}
                      onPlay={() => setIsPreviewPlaying(true)}
                      onPause={() => setIsPreviewPlaying(false)}
                      onEnded={() => setIsPreviewPlaying(false)}
                      className="h-full w-full object-contain"
                      style={previewLook?.videoStyle}
                    />
                    {previewLook?.grainOpacity ? <div aria-hidden="true" className="pointer-events-none absolute inset-0 mix-blend-overlay" style={previewLook.grainStyle} /> : null}
                  </div>
                ) : (
                  <div className="text-sm text-white/38">Export once to preview rendered video</div>
                )}
              </div>
            </div>
          </main>

          <aside className="relative min-h-0 min-w-0 overflow-hidden border-l border-white/[0.07] bg-[#181818]">
            {agentPanelOpen && (
              <div className="absolute inset-0 z-10 flex flex-col border-l border-[#18c7d4]/20 bg-[#181818] p-3">
                <div className="flex h-9 shrink-0 items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-white/50">
                    <Bot className="h-3.5 w-3.5" />
                    Video Agent
                  </div>
                  <button type="button" title="Close Video Agent" onClick={() => setAgentPanelOpen(false)} className="flex h-7 w-7 items-center justify-center rounded-md bg-white/[0.06] text-white/55 hover:bg-white/[0.1] hover:text-white">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="mt-2 min-h-0 flex-1 rounded-md border border-white/[0.06] bg-[#202020] p-3">
                  <div className="rounded-md bg-black/25 p-3 text-[12px] leading-5 text-white/42">
                    <div className="mb-2 text-white/72">Ready when you are.</div>
                    <div>Tell the agent what to cut, add, rearrange, inspect, or export. It uses the current project.</div>
                  </div>
                </div>
                <div className="mt-3 flex shrink-0 gap-2">
                  <textarea
                    value={agentPrompt}
                    onChange={(event) => setAgentPrompt(event.target.value)}
                    placeholder="Make this a 9:16 punchy short..."
                    className="h-24 min-w-0 flex-1 resize-none rounded-md border border-white/[0.08] bg-black/40 p-2 text-xs text-white/78 outline-none placeholder:text-white/30 focus:border-[#18c7d4]/60"
                  />
                  <button type="button" title="Send to Video Agent" onClick={runVideoAgent} disabled={agentRunning || !agentPrompt.trim()} className="flex h-24 w-12 shrink-0 items-center justify-center rounded-md bg-[#18c7d4] text-black disabled:cursor-not-allowed disabled:bg-white/[0.08] disabled:text-white/24">
                    {agentRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            )}
            <div className="flex h-full min-h-0 flex-col overflow-hidden">
              <button
                type="button"
                onClick={() => setAgentPanelOpen(true)}
                className="flex h-10 shrink-0 items-center justify-between border-b border-white/[0.07] px-3 text-xs uppercase tracking-wide text-white/46 hover:bg-white/[0.035] hover:text-white/72"
              >
                <span className="flex items-center gap-2"><Bot className="h-3.5 w-3.5" /> Video Agent</span>
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
              <div className="min-h-0 flex-1 overflow-auto p-3">
              <div className="flex items-center justify-between">
                <PanelTitle title="Adjust" value={selectedClip ? 'clip' : 'project'} />
                <SlidersHorizontal className="h-3.5 w-3.5 text-white/34" />
              </div>
              {selectedClip ? (
              <div className="mt-2 grid gap-2">
                <Field placeholder="Clip Name" value={selectedClip.label ?? ''} onChange={(value) => updateSelectedClip({ label: value })} />
                {selectedClipSupportsLook && (
                  <div className="grid gap-1.5 rounded-md border border-white/[0.07] bg-[#111214]/80 p-2">
                    <PanelTitle title="Look" value={selectedLookValue} />
                    <select
                      value={selectedLookValue}
                      onChange={(event) => applyLookPreset(event.target.value as LookPreset)}
                      className="h-8 rounded-md border border-white/[0.07] bg-black/35 px-2 text-sm text-white/72 outline-none focus:border-[#18c7d4]/60"
                    >
                      <option value="manual" disabled>Manual</option>
                      {LOOK_PRESETS.map((preset) => (
                        <option key={preset.value} value={preset.value}>{preset.label}</option>
                      ))}
                    </select>
                    <AdjustmentField label="Exposure" min={-1} max={1} step={0.01} value={selectedClip.adjustments?.exposure ?? 0} onChange={(value) => updateSelectedClipAdjustment({ exposure: value, preset: 'manual' })} />
                    <AdjustmentField label="Contrast" min={0} max={3} step={0.01} value={selectedClip.adjustments?.contrast ?? 1} onChange={(value) => updateSelectedClipAdjustment({ contrast: value, preset: 'manual' })} />
                    <AdjustmentField label="Saturation" min={0} max={3} step={0.01} value={selectedClip.adjustments?.saturation ?? 1} onChange={(value) => updateSelectedClipAdjustment({ saturation: value, preset: 'manual' })} />
                    <AdjustmentField label="Highlights" min={-1} max={1} step={0.01} value={selectedClip.adjustments?.highlights ?? 0} onChange={(value) => updateSelectedClipAdjustment({ highlights: value, preset: 'manual' })} />
                    <AdjustmentField label="Shadows" min={-1} max={1} step={0.01} value={selectedClip.adjustments?.shadows ?? 0} onChange={(value) => updateSelectedClipAdjustment({ shadows: value, preset: 'manual' })} />
                    <AdjustmentField label="Grain" min={0} max={1} step={0.01} value={selectedClip.adjustments?.grain ?? 0} onChange={(value) => updateSelectedClipAdjustment({ grain: value, preset: 'manual' })} />
                    <Button size="sm" variant="outline" className="h-7 border-white/[0.07] bg-white/[0.035] text-xs text-white/60 hover:bg-white/[0.07] hover:text-white" onClick={resetLook}>
                      Reset Look
                    </Button>
                  </div>
                )}
                {selectedClip.type === 'text' && (
                  <textarea
                    value={selectedClip.text?.text ?? selectedClip.label ?? ''}
                    onChange={(event) => updateSelectedClip({
                      text: {
                        text: event.target.value,
                        fontSize: selectedClip.text?.fontSize ?? 64,
                        color: selectedClip.text?.color ?? '#ffffff',
                      },
                      label: event.target.value.split('\n')[0]?.slice(0, 48) || 'Title',
                    })}
                    placeholder="Text"
                    className="h-20 resize-none rounded-md border border-white/[0.07] bg-black/30 p-2 text-sm text-white/72 outline-none placeholder:text-white/28 focus:border-[#18c7d4]/60"
                  />
                )}
                {selectedClip.mediaId && showDeveloperDetails && <ReadOnlyValue label="Media ID" value={selectedClip.mediaId} />}
              </div>
              ) : <EmptyText>Select a clip to inspect</EmptyText>}

              <button
                type="button"
                onClick={() => setShowDeveloperDetails((value) => !value)}
                className="mt-4 flex h-8 w-full items-center justify-between rounded-md border border-white/[0.08] bg-white/[0.035] px-2 text-xs uppercase tracking-wide text-white/42 hover:text-white/72"
              >
                <span className="flex items-center gap-1.5"><Code2 className="h-3.5 w-3.5" /> Developer details</span>
                <span>{showDeveloperDetails ? 'Hide' : 'Show'}</span>
              </button>

              {showDeveloperDetails && (
                <div className="mt-3">
                <PanelTitle title="Project JSON" value="editable" />
                <textarea
                  value={rawJson}
                  onChange={(event) => setRawJson(event.target.value)}
                  spellCheck={false}
                  className="mt-2 h-56 w-full resize-none rounded-md border border-white/[0.08] bg-black/45 p-2 font-mono text-xs text-white/68 outline-none focus:border-[#f97316]/50"
                />
                </div>
              )}

              <div className="mt-5">
                <PanelTitle title="Agent Changes" value={`${project.agentEvents?.length ?? 0}`} />
                <div className="mt-2 grid gap-2">
                {(project.agentEvents ?? []).slice(-5).reverse().map((event, index) => (
                  <div key={event.id ?? index} className="rounded-md border border-white/[0.08] bg-white/[0.035] p-2 text-xs">
                    <div className="text-white/72">{event.summary ?? event.toolName ?? 'Agent edit'}</div>
                    <div className="mt-1 text-white/38">{event.agentSlug ?? 'agent'} · {event.createdAt ?? ''}</div>
                  </div>
                ))}
                </div>
              </div>

              <div className="mt-5">
                <PanelTitle title="Versions" value={`${project.versions?.length ?? 0}`} />
                <div className="mt-2 grid gap-2">
                {(project.versions ?? []).slice(-6).reverse().map((version) => (
                  <div key={version.id} className="rounded-md border border-white/[0.08] bg-white/[0.035] p-2 text-xs">
                    <div className="flex items-center gap-1.5 text-white/72">
                      <History className="h-3.5 w-3.5 text-white/38" />
                      <span className="truncate">{version.summary}</span>
                    </div>
                    <div className="mt-1 text-white/38">{version.actor}{version.agentSlug ? ` · ${version.agentSlug}` : ''} · {version.createdAt}</div>
                  </div>
                ))}
                </div>
              </div>
            </div>
            </div>
          </aside>
        </div>

        <footer className="min-h-0 border-t border-white/[0.07] bg-[#151515]">
          {clipContextMenu && contextClip && (
            <div
              className="fixed z-50 min-w-40 rounded-md border border-white/[0.1] bg-[#202020] p-1 shadow-modal-small"
              style={{ left: clipContextMenu.x, top: clipContextMenu.y }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                disabled={findTrackForClip(project, contextClip.id)?.locked === true}
                className="flex h-8 w-full items-center justify-between rounded px-2 text-left text-xs text-white/72 hover:bg-white/[0.08] hover:text-white"
                onClick={() => {
                  toggleClipDisabled(contextClip.id)
                  setClipContextMenu(null)
                }}
              >
                <span>{contextClip.disabled === true ? 'Activate clip' : 'Deactivate clip'}</span>
                <span className="text-white/32">{contextClip.disabled === true ? 'On' : 'Off'}</span>
              </button>
              <button
                type="button"
                className="flex h-8 w-full items-center rounded px-2 text-left text-xs text-white/54 hover:bg-white/[0.08] hover:text-white"
                onClick={() => {
                  setSelectedClipId(contextClip.id)
                  setClipContextMenu(null)
                }}
              >
                Select clip
              </button>
              <button
                type="button"
                disabled={findTrackForClip(project, contextClip.id)?.locked === true}
                className="flex h-8 w-full items-center rounded px-2 text-left text-xs text-white/54 hover:bg-white/[0.08] hover:text-white"
                onClick={() => {
                  duplicateClip(contextClip.id)
                  setClipContextMenu(null)
                }}
              >
                Duplicate
              </button>
              <button
                type="button"
                disabled={findTrackForClip(project, contextClip.id)?.locked === true}
                className="flex h-8 w-full items-center rounded px-2 text-left text-xs text-white/54 hover:bg-white/[0.08] hover:text-white"
                onClick={() => {
                  splitClip(contextClip.id)
                  setClipContextMenu(null)
                }}
              >
                Split at playhead
              </button>
              <button
                type="button"
                disabled={findTrackForClip(project, contextClip.id)?.locked === true}
                className="flex h-8 w-full items-center rounded px-2 text-left text-xs text-red-200/70 hover:bg-red-500/10 hover:text-red-100"
                onClick={() => {
                  deleteClip(contextClip.id, true)
                  setClipContextMenu(null)
                }}
              >
                Ripple delete
              </button>
            </div>
          )}
          <div className="flex h-9 items-center justify-between border-b border-white/[0.06] px-3">
            <div className="flex items-center gap-1.5">
              <PanelTitle title="Timeline" />
              <div className="ml-2 flex items-center gap-1">
                <IconButton label="Split at playhead" onClick={() => splitClip()} disabled={!selectedClip || selectedClipLocked}><Scissors className="h-3.5 w-3.5" /></IconButton>
                <IconButton label="Add title" onClick={addTextClip}><Type className="h-3.5 w-3.5" /></IconButton>
                <IconButton label="Duplicate" onClick={() => duplicateClip()} disabled={!selectedClip || selectedClipLocked}><Copy className="h-3.5 w-3.5" /></IconButton>
                <IconButton label="Stack take on new video lane" onClick={stackSelectedClipOnNewLane} disabled={!selectedClip || selectedClipLocked}><Layers className="h-3.5 w-3.5" /></IconButton>
                <IconButton label="Delete" onClick={() => deleteClip()} disabled={!selectedClip || selectedClipLocked}><Trash2 className="h-3.5 w-3.5" /></IconButton>
              </div>
              <button type="button" title="Pack timeline" onClick={packTimeline} className="ml-1 flex h-7 items-center gap-1.5 rounded-md bg-white/[0.06] px-2 text-[12px] text-white/62 hover:bg-white/[0.1] hover:text-white">
                <Magnet className="h-3.5 w-3.5" />
                Pack
              </button>
              <button
                type="button"
                title="Ripple trim and delete"
                onClick={() => setRippleEdits((value) => !value)}
                className={`flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] ${rippleEdits ? 'bg-[#18c7d4]/16 text-[#75f4ff]' : 'bg-white/[0.06] text-white/62 hover:bg-white/[0.1] hover:text-white'}`}
              >
                <Link className="h-3.5 w-3.5" />
                Ripple
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                title={isPreviewPlaying ? 'Pause' : 'Play'}
                onClick={togglePreviewPlayback}
                disabled={!previewUrl}
                className="flex h-7 min-w-16 items-center justify-center gap-1.5 rounded-md bg-white/[0.06] px-2 text-[12px] text-white/68 hover:bg-white/[0.1] hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
              >
                {isPreviewPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                {isPreviewPlaying ? 'Pause' : 'Play'}
              </button>
              <label className="flex h-7 items-center gap-2 rounded-md bg-white/[0.06] px-2 text-[11px] text-white/50">
                <span>Zoom</span>
                <input
                  type="range"
                  min="0.5"
                  max="2.5"
                  step="0.25"
                  value={timelineZoom}
                  onChange={(event) => setTimelineZoom(Number(event.target.value))}
                  className="w-24 accent-[#18c7d4]"
                />
              </label>
            </div>
          </div>
          <div className="grid h-[181px] grid-cols-[132px_minmax(0,1fr)] overflow-hidden">
            <div className="border-r border-white/[0.07] bg-[#111] text-[11px] text-white/38">
              {tracks.map((track) => (
                <div key={track.id} className={`flex h-[60px] items-center justify-between gap-2 px-2 ${track.hidden ? 'opacity-45' : ''}`}>
                  <span className="min-w-0 truncate">{track.label ?? track.id}</span>
                  <div className="flex shrink-0 items-center gap-1">
                    <button type="button" title={track.locked ? 'Unlock track' : 'Lock track'} onClick={() => toggleTrackFlag(track.id, 'locked')} className="flex h-5 w-5 items-center justify-center rounded bg-white/[0.04] text-white/38 hover:bg-white/[0.1] hover:text-white">
                      {track.locked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
                    </button>
                    <button type="button" title={track.muted ? 'Unmute track' : 'Mute track'} onClick={() => toggleTrackFlag(track.id, 'muted')} className="flex h-5 w-5 items-center justify-center rounded bg-white/[0.04] text-white/38 hover:bg-white/[0.1] hover:text-white">
                      {track.muted ? <VolumeX className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}
                    </button>
                    <button type="button" title={track.hidden ? 'Show track' : 'Hide track'} onClick={() => toggleTrackFlag(track.id, 'hidden')} className="flex h-5 w-5 items-center justify-center rounded bg-white/[0.04] text-white/38 hover:bg-white/[0.1] hover:text-white">
                      {track.hidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                    </button>
                    {(track.type === 'video' || track.type === 'audio') && (
                    <button
                      type="button"
                      title={`Add ${track.type} lane`}
                      onClick={() => addLane(track.type === 'video' ? 'video' : 'audio')}
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-white/[0.06] text-white/45 hover:bg-white/[0.12] hover:text-white"
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div
              ref={timelineScrubRef}
              className="relative overflow-auto"
              onPointerDown={(event) => {
                if (event.target !== event.currentTarget) return
                event.currentTarget.setPointerCapture(event.pointerId)
                updatePlayheadFromPointer(event)
              }}
              onPointerMove={(event) => {
                if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
                updatePlayheadFromPointer(event)
              }}
              onPointerUp={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  event.currentTarget.releasePointerCapture(event.pointerId)
                }
              }}
            >
              <div
                aria-hidden="true"
                className="pointer-events-none absolute bottom-0 top-0 z-20 w-px bg-[#18c7d4]"
                style={{ left: `${timelinePositionPixels(playheadMs, timelineZoom) + 12}px` }}
              >
                <div className="absolute -left-[5px] top-0 h-2.5 w-2.5 rotate-45 rounded-[2px] bg-[#18c7d4]" />
              </div>
              {tracks.map((track) => (
                <div
                  key={track.id}
                  data-video-track-id={track.id}
                  className="flex h-[60px] items-center border-b border-white/[0.05] px-3"
                  onPointerDown={(event) => {
                    if (event.target instanceof HTMLElement && event.target.closest('button')) return
                    event.currentTarget.setPointerCapture(event.pointerId)
                    updatePlayheadFromPointer(event)
                  }}
                  onPointerMove={(event) => {
                    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
                    updatePlayheadFromPointer(event)
                  }}
                  onPointerUp={(event) => {
                    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                      event.currentTarget.releasePointerCapture(event.pointerId)
                    }
                  }}
                >
                  {(track.clips ?? []).length === 0 ? <span className="text-xs text-white/26">No clips</span> : renderTimelineClips(track.clips ?? [], selectedClipId, timelineZoom, track, (clip) => {
                    setSelectedClipId(clip.id)
                    setPlayheadPosition(clip.startMs ?? 0, true)
                  }, (event, clip, mode) => {
                    if (track.locked) return
                    event.preventDefault()
                    setSelectedClipId(clip.id)
                    setTimelineDrag({
                      clipId: clip.id,
                      mode,
                      startX: event.clientX,
                      currentX: event.clientX,
                      currentY: event.clientY,
                      sourceTrackId: track.id,
                      initialStartMs: clip.startMs ?? 0,
                      initialDurationMs: clip.durationMs ?? 1000,
                      initialSourceInMs: clip.sourceInMs ?? 0,
                      lastProposedStartMs: clip.startMs ?? 0,
                      active: false,
                    })
                  }, (clip, event) => {
                    setSelectedClipId(clip.id)
                    setClipContextMenu({ clipId: clip.id, x: event.clientX, y: event.clientY })
                  })}
                </div>
              ))}
            </div>
          </div>
        </footer>
      </div>
    </div>
  )
}

function computeTimelineDuration(tracks: VideoProject['timeline']['tracks']): number {
  return tracks.reduce((duration, track) => Math.max(
    duration,
    ...(track.clips ?? []).map((clip) => (clip.startMs ?? 0) + (clip.durationMs ?? 0)),
  ), 0)
}

function findTrackForClip(project: VideoProject | null, clipId: string | null | undefined): VideoProject['timeline']['tracks'][number] | null {
  if (!project || !clipId) return null
  return (project.timeline?.tracks ?? []).find((track) => (track.clips ?? []).some((clip) => clip.id === clipId)) ?? null
}

function sortClipsByStart(clips: VideoClip[]): VideoClip[] {
  return [...clips].sort((a, b) => (a.startMs ?? 0) - (b.startMs ?? 0))
}

function snapClipStart(clips: VideoClip[], clipId: string, proposedStartMs: number, thresholdMs = 250): number {
  const snapPoints = clips
    .filter((clip) => clip.id !== clipId)
    .map((clip) => (clip.startMs ?? 0) + Math.max(1, clip.durationMs ?? 1))
  let best = Math.max(0, Math.round(proposedStartMs))
  let bestDistance = thresholdMs + 1
  for (const point of snapPoints) {
    const distance = Math.abs(point - proposedStartMs)
    if (distance < bestDistance) {
      best = point
      bestDistance = distance
    }
  }
  return Math.max(0, best)
}

function moveClipInProject(project: VideoProject, clipId: string, startMs: number, snap: boolean): VideoProject {
  const tracks = (project.timeline?.tracks ?? []).map((track) => {
    const ordered = sortClipsByStart(track.clips ?? [])
    const clip = ordered.find((item) => item.id === clipId)
    if (!clip) return track
    const proposedStartMs = snap ? snapClipStart(ordered, clipId, startMs) : Math.max(0, Math.round(startMs))
    const nextStartMs = clampClipMoveStart(ordered, clipId, proposedStartMs, clip.durationMs ?? 1000)
    return {
      ...track,
      clips: sortClipsByStart(ordered.map((item) => item.id === clipId ? { ...item, startMs: nextStartMs } : item)),
    }
  })
  return {
    ...project,
    timeline: {
      ...project.timeline,
      durationMs: computeTimelineDuration(tracks),
      tracks,
    },
  }
}

function moveClipToTrackInProject(project: VideoProject, clipId: string, targetTrackId: string, proposedStartMs: number, snap: boolean): VideoProject {
  const tracks = project.timeline?.tracks ?? []
  let movingClip: VideoClip | null = null
  let sourceTrackId: string | null = null
  for (const track of tracks) {
    const found = (track.clips ?? []).find((clip) => clip.id === clipId)
    if (found) {
      movingClip = found
      sourceTrackId = track.id
      break
    }
  }
  if (!movingClip || !sourceTrackId || sourceTrackId === targetTrackId) return project
  const targetTrack = tracks.find((track) => track.id === targetTrackId)
  if (!targetTrack || targetTrack.locked === true || !canTrackAcceptClip(targetTrack.type, movingClip.type)) return project

  const targetClips = (targetTrack.clips ?? []).filter((clip) => clip.id !== clipId)
  const normalizedStartMs = Math.max(0, Math.round(proposedStartMs))
  const snappedStartMs = snap ? snapClipStart(targetClips, clipId, normalizedStartMs) : normalizedStartMs
  const nextStartMs = clampClipMoveStart(targetClips, clipId, snappedStartMs, movingClip.durationMs ?? 1000)
  const movedClip = { ...movingClip, startMs: nextStartMs }
  const nextTracks = tracks.map((track) => {
    if (track.id === sourceTrackId) {
      return { ...track, clips: (track.clips ?? []).filter((clip) => clip.id !== clipId) }
    }
    if (track.id === targetTrackId) {
      return { ...track, clips: sortClipsByStart([...targetClips, movedClip]) }
    }
    return track
  })
  return {
    ...project,
    timeline: {
      ...project.timeline,
      durationMs: computeTimelineDuration(nextTracks),
      tracks: nextTracks,
    },
  }
}

function canTrackAcceptClip(trackType: VideoProject['timeline']['tracks'][number]['type'], clipType: VideoClip['type']): boolean {
  if (trackType === 'video') return clipType === 'video' || clipType === 'image' || clipType === 'html' || clipType === 'lottie'
  if (trackType === 'audio') return clipType === 'audio'
  if (trackType === 'caption') return clipType === 'caption' || clipType === 'text'
  return false
}

function clampClipMoveStart(clips: VideoClip[], clipId: string, proposedStartMs: number, durationMs: number): number {
  const ordered = sortClipsByStart(clips).filter((clip) => clip.id !== clipId)
  const boundedStartMs = Math.max(0, Math.round(proposedStartMs))
  const clipDurationMs = Math.max(MIN_CLIP_DURATION_MS, durationMs)
  if (ordered.length === 0) return boundedStartMs

  const ranges: Array<{ min: number; max: number }> = []
  let cursor = 0
  for (const clip of ordered) {
    const clipStart = clip.startMs ?? 0
    const clipEnd = clipStart + Math.max(MIN_CLIP_DURATION_MS, clip.durationMs ?? MIN_CLIP_DURATION_MS)
    if (clipStart - cursor >= clipDurationMs) ranges.push({ min: cursor, max: clipStart - clipDurationMs })
    cursor = Math.max(cursor, clipEnd)
  }
  ranges.push({ min: cursor, max: Number.POSITIVE_INFINITY })
  for (const range of ranges) {
    if (boundedStartMs >= range.min && boundedStartMs <= range.max) return boundedStartMs
  }
  return ranges.reduce((best, range) => {
    const candidate = boundedStartMs < range.min ? range.min : range.max
    return Math.abs(candidate - boundedStartMs) < Math.abs(best - boundedStartMs) ? candidate : best
  }, ranges[0]?.min ?? boundedStartMs)
}

function trimClipStartInProject(
  project: VideoProject,
  clipId: string,
  options: { startMs: number; initialStartMs: number; initialDurationMs: number; initialSourceInMs: number },
): VideoProject {
  const tracks = (project.timeline?.tracks ?? []).map((track) => {
    const ordered = sortClipsByStart(track.clips ?? [])
    const clipIndex = ordered.findIndex((clip) => clip.id === clipId)
    if (clipIndex === -1) return track
    const clip = ordered[clipIndex]
    if (!clip) return track
    const previousClip = ordered[clipIndex - 1]
    const clipEndMs = options.initialStartMs + options.initialDurationMs
    const minStartMs = previousClip ? (previousClip.startMs ?? 0) + Math.max(MIN_CLIP_DURATION_MS, previousClip.durationMs ?? MIN_CLIP_DURATION_MS) : 0
    const sourceOutMs = typeof clip.sourceOutMs === 'number' ? clip.sourceOutMs : undefined
    const maxStartFromDuration = clipEndMs - MIN_CLIP_DURATION_MS
    const maxStartFromSource = sourceOutMs === undefined
      ? Number.POSITIVE_INFINITY
      : options.initialStartMs + Math.max(0, sourceOutMs - options.initialSourceInMs - MIN_CLIP_DURATION_MS)
    const maxStartMs = Math.max(minStartMs, Math.min(maxStartFromDuration, maxStartFromSource))
    const nextStartMs = clampNumber(Math.round(options.startMs), minStartMs, maxStartMs)
    const durationMs = Math.max(MIN_CLIP_DURATION_MS, clipEndMs - nextStartMs)
    const sourceDeltaMs = nextStartMs - options.initialStartMs
    return {
      ...track,
      clips: ordered.map((clip) => clip.id === clipId ? {
        ...clip,
        startMs: nextStartMs,
        durationMs,
        sourceInMs: clampSourceIn(options.initialSourceInMs + sourceDeltaMs, sourceOutMs),
      } : clip),
    }
  })
  return {
    ...project,
    timeline: {
      ...project.timeline,
      durationMs: computeTimelineDuration(tracks),
      tracks,
    },
  }
}

function trimClipEndInProject(project: VideoProject, clipId: string, durationMs: number, ripple: boolean): VideoProject {
  const tracks = (project.timeline?.tracks ?? []).map((track) => {
    const ordered = sortClipsByStart(track.clips ?? [])
    const clipIndex = ordered.findIndex((clip) => clip.id === clipId)
    if (clipIndex === -1) return track
    const clip = ordered[clipIndex]
    if (!clip) return track
    const nextClip = ordered[clipIndex + 1]
    const maxDurationMs = !ripple && nextClip ? Math.max(MIN_CLIP_DURATION_MS, (nextClip.startMs ?? 0) - (clip.startMs ?? 0)) : Number.POSITIVE_INFINITY
    const nextDurationMs = clampNumber(Math.round(durationMs), MIN_CLIP_DURATION_MS, maxDurationMs)
    if (ripple) {
      return {
        ...track,
        clips: rippleTrimEndClips(ordered, clipIndex, nextDurationMs),
      }
    }
    return {
      ...track,
      clips: ordered.map((item) => {
        if (item.id === clipId) return { ...item, durationMs: nextDurationMs }
        return item
      }),
    }
  })
  return {
    ...project,
    timeline: {
      ...project.timeline,
      durationMs: computeTimelineDuration(tracks),
      tracks,
    },
  }
}

function rippleTrimEndClips(ordered: VideoClip[], clipIndex: number, nextDurationMs: number): VideoClip[] {
  const targetClip = ordered[clipIndex]
  if (!targetClip) return ordered
  const deltaMs = nextDurationMs - Math.max(MIN_CLIP_DURATION_MS, targetClip.durationMs ?? MIN_CLIP_DURATION_MS)
  let cursor = 0
  return ordered.map((clip, index) => {
    const clipDurationMs = Math.max(MIN_CLIP_DURATION_MS, clip.durationMs ?? MIN_CLIP_DURATION_MS)
    if (index < clipIndex) {
      cursor = Math.max(cursor, (clip.startMs ?? 0) + clipDurationMs)
      return clip
    }
    if (index === clipIndex) {
      const nextClip = { ...clip, durationMs: nextDurationMs }
      cursor = Math.max(cursor, (clip.startMs ?? 0) + nextDurationMs)
      return nextClip
    }
    const startMs = Math.max((clip.startMs ?? 0) + deltaMs, cursor)
    cursor = startMs + clipDurationMs
    return { ...clip, startMs }
  })
}

function clampNumber(value: number, min: number, max: number): number {
  if (min > max) return min
  return Math.min(max, Math.max(min, value))
}

function clampSourceIn(value: number, sourceOutMs: number | undefined): number {
  const min = 0
  const max = sourceOutMs === undefined ? Number.POSITIVE_INFINITY : Math.max(0, sourceOutMs - MIN_CLIP_DURATION_MS)
  return clampNumber(Math.round(value), min, max)
}

function previewLookStyle(adjustments: VideoClip['adjustments']): { videoStyle: React.CSSProperties; grainStyle: React.CSSProperties; grainOpacity: number } | null {
  if (!adjustments || !Object.keys(adjustments).some((key) => key !== 'preset')) return null
  const exposure = clampNumber(adjustments.exposure ?? 0, -1, 1)
  const highlights = clampNumber(adjustments.highlights ?? 0, -1, 1)
  const shadows = clampNumber(adjustments.shadows ?? 0, -1, 1)
  const contrast = clampNumber(adjustments.contrast ?? 1, 0, 3)
  const saturation = clampNumber((adjustments.saturation ?? 1) + ((adjustments.temperature ?? 0) * 0.04) - Math.abs(adjustments.tint ?? 0) * 0.02, 0, 3)
  const brightness = clampNumber(1 + exposure + (highlights * 0.08) + (shadows * 0.06), 0, 2)
  const grainOpacity = clampNumber(adjustments.grain ?? 0, 0, 1) * 0.22
  return {
    videoStyle: {
      filter: `brightness(${brightness.toFixed(3)}) contrast(${contrast.toFixed(3)}) saturate(${saturation.toFixed(3)})`,
    },
    grainStyle: {
      opacity: grainOpacity,
      backgroundImage: 'radial-gradient(circle at 20% 30%, rgba(255,255,255,0.55) 0 1px, transparent 1px), radial-gradient(circle at 70% 60%, rgba(0,0,0,0.45) 0 1px, transparent 1px)',
      backgroundSize: '5px 5px, 7px 7px',
    },
    grainOpacity,
  }
}

function timelinePixels(ms: number, zoom = 1): number {
  return Math.max(12, Math.min(640, (ms / 12) * zoom))
}

function timelinePositionPixels(ms: number, zoom = 1): number {
  return Math.max(0, (ms / 12) * zoom)
}

function timelineMsFromPixels(px: number, zoom = 1): number {
  return Math.max(0, Math.round((px / Math.max(zoom, 0.1)) * 12))
}

function renderTimelineClips(
  clips: VideoClip[],
  selectedClipId: string | null,
  zoom: number,
  track: VideoProject['timeline']['tracks'][number],
  onSelectClip: (clip: VideoClip) => void,
  onStartDrag: (event: React.PointerEvent<HTMLElement>, clip: VideoClip, mode: TimelineDragMode) => void,
  onOpenContextMenu: (clip: VideoClip, event: React.MouseEvent<HTMLElement>) => void,
): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  let cursor = 0
  for (const clip of sortClipsByStart(clips)) {
    const startMs = clip.startMs ?? 0
    const durationMs = clip.durationMs ?? 1000
    const inactive = clip.disabled === true
    const trackMuted = track.muted === true
    const trackHidden = track.hidden === true
    const trackLocked = track.locked === true
    const gapMs = Math.max(0, startMs - cursor)
    if (gapMs > 0) {
      nodes.push(
        <div
          key={`gap-${clip.id}`}
          className="flex h-10 shrink-0 items-center justify-center rounded-md border border-dashed border-white/[0.06] bg-black/25 px-2 text-[10px] uppercase tracking-wide text-white/28"
          style={{ width: `${timelinePixels(gapMs, zoom)}px` }}
        >
          Gap
        </div>,
      )
    }
    nodes.push(
      <button
        key={clip.id}
        type="button"
        onClick={() => onSelectClip(clip)}
        onContextMenu={(event) => {
          event.preventDefault()
          onOpenContextMenu(clip, event)
        }}
        onPointerDown={(event) => onStartDrag(event, clip, 'move')}
        className={`group relative h-10 min-w-[112px] cursor-grab rounded-md border px-3 text-left text-xs active:cursor-grabbing ${
          inactive || trackHidden
            ? 'border-white/[0.05] bg-white/[0.025] text-white/28 opacity-55'
            : selectedClipId === clip.id
              ? 'border-[#f97316]/70 bg-[#f97316]/18 text-white'
              : 'border-[#18c7d4]/22 bg-[#172326] text-white/78 hover:border-[#18c7d4]/42 hover:bg-[#1b2c30]'
        }`}
        style={{ width: `${Math.max(112, timelinePixels(durationMs, zoom))}px` }}
      >
        {(inactive || trackMuted || trackHidden || trackLocked) && (
          <span className="absolute right-2 top-1 rounded bg-black/45 px-1 text-[9px] uppercase tracking-wide text-white/40">
            {inactive ? 'Off' : trackHidden ? 'Hidden' : trackMuted ? 'Muted' : 'Locked'}
          </span>
        )}
        <span
          aria-hidden="true"
          onPointerDown={(event) => {
            event.stopPropagation()
            onStartDrag(event, clip, 'trim-start')
          }}
          className="absolute inset-y-1 left-1 w-1.5 cursor-ew-resize rounded-full bg-white/18 opacity-0 transition-opacity group-hover:opacity-100"
        />
        <span className="block truncate font-medium">{clip.label ?? clip.type ?? 'clip'}</span>
        <span className="block truncate text-white/42">{formatDuration(startMs)} - {formatDuration(startMs + durationMs)}</span>
        <span
          aria-hidden="true"
          onPointerDown={(event) => {
            event.stopPropagation()
            onStartDrag(event, clip, 'trim-end')
          }}
          className="absolute inset-y-1 right-1 w-1.5 cursor-ew-resize rounded-full bg-white/18 opacity-0 transition-opacity group-hover:opacity-100"
        />
      </button>,
    )
    cursor = Math.max(cursor, startMs + durationMs)
  }
  return nodes
}

function findLatestVideoRenderAsset(manifest: OutputManifestDTO): OutputAssetDTO | null {
  const primary = manifest.primary
  if (primary?.mimeType?.startsWith('video/')) return primary
  return [...manifest.assets].reverse().find((asset) =>
    asset.mimeType?.startsWith('video/')
    || /\.(mp4|mov|m4v|webm)$/i.test(asset.path)
  ) ?? null
}

function addUserEditVersion(project: VideoProject, summary: string): VideoProject {
  const now = new Date().toISOString()
  return {
    ...project,
    updatedAt: now,
    versions: [
      ...(project.versions ?? []),
      {
        id: crypto.randomUUID(),
        createdAt: now,
        summary,
        actor: 'user',
      },
    ],
  }
}

function PanelTitle({ title, value }: { title: string; value?: string }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs font-medium uppercase tracking-wide text-white/42">
      <span>{title}</span>
      {value && <span>{value}</span>}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-white/[0.08] bg-white/[0.035] p-2">
      <div className="text-xs text-white/42">{label}</div>
      <div className="mt-1 truncate text-sm font-medium text-white/78">{value}</div>
    </div>
  )
}

function MetricPill({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex h-6 items-center gap-1 rounded-md bg-white/[0.055] px-2">
      <span className="text-white/34">{label}</span>
      <span className="font-medium text-white/72">{value}</span>
    </span>
  )
}

function EmptyText({ children }: { children: React.ReactNode }) {
  return <div className="rounded-md border border-white/[0.08] bg-white/[0.025] p-3 text-sm text-white/42">{children}</div>
}

function Field({ placeholder, value, onChange }: { placeholder: string; value: string; onChange: (value: string) => void }) {
  return (
    <input
      aria-label={placeholder}
      placeholder={placeholder}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-8 rounded-md border border-white/[0.07] bg-black/30 px-2 text-sm text-white/72 outline-none placeholder:text-white/28 focus:border-[#18c7d4]/60"
    />
  )
}

function ReadOnlyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 text-xs text-white/42">
      {label}
      <div className="h-8 truncate rounded-md border border-white/[0.08] bg-black/25 px-2 py-1.5 text-sm text-white/55">{value}</div>
    </div>
  )
}

function IconButton({ label, onClick, disabled = false, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="flex h-7 min-w-9 items-center justify-center rounded-md border border-white/[0.08] bg-white/[0.055] px-2 text-white/68 outline-none hover:border-[#18c7d4]/45 hover:bg-white/[0.09] hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
    >
      {children}
    </button>
  )
}

function NumberField({ label, value, onChange, compact = false }: { label: string; value: number; onChange: (value: number) => void; compact?: boolean }) {
  return (
    <label className={`${compact ? 'flex items-center gap-1' : 'grid gap-1'} text-xs text-white/42`}>
      {label}
      <input type="number" value={value} onChange={(event) => onChange(Number(event.target.value))} className={`${compact ? 'w-24' : 'w-full'} h-8 rounded-md border border-white/[0.08] bg-black/35 px-2 text-sm text-white/72 outline-none focus:border-[#f97316]/50`} />
    </label>
  )
}

function AdjustmentField({ label, min, max, step, value, onChange }: { label: string; min: number; max: number; step: number; value: number; onChange: (value: number) => void }) {
  const percent = ((value - min) / (max - min)) * 100
  return (
    <label className="grid gap-0.5 rounded-md px-1 py-0.5 text-[11px] text-white/46">
      <span className="flex items-center justify-between gap-2">
        <span className="font-medium text-white/58">{label}</span>
        <span className="min-w-11 rounded border border-white/[0.055] bg-black/30 px-1.5 py-0.5 text-right text-[10px] tabular-nums text-white/62">{value.toFixed(2)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="video-adjust-slider h-3 w-full appearance-none bg-transparent"
        style={{ '--video-adjust-fill': `${percent}%` } as React.CSSProperties}
      />
    </label>
  )
}
