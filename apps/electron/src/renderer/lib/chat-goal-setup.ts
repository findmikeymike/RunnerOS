import type { CreateChatGoalInput } from '@craft-agent/shared/sessions'

export interface PendingChatGoalSetup {
  sessionId: string
  proposal: CreateChatGoalInput
  confirmationNonce: string
}

const pendingBySession = new Map<string, PendingChatGoalSetup>()

export function rememberChatGoalSetup(detail: PendingChatGoalSetup): void {
  pendingBySession.set(detail.sessionId, detail)
}

export function publishChatGoalSetup(detail: PendingChatGoalSetup): void {
  rememberChatGoalSetup(detail)
  window.dispatchEvent(new CustomEvent('craft:open-goal', { detail }))
}

export function takePendingChatGoalSetup(sessionId: string): PendingChatGoalSetup | undefined {
  const pending = pendingBySession.get(sessionId)
  if (pending) pendingBySession.delete(sessionId)
  return pending
}
