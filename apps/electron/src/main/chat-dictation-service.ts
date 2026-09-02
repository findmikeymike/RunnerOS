import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  inspectLyricsTranscriptionRuntime,
  transcribeLyricsLocally,
} from '@craft-agent/server-core/services'

export const MAX_CHAT_DICTATION_BYTES = 20 * 1024 * 1024
export const CHAT_DICTATION_TEMP_PREFIX = 'artist-os-dictation-'

export type ChatDictationInput = {
  audioData: Uint8Array
  mimeType: string
}

export type ChatDictationResult = {
  ok: boolean
  transcript?: string
  error?: string
}

export type ChatDictationAvailability = {
  available: boolean
  modelInstalled: boolean
  error?: string
}

type ChatDictationDependencies = {
  inspectRuntime: typeof inspectLyricsTranscriptionRuntime
  transcribe: typeof transcribeLyricsLocally
  tempRoot: string
  workspaceRootPath: string
}

const activeTemporaryDirectories = new Set<string>()

const SUPPORTED_AUDIO_TYPES: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
}

export function validateChatDictationInput(input: ChatDictationInput): string | null {
  if (!(input?.audioData instanceof Uint8Array)) return 'The microphone recording was not valid audio data.'
  if (input.audioData.byteLength === 0) return 'The microphone recording was empty.'
  if (input.audioData.byteLength > MAX_CHAT_DICTATION_BYTES) return 'The recording is too large. Keep dictation under two minutes.'
  if (!dictationFileExtension(input.mimeType)) return 'This microphone audio format is not supported.'
  return null
}

export function dictationFileExtension(mimeType: string): string | null {
  const normalized = String(mimeType || '').split(';', 1)[0]!.trim().toLowerCase()
  return SUPPORTED_AUDIO_TYPES[normalized] ?? null
}

export async function getChatDictationAvailability(
  dependencies: Partial<ChatDictationDependencies> = {},
): Promise<ChatDictationAvailability> {
  try {
    const status = await (dependencies.inspectRuntime ?? inspectLyricsTranscriptionRuntime)({
      workspaceRootPath: dependencies.workspaceRootPath ?? process.cwd(),
      model: 'base.en',
    })
    return {
      available: status.available,
      modelInstalled: status.modelInstalled,
      error: status.available
        ? undefined
        : status.error ?? status.blockers?.map((blocker) => blocker.message).join(' ') ?? 'Local transcription tools are unavailable.',
    }
  } catch (error) {
    return {
      available: false,
      modelInstalled: false,
      error: error instanceof Error ? error.message : 'Local transcription tools are unavailable.',
    }
  }
}

export function cleanupChatDictationTemporaryDirectories(tempRoot = tmpdir()): void {
  let names: string[]
  try {
    names = readdirSync(tempRoot)
  } catch {
    return
  }
  for (const name of names) {
    if (!name.startsWith(CHAT_DICTATION_TEMP_PREFIX)) continue
    const directory = join(tempRoot, name)
    try {
      rmSync(directory, { recursive: true, force: true })
      activeTemporaryDirectories.delete(directory)
    } catch {
      // A later startup cleanup will retry if the operating system still has a file open.
    }
  }
}

export function cleanupActiveChatDictationTemporaryDirectories(): void {
  for (const directory of [...activeTemporaryDirectories]) {
    try {
      rmSync(directory, { recursive: true, force: true })
      activeTemporaryDirectories.delete(directory)
    } catch {
      // Startup cleanup will retry if shutdown races an open native process handle.
    }
  }
}

export async function transcribeChatDictation(
  input: ChatDictationInput,
  dependencies: Partial<ChatDictationDependencies> = {},
): Promise<ChatDictationResult> {
  const validationError = validateChatDictationInput(input)
  if (validationError) return { ok: false, error: validationError }

  const extension = dictationFileExtension(input.mimeType)!
  const directory = mkdtempSync(join(dependencies.tempRoot ?? tmpdir(), CHAT_DICTATION_TEMP_PREFIX))
  activeTemporaryDirectories.add(directory)
  const audioFile = join(directory, `recording.${extension}`)
  const outputDirectory = join(directory, 'transcript')

  try {
    writeFileSync(audioFile, input.audioData)
    const result = await (dependencies.transcribe ?? transcribeLyricsLocally)({
      workspaceRootPath: dependencies.workspaceRootPath ?? process.cwd(),
      audioFile,
      outDir: outputDirectory,
      model: 'base.en',
    })
    const transcript = result.lyricsText?.replace(/\s+/g, ' ').trim() ?? ''
    if (!result.ok || !transcript) {
      return { ok: false, error: result.error ?? 'No speech was detected. Try again a little closer to the microphone.' }
    }
    return { ok: true, transcript }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Dictation transcription failed.',
    }
  } finally {
    try {
      rmSync(directory, { recursive: true, force: true })
    } catch {
      // Startup cleanup removes residue if the operating system still has the file open.
    } finally {
      activeTemporaryDirectories.delete(directory)
    }
  }
}
