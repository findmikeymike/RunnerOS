import type { Session, TransportConnectionState } from '../../shared/types'

interface MessageLoadMeta {
  messageCount?: number
  lastFinalMessageId?: string
}

export interface SessionMessagesLoadStateInput {
  session: Pick<Session, 'messages' | 'messageCount' | 'lastFinalMessageId'> | null | undefined
  sessionMeta: MessageLoadMeta | null | undefined
  messagesLoaded: boolean
  loadError?: string | null
}

export interface SessionMessagesLoadState {
  messagesReady: boolean
  messagesLoading: boolean
  hasStaleLoadedFlag: boolean
  error: string | null
}

/** Resolve lazy-load state from both the flag and the actual transcript payload. */
export function deriveSessionMessagesLoadState({
  session,
  sessionMeta,
  messagesLoaded,
  loadError,
}: SessionMessagesLoadStateInput): SessionMessagesLoadState {
  const messageCount = session?.messageCount ?? sessionMeta?.messageCount
  const hasInMemoryMessages = (session?.messages?.length ?? 0) > 0
  const hasExpectedPersistedMessages = (messageCount ?? 0) > 0
    || !!session?.lastFinalMessageId
    || !!sessionMeta?.lastFinalMessageId
  const isKnownEmptySession = !!session
    && messageCount === 0
    && !session.lastFinalMessageId
    && !sessionMeta?.lastFinalMessageId
  const hasStaleLoadedFlag = messagesLoaded && hasExpectedPersistedMessages && !hasInMemoryMessages
  const messagesReady = (messagesLoaded && !hasStaleLoadedFlag)
    || hasInMemoryMessages
    || isKnownEmptySession
  const error = messagesReady ? null : (loadError ?? null)

  return {
    messagesReady,
    messagesLoading: !messagesReady && !error,
    hasStaleLoadedFlag,
    error,
  }
}

export function shouldTreatSessionLoadFailureAsTransportFallback(
  state: TransportConnectionState | null | undefined,
): boolean {
  if (!state || state.mode !== 'remote') return false

  if (state.lastError && ['auth', 'network', 'timeout'].includes(state.lastError.kind)) {
    return true
  }

  return state.status === 'connecting'
    || state.status === 'reconnecting'
    || state.status === 'failed'
    || state.status === 'disconnected'
}

export function formatSessionLoadFailure(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message
  if (typeof error === 'string' && error.trim()) return error
  return 'Unknown error'
}
