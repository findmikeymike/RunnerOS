import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  HqRecommendationCandidate,
  HqRecommendationEvent,
  HqRecommendationStore,
} from './lifecycle.ts'
import type { HqRecommendationStatus } from './types.ts'

export const HQ_RECOMMENDATIONS_DIR = '.state-of-play'
export const HQ_RECOMMENDATIONS_FILE = 'recommendations.json'
export const HQ_RECOMMENDATION_EVENTS_FILE = 'events.jsonl'
export const HQ_RECOMMENDATIONS_BACKUP_FILE = 'recommendations.backup.json'

const ALLOWED_TRANSITIONS: Record<HqRecommendationStatus, ReadonlySet<HqRecommendationStatus>> = {
  proposed: new Set(['viewed', 'accepted', 'dismissed', 'snoozed', 'expired', 'superseded']),
  viewed: new Set(['accepted', 'dismissed', 'snoozed', 'expired', 'superseded']),
  accepted: new Set(['launched', 'failed', 'dismissed', 'snoozed', 'expired', 'superseded']),
  launched: new Set(['in_progress', 'awaiting_approval', 'completed', 'failed']),
  in_progress: new Set(['awaiting_approval', 'completed', 'failed']),
  awaiting_approval: new Set(['in_progress', 'completed', 'failed', 'dismissed']),
  completed: new Set(),
  failed: new Set(['accepted', 'superseded']),
  dismissed: new Set(['proposed']),
  snoozed: new Set(['proposed', 'expired', 'superseded']),
  expired: new Set(),
  superseded: new Set(),
}

export function readHqRecommendationStore(workspaceRootPath: string): HqRecommendationStore {
  const file = storeFile(workspaceRootPath)
  if (!existsSync(file)) return emptyStore()
  const primary = parseStoreFile(file)
  if (primary) return primary
  const backupFile = backupStoreFile(workspaceRootPath)
  const backup = existsSync(backupFile) ? parseStoreFile(backupFile) : null
  const corruptFile = `${file}.corrupt-${Date.now()}`
  if (backup) {
    renameSync(file, corruptFile)
    copyFileSync(backupFile, file)
    return backup
  }
  copyFileSync(file, corruptFile)
  throw new Error(`State of Play recommendation store is corrupt and was preserved at ${corruptFile}.`)
}

export function writeHqRecommendationStore(workspaceRootPath: string, store: HqRecommendationStore): void {
  const dir = recommendationDir(workspaceRootPath)
  mkdirSync(dir, { recursive: true })
  const file = storeFile(workspaceRootPath)
  const tmp = `${file}.${process.pid}.tmp`
  try {
    writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8')
    if (existsSync(file) && parseStoreFile(file)) copyFileSync(file, backupStoreFile(workspaceRootPath))
    renameSync(tmp, file)
  } catch (error) {
    try { rmSync(tmp, { force: true }) } catch { /* best effort */ }
    throw error
  }
}

export function upsertHqRecommendation(
  workspaceRootPath: string,
  candidate: HqRecommendationCandidate,
): HqRecommendationCandidate {
  const store = readHqRecommendationStore(workspaceRootPath)
  const existing = store.candidates.find((item) => item.id === candidate.id)
  const reviveSnoozed = existing?.status === 'snoozed'
    && Boolean(existing.snoozedUntil)
    && Date.parse(existing.snoozedUntil!) <= Date.parse(candidate.updatedAt)
  const next = existing
    ? { ...candidate, createdAt: existing.createdAt, status: existing.status, snoozedUntil: existing.snoozedUntil, statusReason: existing.statusReason, executionRefs: existing.executionRefs }
    : candidate
  if (reviveSnoozed) {
    next.status = 'proposed'
    next.snoozedUntil = undefined
    next.statusReason = undefined
  }
  const nextStore: HqRecommendationStore = {
    version: 1,
    candidates: [next, ...store.candidates.filter((item) => item.id !== next.id)].slice(0, 200),
    updatedAt: next.updatedAt,
  }
  writeHqRecommendationStore(workspaceRootPath, nextStore)
  try {
    if (!existing) appendHqRecommendationEvent(workspaceRootPath, {
      version: 1,
      id: randomUUID(),
      recommendationId: next.id,
      to: 'proposed',
      actor: { type: 'system' },
      createdAt: next.createdAt,
    })
    if (existing && reviveSnoozed) appendHqRecommendationEvent(workspaceRootPath, {
      version: 1,
      id: randomUUID(),
      recommendationId: next.id,
      from: 'snoozed',
      to: 'proposed',
      actor: { type: 'system' },
      reason: 'Snooze period ended.',
      createdAt: candidate.updatedAt,
    })
  } catch (error) {
    writeHqRecommendationStore(workspaceRootPath, store)
    throw error
  }
  return next
}

export function transitionHqRecommendation(
  workspaceRootPath: string,
  recommendationId: string,
  to: HqRecommendationStatus,
  input: Omit<HqRecommendationEvent, 'version' | 'id' | 'recommendationId' | 'from' | 'to' | 'createdAt'> & { createdAt?: string; snoozedUntil?: string },
): HqRecommendationCandidate {
  const store = readHqRecommendationStore(workspaceRootPath)
  const current = store.candidates.find((item) => item.id === recommendationId)
  if (!current) throw new Error(`Recommendation not found: ${recommendationId}`)
  if (current.status === to) return current
  if (!ALLOWED_TRANSITIONS[current.status]?.has(to)) throw new Error(`Invalid recommendation transition: ${current.status} -> ${to}`)
  const now = input.createdAt ?? new Date().toISOString()
  const next: HqRecommendationCandidate = {
    ...current,
    status: to,
    updatedAt: now,
    statusReason: input.reason,
    snoozedUntil: to === 'snoozed' ? input.snoozedUntil : undefined,
    executionRefs: input.executionRef && !current.executionRefs.some((ref) => ref.kind === input.executionRef!.kind && ref.id === input.executionRef!.id)
      ? [...current.executionRefs, input.executionRef]
      : current.executionRefs,
  }
  const nextStore: HqRecommendationStore = {
    ...store,
    candidates: store.candidates.map((item) => item.id === recommendationId ? next : item),
    updatedAt: now,
  }
  writeHqRecommendationStore(workspaceRootPath, nextStore)
  try {
    appendHqRecommendationEvent(workspaceRootPath, {
      version: 1,
      id: randomUUID(),
      recommendationId,
      from: current.status,
      to,
      actor: input.actor,
      reason: input.reason,
      executionRef: input.executionRef,
      createdAt: now,
    })
  } catch (error) {
    writeHqRecommendationStore(workspaceRootPath, store)
    throw error
  }
  return next
}

export function listHqRecommendationEvents(workspaceRootPath: string): HqRecommendationEvent[] {
  const file = eventsFile(workspaceRootPath)
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line) as HqRecommendationEvent] } catch { return [] }
  })
}

function appendHqRecommendationEvent(workspaceRootPath: string, event: HqRecommendationEvent): void {
  const dir = recommendationDir(workspaceRootPath)
  mkdirSync(dir, { recursive: true })
  appendFileSync(eventsFile(workspaceRootPath), `${JSON.stringify(event)}\n`, 'utf8')
}

function recommendationDir(root: string): string { return join(root, HQ_RECOMMENDATIONS_DIR) }
function storeFile(root: string): string { return join(recommendationDir(root), HQ_RECOMMENDATIONS_FILE) }
function backupStoreFile(root: string): string { return join(recommendationDir(root), HQ_RECOMMENDATIONS_BACKUP_FILE) }
function eventsFile(root: string): string { return join(recommendationDir(root), HQ_RECOMMENDATION_EVENTS_FILE) }
function emptyStore(): HqRecommendationStore { return { version: 1, candidates: [], updatedAt: '' } }

function parseStoreFile(file: string): HqRecommendationStore | null {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<HqRecommendationStore>
    if (parsed.version !== 1 || !Array.isArray(parsed.candidates)) return null
    if (!parsed.candidates.every((candidate) => candidate && typeof candidate.id === 'string' && typeof candidate.status === 'string')) return null
    return { version: 1, candidates: parsed.candidates as HqRecommendationCandidate[], updatedAt: String(parsed.updatedAt ?? '') }
  } catch {
    return null
  }
}
