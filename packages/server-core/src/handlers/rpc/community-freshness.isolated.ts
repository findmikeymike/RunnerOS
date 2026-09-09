import { beforeEach, expect, mock, spyOn, test } from 'bun:test'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { RpcServer } from '../../transport/types'
import type { HandlerDeps } from '../handler-deps'

const community = await import('@craft-agent/shared/community')
const config = await import('@craft-agent/shared/config')
const teams = await import('@craft-agent/shared/workspaces')
const state = { contacts: [], emailJobs: [], suppressions: [], index: {}, migrated: false }
const loadState = mock(() => state)
const refresh = mock((_root: string, broadcast: (id: string, docs: unknown[]) => void) => broadcast('hq', [{ slug: 'hq-state-of-play', body: 'fresh' }]))
const write = mock(() => ({}))
mock.module('@craft-agent/shared/community', () => ({
  ...community,
  loadCommunityState: loadState,
  upsertCommunityContact: write,
  importCommunityCsv: write,
  createCommunityEmailJob: write,
  suppressCommunityContact: write,
}))
mock.module('@craft-agent/shared/config', () => ({ ...config, getWorkspaceByNameOrId: () => ({ id: 'hq', rootPath: '/fixture/hq' }) }))
mock.module('@craft-agent/shared/workspaces', () => ({
  ...teams,
  assertTeamPermission: () => {},
  evaluateTeamPermission: () => ({ allowed: true }),
  getTeamModeStatus: () => ({ machine: { machineId: 'test' } }),
}))
mock.module('../../hq-state/refresh-and-broadcast', () => ({ refreshAndBroadcastArtistManagerState: refresh }))
mock.module('@craft-agent/shared/credentials', () => ({ getCredentialManager: () => ({ getUserSecret: async () => 'configured' }) }))
const { CommunityMailService } = await import('../../community/CommunityMailService')
const { registerCommunityHandlers } = await import('./community')
const approve = spyOn(CommunityMailService.prototype, 'approve').mockReturnValue({ ok: true })
const send = spyOn(CommunityMailService.prototype, 'send').mockResolvedValue({ ok: false, error: 'partial delivery' })
const handlers = new Map<string, (...args: any[]) => any>()
const push = mock(() => {})
registerCommunityHandlers({ handle: (channel: string, handler: (...args: any[]) => any) => handlers.set(channel, handler) } as unknown as RpcServer, { wsServer: { push } } as unknown as HandlerDeps)

beforeEach(() => {
  refresh.mockClear(); loadState.mockClear(); write.mockClear(); push.mockClear()
  loadState.mockImplementation(() => state)
  send.mockResolvedValue({ ok: false, error: 'partial delivery' })
})

test('read-only community GET does not refresh manager briefs', async () => {
  await handlers.get(RPC_CHANNELS.community.GET)!({}, 'hq')
  expect(refresh).not.toHaveBeenCalled()
})

for (const channel of [RPC_CHANNELS.community.ADD_CONTACT, RPC_CHANNELS.community.IMPORT_CSV, RPC_CHANNELS.community.CREATE_EMAIL_JOB, RPC_CHANNELS.community.SUPPRESS]) {
  test(`${channel} refreshes and publishes the changed community picture`, async () => {
    await handlers.get(channel)!({}, 'hq', {})
    expect(write).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledWith(RPC_CHANNELS.workspaceContext.CHANGED, { to: 'all' }, 'hq', [{ slug: 'hq-state-of-play', body: 'fresh' }])
  })
}

test('failed sends still refresh because approval or partial delivery may have changed', async () => {
  const result = await handlers.get(RPC_CHANNELS.community.SEND_EMAIL_JOB)!({}, 'hq', 'job')
  expect(result).toEqual({ ok: false, error: 'partial delivery' })
  expect(approve).toHaveBeenCalled()
  expect(send).toHaveBeenCalled()
  expect(loadState).toHaveBeenCalledWith('/fixture/hq', 'test')
  expect(refresh).toHaveBeenCalledTimes(1)
})

test('summary repair failure cannot replace the actual send outcome', async () => {
  loadState.mockImplementation(() => { throw new Error('summary disk failure') })
  const result = await handlers.get(RPC_CHANNELS.community.SEND_EMAIL_JOB)!({}, 'hq', 'job')
  expect(result).toEqual({ ok: false, error: 'partial delivery' })
})

test('summary repair failure cannot turn successful delivery into failure', async () => {
  send.mockResolvedValue({ ok: true })
  loadState.mockImplementation(() => { throw new Error('summary disk failure') })
  const result = await handlers.get(RPC_CHANNELS.community.SEND_EMAIL_JOB)!({}, 'hq', 'job')
  expect(result).toEqual({ ok: true })
})
