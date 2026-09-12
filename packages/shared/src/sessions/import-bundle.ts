import { mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { restoreFiles, validateBundleFile, MAX_BUNDLE_SIZE_BYTES, type BundleFile } from '../utils/bundle-files.ts'
import { writeSessionJsonl } from './jsonl.ts'
import { validateSessionId } from './validation.ts'
import type { StoredSession } from './types.ts'

/** Validate the entire payload before any destination writes. */
export function validateSessionBundleFiles(files: BundleFile[]): void {
  const paths = new Set<string>()
  let bytes = 0
  for (const file of files) {
    if (!file || typeof file !== 'object') throw new Error('Invalid bundle file')
    const error = validateBundleFile(file)
    if (error) throw new Error(error)
    const segments = file.relativePath.split('/')
    if (segments.some(part => !part || part === '.' || part.startsWith('.') || /[:\x00-\x1f]/.test(part))) throw new Error('Invalid bundle path')
    const key = file.relativePath.normalize('NFC').toLowerCase()
    if (key === 'session.jsonl' || key === 'session.jsonl.tmp' || key.startsWith('session.jsonl/')) throw new Error('Reserved session transcript path')
    if (paths.has(key)) throw new Error('Duplicate bundle path')
    paths.add(key)
    bytes += file.size
    if (!Number.isSafeInteger(bytes) || bytes > MAX_BUNDLE_SIZE_BYTES) throw new Error('Session bundle exceeds size limit')
  }
  for (const path of paths) {
    const parts = path.split('/')
    while (parts.length > 1) { parts.pop(); if (paths.has(parts.join('/'))) throw new Error('Conflicting bundle file paths') }
  }
}

/** session.jsonl is the discovery/commit marker; never expose it before all files exist. */
export function publishImportedSession(workspaceRoot: string, session: StoredSession, files: BundleFile[]): void {
  validateSessionId(session.id)
  validateSessionBundleFiles(files)
  const parent = join(workspaceRoot, 'sessions')
  mkdirSync(parent, { recursive: true })
  const staging = mkdtempSync(join(parent, '.import-'))
  const target = join(parent, session.id)
  let ownsTarget = false
  try {
    restoreFiles(staging, files)
    for (const name of ['plans', 'attachments', 'long_responses', 'downloads', 'data']) mkdirSync(join(staging, name), { recursive: true })
    // Prepare the transcript privately, then publish it only after its files.
    writeSessionJsonl(join(staging, 'session.jsonl'), session)
    mkdirSync(target) // Exclusive reservation; existing folders/symlinks always fail.
    ownsTarget = true
    for (const entry of readdirSync(staging)) {
      if (entry !== 'session.jsonl') renameSync(join(staging, entry), join(target, entry))
    }
    renameSync(join(staging, 'session.jsonl'), join(target, 'session.jsonl'))
    ownsTarget = false // Publication is committed; later observer errors cannot undo it.
  } finally {
    if (ownsTarget) rmSync(target, { recursive: true, force: true })
    rmSync(staging, { recursive: true, force: true })
  }
}
