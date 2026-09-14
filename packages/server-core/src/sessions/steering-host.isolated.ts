import { afterAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Message } from '@craft-agent/core/types'
import type { StoredSession } from '@craft-agent/shared/sessions'
import { recoverQueuedMessage } from './steering-queue'

// SessionManager captures config paths during module load. Keep all real storage
// confined to this profile; only host instance seams are stubbed, never modules.
const root = mkdtempSync(join(tmpdir(), 'steering-host-'))
const originalConfig = process.env.CRAFT_CONFIG_DIR
process.env.CRAFT_CONFIG_DIR = root
const workspace = { id: 'fixture', name: 'Fixture', slug: 'fixture', rootPath: join(root, 'workspace'), createdAt: 1 }
mkdirSync(workspace.rootPath)
writeFileSync(join(root, 'config.json'), JSON.stringify({ workspaces: [workspace], activeWorkspaceId: workspace.id }))
const { SessionManager } = await import('./SessionManager')
const { createSession, saveSession, loadSession } = await import('@craft-agent/shared/sessions')
const { messageToStored } = await import('@craft-agent/core/types')
afterAll(() => {
  if (originalConfig === undefined) delete process.env.CRAFT_CONFIG_DIR
  else process.env.CRAFT_CONFIG_DIR = originalConfig
  rmSync(root, { recursive: true, force: true })
})
const tick = () => new Promise<void>(resolve => setImmediate(resolve))
const message = (id: string, content = id): Message => ({ id, role: 'user', content, timestamp: 1, isQueued: true, inputOrigin: 'human' })

function fixture(messages: Message[]) {
  const events: any[] = []
  const operations: string[] = []
  const managed: any = {
    id: 'fixture-session', workspace, messages, messagesLoaded: true,
    messageQueue: [], pendingSteers: new Map(), processingGeneration: 1,
    isProcessing: false, stopRequested: false, agent: { takePendingSteers: () => [], forceAbort: () => operations.push('abort') },
  }
  const manager: any = Object.create(SessionManager.prototype)
  Object.assign(manager, {
    sessions: new Map([[managed.id, managed]]), workspaceMigrationLocks: new Set(), taskModeOpenings: new Map(),
    sendMessageAdmissionLocks: new Map(), pendingPermissionRequests: new Map(),
    assertPaidExecutionAuthorized: () => {},
    acquireSendMessageAdmissionLock: async () => () => operations.push('unlock'),
    ensureMessagesLoaded: async () => {}, validateSignalHandoffBeforeSend: async () => null,
    monotonic: () => 10, persistSession: () => operations.push('persist'), flushSession: async () => { operations.push('flush') },
    sendEvent: (event: any) => { events.push(event); operations.push(event.status ?? event.type) },
  })
  return { manager, managed, events, operations }
}

describe('real SessionManager steering host paths', () => {
  test('queue-only sends never silently redirect the active response', async () => {
    const { manager, managed, operations } = fixture([])
    managed.isProcessing = true
    managed.agent.redirect = () => { throw new Error('Must not steer') }
    await manager.sendMessage(managed.id, 'Next task', undefined, undefined, { inputOrigin: 'human', queueOnly: true, optimisticMessageId: 'optimistic' })
    expect(managed.messageQueue).toHaveLength(1)
    expect(managed.messages[0].queuedOptions.queueOnly).toBe(true)
    expect(operations).toContain('queued')
  })

  test('editing uses optimistic identity and preserves attachments and skills', async () => {
    const update = { ...message('edit'), attachments: [{ id: 'file', type: 'text' as const, name: 'notes.txt', mimeType: 'text/plain', size: 2, storedPath: '/fixture/notes' }], queuedOptions: { skillSlugs: ['writer'], optimisticMessageId: 'ui-id' } }
    const { manager, managed, events } = fixture([update])
    managed.isProcessing = true
    managed.messageQueue = [recoverQueuedMessage(update)]
    await manager.changeQueuedMessage(managed.id, { messageId: 'ui-id', action: 'edit', content: 'TikTok only' })
    expect(managed.messageQueue[0].message).toBe('TikTok only')
    expect(managed.messageQueue[0].storedAttachments).toEqual(update.attachments)
    expect(managed.messageQueue[0].options.skillSlugs).toEqual(['writer'])
    expect(events[0].optimisticMessageId).toBe('ui-id')
  })

  test('remove deletes only the selected queued update', async () => {
    const a = message('a'), b = message('b')
    const { manager, managed } = fixture([a, b])
    managed.isProcessing = true
    managed.messageQueue = [recoverQueuedMessage(a), recoverQueuedMessage(b)]
    await manager.changeQueuedMessage(managed.id, { messageId: 'a', action: 'remove' })
    expect(managed.messages.map((m: Message) => m.id)).toEqual(['b'])
    expect(managed.messageQueue.map((m: any) => m.messageId)).toEqual(['b'])
  })

  test('steer persists first, interrupts once, then dispatches the chosen update with its original id', async () => {
    const a = message('a'), b = message('b')
    const { manager, managed, operations } = fixture([a, b])
    managed.isProcessing = true
    managed.messageQueue = [recoverQueuedMessage(a), recoverQueuedMessage(b)]
    await manager.changeQueuedMessage(managed.id, { messageId: 'b', action: 'steer' })
    expect(operations.indexOf('abort')).toBeGreaterThan(operations.indexOf('flush'))
    await expect(manager.changeQueuedMessage(managed.id, { messageId: 'b', action: 'steer' })).rejects.toThrow('interruption')
    expect(operations.filter((op: string) => op === 'abort')).toHaveLength(1)
    managed.isProcessing = false; managed.stopRequested = false
    const calls: any[] = []
    manager.sendMessage = async (...args: any[]) => { calls.push(args) }
    manager.processNextQueuedMessage(managed.id)
    await tick()
    expect(calls[0][5]).toBe('b')
    expect(managed.messageQueue).toHaveLength(2)
  })

  test('already-dispatched or approval-blocked updates cannot be steered', async () => {
    const update = message('a')
    const { manager, managed, operations } = fixture([update])
    managed.messageQueue = [recoverQueuedMessage(update)]
    managed.queuedDispatch = managed.messageQueue[0]
    await expect(manager.changeQueuedMessage(managed.id, { messageId: 'a', action: 'remove' })).rejects.toThrow('already started')
    managed.queuedDispatch = undefined; managed.steeringHandoff = 'auth'
    await expect(manager.changeQueuedMessage(managed.id, { messageId: 'a', action: 'steer' })).rejects.toThrow('approval or connection')
    expect(operations).not.toContain('abort')
  })

  test('failed persistence rolls back queue edits and never interrupts', async () => {
    const update = message('a')
    const { manager, managed, operations } = fixture([update])
    managed.isProcessing = true
    managed.messageQueue = [recoverQueuedMessage(update)]
    manager.flushSession = async () => { throw new Error('disk unavailable') }
    await expect(manager.changeQueuedMessage(managed.id, { messageId: 'a', action: 'steer' })).rejects.toThrow('disk unavailable')
    expect(managed.messages[0].queuedOptions).toBeUndefined()
    expect(operations).not.toContain('abort')
  })

  test('recovery requeues distinct ids in transcript order once and ignores obsolete callbacks', () => {
    const first = message('first', 'same')
    const second = message('second', 'same')
    const { manager, managed, events } = fixture([first, second])
    managed.pendingSteers.set(first.id, recoverQueuedMessage(first))
    managed.messageQueue = [recoverQueuedMessage(second)]
    manager.requeueUndeliveredSteers(managed, ['first', 'first'])
    manager.requeueUndeliveredSteers(managed, ['first', 'obsolete'])
    expect(managed.messageQueue.map((entry: any) => entry.messageId)).toEqual(['first', 'second'])
    expect(events.filter(event => event.status === 'queued')).toHaveLength(1)
  })

  for (const handoff of ['auth', 'plan'] as const) {
    test(`${handoff} handoff preserves pending corrections without automatically draining`, async () => {
      const update = message('update')
      const { manager, managed } = fixture([update])
      managed.pendingSteers.set(update.id, recoverQueuedMessage(update))
      managed.agent.takePendingSteers = () => [{ messageId: update.id, message: update.content }]
      const calls: unknown[] = []
      manager.sendMessage = async (...args: unknown[]) => { calls.push(args) }
      manager.recoverPendingSteers(managed, handoff)
      manager.processNextQueuedMessage(managed.id)
      await tick()
      expect(calls).toEqual([])
      expect(managed.messageQueue).toHaveLength(1)
      expect(update.queuedHandoff).toBe(handoff)
    })
  }

  test('deferred replay retains the accepted id and replay metadata', async () => {
    const update: Message = { ...message('accepted'), hidden: true, displayIntent: 'agent-delegation-task', inputOrigin: 'agent', queuedOptions: { skillSlugs: ['songwriter'], legacySkillReferences: ['global/frozen'], optimisticMessageId: 'optimistic' }, attachments: [{ id: 'a', type: 'text', name: 'notes.txt', mimeType: 'text/plain', size: 5, storedPath: join(root, 'notes.txt') }] }
    const { manager, managed } = fixture([update])
    managed.messageQueue = [recoverQueuedMessage(update)]
    const calls: any[][] = []
    manager.sendMessage = async (...args: any[]) => { calls.push(args) }
    manager.processNextQueuedMessage(managed.id)
    expect(calls).toEqual([])
    await tick()
    expect(calls).toHaveLength(1)
    expect(calls[0]![1]).toBe(update.content)
    expect(calls[0]![3]).toEqual(update.attachments)
    expect(calls[0]![4]).toMatchObject({ hidden: true, displayIntent: 'agent-delegation-task', inputOrigin: 'agent', skillSlugs: ['songwriter'], legacySkillReferences: ['global/frozen'], optimisticMessageId: 'optimistic' })
    expect(calls[0]![5]).toBe('accepted')
  })

  test('Stop restores pending correction text and clears ids before late undelivered callbacks', async () => {
    const first = message('first', 'Keep the chorus')
    const second = message('second', 'Change the verse')
    const { manager, managed, events } = fixture([first, second])
    managed.isProcessing = true
    managed.pendingSteers.set(first.id, recoverQueuedMessage(first))
    managed.agent.takePendingSteers = () => [{ messageId: first.id, message: first.content }]
    managed.messageQueue = [recoverQueuedMessage(second)]
    await manager.cancelProcessing(managed.id, true)
    managed.isProcessing = false // backend abort settles; do not trigger timeout cleanup
    manager.requeueUndeliveredSteers(managed, [first.id])
    expect(events.find(event => event.type === 'interrupted')?.queuedMessages).toEqual(['Keep the chorus', 'Change the verse'])
    expect(managed.messages.map((entry: Message) => entry.id)).toEqual([])
    expect(managed.messageQueue).toEqual([])
    expect(managed.pendingSteers.size).toBe(0)
  })

  test('midstream send flushes accepted text before redirect and acceptance event', async () => {
    const { manager, managed, operations } = fixture([])
    managed.isProcessing = true
    managed.agent.supportsSteerRecovery = true
    managed.agent.redirect = (_text: string, id: string) => { expect(id).toBeTruthy(); operations.push('redirect'); return true }
    await manager.sendMessage(managed.id, 'Keep the ending', undefined, undefined, { inputOrigin: 'human', optimisticMessageId: 'optimistic' })
    expect(operations.indexOf('flush')).toBeGreaterThan(operations.indexOf('persist'))
    expect(operations.indexOf('redirect')).toBeGreaterThan(operations.indexOf('flush'))
    expect(operations.indexOf('accepted')).toBeGreaterThan(operations.indexOf('redirect'))
    expect(managed.messages).toHaveLength(1)
    expect(managed.pendingSteers.has(managed.messages[0].id)).toBe(true)
  })
  test('background ownership is rechecked after persistence before steering dispatch', async () => {
    const { manager, managed, operations } = fixture([])
    managed.isProcessing = true
    manager.assertBackgroundExecutionFence = (_root: string, fence?: string) => {
      expect(fence).toBe('owner-fence')
      if (operations.includes('flush')) throw new Error('Background ownership changed')
    }
    managed.agent.redirect = () => { throw new Error('Stale owner must not steer') }
    await expect(manager.sendMessage(managed.id, 'Keep the ending', undefined, undefined,
      { inputOrigin: 'agent', backgroundFence: 'owner-fence' })).rejects.toThrow('Background ownership changed')
    expect(operations).not.toContain('accepted')
    expect(managed.messages[0].backgroundFence).toBe('owner-fence')
    expect(managed.messages[0].isQueued).toBe(true)
  })

  test('queued replay refreshes the idle backend before clearing its durable receipt', async () => {
    const update = message('refresh-first')
    const { manager, managed } = fixture([update])
    managed.messageQueue = [recoverQueuedMessage(update)]
    manager.refreshIdleAgentBackend = async () => {
      expect(update.isQueued).toBe(true)
      expect(managed.messageQueue[0].messageId).toBe(update.id)
      throw new Error('Refresh barrier')
    }
    await expect(manager.sendMessage(managed.id, update.content, undefined, undefined,
      { inputOrigin: 'human' }, update.id)).rejects.toThrow('Refresh barrier')
    expect(update.isQueued).toBe(true)
  })

  for (const kind of ['attachment', 'skill', 'legacy-skill'] as const) {
    test(`midstream ${kind} correction stays queued intact instead of becoming text-only steering`, async () => {
      const { manager, managed, operations } = fixture([])
      managed.isProcessing = true
      managed.agent.supportsSteerRecovery = true
      managed.agent.redirect = () => { throw new Error('Rich update must not redirect') }
      const files = kind === 'attachment' ? [{ type: 'text', path: join(root, 'notes.txt'), name: 'notes.txt', mimeType: 'text/plain', size: 5, text: 'Notes' }] : undefined
      const options = { inputOrigin: 'human', optimisticMessageId: 'optimistic-rich', skillSlugs: kind === 'skill' ? ['songwriter'] : undefined, legacySkillReferences: kind === 'legacy-skill' ? ['global/frozen'] : undefined }
      await manager.sendMessage(managed.id, 'Use these notes', files, undefined, options)
      expect(managed.messageQueue).toHaveLength(1)
      expect(managed.messageQueue[0].attachments).toEqual(files)
      expect(managed.messageQueue[0].options).toEqual(options)
      expect(operations).toContain('queued')
      expect(operations).not.toContain('accepted')
    })
  }

  test('pending source retry retains the next accepted update without draining it', async () => {
    const update = message('source-waiting')
    const { manager, managed } = fixture([update])
    managed.messageQueue = [recoverQueuedMessage(update)]
    managed.pendingSourceRetry = { token: 'source-retry' }
    let calls = 0
    manager.sendMessage = async () => { calls++ }
    manager.processNextQueuedMessage(managed.id)
    await tick()
    expect(calls).toBe(0)
    expect(managed.messageQueue[0].messageId).toBe(update.id)
  })

  test('Stop between scheduling replay and setImmediate restores the text without replaying it', async () => {
    const update = message('pending-dispatch', 'Keep this correction')
    const { manager, managed, events } = fixture([update])
    managed.messageQueue = [recoverQueuedMessage(update)]
    let calls = 0
    manager.sendMessage = async () => { calls++ }
    manager.processNextQueuedMessage(managed.id)
    expect(managed.queuedDispatch?.messageId).toBe(update.id)
    await manager.cancelProcessing(managed.id, true)
    await tick()
    expect(calls).toBe(0)
    expect(events.find(event => event.type === 'interrupted')?.queuedMessages).toEqual(['Keep this correction'])
    expect(managed.messageQueue).toEqual([])
    expect(managed.messages).toEqual([])
    expect(managed.stopRequested).toBe(false)
    expect(managed.wasInterrupted).not.toBe(true)
  })

  test('repeated scheduling while dispatch is pending admits the accepted id once', async () => {
    const update = message('one-dispatch')
    const { manager, managed } = fixture([update])
    managed.messageQueue = [recoverQueuedMessage(update)]
    const ids: string[] = []
    manager.sendMessage = async (...args: any[]) => { ids.push(args[5]) }
    manager.processNextQueuedMessage(managed.id)
    manager.processNextQueuedMessage(managed.id)
    await tick()
    expect(ids).toEqual([update.id])
  })

  test('failed persistence neither steers nor leaves a rejected correction for later replay', async () => {
    const { manager, managed, events } = fixture([])
    managed.isProcessing = true
    managed.agent.supportsSteerRecovery = true
    let redirects = 0
    managed.agent.redirect = () => { redirects++; return true }
    manager.flushSession = async () => { throw new Error('Fixture disk failure') }
    await expect(manager.sendMessage(managed.id, 'Rejected correction', undefined, undefined, { inputOrigin: 'human' })).rejects.toThrow('Fixture disk failure')
    expect(redirects).toBe(0)
    expect(events.filter(event => event.type === 'user_message')).toEqual([])
    expect(managed.messages).toEqual([])
    expect(managed.messageQueue).toEqual([])
    expect(managed.pendingSteers.size).toBe(0)
    managed.isProcessing = false
    let replayed = false
    manager.sendMessage = async () => { replayed = true }
    manager.processNextQueuedMessage(managed.id)
    await tick()
    expect(replayed).toBe(false)
  })

  test('real session JSONL roundtrip recovers queued identity, metadata, and handoff without replay', async () => {
    const stored: StoredSession = {
      ...await createSession(workspace.rootPath, { name: 'Pending correction' }),
      messages: [],
      tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 },
    }
    const update: Message = {
      ...message('persisted-update', 'Use the stored notes'), inputOrigin: 'agent', hidden: true,
      displayIntent: 'agent-delegation-task', queuedHandoff: 'auth', backgroundFence: 'persisted-fence',
      queuedOptions: { optimisticMessageId: 'optimistic-durable', skillSlugs: ['writer'], legacySkillReferences: ['global/frozen'] },
      badges: [{ type: 'skill', label: 'Writer', rawText: '@writer', start: 0, end: 7 }],
      attachments: [{ id: 'notes', type: 'text', name: 'notes.txt', mimeType: 'text/plain', size: 5, storedPath: join(root, 'durable-notes.txt') }],
    }
    stored.messages = [messageToStored(update)]
    await saveSession(stored)
    const loaded = loadSession(workspace.rootPath, stored.id)!
    expect(loaded.messages[0]).toMatchObject({ id: update.id, isQueued: true, queuedHandoff: 'auth', queuedOptions: update.queuedOptions })
    const { manager, managed } = fixture([])
    managed.id = stored.id
    managed.messagesLoaded = false
    manager.sessions = new Map([[stored.id, managed]])
    manager.messageLoadingPromises = new Map()
    delete manager.ensureMessagesLoaded
    let replayed = false
    manager.sendMessage = async () => { replayed = true }
    await manager.ensureMessagesLoaded(managed)
    await tick()
    expect(replayed).toBe(false)
    expect(managed.steeringHandoff).toBe('auth')
    expect(managed.messageQueue).toHaveLength(1)
    expect(managed.messageQueue[0]).toMatchObject({
      messageId: update.id, message: update.content, optimisticMessageId: 'optimistic-durable', storedAttachments: update.attachments,
      options: { inputOrigin: 'agent', backgroundFence: 'persisted-fence', hidden: true, displayIntent: update.displayIntent, badges: update.badges, skillSlugs: ['writer'], legacySkillReferences: ['global/frozen'] },
    })
  })

  test('real idle send appends behind an existing accepted queue and acknowledges its original new id', async () => {
    const earlier = message('earlier-accepted', 'First correction')
    const { manager, managed } = fixture([earlier])
    managed.messageQueue = [recoverQueuedMessage(earlier)]
    // Keep admission observable without starting a provider for the earlier entry.
    const drained: string[][] = []
    manager.processNextQueuedMessage = () => { drained.push(managed.messageQueue.map((entry: any) => entry.messageId)) }
    const acknowledgments: string[] = []
    await manager.sendMessage(managed.id, 'Second correction', undefined, undefined, { inputOrigin: 'human', optimisticMessageId: 'new-optimistic' }, undefined, undefined, (id: string) => acknowledgments.push(id))
    expect(managed.messageQueue.map((entry: any) => entry.message)).toEqual(['First correction', 'Second correction'])
    const acceptedId = managed.messages[1].id
    expect(acknowledgments).toEqual([acceptedId])
    expect(managed.messageQueue[1].messageId).toBe(acceptedId)
    expect(drained).toEqual([['earlier-accepted', acceptedId]])
    expect(managed.wasInterrupted).not.toBe(true)
  })

  test('normal completion with a waiting correction does not mark the response interrupted', async () => {
    const update = message('next-turn')
    const { manager, managed } = fixture([update])
    managed.isProcessing = true
    managed.messageQueue = [recoverQueuedMessage(update)]
    manager.setProcessing = (session: any, processing: boolean) => { session.isProcessing = processing }
    manager.isSessionBeingViewed = () => false
    manager.chatGoalDriver = { invalidate: () => {} }
    let drains = 0
    manager.processNextQueuedMessage = () => { drains++ }
    await manager.onProcessingStopped(managed.id, 'complete', managed.processingGeneration)
    expect(managed.wasInterrupted).not.toBe(true)
    expect(managed.isProcessing).toBe(false)
    expect(drains).toBe(1)
  })

  test('failed replay automatically restores text without retained replay or unsafe Retry', async () => {
    const update = message('failed-replay', 'Keep this correction')
    const { manager, managed, events } = fixture([update])
    managed.messageQueue = [recoverQueuedMessage(update)]
    let attempts = 0
    manager.sendMessage = async () => { attempts++; throw new Error('Replay rejected') }
    manager.onProcessingStopped = async () => { manager.processNextQueuedMessage(managed.id) }
    manager.processNextQueuedMessage(managed.id)
    await tick()
    await tick()
    expect(attempts).toBe(1)
    expect(events.find((event: any) => event.type === 'interrupted')?.queuedMessages).toEqual(['Keep this correction'])
    expect(managed.messages.some((entry: any) => entry.id === update.id)).toBe(false)
    expect(events.find((event: any) => event.type === 'interrupted')?.message).toBeTruthy()
    expect(managed.messageQueue).toEqual([])
    const error = events.find((event: any) => event.error?.code === 'queued_message_replay_failed')?.error
    expect(error.canRetry).toBe(false)
    expect(error.actions).toEqual([])
    manager.processNextQueuedMessage(managed.id)
    await tick()
    expect(attempts).toBe(1)
  })

  test('failed replay removes restored input from persisted recovery queue', async () => {
    const stored: StoredSession = {
      ...await createSession(workspace.rootPath, { name: 'Replay failure recovery' }),
      messages: [],
      tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 },
    }
    const update = message('retry-original', 'Restore this update')
    const { manager, managed, events } = fixture([update])
    managed.id = stored.id
    manager.sessions = new Map([[stored.id, managed]])
    managed.messageQueue = [recoverQueuedMessage(update)]
    manager.onProcessingStopped = async () => {}
    manager.sendMessage = async () => { update.isQueued = false; throw new Error('Replay persistence failed') }
    manager.processNextQueuedMessage(managed.id)
    await tick()
    expect(events.find((event: any) => event.type === 'interrupted')?.queuedMessages).toEqual(['Restore this update'])
    stored.messages = managed.messages.map(messageToStored)
    await saveSession(stored)
    const recovered = loadSession(workspace.rootPath, stored.id)!
    expect(recovered.messages.filter((entry: any) => entry.isQueued)).toEqual([])
    expect(recovered.messages.find((entry: any) => entry.id === update.id)).toBeUndefined()
  })

})
