import React from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { MainContentPanel } from '../../apps/electron/src/renderer/components/app-shell/MainContentPanel'

const host = window as any
host.saved = []
host.drafts = { A: 'Restored A draft', B: 'Restored B draft' }
host.activeSession = 'A'
host.fixtureContext = {
  activeWorkspaceId: 'same-workspace', workspaces: [], sessionStatuses: [], labels: [],
  skills: [], enabledSources: [],
}
const root = createRoot(document.getElementById('root')!)
host.renderSession = (sessionId: string) => {
  host.activeSession = sessionId
  flushSync(() => root.render(<MainContentPanel navStateOverride={{ navigator: 'sessions', details: { type: 'session', sessionId } } as any} />))
}
host.renderSession('A')
