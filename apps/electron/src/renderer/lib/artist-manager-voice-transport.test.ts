import { describe, expect, test } from 'bun:test'
import type { SessionEvent } from '../../shared/types'
import { createArtistManagerVoiceTransport } from './artist-manager-voice-transport'

describe('Artist Manager voice transport', () => {
  test('streams one manager session response without a second LLM', async () => {
    let listener: ((event: SessionEvent) => void) | null = null
    const transport = createArtistManagerVoiceTransport({
      ensureSession: async () => ({ id: 'manager-session' }),
      sendMessage: async (sessionId, text) => {
        expect(sessionId).toBe('manager-session')
        expect(text).toBe('What matters this week?')
        queueMicrotask(() => {
          listener?.({ type: 'text_delta', sessionId, delta: 'Protect ' })
          listener?.({ type: 'text_delta', sessionId, delta: 'the release.' })
          listener?.({ type: 'text_complete', sessionId, text: 'Protect the release.' })
          listener?.({ type: 'complete', sessionId })
        })
      },
      cancelProcessing: async () => {},
      onSessionEvent: (handler) => {
        listener = handler
        return () => { listener = null }
      },
    })
    const stream = await transport.generateReply({
      userText: 'What matters this week?',
      contextJson: '[]',
      signal: new AbortController().signal,
    })
    const chunks: string[] = []
    for await (const event of stream) chunks.push(event.text)
    expect(chunks.join('')).toBe('Protect the release.')
  })

  test('cancels the manager turn when voice is interrupted', async () => {
    let cancelled = false
    const controller = new AbortController()
    const transport = createArtistManagerVoiceTransport({
      ensureSession: async () => ({ id: 'manager-session' }),
      sendMessage: async () => queueMicrotask(() => controller.abort(new Error('barge in'))),
      cancelProcessing: async () => { cancelled = true },
      onSessionEvent: () => () => {},
    })
    const stream = await transport.generateReply({ userText: 'Stop', contextJson: '[]', signal: controller.signal })
    await expect(async () => {
      for await (const _event of stream) { /* drain */ }
    }).toThrow('barge in')
    expect(cancelled).toBe(true)
  })
})
