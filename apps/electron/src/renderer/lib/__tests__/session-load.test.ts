import { describe, expect, it } from 'bun:test'
import type { TransportConnectionState } from '../../../shared/types'
import { deriveSessionMessagesLoadState, formatSessionLoadFailure, shouldTreatSessionLoadFailureAsTransportFallback } from '../session-load'

function createState(overrides?: Partial<TransportConnectionState>): TransportConnectionState {
  return {
    mode: 'remote',
    status: 'connected',
    url: 'wss://remote.example.test',
    attempt: 0,
    updatedAt: Date.now(),
    ...overrides,
  }
}

describe('shouldTreatSessionLoadFailureAsTransportFallback', () => {
  it('returns true for remote reconnecting state', () => {
    expect(shouldTreatSessionLoadFailureAsTransportFallback(
      createState({ status: 'reconnecting' }),
    )).toBe(true)
  })

  it('returns true for remote auth/network/timeout failures', () => {
    expect(shouldTreatSessionLoadFailureAsTransportFallback(
      createState({
        status: 'connected',
        lastError: { kind: 'auth', message: 'Bad token' },
      }),
    )).toBe(true)
  })

  it('returns false for remote connected state without transport errors', () => {
    expect(shouldTreatSessionLoadFailureAsTransportFallback(
      createState({ status: 'connected' }),
    )).toBe(false)
  })

  it('returns false for local transport state', () => {
    expect(shouldTreatSessionLoadFailureAsTransportFallback(
      createState({ mode: 'local', status: 'failed' }),
    )).toBe(false)
  })
})

describe('formatSessionLoadFailure', () => {
  it('prefers Error.message', () => {
    expect(formatSessionLoadFailure(new Error('boom'))).toBe('boom')
  })

  it('falls back to a generic message', () => {
    expect(formatSessionLoadFailure(null)).toBe('Unknown error')
  })
})

describe('deriveSessionMessagesLoadState', () => {
  it('renders in-memory messages even when the loaded flag is stale', () => {
    const state = deriveSessionMessagesLoadState({
      session: { messages: [{ id: 'm1' }] as never[], messageCount: 1 },
      sessionMeta: { messageCount: 1 },
      messagesLoaded: false,
    })
    expect(state.messagesReady).toBe(true)
    expect(state.messagesLoading).toBe(false)
  })

  it('detects an empty payload behind a stale loaded flag', () => {
    const state = deriveSessionMessagesLoadState({
      session: { messages: [], messageCount: 2, lastFinalMessageId: 'm2' },
      sessionMeta: { messageCount: 2, lastFinalMessageId: 'm2' },
      messagesLoaded: true,
    })
    expect(state.hasStaleLoadedFlag).toBe(true)
    expect(state.messagesLoading).toBe(true)
  })

  it('shows a load error instead of an infinite spinner', () => {
    const state = deriveSessionMessagesLoadState({
      session: { messages: [], messageCount: 2 },
      sessionMeta: { messageCount: 2 },
      messagesLoaded: false,
      loadError: 'transport timed out',
    })
    expect(state.messagesLoading).toBe(false)
    expect(state.error).toBe('transport timed out')
  })
})
