import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type {
  DiscordManagementMessage,
  DiscordManagementReceipt,
  MirrorManagementReceipt,
  OptionsDiscordFollowupReceipt,
} from '@trade-god/contracts'
import {
  FileDiscordManagementFamilyResolver,
  buildDiscordManagementMessage,
  type DiscordManagementFamilyHandler,
  type DiscordManagementFamilyProbe,
} from '../src/index.ts'

const NOW = '2026-08-11T15:05:00.000Z'
const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

const message = (overrides: Partial<Parameters<typeof buildDiscordManagementMessage>[0]> = {}): DiscordManagementMessage => buildDiscordManagementMessage({
  message_id: 'management-family-message-1',
  author_id: '333', channel_id: '222', guild_id: '111',
  raw_text: 'move stop to breakeven',
  posted_at: NOW, observed_at: NOW, is_edit: false,
  ...overrides,
})

class FakeHandler<T> implements DiscordManagementFamilyHandler<T> {
  ingestCount = 0
  resolvedTargets: string[] = []
  dispatchLog: string[] = []
  throwOnceFor = new Set<string>()
  constructor(public probeResult: DiscordManagementFamilyProbe, private readonly result: T) {}
  async probe(): Promise<DiscordManagementFamilyProbe> { return this.probeResult }
  async ingestMessage(): Promise<T> { this.ingestCount += 1; return this.result }
  async ingestResolvedMessage(
    message: DiscordManagementMessage,
    expectedTargetId: string,
  ): Promise<T> {
    this.ingestCount += 1
    this.resolvedTargets.push(expectedTargetId)
    this.dispatchLog.push(message.message_id)
    if (this.throwOnceFor.delete(message.message_id)) throw new Error('Simulated crash after family freeze.')
    return this.result
  }
}

const singleResult = {
  receipt_id: 'single-receipt', status: 'completed',
} as unknown as DiscordManagementReceipt
const mirrorResult = {
  receipt_id: 'mirror-receipt', status: 'completed',
} as unknown as MirrorManagementReceipt
const optionsResult = {
  receipt_id: 'options-receipt', status: 'completed',
} as unknown as OptionsDiscordFollowupReceipt

describe('Discord management family resolver', () => {
  test('blocks cross-family ambiguity before either manager mutates', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'management-family-'))
    roots.push(root)
    const single = new FakeHandler({
      family: 'single', candidates: ['intent-1'], resolved: 'intent-1', strategy: 'channel-symbol',
    }, singleResult)
    const mirror = new FakeHandler({
      family: 'mirror', candidates: ['mirror-1'], resolved: 'mirror-1', strategy: 'channel-symbol',
    }, mirrorResult)
    const resolver = new FileDiscordManagementFamilyResolver({ directory: root, single, mirror, now: () => NOW })

    const result = await resolver.ingestMessage(message())

    expect(result.status).toBe('blocked')
    expect(single.ingestCount).toBe(0)
    expect(mirror.ingestCount).toBe(0)
  })

  test('evaluates options with futures families and blocks before cross-asset mutation', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'management-family-'))
    roots.push(root)
    const single = new FakeHandler({ family: 'single', candidates: ['future-one'], resolved: 'future-one', strategy: 'reply-entry' }, singleResult)
    const mirror = new FakeHandler({ family: 'mirror', candidates: [] }, mirrorResult)
    const options = new FakeHandler({ family: 'options', candidates: ['option-one'], resolved: 'option-one', strategy: 'reply-entry' }, optionsResult)
    const resolver = new FileDiscordManagementFamilyResolver({ directory: root, single, mirror, options, now: () => NOW })

    expect((await resolver.ingestMessage(message())).status).toBe('blocked')
    expect(single.ingestCount + mirror.ingestCount + options.ingestCount).toBe(0)
  })

  test('freezes one family before dispatch and reuses it after candidate drift', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'management-family-'))
    roots.push(root)
    const single = new FakeHandler({ family: 'single', candidates: [] }, singleResult)
    const mirror = new FakeHandler({
      family: 'mirror', candidates: ['mirror-1'], resolved: 'mirror-1', strategy: 'reply-entry',
    }, mirrorResult)
    const resolver = new FileDiscordManagementFamilyResolver({ directory: root, single, mirror, now: () => NOW })

    expect((await resolver.ingestMessage(message())).receipt_id).toBe('mirror-receipt')
    single.probeResult = {
      family: 'single', candidates: ['intent-late'], resolved: 'intent-late', strategy: 'channel-symbol',
    }
    mirror.probeResult = { family: 'mirror', candidates: [] }
    expect((await resolver.ingestMessage(message())).receipt_id).toBe('mirror-receipt')
    expect(single.ingestCount).toBe(0)
    expect(mirror.ingestCount).toBe(2)
    expect(mirror.resolvedTargets).toEqual(['mirror-1', 'mirror-1'])
  })

  test('durably defers a pending family without dispatch', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'management-family-'))
    roots.push(root)
    const single = new FakeHandler({ family: 'single', candidates: [] }, singleResult)
    const mirror = new FakeHandler({
      family: 'mirror', candidates: ['mirror-pending'], retryable: true, error: 'Parent is dispatching.',
    }, mirrorResult)
    const resolver = new FileDiscordManagementFamilyResolver({ directory: root, single, mirror, now: () => NOW })

    const result = await resolver.ingestMessage(message())

    expect(result.status).toBe('deferred')
    expect(single.ingestCount + mirror.ingestCount).toBe(0)
    mirror.probeResult = {
      family: 'mirror', candidates: ['mirror-pending'], resolved: 'mirror-pending', strategy: 'reply-entry',
    }
    expect((await resolver.ingestMessage(message())).receipt_id).toBe('mirror-receipt')
    expect(mirror.ingestCount).toBe(1)
  })

  test('recovers newer frozen work before an older deferred instruction', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'management-family-'))
    roots.push(root)
    const single = new FakeHandler({ family: 'single', candidates: [] }, singleResult)
    const mirror = new FakeHandler({
      family: 'mirror', candidates: ['mirror-pending'], retryable: true, error: 'Parent is dispatching.',
    }, mirrorResult)
    const resolver = new FileDiscordManagementFamilyResolver({ directory: root, single, mirror, now: () => NOW })
    const older = message({
      message_id: 'management-family-older', raw_text: 'all out',
      posted_at: '2026-08-11T15:04:00.000Z',
    })
    expect((await resolver.ingestMessage(older)).status).toBe('deferred')

    mirror.probeResult = {
      family: 'mirror', candidates: ['mirror-pending'], resolved: 'mirror-pending', strategy: 'reply-entry',
    }
    const newer = message({ message_id: 'management-family-newer' })
    mirror.throwOnceFor.add(newer.message_id)
    await expect(resolver.ingestMessage(newer)).rejects.toThrow('Simulated crash')
    mirror.dispatchLog = []

    await resolver.recoverPending()

    expect(mirror.dispatchLog).toEqual([newer.message_id, older.message_id])
  })

  test('materializes newer frozen work before an older frozen instruction', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'management-family-'))
    roots.push(root)
    const single = new FakeHandler({ family: 'single', candidates: [] }, singleResult)
    const mirror = new FakeHandler({
      family: 'mirror', candidates: ['mirror-active'], resolved: 'mirror-active', strategy: 'reply-entry',
    }, mirrorResult)
    const resolver = new FileDiscordManagementFamilyResolver({ directory: root, single, mirror, now: () => NOW })
    const older = message({
      message_id: 'management-family-frozen-older', raw_text: 'all out',
      posted_at: '2026-08-11T15:04:00.000Z',
    })
    mirror.throwOnceFor.add(older.message_id)
    await expect(resolver.ingestMessage(older)).rejects.toThrow('Simulated crash')
    const newer = message({ message_id: 'management-family-frozen-newer' })
    mirror.throwOnceFor.add(newer.message_id)
    await expect(resolver.ingestMessage(newer)).rejects.toThrow('Simulated crash')
    mirror.dispatchLog = []

    await resolver.recoverPending()

    expect(mirror.dispatchLog).toEqual([newer.message_id, older.message_id])
  })
})
