import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { TooltipProvider } from '@craft-agent/ui'
import { ChatAgentHeader } from '../../apps/electron/src/renderer/components/app-shell/ChatAgentHeader'
import { ChatAgentTaskModeBar } from '../../apps/electron/src/renderer/components/app-shell/ChatAgentTaskModeBar'
import { DropdownMenuItem } from '../../apps/electron/src/renderer/components/ui/dropdown-menu'
import type { AgentTaskModeDefinition } from '@craft-agent/shared/agent-definitions/types'

declare global {
  interface Window {
    focusModes: AgentTaskModeDefinition[]
    focusClicks: string[]
    renderFocusHeader: (name?: string) => void
  }
}
window.focusClicks = []
function Preview({ name }: { name: string }) {
  const [selected, setSelected] = useState<string>()
  return (
    <TooltipProvider>
      <div className="@container/panel" style={{ background: '#101113', minHeight: '100vh', color: 'white' }}>
        <ChatAgentHeader name={name} description="Shape a distinctive world around your music."
          menu={<DropdownMenuItem>Session details</DropdownMenuItem>}
          focusControls={<ChatAgentTaskModeBar modes={window.focusModes} selectedModeId={selected}
            conversationStarted={Boolean(selected)} onSelect={id => { window.focusClicks.push(id); setSelected(id) }} />}
        />
        <main style={{ maxWidth: 760, margin: '72px auto', padding: '0 24px', color: '#b9babd', fontSize: 13 }}>
          <p style={{ color: '#e6e6e8' }}>Your next chapter starts here.</p>
          <p style={{ marginTop: 12 }}>Choose a focus, then make it yours.</p>
        </main>
      </div>
    </TooltipProvider>
  )
}
const root = createRoot(document.getElementById('root')!)
window.renderFocusHeader = (name = 'Branding Agent') => root.render(<Preview key={name} name={name} />)
window.renderFocusHeader()
