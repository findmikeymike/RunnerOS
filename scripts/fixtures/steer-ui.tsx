import React from 'react'
import { createRoot } from 'react-dom/client'
import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import { TooltipProvider } from '@radix-ui/react-tooltip'
import { InputContainer } from '../../apps/electron/src/renderer/components/app-shell/input/InputContainer'
import { EscapeInterruptProvider } from '../../apps/electron/src/renderer/context/EscapeInterruptContext'

const host = window as any
void i18next.use(initReactI18next).init({ lng: 'en', resources: { en: { translation: {
  chat: { stopResponse: 'Stop response' }, shortcuts: { sendMessage: 'Send message' },
} } }, initImmediate: false })
host.sent = []
host.stops = 0
host.electronAPI = {
  getAutoCapitalisation: async () => false,
  getSendMessageKey: async () => host.sendKey ?? 'enter',
  getSpellCheck: async () => false,
  getPendingPlanExecution: async () => null,
}
const root = createRoot(document.getElementById('root')!)
host.renderInput = (options = {}) => root.render(
  <TooltipProvider><EscapeInterruptProvider>
    <InputContainer
      currentModel="claude-sonnet-4-6"
      onModelChange={() => {}}
      sessionId="steer-test"
      isProcessing
      onSubmit={(message) => { host.sent.push(message) }}
      onStop={() => { host.stops++ }}
      {...options}
    />
  </EscapeInterruptProvider></TooltipProvider>,
)
