import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  HqRecommendationCandidate,
  HqRecommendationEvent,
  HqRecommendationOutcome,
  HqRecommendationStore,
} from './lifecycle.ts'
import type { HqRecommendationStatus } from './types.ts'

export const HQ_RECOMMENDATIONS_DIR = '.state-of-play'
export const HQ_RECOMMENDATIONS_FILE = 'recommendations.json'
export const HQ_RECOMMENDATION_EVENTS_FILE = 'events.jsonl'
export const HQ_RECOMMENDATIONS_BACKUP_FILE = 'recommendations.backup.json'
export const HQ_RECOMMENDATION_OUTCOMES_FILE = 'outcomes.json'
export const HQ_RECOMMENDATION_OUTCOMES_BACKUP_FILE = 'outcomes.backup.json'

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
  return recoverSnapshot(storeFile(workspaceRootPath), backupStoreFile(workspaceRootPath), parseStore,
    'State of Play recommendation store')?.value ?? emptyStore()
}

export function writeHqRecommendationStore(workspaceRootPath: string, store: HqRecommendationStore): void {
  mkdirSync(recommendationDir(workspaceRootPath), { recursive: true })
  writeBackedSnapshot(storeFile(workspaceRootPath), backupStoreFile(workspaceRootPath),
    JSON.stringify(store, null, 2), parseStore, 'State of Play recommendation store')
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

export function readHqRecommendationEvents(workspaceRootPath: string, recommendationId?: string): HqRecommendationEvent[] {
  const file = eventsFile(workspaceRootPath)
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap((line) => {
    try {
      const event = JSON.parse(line) as HqRecommendationEvent
      return event?.version === 1 && typeof event.recommendationId === 'string' && (!recommendationId || event.recommendationId === recommendationId) ? [event] : []
    } catch {
      return []
    }
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function readHqRecommendationOutcomes(workspaceRootPath: string): HqRecommendationOutcome[] {
  return recoverSnapshot(outcomesFile(workspaceRootPath), outcomesBackupFile(workspaceRootPath), parseOutcomes,
    'State of Play outcome store')?.value ?? []
}

export function upsertHqRecommendationOutcome(workspaceRootPath: string, outcome: HqRecommendationOutcome): HqRecommendationOutcome {
  const current = readHqRecommendationOutcomes(workspaceRootPath)
  const existing = current.find((item) => item.recommendationId === outcome.recommendationId)
  const next = existing
    ? { ...outcome, userUsefulness: outcome.userUsefulness ?? existing.userUsefulness, notes: outcome.notes ?? existing.notes }
    : outcome
  const outcomes = [...current.filter((item) => item.recommendationId !== outcome.recommendationId), next]
  mkdirSync(recommendationDir(workspaceRootPath), { recursive: true })
  writeBackedSnapshot(outcomesFile(workspaceRootPath), outcomesBackupFile(workspaceRootPath),
    JSON.stringify({ version: 1, outcomes }, null, 2), parseOutcomes, 'State of Play outcome store')
  return next
}

function recommendationDir(root: string): string { return join(root, HQ_RECOMMENDATIONS_DIR) }
function storeFile(root: string): string { return join(recommendationDir(root), HQ_RECOMMENDATIONS_FILE) }
function backupStoreFile(root: string): string { return join(recommendationDir(root), HQ_RECOMMENDATIONS_BACKUP_FILE) }
function eventsFile(root: string): string { return join(recommendationDir(root), HQ_RECOMMENDATION_EVENTS_FILE) }
function outcomesFile(root: string): string { return join(recommendationDir(root), HQ_RECOMMENDATION_OUTCOMES_FILE) }
function outcomesBackupFile(root: string): string { return join(recommendationDir(root), HQ_RECOMMENDATION_OUTCOMES_BACKUP_FILE) }
function emptyStore(): HqRecommendationStore { return { version: 1, candidates: [], updatedAt: '' } }

interface StoreSnapshot<T> { bytes: string; value: T }
function readSnapshot<T>(file: string, parse: (bytes: string) => T | null): StoreSnapshot<T> | null {
  if (!existsSync(file)) return null
  const bytes = readFileSync(file, 'utf8')
  const value = parse(bytes)
  return value === null ? null : { bytes, value }
}

function atomicInstall(file: string, bytes: string): void {
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`
  try {
    writeFileSync(tmp, bytes, 'utf8')
    renameSync(tmp, file)
  } catch (error) {
    try { rmSync(tmp, { force: true }) } catch { /* Preserve the original error. */ }
    throw error
  }
}

function recoverSnapshot<T>(file: string, backupFile: string, parse: (bytes: string) => T | null, label: string): StoreSnapshot<T> | null {
  const primaryExists = existsSync(file), backupExists = existsSync(backupFile)
  if (!primaryExists && !backupExists) return null
  const primary = readSnapshot(file, parse)
  if (primary) return primary
  const backup = readSnapshot(backupFile, parse)
  const corruptFile = `${file}.corrupt-${Date.now()}-${randomUUID()}`
  // Never move the damaged primary away before its replacement is ready.
  if (primaryExists) copyFileSync(file, corruptFile)
  if (!backup) throw new Error(`${label} is corrupt and was preserved at ${primaryExists ? corruptFile : backupFile}.`)
  atomicInstall(file, backup.bytes)
  return backup
}

function writeBackedSnapshot<T>(file: string, backupFile: string, bytes: string, parse: (bytes: string) => T | null, label: string): void {
  const previous = recoverSnapshot(file, backupFile, parse, label)
  // A failed backup write must never truncate the last usable backup.
  if (previous) atomicInstall(backupFile, previous.bytes)
  atomicInstall(file, bytes)
}

function parseStore(bytes: string): HqRecommendationStore | null {
  try {
    const parsed = JSON.parse(bytes) as Partial<HqRecommendationStore>
    if (parsed.version !== 1 || !Array.isArray(parsed.candidates)) return null
    if (!parsed.candidates.every((candidate) => candidate && typeof candidate.id === 'string' && typeof candidate.status === 'string')) return null
    return { version: 1, candidates: parsed.candidates as HqRecommendationCandidate[], updatedAt: String(parsed.updatedAt ?? '') }
  } catch {
    return null
  }
}

function parseOutcomes(bytes: string): HqRecommendationOutcome[] | null {
  try {
    const parsed = JSON.parse(bytes) as { version?: number; outcomes?: unknown[] }
    if (parsed.version !== 1 || !Array.isArray(parsed.outcomes)) return null
    if (!parsed.outcomes.every(isHqRecommendationOutcome)) return null
    return parsed.outcomes
  } catch {
    return null
  }
}

function isHqRecommendationOutcome(value: unknown): value is HqRecommendationOutcome {
  if (!value || typeof value !== 'object') return false
  const outcome = value as Partial<HqRecommendationOutcome>
  return outcome.version === 1
    && typeof outcome.recommendationId === 'string'
    && ['successful', 'partial', 'unsuccessful', 'unknown'].includes(outcome.status ?? '')
    && typeof outcome.evaluatedAt === 'string'
    && Array.isArray(outcome.evidence)
    && (outcome.criteria === undefined || (Array.isArray(outcome.criteria) && outcome.criteria.every(isCriterionResult)))
    && (!outcome.userUsefulness || ['useful', 'neutral', 'not_useful'].includes(outcome.userUsefulness))
}

function isCriterionResult(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const result = value as Record<string, unknown>
  if (typeof result.satisfied !== 'boolean' || typeof result.note !== 'string') return false
  if (!result.criterion || typeof result.criterion !== 'object') return false
  const type = (result.criterion as Record<string, unknown>).type
  return type === 'output-completed' || type === 'approval-resolved' || type === 'final-promoted' || type === 'receipt-recorded'
}
