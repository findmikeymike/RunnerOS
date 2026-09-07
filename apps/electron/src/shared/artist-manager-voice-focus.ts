/** Local voice candidate. Provider credentials never cross this contract. */
export type VoiceFocusThinking = 'off' | 'low'

export type VoiceFocusRegisterRequest = {
  workspaceId: string
  systemPrompt: string
  model?: string
  thinking?: VoiceFocusThinking
}

export type VoiceFocusSession = {
  sessionId: string
  model: string
  connection: string
  thinking: VoiceFocusThinking
}

export type VoiceFocusTurnRequest = {
  sessionId: string
  turnId: string
  text: string
  systemPrompt?: string
}

export type VoiceFocusCancelRequest = { sessionId: string; turnId: string }
export type VoiceFocusRegistration = VoiceFocusRegisterRequest
export type VoiceFocusTurn = VoiceFocusTurnRequest
export type VoiceFocusCancel = VoiceFocusCancelRequest
export type VoiceFocusEvent = { sessionId: string; turnId: string } & (
  | { type: 'text_delta'; delta: string }
  | { type: 'done' }
  | { type: 'error'; message: string }
)

export const VOICE_FOCUS_LIMITS = {
  promptChars: 12_000,
  inputChars: 2_000,
  historyChars: 12_000,
  historyTurns: 8,
  outputChars: 8_000,
  outputTokens: 512,
  timeoutMs: 45_000,
  owners: 32,
} as const
