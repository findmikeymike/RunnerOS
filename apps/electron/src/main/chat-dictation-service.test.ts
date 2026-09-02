import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CHAT_DICTATION_TEMP_PREFIX,
  cleanupChatDictationTemporaryDirectories,
  dictationFileExtension,
  getChatDictationAvailability,
  transcribeChatDictation,
  validateChatDictationInput,
} from './chat-dictation-service'

describe('chat dictation service', () => {
  test('accepts supported recorder MIME types with codec parameters', () => {
    expect(dictationFileExtension('audio/webm;codecs=opus')).toBe('webm')
    expect(dictationFileExtension('audio/mp4')).toBe('m4a')
    expect(dictationFileExtension('video/webm')).toBeNull()
  })

  test('rejects empty recordings before invoking transcription', () => {
    expect(validateChatDictationInput({ audioData: new Uint8Array(), mimeType: 'audio/webm' }))
      .toBe('The microphone recording was empty.')
  })

  test('reports an unavailable packaged runtime before recording', async () => {
    const result = await getChatDictationAvailability({
      inspectRuntime: async () => ({
        available: false,
        modelInstalled: false,
        blockers: [{ code: 'missing_whisper_cli', message: 'Local Whisper is missing.' }],
      }),
    })
    expect(result).toEqual({
      available: false,
      modelInstalled: false,
      error: 'Local Whisper is missing.',
    })
  })

  test('returns plain speech and removes temporary audio afterward', async () => {
    let observedAudioFile = ''
    const result = await transcribeChatDictation(
      { audioData: new Uint8Array([1, 2, 3]), mimeType: 'audio/webm;codecs=opus' },
      {
        workspaceRootPath: '/tmp/test-workspace',
        transcribe: async ({ audioFile }) => {
          observedAudioFile = audioFile
          expect(existsSync(audioFile)).toBe(true)
          return { ok: true, lyricsText: '  hello   from dictation  ' }
        },
      },
    )

    expect(result).toEqual({ ok: true, transcript: 'hello from dictation' })
    expect(existsSync(observedAudioFile)).toBe(false)
  })

  test('removes temporary audio when transcription fails', async () => {
    let observedAudioFile = ''
    const result = await transcribeChatDictation(
      { audioData: new Uint8Array([1, 2, 3]), mimeType: 'audio/webm' },
      {
        transcribe: async ({ audioFile }) => {
          observedAudioFile = audioFile
          return { ok: false, error: 'engine failed' }
        },
      },
    )

    expect(result).toEqual({ ok: false, error: 'engine failed' })
    expect(existsSync(observedAudioFile)).toBe(false)
  })

  test('removes stale recordings left by an interrupted app process', () => {
    const testRoot = mkdtempSync(join(tmpdir(), 'artist-os-dictation-cleanup-test-'))
    const staleDirectory = mkdtempSync(join(testRoot, CHAT_DICTATION_TEMP_PREFIX))
    writeFileSync(join(staleDirectory, 'recording.webm'), new Uint8Array([1, 2, 3]))
    try {
      cleanupChatDictationTemporaryDirectories(testRoot)
      expect(existsSync(staleDirectory)).toBe(false)
    } finally {
      rmSync(testRoot, { recursive: true, force: true })
    }
  })
})
