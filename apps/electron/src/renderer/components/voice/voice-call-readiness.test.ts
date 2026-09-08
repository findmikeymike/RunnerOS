import { describe, expect, test } from 'bun:test'
import { getVoiceCallPresentation } from './voice-call-readiness'

const preparedCall = {
  open: true, prepared: true, preparing: false, running: false, starting: false,
  stopping: false, installing: false, providerReady: true, error: null, status: 'Ready when you are',
}

describe('voice call readiness', () => {
  test('configuration alone does not claim warmup succeeded', () => {
    expect(getVoiceCallPresentation({ ...preparedCall, prepared: false })).toEqual({ status: 'Ready to connect', showReady: false })
    expect(getVoiceCallPresentation(preparedCall)).toEqual({ status: 'Ready when you are', showReady: true })
  })

  test('stale preparation cannot show a green ready check across lifecycle boundaries', () => {
    for (const change of [
      { open: false }, { providerReady: false }, { preparing: true }, { running: true },
      { starting: true }, { stopping: true }, { installing: true }, { error: 'Disconnected' },
    ]) {
      expect(getVoiceCallPresentation({ ...preparedCall, ...change }).showReady).toBe(false)
    }
  })

  test('an error supersedes warmup or connection status, while shutdown remains explicit', () => {
    expect(getVoiceCallPresentation({ ...preparedCall, error: 'Failed', preparing: true }).status).toBe('Connection needs attention')
    expect(getVoiceCallPresentation({ ...preparedCall, error: 'Failed', starting: true }).status).toBe('Connection needs attention')
    expect(getVoiceCallPresentation({ ...preparedCall, error: 'Failed', stopping: true }).status).toBe('Ending call…')
  })
})
