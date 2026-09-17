import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { HandlerFn, RpcServer } from '../../transport/types'
import type { HandlerDeps } from '../handler-deps'

const calls: string[] = []
let permitted = true
mock.module('./team-permission-helpers', () => ({
  assertGlobalSecretVaultPermission: (workspaceId: string) => {
    calls.push(`authorize:${workspaceId}`)
    if (!permitted) throw new Error('Owner permission required in every consuming workspace')
  },
}))
mock.module('../../composio/service', () => ({
  getComposioService: () => ({
    status: async () => { calls.push('status'); return { configured: false, state: 'not_configured' } },
    saveKey: async (_key: string) => { calls.push('saveKey'); return { configured: true, state: 'not_connected' } },
    connect: async () => { calls.push('connect'); return { redirectUrl: 'https://connect.composio.dev/link/test' } },
    refresh: async () => { calls.push('refresh'); return { configured: true, state: 'connected' } },
    disconnect: async () => { calls.push('disconnect'); return { configured: false, state: 'not_configured' } },
  }),
}))
const { registerComposioHandlers, HANDLED_CHANNELS } = await import('./composio')
const handlers = new Map<string, HandlerFn>()
registerComposioHandlers({ handle: (channel: string, handler: HandlerFn) => handlers.set(channel, handler) } as unknown as RpcServer, {} as HandlerDeps)
const context = { clientId: 'test', workspaceId: 'hq', webContentsId: 1 }

describe('Composio connection RPC boundary', () => {
  beforeEach(() => { calls.length = 0; permitted = true })

  it('exposes settings operations only, never email execution or key retrieval', () => {
    expect([...handlers.keys()].sort()).toEqual([...HANDLED_CHANNELS].sort())
    expect(handlers.size).toBe(5)
    expect([...handlers.keys()].some(key => /execute|send|readKey/i.test(key))).toBe(false)
  })

  for (const channel of HANDLED_CHANNELS) {
    it(`${channel} checks global owner authority before touching credentials or Composio`, async () => {
      permitted = false
      await expect(handlers.get(channel)!(context, 'hq', 'test-key')).rejects.toThrow('Owner permission required')
      expect(calls).toEqual(['authorize:hq'])
    })
    it(`${channel} rejects a missing workspace`, async () => {
      await expect(handlers.get(channel)!(context, '', 'test-key')).rejects.toThrow('Select an active workspace')
      expect(calls).toEqual([])
    })
  }

  it('returns only the safe status after saving', async () => {
    const result = await handlers.get(RPC_CHANNELS.composio.SAVE_KEY)!(context, 'hq', 'test-key')
    expect(calls).toEqual(['authorize:hq', 'saveKey'])
    expect(result).toEqual({ configured: true, state: 'not_connected' })
    expect(JSON.stringify(result)).not.toContain('test-key')
  })
})
