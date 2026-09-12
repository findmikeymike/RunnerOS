import { afterAll, expect, mock, spyOn, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RpcServer } from '../../transport/types'
import type { HandlerDeps } from '../handler-deps'

const profile = mkdtempSync(join(tmpdir(), 'community-review-profile-'))
process.env.CRAFT_CONFIG_DIR = profile
const community = await import('@craft-agent/shared/community')
const config = await import('@craft-agent/shared/config')
const teams = await import('@craft-agent/shared/workspaces')
const { RPC_CHANNELS } = await import('@craft-agent/shared/protocol')
const root = join(profile, 'workspace')
mock.module('@craft-agent/shared/config', () => ({ ...config, getWorkspaceByNameOrId: () => ({ id: 'hq', rootPath: root }) }))
mock.module('@craft-agent/shared/workspaces', () => ({ ...teams, assertTeamPermission() {}, getTeamModeStatus: () => ({ machine: { machineId: 'owner' } }) }))
const provider = { from: 'hello@artist.test', unsubscribeUrl: 'https://artist.test/unsubscribe', postalAddress: 'PO Box 1' }
mock.module('@craft-agent/shared/credentials', () => ({ getCredentialManager: () => ({ getUserSecret: async (key: string) => key === 'COMMUNITY_FROM_EMAIL' ? provider.from : key === 'COMMUNITY_UNSUBSCRIBE_URL' ? provider.unsubscribeUrl : key === 'COMMUNITY_POSTAL_ADDRESS' ? provider.postalAddress : 'configured' }) }))
mock.module('../../hq-state/refresh-and-broadcast', () => ({ refreshAndBroadcastArtistManagerState() {} }))
const { CommunityMailService } = await import('../../community/CommunityMailService')
const send = spyOn(CommunityMailService.prototype, 'send').mockResolvedValue({ ok: true })
const { registerCommunityHandlers } = await import('./community')
const handlers = new Map<string, (...args: unknown[]) => Promise<Record<string, unknown>>>()
registerCommunityHandlers({ handle: (channel: string, handler: (...args: unknown[]) => Promise<Record<string, unknown>>) => handlers.set(channel, handler) } as unknown as RpcServer, {} as HandlerDeps)
afterAll(() => { send.mockRestore(); rmSync(profile, { recursive: true, force: true }) })

function draft() {
  community.upsertCommunityContact(root, 'owner', { email: 'fan@example.com', segment: 'general', consentStatus: 'opted-in' })
  return community.createCommunityEmailJob(root, 'owner', { title: 'Review', segmentIds: ['general'], subject: 'Shown subject', bodyMarkdown: 'Shown body' }, { status: 'draft' })
}
const review = (job: ReturnType<typeof draft>) => ({ revision: job.revision, lastWriteSha256: job.lastWriteSha256, sender: { ...provider } })

test('Send rejects stale and absent reviewed snapshots before reaching the send engine', async () => {
  const shown = draft()
  community.updateEmailJobDraft(root, 'other-window', shown, { subject: 'Replacement' })
  send.mockClear()
  for (const reviewed of [review(shown), undefined]) {
    const result = await handlers.get(RPC_CHANNELS.community.SEND_EMAIL_JOB)!({}, 'hq', shown.id, reviewed)
    expect(result).toMatchObject({ ok: false, failure: 'review-changed' })
  }
  expect(send).not.toHaveBeenCalled()
  expect(community.readEmailJob(root, shown.id)?.status).toBe('draft')
})

test('Save rejects a concurrent replacement; successful Save returns the only snapshot Send accepts', async () => {
  const shown = draft()
  const patch = { subject: 'Artist edit', bodyMarkdown: 'Artist body' }
  const update = handlers.get(RPC_CHANNELS.community.UPDATE_EMAIL_JOB)!
  const saved = await update({}, 'hq', shown.id, patch, review(shown))
  expect(saved.ok).toBe(true)
  const savedJob = saved.job as ReturnType<typeof draft>
  expect(savedJob.content.subject).toBe('Artist edit')
  expect(await update({}, 'hq', shown.id, { subject: 'Stale overwrite' }, review(shown)))
    .toMatchObject({ ok: false, failure: 'review-changed' })
  expect(community.readEmailJob(root, shown.id)?.content.subject).toBe('Artist edit')
  const sendHandler = handlers.get(RPC_CHANNELS.community.SEND_EMAIL_JOB)!
  expect(await sendHandler({}, 'hq', shown.id, review(shown))).toMatchObject({ ok: false, failure: 'review-changed' })
  send.mockClear()
  expect(await sendHandler({}, 'hq', shown.id, review(savedJob))).toMatchObject({ ok: true })
  expect(send).toHaveBeenCalledTimes(1)
  expect(community.readEmailJob(root, shown.id)?.status).toBe('approved')
})

for (const field of ['from', 'unsubscribeUrl', 'postalAddress'] as const) {
  test(`a cached ${field} cannot approve sending through changed setup`, async () => {
    const shown = draft()
    const reviewed = review(shown)
    const original = provider[field]
    provider[field] = field === 'from' ? 'different@artist.test' : field === 'unsubscribeUrl' ? 'https://different.test/unsubscribe' : 'Different postal address'
    send.mockClear()
    try {
      const handler = handlers.get(RPC_CHANNELS.community.SEND_EMAIL_JOB)!
      expect(await handler({}, 'hq', shown.id, reviewed)).toMatchObject({ ok: false, failure: 'sender-changed' })
      expect(community.readEmailJob(root, shown.id)?.status).toBe('draft')
      expect(send).not.toHaveBeenCalled()
      expect(await handler({}, 'hq', shown.id, review(shown))).toMatchObject({ ok: true })
      expect(send).toHaveBeenCalledTimes(1)
      expect(send.mock.calls[0]?.[3]).toMatchObject(provider)
    } finally { provider[field] = original }
  })
}

test('a job revision without the displayed sender cannot approve sending', async () => {
  const shown = draft()
  send.mockClear()
  const result = await handlers.get(RPC_CHANNELS.community.SEND_EMAIL_JOB)!({}, 'hq', shown.id, {
    revision: shown.revision, lastWriteSha256: shown.lastWriteSha256,
  })
  expect(result).toMatchObject({ ok: false, failure: 'sender-changed' })
  expect(community.readEmailJob(root, shown.id)?.status).toBe('draft')
  expect(send).not.toHaveBeenCalled()
})
