/**
 * Commands — handles chat commands from unbound or bound channels.
 *
 * /pair <code>   — redeem a desktop-issued pairing code (binds to an agent)
 * /bind <slug>   — bind this chat to an agent
 * /agents        — list agents this chat may bind to
 * /who           — show the bound agent
 * /reset         — start a fresh thread with the same agent
 * /unbind        — disconnect channel
 * /help          — show available commands
 * /stop          — abort the current agent run
 *
 * Spec 26: chats bind to agents, never sessions. `/new` and session-id binding
 * are removed — the latter was an enumerate-then-hijack pair.
 */

import type { ISessionManager } from '@craft-agent/server-core/handlers'
import type { BindingStore } from './binding-store'
import type {
  IncomingMessage,
  MessagingLogger,
  PlatformAdapter,
  PlatformType,
} from './types'

const NOOP_LOGGER: MessagingLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => NOOP_LOGGER,
}

/**
 * Supplied by the registry. The gateway passes the consumer down to Commands so
 * /pair can redeem codes issued via the app UI. Only codes belonging to the
 * gateway's own workspace are honored.
 */
export interface PairingCodeConsumer {
  /**
   * Returns whether this sender may still attempt a /pair consume this minute.
   * Defence-in-depth against brute-forcing the 6-digit code. Counted on entry,
   * not after validation, so wrong guesses consume budget too.
   */
  canConsume(platform: PlatformType, senderId: string): boolean
  /** Returns the pending pairing (workspace + session) if the code is valid, or null. */
  consume(platform: PlatformType, code: string): { workspaceId: string; agentSlug: string } | null
}

/**
 * Minimal agent listing for `/agents` and bind buttons. Optional: without it,
 * `/bind <slug>` still works (the slug is validated against the library) but
 * the chat cannot browse.
 */
export interface AgentDirectory {
  list(workspaceId: string): Promise<Array<{ slug: string; name: string; description?: string }>>
}

export class Commands {
  private readonly log: MessagingLogger

  constructor(
    private readonly sessionManager: ISessionManager,
    private readonly bindingStore: BindingStore,
    private readonly workspaceId: string,
    private readonly pairingConsumer?: PairingCodeConsumer,
    logger: MessagingLogger = NOOP_LOGGER,
    private readonly agentDirectory?: AgentDirectory,
  ) {
    this.log = logger
  }

  /** True when the slug names an agent this workspace can actually run. */
  private async agentExists(agentSlug: string): Promise<boolean> {
    try {
      await this.sessionManager.resolveAgentSessionOptions(this.workspaceId, agentSlug)
      return true
    } catch {
      return false
    }
  }

  async handle(adapter: PlatformAdapter, msg: IncomingMessage): Promise<void> {
    const text = msg.text.trim()

    if (text.startsWith('/bind')) {
      await this.handleBind(adapter, msg)
    } else if (text.startsWith('/pair')) {
      await this.handlePair(adapter, msg)
    } else if (text === '/unbind') {
      await this.handleUnbind(adapter, msg)
    } else if (text === '/help') {
      await this.handleHelp(adapter, msg)
    } else {
      await adapter.sendText(
        msg.channelId,
        'This chat is not connected yet.\n\n' +
        '/pair <code> — redeem a pairing code from the app\n' +
        '/help — show all commands',
      )
    }
  }

  async handleCommand(adapter: PlatformAdapter, msg: IncomingMessage): Promise<boolean> {
    const text = msg.text.trim()
    if (!text.startsWith('/')) return false

    const cmd = text.split(/\s+/)[0]!.toLowerCase()

    this.log.info('handling chat command', {
      event: 'command_received',
      workspaceId: this.workspaceId,
      platform: adapter.platform,
      channelId: msg.channelId,
      senderId: msg.senderId,
      command: cmd,
    })

    switch (cmd) {
      case '/bind':
        await this.handleBind(adapter, msg)
        return true
      case '/pair':
        await this.handlePair(adapter, msg)
        return true
      case '/unbind':
        await this.handleUnbind(adapter, msg)
        return true
      case '/help':
        await this.handleHelp(adapter, msg)
        return true
      case '/who':
      case '/status':
        await this.handleWho(adapter, msg)
        return true
      case '/agents':
        await this.handleAgents(adapter, msg)
        return true
      case '/reset':
        await this.handleReset(adapter, msg)
        return true
      case '/stop':
        await this.handleStop(adapter, msg)
        return true
      default:
        return false
    }
  }

  // -------------------------------------------------------------------------
  // Command handlers
  // -------------------------------------------------------------------------

  private async handleBind(adapter: PlatformAdapter, msg: IncomingMessage): Promise<void> {
    const arg = msg.text.replace(/^\/bind\s*/, '').trim()

    // Session-id binding is gone (spec 26). Refuse the old form explicitly
    // rather than reinterpreting it as an agent slug.
    if (/^\d+$/.test(arg) || /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(arg)) {
      await adapter.sendText(
        msg.channelId,
        'Chats connect to an agent now, not a session. Try /agents to see who is available, then /bind <agent>.',
      )
      return
    }

    if (!arg) {
      await this.handleAgents(adapter, msg)
      return
    }

    if (!msg.senderId) {
      await adapter.sendText(msg.channelId, 'Could not identify you well enough to bind this chat.')
      return
    }

    const agentSlug = arg.toLowerCase()
    if (!(await this.agentExists(agentSlug))) {
      await adapter.sendText(msg.channelId, `No agent named "${agentSlug}". Try /agents.`)
      return
    }

    this.bindingStore.bind(
      this.workspaceId,
      agentSlug,
      adapter.platform,
      msg.channelId,
      msg.senderId,
      msg.senderName,
    )

    this.log.info('chat bound to agent', {
      event: 'chat_bound',
      workspaceId: this.workspaceId,
      agentSlug,
      platform: adapter.platform,
      channelId: msg.channelId,
    })

    await adapter.sendText(msg.channelId, `Connected to ${agentSlug}. Just type to start.`)
  }

  private async handleAgents(adapter: PlatformAdapter, msg: IncomingMessage): Promise<void> {
    if (!this.agentDirectory) {
      await adapter.sendText(
        msg.channelId,
        'Use /bind <agent> with the agent name shown in the app.',
      )
      return
    }

    let agents: Array<{ slug: string; name: string; description?: string }> = []
    try {
      agents = await this.agentDirectory.list(this.workspaceId)
    } catch (err) {
      this.log.error('failed to list agents for chat', {
        event: 'agents_list_failed',
        workspaceId: this.workspaceId,
        error: err,
      })
      await adapter.sendText(msg.channelId, 'Could not load the agent list right now.')
      return
    }

    if (agents.length === 0) {
      await adapter.sendText(msg.channelId, 'No agents are active in this workspace yet.')
      return
    }

    if (adapter.capabilities.inlineButtons) {
      const buttons = agents.slice(0, adapter.capabilities.maxButtons).map((a) => ({
        id: `bind:${a.slug}`,
        label: a.name.slice(0, 30),
        data: a.slug,
      }))
      await adapter.sendButtons(msg.channelId, 'Who should this chat talk to?', buttons)
      return
    }

    const lines = agents.map((a) => `• ${a.name} (${a.slug})`)
    await adapter.sendText(
      msg.channelId,
      'Who should this chat talk to?\n' + lines.join('\n') + '\n\nUse /bind <agent>.',
    )
  }

  /**
   * Start a fresh thread with the same agent. Clears the cached session only —
   * `target` is untouched, so the counterpart is unchanged.
   */
  private async handleReset(adapter: PlatformAdapter, msg: IncomingMessage): Promise<void> {
    const binding = this.bindingStore.findByChannel(adapter.platform, msg.channelId, msg.senderId)
    if (!binding) {
      await adapter.sendText(msg.channelId, 'This chat is not connected to an agent.')
      return
    }

    const previous = binding.activeSessionId
    this.bindingStore.clearActiveSession(binding.id)
    if (previous) {
      await this.sessionManager.archiveSession(previous).catch((err) => {
        this.log.warn('failed to archive session on reset', {
          event: 'reset_archive_failed',
          bindingId: binding.id,
          sessionId: previous,
          error: err,
        })
      })
    }

    await adapter.sendText(
      msg.channelId,
      `Started a fresh thread with ${binding.target.agentSlug}.`,
    )
  }

  private async handlePair(adapter: PlatformAdapter, msg: IncomingMessage): Promise<void> {
    if (!this.pairingConsumer) {
      await adapter.sendText(msg.channelId, 'Pairing is not available in this build.')
      return
    }

    // Throttle BEFORE format validation — otherwise an attacker gets
    // unlimited "is this a valid format" feedback that's almost as useful
    // as a code check. Every `/pair` attempt counts against the budget.
    if (!this.pairingConsumer.canConsume(adapter.platform, msg.senderId)) {
      this.log.warn('pairing consume rate limit hit', {
        event: 'pairing_consume_rate_limited',
        workspaceId: this.workspaceId,
        platform: adapter.platform,
        channelId: msg.channelId,
        senderId: msg.senderId,
      })
      await adapter.sendText(
        msg.channelId,
        '⏳ Too many pairing attempts. Try again in a minute.',
      )
      return
    }

    const arg = msg.text.replace(/^\/pair\s*/i, '').trim()
    const code = arg.replace(/\s+/g, '')

    if (!/^\d{6}$/.test(code)) {
      await adapter.sendText(
        msg.channelId,
        'Usage: /pair <6-digit code>\n\nGenerate a code from the session menu in the Runner app.',
      )
      return
    }

    const entry = this.pairingConsumer.consume(adapter.platform, code)
    if (!entry) {
      await adapter.sendText(msg.channelId, 'Invalid or expired pairing code.')
      return
    }

    if (!msg.senderId) {
      await adapter.sendText(msg.channelId, 'Could not identify you well enough to bind this chat.')
      return
    }

    this.bindingStore.bind(
      entry.workspaceId,
      entry.agentSlug,
      adapter.platform,
      msg.channelId,
      msg.senderId,
      msg.senderName,
    )

    this.log.info('pairing code redeemed', {
      event: 'pairing_redeemed',
      workspaceId: entry.workspaceId,
      agentSlug: entry.agentSlug,
      platform: adapter.platform,
      channelId: msg.channelId,
    })

    await adapter.sendText(
      msg.channelId,
      `✅ Connected to ${entry.agentSlug}. You can start chatting now.`,
    )
  }

  private async handleUnbind(adapter: PlatformAdapter, msg: IncomingMessage): Promise<void> {
    if (!this.bindingStore.findByChannel(adapter.platform, msg.channelId, msg.senderId)) {
      await adapter.sendText(msg.channelId, 'No session is bound to this chat for your sender.')
      return
    }
    const removed = this.bindingStore.unbind(adapter.platform, msg.channelId)
    if (removed) {
      await adapter.sendText(msg.channelId, 'Disconnected from session.')
    } else {
      await adapter.sendText(msg.channelId, 'No session is bound to this chat.')
    }
  }

  private async handleWho(adapter: PlatformAdapter, msg: IncomingMessage): Promise<void> {
    const binding = this.bindingStore.findByChannel(adapter.platform, msg.channelId, msg.senderId)
    if (!binding) {
      await adapter.sendText(msg.channelId, 'This chat is not connected to an agent. Use /pair or /bind.')
      return
    }

    const mode = binding.config.approvalChannel
    const responseMode = binding.config.responseMode

    await adapter.sendText(
      msg.channelId,
      `Connected to ${binding.target.agentSlug}\nWorkspace: ${binding.target.workspaceId}\nApproval: ${mode}\nResponse mode: ${responseMode}`,
    )
  }

  private async handleStop(adapter: PlatformAdapter, msg: IncomingMessage): Promise<void> {
    const binding = this.bindingStore.findByChannel(adapter.platform, msg.channelId, msg.senderId)
    if (!binding) {
      await adapter.sendText(msg.channelId, 'No session bound.')
      return
    }

    if (!binding.activeSessionId) {
      await adapter.sendText(msg.channelId, 'Nothing to stop.')
      return
    }

    try {
      await this.sessionManager.cancelProcessing(binding.activeSessionId)
      await adapter.sendText(msg.channelId, 'Stopped.')
    } catch {
      await adapter.sendText(msg.channelId, 'Nothing to stop.')
    }
  }

  private async handleHelp(adapter: PlatformAdapter, msg: IncomingMessage): Promise<void> {
    const whatsappHomeLines = adapter.platform === 'whatsapp'
      ? '/workspaces — list Home Gateway workspaces\n' +
        '/where — show current Home Gateway workspace\n' +
        '/use <workspace> — route this WhatsApp chat to a workspace\n'
      : ''

    await adapter.sendText(
      msg.channelId,
      'Commands:\n' +
      '/pair <code> — connect this chat using a code from the app\n' +
      '/who — show who this chat is connected to\n' +
      '/reset — start a fresh thread\n' +
      '/stop — stop what it is doing right now\n' +
      '/unbind — disconnect this chat\n' +
      whatsappHomeLines +
      '/help — show this message',
    )
  }

  private getRecentSessions(): ReturnType<ISessionManager['getSessions']> {
    return this.sessionManager.getSessions(this.workspaceId)
      .filter((s) => !s.isArchived)
      .sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0))
      .slice(0, 10)
  }

  private async resolveBindTarget(
    bindArg: string,
    recent: ReturnType<ISessionManager['getSessions']>,
  ): Promise<Awaited<ReturnType<ISessionManager['getSession']>> | undefined> {
    if (/^\d+$/.test(bindArg)) {
      const index = Number(bindArg)
      if (index >= 1 && index <= recent.length) {
        return recent[index - 1]
      }
    }
    return this.sessionManager.getSession(bindArg)
  }
}
