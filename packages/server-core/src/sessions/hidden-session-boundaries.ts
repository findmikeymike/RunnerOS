import type { AgentMessageReceipt } from '@craft-agent/shared/agent-messaging'

export type SessionVisibilityOptions = { includeHidden?: boolean }

export function shouldExposeSessionInLists(session: { hidden?: boolean }, options?: SessionVisibilityOptions): boolean {
  return options?.includeHidden === true || session.hidden !== true
}

/** Hidden jobs are addressable by their owner, not arbitrary agent traffic. */
export function assertCanSendAgentMessageToSession(
  target: { id: string; hidden?: boolean },
  senderSessionId: string,
  deliveryMode: 'normal' | 'passive' | undefined,
  receipts: Pick<AgentMessageReceipt, 'childSessionId' | 'parentSessionId'>[],
): void {
  if (!target.hidden) return
  if (deliveryMode === 'passive' && receipts.some(receipt => (
    receipt.childSessionId === senderSessionId && receipt.parentSessionId === target.id
  ))) return
  throw new Error(`Session "${target.id}" is hidden and cannot receive unrelated agent messages.`)
}
