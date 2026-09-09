import { afterAll, expect, mock, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { loadContextDoc } from '@craft-agent/shared/workspace-context'
import { parseHqStateOfPlay, parseCampaignManagerBrief } from '@craft-agent/shared/hq-state'
import type { RpcServer } from '../../transport/types'
import type { HandlerDeps } from '../handler-deps'

const root = mkdtempSync(join(tmpdir(), 'manager-freshness-integration-'))
const workspaces = [
  { id: 'hq-fixture', name: 'Artist HQ', rootPath: join(root, 'hq'), artistWorkspaceScope: 'hq' },
  { id: 'campaign-fixture', name: 'Release', rootPath: join(root, 'campaign'), artistWorkspaceScope: 'campaign' },
]
for (const workspace of workspaces) mkdirSync(workspace.rootPath, { recursive: true })
const config = await import('@craft-agent/shared/config')
const teams = await import('@craft-agent/shared/workspaces')
mock.module('@craft-agent/shared/config', () => ({
  ...config, getWorkspaces: () => workspaces,
  getWorkspaceByNameOrId: (id: string) => workspaces.find(workspace => workspace.id === id),
}))
mock.module('@craft-agent/shared/workspaces', () => ({
  ...teams, assertTeamPermission: () => {},
  evaluateTeamPermission: () => ({ allowed: true }),
  getTeamModeStatus: () => ({ machine: { machineId: 'fixture' } }),
}))
const { registerCommunityHandlers } = await import('./community')
const { registerReleaseKitHandlers } = await import('./release-kit')
const { refreshHqStateContextDoc } = await import('../../hq-state/refresh')
const handlers = new Map<string, (...args: any[]) => any>()
const events: Array<{ channel: string; id: string; docs: any[] }> = []
const server = { handle: (channel: string, handler: (...args: any[]) => any) => handlers.set(channel, handler) } as unknown as RpcServer
const deps = { wsServer: { push: (channel: string, _target: unknown, id: string, docs: any[]) => events.push({ channel, id, docs }) } } as unknown as HandlerDeps
registerCommunityHandlers(server, deps)
registerReleaseKitHandlers(server, deps)
afterAll(() => rmSync(root, { recursive: true, force: true }))

test('adding a real contact removes the saved HQ contact gap and broadcasts the new brief', async () => {
  const hq = workspaces[0]!
  const before = parseHqStateOfPlay(refreshHqStateContextDoc(hq.rootPath).body)!
  expect(before.missing).toContain('community contacts')
  await handlers.get(RPC_CHANNELS.community.ADD_CONTACT)!({}, hq.id, {
    email: 'fan@example.test', name: 'Fan', segment: 'general', consentStatus: 'opted_in', source: 'manual',
  })
  const saved = loadContextDoc(hq.rootPath, 'hq-state-of-play')!
  expect(parseHqStateOfPlay(saved.body)!.missing).not.toContain('community contacts')
  const event = events.findLast(event => event.channel === RPC_CHANNELS.workspaceContext.CHANGED && event.id === hq.id)!
  expect(event.docs.find(doc => doc.slug === 'hq-state-of-play').body).toBe(saved.body)
  expect(loadContextDoc(workspaces[1]!.rootPath, 'campaign-state-of-play')).toBeTruthy()
})

test('promoting real audio changes campaign readiness and sends fresh HQ plus campaign docs', async () => {
  const campaign = workspaces[1]!
  const source = join(root, 'master.wav')
  writeFileSync(source, 'audio fixture')
  const before = parseCampaignManagerBrief(loadContextDoc(campaign.rootPath, 'campaign-state-of-play')!.body)!
  events.length = 0
  await handlers.get(RPC_CHANNELS.releaseKit.PROMOTE)!({}, campaign.id, {
    source: { type: 'upload', originalFileName: 'master.wav' }, uploadPath: source,
    category: 'audio', subtype: 'master', makePrimary: true,
  })
  const saved = loadContextDoc(campaign.rootPath, 'campaign-state-of-play')!
  const after = parseCampaignManagerBrief(saved.body)!
  expect(before.campaign.releaseReadiness?.kit.categories.find(category => category.label === 'Audio')?.ready).toBe(0)
  expect(after.campaign.releaseReadiness?.kit.categories.find(category => category.label === 'Audio')?.ready).toBe(1)
  const contextEvents = events.filter(event => event.channel === RPC_CHANNELS.workspaceContext.CHANGED)
  expect(contextEvents.map(event => event.id)).toEqual(['hq-fixture', 'campaign-fixture'])
  expect(contextEvents[1]!.docs.find(doc => doc.slug === 'campaign-state-of-play').body).toBe(saved.body)
  // Repeated reads neither rebuild nor republish manager context.
  events.length = 0
  await handlers.get(RPC_CHANNELS.releaseKit.GET)!({}, campaign.id)
  expect(events.filter(event => event.channel === RPC_CHANNELS.workspaceContext.CHANGED)).toHaveLength(0)
})
