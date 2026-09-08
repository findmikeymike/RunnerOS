import { describe, expect, test } from 'bun:test'
import { WsRpcServer } from '../server.ts'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

function harness(server = new WsRpcServer()) {
  const errors: string[] = []
  const internal = server as any
  internal.safeSend = () => {}
  internal.sendResponseError = (_ws: unknown, _id: string, _channel: string, _code: string, message: string) => errors.push(message)
  return {
    server, errors,
    request: () => internal.onRequest(
      { id: 'client', workspaceId: 'campaign', webContentsId: null, ws: {} },
      { id: 'request', type: 'request', channel: 'files:write', args: [] },
    ) as Promise<void>,
  }
}

describe('campaign cleanup RPC fence', () => {
  test('blocks admission during cleanup and resumes after release', async () => {
    const { server, errors, request } = harness()
    let writes = 0
    server.handle('files:write', () => { writes++ })
    const release = server.acquireCampaignCleanupFence()
    await request()
    expect(writes).toBe(0)
    expect(errors[0]).toContain('cleanup is in progress')
    release()
    await request()
    expect(writes).toBe(1)
    const secondRelease = server.acquireCampaignCleanupFence()
    release() // An old owner cannot release a newer cleanup fence.
    expect(() => server.acquireCampaignCleanupFence()).toThrow('pending app operations')
    secondRelease()
  })

  test('refuses cleanup while authorization is pending, then releases on denial', async () => {
    const pending = deferred()
    const { server, request } = harness(new WsRpcServer({ authorizeRequest: async () => {
      await pending.promise
      throw new Error('Denied')
    } }))
    let writes = 0
    server.handle('files:write', () => { writes++ })
    const result = request()
    expect(() => server.acquireCampaignCleanupFence()).toThrow('pending app operations')
    pending.resolve()
    await result
    expect(writes).toBe(0)
    server.acquireCampaignCleanupFence()()
  })

  test('continues to block cleanup after response timeout until the real write settles', async () => {
    const pending = deferred()
    const { server, errors, request } = harness()
    const internalClass = WsRpcServer as any
    const originalTimeout = internalClass.HANDLER_TIMEOUT_MS
    internalClass.HANDLER_TIMEOUT_MS = 5
    let writes = 0
    server.handle('files:write', async () => { await pending.promise; writes++ })
    try {
      await request()
      expect(errors[0]).toContain('Handler timeout')
      expect(() => server.acquireCampaignCleanupFence()).toThrow('pending app operations')
      pending.resolve()
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(writes).toBe(1)
      server.acquireCampaignCleanupFence()()
    } finally {
      pending.resolve()
      internalClass.HANDLER_TIMEOUT_MS = originalTimeout
    }
  })
})
