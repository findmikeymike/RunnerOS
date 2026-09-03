/**
 * SessionResolver — resolves a binding's agent target to a live session.
 *
 * Spec 26. A chat binds to an agent, not a session. `activeSessionId` is a
 * cache that may be discarded at any time; `target` is durable identity. This
 * is what lets a thread survive its session ending: the next message simply
 * resolves a new one.
 *
 * Two invariants matter more than the rest:
 *
 *   1. Resolution is serialized per binding. Two messages arriving together
 *      must not create two sessions — the second waits and reuses the first.
 *   2. The cache is persisted *before* the message is dispatched, so a crash
 *      mid-turn cannot orphan a session that nothing points at.
 */

import type { ISessionManager } from '@craft-agent/server-core/handlers'
import type { BindingStore } from './binding-store'
import type { ChannelBinding, MessagingLogger } from './types'

const NOOP_LOGGER: MessagingLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => NOOP_LOGGER,
}

/** Label applied to every session created for a messaging binding. */
export const MESSAGING_SESSION_LABEL = 'messaging'

export interface ResolvedBindingSession {
  sessionId: string
  /** True when this call created the session rather than reusing the cache. */
  created: boolean
}

export class SessionResolver {
  private readonly log: MessagingLogger
  /** Per-binding serialization. Key: binding id. */
  private readonly inFlight = new Map<string, Promise<ResolvedBindingSession>>()

  constructor(
    private readonly sessionManager: ISessionManager,
    private readonly bindingStore: BindingStore,
    logger: MessagingLogger = NOOP_LOGGER,
  ) {
    this.log = logger
  }

  /**
   * Resolve `binding.target` to a usable session id, creating one if needed.
   * Throws when the agent cannot be resolved — the caller surfaces that to the
   * chat rather than silently falling back to a generic session.
   */
  async resolve(binding: ChannelBinding): Promise<ResolvedBindingSession> {
    const existing = this.inFlight.get(binding.id)
    if (existing) return existing

    const work = this.resolveUncontended(binding).finally(() => {
      this.inFlight.delete(binding.id)
    })
    this.inFlight.set(binding.id, work)
    return work
  }

  private async resolveUncontended(binding: ChannelBinding): Promise<ResolvedBindingSession> {
    const cached = await this.reusableSession(binding)
    if (cached) return { sessionId: cached, created: false }

    const { agentSlug, workspaceId } = binding.target
    const base = await this.sessionManager.resolveAgentSessionOptions(workspaceId, agentSlug)
    const agentName = base.spawnedFromAgent?.agentName ?? agentSlug

    const session = await this.sessionManager.createSession(workspaceId, {
      ...base,
      name: `${agentName} · ${platformLabel(binding.platform)}`,
      spawnedFromAgent: base.spawnedFromAgent ?? {
        agentSlug,
        agentName,
        timestamp: Date.now(),
      },
      labels: [...(base.labels ?? []), MESSAGING_SESSION_LABEL],
    })

    // Persist before the caller dispatches. A crash after this point leaves a
    // reachable session; a crash before it leaves none, which is recoverable.
    this.bindingStore.setActiveSession(binding.id, session.id)

    this.log.info('resolved binding to new session', {
      event: 'binding_session_created',
      bindingId: binding.id,
      agentSlug,
      workspaceId,
      sessionId: session.id,
      platform: binding.platform,
    })

    return { sessionId: session.id, created: true }
  }

  /**
   * The cached session, but only when it is still genuinely serving this
   * target. A mismatch means the session was archived, deleted, moved, or
   * repurposed for another agent — in every case the cache is stale and the
   * binding deserves a fresh session rather than a wrong one.
   */
  private async reusableSession(binding: ChannelBinding): Promise<string | null> {
    const cachedId = binding.activeSessionId
    if (!cachedId) return null

    let session: Awaited<ReturnType<ISessionManager['getSession']>> = null
    try {
      session = await this.sessionManager.getSession(cachedId)
    } catch (err) {
      this.log.warn('failed to load cached session for binding', {
        event: 'binding_session_load_failed',
        bindingId: binding.id,
        sessionId: cachedId,
        error: err,
      })
      session = null
    }

    const reason = staleReason(session, binding)
    if (!reason) return cachedId

    this.log.info('discarding stale binding session', {
      event: 'binding_session_stale',
      bindingId: binding.id,
      sessionId: cachedId,
      agentSlug: binding.target.agentSlug,
      reason,
    })
    this.bindingStore.clearActiveSession(binding.id)
    return null
  }
}

/** Why a cached session cannot be reused, or null when it can. */
function staleReason(
  session: { workspaceId?: string; isArchived?: boolean; spawnedFromAgent?: { agentSlug?: string } } | null,
  binding: ChannelBinding,
): string | null {
  if (!session) return 'missing'
  if (session.isArchived) return 'archived'
  if (session.workspaceId && session.workspaceId !== binding.target.workspaceId) return 'workspace-mismatch'
  if (session.spawnedFromAgent?.agentSlug !== binding.target.agentSlug) return 'agent-mismatch'
  return null
}

function platformLabel(platform: string): string {
  if (platform === 'whatsapp') return 'WhatsApp'
  if (platform === 'telegram') return 'Telegram'
  return platform.charAt(0).toUpperCase() + platform.slice(1)
}
