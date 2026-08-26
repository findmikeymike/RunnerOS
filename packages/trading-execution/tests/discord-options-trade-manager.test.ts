import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { buildDiscordManagementMessage, FileDiscordOptionsTradeManager, sha256 } from '../src/index.ts'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))
const now = '2026-08-26T15:01:00.000Z'

function fixture(root: string, openQuantity = 2, cancelState: 'position-open' | 'cancel-unknown' = 'position-open') {
  let record = { intent_id: 'options-intent-one', state: 'open-position', open_quantity: openQuantity }
  const calls: Array<{ action: string; request: string; quantity?: unknown }> = []
  const automationReceipt = {
    receipt_id: 'entry-receipt-one', execution_intent_id: record.intent_id, connection_id: 'options-connection-one',
    author_id: 'trader-one', channel_id: 'channel-one', thread_id: null, message_id: 'entry-message-one',
  }
  const plan = { receipt_id: automationReceipt.receipt_id, decision: { decision_id: record.intent_id }, connection: { connection_id: automationReceipt.connection_id } }
  const manager = new FileDiscordOptionsTradeManager({
    directory: path.join(root, 'followups'),
    automationReceipts: { list: async () => [automationReceipt] } as any,
    automationPlans: { list: async () => [plan] } as any,
    resolveRuntime: async () => ({
      executions: {
        getRecordOrNull: async (id: string) => id === record.intent_id ? record : null,
        getRecord: async () => record,
      } as any,
      positionManager: {
        cancelWorkingEntry: async (input: { request_id: string }) => {
          calls.push({ action: 'cancel', request: input.request_id })
          return { management_id: `cancel-${input.request_id}`, content_checksum: sha256(input), state: cancelState }
        },
        closePosition: async (input: { request_id: string; quantity: any }) => {
          calls.push({ action: 'close', request: input.request_id, quantity: input.quantity })
          const quantity = typeof input.quantity === 'object'
            ? record.open_quantity * input.quantity.numerator / input.quantity.denominator
            : input.quantity === 'all' ? record.open_quantity : input.quantity
          if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > record.open_quantity) {
            throw new Error('Partial close does not resolve to a whole number of owned contracts.')
          }
          record = { ...record, state: quantity === record.open_quantity ? 'closed-flat' : 'open-position', open_quantity: record.open_quantity - quantity }
          return {
            management_id: `close-${input.request_id}`, content_checksum: sha256(input),
            state: record.state, requested_close_quantity: quantity, closed_quantity: quantity,
            remaining_open_quantity: record.open_quantity,
          }
        },
      } as any,
    }),
    now: () => now,
  })
  return { manager, calls, getRecord: () => record }
}

function message(rawText: string, id = 'followup-one', postedAt = '2026-08-26T15:00:30.000Z', isEdit = false) {
  return buildDiscordManagementMessage({
    message_id: id, author_id: 'trader-one', channel_id: 'channel-one', reply_to_message_id: 'entry-message-one',
    raw_text: rawText, posted_at: postedAt, observed_at: postedAt, is_edit: isEdit,
  })
}

describe('Discord options trade manager', () => {
  test('freezes one exact reply, cancels the entry remainder, closes all, and deduplicates replay', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'discord-options-followup-')); roots.push(root)
    const setup = fixture(root)
    const first = await setup.manager.ingestMessage(message('all out'))
    expect(first).toMatchObject({ status: 'completed', resolved_intent_id: 'options-intent-one' })
    expect(setup.calls.map((call) => call.action)).toEqual(['cancel', 'close'])
    expect((await setup.manager.ingestMessage(message('all out'))).content_checksum).toBe(first.content_checksum)
    expect(setup.calls).toHaveLength(2)
  })

  test('blocks a non-integral half without any close mutation', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'discord-options-followup-')); roots.push(root)
    const setup = fixture(root, 3)
    const receipt = await setup.manager.ingestMessage(message('taking half'))
    expect(receipt).toMatchObject({ status: 'failed', error: 'Partial close does not resolve to a whole number of owned contracts.' })
    expect(setup.calls.map((call) => call.action)).toEqual(['cancel', 'close'])
    expect(setup.getRecord().open_quantity).toBe(3)
  })

  test('fails closed on stop movement and leaves provider management untouched', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'discord-options-followup-')); roots.push(root)
    const setup = fixture(root)
    expect(await setup.manager.ingestMessage(message('move stop to breakeven'))).toMatchObject({ status: 'blocked' })
    expect(setup.calls).toHaveLength(0)
  })

  test('does not let a close overtake uncertain entry cancellation', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'discord-options-followup-')); roots.push(root)
    const setup = fixture(root, 2, 'cancel-unknown')
    expect(await setup.manager.ingestMessage(message('all out'))).toMatchObject({ status: 'executing' })
    expect(setup.calls.map((call) => call.action)).toEqual(['cancel'])
  })

  test('blocks edited follow-ups before any provider mutation', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'discord-options-followup-')); roots.push(root)
    const setup = fixture(root)
    expect(await setup.manager.ingestMessage(message('all out', 'edited-followup', '2026-08-26T15:00:30.000Z', true)))
      .toMatchObject({ status: 'blocked', error: 'Edited Discord messages cannot change an options trade.' })
    expect(setup.calls).toHaveLength(0)
  })

  test('blocks stale and future-dated follow-ups before any provider mutation', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'discord-options-followup-')); roots.push(root)
    const setup = fixture(root)
    expect(await setup.manager.ingestMessage(message('all out', 'stale-followup', '2026-08-24T15:00:30.000Z')))
      .toMatchObject({ status: 'blocked', error: 'Stale Discord messages are not executable.' })
    expect(await setup.manager.ingestMessage(message('all out', 'future-followup', '2026-08-26T15:03:00.000Z')))
      .toMatchObject({ status: 'blocked', error: 'Future-dated Discord messages are not executable.' })
    expect(setup.calls).toHaveLength(0)
  })
})
