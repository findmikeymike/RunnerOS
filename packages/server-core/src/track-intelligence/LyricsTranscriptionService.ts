import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { promisify } from 'node:util'
import { getSourcesBySlugs } from '@craft-agent/shared/sources'
import { hashFileSha256 } from '@craft-agent/shared/utils/hash-file'

const execFileAsync = promisify(execFile)

export interface LocalLyricsTranscriptionResult {
  ok: boolean
  engine?: string
  model?: string
  lyricsText?: string
  lyricLines?: Array<{ text: string; start_time: number; end_time: number }>
  transcriptJson?: string
  sourceSha256?: string
  blockers?: Array<{ code: string; message: string }>
  error?: string
}

export interface LocalLyricsTranscriptionRuntimeStatus {
  available: boolean
  modelInstalled: boolean
  blockers?: Array<{ code: string; message: string }>
  error?: string
}

interface LyricsTranscriberPayload {
  ok: boolean
  engine?: string
  model?: string
  lyrics_text?: string
  lyric_lines?: Array<{ text: string; start_time: number; end_time: number }>
  transcript_json?: string
  blockers?: Array<{ code: string; message: string }>
  error?: string
}

export async function inspectLyricsTranscriptionRuntime(input: {
  workspaceRootPath: string
  model?: string
}): Promise<LocalLyricsTranscriptionRuntimeStatus> {
  const model = input.model ?? 'base.en'
  const bin = lyricsTranscriberBin(input.workspaceRootPath)
  if (!existsSync(bin)) {
    return { available: false, modelInstalled: false, error: `Lyrics Transcriber CLI is missing: ${bin}` }
  }

  let doctor: LyricsTranscriberPayload
  try {
    doctor = await runLyricsTranscriber(bin, ['doctor', '--model', model])
  } catch (error) {
    doctor = parseTranscriberError(error, 'Lyrics transcription setup is incomplete.')
  }

  const blockers = doctor.blockers ?? []
  const modelInstalled = !blockers.some((blocker) => blocker.code === 'missing_model')
  const onlyMissingModel = !doctor.ok
    && blockers.length > 0
    && blockers.every((blocker) => blocker.code === 'missing_model')
  const available = doctor.ok || onlyMissingModel

  return {
    available,
    modelInstalled,
    blockers: blockers.length > 0 ? blockers : undefined,
    error: available
      ? undefined
      : doctor.error ?? (blockers.map((blocker) => blocker.message).join(' ') || 'Local transcription tools are unavailable.'),
  }
}

export async function transcribeLyricsLocally(input: {
  workspaceRootPath: string
  audioFile: string
  outDir: string
  model?: string
}): Promise<LocalLyricsTranscriptionResult> {
  const model = input.model ?? 'base.en'
  const bin = lyricsTranscriberBin(input.workspaceRootPath)
  if (!existsSync(bin)) return { ok: false, error: `Lyrics Transcriber CLI is missing: ${bin}` }

  let doctor: LyricsTranscriberPayload
  try {
    doctor = await runLyricsTranscriber(bin, ['doctor', '--model', model])
  } catch (error) {
    doctor = parseTranscriberError(error, 'Lyrics transcription setup is incomplete.')
  }
  if (!doctor.ok && hasBlocker(doctor, 'missing_model') && !hasBlocker(doctor, 'missing_whisper_cli') && !hasBlocker(doctor, 'missing_ffmpeg')) {
    await runLyricsTranscriber(bin, ['install-model', '--model', model])
    doctor = await runLyricsTranscriber(bin, ['doctor', '--model', model])
  }
  if (!doctor.ok) return {
    ok: false,
    error: doctor.error ?? 'Lyrics transcription setup is incomplete.',
    blockers: doctor.blockers,
  }

  try {
    const sourceSha256 = hashFileSha256(input.audioFile)
    const payload = await runLyricsTranscriber(bin, [
      'transcribe',
      '--audio-file', input.audioFile,
      '--out-dir', input.outDir,
      '--model', model,
    ])
    if (!payload.ok) return {
      ok: false,
      error: payload.error ?? 'Transcription did not return lyrics.',
      blockers: payload.blockers,
    }
    if (hashFileSha256(input.audioFile) !== sourceSha256) {
      return { ok: false, error: 'The audio changed while transcription was running. Run analysis again.' }
    }
    return {
      ok: true,
      engine: payload.engine,
      model: payload.model,
      lyricsText: payload.lyrics_text ?? '',
      lyricLines: payload.lyric_lines,
      transcriptJson: payload.transcript_json,
      sourceSha256,
    }
  } catch (error) {
    const payload = parseTranscriberError(error, 'Transcription failed.')
    return { ok: false, error: payload.error, blockers: payload.blockers }
  }
}

function lyricsTranscriberBin(workspaceRootPath: string): string {
  const source = getSourcesBySlugs(workspaceRootPath, ['lyrics-transcriber'])[0]
  const folder = source?.folderPath || source?.config.local?.path
  if (!folder) throw new Error('Lyrics Transcriber source is not registered.')
  return resolve(folder, 'bin', 'lyrics-transcriber.mjs')
}

async function runLyricsTranscriber(bin: string, args: string[]): Promise<LyricsTranscriberPayload> {
  const result = await execFileAsync(process.execPath, [bin, ...args, '--json'], {
    cwd: dirname(bin),
    maxBuffer: 32 * 1024 * 1024,
  })
  return JSON.parse(result.stdout) as LyricsTranscriberPayload
}

function parseTranscriberError(error: unknown, fallback: string): LyricsTranscriberPayload {
  const stdout = typeof (error as { stdout?: unknown }).stdout === 'string'
    ? (error as { stdout: string }).stdout
    : ''
  if (stdout) {
    try {
      return JSON.parse(stdout) as LyricsTranscriberPayload
    } catch {
      // Fall through to the process error.
    }
  }
  return { ok: false, error: error instanceof Error ? error.message : fallback }
}

function hasBlocker(payload: LyricsTranscriberPayload, code: string): boolean {
  return Boolean(payload.blockers?.some((blocker) => blocker.code === code))
}
