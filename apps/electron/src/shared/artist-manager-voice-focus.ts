import type { VoiceHandoffTarget, VoiceHandoffProposal } from './artist-manager-voice-handoff'

/** Local voice candidate. Provider credentials never cross this contract. */
export type VoiceFocusThinking = 'off' | 'low'

export type VoiceFocusRegisterRequest = {
  workspaceId: string
  artistName?: string
  systemPrompt: string
  /** Diagnostic override only; still uses the saved voice connection. */
  model?: string
  thinking?: VoiceFocusThinking
  handoffTargets?: VoiceHandoffTarget[]
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
  /** App-originated opener; never an artist utterance or model instruction. */
  opening?: boolean
  systemPrompt?: string
}

export type VoiceFocusCancelRequest = { sessionId: string; turnId: string }
export type VoiceFocusRegistration = VoiceFocusRegisterRequest
export type VoiceFocusTurn = VoiceFocusTurnRequest
export type VoiceFocusCancel = VoiceFocusCancelRequest
export type VoiceFocusCompletion = {
  type: 'completion'
  finishReason: 'stop' | 'length' | 'toolUse' | 'other'
  outputTokens?: number
  reasoningTokens?: number
}
export type VoiceFocusEvent = { sessionId: string; turnId: string } & (
  | { type: 'text_delta'; delta: string }
  | VoiceFocusCompletion
  | { type: 'handoff_ready'; proposal: VoiceHandoffProposal }
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
  reasoningOutputTokens: 2048,
  timeoutMs: 45_000,
  owners: 32,
} as const
