import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Session } from '@craft-agent/shared/protocol'
import type { ISessionManager } from '@craft-agent/server-core/handlers'
import { BindingStore } from '../binding-store'
import { Commands } from '../commands'
import type { IncomingMessage, PlatformAdapter, SentMessage } from '../types'

function makeSession(id: string, name: string, lastMessageAt: number): Session {
  return {
    id,
    name,
    workspaceId: 'ws1',
    workspaceName: 'Workspace',
    messages: [],
    createdAt: lastMessageAt - 1000,
    updatedAt: lastMessageAt,
    lastMessageAt,
    isArchived: false,
  } as unknown as Session
}

function makeSessionManager(sessions: Session[]): ISessionManager {
  return {
    getSessions: () => sessions,
    getSession: async (sessionId: string) => sessions.find((session) => session.id === sessionId) ?? null,
    createSession: async () => { throw new Error('not implemented') },
    resolveAgentSessionOptions: async (_ws: string, agentSlug: string) => {
      if (agentSlug === 'concierge') return { spawnedFromAgent: { agentSlug, agentName: 'HNIC', timestamp: 1 } }
      throw new Error(`No agent: ${agentSlug}`)
    },
    archiveSession: async () => {},
    sendMessage: async () => {},
    cancelProcessing: async () => {},
    respondToPermission: () => true,
  } as unknown as ISessionManager
}

function makeAdapter(platform: 'telegram' | 'whatsapp', inlineButtons: boolean): PlatformAdapter & { sent: string[] } {
  const sent: string[] = []
  return {
    platform,
    capabilities: {
      messageEditing: inlineButtons,
      inlineButtons,
      maxButtons: 10,
      maxMessageLength: 4096,
      markdown: platform === 'telegram' ? 'v2' : 'whatsapp',
      webhookSupport: false,
    },
    sent,
    async initialize() {},
    async destroy() {},
    isConnected() { return true },
    onMessage() {},
    onButtonPress() {},
    async sendText(_channelId: string, text: string): Promise<SentMessage> {
      sent.push(text)
      return { platform, channelId: 'chan-1', messageId: String(sent.length) }
    },
    async editMessage() {},
    async sendButtons(_channelId: string, text: string): Promise<SentMessage> {
      sent.push(text)
      return { platform, channelId: 'chan-1', messageId: String(sent.length) }
    },
    async sendTyping() {},
    async sendFile(): Promise<SentMessage> {
      return { platform, channelId: 'chan-1', messageId: String(sent.length + 1) }
    },
  }
}

function makeMessage(text: string): IncomingMessage {
  return {
    platform: 'whatsapp',
    channelId: 'chan-1',
    messageId: 'm1',
    senderId: 'u1',
    senderName: 'Alice',
    text,
    timestamp: Date.now(),
    raw: {},
  }
}

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function makeStore(): BindingStore {
  const dir = mkdtempSync(join(tmpdir(), 'commands-bind-'))
  tempDirs.push(dir)
  return new BindingStore(dir)
}

describe('Commands', () => {
  it('binds to an agent by slug and restricts the channel to that sender', async () => {
    const store = makeStore()
    const commands = new Commands(makeSessionManager([]), store, 'ws1')
    const adapter = makeAdapter('whatsapp', false)

    await commands.handleCommand(adapter, makeMessage('/bind concierge'))

    const binding = store.findByChannel('whatsapp', 'chan-1', 'u1')
    expect(binding?.target).toEqual({ kind: 'agent', agentSlug: 'concierge', workspaceId: 'ws1' })
    // No session is created at bind time — one is resolved on the first message.
    expect(binding?.activeSessionId).toBeUndefined()
    expect(binding?.authorizedSenderIds).toEqual(['u1'])
    expect(store.findByChannel('whatsapp', 'chan-1')).toBeUndefined()
    expect(store.findByChannel('whatsapp', 'chan-1', 'other')).toBeUndefined()
    expect(adapter.sent.at(-1)).toContain('concierge')
  })

  it('refuses an unknown agent slug rather than binding to nothing', async () => {
    const store = makeStore()
    const commands = new Commands(makeSessionManager([]), store, 'ws1')
    const adapter = makeAdapter('whatsapp', false)

    await commands.handleCommand(adapter, makeMessage('/bind not-an-agent'))

    expect(store.findByChannel('whatsapp', 'chan-1', 'u1')).toBeUndefined()
    expect(adapter.sent.at(-1)).toContain('not-an-agent')
  })

  it('refuses the removed session-id bind form with an explanation', async () => {
    const store = makeStore()
    const commands = new Commands(makeSessionManager([]), store, 'ws1')
    const adapter = makeAdapter('whatsapp', false)

    await commands.handleCommand(adapter, makeMessage('/bind 1'))

    expect(store.getAll()).toHaveLength(0)
    expect(adapter.sent.at(-1)).toContain('agent')
  })

  it('directs an unbound chat to the agent list when /bind has no argument', async () => {
    const store = makeStore()
    const commands = new Commands(makeSessionManager([]), store, 'ws1')
    const adapter = makeAdapter('whatsapp', false)

    await commands.handleCommand(adapter, makeMessage('/bind'))

    expect(store.getAll()).toHaveLength(0)
    expect(adapter.sent[0]).toContain('/bind')
  })

  it('lists WhatsApp Home Gateway commands in help', async () => {
    const store = makeStore()
    const commands = new Commands(makeSessionManager([]), store, 'ws1')
    const adapter = makeAdapter('whatsapp', false)

    await commands.handleCommand(adapter, makeMessage('/help'))

    expect(adapter.sent[0]).toContain('/workspaces')
    expect(adapter.sent[0]).toContain('/where')
    expect(adapter.sent[0]).toContain('/use <workspace>')
  })
})
