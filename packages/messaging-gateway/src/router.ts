/**
 * Router — routes inbound messages from platform adapters to sessions.
 *
 * Looks up the ChannelBinding for (platform, channelId).
 * If found → resolves any `IncomingAttachment.localPath` entries to
 * `FileAttachment`s via `readFileAttachment()`, then forwards to
 * SessionManager.
 * If not found → delegates to Commands for /bind, /new, etc.
 */

import type { ISessionManager } from '@craft-agent/server-core/handlers'
import { readFileAttachment } from '@craft-agent/shared/utils'
import type { FileAttachment } from '@craft-agent/shared/protocol'
import type { BindingStore } from './binding-store'
import type { Commands } from './commands'
import type { SessionResolver } from './session-resolver'
import type { IncomingMessage, MessagingLogger, PlatformAdapter } from './types'

const NOOP_LOGGER: MessagingLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => NOOP_LOGGER,
}

export class Router {
  constructor(
    private readonly sessionManager: ISessionManager,
    private readonly bindingStore: BindingStore,
    private readonly commands: Commands,
    private readonly sessionResolver: SessionResolver,
    private readonly log: MessagingLogger = NOOP_LOGGER,
  ) {}

  async route(adapter: PlatformAdapter, msg: IncomingMessage): Promise<void> {
    const binding = this.bindingStore.findByChannel(msg.platform, msg.channelId, msg.senderId)

    if (binding) {
      let sessionId: string | undefined
      try {
        const fileAttachments = this.resolveAttachments(msg)
        // The binding names an agent; the session serving it is resolved (and
        // created when needed) here. A thread therefore survives its session
        // ending — spec 26.
        const resolved = await this.sessionResolver.resolve(binding)
        sessionId = resolved.sessionId
        this.log.info('routing inbound chat message to session', {
          event: 'message_routed',
          platform: msg.platform,
          channelId: msg.channelId,
          agentSlug: binding.target.agentSlug,
          sessionId,
          sessionCreated: resolved.created,
          bindingId: binding.id,
          attachmentCount: fileAttachments?.length ?? 0,
        })
        await this.sessionManager.sendMessage(
          sessionId,
          msg.text,
          fileAttachments,
          undefined, // storedAttachments (handled by session layer)
          undefined, // SendMessageOptions
        )
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error'
        this.log.error('failed to route inbound chat message', {
          event: 'message_route_failed',
          platform: msg.platform,
          channelId: msg.channelId,
          agentSlug: binding.target.agentSlug,
          sessionId,
          bindingId: binding.id,
          error: err,
        })
        await adapter.sendText(
          msg.channelId,
          sessionId
            ? `Failed to send message to ${binding.target.agentSlug}: ${errorMsg}`
            : `Could not reach ${binding.target.agentSlug}: ${errorMsg}`,
        )
      }
      return
    }

    this.log.info('routing inbound chat message to command handler', {
      event: 'message_unbound',
      platform: msg.platform,
      channelId: msg.channelId,
      messageId: msg.messageId,
    })
    await this.commands.handle(adapter, msg)
  }

  /**
   * Convert adapter-emitted `IncomingAttachment[]` into the session's
   * `FileAttachment[]` shape. Adapters that download the blob to disk
   * populate `localPath`; we wrap it with `readFileAttachment()` which
   * handles image→base64 / pdf→base64 / text→utf-8 encoding.
   *
   * Attachments without a `localPath`, or whose file can't be read, are
   * silently skipped — the upstream adapter already logged/notified on
   * download failure, so re-surfacing here would double up.
   */
  private resolveAttachments(msg: IncomingMessage): FileAttachment[] | undefined {
    if (!msg.attachments?.length) return undefined
    const built: FileAttachment[] = []
    for (const a of msg.attachments) {
      if (!a.localPath) continue
      const att = readFileAttachment(a.localPath) as FileAttachment | null
      if (!att) continue
      if (a.fileName) att.name = a.fileName
      built.push(att)
    }
    return built.length > 0 ? built : undefined
  }
}
