/**
 * BindingStore — workspace-scoped persistence for channel bindings.
 *
 * Stores bindings in an explicit storage directory (passed by the caller).
 * In Electron this is `~/.craft-agent/workspaces/{wsId}/messaging/`, but tests
 * can point it at any directory.
 *
 * One-shot migration: if a legacy path is provided and contains a bindings.json
 * that the new path does not, the legacy file is copied forward on construction.
 */

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  copyFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ChannelBinding, ChannelBindingTarget, MessagingLogger, PlatformType } from './types'
import { isChannelBindingTarget, normalizeBindingConfig } from './types'

const NOOP_LOGGER: MessagingLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => NOOP_LOGGER,
}

export class BindingStore {
  private bindings: ChannelBinding[] = []
  private readonly filePath: string
  private readonly dirPath: string
  private readonly log: MessagingLogger
  private changeListener?: () => void

  /**
   * @param storageDir  Absolute path to the directory where bindings.json is stored.
   * @param legacyDir   Optional legacy directory. If its bindings.json exists and
   *                    the new location does not, the file is copied forward once.
   */
  constructor(storageDir: string, legacyDir?: string, logger: MessagingLogger = NOOP_LOGGER) {
    this.dirPath = storageDir
    this.filePath = join(storageDir, 'bindings.json')
    this.log = logger
    this.migrateLegacy(legacyDir)
    this.load()
  }

  /** Register a callback fired after any mutation is persisted. */
  onChange(fn: () => void): void {
    this.changeListener = fn
  }

  // -------------------------------------------------------------------------
  // Query
  // -------------------------------------------------------------------------

  findByChannel(platform: PlatformType, channelId: string, senderId?: string): ChannelBinding | undefined {
    return this.bindings.find(
      (b) => (
        b.platform === platform &&
        b.channelId === channelId &&
        b.enabled &&
        this.senderIsAuthorized(b, senderId)
      ),
    )
  }

  /**
   * Bindings whose *currently cached* session is `sessionId`. Used for event
   * fan-out. A binding with no live session simply does not match — its target
   * is unchanged and it will resolve a new session on the next inbound message.
   */
  findByActiveSession(sessionId: string): ChannelBinding[] {
    return this.bindings.filter((b) => b.activeSessionId === sessionId && b.enabled)
  }

  findByAgent(agentSlug: string): ChannelBinding[] {
    return this.bindings.filter((b) => b.target.agentSlug === agentSlug && b.enabled)
  }

  findById(bindingId: string): ChannelBinding | undefined {
    return this.bindings.find((b) => b.id === bindingId)
  }

  getAll(): ChannelBinding[] {
    return [...this.bindings]
  }

  // -------------------------------------------------------------------------
  // Mutation
  // -------------------------------------------------------------------------

  /**
   * Bind a channel to an agent. `authorizedSenderId` is required: the paired
   * sender becomes the sole authorized sender until the desktop widens it.
   */
  bind(
    workspaceId: string,
    agentSlug: string,
    platform: PlatformType,
    channelId: string,
    authorizedSenderId: string,
    channelName?: string,
    config?: Partial<ChannelBinding['config']>,
  ): ChannelBinding {
    if (!authorizedSenderId) {
      throw new Error('A binding requires an authorized sender.')
    }
    // One channel → one agent: evict any existing binding for the channel.
    this.bindings = this.bindings.filter(
      (b) => !(b.platform === platform && b.channelId === channelId),
    )

    const target: ChannelBindingTarget = { kind: 'agent', agentSlug, workspaceId }
    const binding: ChannelBinding = {
      id: randomUUID(),
      workspaceId,
      platform,
      channelId,
      channelName,
      target,
      authorizedSenderIds: [authorizedSenderId],
      enabled: true,
      createdAt: Date.now(),
      config: normalizeBindingConfig(platform, config),
    }

    this.bindings.push(binding)
    this.save()
    this.log.info('binding created', {
      event: 'binding_created',
      workspaceId,
      agentSlug,
      platform,
      channelId,
      bindingId: binding.id,
      channelName,
    })
    return binding
  }

  /**
   * Cache the session now serving a binding. Persisted before the message is
   * dispatched so a crash mid-turn cannot orphan the session.
   */
  setActiveSession(bindingId: string, sessionId: string): void {
    const binding = this.bindings.find((b) => b.id === bindingId)
    if (!binding || binding.activeSessionId === sessionId) return
    binding.activeSessionId = sessionId
    this.save()
    this.log.info('binding active session set', {
      event: 'binding_session_set',
      bindingId,
      sessionId,
      agentSlug: binding.target.agentSlug,
    })
  }

  /** Drop the cached session. The target is untouched. */
  clearActiveSession(bindingId: string): void {
    const binding = this.bindings.find((b) => b.id === bindingId)
    if (!binding?.activeSessionId) return
    const previous = binding.activeSessionId
    binding.activeSessionId = undefined
    this.save()
    this.log.info('binding active session cleared', {
      event: 'binding_session_cleared',
      bindingId,
      previousSessionId: previous,
    })
  }

  private senderIsAuthorized(binding: ChannelBinding, senderId: string | undefined): boolean {
    // authorizedSenderIds is required and non-empty; an empty list is a corrupt
    // record and must fail closed rather than admitting every sender.
    if (!binding.authorizedSenderIds.length) return false
    if (!senderId) return false
    return binding.authorizedSenderIds.includes(senderId)
  }

  unbind(platform: PlatformType, channelId: string): boolean {
    const before = this.bindings.length
    this.bindings = this.bindings.filter(
      (b) => !(b.platform === platform && b.channelId === channelId),
    )
    if (this.bindings.length !== before) {
      this.save()
      this.log.info('binding removed by channel', {
        event: 'binding_removed',
        platform,
        channelId,
      })
      return true
    }
    return false
  }

  unbindById(bindingId: string): boolean {
    const binding = this.bindings.find((b) => b.id === bindingId)
    if (!binding) return false
    this.bindings = this.bindings.filter((b) => b.id !== bindingId)
    this.save()
    this.log.info('binding removed by id', {
      event: 'binding_removed',
      bindingId,
      workspaceId: binding.workspaceId,
      agentSlug: binding.target.agentSlug,
      platform: binding.platform,
      channelId: binding.channelId,
    })
    return true
  }

  /**
   * Remove bindings whose cached session is `sessionId`. Kept for the desktop
   * "disconnect this session" affordance; ordinary session churn should clear
   * the cache with `clearActiveSession` instead of destroying the binding.
   */
  unbindSession(sessionId: string, platform?: PlatformType): number {
    const removedBindings = this.bindings.filter((b) => {
      if (b.activeSessionId !== sessionId) return false
      if (platform && b.platform !== platform) return false
      return true
    })
    if (removedBindings.length === 0) return 0

    this.bindings = this.bindings.filter((b) => !removedBindings.includes(b))
    this.save()
    this.log.info('bindings removed by session', {
      event: 'binding_removed',
      sessionId,
      platform,
      removedCount: removedBindings.length,
      bindingIds: removedBindings.map((b) => b.id),
    })
    return removedBindings.length
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  private migrateLegacy(legacyDir?: string): void {
    if (!legacyDir) return
    const legacyFile = join(legacyDir, 'bindings.json')
    if (existsSync(this.filePath)) return
    if (!existsSync(legacyFile)) return
    try {
      if (!existsSync(this.dirPath)) {
        mkdirSync(this.dirPath, { recursive: true })
      }
      copyFileSync(legacyFile, this.filePath)
      this.log.info('bindings migrated from legacy location', {
        event: 'bindings_migrated',
        legacyFile,
        filePath: this.filePath,
      })
    } catch (err) {
      this.log.error('binding migration failed', {
        event: 'bindings_migration_failed',
        legacyFile,
        filePath: this.filePath,
        error: err,
      })
    }
  }

  private load(): void {
    try {
      if (existsSync(this.filePath)) {
        const raw = readFileSync(this.filePath, 'utf-8')
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) {
          const normalized = parsed.map(normalizeBinding)
          this.bindings = normalized.filter((b): b is ChannelBinding => b !== null)
          const dropped = normalized.length - this.bindings.length
          if (dropped > 0) {
            // No legacy binding shape exists (spec 26): a record without a
            // valid agent target or authorized sender is corrupt, not old.
            this.log.warn('dropped malformed bindings on load', {
              event: 'bindings_dropped',
              filePath: this.filePath,
              droppedCount: dropped,
            })
          }
        }
      }
    } catch (err) {
      this.log.error('failed to load bindings store; resetting to empty', {
        event: 'bindings_load_failed',
        filePath: this.filePath,
        error: err,
      })
      this.bindings = []
    }
  }

  private save(): void {
    try {
      if (!existsSync(this.dirPath)) {
        mkdirSync(this.dirPath, { recursive: true })
      }
      writeFileSync(this.filePath, JSON.stringify(this.bindings, null, 2), 'utf-8')
      // Fire the listener only after the write succeeds — otherwise the UI
      // shows a "binding added" event for state that will disappear on
      // restart.
      this.changeListener?.()
    } catch (err) {
      this.log.error('failed to save bindings store', {
        event: 'bindings_save_failed',
        filePath: this.filePath,
        error: err,
      })
    }
  }
}

// ---------------------------------------------------------------------------
// Migration helpers
// ---------------------------------------------------------------------------

function normalizeBinding(raw: unknown): ChannelBinding | null {
  if (!raw || typeof raw !== 'object') return null
  const candidate = raw as Partial<ChannelBinding>
  if (!isChannelBindingTarget(candidate.target)) return null

  const senderIds = Array.isArray(candidate.authorizedSenderIds)
    ? candidate.authorizedSenderIds.filter((id) => typeof id === 'string' && id.length > 0)
    : []
  if (senderIds.length === 0) return null
  if (!candidate.id || !candidate.platform || !candidate.channelId) return null

  return {
    ...(candidate as ChannelBinding),
    target: candidate.target,
    authorizedSenderIds: senderIds,
    activeSessionId: typeof candidate.activeSessionId === 'string' && candidate.activeSessionId
      ? candidate.activeSessionId
      : undefined,
    config: normalizeBindingConfig(candidate.platform, candidate.config ?? {}),
  }
}
