/**
 * Transport failure visibility (spec 26, slice 7).
 *
 * A remote user cannot see the app. If the connection drops, messages they sent
 * never arrived and no reply is coming — silence is indistinguishable from the
 * agent thinking. These tests cover the notice that breaks that silence.
 */
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { MessagingGatewayRegistry } from '../registry'
import type { PlatformAdapter, SentMessage } from '../types'

const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function makeRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'gap-'))
  tempDirs.push(dir)
  return dir
}

function makeRegistry() {
  const root = makeRoot()
  const sessionManager = {
    getWorkspaces: mock(() => [{ id: 'ws1', name: 'WS', rootPath: join(root, 'ws1') }]),
    resolveAgentSessionOptions: mock(async () => ({})),
    createSession: mock(async () => ({ id: 'sess-1', workspaceId: 'ws1' })),
    sendMessage: mock(async () => {}),
    getSession: mock(async () => null),
  }
  return new MessagingGatewayRegistry({
    sessionManager: sessionManager as any,
    credentialManager: {} as any,
    getMessagingDir: (workspaceId) => join(root, workspaceId, 'messaging'),
  })
}

const sent: string[] = []
function stubAdapter(): PlatformAdapter {
  const noop = async () => {}
  const reply = async (): Promise<SentMessage> => ({
    platform: 'whatsapp', channelId: 'chat-1', messageId: '1',
  })
  return {
    platform: 'whatsapp',
    capabilities: {
      messageEditing: false, inlineButtons: false, maxButtons: 0,
      maxMessageLength: 4096, markdown: 'whatsapp', webhookSupport: false,
    },
    async initialize() {}, async destroy() {},
    isConnected() { return true },
    onMessage() {}, onButtonPress() {},
    async sendText(_c: string, text: string) { sent.push(text); return reply() },
    editMessage: noop,
    sendButtons: async () => reply(),
    sendTyping: noop,
    sendFile: async () => reply(),
  }
}

/** Drive the private state machine the way the adapters do. */
function setRuntime(registry: MessagingGatewayRegistry, patch: Record<string, unknown>) {
  const state = (registry as any).workspaces.get('ws1')
  ;(registry as any).setPlatformRuntime('ws1', state, 'whatsapp', patch)
}

function bind(registry: MessagingGatewayRegistry) {
  const state = (registry as any).workspaces.get('ws1')
  state.gateway.registerAdapter(stubAdapter())
  return state.gateway.getBindingStore().bind('ws1', 'concierge', 'whatsapp', 'chat-1', 'sender-1')
}

describe('connection gap notices', () => {
  it('tells the chat when the connection was down long enough to lose messages', async () => {
    sent.length = 0
    const registry = makeRegistry()
    registry.getConfig('ws1')
    bind(registry)

    setRuntime(registry, { connected: true, state: 'connected' })
    setRuntime(registry, { connected: false, state: 'disconnected' })
    // Backdate the outage past the reportable floor.
    ;(registry as any).connectionGaps.set('ws1:whatsapp', Date.now() - 5 * 60_000)
    setRuntime(registry, { connected: true, state: 'connected' })
    await new Promise((r) => setTimeout(r, 10))

    expect(sent).toHaveLength(1)
    expect(sent[0]).toContain('lost my connection')
    expect(sent[0]).toContain('send it again')
  })

  it('stays quiet for a brief reconnect blip', async () => {
    sent.length = 0
    const registry = makeRegistry()
    registry.getConfig('ws1')
    bind(registry)

    setRuntime(registry, { connected: true, state: 'connected' })
    setRuntime(registry, { connected: false, state: 'disconnected' })
    setRuntime(registry, { connected: true, state: 'connected' })
    await new Promise((r) => setTimeout(r, 10))

    // A transient flap drops nothing worth reporting; announcing it is noise.
    expect(sent).toHaveLength(0)
  })

  it('reports an outage once, not on every later status update', async () => {
    sent.length = 0
    const registry = makeRegistry()
    registry.getConfig('ws1')
    bind(registry)

    setRuntime(registry, { connected: true, state: 'connected' })
    setRuntime(registry, { connected: false, state: 'disconnected' })
    ;(registry as any).connectionGaps.set('ws1:whatsapp', Date.now() - 5 * 60_000)
    setRuntime(registry, { connected: true, state: 'connected' })
    setRuntime(registry, { connected: true, state: 'connected', identity: 'me' })
    await new Promise((r) => setTimeout(r, 10))

    expect(sent).toHaveLength(1)
  })

  it('keeps the original outage start across repeated disconnect events', async () => {
    sent.length = 0
    const registry = makeRegistry()
    registry.getConfig('ws1')
    bind(registry)

    setRuntime(registry, { connected: true, state: 'connected' })
    setRuntime(registry, { connected: false, state: 'disconnected' })
    const started = (registry as any).connectionGaps.get('ws1:whatsapp')
    setRuntime(registry, { connected: false, state: 'error', lastError: 'boom' })

    // A second failure while already down must not reset the clock, or a
    // flapping connection would never look long enough to report.
    expect((registry as any).connectionGaps.get('ws1:whatsapp')).toBe(started)
  })

  it('says nothing when no chat is bound', async () => {
    sent.length = 0
    const registry = makeRegistry()
    registry.getConfig('ws1')
    const state = (registry as any).workspaces.get('ws1')
    state.gateway.registerAdapter(stubAdapter())

    setRuntime(registry, { connected: true, state: 'connected' })
    setRuntime(registry, { connected: false, state: 'disconnected' })
    ;(registry as any).connectionGaps.set('ws1:whatsapp', Date.now() - 5 * 60_000)
    setRuntime(registry, { connected: true, state: 'connected' })
    await new Promise((r) => setTimeout(r, 10))

    expect(sent).toHaveLength(0)
  })
})
