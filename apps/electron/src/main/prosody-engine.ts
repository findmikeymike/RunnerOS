import { app, ipcMain } from 'electron'
import { existsSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { getBundledAssetsDir } from '@craft-agent/shared/utils'
import type { ProsodyLookupRequest, ProsodyLookupResult, ProsodyRhymeItem } from '../shared/types'

type ActiveLookup = {
  token: number
  child?: ChildProcessWithoutNullStreams
}

type ProcessResult = {
  stdout: string
  stderr: string
}

const CHANNEL = 'prosody:lookup'
const MAX_SELECTION_LENGTH = 120
const MAX_LINE_LENGTH = 500
const MAX_RHYMES = 18

const activeLookups = new Map<number, ActiveLookup>()
let pythonPromise: Promise<string> | null = null
let handlersRegistered = false

export function registerProsodyIpcHandlers(): void {
  if (handlersRegistered) return
  handlersRegistered = true

  ipcMain.handle(CHANNEL, async (event, input: ProsodyLookupRequest): Promise<ProsodyLookupResult> => {
    const webContentsId = event.sender.id
    const previous = activeLookups.get(webContentsId)
    previous?.child?.kill()

    const token = (previous?.token ?? 0) + 1
    activeLookups.set(webContentsId, { token })

    return lookupProsody(input, webContentsId, token)
  })
}

async function lookupProsody(
  input: ProsodyLookupRequest,
  webContentsId: number,
  token: number,
): Promise<ProsodyLookupResult> {
  const selection = cleanInput(input?.selection, MAX_SELECTION_LENGTH)
  const line = cleanInput(input?.line, MAX_LINE_LENGTH)
  const target = extractTargetWord(selection)
  const empty = emptyResult(target, selection, line)

  if (!target) return empty

  try {
    const python = await ensureProsodyPython()
    const enginePath = getEnginePath()

    const selectionScan = await runJsonProcess(
      python,
      [enginePath, 'scan', selection, '--json'],
      webContentsId,
      token,
    )
    if (!isCurrent(webContentsId, token)) return empty

    const syllables = Number.isFinite(selectionScan.syllables) ? Number(selectionScan.syllables) : undefined
    const rhymeArgs = [enginePath, 'rhymes', target, '--type', 'all', '--max', String(MAX_RHYMES), '--json']
    if (syllables && syllables > 0 && syllables <= 5) {
      rhymeArgs.push('--syllables', String(syllables))
    }

    const rhymes = await runJsonProcess(python, rhymeArgs, webContentsId, token)
    if (!isCurrent(webContentsId, token)) return empty

    if (!rhymes.in_dictionary) {
      return {
        ...empty,
        ok: true,
        inDictionary: false,
      }
    }

    return {
      ok: true,
      target,
      selection,
      line,
      inDictionary: true,
      syllables: typeof rhymes.syllables === 'number' ? rhymes.syllables : syllables,
      stress: typeof rhymes.stress === 'string' ? rhymes.stress : undefined,
      perfect: normalizePerfectRhymes(rhymes.perfect, target),
      slant: normalizeSlantRhymes(rhymes.slant, target),
    }
  } catch (err) {
    return {
      ...empty,
      error: err instanceof Error ? err.message : String(err),
    }
  } finally {
    const current = activeLookups.get(webContentsId)
    if (current?.token === token) activeLookups.delete(webContentsId)
  }
}

async function ensureProsodyPython(): Promise<string> {
  if (!pythonPromise) {
    pythonPromise = ensureProsodyPythonOnce().catch((err) => {
      pythonPromise = null
      throw err
    })
  }
  return pythonPromise
}

async function ensureProsodyPythonOnce(): Promise<string> {
  const enginePath = getEnginePath()
  if (!existsSync(enginePath)) {
    throw new Error('Rhyme engine assets are missing from this build. Song editing still works normally.')
  }
  const venvDir = join(app.getPath('userData'), 'prosody-engine', 'venv')
  const python = getVenvPythonPath(venvDir)
  if (await canRunProsody(python)) return python
  if (await canRunProsody('python3')) return 'python3'

  const configuredUv = process.env.CRAFT_UV
  const uv = configuredUv && existsSync(configuredUv) ? configuredUv : getBundledUvPath()
  try {
    mkdirSync(dirname(venvDir), { recursive: true })
    await runProcess(uv, ['venv', '--python', '3.12', venvDir], { timeoutMs: 90_000 })
    await runProcess(uv, ['pip', 'install', '--python', python, 'pronouncing', 'wordfreq'], { timeoutMs: 180_000 })
  } catch {
    throw new Error('Rhyme tools could not be prepared. Check your internet connection and try again; Song Pad editing is still available.')
  }

  if (await canRunProsody(python)) return python

  throw new Error('Rhyme tools could not be prepared on this device. Song Pad editing is still available.')
}

async function canRunProsody(python: string): Promise<boolean> {
  if (python !== 'python3' && !existsSync(python)) return false
  try {
    await runProcess(python, ['-c', 'import pronouncing, wordfreq'], { timeoutMs: 15_000 })
    return true
  } catch {
    return false
  }
}

function getVenvPythonPath(venvDir: string): string {
  return process.platform === 'win32'
    ? join(venvDir, 'Scripts', 'python.exe')
    : join(venvDir, 'bin', 'python')
}

function getEnginePath(): string {
  return join(getResourcesDir(), 'prosody', 'engine', 'rhyme_engine.py')
}

function getBundledUvPath(): string {
  const binary = process.platform === 'win32' ? 'uv.exe' : 'uv'
  const platformDir = process.platform === 'darwin'
    ? (process.arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64')
    : process.platform === 'win32'
      ? 'win32-x64'
      : 'linux-x64'
  const candidate = join(getResourcesDir(), 'bin', platformDir, binary)
  return existsSync(candidate) ? candidate : 'uv'
}

function getResourcesDir(): string {
  return getBundledAssetsDir('.') ?? join(__dirname, '..', 'resources')
}

async function runJsonProcess(
  command: string,
  args: string[],
  webContentsId: number,
  token: number,
): Promise<any> {
  const result = await runProcess(command, args, {
    timeoutMs: 20_000,
    onChild: (child) => {
      const current = activeLookups.get(webContentsId)
      if (current?.token === token) {
        current.child = child
      } else {
        child.kill()
      }
    },
  })
  return JSON.parse(result.stdout)
}

function runProcess(
  command: string,
  args: string[],
  options: {
    timeoutMs: number
    onChild?: (child: ChildProcessWithoutNullStreams) => void
  },
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'pipe',
      windowsHide: true,
      env: process.env,
    })
    options.onChild?.(child)

    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('Prosody process timed out.'))
    }, options.timeoutMs)

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      if (code === 0) {
        resolve({ stdout, stderr })
        return
      }
      reject(new Error(stderr.trim() || `Prosody process exited with code ${code ?? signal ?? 'unknown'}.`))
    })
  })
}

function normalizePerfectRhymes(value: unknown, target: string): ProsodyRhymeItem[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((word): word is string => typeof word === 'string' && isUsefulRhyme(word, target))
    .slice(0, MAX_RHYMES)
    .map((word) => ({ word, kind: 'perfect' }))
}

function normalizeSlantRhymes(value: unknown, target: string): ProsodyRhymeItem[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is { word: string; syllables?: number; stress?: string; kind?: string } => (
      item && typeof item === 'object' && typeof (item as { word?: unknown }).word === 'string'
    ))
    .filter((item) => isUsefulRhyme(item.word, target))
    .slice(0, MAX_RHYMES)
    .map((item) => ({
      word: item.word,
      syllables: typeof item.syllables === 'number' ? item.syllables : undefined,
      stress: typeof item.stress === 'string' ? item.stress : undefined,
      kind: normalizeSlantKind(item.kind),
    }))
}

function normalizeSlantKind(kind: unknown): ProsodyRhymeItem['kind'] {
  if (kind === 'assonance' || kind === 'consonance' || kind === 'near') return kind
  return 'near'
}

function isUsefulRhyme(word: string, target: string): boolean {
  const clean = word.toLowerCase()
  return clean !== target && /^[a-z][a-z'-]{1,}$/.test(clean)
}

function extractTargetWord(selection: string): string {
  const words = selection.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g) ?? []
  return (words.at(-1) ?? '').toLowerCase()
}

function cleanInput(value: unknown, maxLength: number): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength)
}

function emptyResult(target: string, selection: string, line: string): ProsodyLookupResult {
  return {
    ok: false,
    target,
    selection,
    line,
    inDictionary: false,
    perfect: [],
    slant: [],
  }
}

function isCurrent(webContentsId: number, token: number): boolean {
  return activeLookups.get(webContentsId)?.token === token
}
