import { describe, expect, test } from 'bun:test'
import type { HandlerFn, RpcServer } from '../../transport/types'
import type { HandlerDeps } from '../handler-deps'
import { HANDLED_CHANNELS, registerLabInspirationHandlers } from './lab-inspiration'

describe('Lab inspiration RPC caller boundary', () => {
  test('registration is inert and all endpoints reject unbound or foreign callers before data access', () => {
    const handlers = new Map<string, HandlerFn>()
    let runnerReads = 0
    const server: RpcServer = {
      handle: (name, handler) => { handlers.set(name, handler) },
      push: () => undefined,
      invokeClient: async () => undefined,
    }
    registerLabInspirationHandlers(server, {
      getDeepResearchRunner: () => { runnerReads++; throw new Error('must not start research') },
    } as unknown as HandlerDeps)
    expect(runnerReads).toBe(0)
    expect([...handlers.keys()]).toEqual([...HANDLED_CHANNELS])
    for (const handler of handlers.values()) {
      for (const workspaceId of [null, 'another-lab', 'hq']) {
        expect(() => handler({ clientId: 'fixture', webContentsId: null, workspaceId }, 'target-lab', {}))
          .toThrow('Open this Lab')
      }
    }
    expect(runnerReads).toBe(0)
  })
})
