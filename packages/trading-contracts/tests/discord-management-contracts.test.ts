import { describe, expect, test } from 'bun:test'

import {
  DISCORD_MANAGEMENT_MESSAGE_SCHEMA_VERSION,
  DISCORD_MANAGEMENT_RECEIPT_SCHEMA_VERSION,
  EXECUTION_PROTECTION_ORDER_SCHEMA_VERSION,
  EXECUTION_NO_EXPOSURE_PROOF_SCHEMA_VERSION,
  DISCORD_MANAGEMENT_FAMILY_RECEIPT_SCHEMA_VERSION,
  MIRROR_MANAGEMENT_RECEIPT_SCHEMA_VERSION,
  discordManagementMessageSchema,
  discordManagementReceiptSchema,
  discoTraderPushPayloadSchema,
  executionProtectionOrderSchema,
  discordManagementFamilyReceiptSchema,
  mirrorManagementReceiptSchema,
} from '../src/index.ts'

const checksum = 'a'.repeat(64)
const message = {
  management_message_schema_version: DISCORD_MANAGEMENT_MESSAGE_SCHEMA_VERSION,
  message_id: 'discord-message-followup-1',
  author_id: 'discord-user-456',
  channel_id: 'discord-thread-12',
  guild_id: 'discord-guild-1',
  thread_id: 'discord-thread-12',
  parent_channel_id: 'discord-channel-2',
  reply_to_message_id: 'discord-message-entry-1',
  raw_text: 'taking off half here, moving stops to BE',
  posted_at: '2026-07-30T15:10:00.000Z',
  observed_at: '2026-07-30T15:10:01.000Z',
  is_edit: false,
  content_checksum: checksum,
} as const

describe('Discord trade-management contracts', () => {
  test('accepts immutable reply and thread context', () => {
    expect(discordManagementMessageSchema.parse(message)).toMatchObject({
      message_id: message.message_id,
      author_id: message.author_id,
      channel_id: message.thread_id,
    })
  })

  test('requires the full immutable message on a DiscoTrader management push', () => {
    const push = {
      kind: 'management',
      severity: 'action_required',
      summary: 'Trader follow-up requires management.',
      management: message,
      at: message.observed_at,
    }
    expect(discoTraderPushPayloadSchema.safeParse(push).success).toBe(true)
    expect(discoTraderPushPayloadSchema.safeParse({
      ...push,
      management: undefined,
    }).success).toBe(false)
  })

  test('rejects observation before posting and mismatched thread/channel identity', () => {
    expect(discordManagementMessageSchema.safeParse({
      ...message,
      observed_at: '2026-07-30T15:09:59.000Z',
    }).success).toBe(false)
    expect(discordManagementMessageSchema.safeParse({
      ...message,
      thread_id: 'another-thread',
    }).success).toBe(false)
  })

  test('requires price evidence for normalized stop and limit protection orders', () => {
    const stop = {
      protection_order_schema_version: EXECUTION_PROTECTION_ORDER_SCHEMA_VERSION,
      provider_order_id: 'provider-stop-1',
      role: 'stop-loss',
      quantity: 2,
      order_type: 'stop',
      time_in_force: 'day',
      stop_price: '5598',
      status: 'working',
    }
    expect(executionProtectionOrderSchema.safeParse(stop).success).toBe(true)
    expect(executionProtectionOrderSchema.safeParse({
      ...stop,
      stop_price: undefined,
    }).success).toBe(false)
    expect(executionProtectionOrderSchema.safeParse({
      ...stop,
      order_type: 'limit',
      limit_price: '5598',
      stop_price: undefined,
    }).success).toBe(false)
  })

  test('requires resolved identity for actionable receipts and errors for blocks', () => {
    const receipt = {
      management_receipt_schema_version: DISCORD_MANAGEMENT_RECEIPT_SCHEMA_VERSION,
      receipt_id: 'discord-management-receipt-1',
      source_message: message,
      resolution_strategy: 'reply-entry',
      candidate_intent_ids: ['intent-discotrader-1234'],
      resolved_intent_id: 'intent-discotrader-1234',
      status: 'prepared',
      actions: [{
        index: 0,
        logical_action: {
          operation: 'partial-close',
          quantity: 1,
          source_phrase: 'taking off half',
        },
        concrete_payload: { operation: 'partial-close', quantity: 1 },
        status: 'pending',
      }],
      evidence: ['Exact reply matched.'],
      created_at: '2026-07-30T15:10:01.000Z',
      updated_at: '2026-07-30T15:10:01.000Z',
      content_checksum: checksum,
    }
    expect(discordManagementReceiptSchema.safeParse(receipt).success).toBe(true)
    expect(discordManagementReceiptSchema.safeParse({
      ...receipt,
      resolved_intent_id: undefined,
    }).success).toBe(false)
    expect(discordManagementReceiptSchema.safeParse({
      ...receipt,
      status: 'blocked',
      resolved_intent_id: undefined,
      actions: [],
      error: undefined,
    }).success).toBe(false)
    expect(discordManagementReceiptSchema.safeParse({
      ...receipt,
      status: 'completed',
      actions: [{
        ...receipt.actions[0],
        status: 'completed',
        completed_at: '2026-07-30T15:10:02.000Z',
      }],
    }).success).toBe(false)
  })

  test('freezes one single-or-Mirror family before management dispatch', () => {
    const receipt = {
      family_receipt_schema_version: DISCORD_MANAGEMENT_FAMILY_RECEIPT_SCHEMA_VERSION,
      receipt_id: 'management-family-receipt-1', source_message: message,
      status: 'resolved',
      candidates: [{ family: 'mirror', mirror_execution_id: 'mirror-parent-1' }],
      target: { family: 'mirror', mirror_execution_id: 'mirror-parent-1' },
      resolution_strategy: 'reply-entry',
      evidence: ['Frozen before dispatch.'],
      created_at: message.observed_at, content_checksum: checksum,
    }
    expect(discordManagementFamilyReceiptSchema.safeParse(receipt).success).toBe(true)
    expect(discordManagementFamilyReceiptSchema.safeParse({ ...receipt, target: undefined }).success).toBe(false)
  })

  test('requires broker-flat proof for every terminal Mirror child', () => {
    const proof = {
      proof_schema_version: EXECUTION_NO_EXPOSURE_PROOF_SCHEMA_VERSION,
      proof_id: 'proof-child-1', intent_id: 'intent-child-1', connection_id: 'connection-child-1',
      account_ref: 'account-child-1', account_snapshot_id: 'snapshot-child-1',
      account_snapshot_checksum: checksum, execution_record_checksum: checksum,
      positions_count: 0, working_orders_count: 0,
      captured_at: message.observed_at, evidence_refs: ['snapshot-child-1'], content_checksum: checksum,
    }
    const receipt = {
      mirror_management_receipt_schema_version: MIRROR_MANAGEMENT_RECEIPT_SCHEMA_VERSION,
      receipt_id: 'mirror-management-receipt-1', source_message: message,
      resolution_strategy: 'reply-entry', candidate_mirror_execution_ids: ['mirror-parent-1'],
      mirror_execution_id: 'mirror-parent-1', status: 'completed', logical_actions: [],
      children: [{
        parent_child_index: 0, member_id: 'member-child-1', connection_id: 'connection-child-1',
        intent_id: 'intent-child-1', status: 'terminal', actions: [],
        execution_record_checksum: checksum, no_exposure_proof: proof,
      }],
      evidence: ['Provider flat proved.'], created_at: message.observed_at,
      updated_at: message.observed_at, content_checksum: checksum,
    }
    expect(mirrorManagementReceiptSchema.safeParse(receipt).success).toBe(true)
    expect(mirrorManagementReceiptSchema.safeParse({
      ...receipt,
      children: [{ ...receipt.children[0], no_exposure_proof: undefined }],
    }).success).toBe(false)
  })
})
