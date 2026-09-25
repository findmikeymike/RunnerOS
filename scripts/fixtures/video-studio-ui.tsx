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
  getOutput: async () => ({ id: 'fixture-output', title: 'Synthetic video', summary: '', kind: 'video', status: 'draft', assets, primary: assets.find(a => a.id === 'video-render-result'), origin: { type: 'agent' }, receipts: [], links: [] }),
  disk: () => diskText,
  external: (title: string) => { diskText = JSON.stringify({ ...JSON.parse(diskText), title }, null, 2) + '\n'; listeners.forEach(fn => fn('fixture-workspace')) },
}
w.electronAPI = {
  onOutputsUpdated: (fn: (workspace: string) => void) => { listeners.add(fn); return () => listeners.delete(fn) },
  readOutputAssetText: async () => diskText,
  readOutputAssetDataUrl: async (_workspace: string, _output: string, asset: string) => asset === 'video-render-result' ? `${location.origin}/render.mp4` : `${location.origin}/source.mp4`,
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
state.mount()
