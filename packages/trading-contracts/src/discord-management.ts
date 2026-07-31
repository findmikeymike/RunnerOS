import { z } from 'zod'

import {
  decimalStringSchema,
  identifierSchema,
  sha256Schema,
  utcTimestampSchema,
} from './common.ts'
import { executionManagementPayloadSchema } from './execution.ts'

export const DISCORD_MANAGEMENT_MESSAGE_SCHEMA_VERSION = 'discord-management-message@1'
export const DISCORD_MANAGEMENT_RECEIPT_SCHEMA_VERSION = 'discord-management-receipt@1'

export const discordManagementMessageSchema = z.object({
  management_message_schema_version: z.literal(DISCORD_MANAGEMENT_MESSAGE_SCHEMA_VERSION),
  message_id: identifierSchema,
  author_id: identifierSchema,
  channel_id: identifierSchema,
  guild_id: identifierSchema.optional(),
  thread_id: identifierSchema.optional(),
  parent_channel_id: identifierSchema.optional(),
  reply_to_message_id: identifierSchema.optional(),
  raw_text: z.string().trim().min(1).max(20_000),
  posted_at: utcTimestampSchema,
  observed_at: utcTimestampSchema,
  is_edit: z.boolean(),
  content_checksum: sha256Schema,
}).strict().superRefine((message, context) => {
  if (Date.parse(message.observed_at) < Date.parse(message.posted_at)) {
    context.addIssue({
      code: 'custom',
      path: ['observed_at'],
      message: 'Discord observation cannot precede the posted timestamp',
    })
  }
  if (message.thread_id && message.thread_id !== message.channel_id) {
    context.addIssue({
      code: 'custom',
      path: ['thread_id'],
      message: 'Discord thread messages must use the thread ID as their channel ID',
    })
  }
})

export const discordManagementLogicalActionSchema = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('partial-close'),
    quantity: z.number().int().positive().max(10_000),
    source_phrase: z.string().trim().min(1).max(500),
  }).strict(),
  z.object({
    operation: z.literal('flatten'),
    reason: z.string().trim().min(1).max(500),
    source_phrase: z.string().trim().min(1).max(500),
  }).strict(),
  z.object({
    operation: z.literal('move-stop'),
    target: z.discriminatedUnion('basis', [
      z.object({ basis: z.literal('breakeven') }).strict(),
      z.object({
        basis: z.literal('explicit'),
        price: decimalStringSchema.refine((value) => !value.startsWith('-') && value !== '0'),
      }).strict(),
    ]),
    source_phrase: z.string().trim().min(1).max(500),
  }).strict(),
  z.object({
    operation: z.literal('reconcile'),
    reason: z.literal('stopped-out'),
    source_phrase: z.string().trim().min(1).max(500),
  }).strict(),
])

export const discordManagementResolutionStrategySchema = z.enum([
  'reply-entry',
  'reply-followup',
  'thread-symbol',
  'single-thread-trade',
  'channel-symbol',
  'single-channel-trade',
])

export const discordManagementActionReceiptSchema = z.object({
  index: z.number().int().nonnegative().max(20),
  logical_action: discordManagementLogicalActionSchema,
  concrete_payload: executionManagementPayloadSchema.optional(),
  status: z.enum(['pending', 'executing', 'completed', 'failed']),
  management_command_id: identifierSchema.optional(),
  completed_at: utcTimestampSchema.optional(),
  error: z.string().trim().min(1).max(1_000).optional(),
}).strict().superRefine((action, context) => {
  if (action.status === 'completed' && !action.completed_at) {
    context.addIssue({
      code: 'custom',
      path: ['completed_at'],
      message: 'Completed management actions require a completion timestamp',
    })
  }
  if (action.status === 'failed' && !action.error) {
    context.addIssue({
      code: 'custom',
      path: ['error'],
      message: 'Failed management actions require an error',
    })
  }
  if (
    action.logical_action.operation !== 'reconcile'
    && (action.status === 'executing' || action.status === 'completed')
    && !action.concrete_payload
  ) {
    context.addIssue({
      code: 'custom',
      path: ['concrete_payload'],
      message: 'Issued trade mutations require their exact concrete gateway payload',
    })
  }
  if (
    action.logical_action.operation !== 'reconcile'
    && action.status === 'completed'
    && !action.management_command_id
  ) {
    context.addIssue({
      code: 'custom',
      path: ['management_command_id'],
      message: 'Completed trade mutations require their gateway management command ID',
    })
  }
  if (
    action.logical_action.operation === 'reconcile'
    && (action.concrete_payload || action.management_command_id)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['concrete_payload'],
      message: 'Reconciliation-only actions cannot claim a mutation payload or command ID',
    })
  }
})

export const discordManagementReceiptSchema = z.object({
  management_receipt_schema_version: z.literal(DISCORD_MANAGEMENT_RECEIPT_SCHEMA_VERSION),
  receipt_id: identifierSchema,
  source_message: discordManagementMessageSchema,
  resolution_strategy: discordManagementResolutionStrategySchema.optional(),
  candidate_intent_ids: z.array(identifierSchema).max(100),
  resolved_intent_id: identifierSchema.optional(),
  symbol_evidence: identifierSchema.optional(),
  status: z.enum(['blocked', 'prepared', 'executing', 'completed', 'failed']),
  actions: z.array(discordManagementActionReceiptSchema).max(20),
  evidence: z.array(z.string().trim().min(1).max(500)).max(100),
  error: z.string().trim().min(1).max(1_000).optional(),
  created_at: utcTimestampSchema,
  updated_at: utcTimestampSchema,
  content_checksum: sha256Schema,
}).strict().superRefine((receipt, context) => {
  if (
    (receipt.status === 'prepared' || receipt.status === 'executing' || receipt.status === 'completed')
    && !receipt.resolved_intent_id
  ) {
    context.addIssue({
      code: 'custom',
      path: ['resolved_intent_id'],
      message: 'Actionable management receipts require a resolved intent',
    })
  }
  if (receipt.status === 'completed' && receipt.actions.some((action) => action.status !== 'completed')) {
    context.addIssue({
      code: 'custom',
      path: ['actions'],
      message: 'A completed receipt requires every action to be completed',
    })
  }
  if ((receipt.status === 'blocked' || receipt.status === 'failed') && !receipt.error) {
    context.addIssue({
      code: 'custom',
      path: ['error'],
      message: 'Blocked and failed receipts require an error',
    })
  }
  if (Date.parse(receipt.updated_at) < Date.parse(receipt.created_at)) {
    context.addIssue({
      code: 'custom',
      path: ['updated_at'],
      message: 'Management receipt update cannot precede creation',
    })
  }
  if (receipt.actions.some((action, index) => action.index !== index)) {
    context.addIssue({
      code: 'custom',
      path: ['actions'],
      message: 'Management action indices must be unique and sequential',
    })
  }
})

export type DiscordManagementMessage = z.infer<typeof discordManagementMessageSchema>
export type DiscordManagementLogicalAction = z.infer<typeof discordManagementLogicalActionSchema>
export type DiscordManagementResolutionStrategy = z.infer<typeof discordManagementResolutionStrategySchema>
export type DiscordManagementActionReceipt = z.infer<typeof discordManagementActionReceiptSchema>
export type DiscordManagementReceipt = z.infer<typeof discordManagementReceiptSchema>
