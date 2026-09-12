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
mock.module('@craft-agent/shared/credentials', () => ({ getCredentialManager: () => ({ getUserSecret: async () => 'configured' }) }))
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
const review = (job: ReturnType<typeof draft>) => ({ revision: job.revision, lastWriteSha256: job.lastWriteSha256 })

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
