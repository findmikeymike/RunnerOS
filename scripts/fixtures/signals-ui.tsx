import React from 'react'
import { createRoot } from 'react-dom/client'
import { SignalHandoffNotice } from '../../apps/electron/src/renderer/components/app-shell/SignalHandoffNotice'
import { SignalIdeasActions } from '../../apps/electron/src/renderer/components/app-shell/SignalIdeasActions'
import { useSignalTracks } from '../../apps/electron/src/renderer/hooks/useSignalTracks'

const host = window as any
const root = createRoot(document.getElementById('root')!)
host.reference = { hqWorkspaceId: 'hq', outputId: 'report', entryId: 'idea', contentHash: 'hash' }
host.lookup = 'attached'
host.ideaResult = 'error'
host.polls = []
host.setInterval = (callback: () => void) => { host.polls.push(callback); return host.polls.length }
host.clearInterval = (id: number) => { host.polls[id - 1] = null }
host.poll = () => host.polls.forEach((callback: (() => void) | null) => callback?.())
host.electronAPI = {
  getSignalState: async (workspaceId: string) => { host.stateReads = (host.stateReads ?? 0) + 1; return { hqWorkspaceId: workspaceId, tracks: {} } },
  getAutomations: async () => null,
  onWorkspaceContextChanged: (listener: (id: string) => void) => { host.contextChanged = listener; return () => {} },
  onAutomationsChanged: (listener: () => void) => { host.automationsChanged = listener; return () => {} },
  startSignalResearch: async () => new Promise(resolve => { host.finishResearch = resolve }),
  getSignalHandoff: async () => {
    if (host.lookup === 'pending') return new Promise(resolve => { host.resolveLookup = resolve })
    if (host.lookup === 'error') throw new Error('Unavailable')
    return host.lookup === 'attached' ? host.reference : null
  },
  getSignalIdeas: async () => {
    if (host.ideaResult === 'error') throw new Error('Unavailable')
    if (host.ideaResult === 'refused') return { ok: false, entries: [] }
    return { ok: true, entries: host.ideaResult === 'empty' ? [] : [{ kind: 'idea', title: 'A useful idea', reference: host.reference }] }
  },
  clearSignalHandoff: async () => { if (host.failDetach) throw new Error('Could not detach'); host.lookup = 'empty' },
}
host.renderNotice = (session = 'chat', processing = false) => root.render(<SignalHandoffNotice key={session} sessionId={session} workspaceId="hq" processing={processing} onGuardChange={(value) => { host.guarded = value }} />)
host.renderIdeas = (outputId = 'report') => root.render(<SignalIdeasActions key={outputId} workspaceId="hq" outputId={outputId} revision="one" onDevelop={() => { host.developed = true }} />)
const ensure = async () => 'digest'
function TrackHarness({ workspaceId }: { workspaceId: string }) {
  const tracks = useSignalTracks(workspaceId, ensure)
  host.tracks = tracks
  return <button disabled={tracks.busy || !tracks.state} onClick={() => { void tracks.start('industry', 'scan', 'test') }}>{workspaceId}: {tracks.busy ? 'Busy' : 'Ready'}</button>
}
host.renderTracks = (workspaceId = 'hq') => root.render(<TrackHarness key={workspaceId} workspaceId={workspaceId} />)
