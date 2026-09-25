import React from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import VideoStudioPage from '../../apps/electron/src/renderer/pages/VideoStudioPage'

const w = window as any
const initialProject = {
  version: 1, id: 'synthetic-project', workspaceId: 'fixture-workspace', title: 'Synthetic video',
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  settings: { aspectRatio: '16:9', width: 160, height: 90, fps: 10 },
  media: [{ id: 'source', type: 'video', label: 'Synthetic source', path: '/synthetic/source.mp4', durationMs: 6000, source: { kind: 'user-import' } }],
  timeline: { durationMs: 2000, tracks: [{ id: 'video-main', type: 'video', label: 'Video', clips: [{ id: 'clip', mediaId: 'source', type: 'video', label: 'Synthetic clip', startMs: 0, durationMs: 2000, sourceInMs: 500, sourceOutMs: 4500, speed: 2 }] }], markers: [] },
  captions: [], overlays: [], effects: [], templates: [], exports: [], versions: [], agentEvents: [],
}
const initialText = JSON.stringify(initialProject, null, 2) + '\n'
let diskText = initialText
let listeners = new Set<(workspace: string) => void>()
let assets: any[] = [
  { id: 'project', path: 'video.runner-video.json', label: 'Video project', role: 'supporting', mimeType: 'application/json' },
  { id: 'video-media-source', path: 'media/source.mp4', label: 'Source', role: 'supporting', mimeType: 'video/mp4' },
]
const state = w.fixture = {
  calls: [] as any[], navigations: [] as string[], drafts: [] as any[], toasts: [] as any[], initialText,
  status: 'started', holdSave: false, finishSave: null as null | (() => void),
  holdMedia: null as string | null, missingMedia: null as string | null,
  pendingMedia: {} as Record<string, () => void>, mediaReads: [] as string[],
  mediaRequests: [] as Array<{ asset: string; expectedSourcePath?: string }>,
  getOutput: async () => ({ id: 'fixture-output', title: 'Synthetic video', summary: '', kind: 'video', status: 'draft', assets, primary: assets.find(a => a.id === 'video-render-result'), origin: { type: 'agent' }, receipts: [], links: [] }),
  disk: () => diskText,
  external: (title: string) => { diskText = JSON.stringify({ ...JSON.parse(diskText), title }, null, 2) + '\n'; listeners.forEach(fn => fn('fixture-workspace')) },
  relink: (id: string, path: string) => {
    const project = JSON.parse(diskText)
    project.media = project.media.map((media: any) => media.id === id ? { ...media, path } : media)
    diskText = JSON.stringify(project, null, 2) + '\n'
    listeners.forEach(fn => fn('fixture-workspace'))
  },
}
w.electronAPI = {
  onOutputsUpdated: (fn: (workspace: string) => void) => { listeners.add(fn); return () => listeners.delete(fn) },
  readOutputAssetText: async () => diskText,
  readOutputAssetDataUrl: async (_workspace: string, _output: string, asset: string, expectedSourcePath?: string) => {
    state.mediaReads.push(asset)
    state.mediaRequests.push({ asset, expectedSourcePath })
    const importedPaths: Record<string, string> = { 'video-media-source': '/synthetic/source.mp4', 'video-media-clock': '/synthetic/clock.mp4', 'video-media-overlay': '/synthetic/overlay.png' }
    if (expectedSourcePath !== undefined && importedPaths[asset] !== expectedSourcePath) throw new Error('Media source mismatch: reimport this media before previewing')
    if (state.holdMedia === asset) await new Promise<void>(resolve => { state.pendingMedia[asset] = resolve })
    if (state.missingMedia === asset) throw new Error('Synthetic media unavailable')
    const names: Record<string, string> = { 'video-render-result': 'render.mp4', 'video-media-clock': 'clock.mp4', 'video-media-overlay': 'overlay.png' }
    return `${location.origin}/${names[asset] ?? 'source.mp4'}`
  },
  writeOutputAssetText: async (workspace: string, output: string, asset: string, content: string, expected: string) => {
    state.calls.push({ action: 'save', workspace, output, asset, content, expected })
    if (state.holdSave) await new Promise<void>(resolve => { state.finishSave = resolve })
    if (expected !== diskText) throw new Error('Synthetic concurrent edit conflict')
    diskText = content
    listeners.forEach(fn => fn(workspace))
    return true
  },
  exportVideoStudio: async () => {
    state.calls.push({ action: 'export' })
    assets = [...assets.filter(a => a.id !== 'video-render-result'), { id: 'video-render-result', path: 'renders/result.mp4', label: 'Result', role: 'primary', mimeType: 'video/mp4' }]
    return { ok: true, assetId: 'video-render-result', rendered: true }
  },
  runVideoStudioAgent: async (_workspace: string, outputId: string, prompt: string) => {
    state.calls.push({ action: 'agent', prompt })
    return { ok: true, outputId, status: state.status, sessionId: 'fixture-session', message: `Fixture ${state.status}`, ...(state.status === 'draft' ? { draftInput: `Saved edit request: ${prompt}` } : {}) }
  },
}
const root = createRoot(document.getElementById('root')!)
state.mount = () => flushSync(() => root.render(<VideoStudioPage workspaceId="fixture-workspace" outputId="fixture-output" />))
state.unmount = () => flushSync(() => root.render(null))
state.composition = (overlappingVideo = false) => {
  state.unmount()
  const project = {
    ...initialProject, id: 'synthetic-composition', title: 'Composition fixture',
    settings: { aspectRatio: 'custom', width: 320, height: 240, fps: 10 },
    media: [
      { id: 'clock', type: 'video', label: 'Color clock', path: '/synthetic/clock.mp4', durationMs: 4000, width: 320, height: 240 },
      { id: 'overlay', type: 'image', label: 'Blue and yellow', path: '/synthetic/overlay.png', width: 80, height: 80 },
    ],
    timeline: { durationMs: 2400, markers: [], tracks: [
      { id: 'base', type: 'video', label: 'Base', clips: [{ id: 'clock-clip', type: 'video', mediaId: 'clock', startMs: 0, durationMs: 1500, sourceInMs: 500, sourceOutMs: 3500, speed: 2 }] },
      { id: 'image', type: 'image', label: 'Overlay', clips: [{ id: 'image-clip', type: 'image', mediaId: 'overlay', startMs: 0, durationMs: 1000,
        crop: { x: 0, y: 0, width: 40, height: 80 }, transform: { scale: 0.25, y: -65 }, opacity: 0.5,
        keyframes: [{ timeMs: 0, property: 'x', value: -80 }, { timeMs: 1000, property: 'x', value: 80 }] }] },
      { id: 'text', type: 'text', label: 'Titles', clips: [{ id: 'title-clip', type: 'text', startMs: 500, durationMs: 450, text: { text: 'VISIBLE TITLE' } }] },
      { id: 'caption', type: 'caption', label: 'Captions', clips: [{ id: 'caption-clip', type: 'caption', startMs: 1000, durationMs: 400, captionCueIds: ['remapped'] }] },
      { id: 'hidden', type: 'text', label: 'Hidden', hidden: true, clips: [{ id: 'hidden-clip', type: 'text', startMs: 0, durationMs: 2400, text: { text: 'HIDDEN TEXT' } }] },
      { id: 'disabled', type: 'text', label: 'Disabled', clips: [{ id: 'disabled-clip', type: 'text', disabled: true, startMs: 0, durationMs: 2400, text: { text: 'DISABLED TEXT' } }] },
      { id: 'tail', type: 'image', label: 'Tail', clips: [{ id: 'tail-clip', type: 'image', mediaId: 'overlay', startMs: 2200, durationMs: 200 }] },
    ] },
    captions: [{ id: 'captions', label: 'Captions', cues: [{ id: 'remapped', startMs: 0, durationMs: 300, text: 'CAPTION HERE' }] }],
  }
  if (overlappingVideo) {
    project.timeline = { durationMs: 1500, markers: [], tracks: [
      { id: 'left', type: 'video', label: 'Left source', clips: [{ id: 'left-clip', type: 'video', mediaId: 'clock', startMs: 0, durationMs: 1500, sourceInMs: 0, sourceOutMs: 1500, speed: 1, transform: { scale: 0.5, x: -80 } }] },
      { id: 'right', type: 'video', label: 'Right source', clips: [{ id: 'right-clip', type: 'video', mediaId: 'clock', startMs: 0, durationMs: 1500, sourceInMs: 2000, sourceOutMs: 2750, speed: 0.5, transform: { scale: 0.5, x: 80 } }] },
    ] } as any
    project.captions = []
  }
  diskText = JSON.stringify(project, null, 2) + '\n'
  assets = [assets[0],
    { id: 'video-media-clock', path: 'media/clock.mp4', label: 'Clock', role: 'supporting', mimeType: 'video/mp4' },
    { id: 'video-media-overlay', path: 'media/overlay.png', label: 'Overlay', role: 'supporting', mimeType: 'image/png' },
  ]
  state.mount()
}
state.mount()
