import { app, ipcMain, systemPreferences } from 'electron'
import {
  cleanupActiveChatDictationTemporaryDirectories,
  cleanupChatDictationTemporaryDirectories,
  getChatDictationAvailability,
  transcribeChatDictation,
  type ChatDictationAvailability,
  type ChatDictationInput,
  type ChatDictationResult,
} from './chat-dictation-service'

export type ChatDictationPermission = 'granted' | 'denied' | 'restricted' | 'not-determined' | 'unknown'

const activeTranscriptions = new Map<number, number>()
let handlersRegistered = false

export function registerChatDictationIpcHandlers(): void {
  if (handlersRegistered) return
  handlersRegistered = true

  cleanupChatDictationTemporaryDirectories()
  app.once('before-quit', cleanupActiveChatDictationTemporaryDirectories)

  ipcMain.handle('__chat-dictation:availability', async (): Promise<ChatDictationAvailability> => (
    getChatDictationAvailability()
  ))

  ipcMain.handle('__chat-dictation:request-access', async (): Promise<ChatDictationPermission> => {
    if (process.platform !== 'darwin') return 'granted'

    const current = normalizePermission(systemPreferences.getMediaAccessStatus('microphone'))
    if (current !== 'not-determined') return current
    const granted = await systemPreferences.askForMediaAccess('microphone')
    return granted ? 'granted' : normalizePermission(systemPreferences.getMediaAccessStatus('microphone'))
  })

  ipcMain.handle(
    '__chat-dictation:transcribe',
    async (event, input: ChatDictationInput): Promise<ChatDictationResult> => {
      const webContentsId = event.sender.id
      const activeCount = activeTranscriptions.get(webContentsId) ?? 0
      if (activeCount >= 2) {
        return { ok: false, error: 'Two dictations are already being transcribed. Wait for one to finish.' }
      }

      activeTranscriptions.set(webContentsId, activeCount + 1)
      try {
        return await transcribeChatDictation(input)
      } finally {
        const remaining = (activeTranscriptions.get(webContentsId) ?? 1) - 1
        if (remaining > 0) activeTranscriptions.set(webContentsId, remaining)
        else activeTranscriptions.delete(webContentsId)
      }
    },
  )
}

function normalizePermission(value: string): ChatDictationPermission {
  if (value === 'granted' || value === 'denied' || value === 'restricted' || value === 'not-determined') return value
  return 'unknown'
}
